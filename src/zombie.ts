import * as THREE from "three";
import { ELITE, ZOMBIE, ZOMBIE_TYPES, ZombieType } from "./config";
import { AssetManager, CharacterRig } from "./assets";
import { VoxelChar } from "./voxelChar";
import { voxelMaterial, glowMaterial } from "./palette";
import type { SpatialGrid } from "./grid";

const _tmp = new THREE.Vector3();
let _nextId = 1;

/**
 * Free every mesh in a decor group (geometry + material) and empty it. Decor
 * kits are flat lists of boxes, so a shallow sweep is enough — mirrors the
 * tdenemy disposeCreep pattern so pooled rebuilds never leak GPU resources.
 */
function disposeDecor(g: THREE.Group) {
  for (const child of g.children) {
    const m = child as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const x of mat) x.dispose();
    else mat?.dispose?.();
  }
  g.clear();
}

/**
 * Elite affix: a behavior + colored visual tell layered onto a late-game
 * zombie. NOT just bonus HP — each one changes how the zombie threatens you.
 *  - blazing: leaves a burning trail under itself (DoT to a player on it).
 *  - glacial: chills the player on contact; shatters into a freeze AoE on death.
 *  - overloading: carries a shield (absorbed before HP) and bursts AoE on death.
 */
export type Affix = "blazing" | "glacial" | "overloading";

/** Per-affix tell color (emissive + aura ring) — picked to read at a glance. */
const AFFIX_COLOR: Record<Affix, number> = {
  blazing: 0xff6a1f,
  glacial: 0x6ad7ff,
  overloading: 0xc792ea,
};

// One shared flat ring geometry for the affix aura, reused by every affixed
// zombie (scaled per-instance). Process-wide singleton — never disposed; pooled
// zombies just toggle visibility. Three shared materials, one per affix color.
const _auraGeo = new THREE.RingGeometry(0.55, 0.85, 18);
_auraGeo.rotateX(-Math.PI / 2);
const _auraMat: Record<Affix, THREE.Material> = {
  blazing: new THREE.MeshBasicMaterial({ color: AFFIX_COLOR.blazing, transparent: true, opacity: 0.6, depthWrite: false }),
  glacial: new THREE.MeshBasicMaterial({ color: AFFIX_COLOR.glacial, transparent: true, opacity: 0.6, depthWrite: false }),
  overloading: new THREE.MeshBasicMaterial({ color: AFFIX_COLOR.overloading, transparent: true, opacity: 0.6, depthWrite: false }),
};

/**
 * A cute-menacing undead, driven by a CharacterRig (voxel blocky by default, or
 * a KayKit GLB if present). Steers toward the player, keeps separation from
 * neighbours, hits on contact, and plays a death animation as a brief corpse
 * before being recycled.
 */
export class Zombie {
  /** Stable id for the frame's hit bookkeeping (piercing bullets). */
  readonly id = _nextId++;
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();

  typeName = "Shambler";
  /** Index into ZOMBIE_TYPES, sent in network snapshots. */
  typeIndex = 0;
  health = ZOMBIE.baseHealth;
  maxHealth = ZOMBIE.baseHealth;
  speed = ZOMBIE.baseSpeed;
  /** Round boss: huge HP, shown with a dedicated HUD health bar. */
  isBoss = false;
  alive = false;
  /** Visually dying (playing a death anim) but no longer a gameplay threat. */
  dying = false;
  private deathTimer = 0;
  touchCooldown = 0;
  /** Decaying knockback velocity + hit-flash timer for game feel. */
  private knock = new THREE.Vector3();
  private flash = 0;
  private slowTimer = 0;
  private slowAmt = 0;
  // ragdoll fling on death: vertical velocity + tumble spin
  private flingY = 0;
  private flingSpin = 0;
  // ---- flying mob state ----
  flying = false;
  private flyHeight = 3;
  private airMode: "dive" | "ranged" | "swarm" = "swarm";
  private diveTimer = 0;
  private diving = false;
  private rangedTimer = 0;
  private wobble = 0;
  /** Set true on a frame a ranged flier wants to fire; main reads + clears it. */
  wantsRangedShot = false;
  // ---- anti-camp specials ----
  splitInto?: string;
  splitCount = 0;
  private summonInterval = 0;
  summonCount = 0;
  private summonTimer = 0;
  /** Set true on a frame a summoner wants to raise adds; main reads + clears it. */
  wantsSummon = false;

  // per-spawn variant state
  touchDamage = ZOMBIE.touchDamage;
  scoreMul = 1;
  puffColor = 0x8fcf6f;
  /** Loot Goblin: flees the player instead of chasing, and pays a jackpot on
   *  death (main reads `bounty`). Set by rounds.spawnGoblin(). */
  fleer = false;
  bounty = false;
  explodes = false;
  blastRadius = 0;
  blastDamage = 0;

  // ---- elite affix state ----
  /** Active affix (null on a plain zombie). Read by main for on-hit/on-death FX. */
  affix: Affix | null = null;
  /** Remaining shield (overloading) absorbed before HP; 0 when none. */
  shield = 0;
  private maxShield = 0;
  /** Throttle for blazing trail emission; main reads `burnTrailReady`. */
  private burnTimer = 0;
  /** Set on a frame a blazing zombie wants to drop a burn patch; main clears it. */
  burnTrailReady = false;
  private aura?: THREE.Mesh;

