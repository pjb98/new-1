import * as THREE from "three";
import { VoxelChar } from "../voxelChar";

/**
 * Bed Wars-lite BOT RAIDERS.
 *
 * Raiders are voxel grunts that march in from off-island and melee a target —
 * an enemy bed or the player. They model their feel on the survival-mode
 * `Zombie`: seek the target on the XZ plane, face the move direction, walk-bob
 * via the shared `VoxelChar` rig, and swing on a cooldown once in range. The
 * integrator owns the scene, wave pacing, and bullet hit FX; this module just
 * owns the raiders themselves.
 */

// ---- tuning (exposed as consts so the integrator can read the numbers) ----
/** Starting / max HP per raider. */
export const RAIDER_HP = 40;
/** Ground move speed, units per second. */
export const RAIDER_SPEED = 3;
/** How close (XZ) a raider must be to its target before it stops + swings. */
export const RAIDER_REACH = 1.6;
/** Seconds between melee swings. */
export const RAIDER_SWING_CD = 0.8;
/** Damage dealt to the target per swing. */
export const RAIDER_SWING_DMG = 8;
/** Walk-anim leg-swing rate is in VoxelChar; this is just the head/body tilt. */

/** What a raider walks to and hits — an enemy bed or the player. */
export interface BwBotTarget {
  pos: THREE.Vector3; // where the raider walks to
  alive(): boolean; // stop attacking once dead / destroyed
  onHit(dmg: number): void; // called each melee swing while in range
}

// Scratch vector reused across the per-frame steering math (no per-raider alloc).
const _tmp = new THREE.Vector3();

/** One live raider: its rig, world position, HP, target, and swing timer. */
interface Raider {
  char: VoxelChar;
  pos: THREE.Vector3;
  hp: number;
  target: BwBotTarget;
  swingCd: number; // seconds until the next swing is allowed
  flash: number; // remaining hit-flash time
  attacking: boolean; // currently in-range + swinging (drives anim state)
}

/**
 * Manager for the handful of raiders alive at once. Add `.group` to the scene,
 * `spawn()` waves, `update(dt)` each frame, and `damageNear()` from bullet
 * impacts. Everything is removed + disposed on `clear()` (mode leave).
 */
/** A block (or other barrier) sitting in a raider's path: walk to it + chew. */
export type BwObstacle = { pos: THREE.Vector3; onHit: (dmg: number) => void } | null;

export class BwBots {
  readonly group = new THREE.Group();
  private raiders: Raider[] = [];
  /** Optional barrier lookup (placed blocks). When it returns a hit for a
   *  raider's position, the raider attacks THAT instead of advancing to its bed. */
  private obstacleFn?: (pos: THREE.Vector3, toward: THREE.Vector3) => BwObstacle;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Register a barrier provider (e.g. BwBlocks.obstacle). */
  setObstacleProvider(fn: (pos: THREE.Vector3, toward: THREE.Vector3) => BwObstacle): void {
    this.obstacleFn = fn;
  }

  /** Number of live raiders. */
  get count(): number {
    return this.raiders.length;
  }

  /**
   * Spawn a raider of `teamColor`, entering the field at `from`, marching to
   * `target`. The body is tinted a menacing (darkened) shade of the team color
   * so allies read at a glance which team a raid belongs to.
   */
  spawn(teamColor: number, from: THREE.Vector3, target: BwBotTarget): void {
    const body = darken(teamColor, 0.7);
    const head = darken(teamColor, 0.5);
    // zombie:true gives the shambling, arms-forward raider silhouette + gait.
    const char = new VoxelChar({ body, head, eye: 0x222222, zombie: true });
    char.setColor(body, head); // also tints legs to match the body
    char.play("walk");

    const pos = from.clone();
    pos.y = 0;
    char.root.position.copy(pos);
    this.group.add(char.root);

    this.raiders.push({
      char,
      pos,
      hp: RAIDER_HP,
      target,
      swingCd: 0,
      flash: 0,
      attacking: false,
    });
  }

