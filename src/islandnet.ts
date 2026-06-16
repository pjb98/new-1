import * as THREE from "three";
import { VoxelChar, EmoteId } from "./voxelChar";
import { NetClient, NetMsg, PresenceMsg } from "./net";
import { EMOTES, QUICK_CHAT } from "./emotes";
import { Pet, findAnyPet } from "./pets";
import { findSkin } from "./cosmetics";
import { skinTexture } from "./skintex";
import { auraMaterial } from "./palette";

const PEER_PET_CAP = 4; // how many of a peer's pets we render (perf)
const AURA_COLORS = [0x000000, 0x6ad7ff, 0xc792ea, 0xffd24a]; // tier 0..3

// The relay is untrusted: only accept emote ids / chat we actually broadcast.
const VALID_EMOTES = new Set<string>(EMOTES.map((e) => e.id));
const VALID_CHAT = new Set<string>(QUICK_CHAT);
const CHAT_MAX = 48; // hard cap even on accepted text

/**
 * Island presence layer — lightweight, peer-to-peer (no authoritative host).
 *
 * Every client broadcasts its pose a few times a second over the relay; this
 * renders a smoothly-interpolated voxel figure for each other player on the
 * same island instance. Deliberately separate from NetPlay (which is the
 * heavyweight host-authoritative combat sim) — the hub only needs "see people
 * walk around", so this stays cheap and self-contained.
 *
 * On top of pose it also carries the SOCIAL layer: peers play each other's
 * emotes, show preset quick-chat as speech bubbles, render the sender's actual
 * cosmetic skin (body + head), and show a "…" thinking bubble while a peer has
 * their emote/chat menu open. All canvas-sprite labels follow makeLabel's
 * cheap, mipmap-free recipe so they never stall the GPU.
 */

const LERP = 12; // position/yaw smoothing toward the latest received pose
const SEND_HZ = 8; // pose broadcasts per second
const BUBBLE_SECS = 3.0; // how long a speech bubble lingers

/** A peer's look + initial state, learned from their first presence message. */
export interface PeerLook {
  body: number;
  head: number;
  name?: string;
}

class PeerFigure {
  readonly group = new THREE.Group();
  private char: VoxelChar;
  private tx = 0;
  private tz = 0;
  private ty = 0;
  private walking = false;
  private label?: THREE.Sprite;
  // social overlays (canvas sprites above the head)
  private bubble?: THREE.Sprite;
  private bubbleT = 0; // seconds remaining on the current speech bubble
  private typing?: THREE.Sprite;
  // ---- flex cosmetics ----
  private name = "";
  private pets: Pet[] = [];
  private petKey = ""; // current pet-id set (rebuild on change)
  private plateKey = ""; // current name/title/prestige/best (rebuild on change)
  private aura?: THREE.Mesh;
  private auraTier = 0;
  private skinId = ""; // current cosmetic skin (rebuild kit on change)
  best = 0; // peer's best round (for the lobby leaderboard)
  get displayName(): string { return this.name; }

  constructor(private scene: THREE.Scene, look: PeerLook) {
    this.char = new VoxelChar({ body: look.body, head: look.head, eye: 0x222222, hat: 0xf2c14e, gun: false });
    this.group.add(this.char.root);
    this.name = look.name ?? "";
    if (this.name) {
      this.label = makeNamePlate(this.name, "", 0, 0);
      this.group.add(this.label);
    }
    scene.add(this.group);
  }

  /** Mode-portal this peer is standing in (for the co-op gather count), or "". */
  portal = "";

  setTarget(p: PresenceMsg) {
    this.tx = p.x;
    this.tz = p.z;
    this.ty = p.ry;
    this.walking = p.moving;
    this.portal = typeof p.portal === "string" ? p.portal.slice(0, 16) : "";
    this.setTyping(!!p.menuOpen);
    this.applyFlex(p);
  }

