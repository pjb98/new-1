/**
 * Pet EGG gacha — the island's pet faucet.
 *
 * Five eggs sit in the middle of the hub. Each costs gold and rolls a random
 * pet from a per-egg rarity weight table: pricier eggs tilt the odds toward
 * rarer pets (but a cheap egg can still — rarely — pop something great, the
 * gacha hook). A hatch always yields SOME pet; duplicates are auto-converted to
 * a star by the caller (see main.ts hatchEgg).
 *
 * Pure data + math (no THREE / DOM), so it unit-tests cleanly and the island
 * just calls rollEgg()/EGGS for its interactables.
 */
import { PETS, RARITY_ORDER, type PetDef, type Rarity } from "./pets";

export interface EggDef {
  id: string;
  name: string;
  /** Gold to crack the egg. */
  cost: number;
  /** Shell tint (hex) for the island model + HUD. */
  color: number;
  /** Short flavour for the prompt/HUD. */
  blurb: string;
  /** Per-rarity roll weights. Missing/zero = that tier can't drop from this egg.
   *  Need not sum to 1 — rollEgg normalises over the tiers that have eligible
   *  pets, so a tier with no remaining pets can't soft-lock the roll. */
  weights: Partial<Record<Rarity, number>>;
}

/**
 * The five eggs, cheapest → priciest. Weights are tuned so each egg has a clear
 * "floor" rarity it reliably gives and a long tail toward the top. Celestial is
 * never in an egg (chronos/oracle are special cost-0 pets earned elsewhere);
 * Mythic only appears in the two most expensive eggs, and rarely.
 */
export const EGGS: EggDef[] = [
  {
    id: "egg_common", name: "Mossy Egg", cost: 500, color: 0x8fcf5a,
    blurb: "Mostly Commons — a cheap starter hatch",
    weights: { common: 75, uncommon: 22, rare: 3 },
  },
  {
    id: "egg_uncommon", name: "River Egg", cost: 1500, color: 0x6ad7ff,
    blurb: "Solid Uncommons with a Rare chance",
    weights: { common: 30, uncommon: 50, rare: 18, epic: 2 },
  },
  {
    id: "egg_rare", name: "Storm Egg", cost: 4000, color: 0x5aa9ff,
    blurb: "Rares and the odd Epic",
    weights: { uncommon: 22, rare: 55, epic: 20, legendary: 3 },
  },
  {
    id: "egg_epic", name: "Astral Egg", cost: 12000, color: 0xc792ea,
    blurb: "Epics, Legendaries, a Mythic sliver",
    weights: { rare: 18, epic: 52, legendary: 26, mythic: 4 },
  },
  {
    id: "egg_legendary", name: "Mythic Egg", cost: 35000, color: 0xffb84a,
    blurb: "The big chase — Legendary & Mythic odds",
    weights: { epic: 22, legendary: 58, mythic: 20 },
  },
];

export function findEgg(id: string): EggDef | undefined {
  return EGGS.find((e) => e.id === id);
}

/** Pets eligible to drop from an egg: the base roster only (no evolved forms —
 *  those are earned by evolving — and no Celestials, kept special at cost 0). */
function eggPool(): PetDef[] {
  return PETS.filter((p) => p.rarity && p.rarity !== "celestial" && (p.cost ?? 0) > 0);
}

/** Base pets of a given rarity (for picking a winner within the rolled tier). */
export function petsOfRarity(rarity: Rarity, pool: PetDef[] = eggPool()): PetDef[] {
  return pool.filter((p) => p.rarity === rarity);
}

/**
 * Roll a single pet from an egg. `rng` is injectable for tests (default
 * Math.random). Two-step: pick a rarity tier by weight (over tiers that have at
 * least one eligible pet), then pick a uniform-random pet within that tier.
 * Always returns a pet — falls back to the lowest eligible rarity if weights
 * somehow miss.
 */
export function rollEgg(egg: EggDef, rng: () => number = Math.random): PetDef {
  const pool = eggPool();
  // Keep only tiers that are both weighted AND actually have a pet to give.
  const tiers = RARITY_ORDER.filter(
    (r) => (egg.weights[r] ?? 0) > 0 && petsOfRarity(r, pool).length > 0,
  );
  const total = tiers.reduce((s, r) => s + (egg.weights[r] ?? 0), 0);
  let pickedTier: Rarity = tiers[0] ?? "common";
  if (total > 0) {
    let x = rng() * total;
    for (const r of tiers) {
      x -= egg.weights[r] ?? 0;
      if (x < 0) { pickedTier = r; break; }
    }
  }
  const candidates = petsOfRarity(pickedTier, pool);
  return candidates[Math.floor(rng() * candidates.length)] ?? pool[0];
}

/** Human-readable odds (rarity → %) for an egg, for the HUD tooltip. */
export function eggOdds(egg: EggDef): { rarity: Rarity; pct: number }[] {
  const pool = eggPool();
  const tiers = RARITY_ORDER.filter(
    (r) => (egg.weights[r] ?? 0) > 0 && petsOfRarity(r, pool).length > 0,
  );
  const total = tiers.reduce((s, r) => s + (egg.weights[r] ?? 0), 0) || 1;
  return tiers.map((r) => ({ rarity: r, pct: Math.round(((egg.weights[r] ?? 0) / total) * 100) }));
}
