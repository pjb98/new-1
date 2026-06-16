/**
 * Bed Wars-lite TEAM UPGRADES & TRAPS — the diamond economy rules engine.
 *
 * Where bwshop.ts spends iron/gold/emerald on per-PLAYER gear, this module owns
 * the per-TEAM upgrades you buy with DIAMONDS at the team-upgrade station, plus
 * the trap QUEUE that fires when an enemy raids your base. Modeled on classic
 * Hypixel Bed Wars: Sharpness, Reinforced Armor (protection), Maniac Miner
 * (haste), the Forge tiers, Heal Pool and Dragon Buff — and the four traps.
 *
 * PURE DATA + LOGIC: no THREE, no DOM, no imports from other project files, so
 * the whole thing unit-tests cleanly under node:test (`--experimental-strip-types`)
 * exactly like bwteams.ts / bwresources.ts. Following the house discipline:
 *   - upgrade STATE is a plain record; every mutator returns a NEW state (the
 *     input is never touched) so React-style "set to the returned value" wiring
 *     stays correct;
 *   - tuning lives in exported const tables (tweak here, not in the systems);
 *   - the integrator OWNS affordability (it holds the diamond wallet) — these
 *     helpers only report the next-level cost and advance one level, never past
 *     max, and never check whether you can pay.
 *
 * Derived getters (bwDamageMul, bwForgeMul, …) translate the abstract upgrade
 * levels into the concrete multipliers / rates the game loop applies — the
 * gameplay itself lives in the integrator, this module only describes it.
 */

// ─────────────────────────── UPGRADES ───────────────────────────

/** The six purchasable team upgrades. Some are binary (off/on), some tiered. */
export type BwUpgradeId =
  | "sharpness"
  | "protection"
  | "haste"
  | "forge"
  | "healpool"
  | "dragonbuff";

/** Every upgrade id, in canonical display order — handy for shop UI + iteration. */
export const BW_UPGRADE_IDS: BwUpgradeId[] = [
  "sharpness",
  "protection",
  "haste",
  "forge",
  "healpool",
  "dragonbuff",
];

/**
 * The live per-team upgrade state. Binary upgrades are booleans; tiered upgrades
 * are a current tier (0 = not purchased). All start off/0 — see bwInitUpgrades.
 */
export interface BwUpgradeState {
  sharpness: boolean;
  protection: number; // 0..4
  haste: number; // 0..2
  forge: number; // 0..4
  healpool: boolean;
  dragonbuff: number; // 0..2
}

// ─────────────────────────── TUNING ───────────────────────────
// The only knobs to tweak. Mirrors the "tweak here, not in the systems" rule.

/**
 * Diamond cost table. Binary upgrades carry a flat number; tiered upgrades carry
 * a per-NEXT-tier array (index 0 = cost to go 0→1, index 1 = 1→2, …). The array
 * length therefore equals the upgrade's max tier.
 */
export const BW_UPGRADE_COSTS: {
  sharpness: number;
  protection: number[];
  haste: number[];
  forge: number[];
  healpool: number;
  dragonbuff: number[];
} = {
  sharpness: 4,
  protection: [2, 4, 8, 16],
  haste: [2, 4],
  forge: [2, 4, 6, 8],
  healpool: 1,
  dragonbuff: [3, 5],
};

/** Protection tiers → incoming-damage reduction fraction (0 = none, 0.6 = -60%). */
export const BW_PROTECTION_REDUCTION: number[] = [0, 0.15, 0.3, 0.45, 0.6];

/** Haste (Maniac Miner) tiers → fire/reload-rate multiplier the integrator applies. */
export const BW_HASTE_FIRE_MUL: number[] = [1.0, 1.2, 1.4];

/** Forge tiers → base-generator output-SPEED multiplier (Iron→Golden→…→Molten). */
export const BW_FORGE_MUL: number[] = [1.0, 1.5, 2.0, 3.0, 4.0];

/** Sharpness weapon-damage multiplier when owned. */
export const BW_SHARPNESS_DAMAGE_MUL = 1.25;

/** Heal Pool regen rate (HP/sec) when standing near your base. */
export const BW_HEALPOOL_RATE = 8;

/** Human-readable upgrade names for the shop UI. */
const BW_UPGRADE_LABELS: Record<BwUpgradeId, string> = {
  sharpness: "Sharpness",
  protection: "Reinforced Armor",
  haste: "Maniac Miner",
  forge: "Forge",
  healpool: "Heal Pool",
  dragonbuff: "Dragon Buff",
};

/** Pretty names for each forge tier, indexed by tier (0 = un-purchased). */
const BW_FORGE_TIER_NAMES: string[] = [
  "No Forge",
  "Iron Forge",
  "Golden Forge",
  "Emerald Forge",
  "Molten Forge",
];