  /** Rebuild the nameplate / pets / aura when a peer's flex data changes. */
  private applyFlex(p: PresenceMsg) {
    // nameplate (name + title + prestige stars + best round)
    const title = typeof p.title === "string" ? p.title.slice(0, 28) : "";
    const prestige = Math.max(0, Math.min(99, Math.floor(p.prestige ?? 0)));
    const best = Math.max(0, Math.min(999, Math.floor(p.best ?? 0)));
    this.best = best;
    const plateKey = `${this.name}|${title}|${prestige}|${best}`;
    if (plateKey !== this.plateKey && this.name) {
      this.plateKey = plateKey;
      if (this.label) { this.group.remove(this.label); disposeSprite(this.label); }
      this.label = makeNamePlate(this.name, title, prestige, best);
      this.group.add(this.label);
    }
    // pets following the peer
    const ids = Array.isArray(p.pets) ? p.pets.filter((s) => typeof s === "string").slice(0, PEER_PET_CAP) : [];
    const key = ids.join("|");
    if (key !== this.petKey) {
      this.petKey = key;
      for (const pet of this.pets) this.scene.remove(pet.group);
      this.pets = [];
      ids.forEach((id) => {
        const def = findAnyPet(id);
        if (!def) return;
        const pet = new Pet(def, 0, 1, false);
        this.scene.add(pet.group);
        this.pets.push(pet);
      });
    }
    // equipped skin → hat/cape cosmetic kit + high-rarity glow
    const sid = typeof p.skinId === "string" ? p.skinId.slice(0, 24) : "";
    if (sid && sid !== this.skinId) {
      this.skinId = sid;
      const sk = findSkin(sid);
      this.char.setCosmetic({ hat: sk.hat, hatColor: sk.hatColor, back: sk.back, backColor: sk.backColor });
      const tex = skinTexture(sid);
      if (tex) this.char.applyTexture(tex, sk.glow ?? 0x000000);
      else this.char.setColor(sk.body, sk.head, sk.glow ?? 0x000000);
    }
    // aura tier
    const tier = Math.max(0, Math.min(3, Math.floor(p.aura ?? 0)));
    if (tier !== this.auraTier) {
      this.auraTier = tier;
      if (this.aura) { this.group.remove(this.aura); (this.aura.geometry as THREE.BufferGeometry).dispose(); this.aura = undefined; }
      if (tier > 0) {
        this.aura = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.12, 18), auraMaterial(AURA_COLORS[tier], 0.7));
        this.aura.position.y = 0.08;
        this.group.add(this.aura);
      }
    }
  }

  /** Play an emote received from this peer. */
  playEmote(id: EmoteId) {
    this.char.emote(id);
  }

  /** Show a preset quick-chat phrase as a speech bubble for a few seconds. */
  say(text: string) {
    if (this.bubble) {
      this.group.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubble = makeBubble(text);
    this.group.add(this.bubble);
    this.bubbleT = BUBBLE_SECS;
  }

  /** Toggle the small "…" thinking bubble (peer has a menu open). */
  private setTyping(on: boolean) {
    if (on && !this.typing) {
      this.typing = makeBubble("…");
      this.typing.position.y = 2.85;
      this.typing.scale.set(0.7, 0.42, 1);
      this.group.add(this.typing);
    } else if (!on && this.typing) {
      this.group.remove(this.typing);
      disposeSprite(this.typing);
      this.typing = undefined;
    }
  }

  update(dt: number) {
    const k = 1 - Math.exp(-LERP * dt);
    this.group.position.x += (this.tx - this.group.position.x) * k;
    this.group.position.z += (this.tz - this.group.position.z) * k;
    let d = this.ty - this.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * k;
    // emoting peers keep idle as the base state so the emote can layer over it
    this.char.play(this.walking ? "walk" : "idle");
    this.char.update(dt);
    // pets orbit the peer (peaceful — no combat in the hub)
    const px = this.group.position.x, pz = this.group.position.z;
    this.pets.forEach((pet, i) => pet.update(dt, px, pz, i, this.pets.length, null));
    // aura breathes
    if (this.aura) {
      const s = 1 + Math.sin(performance.now() * 0.003) * 0.08;
      this.aura.scale.set(s, 1, s);
    }
    // expire speech bubbles
    if (this.bubble) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.group.remove(this.bubble);
        disposeSprite(this.bubble);
        this.bubble = undefined;
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.label) disposeSprite(this.label);
    if (this.bubble) disposeSprite(this.bubble);
    if (this.typing) disposeSprite(this.typing);
    for (const pet of this.pets) this.scene.remove(pet.group);
    this.pets = [];
  }
}

export class IslandNet {
  private peers = new Map<number, PeerFigure>();
  private sendAcc = 0;
  private body: number;
  private head: number;
  private name?: string;
  private menuOpen = false;
  private portal = ""; // mode portal I'm standing in (broadcast in my pose)
  // my own "flex" cosmetics, broadcast in each pose so peers can render them
  private flex: { pets: string[]; title: string; prestige: number; best: number; aura: number; skinId: string } =
    { pets: [], title: "", prestige: 0, best: 0, aura: 0, skinId: "" };
  /** Fired when a peer hatches an egg, so main can play the lobby celebration at
   *  their position. (x,z) = peer's current spot; rarity 0..6; shiny flag. */
  onHatch?: (x: number, z: number, rarity: number, shiny: boolean, petId: string) => void;
  /** Fired when the co-op gather leader broadcasts a room to join. */
  onPortalStart?: (portal: string, code: string) => void;

