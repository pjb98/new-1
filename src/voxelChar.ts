import * as THREE from "three";
import { voxelMaterial, glowMaterial } from "./palette";
import { AnimState, CharacterRig } from "./assets";
import { GunStyle, buildGun } from "./gunModels";
import { ATLAS, ATLAS_SIZE } from "./skintex";

/** The cute social emotes a voxel figure can play in the island hub. */
export type EmoteId = "wave" | "dance" | "sit" | "cheer";
/** Default play length (seconds) per emote; "sit" loops until movement clears it. */
const EMOTE_DUR: Record<EmoteId, number> = { wave: 2.2, dance: 3.2, sit: 0, cheer: 2.0 };

/** Cosmetic headwear / back accessory styles a skin can equip. */
export type HatStyle = "none" | "cap" | "crown" | "helmet" | "horns" | "halo" | "tophat" | "ears" | "mohawk" | "antenna" | "visor" | "bow" | "wizard" | "hood" | "pirate";
export type BackStyle = "none" | "cape" | "wings" | "pack" | "jetpack";
export interface CosmeticSpec {
  hat?: HatStyle;
  hatColor?: number;
  back?: BackStyle;
  backColor?: number;
}

/** Outfit detail (multi-zone clothing) a skin can wear — pants/shoes/belt/gloves
 *  + a face + an optional chest emblem. Most fields auto-derive from the body. */
export interface OutfitSpec {
  body: number;
  pants?: number;
  shoes?: number;
  belt?: number;
  gloves?: number;
  emblem?: number;
}

type AtlasFaces = { top: number[]; bottom: number[]; right: number[]; front: number[]; left: number[]; back: number[] };
/** Remap a BoxGeometry's UVs so each face samples its region of the skin atlas
 *  (THREE box group order is px,nx,py,ny,pz,nz → right,left,top,bottom,front,back). */
function setAtlasUV(geo: THREE.BoxGeometry, faces: AtlasFaces) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const S = ATLAS_SIZE;
  const order = [faces.right, faces.left, faces.top, faces.bottom, faces.front, faces.back];
  for (let fi = 0; fi < 6; fi++) {
    const [x, y, w, h] = order[fi];
    const u0 = x / S, u1 = (x + w) / S, v0 = 1 - y / S, v1 = 1 - (y + h) / S;
    const o = fi * 4;
    uv.setXY(o + 0, u0, v0);
    uv.setXY(o + 1, u1, v0);
    uv.setXY(o + 2, u0, v1);
    uv.setXY(o + 3, u1, v1);
  }
  uv.needsUpdate = true;
}

export interface VoxelCharOpts {
  body: number;
  head: number;
  eye: number;
  hat?: number;
  /** Adds a forward gun nub (player). */
  gun?: boolean;
  /** Shambling gait + forward-reaching arms. */
  zombie?: boolean;
  /** Cosmetic headwear / back accessory (skins). */
  cosmetic?: CosmeticSpec;
}

/**
 * A procedural blocky humanoid — the committed character style (Kintara-like:
 * boxy body, square head with two dot-eyes, optional hat). Animates walk / idle
 * / attack / death procedurally by swinging limb pivot groups. Implements the
 * same `CharacterRig` API as the GLB `Character`, so entities don't care which.
 */
export class VoxelChar implements CharacterRig {
  readonly root = new THREE.Group();
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private upper = new THREE.Group(); // torso + head + arms (for bob/lean)
  private cosmetic = new THREE.Group(); // skin headwear + back accessory

