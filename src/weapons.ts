import * as THREE from "three";
import { COLORS, glowMaterial } from "./palette";
import { GunStyle } from "./gunModels";

export interface WeaponDef {
  id: string;
  name: string;
  /** Held-model + Mystery Chest look. */
  style: GunStyle;
  damage: number;
  /** Shots per second. */
  fireRate: number;
  magSize: number;
  /** Reserve ammo; Infinity for the starter pistol. */
  reserve: number;
  /** Projectiles per shot (shotgun > 1). */
  pellets: number;
  /** Half-angle spread in radians. */
  spread: number;
  bulletSpeed: number;
  /** Hold-to-fire vs click-per-shot. */
  auto: boolean;
  reloadTime: number;
  // ---- wonder-weapon extras (all optional) ----
  /** Zombies a single shot can punch through before dying. */
  pierce?: number;
  /** AoE applied at each impact point. */
  splashRadius?: number;
  splashDamage?: number;
  /** Tracer tint + size. */
  bulletColor?: number;
  bulletScale?: number;
  /** Flagged for HUD / box flavor. */
  wonder?: boolean;
  // ---- wacky-gun behaviors (optional) ----
  knockback?: number; // extra shove on hit
  homing?: number; // 0/1: bullets curve to enemies
  bounces?: number; // ricochets to another enemy after a hit
  rainbow?: boolean; // randomize each projectile's color (confetti!)
}

/** Per-shot modifiers from the player's run upgrades, applied at fire time. */
export interface FireMods {
  fireRateMul?: number;
  bonusPellets?: number;
  pierceBonus?: number;
  scaleMul?: number;
  homing?: number;
  bounces?: number;
}

const RAINBOW = [0xff6f91, 0x6ad7ff, 0xffd24a, 0x8fcf6f, 0xc792ea, 0xff9f43, 0x4ec9ff, 0xff5d8f];