  constructor(private net: NetClient, private scene: THREE.Scene, body: number, head = 0xfff4d6, name?: string) {
    this.body = body;
    this.head = head;
    this.name = name;
    net.onPeerJoin = (id) => this.ensurePeer(id);
    net.onPeerLeave = (id) => this.removePeer(id);
    net.onMessage = (from, msg) => this.onMessage(from, msg);
    // peers already present when we joined start as a default look until their
    // first presence message tells us their real skin/name.
    for (const id of net.peers) this.ensurePeer(id);
  }

  /** Number of OTHER players currently on this island instance. */
  get peerCount(): number {
    return this.peers.size;
  }

  /** Tell peers whether my emote/chat menu is open (drives their "…" bubble). */
  setMenuOpen(open: boolean) {
    this.menuOpen = open;
  }

  /** Broadcast an emote id to everyone (the local figure is played by main). */
  sendEmote(id: EmoteId) {
    this.net.send({ t: "emote", id });
  }

  /** Broadcast a preset quick-chat phrase to everyone. */
  sendChat(text: string) {
    this.net.send({ t: "chat", text });
  }

  /** Broadcast an egg hatch so the whole lobby sees the celebration. */
  sendHatch(petId: string, rarity: number, shiny: boolean) {
    this.net.send({ t: "hatch", pet: petId.slice(0, 24), rarity, shiny: shiny ? 1 : 0 });
  }

  /** My own id in this island instance (server-assigned). */
  get localId(): number {
    return this.net.id;
  }

  /** Set which mode portal I'm standing in (broadcast in my pose); "" = none. */
  setPortal(id: string | null) {
    this.portal = id ?? "";
  }

  /** Update my broadcast "flex" cosmetics (equipped pets, title, prestige, …). */
  setFlex(f: { pets: string[]; title: string; prestige: number; best: number; aura: number; skinId: string }) {
    this.flex = f;
  }

  /** Best-round standings for every named peer (for the lobby leaderboard). */
  standings(): { name: string; best: number }[] {
    const out: { name: string; best: number }[] = [];
    for (const f of this.peers.values()) if (f.displayName) out.push({ name: f.displayName, best: f.best });
    return out;
  }

  /** Ids of OTHER players currently standing in the given portal. */
  occupants(portalId: string): number[] {
    const ids: number[] = [];
    for (const [id, f] of this.peers) if (f.portal === portalId) ids.push(id);
    return ids;
  }

  /** Leader broadcasts the hosted room code to the portal's other occupants. */
  sendPortalStart(portal: string, code: string) {
    this.net.send({ t: "portal-start", portal, code });
  }

  /** Broadcast my pose on a fixed cadence + smooth every peer figure. */
  update(dt: number, me: { x: number; z: number; ry: number; moving: boolean }) {
    for (const f of this.peers.values()) f.update(dt);
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SEND_HZ) {
      this.sendAcc = 0;
      const msg: PresenceMsg = {
        t: "presence", x: me.x, z: me.z, ry: me.ry, moving: me.moving,
        skin: this.body, head: this.head, name: this.name, menuOpen: this.menuOpen,
        portal: this.portal || undefined,
        pets: this.flex.pets.length ? this.flex.pets : undefined,
        title: this.flex.title || undefined,
        prestige: this.flex.prestige || undefined,
        best: this.flex.best || undefined,
        aura: this.flex.aura || undefined,
        skinId: this.flex.skinId || undefined,
      };
      this.net.send(msg); // broadcast to the whole instance
    }
  }

  private ensurePeer(id: number, look: PeerLook = { body: 0x4a78d6, head: 0xfff4d6 }): PeerFigure {
    let f = this.peers.get(id);
    if (!f) {
      console.log("[island] spawn peer", id, "now have", this.peers.size + 1);
      f = new PeerFigure(this.scene, look);
      this.peers.set(id, f);
    }
    return f;
  }

  private removePeer(id: number) {
    this.peers.get(id)?.dispose();
    this.peers.delete(id);
  }

  private onMessage(from: number, msg: NetMsg) {
    if (msg.t === "presence") {
      // reject malformed coords/yaw so a hostile peer can't NaN our figures
      if (![msg.x, msg.z, msg.ry].every(Number.isFinite)) return;
      let f = this.peers.get(from);
      if (!f) {
        // first pose from a peer also tells us their look — (re)create with it
        f = new PeerFigure(this.scene, { body: msg.skin || 0x4a78d6, head: msg.head ?? 0xfff4d6, name: msg.name });
        this.peers.set(from, f);
      }
      f.setTarget(msg);
    } else if (msg.t === "emote") {
      if (VALID_EMOTES.has(msg.id)) this.peers.get(from)?.playEmote(msg.id as EmoteId);
    } else if (msg.t === "chat") {
      // only render preset phrases (defense in depth); cap length regardless
      if (typeof msg.text === "string" && VALID_CHAT.has(msg.text)) {
        this.peers.get(from)?.say(msg.text.slice(0, CHAT_MAX));
      }
    } else if (msg.t === "hatch") {
      // play the celebration over the sender's figure (validate the payload)
      const f = this.peers.get(from);
      const rarity = Math.max(0, Math.min(6, Math.floor(msg.rarity)));
      if (f && Number.isFinite(msg.rarity) && typeof msg.pet === "string") {
        this.onHatch?.(f.group.position.x, f.group.position.z, rarity, !!msg.shiny, msg.pet.slice(0, 24));
      }
    } else if (msg.t === "portal-start") {
      // a gather leader is starting a match — validate the share-code shape
      const code = typeof msg.code === "string" ? msg.code.trim().toUpperCase() : "";
      if (typeof msg.portal === "string" && /^[A-Z0-9]{3,8}$/.test(code)) {
        this.onPortalStart?.(msg.portal.slice(0, 16), code);
      }
    }
  }

  dispose() {
    for (const f of this.peers.values()) f.dispose();
    this.peers.clear();
    this.net.onPeerJoin = undefined;
    this.net.onPeerLeave = undefined;
    this.net.onMessage = undefined;
  }
}