  // ---- per-type silhouette decor (PURE VISUAL; tdenemy's "decor kit" pattern) ----
  // Three independent groups bolted onto the rig so each layer can be rebuilt /
  // disposed on its own across pooled reuse: the per-type kit, the elite-affix
  // accent, and the boss regalia. All are children of char.root so they inherit
  // the walk lean + death tilt for free.
  private decor = new THREE.Group();
  private affixDecor = new THREE.Group();
  private bossDecor = new THREE.Group();
  /** Type id the current `decor` kit was built for ("" = none yet). */
  private decorKind = "";
  /** Phase clock for all decor animation (randomized per spawn so the horde desyncs). */
  private decorT = 0;
  private pulseRate = 6;
  private flapRate = 9;
  /** Glow mats whose emissive pulses (bile sac / keg band / maw / seams…). */
  private pulseMats: THREE.MeshStandardMaterial[] = [];
  /** Affix-accent glow mats (flame nubs / spark tips) — fast flicker. */
  private affixPulseMats: THREE.MeshStandardMaterial[] = [];
  /** Translucent mats whose opacity flickers (dust streaks / wing blur). */
  private fadeMats: { mat: THREE.MeshBasicMaterial; base: number }[] = [];
  /** Wing-stub meshes flapped by rotation.z (sign of x picks the direction). */
  private wings: THREE.Mesh[] = [];
  /** Bomber fuse spark (scale jitter). */
  private sparkMesh: THREE.Mesh | null = null;
  /** Screamer sound-ring (expanding + fading torus) + its material. */
  private ringMesh: THREE.Mesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  /** Boss ground-menace ring material (slow opacity throb). */
  private bossRingMat: THREE.MeshBasicMaterial | null = null;
  /** The type/boss scale this life spawned with (for the death shrink-out). */
  private baseScale = 1;

  private char: CharacterRig;

  constructor(assets: AssetManager) {
    this.char =
      assets.createCharacter("zombie") ??
      new VoxelChar({ body: 0x8fcf6f, head: 0x5f9d4a, eye: 0x141414, zombie: true });
    this.char.root.add(this.decor, this.affixDecor, this.bossDecor);
    this.group.add(this.char.root);
    this.group.visible = false;
  }

  spawn(at: THREE.Vector3, baseHealth: number, baseSpeed: number, type: ZombieType) {
    this.pos.copy(at);
    this.pos.y = 0;
    this.alive = true;
    this.dying = false;
    this.deathTimer = 0;
    this.touchCooldown = 0;
    this.knock.set(0, 0, 0);
    this.slowTimer = 0;
    this.slowAmt = 0;
    this.flingY = 0;
    this.flingSpin = 0;
    this.group.position.y = 0;
    this.group.rotation.z = 0;

    this.typeName = type.name;
    this.typeIndex = Math.max(0, ZOMBIE_TYPES.indexOf(type));
    this.isBoss = false;
    this.health = baseHealth * type.healthMul;
    this.maxHealth = this.health;
    this.speed = baseSpeed * type.speedMul;
    this.touchDamage = type.touchDamage;
    this.scoreMul = type.scoreMul;
    this.puffColor = type.body;
    this.fleer = false;
    this.bounty = false;
    this.explodes = type.blastRadius !== undefined;
    this.blastRadius = type.blastRadius ?? 0;
    this.blastDamage = type.blastDamage ?? 0;
    // flying state
    this.splitInto = type.splitInto;
    this.splitCount = type.splitCount ?? 0;
    this.summonInterval = type.summonInterval ?? 0;
    this.summonCount = type.summonCount ?? 0;
    this.summonTimer = type.summonInterval ?? 0;
    this.flying = !!type.flying;
    this.flyHeight = type.flyHeight ?? 3;
    this.airMode = type.airMode ?? "swarm";
    this.diveTimer = 1.5 + Math.random() * 2; // first dive after a beat
    this.diving = false;
    this.rangedTimer = 1 + Math.random() * 1.5;
    this.wobble = Math.random() * Math.PI * 2;
    this.group.scale.setScalar(type.scale);
    this.baseScale = type.scale;
    if (this.char instanceof VoxelChar) {
      this.char.setColor(type.body, type.head, this.explodes ? type.body : 0x000000);
    }

    // (re)build the per-type silhouette kit; strip any boss regalia from a
    // previous life (pooled reuse may turn last round's boss into a shambler).
    this.decorT = Math.random() * Math.PI * 2;
    this.rebuildDecor(type);
    this.clearBossDecor();
    this.decor.visible = true;

    // clear any affix from a previous life (pooled reuse)
    this.clearAffix();

    this.group.rotation.set(0, 0, 0);
    this.char.play("walk");
    this.group.position.copy(this.pos);
    this.group.visible = true;
  }