export const WEAPONS: Record<string, WeaponDef> = {
  peashooter: {
    id: "peashooter", name: "Peashooter", style: "pistol", damage: 28, fireRate: 4,
    magSize: 12, reserve: Infinity, pellets: 1, spread: 0.01,
    bulletSpeed: 60, auto: false, reloadTime: 1.1,
    bulletColor: 0xffe28a, bulletScale: 1,
  },
  buzzgun: {
    id: "buzzgun", name: "Buzzgun", style: "smg", damage: 22, fireRate: 11,
    magSize: 32, reserve: 256, pellets: 1, spread: 0.05,
    bulletSpeed: 64, auto: true, reloadTime: 1.6,
    bulletColor: 0xfff1b0, bulletScale: 0.8,
  },
  scattershot: {
    id: "scattershot", name: "Scattershot", style: "shotgun", damage: 18, fireRate: 1.4,
    magSize: 6, reserve: 48, pellets: 8, spread: 0.22,
    bulletSpeed: 52, auto: false, reloadTime: 2.2,
    bulletColor: 0xffc06a, bulletScale: 0.85,
  },
  boomstick: {
    id: "boomstick", name: "Boomstick", style: "cannon", damage: 90, fireRate: 2.2,
    magSize: 8, reserve: 64, pellets: 1, spread: 0.015,
    bulletSpeed: 70, auto: false, reloadTime: 1.5,
    bulletColor: 0xffa23a, bulletScale: 1.5,
  },
  marksman: {
    id: "marksman", name: "Marksman", style: "rifle", damage: 140, fireRate: 1.1,
    magSize: 5, reserve: 40, pellets: 1, spread: 0.0,
    bulletSpeed: 90, auto: false, reloadTime: 1.8,
    bulletColor: 0x9fe8ff, bulletScale: 1.1,
  },

  // ---- wonder weapons: rare, spectacular, but finite ammo so they can't
  // carry you to round 100 on their own. ----
  arc: {
    id: "arc", name: "Arc Cannon", style: "arc", damage: 110, fireRate: 6,
    magSize: 40, reserve: 240, pellets: 1, spread: 0.03,
    bulletSpeed: 82, auto: true, reloadTime: 1.8,
    pierce: 6, splashRadius: 2.2, splashDamage: 55,
    bulletColor: 0x6ad7ff, bulletScale: 1.4, wonder: true,
  },
  singularity: {
    id: "singularity", name: "Singularity", style: "singularity", damage: 180, fireRate: 1.4,
    magSize: 5, reserve: 30, pellets: 1, spread: 0.0,
    bulletSpeed: 44, auto: false, reloadTime: 2.4,
    splashRadius: 4.6, splashDamage: 240,
    bulletColor: 0xc792ea, bulletScale: 2.2, wonder: true,
  },
  pyroclasm: {
    id: "pyroclasm", name: "Pyroclasm", style: "pyroclasm", damage: 55, fireRate: 9,
    magSize: 64, reserve: 384, pellets: 1, spread: 0.06,
    bulletSpeed: 64, auto: true, reloadTime: 2.0,
    pierce: 1, splashRadius: 1.8, splashDamage: 42,
    bulletColor: 0xff7a3a, bulletScale: 1.3, wonder: true,
  },

  // ---- wacky / funny guns ----
  confetti: {
    id: "confetti", name: "Confetti Cannon", style: "confetti", damage: 12, fireRate: 3,
    magSize: 18, reserve: 180, pellets: 14, spread: 0.34,
    bulletSpeed: 46, auto: false, reloadTime: 1.8,
    bulletScale: 0.7, knockback: 2, rainbow: true,
  },
  spud: {
    id: "spud", name: "Spud-o-Matic", style: "potato", damage: 24, fireRate: 9,
    magSize: 40, reserve: 280, pellets: 1, spread: 0.08,
    bulletSpeed: 50, auto: true, reloadTime: 1.7,
    bulletColor: 0xc9a05a, bulletScale: 1.1, knockback: 2,
  },
  fishslap: {
    id: "fishslap", name: "Fish Slapper", style: "fish", damage: 72, fireRate: 2.4,
    magSize: 10, reserve: 80, pellets: 1, spread: 0.02,
    bulletSpeed: 42, auto: false, reloadTime: 1.4,
    bulletColor: 0x9fd0e0, bulletScale: 1.6, knockback: 16,
  },
  chicken: {
    id: "chicken", name: "Rubber Chicken", style: "chicken", damage: 40, fireRate: 1.6,
    magSize: 6, reserve: 48, pellets: 1, spread: 0.02,
    bulletSpeed: 34, auto: false, reloadTime: 2.0,
    splashRadius: 2.6, splashDamage: 50, bulletColor: 0xffe14a, bulletScale: 1.5, knockback: 9,
  },
  beejar: {
    id: "beejar", name: "Bee Swarm Jar", style: "beejar", damage: 7, fireRate: 7,
    magSize: 60, reserve: 300, pellets: 3, spread: 0.5,
    bulletSpeed: 30, auto: true, reloadTime: 2.2,
    pierce: 3, homing: 1, bulletColor: 0xffd24a, bulletScale: 0.5,
  },
  quacker: {
    id: "quacker", name: "The Quacker", style: "bfg", damage: 220, fireRate: 0.8,
    magSize: 2, reserve: 14, pellets: 1, spread: 0,
    bulletSpeed: 30, auto: false, reloadTime: 3.0,
    pierce: 99, splashRadius: 5.5, splashDamage: 300, knockback: 22,
    bulletColor: 0x8fcf6f, bulletScale: 3.0, wonder: true,
  },

  // ---- variety weapons (reuse existing bullet behaviors: pierce/bounce/homing/
  // splash — no new bullet engine). Tuned to sit inside the existing envelope. ----
  // Railspike: a precision line-piercer. One fast, dead-accurate slug that punches
  // through a whole column of zombies. Marksman-class single-target with crowd
  // reach via pierce, paid for with a small mag + slow fire.
  railspike: {
    id: "railspike", name: "Railspike", style: "rail", damage: 150, fireRate: 1.2,
    magSize: 6, reserve: 48, pellets: 1, spread: 0.0,
    bulletSpeed: 120, auto: false, reloadTime: 1.9,
    pierce: 8, bulletColor: 0x7fe6ff, bulletScale: 1.1, wonder: true,
  },
  // Boomeranger: a returning-blade thrower. The projectile ricochets between
  // nearby enemies (bounces) so a single throw clears a knot, and shoves on hit.
  // Mid damage, slow-ish, generous reserve — a satisfying crowd tool, not a DPS king.
  boomeranger: {
    id: "boomeranger", name: "Boomeranger", style: "boomerang", damage: 58, fireRate: 1.8,
    magSize: 8, reserve: 72, pellets: 1, spread: 0.03,
    bulletSpeed: 46, auto: false, reloadTime: 1.7,
    bounces: 4, knockback: 6, bulletColor: 0xd9a23a, bulletScale: 1.1,
  },
  // Tesla Coil: a chain-lightning auto. Light, fast bolts that home onto enemies
  // and arc to a couple more on contact — low per-hit damage that adds up against
  // packs. The chain (homing + bounces) is the identity; mag/reserve keep it honest.
  teslacoil: {
    id: "teslacoil", name: "Tesla Coil", style: "tesla", damage: 18, fireRate: 8,
    magSize: 36, reserve: 240, pellets: 1, spread: 0.04,
    bulletSpeed: 70, auto: true, reloadTime: 1.8,
    homing: 1, bounces: 2, bulletColor: 0x6ad7ff, bulletScale: 0.7,
  },
};

