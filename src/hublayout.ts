/**
 * Lobby HUB LAYOUT — the hub-and-spoke geometry: a big MAIN ISLAND with floating
 * game-mode satellite islands around it, each joined by a bridge.
 *
 * Pure math (no THREE / no DOM), so the walkable region — main disc ∪ bridges ∪
 * satellite discs — is unit-testable. island.ts reads SATELLITES to build the
 * platforms/bridges/labels and routes player movement through clampToHub().
 */

export interface HVec { x: number; z: number }

export interface Satellite {
  id: string;
  label: string;
  color: number;
  kind: string;       // island-zone kind dispatched on entry ("zombies" | "td" | "soon")
  center: HVec;
  radius: number;     // platform radius
}

/** Walkable radius of the main island (kept in step with island shore reach). */
export const MAIN_R = 40.8;
/** Half-width of a bridge corridor. */
export const BRIDGE_HW = 3.2;
/** How far a bridge reaches back INTO the main disc (overlap for a seamless join). */
export const BRIDGE_OVERLAP = 5;
/** Distance from world origin to each satellite centre (clears the main island,
 *  whose ground reaches ~48, leaving open water for a bridge to span). */
const SAT_DIST = 64;
/** Uniform satellite platform radius — same size islands read as evenly placed. */
const SAT_R = 12;

/** Place a satellite centre on a fan around NORTH (-z): `deg` east of north. */
function fan(deg: number, d = SAT_DIST): HVec {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * d, z: -Math.cos(a) * d };
}

// -z is "north" (the camera looks down -z); the player spawns to the south. An
// even fan of three across the top arc, symmetric about north.
export const SATELLITES: Satellite[] = [
  { id: "sat_zombies", label: "ZOMBIES", color: 0x8be36b, kind: "zombies", center: fan(-46), radius: SAT_R },
  { id: "sat_td", label: "TOWER DEFENSE", color: 0x7fd4ff, kind: "td", center: fan(0), radius: SAT_R },
  { id: "sat_soon", label: "COMING SOON", color: 0xc9b6ff, kind: "soon", center: fan(46), radius: SAT_R },
];

function len(v: HVec): number { return Math.hypot(v.x, v.z); }
function inDisc(x: number, z: number, cx: number, cz: number, r: number): boolean {
  const dx = x - cx, dz = z - cz; return dx * dx + dz * dz <= r * r;
}

/** Bridge axis basis for a satellite: unit direction out + left perpendicular. */
function bridgeBasis(s: Satellite): { dx: number; dz: number; px: number; pz: number; tEnd: number } {
  const d = len(s.center) || 1;
  const dx = s.center.x / d, dz = s.center.z / d;
  return { dx, dz, px: -dz, pz: dx, tEnd: d };
}

function inBridge(x: number, z: number, s: Satellite): boolean {
  const b = bridgeBasis(s);
  const t = x * b.dx + z * b.dz;          // distance along the axis
  const perp = x * b.px + z * b.pz;       // signed distance across it
  return t >= MAIN_R - BRIDGE_OVERLAP && t <= b.tEnd && Math.abs(perp) <= BRIDGE_HW;
}

/** Is (x,z) anywhere on the walkable hub (main ∪ bridges ∪ satellites)? */
export function inHub(x: number, z: number): boolean {
  if (inDisc(x, z, 0, 0, MAIN_R)) return true;
  for (const s of SATELLITES) {
    if (inDisc(x, z, s.center.x, s.center.z, s.radius - 1.2)) return true;
    if (inBridge(x, z, s)) return true;
  }
  return false;
}

function clampDisc(x: number, z: number, cx: number, cz: number, r: number): HVec {
  const dx = x - cx, dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d <= r || d === 0) return { x, z };
  return { x: cx + (dx / d) * r, z: cz + (dz / d) * r };
}

function clampBridge(x: number, z: number, s: Satellite): HVec {
  const b = bridgeBasis(s);
  let t = x * b.dx + z * b.dz;
  let perp = x * b.px + z * b.pz;
  t = Math.max(MAIN_R - BRIDGE_OVERLAP, Math.min(b.tEnd, t));
  perp = Math.max(-BRIDGE_HW, Math.min(BRIDGE_HW, perp));
  return { x: b.dx * t + b.px * perp, z: b.dz * t + b.pz * perp };
}

/**
 * Keep a position inside the walkable hub. If already in any region it's
 * returned unchanged; otherwise it snaps to the nearest region boundary (main
 * disc, a satellite disc, or a bridge corridor), so the player slides along
 * edges rather than getting stuck.
 */
export function clampToHub(x: number, z: number): HVec {
  if (inHub(x, z)) return { x, z };
  let best = clampDisc(x, z, 0, 0, MAIN_R);
  let bestD = (x - best.x) ** 2 + (z - best.z) ** 2;
  const consider = (c: HVec) => {
    const d = (x - c.x) ** 2 + (z - c.z) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  };
  for (const s of SATELLITES) {
    consider(clampDisc(x, z, s.center.x, s.center.z, s.radius - 1.2));
    consider(clampBridge(x, z, s));
  }
  return best;
}
