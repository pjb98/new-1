import * as THREE from "three";
import { VoxelChar } from "../voxelChar";

/**
 * Bed Wars-lite DREAM DEFENDER (Iron Golem) ALLY.
 *
 * A Dream Defender is a friendly voxel golem you summon at your base. It is a
 * temporary guardian: it patrols near its `home`, charges the NEAREST enemy
 * raider inside a leash radius, melees it on a swing cooldown, and otherwise
 * idles back home. Like the survival `Zombie` / raider rig it seeks on the XZ
 * plane, faces the move direction, and walk-bobs via the shared `VoxelChar`.
 *
 * The golem reads as iron/stone-grey blended with your team color so it never
 * gets mistaken for an enemy raider. It is invulnerable (no HP) by design and
 * just expires after a finite lifespan — the integrator owns the scene, the
 * player, the raiders, and applies the damage events this returns.
 */

// ---- tuning (exposed as consts so the integrator can read the numbers) ----
/** Ground move speed, units per second. A touch slower than a raider. */
export const GOLEM_SPEED = 2.6;
/** How close (XZ) the golem must be to a raider before it stops + swings. */
export const GOLEM_REACH = 1.6;
/** Seconds between melee swings. */
export const GOLEM_SWING_CD = 0.7;
/** Damage dealt to the targeted raider per swing (heavy iron-fist hit). */
export const GOLEM_SWING_DMG = 14;
/** Lifespan in seconds before the Dream Defender despawns. */
export const GOLEM_LIFE = 30;
/** Leash radius around `home`: the golem only chases raiders within this. */
export const GOLEM_LEASH = 10;

// Scratch vectors reused across the per-frame steering math (no per-golem alloc).
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();

/** One live golem: its rig, world position, home, swing + life timers. */
interface Golem {
  char: VoxelChar;
  pos: THREE.Vector3;
  home: THREE.Vector3;
  swingCd: number; // seconds until the next swing is allowed
  life: number; // seconds of lifespan remaining
  flash: number; // remaining attack-flash time
  attacking: boolean; // currently in-range + swinging (drives anim state)
}

/**
 * Manager for the Dream Defenders alive at once. Add `.group` to the scene,
 * `spawn()` a golem when summoned, `update(dt, raiders)` each frame (applying
 * the returned damage events to your raiders), and `clear()` on mode leave.
 */
