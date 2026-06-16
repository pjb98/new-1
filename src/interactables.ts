import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COSTS, GUMS, TRAP } from "./config";
import { COLORS, VOX, glowMaterial, voxelMaterial } from "./palette";
import { WEAPONS } from "./weapons";
import { GunStyle, buildGun } from "./gunModels";

/** Shared beveled unit cube, scaled per-mesh into chunky voxel forms. */
const BOX = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);

/** Helper: a beveled voxel box at (x,y,z) sized (w,h,d) with the given material. */
function vox(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  mat: THREE.Material,
  shadow = false,
): THREE.Mesh {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  if (shadow) m.castShadow = true;
  return m;
}

/** What an interactable needs from the game to do its thing. Avoids a circular import. */
export interface GameApi {
  readonly points: number;
  spend(amount: number): boolean;
  giveWeapon(id: string): void;
  randomBoxWeapon(): string;
  grantPerk(perk: "tough" | "quick"): void;
  hasPerk(perk: "tough" | "quick"): boolean;
  /** Pack-a-Punch the currently equipped weapon. */
  upgradeCurrentWeapon(): void;
  /** Live Pack-a-Punch state for the equipped weapon: the next tier's cost (or
   *  null if fully upgraded) plus the current tier, so the station prompt reads
   *  the real escalating price. */
  papInfo(): { cost: number | null; tier: number };
  /** Dispense a random Gobblegum power-up. */
  giveRandomGum(): void;
  /** Arm a map trap: register a lethal hazard zone main runs for TRAP.duration.
   *  Spends the cost; returns false (no charge) if unaffordable. */
  triggerTrap(pos: THREE.Vector3, radius: number, kind: "electric" | "fire"): boolean;
  toast(msg: string): void;
}

export interface Interactable {
  pos: THREE.Vector3;
  range: number;
  /** Prompt shown when in range. `null` = nothing to show (e.g. already owned). */
  prompt(game: GameApi): { text: string; affordable: boolean } | null;
  interact(game: GameApi): void;
  update(dt: number): void;
}

class WallBuy implements Interactable {
  readonly group = new THREE.Group();
  range = 2.6;
  constructor(public pos: THREE.Vector3, private weaponId: string, private cost: number) {
    const def = WEAPONS[weaponId];
    const { x, z } = pos;
    const crateMat = voxelMaterial(VOX.crate);
    const crateDarkMat = voxelMaterial(VOX.crateDark);
    const steelMat = voxelMaterial(VOX.steelDark);
    // backing board / mounted crate
    this.group.add(vox(2.0, 1.4, 0.2, x, 1.6, z, crateMat, true));
    // crate plank frame (darker beveled trim)
    this.group.add(vox(2.0, 0.16, 0.26, x, 2.25, z, crateDarkMat));
    this.group.add(vox(2.0, 0.16, 0.26, x, 0.95, z, crateDarkMat));
    this.group.add(vox(0.16, 1.4, 0.26, x - 0.9, 1.6, z, crateDarkMat));
    this.group.add(vox(0.16, 1.4, 0.26, x + 0.9, 1.6, z, crateDarkMat));
    // pegs the rifle rests on
    this.group.add(vox(0.1, 0.1, 0.36, x - 0.5, 1.45, z + 0.2, steelMat));
    this.group.add(vox(0.1, 0.1, 0.36, x + 0.5, 1.45, z + 0.2, steelMat));
    // chunky voxel rifle: body + barrel + magazine + stock
    this.group.add(vox(1.0, 0.22, 0.22, x, 1.62, z + 0.34, steelMat, true));
    this.group.add(vox(0.62, 0.12, 0.12, x + 0.62, 1.62, z + 0.34, steelMat));
    this.group.add(vox(0.18, 0.34, 0.18, x - 0.12, 1.4, z + 0.34, voxelMaterial(VOX.toolboxDark)));
    this.group.add(vox(0.34, 0.18, 0.18, x - 0.56, 1.6, z + 0.34, crateDarkMat));
    // glowing "buyable" accent strip
    this.group.add(vox(2.0, 0.12, 0.06, x, 2.36, z + 0.12, glowMaterial(COLORS.wallBuy, 0.9)));
    this.def = def;
  }
  private def;
  prompt(game: GameApi) {
    return { text: `[E] Buy ${this.def.name} — ${this.cost}`, affordable: game.points >= this.cost };
  }
  interact(game: GameApi) {
    if (game.spend(this.cost)) {
      game.giveWeapon(this.weaponId);
      game.toast(`${this.def.name}!`);
    }
  }
  update() {}
}

