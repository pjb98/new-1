import * as THREE from "three";
import { voxelMaterial, glowMaterial } from "../palette";

/**
 * Bed Wars-lite SUDDEN-DEATH ENDER DRAGONS.
 *
 * When a match drags on, the arena summons dragons: charming flat-shaded voxel
 * beasts that orbit the map at altitude and periodically SWOOP at the nearest
 * target (player, golem, raider...) to deal a chunk of damage, then climb back
 * to cruising height and resume their lazy circle. They model their structure
 * on the survival-mode `BwBots` manager: add `.group` to the scene, `spawn()`
 * a dragon, `update(dt, targets)` each frame, and `clear()` on mode leave.
 *
 * Dragons are intentionally INVULNERABLE — they're a sudden-death pressure
 * mechanic, not a kill target — so there's no HP tracking or `damageNear`.
 * The integrator owns the scene, the player, and the bot raiders; this module
 * just owns the dragons and emits damage events for the integrator to apply.
 */

// ---- tuning (exposed as consts so the integrator can read the numbers) ----
/** Cruising orbit speed, radians per second around the map center. */
export const DRAGON_SPEED = 0.45;
/** Damage dealt by one swoop hit on a target. */
export const DRAGON_SWOOP_DMG = 12;
/** Cruising altitude (world Y) the dragon circles at between swoops. */
export const DRAGON_ALTITUDE = 7.5;
/** Seconds between swoop attacks (per dragon). */
export const SWOOP_CD = 3.5;
/** Orbit radius (XZ) around the map center while cruising. */
export const DRAGON_ORBIT_RADIUS = 11;
/** XZ distance to a target within which a low dragon lands a swoop hit. */
export const DRAGON_STRIKE_REACH = 2.4;
/** Altitude the dragon dives down to at the bottom of a swoop. */
export const DRAGON_SWOOP_LOW = 1.6;

// Scratch vectors reused across the per-frame steering math (no per-dragon alloc).
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();

/** Swoop state machine: lazy circle, dive at a target, then climb back up. */
type Phase = "orbit" | "dive" | "climb";

/** One live dragon: its rig, orbit params, target, and swoop timers. */
interface Dragon {
  root: THREE.Group;
  wingL: THREE.Group;
  wingR: THREE.Group;
  center: THREE.Vector3; // the map point it orbits
  angle: number; // current orbit angle (radians)
  radius: number; // orbit radius (XZ)
  phase: Phase;
  swoopCd: number; // seconds until the next swoop is allowed
  dmgDone: boolean; // already landed a hit this swoop (one hit per dive)
  target: THREE.Vector3 | null; // locked target position for the current dive
  flap: number; // wing-flap phase accumulator
  bob: number; // body-bob phase accumulator
}

/**
 * Manager for the handful of dragons aloft at once. Add `.group` to the scene,
 * `spawn()` them in, `update(dt, targets)` each frame to advance the swoops and
 * collect damage events, and `clear()` to remove + dispose everything.
 */
