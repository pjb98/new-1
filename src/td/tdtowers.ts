/**
 * Tower-Defense TOWERS — catalog, upgrade ladder, abilities, targeting.
 *
 * Pure data + logic (no THREE / no DOM), unit-testable. The renderer reads
 * TD_TOWERS for build options, calls towerStats() each shot (which now returns
 * the live ABILITY kit too), and uses pickTarget with the tower's TdTargetMode.
 *
 * Seven archetypes, each the answer to a different creep — and each blossoming
 * into a signature ABILITY at the final tier (research-driven: Bloons crosspath
 * power-spikes + archetype counters):
 *   arrow  — fast single-target darts → t4 MULTISHOT (forks to 3 creeps) + crits.
 *   frost  — slows + light damage → t4 DEEP FREEZE (briefly stuns).
 *   pylon  — DETECTOR that reveals camo + light splash → t4 OVERCHARGE AURA
 *            (amplifies the damage of every tower in range).
 *   cannon — slow heavy AREA splash, ignores armor → t4 INCENDIARY (burning DoT).
 *   sniper — long range, huge single hits, ignores armor → t4 EXECUTE (big crits).
 *   tesla  — chains lightning between packed creeps; the swarm shredder.
 *   venom  — toxic clouds that POISON over time, ignoring armor; melts tanks,
 *            armored & regrowers that shrug off burst.
 */

export type TdTowerId = "arrow" | "frost" | "cannon" | "sniper" | "pylon" | "tesla" | "venom";

/** Per-tower target priority (Bloons standard set). */
export type TdTargetMode = "first" | "last" | "strong" | "close";
export const TD_TARGET_MODES: TdTargetMode[] = ["first", "last", "strong", "close"];
export function tdTargetLabel(m: TdTargetMode): string {
  return m === "first" ? "First" : m === "last" ? "Last" : m === "strong" ? "Strong" : "Close";
}

export interface TdTowerDef {
  id: TdTowerId;
  name: string;
  cost: number;       // gold to build (tier 1)
  range: number;
  fireRate: number;   // shots per second
  damage: number;
  splash: number;     // splash radius (0 = single target)
  slow: number;       // slow factor applied on hit (0 = none)
  slowTime: number;   // seconds the slow lasts
  pierce: boolean;    // true = ignores creep armor
  detect: boolean;    // true = reveals camo creeps within range
  defaultTarget: TdTargetMode;
  color: number;
  /** Signature-ability headline shown on the build/upgrade card. */
  ability: string;
  desc: string;
}

export const TD_TOWERS: Record<TdTowerId, TdTowerDef> = {
  arrow: {
    id: "arrow", name: "Arrow Tower", cost: 50,
    range: 11, fireRate: 2.4, damage: 12, splash: 0, slow: 0, slowTime: 0,
    pierce: false, detect: false, defaultTarget: "first",
    color: 0x9fe0a0, ability: "Multishot",
    desc: "Fast single-target darts. Crits scale with tier; T4 forks to 3 creeps.",
  },
  frost: {
    id: "frost", name: "Frost Tower", cost: 75,
    range: 9, fireRate: 1.2, damage: 6, splash: 0, slow: 0.5, slowTime: 1.6,
    pierce: false, detect: false, defaultTarget: "first",
    color: 0x7fd4ff, ability: "Deep Freeze",
    desc: "Chills creeps to a crawl. Huge tempo; T4 flash-freezes (stuns) on hit.",
  },
  pylon: {
    id: "pylon", name: "Detector Pylon", cost: 90,
    range: 10, fireRate: 1.0, damage: 5, splash: 2.0, slow: 0, slowTime: 0,
    pierce: false, detect: true, defaultTarget: "close",
    color: 0xc89bff, ability: "Overcharge",
    desc: "Reveals CAMO creeps + light splash. T4 aura amps every tower in range.",
  },
  cannon: {
    id: "cannon", name: "Cannon", cost: 110,
    range: 9.5, fireRate: 0.75, damage: 30, splash: 3.2, slow: 0, slowTime: 0,
    pierce: true, detect: false, defaultTarget: "first",
    color: 0xff9d5c, ability: "Incendiary",
    desc: "Heavy armor-piercing splash. Clears swarms; T4 sets the ground ablaze.",
  },
  sniper: {
    id: "sniper", name: "Sniper Nest", cost: 150,
    range: 22, fireRate: 0.6, damage: 95, splash: 0, slow: 0, slowTime: 0,
    pierce: true, detect: false, defaultTarget: "strong",
    color: 0xffd24a, ability: "Execute",
    desc: "Map-wide armor-piercing hits. The boss answer; T4 lands brutal crits.",
  },
  tesla: {
    id: "tesla", name: "Tesla Coil", cost: 130,
    range: 10, fireRate: 1.6, damage: 14, splash: 0, slow: 0, slowTime: 0,
    pierce: false, detect: false, defaultTarget: "close",
    color: 0x66fff0, ability: "Chain Arc",
    desc: "Forks lightning between packed creeps. The swarm shredder; chains grow per tier.",
  },
  venom: {
    id: "venom", name: "Venom Spire", cost: 100,
    range: 9, fireRate: 1.0, damage: 8, splash: 1.4, slow: 0, slowTime: 0,
    pierce: true, detect: false, defaultTarget: "first",
    color: 0xbaff5a, ability: "Plague",
    desc: "Toxic clouds POISON over time, ignoring armor. Melts tanks & regrowers.",
  },
};