/**
 * The Mystery Box as a **COD-style treasure chest**: spend points, the lid
 * springs open, weapon models tumble up and cycle faster→slower, the cycle
 * lands on one gun which rises and glows — that's the weapon you get — then the
 * lid closes. The award is decided up front; the cycling is pure showmanship.
 */
const CYCLE_STYLES: GunStyle[] = [
  "pistol", "smg", "shotgun", "cannon", "rifle", "arc", "singularity", "pyroclasm",
  "confetti", "potato", "fish", "chicken", "beejar", "bfg",
];
type ChestPhase = "idle" | "opening" | "cycling" | "reveal" | "closing";
const LID_OPEN = -2.1; // radians

const easeOutCubic = (k: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);
/** Overshoots past 1 then settles — a springy "pop". */
const easeOutBack = (k: number) => {
  const c = 2.2;
  const u = Math.max(0, Math.min(1, k)) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

class MysteryChest implements Interactable {
  readonly group = new THREE.Group();
  range = 3.3;
  private lidPivot = new THREE.Group();
  private prizeAnchor = new THREE.Group();
  private gun?: THREE.Group;
  private glow: THREE.PointLight;
  private beam: THREE.Mesh;
  private beamInner: THREE.Mesh;
  private idleMark: THREE.Group;
  private t = 0;
  private phase: ChestPhase = "idle";
  private timer = 0;
  private swapAccum = 0;
  private pop = 0; // scale-punch on each cycle swap
  private awardStyle: GunStyle = "pistol";
  private pending?: () => void;

  constructor(public pos: THREE.Vector3, private cost: number) {
    const { x, z } = pos;
    const wood = voxelMaterial(VOX.crate);
    const woodDark = voxelMaterial(VOX.crateDark);
    const gold = glowMaterial(COLORS.boxGold, 0.7);

    // BIG chunky voxel chest body (sized so it reads clearly across the plaza)
    const base = vox(2.3, 1.25, 1.6, x, 0.62, z, wood, true);
    base.receiveShadow = true;
    this.group.add(base);
    for (const dx of [-0.96, 0.96]) this.group.add(vox(0.22, 1.35, 1.72, x + dx, 0.62, z, gold)); // corner bands
    this.group.add(vox(2.34, 0.2, 1.66, x, 1.2, z, gold)); // top rim
    // horizontal plank seams across the front face for chunky wood detail
    for (const py of [0.4, 0.85]) this.group.add(vox(2.04, 0.06, 0.04, x, py, z + 0.81, woodDark));
    // gold corner feet so it sits like a real chest
    for (const dx of [-0.92, 0.92]) for (const dz of [-0.66, 0.66]) this.group.add(vox(0.26, 0.24, 0.26, x + dx, 0.12, z + dz, gold));
    this.group.add(vox(0.44, 0.5, 0.18, x, 1.0, z + 0.84, gold)); // front clasp
    this.group.add(vox(0.3, 0.32, 0.12, x, 0.92, z + 0.9, glowMaterial(COLORS.boxGold, 1.1))); // glowing padlock

    // lid on a hinge at the back-top edge (local coords inside the pivot)
    this.lidPivot.position.set(x, 1.24, z - 0.8);
    this.group.add(this.lidPivot);
    this.lidPivot.add(vox(2.3, 0.5, 1.6, 0, 0.25, 0.8, woodDark, true));
    for (const dx of [-0.96, 0.96]) this.lidPivot.add(vox(0.22, 0.56, 1.66, dx, 0.25, 0.8, gold));

    // prize hovers + rises here while cycling
    this.prizeAnchor.position.set(x, 1.5, z);
    this.group.add(this.prizeAnchor);

    // light-beam column (opacity animated; the iconic "box is open" shaft)
    // thin, soft shaft set BEHIND the prize so it frames the gun, not hides it
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.5, 4.6, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: COLORS.boxGold, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.beam.position.set(x, 3.3, z - 0.35);
    this.group.add(this.beam);
    this.beamInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.2, 4.6, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.beamInner.position.set(x, 3.3, z - 0.35);
    this.group.add(this.beamInner);

    // idle marker: a glowing gold gem bobbing above, so the box is easy to spot
    this.idleMark = new THREE.Group();
    const gem = vox(0.46, 0.46, 0.46, 0, 0, 0, glowMaterial(COLORS.boxGold, 1.4));
    gem.rotation.set(Math.PI / 4, Math.PI / 4, 0);
    this.idleMark.add(gem);
    this.idleMark.position.set(x, 2.3, z);
    this.group.add(this.idleMark);

    this.glow = new THREE.PointLight(COLORS.boxGold, 6, 12, 2);
    this.glow.position.set(x, 2.0, z + 0.4);
    this.group.add(this.glow);
  }

  prompt(game: GameApi) {
    if (this.phase !== "idle") return null;
    return { text: `[E] Mystery Box — ${this.cost}`, affordable: game.points >= this.cost };
  }

  interact(game: GameApi) {
    if (this.phase !== "idle") return;
    if (!game.spend(this.cost)) return;
    const id = game.randomBoxWeapon();
    this.awardStyle = WEAPONS[id].style;
    this.phase = "opening";
    this.timer = 0.45;
    this.pending = () => {
      game.giveWeapon(id);
      game.toast(`${WEAPONS[id].name}!`);
    };
  }

  private disposeGun() {
    // gun meshes share one geometry — only the per-mesh materials need freeing
    this.gun?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      m?.dispose?.();
    });
  }

  private showGun(style: GunStyle) {
    this.disposeGun();
    this.prizeAnchor.clear();
    this.gun = buildGun(style);
    this.prizeAnchor.add(this.gun);
    this.pop = 1; // punch the scale on swap
  }

  /** Ease the two beam shafts toward a target brightness + give them a slow swirl. */
  private setBeam(target: number, dt: number) {
    const k = Math.min(1, dt * 6);
    const m = this.beam.material as THREE.MeshBasicMaterial;
    const mi = this.beamInner.material as THREE.MeshBasicMaterial;
    m.opacity += (target - m.opacity) * k;
    mi.opacity += (target * 0.9 - mi.opacity) * k;
    this.beam.rotation.y += dt * 0.7;
    this.beamInner.rotation.y -= dt * 1.1;
  }

  /** Position/spin/scale the floating prize gun (base height + spin speed). */
  private placeGun(baseY: number, spin: number, dt: number, pulse = 0) {
    if (!this.gun) return;
    this.gun.rotation.y += spin * dt;
    this.pop = Math.max(0, this.pop - dt * 4);
    this.gun.scale.setScalar(2.1 * (1 + this.pop * 0.3 + pulse));
    this.gun.position.y = baseY + Math.sin(this.t * 5) * 0.05;
  }

  update(dt: number) {
    this.t += dt;
    this.idleMark.visible = this.phase === "idle";

    switch (this.phase) {
      case "idle": {
        this.glow.intensity = 4 + Math.sin(this.t * 2.5) * 1.2;
        this.idleMark.rotation.y += dt * 1.4;
        this.idleMark.position.y = 2.3 + Math.sin(this.t * 2) * 0.12;
        this.setBeam(0, dt);
        break;
      }

      case "opening": {
        this.timer -= dt;
        const k = 1 - Math.max(0, this.timer) / 0.5;
        this.lidPivot.rotation.x = LID_OPEN * easeOutBack(k); // springy pop open
        this.glow.intensity = 5 + k * 2;
        this.setBeam(0.1, dt);
        if (this.timer <= 0) {
          this.phase = "cycling";
          this.timer = 2.6;
          this.swapAccum = 0;
        }
        break;
      }

      case "cycling": {
        this.timer -= dt;
        const prog = 1 - Math.max(0, this.timer) / 2.6; // 0→1
        // gun rises up out of the chest into the beam as the cycle progresses
        this.placeGun(0.4 + easeOutCubic(prog) * 1.3, 6, dt);
        this.setBeam(0.13, dt);
        this.glow.intensity = 5 + Math.sin(this.t * 8) * 1.5;
        this.swapAccum -= dt;
        if (this.swapAccum <= 0) {
          this.showGun(CYCLE_STYLES[Math.floor(Math.random() * CYCLE_STYLES.length)]);
          // each gun is clearly visible (~0.16s) then decelerates to ~0.55s
          this.swapAccum = 0.16 + prog * prog * 0.4;
        }
        if (this.timer <= 0) {
          this.phase = "reveal";
          this.timer = 1.5;
          this.showGun(this.awardStyle); // land on the actual prize
        }
        break;
      }

      case "reveal": {
        this.timer -= dt;
        const rk = easeOutCubic(1 - Math.max(0, this.timer) / 1.5);
        // rises a touch higher, spins slow + grand, throbbing scale
        this.placeGun(1.7 + rk * 0.35, 2.5, dt, Math.sin(this.t * 6) * 0.1);
        this.setBeam(0.24, dt);
        this.glow.intensity = 7 + Math.sin(this.t * 12) * 2.5;
        if (this.timer <= 0) {
          this.pending?.(); // hand over the weapon
          this.pending = undefined;
          this.phase = "closing";
          this.timer = 0.45;
        }
        break;
      }

      case "closing": {
        this.timer -= dt;
        const k = Math.max(0, this.timer) / 0.45;
        this.lidPivot.rotation.x = LID_OPEN * k;
        // prize sinks back down + shrinks away as the lid shuts
        if (this.gun) {
          this.gun.position.y = 1.7 * k - (1 - k) * 0.6;
          this.gun.scale.setScalar(2.1 * k);
        }
        this.setBeam(0, dt);
        this.glow.intensity = 4 + k * 4;
        if (this.timer <= 0) {
          this.lidPivot.rotation.x = 0;
          this.disposeGun();
          this.prizeAnchor.clear();
          this.gun = undefined;
          this.phase = "idle";
        }
        break;
      }
    }
  }
}

