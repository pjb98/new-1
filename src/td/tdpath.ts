/**
 * Tower-Defense PATH — the fixed route creeps walk from spawn to your base.
 *
 * Pure geometry (no THREE / no DOM): a polyline of waypoints plus arc-length
 * helpers, so enemies advance by a single scalar "distance travelled" and the
 * map/renderer and the unit tests all agree on exactly where the lane runs.
 *
 * The map renders tiles along TD_PATH, drops build pads at TD_PADS, and marks
 * the base at TD_GOAL; enemies sample pointAt(TD_PATH, dist) each frame.
 */

export interface Vec2 { x: number; z: number }

/** Waypoints of the lane, spawn → base. The first point is off the west edge so
 *  creeps walk in; the last is the base you defend. A tidy serpentine. */
export const TD_PATH: Vec2[] = [
  { x: -30, z: -16 },
  { x: 18, z: -16 },
  { x: 18, z: -4 },
  { x: -18, z: -4 },
  { x: -18, z: 8 },
  { x: 18, z: 8 },
  { x: 18, z: 22 },
];

/** Where creeps enter and where they're heading (the base/core). */
export const TD_SPAWN: Vec2 = TD_PATH[0];
export const TD_GOAL: Vec2 = TD_PATH[TD_PATH.length - 1];

/** Buildable pads flanking the lane — towers may only be raised on these. */
export const TD_PADS: Vec2[] = [
  { x: -12, z: -10 }, { x: 0, z: -10 }, { x: 12, z: -10 },
  { x: -12, z: 2 }, { x: 0, z: 2 }, { x: 12, z: 2 },
  { x: -12, z: 14 }, { x: 0, z: 14 }, { x: 12, z: 14 },
  { x: -26, z: -10 }, { x: -26, z: 2 }, { x: 6, z: 16 },
];

/** Total arc length of the lane (sum of segment lengths). */
export function pathLength(path: Vec2[] = TD_PATH): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
  return total;
}

/**
 * Position at arc-length `d` along the polyline, plus whether the end was
 * reached. Clamps to the spawn before 0 and to the goal at/after the full
 * length (with `done: true`), so callers can treat "done" as "leaked into base".
 */
export function pointAt(d: number, path: Vec2[] = TD_PATH): { x: number; z: number; done: boolean } {
  if (d <= 0) return { x: path[0].x, z: path[0].z, done: false };
  const end = path[path.length - 1];
  if (d >= pathLength(path)) return { x: end.x, z: end.z, done: true };
  let remaining = d;
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (remaining <= seg) {
      const t = seg > 0 ? remaining / seg : 0;
      return {
        x: lerp(path[i - 1].x, path[i].x, t),
        z: lerp(path[i - 1].z, path[i].z, t),
        done: false,
      };
    }
    remaining -= seg;
  }
  return { x: end.x, z: end.z, done: true };
}

/** Unit heading (dx,dz) of the lane at arc-length `d` — for facing creeps. */
export function headingAt(d: number, path: Vec2[] = TD_PATH): { dx: number; dz: number } {
  let remaining = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (remaining <= seg || i === path.length - 1) {
      const dx = path[i].x - path[i - 1].x;
      const dz = path[i].z - path[i - 1].z;
      const len = Math.hypot(dx, dz) || 1;
      return { dx: dx / len, dz: dz / len };
    }
    remaining -= seg;
  }
  return { dx: 1, dz: 0 };
}

function dist(a: Vec2, b: Vec2): number { return Math.hypot(b.x - a.x, b.z - a.z); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
