/**
 * Bed Wars-lite SHOP invariants for src/bedwars/bwshop.ts.
 *
 * bwshop.ts is pure data + math (no THREE / DOM), so we exercise the REAL
 * BW_SHOP/catalog + helpers directly under the node test runner.
 *
 * Runner: `node --test --experimental-strip-types test/bwshop.test.ts`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BW_SHOP,
  bwItem,
  bwCanAfford,
  bwBuy,
  bwShopByCategory,
  type BwResource,
  type BwWallet,
  type BwShopItem,
} from "../src/bedwars/bwshop.ts";

const RESOURCES: BwResource[] = ["iron", "gold", "emerald"];
const CATEGORIES: BwShopItem["category"][] = ["blocks", "melee", "ranged", "armor", "tools", "utility"];

/** A wallet rich enough to buy anything. */
function fullWallet(): BwWallet {
  return { iron: 9999, gold: 9999, emerald: 9999 };
}

test("every item has a non-empty, positive cost", () => {
  for (const item of BW_SHOP) {
    const entries = Object.entries(item.cost) as [BwResource, number][];
    assert.ok(entries.length > 0, `${item.id} has no cost`);
    for (const [r, amount] of entries) {
      assert.ok(RESOURCES.includes(r), `${item.id} costs unknown resource ${r}`);
      assert.ok(amount > 0, `${item.id} has a non-positive ${r} cost (${amount})`);
    }
  }
});

test("item ids are all unique", () => {
  const ids = BW_SHOP.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate item id in BW_SHOP");
});

test("every item declares a known category and an effect.kind", () => {
  for (const item of BW_SHOP) {
    assert.ok(CATEGORIES.includes(item.category), `${item.id} has unknown category ${item.category}`);
    assert.ok(item.effect && typeof item.effect.kind === "string" && item.effect.kind.length > 0,
      `${item.id} has no effect.kind`);
    assert.ok(item.name.length > 0 && item.desc.length > 0, `${item.id} missing name/desc`);
  }
});

test("bwItem resolves every catalog id and rejects unknowns", () => {
  for (const item of BW_SHOP) assert.equal(bwItem(item.id)?.id, item.id);
  assert.equal(bwItem("nope"), undefined);
  assert.equal(bwItem(""), undefined);
});

test("bwCanAfford is true with a full wallet and false when any tier is short", () => {
  for (const item of BW_SHOP) {
    assert.ok(bwCanAfford(fullWallet(), item), `should afford ${item.id} with full wallet`);
    // Drain exactly one priced resource to one below its cost — must now fail.
    const tier = (Object.keys(item.cost) as BwResource[])[0];
    const broke = fullWallet();
    broke[tier] = (item.cost[tier] ?? 0) - 1;
    assert.equal(bwCanAfford(broke, item), false, `should NOT afford ${item.id} short on ${tier}`);
  }
});

test("bwCanAfford handles the exact-change boundary (>= not >)", () => {
  for (const item of BW_SHOP) {
    const exact: BwWallet = { iron: 0, gold: 0, emerald: 0 };
    for (const r of RESOURCES) exact[r] = item.cost[r] ?? 0;
    assert.ok(bwCanAfford(exact, item), `exact change should afford ${item.id}`);
  }
});

test("bwBuy deducts each tier exactly and leaves unpriced tiers untouched", () => {
  for (const item of BW_SHOP) {
    const before = fullWallet();
    const after = bwBuy(before, item);
    for (const r of RESOURCES) {
      assert.equal(after[r], before[r] - (item.cost[r] ?? 0), `${item.id} mis-deducted ${r}`);
    }
  }
});

test("bwBuy never mutates the input wallet", () => {
  const item = bwItem("melee_diamond")!; // a multi-tier (gold+emerald) cost
  const before: BwWallet = { iron: 50, gold: 50, emerald: 50 };
  const snapshot = { ...before };
  const after = bwBuy(before, item);
  assert.deepEqual(before, snapshot, "input wallet was mutated");
  assert.notStrictEqual(after, before, "bwBuy should return a NEW wallet object");
});

test("bwShopByCategory covers every item exactly once and every category is present", () => {
  const groups = bwShopByCategory();
  // All catalog categories show up (none empty).
  const seenCats = new Set(groups.map((g) => g.category));
  for (const c of CATEGORIES) assert.ok(seenCats.has(c), `category ${c} missing from grouping`);
  // Flattened grouping equals the full catalog, no dupes, no drops.
  const flatIds = groups.flatMap((g) => g.items.map((it) => it.id)).sort();
  const allIds = BW_SHOP.map((it) => it.id).sort();
  assert.deepEqual(flatIds, allIds, "grouping does not cover the catalog exactly");
  // Every item sits under its own category.
  for (const g of groups) {
    for (const it of g.items) assert.equal(it.category, g.category, `${it.id} grouped under wrong category`);
  }
});