/**
 * Pack-a-Punch machine: upgrades the player's current weapon in place.
 */
class PackAPunch implements Interactable {
  readonly group = new THREE.Group();
  range = 2.6;
  private ring: THREE.Mesh;
  private t = 0;
  constructor(public pos: THREE.Vector3) {
    const { x, z } = pos;
    const steelMat = voxelMaterial(VOX.steel);
    const steelDarkMat = voxelMaterial(VOX.steelDark);
    const arcane = 0x6ad7ff; // the signature Pack-a-Punch energy hue
    // ---- a heavy arcane workshop machine ----
    // weighted plinth + main chassis
    this.group.add(vox(2.1, 0.4, 1.5, x, 0.2, z, steelDarkMat, true));
    this.group.add(vox(1.9, 2.2, 1.3, x, 1.45, z, steelDarkMat, true));
    // bevelled steel face plate + bolted side ribs
    this.group.add(vox(1.45, 1.7, 0.16, x, 1.55, z + 0.66, steelMat));
    for (const dx of [-0.96, 0.96]) this.group.add(vox(0.2, 2.2, 1.34, x + dx, 1.45, z, steelMat));
    // a glowing arcane sigil inset on the face (cross of energy bars)
    this.group.add(vox(0.9, 0.18, 0.1, x, 1.7, z + 0.75, glowMaterial(arcane, 1.3)));
    this.group.add(vox(0.18, 1.0, 0.1, x, 1.7, z + 0.75, glowMaterial(arcane, 1.3)));
    // the iconic glowing INTAKE slot (where the gun goes in)
    this.group.add(vox(1.4, 0.34, 0.24, x, 0.95, z + 0.66, glowMaterial(arcane, 1.5)));
    // energy coil pillars up the corners + glowing caps
    for (const dx of [-0.84, 0.84]) {
      this.group.add(vox(0.16, 2.4, 0.16, x + dx, 1.45, z + 0.5, steelMat));
      this.group.add(vox(0.28, 0.28, 0.28, x + dx, 2.72, z + 0.5, glowMaterial(arcane, 1.4)));
    }
    // crowned top: a stepped header + a floating power gem
    this.group.add(vox(2.0, 0.4, 1.0, x, 2.75, z, steelMat, true));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), glowMaterial(COLORS.boxGold, 1.5));
    gem.position.set(x, 3.3, z);
    gem.rotation.set(Math.PI / 5, 0, Math.PI / 5);
    this.group.add(gem);
    // hovering halo ring above (glow accent the bloom catches; animated)
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 28), glowMaterial(arcane, 1.5));
    this.ring.position.set(x, 3.3, z);
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);
    const light = new THREE.PointLight(arcane, 6, 9, 2);
    light.position.set(x, 2.2, z + 0.6);
    this.group.add(light);
  }
  prompt(game: GameApi) {
    const info = game.papInfo();
    if (info.cost === null) {
      return { text: "Pack-a-Punch — MAXED (+++)", affordable: true };
    }
    const tag = ["I", "II", "III"][info.tier] ?? "";
    return { text: `[E] Pack-a-Punch ${tag} — ${info.cost}`, affordable: game.points >= info.cost };
  }
  interact(game: GameApi) {
    game.upgradeCurrentWeapon();
  }
  update(dt: number) {
    this.t += dt;
    this.ring.rotation.z = this.t * 1.4;
    this.ring.position.y = 2.5 + Math.sin(this.t * 2.2) * 0.07;
  }
}