/** Look up a weapon's gun style by display name (handles the "X +" PaP variant). */
const NAME_STYLE = new Map<string, GunStyle>();
const NAME_SPREAD = new Map<string, { spread: number; pellets: number }>();
for (const d of Object.values(WEAPONS)) {
  NAME_STYLE.set(d.name, d.style);
  NAME_SPREAD.set(d.name, { spread: d.spread, pellets: d.pellets });
}
export function styleForWeaponName(name: string): GunStyle {
  return NAME_STYLE.get(name) ?? NAME_STYLE.get(name.replace(/ \+$/, "")) ?? "pistol";
}
/** Spread + pellet count by display name (for the aim guide on the guest path). */
export function spreadForWeaponName(name: string): { spread: number; pellets: number } {
  return NAME_SPREAD.get(name) ?? NAME_SPREAD.get(name.replace(/ \+$/, "")) ?? { spread: 0.05, pellets: 1 };
}

/** Normal weapons the Mystery Box can hand out (incl. the cheaper wacky ones). */
export const BOX_POOL = ["buzzgun", "scattershot", "boomstick", "marksman", "confetti", "spud", "fishslap", "chicken", "beejar", "boomeranger", "teslacoil"];
/** The crazy ones — rolled rarely by the box. */
export const WONDER_POOL = ["arc", "singularity", "pyroclasm", "quacker", "railspike"];

export interface SpawnOpts {
  speed: number;
  damage: number;
  pierce: number;
  splashRadius: number;
  splashDamage: number;
  color: number;
  scale: number;
  homing?: number; // 0/1: steer toward enemies
  bounces?: number; // ricochets remaining
  knockback?: number; // extra shove force on hit
  fromPet?: boolean; // true = a pet's bullet (so kills don't feed the player rampage)
}

export interface Bullet {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  alive: boolean;
  pierce: number;
  splashRadius: number;
  splashDamage: number;
  homing: number;
  bounces: number;
  knockback: number;
  fromPet: boolean; // pet-fired (excluded from the player rampage meter)
  /** Zombie ids already struck (so a piercing round won't re-hit one). */
  hit: Set<number>;
}

const _UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _base = new THREE.Vector3();
const _dd = new THREE.Vector3();