  /**
   * Advance every raider: seek its target on the XZ plane, face the move dir,
   * and once within reach stop closing and swing on the cooldown (calling
   * `target.onHit`). If the target is dead/destroyed the raider just keeps
   * walking toward its last position and idles there — the integrator decides
   * when to retarget or despawn it.
   */
  update(dt: number): void {
    for (const r of this.raiders) {
      // A wall in the way takes priority: walk to it + chew through before the
      // raider can resume its march to the bed.
      const ob = this.obstacleFn?.(r.pos, r.target.pos) ?? null;
      const goalPos = ob ? ob.pos : r.target.pos;
      const goalAlive = ob ? true : r.target.alive();
      const onHit = ob ? ob.onHit : r.target.onHit;

      // steer toward the active goal on the ground plane
      _tmp.copy(goalPos).sub(r.pos);
      _tmp.y = 0;
      const dist = _tmp.length();
      if (dist > 0.0001) _tmp.divideScalar(dist); // normalize

      if (r.swingCd > 0) r.swingCd -= dt;

      const inRange = dist <= RAIDER_REACH;
      if (goalAlive && inRange) {
        // in range: stop closing, swing on the cooldown
        r.attacking = true;
        if (r.swingCd <= 0) {
          r.swingCd = RAIDER_SWING_CD;
          onHit(RAIDER_SWING_DMG);
          // re-trigger the attack anim each swing (once-shot, falls back to idle)
          r.char.play("attack", { once: true });
        }
      } else {
        // out of range (or target gone): walk toward the (last) target pos
        r.attacking = false;
        if (dist > 0.0001) {
          r.pos.addScaledVector(_tmp, RAIDER_SPEED * dt);
          r.pos.y = 0;
        }
        r.char.play("walk");
        // face the direction of travel (atan2(x,z) matches the rig's forward +Z)
        r.char.root.rotation.y = Math.atan2(_tmp.x, _tmp.z);
      }

      r.char.root.position.copy(r.pos);

      // decay the hit flash (red emissive pulse on bullet impact)
      if (r.flash > 0) {
        r.flash -= dt;
        r.char.setHitFlash(Math.max(0, r.flash / 0.12));
      }

      r.char.update(dt);
    }
  }

  /**
   * Damage any raiders within `radius` of `pos` (e.g. a bullet impact). Killed
   * raiders (hp <= 0) are removed from the group, disposed, and dropped from
   * the live list. Returns how many were KILLED this call (for score/cleanup).
   */
  damageNear(pos: THREE.Vector3, radius: number, dmg: number): number {
    const r2 = radius * radius;
    let kills = 0;
    // iterate back-to-front so splice-on-death doesn't skip the next raider
    for (let i = this.raiders.length - 1; i >= 0; i--) {
      const r = this.raiders[i];
      const dx = r.pos.x - pos.x;
      const dz = r.pos.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      r.hp -= dmg;
      r.flash = 0.12; // brief hit-flash so the hit reads
      r.char.setHitFlash(1);
      if (r.hp <= 0) {
        this.disposeRaider(r);
        this.raiders.splice(i, 1);
        kills++;
      }
    }
    return kills;
  }

  /** World positions + HP of live raiders, so the integrator can resolve hits. */
  positions(): { pos: THREE.Vector3; hp: number }[] {
    return this.raiders.map((r) => ({ pos: r.pos, hp: r.hp }));
  }

  /** Remove + dispose every raider (on mode leave). */
  clear(): void {
    for (const r of this.raiders) this.disposeRaider(r);
    this.raiders.length = 0;
  }

  /** Detach a raider's rig and free its GPU resources. */
  private disposeRaider(r: Raider): void {
    this.group.remove(r.char.root);
    // VoxelChar has no dispose(); walk its tree and free geometry + materials.
    r.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat?.dispose?.();
    });
  }
}

/** Darken a hex color by `f` (0..1) — used to make a team color read menacing. */
function darken(color: number, f: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * f);
  const g = Math.floor(((color >> 8) & 0xff) * f);
  const b = Math.floor((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}