/**
 * Bubblegum machine — a gumball globe that dispenses a random COD-style
 * power-up (Double Points, Insta-Kill, Rapid Fire, Sugar Rush, Full Pockets).
 */
class Bubblegum implements Interactable {
  readonly group = new THREE.Group();
  range = 2.5;
  private globe: THREE.Mesh;
  private t = 0;
  constructor(public pos: THREE.Vector3, private cost: number) {
    const { x, z } = pos;
    const red = voxelMaterial(0xd6463f);
    const redDark = voxelMaterial(0x9e302b);
    const chrome = voxelMaterial(VOX.steel);
    // local helper: a positioned cylinder added to the group (group.add returns
    // the GROUP, not the child — so we must position before adding).
    const cyl = (rt: number, rb: number, h: number, yy: number, mat: THREE.Material, zz = z) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 16), mat);
      m.position.set(x, yy, zz); m.castShadow = true; this.group.add(m); return m;
    };
    // ---- a classic GUMBALL MACHINE: red base + chrome neck + glass globe ----
    cyl(0.78, 0.92, 0.7, 0.35, redDark);   // weighted base
    cyl(0.66, 0.78, 0.7, 0.95, red);       // body
    cyl(0.6, 0.6, 0.18, 1.32, chrome);     // chrome collar under the globe
    cyl(0.12, 0.12, 0.1, 0.95, chrome, z + 0.62); // coin knob
    this.group.add(vox(0.42, 0.3, 0.12, x, 0.6, z + 0.6, redDark)); // dispense door
    // the GLASS GLOBE (transparent sphere) full of colored gumballs
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(0.92, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, depthWrite: false }),
    );
    glass.position.set(x, 2.05, z);
    this.group.add(glass);
    const ballGeo = new THREE.SphereGeometry(0.17, 8, 6);
    let seed = Math.floor(Math.abs(x * 53 + z * 131)) + 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 16; i++) {
      const c = GUMS[i % GUMS.length].color;
      const ball = new THREE.Mesh(ballGeo, glowMaterial(c, 0.45));
      const a = rnd() * Math.PI * 2, rr = rnd() * 0.6; // pack into the lower globe
      ball.position.set(x + Math.cos(a) * rr, 1.78 + rnd() * 0.5, z + Math.sin(a) * rr);
      this.group.add(ball);
    }
    cyl(0.34, 0.42, 0.2, 2.95, chrome);    // chrome crown
    // a spinning gumball finial on top (animated by update)
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glowMaterial(GUMS[0].color, 1.2));
    this.globe.position.set(x, 3.2, z);
    this.group.add(this.globe);
    const light = new THREE.PointLight(0xff7ab0, 3.2, 7, 2);
    light.position.set(x, 2.1, z + 0.5);
    this.group.add(light);
  }
  prompt(game: GameApi) {
    return { text: `[E] Bubblegum — ${this.cost}`, affordable: game.points >= this.cost };
  }
  interact(game: GameApi) {
    if (game.spend(this.cost)) game.giveRandomGum();
  }
  update(dt: number) {
    this.t += dt;
    this.globe.rotation.y = this.t * 0.8;
    this.globe.position.y = 1.95 + Math.sin(this.t * 2) * 0.05;
  }
}