export const TD_TOWER_IDS: TdTowerId[] = ["arrow", "frost", "pylon", "cannon", "sniper", "tesla", "venom"];

/** Max upgrade tier (1 = freshly built; 4 unlocks the signature ability). */
export const TD_MAX_TIER = 4;

export function tdTower(id: TdTowerId): TdTowerDef { return TD_TOWERS[id]; }

/** Cost to upgrade FROM tier `tier` to the next, indexed by the step. */
const UPGRADE_MUL = [0.85, 1.4, 2.4]; // 1→2, 2→3, 3→4 (×base cost)

/** Gold to upgrade FROM the given tier to the next; null at max tier. */
export function tdUpgradeCost(id: TdTowerId, tier: number): number | null {
  if (tier >= TD_MAX_TIER) return null;
  const step = UPGRADE_MUL[tier - 1] ?? UPGRADE_MUL[UPGRADE_MUL.length - 1];
  return Math.round(TD_TOWERS[id].cost * step);
}

/** Gold refunded when a tower is sold — 75% of total invested, rounded. */
export function tdSellValue(id: TdTowerId, tier: number): number {
  let spent = TD_TOWERS[id].cost;
  for (let t = 1; t < tier; t++) spent += tdUpgradeCost(id, t) ?? 0;
  return Math.round(spent * 0.75);
}

/** Live stats + ability kit at a given tier. The renderer reads from this every
 *  shot, so abilities are pure data here and the firing code just applies them. */
export interface TdTowerStats {
  range: number; fireRate: number; damage: number; splash: number;
  slow: number; slowTime: number;
  crit: number;       // 0..1 chance of a critical hit
  critMul: number;    // damage multiplier on a crit
  chain: number;      // # of EXTRA creeps a shot arcs to (tesla)
  chainRange: number; // search radius for each chain jump
  chainFalloff: number; // damage kept per jump (0..1)
  dot: number;        // poison/burn damage PER SECOND applied on hit
  dotTime: number;    // seconds the DoT lasts
  stun: number;       // seconds the target is frozen solid (frost t4)
  multishot: number;  // # of distinct targets hit at once (1 = normal)
  buff: number;       // damage amp (fraction) granted to towers in range (pylon t4)
  buffRange: number;  // radius of the buff aura
}

/** Per-tier growth curves (index 0 = tier 1 … index 3 = tier 4). */
const DMG_MUL = [1, 1.7, 2.4, 3.4];
const RANGE_MUL = [1, 1.12, 1.24, 1.4];
const RATE_MUL = [1, 1.18, 1.36, 1.62];

