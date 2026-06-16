/**
 * Bed Wars-lite RESOURCE GENERATORS — the classic island spawners (iron/gold)
 * plus the central emerald forge — and the team resource wallet.
 *
 * EVERYTHING here is a side-effect-free function of plain numbers/records — no
 * THREE, no DOM, no timers — so it imports cleanly under the node:test runner
 * (`--experimental-strip-types`) exactly like config.ts / idle.ts. The renderer
 * (drifting voxel ingots, pickup pops) and the game loop own the wiring; this
 * module owns the SPAWN MATH so it's testable in isolation.
 *
 * A generator ticks a drop out every `genInterval` seconds. Drops "sit" on the
 * spawner until a player walks over them; once `sitting` hits the per-spawner
 * cap the generator HOLDS (clamps its accumulator) so it resumes the instant the
 * pile is collected — the canonical anti-hoard behaviour from Bed Wars.
 */

export type BwResource = "iron" | "gold" | "diamond" | "emerald";

export interface BwGenerator {
  id: string;
  kind: BwResource;
  tier: number; // 1..3, upgradeable (faster + adds higher resources)
  acc: number; // internal accumulator (seconds since last drop)
}

/** What popped out of a generator on a single tick. */
export interface BwGenTick {
  kind: BwResource;
  amount: number;
}

// ─────────────────────────── TUNING ───────────────────────────
// The only knobs to tweak. Mirrors the config.ts "tweak here, not in the
// systems" discipline.
export const BW_GEN_TUNING: {
  /** Seconds between drops per resource at tier 1. iron pours, gold trickles,
   *  emerald is the rare central-forge prize. */
  baseInterval: Record<BwResource, number>;
  /** Interval multiplier applied per tier ABOVE 1 (interval = base * speedup^(tier-1)).
   *  0.7 ⇒ each upgrade makes the spawner ~30% faster. */
  tierSpeedup: number;
  /** Max of a resource allowed to sit un-collected on one spawner before it
   *  pauses (anti-hoard: forces you to walk the island, not turtle). */
  capPerGen: Record<BwResource, number>;
} = {
  baseInterval: { iron: 1.5, gold: 6, diamond: 30, emerald: 45 },
  tierSpeedup: 0.7,
  capPerGen: { iron: 48, gold: 16, diamond: 8, emerald: 4 },
};

/** Tiers are clamped to this range — there is no tier 0 and no tier 4. */
const MIN_TIER = 1;
const MAX_TIER = 3;

/** Clamp + floor an arbitrary number into the legal tier range [1..3]. */
function clampTier(tier: number): number {
  if (!Number.isFinite(tier)) return MIN_TIER;
  return Math.max(MIN_TIER, Math.min(MAX_TIER, Math.floor(tier)));
}

// ─────────────────────────── GENERATORS ───────────────────────────

/** Make a fresh generator (empty accumulator, tier clamped to 1..3). */
export function makeGenerator(id: string, kind: BwResource, tier: number = 1): BwGenerator {
  return { id, kind, tier: clampTier(tier), acc: 0 };
}

/**
 * Seconds between drops for a generator at its CURRENT tier:
 *   interval = baseInterval[kind] * tierSpeedup^(tier-1)
 * so a higher tier always fires sooner (strictly decreasing in tier).
 */
export function genInterval(gen: BwGenerator): number {
  const tier = clampTier(gen.tier);
  const base = BW_GEN_TUNING.baseInterval[gen.kind];
  return base * Math.pow(BW_GEN_TUNING.tierSpeedup, tier - 1);
}

/**
 * How many of a resource a single drop yields. Tier 3 spawners pump out an extra
 * unit per drop on top of the faster cadence (the "adds higher resources" reward
 * for fully upgrading), everything else drops 1.
 */
function dropAmount(gen: BwGenerator): number {
  return clampTier(gen.tier) >= MAX_TIER ? 2 : 1;
}

/**
 * Advance a generator by `dt` seconds, MUTATING its accumulator, and return the
 * resources that dropped this frame.
 *
 *  - Accumulate `acc += dt`; while `acc >= interval` AND room remains under the
 *    cap, emit one drop and subtract `interval` from `acc`.
 *  - When the spawner is full (`sitting >= cap`) it HOLDS: `acc` is clamped to
 *    `interval` so no progress is lost and the next drop fires the instant the
 *    pile is collected (no over-accumulation, no burst dump).
 *
 * Usually returns an empty array; one entry when a drop fires (more only if a
 * very large `dt` straddles several intervals).
 *
 * @param sitting un-collected count of THIS resource currently on the spawner
 */
export function tickGenerator(gen: BwGenerator, dt: number, sitting: number): BwGenTick[] {
  if (!Number.isFinite(dt) || dt <= 0) return [];
  const interval = genInterval(gen);
  if (interval <= 0) return []; // guard against a degenerate tuning value

  const cap = BW_GEN_TUNING.capPerGen[gen.kind];
  let onGround = Number.isFinite(sitting) && sitting > 0 ? Math.floor(sitting) : 0;

  gen.acc += dt;
  const out: BwGenTick[] = [];

  while (gen.acc >= interval) {
    if (onGround >= cap) {
      // Full — hold without losing the charge so we pop the moment it's collected.
      gen.acc = interval;
      break;
    }
    const amount = dropAmount(gen);
    out.push({ kind: gen.kind, amount });
    onGround += amount;
    gen.acc -= interval;
  }
  return out;
}

/**
 * Upgrade a generator one tier (clamped to 1..3), mutating it in place. Returns
 * the new tier. A no-op at MAX_TIER.
 */
export function upgradeGenerator(gen: BwGenerator): number {
  gen.tier = clampTier(gen.tier + 1);
  return gen.tier;
}

// ─────────────────────────── WALLET ───────────────────────────
// A team's resource purse. Every helper returns a NEW wallet — callers never
// have their input mutated (so React-style "set state to the returned value"
// wiring stays correct).

export type BwWallet = Record<BwResource, number>;

/** A fresh, zeroed wallet. */
export function emptyWallet(): BwWallet {
  return { iron: 0, gold: 0, diamond: 0, emerald: 0 };
}

/**
 * Credit `amount` of `kind` to a COPY of `w` and return it (input untouched).
 * Non-positive / non-finite amounts add nothing.
 */
export function addToWallet(w: BwWallet, kind: BwResource, amount: number): BwWallet {
  const add = Number.isFinite(amount) && amount > 0 ? amount : 0;
  return { ...w, [kind]: w[kind] + add };
}