/**
 * A buyable map spot: a rubble pile you clear with points to "unlock" the area,
 * which reveals a wall-buy weapon stall behind it. Two-phase interactable.
 */
class DebrisGate implements Interactable {
  readonly group = new THREE.Group();
  range = 2.7;
  private rubble = new THREE.Group();
  private stall = new THREE.Group();
  private cleared = false;
  constructor(
    public pos: THREE.Vector3,
    private clearCost: number,
    private weaponId: string,
    private buyCost: number,
  ) {
    const { x, z } = pos;
    // voxel rubble pile (beveled rock voxels) — blocks the spot until cleared
    for (let i = 0; i < 9; i++) {
      const s = 0.5 + Math.random() * 0.5;
      const rock = vox(
        s, s, s,
        x + (Math.random() - 0.5) * 1.6,
        0.2 + Math.random() * 0.7,
        z + (Math.random() - 0.5) * 1.0,
        voxelMaterial(i % 2 ? VOX.rock : VOX.rockDark),
        true,
      );
      rock.rotation.set(Math.random() * 0.4, Math.random(), Math.random() * 0.4);
      this.rubble.add(rock);
    }
    // glowing hazard-tape accent
    const tape = vox(2.2, 0.14, 0.06, x, 1.0, z + 0.2, glowMaterial(VOX.emberHot, 0.9));
    tape.rotation.z = -0.12;
    this.rubble.add(tape);
    this.group.add(this.rubble);

    // hidden voxel weapon stall/crate revealed after clearing
    const def = WEAPONS[weaponId];
    const crateMat = voxelMaterial(VOX.crate);
    const crateDarkMat = voxelMaterial(VOX.crateDark);
    const steelMat = voxelMaterial(VOX.steelDark);
    this.stall.add(vox(2.0, 1.4, 0.2, x, 1.6, z, crateMat, true));
    this.stall.add(vox(2.0, 0.16, 0.26, x, 2.25, z, crateDarkMat));
    this.stall.add(vox(2.0, 0.16, 0.26, x, 0.95, z, crateDarkMat));
    // chunky voxel rifle on the stall
    this.stall.add(vox(1.0, 0.22, 0.22, x, 1.62, z + 0.32, steelMat, true));
    this.stall.add(vox(0.6, 0.12, 0.12, x + 0.6, 1.62, z + 0.32, steelMat));
    this.stall.add(vox(0.18, 0.34, 0.18, x - 0.12, 1.4, z + 0.32, voxelMaterial(VOX.toolboxDark)));
    this.stall.add(vox(2.0, 0.12, 0.06, x, 2.36, z + 0.12, glowMaterial(COLORS.wallBuy, 0.9)));
    this.stall.visible = false;
    this.group.add(this.stall);
    this.def = def;
  }
  private def;
  prompt(game: GameApi) {
    if (!this.cleared) {
      return { text: `[E] Clear rubble — ${this.clearCost}`, affordable: game.points >= this.clearCost };
    }
    return { text: `[E] Buy ${this.def.name} — ${this.buyCost}`, affordable: game.points >= this.buyCost };
  }
  interact(game: GameApi) {
    if (!this.cleared) {
      if (game.spend(this.clearCost)) {
        this.cleared = true;
        this.rubble.visible = false;
        this.stall.visible = true;
        game.toast("Area unlocked!");
      }
    } else if (game.spend(this.buyCost)) {
      game.giveWeapon(this.weaponId);
      game.toast(`${this.def.name}!`);
    }
  }
  update() {}
}