export function towerStats(id: TdTowerId, tier: number): TdTowerStats {
  const d = TD_TOWERS[id];
  const t = Math.max(1, Math.min(TD_MAX_TIER, tier));
  const ti = t - 1;
  const s: TdTowerStats = {
    range: d.range * RANGE_MUL[ti],
    fireRate: d.fireRate * RATE_MUL[ti],
    damage: d.damage * DMG_MUL[ti],
    splash: d.splash,
    slow: d.slow,
    slowTime: d.slowTime,
    crit: 0, critMul: 1,
    chain: 0, chainRange: 0, chainFalloff: 0.7,
    dot: 0, dotTime: 0,
    stun: 0,
    multishot: 1,
    buff: 0, buffRange: 0,
  };

  switch (id) {
    case "arrow":
      // builds toward a crit-fork DPS monster
      s.crit = [0, 0.08, 0.16, 0.3][ti];
      s.critMul = 2.1;
      s.multishot = t >= 4 ? 3 : 1;
      break;
    case "frost":
      // slow deepens; t4 flash-freezes
      s.slow = [0.5, 0.55, 0.62, 0.72][ti];
      s.slowTime = [1.6, 1.9, 2.2, 2.6][ti];
      s.stun = t >= 4 ? 0.6 : 0;
      break;
    case "pylon":
      s.splash = [2.0, 2.4, 2.9, 3.4][ti];
      // t4 overcharge aura amplifies nearby towers
      s.buff = t >= 4 ? 0.25 : 0;
      s.buffRange = s.range;
      break;
    case "cannon":
      // t4 incendiary leaves a burning DoT in the splash
      if (t >= 4) { s.dot = s.damage * 0.12; s.dotTime = 3; }
      break;
    case "sniper":
      // execute: brutal crits, especially as it tiers
      s.crit = [0, 0.12, 0.22, 0.4][ti];
      s.critMul = 2.6;
      break;
    case "tesla":
      // chains to more creeps the higher the tier
      s.chain = [2, 3, 4, 6][ti];
      s.chainRange = 4.6;
      s.chainFalloff = [0.6, 0.66, 0.72, 0.82][ti];
      break;
    case "venom":
      // poison ramps hard; the anti-tank/armor/regrow tool
      s.dot = [6, 10, 16, 26][ti];
      s.dotTime = 3;
      break;
  }
  return s;
}

/** A creep as seen by a tower's targeting. */
export interface TdTargetable {
  id: number;
  pos: { x: number; z: number };
  dist: number;        // arc-length along the lane (First = max, Last = min)
  hp: number;
  alive: boolean;
  targetable: boolean; // false for un-revealed camo creeps
}

/**
 * Pick the creep a tower should shoot, honoring its target priority, among
 * alive + targetable creeps within `range` of (tx,tz):
 *   first  — furthest along the lane (max dist)   [default]
 *   last   — least far along (min dist)
 *   strong — highest HP (ties → furthest along)
 *   close  — nearest to the tower
 * Returns its id, or -1 if nothing valid is in range.
 */
export function pickTarget(tx: number, tz: number, range: number, creeps: TdTargetable[], mode: TdTargetMode = "first"): number {
  const r2 = range * range;
  let bestId = -1;
  let bestScore = -Infinity;
  for (const c of creeps) {
    if (!c.alive || !c.targetable) continue;
    const dx = c.pos.x - tx, dz = c.pos.z - tz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    let score: number;
    if (mode === "first") score = c.dist;
    else if (mode === "last") score = -c.dist;
    else if (mode === "close") score = -d2;
    else score = c.hp * 1e6 + c.dist; // strong, ties → first
    if (score > bestScore) { bestScore = score; bestId = c.id; }
  }
  return bestId;
}

/**
 * Pick up to `n` distinct creeps for a multishot / chain volley, honoring the
 * target priority, nearest-first among those in range. Returns their ids
 * (best first). Used by arrow's MULTISHOT. `exclude` ids are skipped.
 */
export function pickTargets(
  tx: number, tz: number, range: number, creeps: TdTargetable[], mode: TdTargetMode, n: number,
  exclude: Set<number> = new Set(),
): number[] {
  const r2 = range * range;
  const scored: { id: number; score: number }[] = [];
  for (const c of creeps) {
    if (!c.alive || !c.targetable || exclude.has(c.id)) continue;
    const dx = c.pos.x - tx, dz = c.pos.z - tz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    let score: number;
    if (mode === "first") score = c.dist;
    else if (mode === "last") score = -c.dist;
    else if (mode === "close") score = -d2;
    else score = c.hp * 1e6 + c.dist;
    scored.push({ id: c.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, n)).map((s) => s.id);
}

/** Nearest creep to (x,z) within radius, excluding ids in `exclude` — the chain
 *  jump helper for the Tesla Coil. Returns id or -1. */
export function nearestCreep(
  x: number, z: number, radius: number, creeps: TdTargetable[], exclude: Set<number>,
): number {
  const r2 = radius * radius;
  let best = -1, bestD = Infinity;
  for (const c of creeps) {
    if (!c.alive || !c.targetable || exclude.has(c.id)) continue;
    const dx = c.pos.x - x, dz = c.pos.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= r2 && d2 < bestD) { bestD = d2; best = c.id; }
  }
  return best;
}