/** Spawns, moves, recycles bullet meshes. Collision is resolved by the caller. */
export class BulletSystem {
  readonly bullets: Bullet[] = [];
  private pool: Bullet[] = [];
  // A stretched capsule reads as a whizzing tracer once aligned to velocity.
  private geo = new THREE.CapsuleGeometry(0.07, 0.5, 4, 8);
  // Persistent container: every bullet mesh is parented here ONCE (the first
  // time it's created in spawn()), so activating/retiring a tracer just toggles
  // `mesh.visible` instead of scene.add/remove every shot. That avoids
  // scene-graph churn during the exact moment FPS matters (the horde).
  private container = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.container);
  }

  /** Hard cap on live tracers — bounds the O(bullets×zombies) collision pass
   *  AND the per-frame render/homing load. Lowered on mobile. */
  maxLive = 140;

  spawn(origin: THREE.Vector3, dir: THREE.Vector3, opts: SpawnOpts) {
    // Cap live bullets: retire the oldest so collision cost stays bounded even
    // with stacked fire-rate + multishot + pellet weapons.
    if (this.bullets.length >= this.maxLive) {
      const oldest = this.bullets.find((x) => x.alive);
      if (oldest) this.retire(oldest);
    }
    let b = this.pool.pop();
    if (!b) {
      const mesh = new THREE.Mesh(this.geo, glowMaterial(opts.color, 1.8));
      mesh.castShadow = false;
      mesh.visible = false; // parented once below, shown when activated
      this.container.add(mesh);
      b = {
        mesh, vel: new THREE.Vector3(), life: 0, damage: 0, alive: false,
        pierce: 0, splashRadius: 0, splashDamage: 0, homing: 0, bounces: 0, knockback: 0, fromPet: false,
        hit: new Set<number>(),
      };
    }
    const mat = b.mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(opts.color);
    mat.emissive.set(opts.color);

    b.mesh.position.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(opts.speed);
    b.life = 1.3;
    b.damage = opts.damage;
    b.pierce = opts.pierce;
    b.splashRadius = opts.splashRadius;
    b.splashDamage = opts.splashDamage;
    b.homing = opts.homing ?? 0;
    b.bounces = opts.bounces ?? 0;
    b.knockback = opts.knockback ?? 0;
    b.fromPet = opts.fromPet ?? false;
    b.hit.clear();
    b.alive = true;
    b.mesh.visible = true;
    b.mesh.scale.set(opts.scale, opts.scale * 1.4, opts.scale);
    // Orient the capsule's long (Y) axis along the flight direction.
    b.mesh.quaternion.setFromUnitVectors(_UP, _dir.copy(b.vel).normalize());
    // Already parented to the container — visibility toggle is the activation.
    this.bullets.push(b);
  }

  retire(b: Bullet) {
    if (!b.alive) return;
    b.alive = false;
    b.mesh.visible = false; // stays parented to the container; just hidden
    // NOTE: do NOT pool here. The bullet is still in `this.bullets` until the
    // splice in update(); pooling now would let spawn() re-pop it and push a
    // duplicate reference into `bullets` (array grows unbounded → FPS death).
  }

  update(dt: number) {
    for (const b of this.bullets) {
      if (!b.alive) continue;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      // retire once off the arena (≈22u half-extent) so spent shots free a slot
      // instead of lingering their full life and pinning the live cap.
      const p = b.mesh.position;
      if (b.life <= 0 || p.x < -24 || p.x > 24 || p.z < -24 || p.z > 24) this.retire(b);
    }
    // Remove dead bullets AND return them to the pool here — the single place a
    // bullet leaves the active array, so it can't be double-referenced.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (!this.bullets[i].alive) {
        this.pool.push(this.bullets[i]);
        this.bullets.splice(i, 1);
      }
    }
  }

  clear() {
    for (const b of this.bullets) {
      b.alive = false;
      b.mesh.visible = false; // stays parented to the container; just hidden
      this.pool.push(b);
    }
    this.bullets.length = 0;
  }
}

/** A weapon instance carried by the player: tracks ammo, cooldown, reloading. */
export class Weapon {
  def: WeaponDef;
  ammo: number;
  reserve: number;
  private cooldown = 0;
  reloading = false;
  reloadTimer = 0;
  /** Pack-a-Punch tier: 0 = stock, up to MAX_PAP_TIER. Each tier compounds the
   *  gun's stats and adds a "+" to the name. */
  tier = 0;
  static readonly MAX_PAP_TIER = 3;
  /** Factory name (without any Pack-a-Punch "+" suffix), so re-upgrades re-tag
   *  cleanly instead of stacking "+ +". */
  private baseName: string;

  constructor(def: WeaponDef) {
    this.def = def;
    this.ammo = def.magSize;
    this.reserve = def.reserve;
    this.baseName = def.name;
  }

  /** True once Pack-a-Punched at least once (back-compat for older call sites). */
  get upgraded(): boolean {
    return this.tier > 0;
  }
  /** True when no further Pack-a-Punch tiers remain. */
  get maxUpgraded(): boolean {
    return this.tier >= Weapon.MAX_PAP_TIER;
  }

  get reserveLabel(): string {
    return this.reserve === Infinity ? "∞" : String(this.reserve);
  }

