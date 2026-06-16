/**
 * Pet egg-gacha invariants for src/gacha.ts.
 *
 * gacha.ts imports pets.ts (which imports THREE), but THREE loads fine under the
 * node test runner with --experimental-transform-types (it just isn't used as a
 * renderer here), and the extensionless `./pets` import is rewritten to `.ts` by
 * the resolve hook. So we exercise the REAL rollEgg/EGGS/eggOdds directly.
 *
 * Runner: `npm run test:gacha`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EGGS, rollEgg, eggOdds, petsOfRarity, findEgg } from "../src/gacha.ts";
import { RARITY_ORDER } from "../src/pets.ts";

test("there are exactly 5 eggs, priced strictly ascending", () => {
  assert.equal(EGGS.length, 5);
  for (let i = 1; i < EGGS.length; i++) {
    assert.ok(EGGS[i].cost > EGGS[i - 1].cost, `egg ${i} should cost more than ${i - 1}`);
  }
});

test("every egg's weighted rarities all have at least one eligible pet", () => {
  for (const egg of EGGS) {
    for (const r of RARITY_ORDER) {
      if ((egg.weights[r] ?? 0) > 0) {
        assert.ok(petsOfRarity(r).length > 0, `${egg.id} weights ${r} but no pet exists there`);
      }
    }
  }
});

test("no egg can ever roll a celestial or an evolved form", () => {
  // sweep the rng space for every egg; celestials/evolutions are excluded.
  for (const egg of EGGS) {
    for (let k = 0; k < 400; k++) {
      const pet = rollEgg(egg, () => k / 400);
      assert.notEqual(pet.rarity, "celestial", `${egg.id} rolled a celestial`);
      assert.ok((pet.cost ?? 0) > 0, `${egg.id} rolled a cost-0 pet (${pet.id})`);
      assert.ok(!pet.id.endsWith("_evo"), `${egg.id} rolled an evolved form (${pet.id})`);
    }
  }
});

test("rollEgg always returns a real pet with a rarity the egg allows", () => {
  for (const egg of EGGS) {
    const allowed = new Set(RARITY_ORDER.filter((r) => (egg.weights[r] ?? 0) > 0));
    for (let k = 0; k < 200; k++) {
      const pet = rollEgg(egg, () => (k * 0.123 + 0.01) % 1);
      assert.ok(pet && pet.id, `${egg.id} returned no pet`);
      assert.ok(allowed.has(pet.rarity!), `${egg.id} rolled disallowed rarity ${pet.rarity}`);
    }
  }
});

test("pricier eggs tilt toward rarer pets (mean rarity index increases)", () => {
  // Monte-Carlo each egg with a fixed pseudo-random sequence; assert the mean
  // rarity index is non-decreasing from cheapest to priciest egg.
  const idx = (r: string) => RARITY_ORDER.indexOf(r as any);
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const means = EGGS.map((egg) => {
    let sum = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) sum += idx(rollEgg(egg, rng).rarity!);
    return sum / N;
  });
  for (let i = 1; i < means.length; i++) {
    assert.ok(means[i] > means[i - 1], `egg ${i} mean rarity ${means[i]} should exceed ${means[i - 1]}`);
  }
});

test("eggOdds percentages sum to ~100 for every egg", () => {
  for (const egg of EGGS) {
    const odds = eggOdds(egg);
    const sum = odds.reduce((s, o) => s + o.pct, 0);
    assert.ok(Math.abs(sum - 100) <= 2, `${egg.id} odds sum to ${sum}, expected ~100`);
  }
});

test("findEgg resolves every egg id and rejects unknowns", () => {
  for (const egg of EGGS) assert.equal(findEgg(egg.id)?.id, egg.id);
  assert.equal(findEgg("nope"), undefined);
});