class PerkPad implements Interactable {
  readonly group = new THREE.Group();
  range = 2.4;
  private ring: THREE.Mesh;
  private t = 0;
  constructor(
    public pos: THREE.Vector3,
    private perk: "tough" | "quick",
    private cost: number,
    private label: string,
    color: number,
  ) {
    const { x, z } = pos;
    const steelDark = voxelMaterial(VOX.steelDark);
    const shell = voxelMaterial(color);
    // ---- a chunky PERK VENDING MACHINE in the perk's signature color ----
    // footing pad + dark base
    this.group.add(vox(1.9, 0.3, 1.5, x, 0.15, z, steelDark));
    this.group.add(vox(1.55, 0.45, 1.25, x, 0.45, z, steelDark, true));
    // tall coloured cabinet
    this.group.add(vox(1.5, 2.5, 1.2, x, 1.85, z, shell, true));
    // side trims (darker) so the body reads as panelled
    for (const dx of [-0.78, 0.78]) this.group.add(vox(0.08, 2.5, 1.24, x + dx, 1.85, z, steelDark));
    // glowing display window with a bottle silhouette inside
    this.group.add(vox(1.05, 1.4, 0.1, x, 2.0, z + 0.62, glowMaterial(color, 0.55)));
    this.group.add(vox(0.34, 0.8, 0.14, x, 1.95, z + 0.66, glowMaterial(0xfff4e0, 0.9))); // bottle body
    this.group.add(vox(0.16, 0.28, 0.14, x, 2.5, z + 0.66, glowMaterial(0xfff4e0, 0.9)));  // bottle neck
    // lit marquee sign on top
    this.group.add(vox(1.7, 0.5, 1.0, x, 3.25, z, steelDark, true));
    this.group.add(vox(1.5, 0.34, 0.12, x, 3.27, z + 0.5, glowMaterial(color, 1.2)));
    // dispense tray + coin slot
    this.group.add(vox(0.9, 0.26, 0.2, x, 0.95, z + 0.62, steelDark));
    this.group.add(vox(0.2, 0.1, 0.1, x + 0.55, 2.2, z + 0.62, glowMaterial(0xffe27a, 1.0)));
    // a glowing service ring hovering above (kept for the idle animation)
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.08, 8, 24), glowMaterial(color, 1.3));
    this.ring.position.set(x, 3.8, z);
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);
    const light = new THREE.PointLight(color, 4, 8, 2);
    light.position.set(x, 2.2, z + 0.6);
    this.group.add(light);
  }
  prompt(game: GameApi) {
    if (game.hasPerk(this.perk)) return null;
    return { text: `[E] ${this.label} — ${this.cost}`, affordable: game.points >= this.cost };
  }
  interact(game: GameApi) {
    if (game.hasPerk(this.perk)) return;
    if (game.spend(this.cost)) {
      game.grantPerk(this.perk);
      game.toast(`${this.label} acquired!`);
    }
  }
  update(dt: number) {
    this.t += dt;
    this.ring.rotation.z = this.t * 1.5;
    this.ring.position.y = 1.4 + Math.sin(this.t * 2.4) * 0.06;
  }
}