export class BwGolems {
  readonly group = new THREE.Group();
  private golems: Golem[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Number of live golems. */
  get count(): number {
    return this.golems.length;
  }

  /**
   * Summon a Dream Defender of `teamColor` near `home`, lasting `life` seconds
   * (default {@link GOLEM_LIFE}). The body is an iron/stone grey lightly tinted
   * toward the team color (and lightened) so it reads as a friendly ally rather
   * than an enemy raider. It is NOT a zombie rig — upright, non-shambling.
   */
  spawn(teamColor: number, home: THREE.Vector3, life = GOLEM_LIFE): void {
    // Iron-grey base blended toward (a lightened) team color so allies read it.
    const tint = lighten(teamColor, 0.4);
    const body = blend(0x9a9a9a, tint, 0.35);
    const head = blend(0xb0b0b0, tint, 0.25);
    const char = new VoxelChar({ body, head, eye: 0x335577 });
    char.setColor(body, head); // also tints legs to match the body
    char.play("idle");

    const pos = home.clone();
    pos.y = 0;
    char.root.position.copy(pos);
    this.group.add(char.root);

    this.golems.push({
      char,
      pos,
      home: home.clone().setY(0),
      swingCd: 0,
      life,
      flash: 0,
      attacking: false,
    });
  }

  /**
   * Advance every golem: pick the NEAREST raider within {@link GOLEM_LEASH} of
   * home, charge it on the XZ plane, and once within {@link GOLEM_REACH} stop
   * and swing on the cooldown — emitting a `{ pos, dmg }` event the integrator
   * applies to that raider. With no raider in range the golem walks back toward
   * home and idles. Lifespan ticks down; expired golems are disposed + removed.
   * Returns every damage event produced this frame across all golems.
   */
  update(
    dt: number,
    raiders: { pos: THREE.Vector3 }[],
  ): { pos: THREE.Vector3; dmg: number }[] {
    const events: { pos: THREE.Vector3; dmg: number }[] = [];
    const leash2 = GOLEM_LEASH * GOLEM_LEASH;

    // iterate back-to-front so splice-on-expiry doesn't skip the next golem
    for (let i = this.golems.length - 1; i >= 0; i--) {
      const g = this.golems[i];

      // expire first so a dying golem doesn't get a free last swing
      g.life -= dt;
      if (g.life <= 0) {
        this.disposeGolem(g);
        this.golems.splice(i, 1);
        continue;
      }

      if (g.swingCd > 0) g.swingCd -= dt;

      // find the nearest raider within the leash radius of HOME (stay close)
      let target: { pos: THREE.Vector3 } | null = null;
      let bestDist = Infinity;
      for (const raider of raiders) {
        _tmp2.copy(raider.pos).sub(g.home);
        _tmp2.y = 0;
        const homeDist2 = _tmp2.lengthSq();
        if (homeDist2 > leash2) continue; // outside the leash, ignore
        _tmp2.copy(raider.pos).sub(g.pos);
        _tmp2.y = 0;
        const d2 = _tmp2.lengthSq();
        if (d2 < bestDist) {
          bestDist = d2;
          target = raider;
        }
      }

      if (target) {
        // steer toward the targeted raider on the ground plane
        _tmp.copy(target.pos).sub(g.pos);
        _tmp.y = 0;
        const dist = _tmp.length();
        if (dist > 0.0001) _tmp.divideScalar(dist); // normalize

        if (dist <= GOLEM_REACH) {
          // in range: stop closing, swing on the cooldown
          g.attacking = true;
          if (g.swingCd <= 0) {
            g.swingCd = GOLEM_SWING_CD;
            events.push({ pos: target.pos, dmg: GOLEM_SWING_DMG });
            g.char.play("attack", { once: true });
            g.flash = 0.12;
            g.char.setHitFlash(1);
          }
        } else {
          // close the gap, facing the direction of travel
          g.attacking = false;
          g.pos.addScaledVector(_tmp, GOLEM_SPEED * dt);
          g.pos.y = 0;
          g.char.play("walk");
          g.char.root.rotation.y = Math.atan2(_tmp.x, _tmp.z);
        }
      } else {
        // no raider in range: head back toward home, idle once arrived
        g.attacking = false;
        _tmp.copy(g.home).sub(g.pos);
        _tmp.y = 0;
        const dist = _tmp.length();
        if (dist > GOLEM_REACH) {
          _tmp.divideScalar(dist); // normalize
          g.pos.addScaledVector(_tmp, GOLEM_SPEED * dt);
          g.pos.y = 0;
          g.char.play("walk");
          g.char.root.rotation.y = Math.atan2(_tmp.x, _tmp.z);
        } else {
          g.char.play("idle");
        }
      }

      g.char.root.position.copy(g.pos);

      // decay the attack flash (brief emissive pulse on each swing)
      if (g.flash > 0) {
        g.flash -= dt;
        g.char.setHitFlash(Math.max(0, g.flash / 0.12));
      }

      g.char.update(dt);
    }

    return events;
  }

  /** Remove + dispose every golem (on mode leave). */
  clear(): void {
    for (const g of this.golems) this.disposeGolem(g);
    this.golems.length = 0;
  }

  /** Detach a golem's rig and free its GPU resources. */
  private disposeGolem(g: Golem): void {
    this.group.remove(g.char.root);
    // VoxelChar has no dispose(); walk its tree and free geometry + materials.
    g.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat?.dispose?.();
    });
  }
}

/** Lighten a hex color toward white by `f` (0..1). */
function lighten(color: number, f: number): number {
  return blend(color, 0xffffff, f);
}

/** Linearly blend hex color `a` toward `b` by `t` (0..1), per channel. */
function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