  /**
   * Pack-a-Punch: bump this gun to the next tier (up to MAX_PAP_TIER). Each tier
   * compounds the stats off the CURRENT def and re-tags the name with the right
   * number of "+"s (off baseName, so it never stacks "+ +"). We clone the def so
   * the shared WEAPONS template is never mutated. Refills on upgrade.
   */
  /** Distinctive "packed rounds" tint per Pack-a-Punch tier, so an upgraded gun
   *  is obvious at a glance: I = electric cyan, II = arcane violet, III = gold. */
  static readonly PAP_BULLET = [0x6ad7ff, 0xc792ea, 0xffe14a];

  upgrade(): boolean {
    if (this.maxUpgraded) return false;
    this.tier++;
    const d = this.def;
    // First tier brings the biggest jump; later tiers compound a touch gentler.
    const dmgMul = this.tier === 1 ? 2.4 : 1.7;
    this.def = {
      ...d,
      name: `${this.baseName} ${"+".repeat(this.tier)}`,
      damage: Math.round(d.damage * dmgMul),
      magSize: Math.ceil(d.magSize * 1.25),
      reserve: d.reserve === Infinity ? Infinity : Math.ceil(d.reserve * 1.4),
      reloadTime: d.reloadTime * 0.9,
      splashDamage: d.splashDamage ? Math.round(d.splashDamage * 1.8) : d.splashDamage,
      // packed rounds read brighter + a touch bigger each tier, and recolour to
      // the tier's signature hue (overriding the stock bullet colour).
      bulletScale: (d.bulletScale ?? 1) * 1.12,
      bulletColor: Weapon.PAP_BULLET[this.tier - 1] ?? d.bulletColor,
    };
    this.ammo = this.def.magSize;
    if (this.reserve !== Infinity) this.reserve = this.def.reserve;
    return true;
  }

  update(dt: number, reloadMul: number) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading) {
      this.reloadTimer -= dt * reloadMul;
      if (this.reloadTimer <= 0) this.finishReload();
    }
  }

  private finishReload() {
    this.reloading = false;
    const need = this.def.magSize - this.ammo;
    const take = this.reserve === Infinity ? need : Math.min(need, this.reserve);
    this.ammo += take;
    if (this.reserve !== Infinity) this.reserve -= take;
  }

  reload() {
    if (this.reloading || this.ammo >= this.def.magSize) return;
    if (this.reserve !== Infinity && this.reserve <= 0) return;
    this.reloading = true;
    this.reloadTimer = this.def.reloadTime;
  }

  /** Refill mag + reserve to factory spec (Full Pockets gum). */
  refill() {
    this.ammo = this.def.magSize;
    this.reserve = this.def.reserve;
    this.reloading = false;
  }

  /** Attempt to fire toward `dir`; spawns bullets and returns true if it shot. */
  tryFire(origin: THREE.Vector3, dir: THREE.Vector3, bullets: BulletSystem, fire: FireMods = {}): boolean {
    if (this.cooldown > 0 || this.reloading) return false;
    if (this.ammo <= 0) {
      this.reload();
      return false;
    }
    this.ammo--;
    this.cooldown = 1 / (this.def.fireRate * (fire.fireRateMul ?? 1));

    const d = this.def;
    const opts: SpawnOpts = {
      speed: d.bulletSpeed,
      damage: d.damage,
      pierce: (d.pierce ?? 0) + (fire.pierceBonus ?? 0),
      splashRadius: d.splashRadius ?? 0,
      splashDamage: d.splashDamage ?? 0,
      color: d.bulletColor ?? COLORS.bullet,
      scale: (d.bulletScale ?? 1) * (fire.scaleMul ?? 1),
      homing: Math.max(d.homing ?? 0, fire.homing ?? 0),
      bounces: (d.bounces ?? 0) + (fire.bounces ?? 0),
      knockback: d.knockback ?? 0,
    };

    const pellets = d.pellets + (fire.bonusPellets ?? 0);
    _base.set(dir.x, 0, dir.z).normalize();
    for (let p = 0; p < pellets; p++) {
      const a = (Math.random() * 2 - 1) * d.spread;
      _dd.copy(_base).applyAxisAngle(_UP, a);
      if (d.rainbow) opts.color = RAINBOW[Math.floor(Math.random() * RAINBOW.length)];
      bullets.spawn(origin, _dd, opts);
    }
    if (this.ammo <= 0) this.reload();
    return true;
  }
}