/** Is this upgrade a single binary (off/on) purchase, vs a tiered one? */
function isBinary(id: BwUpgradeId): boolean {
  return id === "sharpness" || id === "healpool";
}

/** The max tier of a tiered upgrade (= length of its cost array). */
function maxTier(id: Exclude<BwUpgradeId, "sharpness" | "healpool">): number {
  return BW_UPGRADE_COSTS[id].length;
}

// ─────────────────────────── STATE OPS ───────────────────────────

/** A fresh upgrade state — everything off / tier 0. */
export function bwInitUpgrades(): BwUpgradeState {
  return {
    sharpness: false,
    protection: 0,
    haste: 0,
    forge: 0,
    healpool: false,
    dragonbuff: 0,
  };
}

/**
 * Is this upgrade fully owned? True for a binary upgrade that's been bought, or a
 * tiered upgrade sitting at its max tier. Maxed upgrades can't be bought again.
 */
export function bwUpgradeMaxed(state: BwUpgradeState, id: BwUpgradeId): boolean {
  if (isBinary(id)) return state[id] as boolean;
  const tiered = id as Exclude<BwUpgradeId, "sharpness" | "healpool">;
  return (state[tiered] as number) >= maxTier(tiered);
}

/**
 * Diamond cost of the NEXT level of this upgrade, or null if it's already maxed.
 * For binary upgrades that's the flat cost; for tiered ones it's the cost to step
 * from the current tier to the next (cost array indexed by current tier).
 */
export function bwUpgradeCost(state: BwUpgradeState, id: BwUpgradeId): number | null {
  if (bwUpgradeMaxed(state, id)) return null;
  if (isBinary(id)) {
    return id === "sharpness" ? BW_UPGRADE_COSTS.sharpness : BW_UPGRADE_COSTS.healpool;
  }
  const tiered = id as Exclude<BwUpgradeId, "sharpness" | "healpool">;
  const current = state[tiered] as number;
  return BW_UPGRADE_COSTS[tiered][current];
}

/**
 * Advance an upgrade one level and return a NEW state (input untouched). Binary
 * upgrades flip to true; tiered upgrades step up one tier. A no-op CLONE if the
 * upgrade is already maxed. Does NOT check affordability — the integrator deducts
 * the diamonds itself after confirming the wallet via bwUpgradeCost.
 */
export function bwBuyUpgrade(state: BwUpgradeState, id: BwUpgradeId): BwUpgradeState {
  const next: BwUpgradeState = { ...state };
  if (bwUpgradeMaxed(state, id)) return next; // maxed → clone, no change
  if (isBinary(id)) {
    (next[id] as boolean) = true;
  } else {
    const tiered = id as Exclude<BwUpgradeId, "sharpness" | "healpool">;
    (next[tiered] as number) = (state[tiered] as number) + 1;
  }
  return next;
}

// ─────────────────────────── DERIVED GETTERS ───────────────────────────
// What the game loop actually reads — abstract levels → concrete numbers.

/** Weapon-damage multiplier: 1.25 with Sharpness, else 1. */
export function bwDamageMul(state: BwUpgradeState): number {
  return state.sharpness ? BW_SHARPNESS_DAMAGE_MUL : 1;
}

/** Incoming-damage reduction fraction from Reinforced Armor (0 .. 0.6). */
export function bwDamageReduction(state: BwUpgradeState): number {
  return BW_PROTECTION_REDUCTION[clampIdx(state.protection, BW_PROTECTION_REDUCTION)];
}

/** Fire/reload-rate multiplier from Maniac Miner haste (1 .. 1.4). */
export function bwFireRateMul(state: BwUpgradeState): number {
  return BW_HASTE_FIRE_MUL[clampIdx(state.haste, BW_HASTE_FIRE_MUL)];
}

/** Base-generator output-speed multiplier from the Forge (1 .. 4). */
export function bwForgeMul(state: BwUpgradeState): number {
  return BW_FORGE_MUL[clampIdx(state.forge, BW_FORGE_MUL)];
}

/** Heal Pool regen rate in HP/sec (0 when not owned, 8 when owned). */
export function bwHealPoolRate(state: BwUpgradeState): number {
  return state.healpool ? BW_HEALPOOL_RATE : 0;
}

/** Extra sudden-death dragons your side fields (0 .. 2). */
export function bwDragonBonus(state: BwUpgradeState): number {
  return clampIdx(state.dragonbuff, [0, 1, 2]);
}

/** Clamp a tier into a lookup array's index range (defends against bad state). */
function clampIdx(tier: number, arr: unknown[]): number {
  if (!Number.isFinite(tier) || tier < 0) return 0;
  return Math.min(Math.floor(tier), arr.length - 1);
}

// ─────────────────────────── UI HELPERS ───────────────────────────

/** Human-readable name of an upgrade (for the shop UI). */
export function bwUpgradeLabel(id: BwUpgradeId): string {
  return BW_UPGRADE_LABELS[id];
}