export class BwDragons {
  readonly group = new THREE.Group();
  private dragons: Dragon[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Number of dragons aloft. */
  get count(): number {
    return this.dragons.length;
  }

  /**
   * Spawn one dragon tinted with `color`, orbiting the map center `around`. It
   * starts at cruising altitude on its orbit ring, mid-flight.
   */
  spawn(color: number, around: THREE.Vector3): void {
    const root = this.buildDragon(color);
    const center = around.clone();

    // start at a random angle on the orbit ring, at cruising altitude
    const angle = Math.random() * Math.PI * 2;
    const radius = DRAGON_ORBIT_RADIUS;
    const pos = new THREE.Vector3(
      center.x + Math.cos(angle) * radius,
      center.y + DRAGON_ALTITUDE,
      center.z + Math.sin(angle) * radius,
    );
    root.position.copy(pos);
    this.group.add(root);

    // grab the wing pivots built in buildDragon (named for lookup)
    const wingL = root.getObjectByName("wingL") as THREE.Group;
    const wingR = root.getObjectByName("wingR") as THREE.Group;

    this.dragons.push({
      root,
      wingL,
      wingR,
      center,
      angle,
      radius,
      phase: "orbit",
      swoopCd: SWOOP_CD * (0.5 + Math.random() * 0.5), // stagger first swoops
      dmgDone: false,
      target: null,
      flap: Math.random() * Math.PI * 2,
      bob: Math.random() * Math.PI * 2,
    });
  }

  /**
   * Advance every dragon and return this frame's swoop damage events. While
   * cruising, a dragon circles the arena at altitude. On its cooldown it locks
   * the nearest `target`, DIVES toward it, and emits one `{ pos, dmg }` event
   * when it gets low and close enough — then CLIMBS back to cruising altitude
   * and resumes the orbit. Wing-flap and body-bob animate every frame.
   */
  update(
    dt: number,
    targets: { pos: THREE.Vector3 }[],
  ): { pos: THREE.Vector3; dmg: number }[] {
    const hits: { pos: THREE.Vector3; dmg: number }[] = [];

    for (const d of this.dragons) {
      // --- wing-flap + body-bob (always) ---
      d.flap += dt * 6;
      d.bob += dt * 2;
      const flapAmt = Math.sin(d.flap) * 0.6;
      d.wingL.rotation.z = -0.2 - flapAmt;
      d.wingR.rotation.z = 0.2 + flapAmt;

      if (d.swoopCd > 0) d.swoopCd -= dt;

      if (d.phase === "orbit") {
        this.cruise(d, dt);
        // time to attack? lock the nearest target and start a dive.
        if (d.swoopCd <= 0) {
          const t = nearest(targets, d.root.position);
          if (t) {
            d.target = t;
            d.phase = "dive";
            d.dmgDone = false;
          } else {
            // no targets — wait a beat before checking again
            d.swoopCd = 1;
          }
        }
      } else if (d.phase === "dive") {
        this.dive(d, dt, hits);
      } else {
        this.climb(d, dt);
      }
    }

    return hits;
  }

  /** Lazy orbit at cruising altitude, with a gentle vertical bob. */
  private cruise(d: Dragon, dt: number): void {
    d.angle += DRAGON_SPEED * dt;
    const bobY = Math.sin(d.bob) * 0.35;
    _tmp.set(
      d.center.x + Math.cos(d.angle) * d.radius,
      d.center.y + DRAGON_ALTITUDE + bobY,
      d.center.z + Math.sin(d.angle) * d.radius,
    );
    this.steerTo(d, _tmp, dt, 4);
  }

  /** Descend toward the locked target; emit a hit when low + close. */
  private dive(
    d: Dragon,
    dt: number,
    hits: { pos: THREE.Vector3; dmg: number }[],
  ): void {
    const target = d.target;
    if (!target) {
      d.phase = "climb";
      return;
    }

    // aim point: the target on the ground plane, at swoop-low altitude
    _tmp.set(target.x, d.center.y + DRAGON_SWOOP_LOW, target.z);
    this.steerTo(d, _tmp, dt, 7);

    // landed hit? must be low enough AND close enough on XZ, once per dive.
    if (!d.dmgDone) {
      _tmp2.copy(d.root.position).sub(target);
      const dy = d.root.position.y - (d.center.y + DRAGON_SWOOP_LOW);
      _tmp2.y = 0;
      const lowEnough = dy < 1.2;
      if (lowEnough && _tmp2.length() <= DRAGON_STRIKE_REACH) {
        hits.push({ pos: target.clone(), dmg: DRAGON_SWOOP_DMG });
        d.dmgDone = true;
        d.phase = "climb"; // pull up after the strike
      }
    }

    // missed (overshot / target moved): pull up once we've bottomed out anyway
    if (
      d.phase === "dive" &&
      d.root.position.y <= d.center.y + DRAGON_SWOOP_LOW + 0.4
    ) {
      d.phase = "climb";
    }
  }

  /** Climb back to cruising altitude, then re-snap to the orbit and resume. */
  private climb(d: Dragon, dt: number): void {
    // climb straight back up over the current XZ position
    _tmp.set(
      d.root.position.x,
      d.center.y + DRAGON_ALTITUDE,
      d.root.position.z,
    );
    this.steerTo(d, _tmp, dt, 6);

    if (d.root.position.y >= d.center.y + DRAGON_ALTITUDE - 0.4) {
      // back at altitude: re-derive the orbit angle from current XZ so the
      // circle resumes smoothly from wherever we ended up.
      d.angle = Math.atan2(
        d.root.position.z - d.center.z,
        d.root.position.x - d.center.x,
      );
      d.phase = "orbit";
      d.target = null;
      d.swoopCd = SWOOP_CD;
    }
  }

  /**
   * Move the dragon toward world point `to` at up to `speed` units/sec and face
   * the direction of travel. Shared by cruise / dive / climb so motion reads
   * consistently. Yaw uses atan2(dx, dz) to match the rig's forward (+Z).
   */
  private steerTo(d: Dragon, to: THREE.Vector3, dt: number, speed: number): void {
    _tmp2.copy(to).sub(d.root.position);
    const dist = _tmp2.length();
    if (dist > 0.0001) {
      const step = Math.min(dist, speed * dt);
      _tmp2.divideScalar(dist); // normalize
      d.root.position.addScaledVector(_tmp2, step);
      // face travel direction on the XZ plane (ignore vertical for yaw)
      if (Math.abs(_tmp2.x) > 0.0001 || Math.abs(_tmp2.z) > 0.0001) {
        d.root.rotation.y = Math.atan2(_tmp2.x, _tmp2.z);
      }
      // gentle pitch with vertical velocity so dives/climbs read in the body
      d.root.rotation.x = THREE.MathUtils.clamp(-_tmp2.y * 0.5, -0.5, 0.5);
    }
  }

  /** Remove + dispose every dragon (on mode leave). */
  clear(): void {
    for (const d of this.dragons) this.disposeDragon(d);
    this.dragons.length = 0;
  }

  /** Detach a dragon's rig and free its GPU resources. */
  private disposeDragon(d: Dragon): void {
    this.group.remove(d.root);
    d.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat?.dispose?.();
    });
  }

  /**
   * Build a charming flat-shaded voxel dragon tinted with `color`: a chunky
   * body, a head with glowing eyes, a tapering tail of shrinking segments, and
   * two wing pivots (named "wingL"/"wingR") that the manager flaps each frame.
   * The whole thing faces +Z (its yaw is driven in `steerTo`).
   */
  private buildDragon(color: number): THREE.Group {
    const root = new THREE.Group();

    const bodyMat = voxelMaterial(color);
    const bellyMat = voxelMaterial(lighten(color, 1.25));
    const wingMat = voxelMaterial(darken(color, 0.7));
    const eyeMat = glowMaterial(0xffd24a, 1.2);

    const box = (
      w: number,
      h: number,
      l: number,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    // --- body (chunky core), forward is +Z ---
    root.add(box(1.4, 1.2, 2.2, bodyMat, 0, 0, 0));
    root.add(box(0.9, 0.4, 1.6, bellyMat, 0, -0.5, 0.1)); // pale belly underside

    // --- neck + head out front ---
    root.add(box(0.7, 0.7, 0.8, bodyMat, 0, 0.35, 1.3)); // neck
    const head = box(0.9, 0.8, 1.0, bodyMat, 0, 0.6, 2.1);
    root.add(head);
    // snout
    root.add(box(0.6, 0.45, 0.6, bodyMat, 0, 0.45, 2.7));
    // glowing eyes (caught by bloom)
    root.add(box(0.18, 0.18, 0.12, eyeMat, 0.3, 0.75, 2.55));
    root.add(box(0.18, 0.18, 0.12, eyeMat, -0.3, 0.75, 2.55));
    // little horns
    root.add(box(0.16, 0.5, 0.16, wingMat, 0.28, 1.1, 1.95));
    root.add(box(0.16, 0.5, 0.16, wingMat, -0.28, 1.1, 1.95));

    // --- tapering tail of shrinking segments, trailing -Z ---
    const segs = 4;
    let z = -1.2;
    for (let i = 0; i < segs; i++) {
      const f = 1 - i / (segs + 1); // shrink factor
      const w = 0.9 * f;
      const h = 0.8 * f;
      const len = 0.6;
      root.add(box(w, h, len, bodyMat, 0, 0, z));
      z -= len * 0.9;
    }
    // tail-tip fin
    root.add(box(0.6, 0.5, 0.3, wingMat, 0, 0, z));

    // --- wings: pivot groups at the shoulders so flap rotates from the body ---
    const wingL = new THREE.Group();
    wingL.name = "wingL";
    wingL.position.set(0.65, 0.45, -0.1);
    // wing planks extend outward along -X from the pivot
    wingL.add(box(1.8, 0.12, 1.4, wingMat, -0.9, 0, 0));
    wingL.add(box(0.6, 0.14, 1.8, wingMat, -1.7, 0, -0.2)); // outer tip
    wingL.rotation.z = -0.2;
    root.add(wingL);

    const wingR = new THREE.Group();
    wingR.name = "wingR";
    wingR.position.set(-0.65, 0.45, -0.1);
    wingR.add(box(1.8, 0.12, 1.4, wingMat, 0.9, 0, 0));
    wingR.add(box(0.6, 0.14, 1.8, wingMat, 1.7, 0, -0.2));
    wingR.rotation.z = 0.2;
    root.add(wingR);

    return root;
  }
}

/** Nearest target position to `from` on the XZ plane, or null if none. */
function nearest(
  targets: { pos: THREE.Vector3 }[],
  from: THREE.Vector3,
): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    const dx = t.pos.x - from.x;
    const dz = t.pos.z - from.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = t.pos;
    }
  }
  return best;
}

/** Darken a hex color by `f` (0..1) — for wing/horn shading. */
function darken(color: number, f: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * f);
  const g = Math.floor(((color >> 8) & 0xff) * f);
  const b = Math.floor((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** Lighten a hex color by factor `f` (>1) — for the pale belly underside. */
function lighten(color: number, f: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.floor((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}