  private state: AnimState = "idle";
  private t = 0;
  private deathT = 0;
  // ---- island emotes (procedural; layered over idle, not an AnimState) ----
  private emoteId: EmoteId | null = null;
  private emoteT = 0; // seconds elapsed in the current emote
  private emoteDur = 0; // 0 = loop until cleared (sit), >0 = one-shot
  private deathTilt = (Math.random() - 0.5) * 0.6;
  private gait: number;
  private reach: number;
  private bodyMat: THREE.MeshStandardMaterial;
  private headMat: THREE.MeshStandardMaterial;
  private legMat!: THREE.MeshStandardMaterial; // pants
  private outfit: THREE.Object3D[] = []; // skin detail pieces (belt/shoes/mouth/emblem)
  private torsoMesh!: THREE.Mesh;
  private headMesh!: THREE.Mesh;
  private armMeshes: THREE.Mesh[] = [];
  private legMeshes: THREE.Mesh[] = [];
  private skinMat?: THREE.MeshStandardMaterial; // textured pixel-skin material
  private uvSet = false; // box UVs remapped to the skin atlas (once)
  private baseEmissive = 0x000000;
  private gunHolder?: THREE.Group;
  private gunStyle?: GunStyle;

  constructor(opts: VoxelCharOpts) {
    this.gait = opts.zombie ? 6 : 10;
    this.reach = opts.zombie ? -0.5 : 0; // zombies hold arms forward

    const bodyMat = voxelMaterial(opts.body);
    const headMat = voxelMaterial(opts.head);
    this.bodyMat = bodyMat;
    this.headMat = headMat;
    // legs get their own material so skins can wear PANTS (zombies keep it = body
    // via setColor, so the horde is unaffected).
    this.legMat = voxelMaterial(opts.body);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.5), bodyMat);
    torso.position.y = 1.05;
    torso.castShadow = true;
    this.torsoMesh = torso;
    this.upper.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.74, 0.74), headMat);
    head.position.y = 1.85;
    head.castShadow = true;
    this.headMesh = head;
    this.upper.add(head);

    const eyeMat = voxelMaterial(opts.eye);
    for (const dx of [-0.16, 0.16]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, 0.06), eyeMat);
      e.position.set(dx, 1.88, 0.39);
      this.upper.add(e);
    }

    if (opts.hat !== undefined) {
      const hat = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.2, 0.82), voxelMaterial(opts.hat));
      hat.position.y = 2.28;
      hat.castShadow = true;
      this.upper.add(hat);
    }

    this.armL = this.makeArm(bodyMat, -0.52);
    this.armR = this.makeArm(bodyMat, 0.52);
    this.upper.add(this.armL, this.armR);

    // cosmetic kit (hat + back accessory) lives in its own group so a skin swap
    // can rebuild it without touching the body.
    this.upper.add(this.cosmetic);
    if (opts.cosmetic) this.setCosmetic(opts.cosmetic);

    if (opts.gun) {
      this.gunHolder = new THREE.Group();
      this.gunHolder.position.set(0.32, 1.02, 0.26); // right hand, barrel forward
      this.upper.add(this.gunHolder);
      this.setGun("pistol");
    }

    this.legL = this.makeLeg(this.legMat, -0.18);
    this.legR = this.makeLeg(this.legMat, 0.18);

    this.root.add(this.upper, this.legL, this.legR);
  }

  private makeArm(mat: THREE.Material, x: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 1.45, 0); // shoulder pivot
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.62, 0.26), mat);
    arm.position.y = -0.31;
    // arms/legs don't cast shadow — halves shadow draw calls for the horde;
    // torso+head shadow already reads the silhouette fine.
    g.add(arm);
    this.armMeshes.push(arm);
    return g;
  }

  private makeLeg(mat: THREE.Material, x: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 0.62, 0); // hip pivot
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.62, 0.32), mat);
    leg.position.y = -0.31;
    g.add(leg); // no shadow caster (see makeArm)
    this.legMeshes.push(leg);
    return g;
  }

  hasAnim(): boolean {
    return true; // all states are procedural
  }

  /** Swap the held weapon model (no-op if unchanged or this rig has no gun). */
  setGun(style: GunStyle) {
    if (!this.gunHolder || this.gunStyle === style) return;
    this.gunStyle = style;
    this.gunHolder.clear(); // gun meshes share one geometry; nothing to dispose
    this.gunHolder.add(buildGun(style));
  }

  /** Recolor body/head (used to turn a pooled zombie into a special variant). */
  setColor(body: number, head: number, emissive = 0x000000) {
    this.bodyMat.color.set(body);
    this.bodyMat.emissive.set(emissive);
    this.bodyMat.emissiveIntensity = emissive === 0x000000 ? 1 : 0.5;
    this.baseEmissive = emissive;
    this.headMat.color.set(head);
    this.legMat.color.set(body); // legs follow the body unless an outfit overrides
    this.legMat.emissive.set(emissive);
    this.legMat.emissiveIntensity = this.bodyMat.emissiveIntensity;
  }

  /** Dress the hero in a detailed outfit — pants (recolours the legs) plus belt,
   *  shoes, gloves, a mouth, and an optional glowing chest emblem. Skin-only
   *  (player/peers); zombies never call this, so the horde stays cheap. */
  setOutfit(spec: OutfitSpec) {
    for (const m of this.outfit) {
      m.parent?.remove(m);
      (m as THREE.Mesh).geometry?.dispose?.();
      ((m as THREE.Mesh).material as THREE.Material)?.dispose?.();
    }
    this.outfit = [];
    const darker = (c: number, f = 0.6) => {
      const r = Math.floor(((c >> 16) & 0xff) * f), g = Math.floor(((c >> 8) & 0xff) * f), b = Math.floor((c & 0xff) * f);
      return (r << 16) | (g << 8) | b;
    };
    this.legMat.color.set(spec.pants ?? darker(spec.body));
    const trim = 0x2a2018;
    const add = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: number, glow = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glow ? glowMaterial(color, 1.0) : voxelMaterial(color));
      m.position.set(x, y, z);
      parent.add(m);
      this.outfit.push(m);
    };
    // belt at the waist
    add(this.upper, 0.84, 0.14, 0.54, 0, 0.66, 0, spec.belt ?? trim);
    add(this.upper, 0.18, 0.18, 0.08, 0, 0.66, 0.27, spec.emblem ?? 0xd8c060); // buckle
    // shoes (children of each leg group so they move with the stride)
    for (const leg of [this.legL, this.legR]) add(leg, 0.36, 0.2, 0.42, 0, -0.6, 0.05, spec.shoes ?? trim);
    // gloves at the hands
    for (const arm of [this.armL, this.armR]) add(arm, 0.28, 0.22, 0.3, 0, -0.6, 0.02, spec.gloves ?? trim);
    // a little mouth so there's a face
    add(this.upper, 0.26, 0.06, 0.06, 0, 1.7, 0.39, trim);
    // optional glowing chest emblem
    if (spec.emblem !== undefined) add(this.upper, 0.32, 0.32, 0.06, 0, 1.16, 0.27, spec.emblem, true);
  }

  /** Apply a true pixel-skin TEXTURE to the body parts (Minecraft-style). Remaps
   *  each box's UVs to the skin atlas once, then maps the texture across head /
   *  torso / arms / legs. Used by skins (zombies stay flat-coloured). `glow` adds
   *  a high-rarity emissive sheen. The 3D cosmetic kit (hat/cape) still overlays. */
  applyTexture(tex: THREE.Texture, glow = 0x000000) {
    if (!this.uvSet) {
      setAtlasUV(this.headMesh.geometry as THREE.BoxGeometry, ATLAS.head);
      setAtlasUV(this.torsoMesh.geometry as THREE.BoxGeometry, ATLAS.body);
      for (const a of this.armMeshes) setAtlasUV(a.geometry as THREE.BoxGeometry, ATLAS.arm);
      for (const l of this.legMeshes) setAtlasUV(l.geometry as THREE.BoxGeometry, ATLAS.leg);
      this.uvSet = true;
    }
    if (!this.skinMat) this.skinMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: false });
    this.skinMat.map = tex;
    this.skinMat.color.set(0xffffff);
    this.skinMat.emissive.set(glow);
    this.skinMat.emissiveIntensity = glow === 0x000000 ? 0 : 0.4;
    this.baseEmissive = glow;
    this.skinMat.needsUpdate = true;
    this.headMesh.material = this.skinMat;
    this.torsoMesh.material = this.skinMat;
    for (const a of this.armMeshes) a.material = this.skinMat;
    for (const l of this.legMeshes) l.material = this.skinMat;
  }

  /** (Re)build the cosmetic kit (skin hat + back accessory). Cheap voxel boxes;
   *  clears the previous kit's geometry so a skin swap doesn't leak. */
  setCosmetic(spec: CosmeticSpec) {
    for (const o of this.cosmetic.children) {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material)?.dispose?.();
    }
    this.cosmetic.clear();
    const hc = spec.hatColor ?? 0xffffff;
    const bx = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, glow = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glow ? glowMaterial(color, 1.0) : voxelMaterial(color));
      m.position.set(x, y, z);
      m.castShadow = !glow;
      this.cosmetic.add(m);
      return m;
    };
    // ---- headwear (head top ≈ y2.22) ----
    switch (spec.hat) {
      case "cap":
        bx(0.82, 0.16, 0.82, 0, 2.3, 0, hc);
        bx(0.5, 0.1, 0.5, 0, 2.42, 0, hc);
        bx(0.6, 0.1, 0.4, 0, 2.26, 0.42, hc); // brim
        break;
      case "crown":
        bx(0.86, 0.16, 0.86, 0, 2.32, 0, hc);
        for (const a of [0, 1, 2, 3, 4]) {
          const ang = (a / 5) * Math.PI * 2;
          bx(0.14, 0.26, 0.14, Math.cos(ang) * 0.34, 2.5, Math.sin(ang) * 0.34, hc, true);
        }
        break;
      case "helmet":
        bx(0.9, 0.5, 0.9, 0, 2.2, 0, hc);
        bx(0.16, 0.4, 0.16, 0, 2.7, 0, hc, true); // plume
        break;
      case "horns":
        for (const sx of [-1, 1]) {
          bx(0.16, 0.5, 0.16, sx * 0.42, 2.4, 0, hc);
          bx(0.14, 0.28, 0.14, sx * 0.56, 2.72, 0, hc);
        }
        break;
      case "halo":
        { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.07, 6, 20), glowMaterial(hc, 1.4));
          ring.rotation.x = Math.PI / 2; ring.position.y = 2.62; this.cosmetic.add(ring); }
        break;
      case "tophat":
        bx(0.95, 0.12, 0.95, 0, 2.26, 0, hc);
        bx(0.62, 0.6, 0.62, 0, 2.6, 0, hc);
        bx(0.66, 0.1, 0.66, 0, 2.5, 0, 0x222222); // band
        break;
      case "ears":
        for (const sx of [-1, 1]) bx(0.2, 0.34, 0.16, sx * 0.26, 2.5, 0, hc);
        break;
      case "mohawk":
        for (let i = 0; i < 5; i++) bx(0.14, 0.34 - Math.abs(i - 2) * 0.06, 0.5, 0, 2.5, 0.28 - i * 0.14, hc, true);
        break;
      case "antenna":
        for (const sx of [-1, 1]) {
          bx(0.06, 0.4, 0.06, sx * 0.18, 2.5, 0, 0x333333);
          bx(0.16, 0.16, 0.16, sx * 0.18, 2.74, 0, hc, true);
        }
        break;
      case "visor":
        bx(0.8, 0.18, 0.1, 0, 1.92, 0.42, hc, true);
        break;
      case "bow":
        for (const sx of [-1, 1]) bx(0.22, 0.26, 0.16, sx * 0.22, 2.36, 0, hc);
        bx(0.14, 0.14, 0.18, 0, 2.36, 0, hc);
        break;
      case "wizard":
        bx(0.92, 0.12, 0.92, 0, 2.28, 0, hc); // brim
        { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.0, 8), voxelMaterial(hc));
          cone.position.y = 2.85; cone.castShadow = true; this.cosmetic.add(cone); }
        bx(0.16, 0.16, 0.16, 0, 3.32, 0, 0xffe14a, true); // glowing star tip
        break;
      case "hood":
        bx(0.92, 0.8, 0.72, 0, 2.1, -0.12, hc); // hood shell (face pokes out front)
        bx(0.5, 0.34, 0.18, 0, 1.62, 0.3, hc); // collar
        break;
      case "pirate":
        bx(1.0, 0.18, 0.52, 0, 2.34, 0, hc); // brim
        bx(0.32, 0.34, 0.16, 0, 2.48, 0.3, hc); // upturned front peak
        bx(0.32, 0.34, 0.16, 0, 2.48, -0.3, hc); // back peak
        bx(0.18, 0.18, 0.06, 0, 2.52, 0.38, 0xfff4d6); // skull emblem
        break;
      default: break;
    }
    // ---- back accessory (behind the torso) ----
    const bc = spec.backColor ?? hc;
    switch (spec.back) {
      case "cape":
        { const cape = bx(0.74, 1.1, 0.1, 0, 1.0, -0.32, bc); cape.rotation.x = 0.12; }
        break;
      case "wings":
        for (const sx of [-1, 1]) {
          const w1 = bx(0.7, 0.5, 0.08, sx * 0.55, 1.5, -0.3, bc, true); w1.rotation.z = sx * 0.5; w1.rotation.y = sx * 0.5;
          const w2 = bx(0.5, 0.36, 0.08, sx * 0.85, 1.15, -0.34, bc, true); w2.rotation.z = sx * 0.5; w2.rotation.y = sx * 0.5;
        }
        break;
      case "pack":
        bx(0.5, 0.6, 0.3, 0, 1.2, -0.4, bc);
        bx(0.16, 0.16, 0.12, 0, 1.5, -0.56, 0x333333);
        break;
      case "jetpack":
        for (const sx of [-1, 1]) {
          bx(0.22, 0.6, 0.22, sx * 0.26, 1.25, -0.42, bc);
          bx(0.16, 0.18, 0.16, sx * 0.26, 0.9, -0.42, 0xff7a2a, true); // exhaust glow
        }
        break;
      default: break;
    }
  }

  /** White flash on hit (0..1); fades back to the variant's base emissive. */
  setHitFlash(amount: number) {
    if (amount <= 0) {
      this.bodyMat.emissive.set(this.baseEmissive);
      this.headMat.emissive.set(0x000000);
      this.bodyMat.emissiveIntensity = this.baseEmissive === 0x000000 ? 1 : 0.5;
      this.headMat.emissiveIntensity = 1;
      if (this.skinMat) { this.skinMat.emissive.set(this.baseEmissive); this.skinMat.emissiveIntensity = this.baseEmissive === 0x000000 ? 0 : 0.4; }
      return;
    }
    // flash RED on damage so hits read clearly (was white)
    this.bodyMat.emissive.setRGB(amount, amount * 0.05, amount * 0.05);
    this.headMat.emissive.setRGB(amount, amount * 0.05, amount * 0.05);
    this.bodyMat.emissiveIntensity = 1.6;
    this.headMat.emissiveIntensity = 1.6;
    if (this.skinMat) { this.skinMat.emissive.setRGB(amount, amount * 0.05, amount * 0.05); this.skinMat.emissiveIntensity = 1.6; }
  }

  play(state: AnimState, _opts: { once?: boolean } = {}) {
    if (state === this.state) return;
    this.state = state;
    // walking cancels any emote (you can't dance while running); idle does not,
    // so wave/cheer keep playing while you stand still.
    if (state === "walk") this.emoteId = null;
    if (state === "death") {
      this.deathT = 0;
    } else {
      this.root.rotation.set(0, 0, 0);
      this.root.position.y = 0;
      this.root.scale.setScalar(1);
    }
  }

  /** Start a social emote (island hub). Plays over idle; one-shot emotes auto-clear. */
  emote(id: EmoteId) {
    this.emoteId = id;
    this.emoteT = 0;
    this.emoteDur = EMOTE_DUR[id];
  }

  /** True while a non-looping emote is still playing (so callers can gate input). */
  get emoting(): boolean {
    return this.emoteId !== null;
  }

  // Procedural emote poses — simple, cute, voxel-style limb/torso animation.
  private applyEmote(id: EmoteId) {
    const et = this.emoteT;
    // reset legs/torso to a neutral stand each frame (poses set what they need)
    this.legL.rotation.x = 0;
    this.legR.rotation.x = 0;
    this.root.position.y = 0;
    this.root.rotation.set(0, 0, 0);
    this.upper.rotation.z = 0;
    switch (id) {
      case "wave": {
        // raise the right arm overhead and swish it side to side
        const s = Math.sin(et * 9);
        this.armR.rotation.x = -2.6;
        this.armR.rotation.z = 0.35 + s * 0.35;
        this.armL.rotation.x = this.reach;
        this.upper.position.y = 0.02 + Math.abs(s) * 0.02;
        break;
      }
      case "dance": {
        // bouncy hip-sway with alternating arm pumps + a little spin
        const b = Math.sin(et * 7);
        this.armL.rotation.x = -1.4 + b * 0.9;
        this.armR.rotation.x = -1.4 - b * 0.9;
        this.upper.rotation.z = b * 0.25;
        this.upper.position.y = Math.abs(Math.sin(et * 14)) * 0.12;
        this.root.rotation.y = Math.sin(et * 3.5) * 0.4;
        this.legL.rotation.x = b * 0.3;
        this.legR.rotation.x = -b * 0.3;
        break;
      }
      case "sit": {
        // lower the whole figure + bend legs forward like sitting cross-legged
        this.root.position.y = -0.5;
        this.legL.rotation.x = 1.4;
        this.legR.rotation.x = 1.4;
        this.armL.rotation.x = 0.5;
        this.armR.rotation.x = 0.5;
        this.upper.position.y = Math.sin(et * 2) * 0.02; // gentle breathing
        break;
      }
      case "cheer": {
        // both arms thrown up with little hops of excitement
        const hop = Math.abs(Math.sin(et * 8));
        this.armL.rotation.x = -2.7;
        this.armR.rotation.x = -2.7;
        this.armL.rotation.z = -0.3;
        this.armR.rotation.z = 0.3;
        this.root.position.y = hop * 0.18;
        this.upper.position.y = 0.02;
        break;
      }
    }
  }

  update(dt: number) {
    this.t += dt;
    // Emotes layer over idle (never over walk/death). One-shots auto-expire.
    if (this.emoteId && this.state !== "walk" && this.state !== "death") {
      this.emoteT += dt;
      if (this.emoteDur > 0 && this.emoteT >= this.emoteDur) {
        this.emoteId = null;
      } else {
        this.applyEmote(this.emoteId);
        return;
      }
    }
    switch (this.state) {
      case "death": {
        this.deathT += dt;
        const k = Math.min(1, this.deathT / 0.4);
        this.root.rotation.x = -1.5 * k;
        this.root.rotation.z = this.deathTilt * k;
        this.root.position.y = -0.25 * k;
        break;
      }
      case "walk": {
        const a = Math.sin(this.t * this.gait) * 0.7;
        this.legL.rotation.x = a;
        this.legR.rotation.x = -a;
        this.armL.rotation.x = this.reach - a * 0.6;
        this.armR.rotation.x = this.reach + a * 0.6;
        this.armL.rotation.z = 0;
        this.armR.rotation.z = 0;
        this.upper.position.y = Math.abs(Math.sin(this.t * this.gait)) * 0.06;
        this.upper.rotation.z = Math.sin(this.t * this.gait) * 0.05;
        break;
      }
      default: {
        // idle: gentle breathing + arm sway, legs neutral
        const b = Math.sin(this.t * 2);
        this.legL.rotation.x = 0;
        this.legR.rotation.x = 0;
        this.armL.rotation.x = this.reach + b * 0.04;
        this.armR.rotation.x = this.reach - b * 0.04;
        this.armL.rotation.z = 0;
        this.armR.rotation.z = 0;
        this.upper.position.y = b * 0.025;
        this.upper.rotation.z = 0;
      }
    }
  }
}