  /**
   * Tag this (already-spawned) zombie with an elite affix: behavior + a colored
   * tell. Glacial/blazing buff stats slightly; overloading grants a shield. The
   * aura ring + emissive tint make it readable. Caller (rounds) decides fraction
   * + cap; this just applies. Returns the affix so callers can count it.
   */
  applyAffix(affix: Affix): Affix {
    this.affix = affix;
    const color = AFFIX_COLOR[affix];
    // recolor the body emissive to the affix color (keeps the variant's body hue)
    if (this.char instanceof VoxelChar) this.char.setColor(this.puffColor, this.puffColor, color);
    // lazy-build the shared aura ring; toggle on + recolor via shared material
    if (!this.aura) {
      this.aura = new THREE.Mesh(_auraGeo, _auraMat[affix]);
      this.aura.position.y = 0.06;
      this.group.add(this.aura);
    }
    this.aura.material = _auraMat[affix];
    this.aura.visible = true;
    // matching silhouette accent on the body (flame nubs / icicles / antennae)
    this.buildAffixDecor(affix);
    if (affix === "overloading") {
      this.maxShield = this.maxHealth * ELITE.overloadShield;
      this.shield = this.maxShield;
    } else if (affix === "blazing") {
      this.speed *= 1.1; // a touch faster so the trail actually chases you
    } else if (affix === "glacial") {
      this.health *= 1.25; // glacial is the "anchor" — slightly tankier
      this.maxHealth = this.health;
    }
    this.scoreMul *= 1.6; // affixed kills are worth more
    return affix;
  }

  /** Strip any affix back to a plain zombie (called on pooled respawn). */
  private clearAffix() {
    this.affix = null;
    this.shield = 0;
    this.maxShield = 0;
    this.burnTimer = 0;
    this.burnTrailReady = false;
    if (this.aura) this.aura.visible = false;
    if (this.affixDecor.children.length > 0) {
      disposeDecor(this.affixDecor);
      this.affixPulseMats.length = 0;
    }
  }

  /**
   * Death-burst descriptor for affixed zombies (glacial shatter / overloading
   * blast), or null. main applies the AoE so it shares the explosion/FX paths.
   */
  deathAoe(): { radius: number; damage: number; slow: number; color: number } | null {
    if (this.affix === "glacial") {
      return { radius: ELITE.glacialShatterRadius, damage: 0, slow: ELITE.glacialSlow, color: AFFIX_COLOR.glacial };
    }
    if (this.affix === "overloading") {
      return { radius: ELITE.overloadAoeRadius, damage: ELITE.overloadAoeDamage, slow: 0, color: AFFIX_COLOR.overloading };
    }
    return null;
  }

  /** Turn a freshly-spawned zombie into a round boss: massive HP + size. */
  promoteToBoss(health: number, scale: number) {
    this.isBoss = true;
    this.typeName = "BOSS";
    this.health = health;
    this.maxHealth = health;
    this.scoreMul *= 4;
    this.touchDamage *= 1.5;
    this.group.scale.setScalar(scale);
    this.baseScale = scale;
    // unmistakable boss regalia: spike crown, burning eyes, ground-menace ring.
    // The plain type kit is hidden so the boss reads as its own creature.
    this.decor.visible = false;
    this.buildBossDecor();
  }

  /** Returns true if it just died from this hit. */
  hit(damage: number): boolean {
    if (!this.alive) return false;
    // Overloading shield soaks damage before HP (self-contained; main needs no
    // special-case here — it keeps calling hit() as normal).
    if (this.shield > 0) {
      const soaked = Math.min(this.shield, damage);
      this.shield -= soaked;
      damage -= soaked;
      if (damage <= 0) {
        this.flash = 0.12;
        return false;
      }
    }
    this.health -= damage;
    this.flash = 0.12; // brief white hit-flash
    if (this.health <= 0) {
      this.alive = false;
      this.dying = true;
      this.deathTimer = 1.4;
      this.char.play("death", { once: true });
      return true;
    }
    return false;
  }

  /** Shove the zombie away from a point — visual "bullet force". */
  knockback(fromX: number, fromZ: number, force: number) {
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.knock.x += (dx / d) * force;
    this.knock.z += (dz / d) * force;
  }

  /** Launch the corpse: pop it up with a tumble spin (called on death). */
  flingDeath(force: number) {
    this.flingY = force;
    this.flingSpin = (Math.random() - 0.5) * 12;
  }

  /** Chill the zombie: move at `(1-amount)` speed for `dur` seconds. */
  applySlow(amount: number, dur: number) {
    this.slowAmt = Math.max(this.slowAmt, amount);
    this.slowTimer = Math.max(this.slowTimer, dur);
  }

  update(dt: number, target: THREE.Vector3, grid: SpatialGrid) {
    if (!this.alive) return;
    if (this.touchCooldown > 0) this.touchCooldown -= dt;

    let speed = this.speed;
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      speed *= 1 - this.slowAmt;
      if (this.slowTimer <= 0) this.slowAmt = 0;
    }

    if (this.flying) {
      this.updateFlying(dt, target, speed);
    } else {
      this.updateGround(dt, target, grid, speed);
    }

    // Blazing: periodically flag a burn patch under itself for main to drop.
    if (this.affix === "blazing") {
      this.burnTimer -= dt;
      if (this.burnTimer <= 0) {
        this.burnTimer = 0.35;
        this.burnTrailReady = true;
      }
    }
    // spin the affix aura for a little life
    if (this.aura && this.aura.visible) this.aura.rotation.y += dt * 1.5;
    // tick the per-type decor (pulses / flaps / streaks) — trig only, no allocs
    this.animateDecor(dt);