/** A one-line description of the upgrade at its CURRENT level (for the shop UI). */
export function bwUpgradeDesc(state: BwUpgradeState, id: BwUpgradeId): string {
  switch (id) {
    case "sharpness":
      return state.sharpness
        ? "Your team's weapons deal +25% damage."
        : "Your team's weapons deal +25% damage (not yet purchased).";
    case "protection": {
      const pct = Math.round(bwDamageReduction(state) * 100);
      return `Reinforced Armor ${state.protection}/4 — incoming damage reduced ${pct}%.`;
    }
    case "haste":
      return `Maniac Miner ${state.haste}/2 — fire/reload rate ×${bwFireRateMul(state)}.`;
    case "forge": {
      const name = BW_FORGE_TIER_NAMES[clampIdx(state.forge, BW_FORGE_TIER_NAMES)];
      return `${name} ${state.forge}/4 — base generators ×${bwForgeMul(state)} speed.`;
    }
    case "healpool":
      return state.healpool
        ? `Heal Pool — regen ${BW_HEALPOOL_RATE} HP/sec near your base.`
        : `Heal Pool — regen ${BW_HEALPOOL_RATE} HP/sec near your base (not yet purchased).`;
    case "dragonbuff":
      return `Dragon Buff ${state.dragonbuff}/2 — +${bwDragonBonus(state)} sudden-death dragon(s).`;
  }
}

// ─────────────────────────── TRAPS ───────────────────────────

/** The four trap kinds, fired in FIFO order when an enemy raids your base. */
export type BwTrapId = "itsatrap" | "counter" | "alarm" | "minerfatigue";

/** A trap's catalog entry — name + what it does (data the UI reads). */
export interface BwTrapDef {
  id: BwTrapId;
  name: string;
  desc: string;
}

/** The trap catalog, in display order. */
export const BW_TRAPS: BwTrapDef[] = [
  { id: "itsatrap", name: "It's a Trap!", desc: "Blinds and slows intruders who enter your base." },
  { id: "counter", name: "Counter-Offensive Trap", desc: "Grants speed and regen to defenders near your base." },
  { id: "alarm", name: "Alarm Trap", desc: "Reveals invisible intruders and shows their name." },
  { id: "minerfatigue", name: "Miner Fatigue Trap", desc: "Intruders mine and break blocks slower." },
];

/** The maximum number of traps that can sit queued at once. */
export const BW_TRAP_QUEUE_MAX = 3;

/** Per-position diamond cost as the queue fills: 1st = 1, 2nd = 2, 3rd = 4. */
export const BW_TRAP_COSTS: number[] = [1, 2, 4];

/** The live trap queue — a FIFO of up to BW_TRAP_QUEUE_MAX trap ids. */
export interface BwTrapQueue {
  slots: BwTrapId[];
}

/** Resolve a trap def by id. undefined if no such id (mirrors bwItem). */
export function bwTrap(id: BwTrapId): BwTrapDef | undefined {
  return BW_TRAPS.find((t) => t.id === id);
}

/**
 * Diamond cost to queue the NEXT trap given how many are ALREADY queued, or null
 * if the queue is already full (length >= BW_TRAP_QUEUE_MAX). Cost scales with
 * queue length: the 1st trap costs 1, the 2nd 2, the 3rd 4.
 */
export function bwNextTrapCost(queueLength: number): number | null {
  if (!Number.isFinite(queueLength) || queueLength >= BW_TRAP_QUEUE_MAX) return null;
  const idx = Math.max(0, Math.floor(queueLength));
  return BW_TRAP_COSTS[idx] ?? null;
}

/** A fresh, empty trap queue. */
export function bwInitTraps(): BwTrapQueue {
  return { slots: [] };
}

/** Is the trap queue full (no room to add another)? */
export function bwTrapsFull(q: BwTrapQueue): boolean {
  return q.slots.length >= BW_TRAP_QUEUE_MAX;
}

/**
 * Append a trap to a COPY of the queue and return it (input untouched). A no-op
 * CLONE when the queue is already full. Does NOT check affordability — the
 * integrator pays via bwNextTrapCost first.
 */
export function bwQueueTrap(q: BwTrapQueue, id: BwTrapId): BwTrapQueue {
  if (bwTrapsFull(q)) return { slots: [...q.slots] };
  return { slots: [...q.slots, id] };
}

/**
 * Pop the FRONT trap off the queue (FIFO) when a raid triggers, returning the
 * fired trap plus a NEW queue with it removed (input untouched). When the queue
 * is empty, returns { trap: null, queue: <clone> } — nothing fires.
 */
export function bwPopTrap(q: BwTrapQueue): { trap: BwTrapId | null; queue: BwTrapQueue } {
  if (q.slots.length === 0) return { trap: null, queue: { slots: [] } };
  const [front, ...rest] = q.slots;
  return { trap: front, queue: { slots: rest } };
}