// ---- canvas-sprite labels (cheap, mipmap-free; see feedback.ts/makeLabel) ----

/** A crisp outlined name label above a figure's head. */
export function makeLabel(name: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 30px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.8)";
  g.strokeText(name, 128, 32);
  g.fillStyle = "#ffffff";
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.scale.set(2.2, 0.55, 1);
  sprite.position.set(0, 2.2, 0);
  return sprite;
}

/** A rich nameplate: name + prestige stars on top, an earned title / best-round
 *  badge underneath — the lobby "flex" plate floating over a peer's head. */
export function makeNamePlate(name: string, title: string, prestige: number, best: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 112;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.textBaseline = "middle";
  // line 1: prestige stars (gold) + name (white)
  const stars = prestige > 0 ? "★".repeat(Math.min(5, prestige)) + (prestige > 5 ? `+${prestige - 5}` : "") : "";
  g.font = "bold 34px system-ui, sans-serif";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  const nameY = title || best ? 36 : 56;
  if (stars) {
    g.strokeText(stars, 160, 12);
    g.fillStyle = "#ffd24a";
    g.fillText(stars, 160, 12);
  }
  g.strokeText(name, 160, nameY);
  g.fillStyle = "#ffffff";
  g.fillText(name, 160, nameY);
  // line 2: title (+ best round badge)
  const sub = [title, best > 0 ? `Round ${best}` : ""].filter(Boolean).join("  ·  ");
  if (sub) {
    g.font = "bold 22px system-ui, sans-serif";
    g.lineWidth = 5;
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.strokeText(sub, 160, nameY + 32);
    g.fillStyle = "#ffe9a8";
    g.fillText(sub, 160, nameY + 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.scale.set(2.9, 1.0, 1);
  sprite.position.set(0, 2.4, 0);
  return sprite;
}

/** A rounded speech bubble sprite carrying a short preset phrase / "…". */
export function makeBubble(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 256, 128);
  // measure to size the rounded rect snugly around the text
  g.font = "bold 34px system-ui, sans-serif";
  const tw = Math.min(236, g.measureText(text).width + 36);
  const x = (256 - tw) / 2;
  const y = 12;
  const w = tw;
  const h = 76;
  const r = 22;
  g.fillStyle = "rgba(255,255,255,0.96)";
  g.strokeStyle = "rgba(0,0,0,0.28)";
  g.lineWidth = 4;
  roundRect(g, x, y, w, h, r);
  g.fill();
  g.stroke();
  // little tail at the bottom-center
  g.beginPath();
  g.moveTo(128 - 14, y + h - 2);
  g.lineTo(128, y + h + 22);
  g.lineTo(128 + 14, y + h - 2);
  g.closePath();
  g.fill();
  // the text
  g.fillStyle = "#1a1a22";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, y + h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.scale.set(2.4, 1.2, 1);
  sprite.position.set(0, 3.05, 0);
  return sprite;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Free a sprite's texture + material (canvas textures aren't pooled). */
function disposeSprite(s: THREE.Sprite) {
  const m = s.material as THREE.SpriteMaterial;
  m.map?.dispose();
  m.dispose();
}