/**
 * A lurable map trap: an electrified / flame pad you pay to arm. While armed it
 * fries every zombie standing in its zone (main applies the damage via the
 * active-trap list registered by game.triggerTrap). Self-manages a duration +
 * recharge and a glow that reads ready / ACTIVE / recharging.
 */
class Trap implements Interactable {
  readonly group = new THREE.Group();
  range = 2.8;
  private t = 0;
  private armed = 0; // seconds of lethal time remaining
  private cooling = 0; // seconds of recharge remaining
  private pad: THREE.Mesh;
  private coils: THREE.Mesh[] = [];
  private label: string;

  constructor(public pos: THREE.Vector3, private kind: "electric" | "fire") {
    const { x, z } = pos;
    const color = kind === "electric" ? 0x6ad7ff : 0xff6a1f;
    this.label = kind === "electric" ? "Tesla" : "Flame";
    const baseMat = voxelMaterial(VOX.steelDark);
    // sunken hazard pad (its own glow material instance so we can animate it)
    this.pad = new THREE.Mesh(BOX, glowMaterial(color, 0.35));
    this.pad.scale.set(TRAP.radius * 1.2, 0.12, TRAP.radius * 1.2);
    this.pad.position.set(x, 0.06, z);
    this.group.add(this.pad);
    // corner emitters: tesla coils / flame vents
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const px = x + ox * TRAP.radius * 0.5;
      const pz = z + oz * TRAP.radius * 0.5;
      this.group.add(vox(0.3, 0.6, 0.3, px, 0.4, pz, baseMat, true));
      const cap = new THREE.Mesh(BOX, glowMaterial(color, 1.4));
      cap.scale.set(0.36, 0.18, 0.36);
      cap.position.set(px, 0.82, pz);
      this.group.add(cap);
      this.coils.push(cap);
    }
  }

  prompt(game: GameApi) {
    if (this.armed > 0) return { text: `${this.label} Trap — ACTIVE`, affordable: false };
    if (this.cooling > 0) return { text: `${this.label} Trap — recharging…`, affordable: false };
    return { text: `[E] ${this.label} Trap — ${COSTS.trap}`, affordable: game.points >= COSTS.trap };
  }

  interact(game: GameApi) {
    if (this.armed > 0 || this.cooling > 0) return;
    if (game.triggerTrap(this.pos, TRAP.radius, this.kind)) this.armed = TRAP.duration;
  }

  update(dt: number) {
    this.t += dt;
    if (this.armed > 0) {
      this.armed -= dt;
      // crackle: bob + flicker the emitters while live
      for (let i = 0; i < this.coils.length; i++) {
        const c = this.coils[i];
        c.position.y = 0.82 + Math.sin(this.t * 16 + i) * 0.08;
        c.visible = Math.sin(this.t * 30 + i * 1.7) > -0.6;
      }
      this.pad.scale.y = 0.12 + Math.abs(Math.sin(this.t * 10)) * 0.05;
      if (this.armed <= 0) this.cooling = TRAP.cooldown;
    } else {
      if (this.cooling > 0) this.cooling -= dt;
      const ready = this.cooling <= 0;
      for (const c of this.coils) {
        c.visible = true;
        c.position.y = 0.82 + (ready ? Math.sin(this.t * 2) * 0.03 : -0.18);
      }
      this.pad.scale.y = ready ? 0.12 : 0.05;
    }
  }
}