    if (this.flash > 0) {
      this.flash -= dt;
      if (this.char instanceof VoxelChar) this.char.setHitFlash(Math.max(0, this.flash / 0.12));
    }
    this.char.update(dt);
  }

  private updateGround(dt: number, target: THREE.Vector3, grid: SpatialGrid, speed: number) {
    _tmp.copy(target).sub(this.pos);
    _tmp.y = 0;
    const dist = _tmp.length();
    if (dist > 0.0001) _tmp.divideScalar(dist);
    // Summoner keeps its distance (flees if the player gets close) + raises adds.
    let approach = 1;
    if (this.fleer) {
      // Loot Goblin: always sprint directly AWAY from the player. Add a slow
      // lateral weave so it juke-runs instead of beelining into a corner.
      approach = -1;
      const weave = Math.sin(this.wobble) * 0.5;
      this.wobble += dt * 3;
      _tmp.set(_tmp.x + -_tmp.z * weave, 0, _tmp.z + _tmp.x * weave);
      const l = _tmp.length() || 1;
      _tmp.divideScalar(l);
    } else if (this.summonInterval > 0) {
      if (dist < 7) approach = -0.6; // back away to stay a priority-but-annoying target
      this.summonTimer -= dt;
      if (this.summonTimer <= 0) {
        this.summonTimer = this.summonInterval;
        this.wantsSummon = true;
      }
    }
    this.vel.copy(_tmp).multiplyScalar(speed * approach);

    // separation: only check zombies in nearby grid cells (was O(n²))
    const minD = ZOMBIE.separation;
    grid.forNear(this.pos.x, this.pos.z, minD, (o) => {
      if (o === this || !o.alive || o.flying) return;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.0001 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = (minD - d) / minD;
        this.vel.x += (dx / d) * push * this.speed * 1.4;
        this.vel.z += (dz / d) * push * this.speed * 1.4;
      }
    });

    // apply + decay knockback (visual push, then snaps back to steering)
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x += this.knock.x * dt;
    this.pos.z += this.knock.z * dt;
    this.knock.multiplyScalar(Math.pow(0.0008, dt));
    this.pos.y = 0;
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(_tmp.x, _tmp.z);
  }

  /** Flying behavior: hover at height, then dive / lob ranged / swarm-drift. */
  private updateFlying(dt: number, target: THREE.Vector3, speed: number) {
    this.wobble += dt * 4;
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;

    let desiredY = this.flyHeight + Math.sin(this.wobble) * 0.3;

    if (this.airMode === "dive") {
      this.diveTimer -= dt;
      if (this.diving) {
        // swoop straight at the player on the ground, fast
        this.pos.x += nx * speed * 2.2 * dt;
        this.pos.z += nz * speed * 2.2 * dt;
        desiredY = 0.4;
        if (this.pos.y < 0.6 || dist < 0.8) {
          this.diving = false;
          this.diveTimer = 2 + Math.random() * 2;
        }
      } else {
        // reposition above the player, then trigger a dive
        this.pos.x += nx * speed * dt;
        this.pos.z += nz * speed * dt;
        if (this.diveTimer <= 0 && dist < 8) this.diving = true;
      }
    } else if (this.airMode === "ranged") {
      // hover at a standoff distance and lob projectiles
      const standoff = 8;
      const closing = dist > standoff ? 1 : dist < standoff - 1.5 ? -0.8 : 0;
      this.pos.x += nx * speed * closing * dt;
      this.pos.z += nz * speed * closing * dt;
      this.rangedTimer -= dt;
      if (this.rangedTimer <= 0 && dist < 18) {
        this.rangedTimer = 1.8 + Math.random();
        this.wantsRangedShot = true;
      }
    } else {
      // swarm: erratic zig-zag drift toward the player at head height
      const zig = Math.sin(this.wobble * 1.7) * 0.6;
      this.pos.x += (nx + -nz * zig) * speed * dt;
      this.pos.z += (nz + nx * zig) * speed * dt;
    }

    // ease height toward desired; apply light knockback drift
    this.pos.y += (desiredY - this.pos.y) * Math.min(1, dt * 6);
    this.pos.x += this.knock.x * dt;
    this.pos.z += this.knock.z * dt;
    this.knock.multiplyScalar(Math.pow(0.0008, dt));
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(nx, nz);
  }

  /** Advance the death animation; hide + recycle when the corpse times out. */
  updateDying(dt: number) {
    if (!this.dying) return;
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.char instanceof VoxelChar) this.char.setHitFlash(Math.max(0, this.flash / 0.12));
    }
    // ragdoll: pop up under gravity + tumble, slide along residual knockback
    if (this.flingY !== 0 || this.group.position.y > 0) {
      this.flingY -= 22 * dt;
      this.group.position.y = Math.max(0, this.group.position.y + this.flingY * dt);
      this.group.position.x += this.knock.x * dt;
      this.group.position.z += this.knock.z * dt;
      this.knock.multiplyScalar(Math.pow(0.0008, dt));
      this.group.rotation.z += this.flingSpin * dt;
      if (this.group.position.y <= 0) {
        this.flingY = 0;
        this.flingSpin = 0;
      }
    }
    this.char.update(dt);
    // keep the decor alive on the corpse (the bomber keg should pulse to the end)
    this.animateDecor(dt);
    this.deathTimer -= dt;
    // death juice: the corpse crumples — shrink away over its last beats so the
    // recycle pop is a fade-out, not a blink. spawn() restores the scale.
    if (this.deathTimer < 0.35) {
      const k = Math.max(0, this.deathTimer) / 0.35;
      this.group.scale.setScalar(this.baseScale * (0.25 + 0.75 * k));
    }
    if (this.deathTimer <= 0) {
      this.dying = false;
      this.group.visible = false;
      this.group.position.y = 0;
      this.group.rotation.z = 0;
      if (this.aura) this.aura.visible = false;
    }
  }

  // ──────────────────────── per-type decor kits ────────────────────────
  // Each zombie type gets a small kit of flat-shaded voxel boxes bolted onto
  // the rig so the horde reads at the game's zoomed-out camera: WHAT a thing
  // is (and what it's about to do to you) is visible from silhouette + glow
  // alone. Kits live in rig-local space, so they scale with `type.scale`.

  /** Add one decor box to `parent`. Glow boxes use the bloom-caught material. */
  private addBox(
    parent: THREE.Group,
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    color: number, glow = false, glowIntensity = 1.1,
  ): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      glow ? glowMaterial(color, glowIntensity) : voxelMaterial(color),
    );
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** Push a glow box's material into the slow-pulse list (sac/keg/maw/seam). */
  private pulse(m: THREE.Mesh) {
    this.pulseMats.push(m.material as THREE.MeshStandardMaterial);
  }

  /**
   * Rebuild the per-type kit if the pooled zombie changed type since its last
   * life. Disposes the old kit's geometries/materials (no leaks across reuse)
   * and resets every animation ref the old kit registered.
   */
  private rebuildDecor(type: ZombieType) {
    if (!(this.char instanceof VoxelChar)) return; // GLB rigs keep their own look
    if (type.id === this.decorKind) return; // same type → kit + refs still valid
    disposeDecor(this.decor);
    this.pulseMats.length = 0;
    this.fadeMats.length = 0;
    this.wings.length = 0;
    this.sparkMesh = null;
    this.ringMesh = null;
    this.ringMat = null;
    this.pulseRate = 6;
    this.flapRate = 9;
    this.decorKind = type.id;
    this.buildKit(type);
  }

  /** The per-type looks. Unknown ids fall back to the shambler rags. */
  private buildKit(type: ZombieType) {
    const g = this.decor;
    const cloth = 0x4a3a2c;
    switch (type.id) {
      case "walker": {
        // heavier shambler: rag patches, an old wound, one field-dressing strap
        this.addBox(g, 0.3, 0.24, 0.06, -0.18, 1.18, 0.27, cloth);
        this.addBox(g, 0.24, 0.3, 0.06, 0.2, 0.9, 0.27, 0x3a3a3a);
        this.addBox(g, 0.22, 0.16, 0.07, 0.08, 1.34, 0.265, 0x7a2f1f);
        const strap = this.addBox(g, 0.16, 1.0, 0.06, 0, 1.05, 0.285, 0xd8cfae);
        strap.rotation.z = 0.7;
        this.addBox(g, 0.22, 0.22, 0.22, -0.26, 2.16, -0.12, 0x2f2f2f); // head notch
        break;
      }
      case "runner": {
        // lean speed fins + a dust streak trailing the sprint
        this.addBox(g, 0.1, 0.3, 0.52, 0, 2.26, 0.06, 0xfff1d6); // head fin
        this.addBox(g, 0.12, 0.26, 0.34, 0, 1.42, -0.36, type.head); // tail fin
        const streakMat = new THREE.MeshBasicMaterial({ color: 0xffc97a, transparent: true, opacity: 0.25, depthWrite: false });
        const streak = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.8, 1.1), streakMat);
        streak.position.set(0, 1.1, -0.85);
        g.add(streak);
        this.fadeMats.push({ mat: streakMat, base: 0.28 });
        break;
      }
      case "crawler": {
        // hunched: a spine of spurs, a hump pad, and a low drag-dust wisp
        this.addBox(g, 0.52, 0.2, 0.36, 0, 1.54, -0.16, type.body);
        for (let i = 0; i < 3; i++) this.addBox(g, 0.13, 0.24 - i * 0.05, 0.13, 0, 1.7 - i * 0.16, -0.26 - i * 0.12, type.head);
        const wispMat = new THREE.MeshBasicMaterial({ color: 0xcfc49a, transparent: true, opacity: 0.18, depthWrite: false });
        const wisp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.7), wispMat);
        wisp.position.set(0, 0.3, -0.6);
        g.add(wisp);
        this.fadeMats.push({ mat: wispMat, base: 0.2 });
        break;
      }
      case "brute": {
        // hulking mass: shoulder slabs, a back hump, knuckle guards up front
        for (const sx of [-1, 1]) this.addBox(g, 0.4, 0.36, 0.55, sx * 0.6, 1.56, 0, type.head);
        this.addBox(g, 0.74, 0.55, 0.44, 0, 1.42, -0.4, type.head); // back hump
        this.addBox(g, 0.86, 0.16, 0.56, 0, 0.64, 0, 0x5a2018); // waist band (heft)
        // zombie arms reach forward, so fixed fists at hand height read right
        for (const sx of [-1, 1]) this.addBox(g, 0.3, 0.26, 0.3, sx * 0.55, 1.0, 0.46, 0x5a2018);
        break;
      }
      case "bomber": {
        // strapped powder keg + sparking fuse — pulses so you keep your distance
        this.pulseRate = 11;
        this.addBox(g, 0.52, 0.62, 0.4, 0, 1.2, -0.5, 0x3a2f28); // keg
        this.pulse(this.addBox(g, 0.54, 0.14, 0.42, 0, 1.2, -0.5, 0xffb13a, true)); // warning band
        const strap = this.addBox(g, 0.14, 1.0, 0.06, 0, 1.05, 0.28, 0x2a2018);
        strap.rotation.z = 0.6; // chest strap
        this.addBox(g, 0.06, 0.2, 0.06, 0, 1.6, -0.5, 0x2a2018); // fuse stub
        const spark = this.addBox(g, 0.14, 0.14, 0.14, 0, 1.74, -0.5, 0xffe14a, true, 1.4);
        this.sparkMesh = spark;
        this.pulse(spark);
        break;
      }
      case "spitter": {
        // bloated glowing bile sac + emissive drool off the chin
        this.pulseRate = 5;
        this.pulse(this.addBox(g, 0.5, 0.42, 0.26, 0, 0.92, 0.3, 0x9fef3a, true, 0.9));
        this.addBox(g, 0.3, 0.1, 0.06, 0, 1.66, 0.405, 0x1f4a3a); // slack mouth
        for (const dx of [-0.09, 0.08]) this.pulse(this.addBox(g, 0.07, 0.2, 0.07, dx, 1.5, 0.41, 0xb4ff4a, true));
        break;
      }
      case "armored": {
        // bolted steel: chest plate, pauldrons, helmet backplate (+ stud bolts)
        const plate = (w: number, h: number, d: number, x: number, y: number, z: number) => {
          const mat = new THREE.MeshStandardMaterial({ color: 0xc4ccd6, roughness: 0.35, metalness: 0.85, flatShading: true });
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          m.position.set(x, y, z);
          g.add(m);
        };
        plate(0.86, 0.62, 0.12, 0, 1.1, 0.27); // chest plate
        for (const sx of [-1, 1]) plate(0.4, 0.34, 0.52, sx * 0.56, 1.52, 0); // pauldrons
        plate(0.78, 0.5, 0.1, 0, 1.85, -0.41); // helmet backplate
        for (const sx of [-0.28, 0.28]) for (const sy of [0.94, 1.26]) this.addBox(g, 0.08, 0.08, 0.05, sx, sy, 0.345, 0x3a4048);
        break;
      }
      case "banshee": {
        // the screamer: gaping glowing maw, swept hair, an expanding scream ring
        this.pulseRate = 7;
        this.pulse(this.addBox(g, 0.3, 0.3, 0.08, 0, 1.7, 0.41, 0xff86c4, true, 1.3));
        for (const sx of [-1, 1]) {
          const hair = this.addBox(g, 0.16, 0.1, 0.6, sx * 0.2, 2.18, -0.35, 0x5a2342);
          hair.rotation.x = -0.25;
        }
        this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffb4dc, transparent: true, opacity: 0.5, depthWrite: false });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 20), this.ringMat);
        ring.position.set(0, 1.7, 0.45); // bursts forward from the maw
        g.add(ring);
        this.ringMesh = ring;
        break;
      }
      case "abomination": {
        // stitched colossus: suture crosses, glowing ruptures, a back ridge
        this.pulseRate = 4;
        this.addBox(g, 0.34, 0.07, 0.06, -0.1, 1.3, 0.27, 0xd8cfae);
        this.addBox(g, 0.07, 0.3, 0.06, -0.1, 1.3, 0.27, 0xd8cfae);
        this.addBox(g, 0.26, 0.06, 0.06, 0.12, 1.95, 0.39, 0xd8cfae); // head suture
        this.pulse(this.addBox(g, 0.1, 0.34, 0.07, 0.22, 1.0, 0.27, 0xff5a2a, true));
        this.pulse(this.addBox(g, 0.3, 0.1, 0.07, -0.16, 0.86, 0.27, 0xff5a2a, true));
        for (let i = 0; i < 4; i++) this.addBox(g, 0.16, 0.42 - i * 0.07, 0.16, 0, 1.62, -0.3 - i * 0.2, 0x4a0f0f);
        this.addBox(g, 0.26, 0.26, 0.26, 0.28, 2.18, -0.06, 0x2f1010); // head chunk gone
        break;
      }
      case "vulture": {
        // diver: tattered wing stubs that flap + grasping talons
        this.flapRate = 8;
        for (const sx of [-1, 1]) {
          const w = this.addBox(g, 0.72, 0.3, 0.07, sx * 0.7, 1.62, -0.28, 0x4a3f55);
          w.rotation.y = sx * 0.3;
          this.wings.push(w);
          this.addBox(g, 0.12, 0.12, 0.22, sx * 0.18, 0.06, 0.16, 0x2a2430); // talon
        }
        this.addBox(g, 0.4, 0.14, 0.3, 0, 1.78, 0.34, 0x3a3344); // beak brow
        break;
      }
      case "gnat": {
        // swarm midge: blurred translucent wings + feelers
        this.flapRate = 18;
        for (const sx of [-1, 1]) {
          const wm = new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.55, depthWrite: false });
          const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.06), wm);
          w.position.set(sx * 0.52, 1.8, -0.12);
          g.add(w);
          this.wings.push(w);
          this.fadeMats.push({ mat: wm, base: 0.55 });
          this.addBox(g, 0.05, 0.26, 0.05, sx * 0.15, 2.32, 0.1, 0x4a522a); // feeler
          this.addBox(g, 0.1, 0.1, 0.1, sx * 0.15, 2.48, 0.1, 0xd6e89a); // feeler tip
        }
        break;
      }
      case "stinger": {
        // hovering lobber: wasp wings + a glowing venom stinger out the back
        this.flapRate = 14;
        this.pulseRate = 9;
        for (const sx of [-1, 1]) {
          const wm = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.5, depthWrite: false });
          const w = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.2, 0.06), wm);
          w.position.set(sx * 0.56, 1.78, -0.16);
          g.add(w);
          this.wings.push(w);
          this.fadeMats.push({ mat: wm, base: 0.5 });
        }
        this.addBox(g, 0.36, 0.32, 0.4, 0, 1.0, -0.42, 0x6b4f12); // abdomen
        const tail = this.addBox(g, 0.15, 0.15, 0.5, 0, 0.92, -0.68, 0xffd24a, true);
        tail.rotation.x = 0.55; // angled down, ready to lob
        this.pulse(tail);
        break;
      }
      case "splitter": {
        // glowing fission seam — telegraphs that it comes apart on death
        this.pulseRate = 4;
        this.pulse(this.addBox(g, 0.07, 0.92, 0.06, 0, 1.05, 0.285, 0x9fffc8, true, 0.9));
        this.pulse(this.addBox(g, 0.07, 0.5, 0.05, 0, 1.95, 0.4, 0x9fffc8, true, 0.9));
        for (const sx of [-1, 1]) this.addBox(g, 0.26, 0.26, 0.26, sx * 0.5, 1.6, -0.05, type.body); // budding clones
        break;
      }
      case "splitling": {
        // fresh half: one raw glowing seam down the middle
        this.pulseRate = 5;
        this.pulse(this.addBox(g, 0.06, 0.7, 0.05, 0, 1.2, 0.285, 0x9fffc8, true, 0.9));
        break;
      }
      case "necro": {
        // the summoner: dark cowl + mantle, slow-throbbing soul rune, horn nubs
        this.pulseRate = 2.5;
        this.addBox(g, 0.9, 0.55, 0.5, 0, 2.08, -0.18, 0x241433); // cowl
        this.addBox(g, 1.0, 0.18, 0.6, 0, 1.55, 0, 0x32204a); // shoulder mantle
        this.pulse(this.addBox(g, 0.26, 0.26, 0.07, 0, 1.12, 0.28, 0xb48cff, true, 0.9));
        for (const sx of [-1, 1]) this.addBox(g, 0.12, 0.24, 0.12, sx * 0.3, 2.46, 0, 0x140a20);
        break;
      }
      case "goblin": {
        // the bounty: a bulging loot sack with coins glinting out the top
        this.pulseRate = 8;
        this.addBox(g, 0.56, 0.6, 0.42, 0, 1.3, -0.5, 0x8a5a32); // sack
        this.addBox(g, 0.2, 0.16, 0.2, 0.08, 1.66, -0.5, 0x6e4626); // knot
        this.pulse(this.addBox(g, 0.13, 0.13, 0.05, -0.14, 1.68, -0.42, 0xffd24a, true, 1.3));
        this.pulse(this.addBox(g, 0.1, 0.1, 0.05, 0.16, 1.58, -0.74, 0xffd24a, true, 1.3));
        break;
      }
      default: {
        // shambler (and any new id): torn rags + a missing chunk of head
        this.addBox(g, 0.3, 0.26, 0.06, -0.16, 1.12, 0.27, cloth);
        this.addBox(g, 0.26, 0.2, 0.06, 0.2, 0.86, 0.27, 0x3a3a3a);
        this.addBox(g, 0.06, 0.34, 0.3, 0.42, 0.95, 0, cloth); // side rag
        this.addBox(g, 0.24, 0.24, 0.24, 0.3, 2.18, -0.08, 0x2f2f2f); // head notch
        break;
      }
    }
  }

  /** Elite accent layered on top of the type kit (rebuilt per applyAffix). */
  private buildAffixDecor(affix: Affix) {
    if (!(this.char instanceof VoxelChar)) return;
    disposeDecor(this.affixDecor);
    this.affixPulseMats.length = 0;
    const g = this.affixDecor;
    const flick = (m: THREE.Mesh) => this.affixPulseMats.push(m.material as THREE.MeshStandardMaterial);
    if (affix === "blazing") {
      // flame nubs licking off the scalp + shoulders
      flick(this.addBox(g, 0.16, 0.3, 0.16, 0, 2.36, 0, 0xff6a1f, true, 1.3));
      flick(this.addBox(g, 0.12, 0.22, 0.12, 0.16, 2.46, -0.1, 0xffb13a, true, 1.3));
      for (const sx of [-1, 1]) flick(this.addBox(g, 0.13, 0.26, 0.13, sx * 0.52, 1.62, 0, 0xff6a1f, true, 1.3));
    } else if (affix === "glacial") {
      // a frost cap + icicles hanging off brow and shoulders (steady cold glow)
      this.addBox(g, 0.82, 0.12, 0.82, 0, 2.28, 0, 0xcfeffd);
      for (const sx of [-1, 1]) {
        this.addBox(g, 0.09, 0.34, 0.09, sx * 0.52, 1.28, 0.08, 0x9fe4ff, true, 0.5);
        this.addBox(g, 0.07, 0.24, 0.07, sx * 0.2, 1.4, 0.34, 0x9fe4ff, true, 0.5);
      }
    } else {
      // overloading: sparking antennae + an arcing chest node
      for (const sx of [-1, 1]) {
        this.addBox(g, 0.05, 0.42, 0.05, sx * 0.2, 2.4, 0, 0x2a2a33);
        flick(this.addBox(g, 0.13, 0.13, 0.13, sx * 0.2, 2.64, 0, 0xc792ea, true, 1.3));
      }
      flick(this.addBox(g, 0.2, 0.2, 0.07, 0, 1.12, 0.285, 0xc792ea, true, 1.3));
    }
  }

  /** Boss regalia: spike crown, oversized burning eyes, jaw, ridge, ground ring. */
  private buildBossDecor() {
    if (!(this.char instanceof VoxelChar)) return;
    disposeDecor(this.bossDecor);
    const g = this.bossDecor;
    this.addBox(g, 0.9, 0.14, 0.9, 0, 2.3, 0, 0x3a2f28); // crown band
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.addBox(g, 0.14, 0.34, 0.14, Math.cos(a) * 0.34, 2.5, Math.sin(a) * 0.34, 0xffd24a, true, 1.4);
    }
    for (const sx of [-1, 1]) this.addBox(g, 0.2, 0.2, 0.05, sx * 0.16, 1.88, 0.44, 0xff3b1f, true, 1.6); // big eyes
    this.addBox(g, 0.5, 0.14, 0.2, 0, 1.56, 0.38, 0x3a2f28); // heavy jaw
    for (let i = 0; i < 4; i++) this.addBox(g, 0.16, 0.4 - i * 0.07, 0.16, 0, 1.66, -0.3 - i * 0.2, 0x4a1010); // back ridge
    // ground-menace ring (throbs in animateDecor)
    const rg = new THREE.RingGeometry(0.7, 1.0, 22);
    rg.rotateX(-Math.PI / 2);
    this.bossRingMat = new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.4, depthWrite: false });
    const ring = new THREE.Mesh(rg, this.bossRingMat);
    ring.position.y = 0.05;
    g.add(ring);
  }

  /** Dispose boss regalia from a previous life (pooled respawn as a non-boss). */
  private clearBossDecor() {
    if (this.bossDecor.children.length === 0) return;
    disposeDecor(this.bossDecor);
    this.bossRingMat = null;
  }

  /**
   * Per-frame decor animation — pure phase-based trig over refs captured at
   * build time (tdenemy-style); zero allocations, cheap enough for 170 alive.
   */
  private animateDecor(dt: number) {
    this.decorT += dt;
    const t = this.decorT;
    if (this.pulseMats.length > 0) {
      const p = 0.55 + (Math.sin(t * this.pulseRate) * 0.5 + 0.5) * 1.0;
      for (let i = 0; i < this.pulseMats.length; i++) this.pulseMats[i].emissiveIntensity = p;
    }
    for (let i = 0; i < this.affixPulseMats.length; i++) {
      this.affixPulseMats[i].emissiveIntensity = 0.7 + Math.abs(Math.sin(t * 16 + i * 1.7)) * 0.8;
    }
    for (let i = 0; i < this.fadeMats.length; i++) {
      const f = this.fadeMats[i];
      f.mat.opacity = f.base * (0.55 + (Math.sin(t * 14 + i * 2.1) * 0.5 + 0.5) * 0.45);
    }
    for (let i = 0; i < this.wings.length; i++) {
      const w = this.wings[i];
      const s = w.position.x < 0 ? 1 : -1;
      w.rotation.z = s * (0.5 + Math.sin(t * this.flapRate) * 0.4);
    }
    if (this.sparkMesh) this.sparkMesh.scale.setScalar(0.7 + Math.abs(Math.sin(t * 13)) * 0.7);
    if (this.ringMesh && this.ringMat) {
      const k = (t * 0.9) % 1; // expanding scream ring: grow + fade, then restart
      this.ringMesh.scale.setScalar(0.4 + k * 1.8);
      this.ringMat.opacity = 0.5 * (1 - k);
    }
    if (this.bossRingMat) this.bossRingMat.opacity = 0.3 + (Math.sin(t * 3) * 0.5 + 0.5) * 0.25;
  }
}