/** Builds and manages all the buyable things in the arena. */
export class Interactables {
  readonly list: Interactable[] = [];
  private groups: THREE.Group[] = [];

  /** Hide/show every map prop (perk pads, gum, mystery box, traps, …). Used to
   *  keep the zombie-map fixtures out of the island hub, which shares world coords. */
  setVisible(on: boolean) {
    for (const g of this.groups) g.visible = on;
  }

  constructor(scene: THREE.Scene, half: number) {
    const items: { i: Interactable; group: THREE.Group }[] = [];

    const wall = new WallBuy(new THREE.Vector3(0, 0, -half + 1.5), "buzzgun", COSTS.wallBuy);
    const wheel = new MysteryChest(new THREE.Vector3(half - 6, 0, half - 6), COSTS.mysteryBox);
    const pap = new PackAPunch(new THREE.Vector3(-half + 6, 0, half - 6));
    const gum = new Bubblegum(new THREE.Vector3(5, 0, 9), COSTS.gobblegum);
    const tough = new PerkPad(
      new THREE.Vector3(-half + 6, 0, -half + 6), "tough", COSTS.perkTough, "Tough (+HP)", COLORS.perkTough,
    );
    const quick = new PerkPad(
      new THREE.Vector3(half - 6, 0, -half + 6), "quick", COSTS.perkQuick, "Quick (speed+reload)", COLORS.perkQuick,
    );
    // buyable map spots: clear rubble to reveal a wall-buy weapon stall
    const gateW = new DebrisGate(new THREE.Vector3(-half + 3, 0, 0), COSTS.debris, "boomstick", COSTS.wallBuy + 500);
    const gateE = new DebrisGate(new THREE.Vector3(half - 3, 0, 0), COSTS.debris, "marksman", COSTS.wallBuy + 1500);
    // lurable map traps: herd the horde onto the pad and zap/ignite it
    const trapN = new Trap(new THREE.Vector3(0, 0, half - 7), "electric");
    const trapS = new Trap(new THREE.Vector3(0, 0, -half + 8), "fire");

    items.push({ i: wall, group: wall.group });
    items.push({ i: wheel, group: wheel.group });
    items.push({ i: pap, group: pap.group });
    items.push({ i: gum, group: gum.group });
    items.push({ i: tough, group: tough.group });
    items.push({ i: quick, group: quick.group });
    items.push({ i: gateW, group: gateW.group });
    items.push({ i: gateE, group: gateE.group });
    items.push({ i: trapN, group: trapN.group });
    items.push({ i: trapS, group: trapS.group });

    for (const { i, group } of items) {
      this.list.push(i);
      this.groups.push(group);
      scene.add(group);
    }
  }

  update(dt: number) {
    for (const i of this.list) i.update(dt);
  }

  /** Nearest interactable within its range of `pos`, or null. */
  nearest(pos: THREE.Vector3): Interactable | null {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const i of this.list) {
      const dx = i.pos.x - pos.x;
      const dz = i.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < i.range * i.range && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }
}
