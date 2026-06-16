/**
 * Bed Wars-lite TEAM UPGRADES & TRAPS rules engine — src/bedwars/bwupgrades.ts.
 *
 * Pure logic (no THREE / no DOM), so — like bwteams.ts — the real module imports
 * cleanly under the node:test runner and we exercise the ACTUAL functions
 * directly. Covers the diamond upgrade ladder (buy advances tiers, stops at max,
 * cost goes null at max, immutability), the derived getters at min/mid/max, and
 * the trap queue (fills to 3 then refuses, FIFO pop order, scaling cost).
 *
 * Runner: `node --test --experimental-strip-types src/bedwars/bwupgrades.test.ts`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bwInitUpgrades,
  bwUpgradeMaxed,
  bwUpgradeCost,
  bwBuyUpgrade,
  bwDamageMul,
  bwDamageReduction,
  bwFireRateMul,
  bwForgeMul,
  bwHealPoolRate,
  bwDragonBonus,
  bwUpgradeLabel,
  bwUpgradeDesc,
  BW_UPGRADE_IDS,
  BW_UPGRADE_COSTS,
  bwInitTraps,
  bwQueueTrap,
  bwPopTrap,
  bwNextTrapCost,
  bwTrap,
  bwTrapsFull,
  BW_TRAPS,
  BW_TRAP_QUEUE_MAX,
  type BwUpgradeId,
  type BwTrapId,
} from "../src/bedwars/bwupgrades.ts";

// ─────────────────────────── UPGRADES: INITIAL STATE ───────────────────────────

test("bwInitUpgrades starts everything off / tier 0", () => {
  const s = bwInitUpgrades();
  assert.equal(s.sharpness, false);
  assert.equal(s.protection, 0);
  assert.equal(s.haste, 0);
  assert.equal(s.forge, 0);
  assert.equal(s.healpool, false);
  assert.equal(s.dragonbuff, 0);
  // Nothing maxed at the start.
  for (const id of BW_UPGRADE_IDS) {
    assert.equal(bwUpgradeMaxed(s, id), false, `${id} should not be maxed initially`);
  }
});

// ─────────────────────────── UPGRADES: BUYING / MAX ───────────────────────────

test("binary upgrades flip on once, then are maxed with null cost", () => {
  for (const id of ["sharpness", "healpool"] as BwUpgradeId[]) {
    let s = bwInitUpgrades();
    const flat = id === "sharpness" ? BW_UPGRADE_COSTS.sharpness : BW_UPGRADE_COSTS.healpool;
    assert.equal(bwUpgradeCost(s, id), flat);
    s = bwBuyUpgrade(s, id);
    assert.equal(s[id], true);
    assert.equal(bwUpgradeMaxed(s, id), true);
    assert.equal(bwUpgradeCost(s, id), null);
    // Buying again is a no-op clone (still true).
    s = bwBuyUpgrade(s, id);
    assert.equal(s[id], true);
  }
});

test("tiered upgrades advance one tier per buy and stop at max", () => {
  const tiered: BwUpgradeId[] = ["protection", "haste", "forge", "dragonbuff"];
  for (const id of tiered) {
    const costs = BW_UPGRADE_COSTS[id as "protection" | "haste" | "forge" | "dragonbuff"];
    const max = costs.length;
    let s = bwInitUpgrades();
    for (let tier = 0; tier < max; tier++) {
      // Cost of the next level matches the cost array at the current tier.
      assert.equal(bwUpgradeCost(s, id), costs[tier], `${id} cost at tier ${tier}`);
      assert.equal(bwUpgradeMaxed(s, id), false);
      s = bwBuyUpgrade(s, id);
      assert.equal(s[id], tier + 1, `${id} should be tier ${tier + 1} after buy`);
    }
    // At max now.
    assert.equal(s[id], max);
    assert.equal(bwUpgradeMaxed(s, id), true);
    assert.equal(bwUpgradeCost(s, id), null);
    // Buying past max is a no-op clone.
    const after = bwBuyUpgrade(s, id);
    assert.equal(after[id], max);
  }
});

test("bwBuyUpgrade is immutable — the original state is never mutated", () => {
  const s0 = bwInitUpgrades();
  const s1 = bwBuyUpgrade(s0, "protection");
  assert.equal(s0.protection, 0, "original untouched");
  assert.equal(s1.protection, 1);
  assert.notEqual(s0, s1, "returns a new object");

  const sa = bwBuyUpgrade(s0, "sharpness");
  assert.equal(s0.sharpness, false, "original untouched");
  assert.equal(sa.sharpness, true);

  // No-op clone at max is still a fresh object, not the same reference.
  const maxed = bwBuyUpgrade(sa, "sharpness");
  assert.notEqual(maxed, sa);
  assert.equal(maxed.sharpness, true);
});

// ─────────────────────────── DERIVED GETTERS ───────────────────────────

test("bwDamageMul: 1 off, 1.25 with Sharpness", () => {
  const s = bwInitUpgrades();
  assert.equal(bwDamageMul(s), 1);
  assert.equal(bwDamageMul(bwBuyUpgrade(s, "sharpness")), 1.25);
});

test("bwDamageReduction across protection tiers 0..4", () => {
  let s = bwInitUpgrades();
  const expected = [0, 0.15, 0.3, 0.45, 0.6];
  assert.equal(bwDamageReduction(s), expected[0]);
  for (let tier = 1; tier <= 4; tier++) {
    s = bwBuyUpgrade(s, "protection");
    assert.equal(bwDamageReduction(s), expected[tier], `protection tier ${tier}`);
  }
});

test("bwFireRateMul across haste tiers 0..2", () => {
  let s = bwInitUpgrades();
  assert.equal(bwFireRateMul(s), 1.0);
  s = bwBuyUpgrade(s, "haste");
  assert.equal(bwFireRateMul(s), 1.2);
  s = bwBuyUpgrade(s, "haste");
  assert.equal(bwFireRateMul(s), 1.4);
});

test("bwForgeMul across forge tiers 0..4", () => {
  let s = bwInitUpgrades();
  const expected = [1.0, 1.5, 2.0, 3.0, 4.0];
  assert.equal(bwForgeMul(s), expected[0]);
  for (let tier = 1; tier <= 4; tier++) {
    s = bwBuyUpgrade(s, "forge");
    assert.equal(bwForgeMul(s), expected[tier], `forge tier ${tier}`);
  }
});

test("bwHealPoolRate: 0 off, 8 owned", () => {
  const s = bwInitUpgrades();
  assert.equal(bwHealPoolRate(s), 0);
  assert.equal(bwHealPoolRate(bwBuyUpgrade(s, "healpool")), 8);
});

test("bwDragonBonus across dragonbuff tiers 0..2", () => {
  let s = bwInitUpgrades();
  assert.equal(bwDragonBonus(s), 0);
  s = bwBuyUpgrade(s, "dragonbuff");
  assert.equal(bwDragonBonus(s), 1);
  s = bwBuyUpgrade(s, "dragonbuff");
  assert.equal(bwDragonBonus(s), 2);
});

// ─────────────────────────── UI HELPERS ───────────────────────────

test("bwUpgradeLabel returns a non-empty name for every upgrade", () => {
  for (const id of BW_UPGRADE_IDS) {
    assert.equal(typeof bwUpgradeLabel(id), "string");
    assert.ok(bwUpgradeLabel(id).length > 0, `${id} label`);
  }
});

test("bwUpgradeDesc reflects the current level + returns a string for every id", () => {
  for (const id of BW_UPGRADE_IDS) {
    const s = bwInitUpgrades();
    assert.equal(typeof bwUpgradeDesc(s, id), "string");
    assert.ok(bwUpgradeDesc(s, id).length > 0);
  }
  // Tiered desc shows the current tier.
  let s = bwInitUpgrades();
  assert.match(bwUpgradeDesc(s, "protection"), /0\/4/);
  s = bwBuyUpgrade(s, "protection");
  assert.match(bwUpgradeDesc(s, "protection"), /1\/4/);
  assert.match(bwUpgradeDesc(s, "protection"), /15%/);
});

// ─────────────────────────── TRAPS ───────────────────────────

test("BW_TRAPS catalog has the four expected traps with names + descs", () => {
  const ids = BW_TRAPS.map((t) => t.id).sort();
  assert.deepEqual(ids, ["alarm", "counter", "itsatrap", "minerfatigue"]);
  for (const t of BW_TRAPS) {
    assert.ok(t.name.length > 0);
    assert.ok(t.desc.length > 0);
    assert.equal(bwTrap(t.id)?.id, t.id);
  }
  assert.equal(bwTrap("nope" as BwTrapId), undefined);
});

test("bwInitTraps starts empty", () => {
  const q = bwInitTraps();
  assert.deepEqual(q.slots, []);
  assert.equal(bwTrapsFull(q), false);
});

test("trap queue fills to 3 then refuses further adds", () => {
  let q = bwInitTraps();
  q = bwQueueTrap(q, "itsatrap");
  q = bwQueueTrap(q, "counter");
  q = bwQueueTrap(q, "alarm");
  assert.equal(q.slots.length, BW_TRAP_QUEUE_MAX);
  assert.equal(bwTrapsFull(q), true);
  // Fourth add is a no-op clone (unchanged contents, new object).
  const overflow = bwQueueTrap(q, "minerfatigue");
  assert.deepEqual(overflow.slots, ["itsatrap", "counter", "alarm"]);
});

test("bwQueueTrap is immutable — original queue unchanged", () => {
  const q0 = bwInitTraps();
  const q1 = bwQueueTrap(q0, "alarm");
  assert.deepEqual(q0.slots, []);
  assert.deepEqual(q1.slots, ["alarm"]);
  assert.notEqual(q0, q1);
});

test("bwPopTrap removes and returns the FRONT trap (FIFO order)", () => {
  let q = bwInitTraps();
  q = bwQueueTrap(q, "itsatrap");
  q = bwQueueTrap(q, "counter");
  q = bwQueueTrap(q, "alarm");

  let res = bwPopTrap(q);
  assert.equal(res.trap, "itsatrap");
  assert.deepEqual(res.queue.slots, ["counter", "alarm"]);

  res = bwPopTrap(res.queue);
  assert.equal(res.trap, "counter");
  assert.deepEqual(res.queue.slots, ["alarm"]);

  res = bwPopTrap(res.queue);
  assert.equal(res.trap, "alarm");
  assert.deepEqual(res.queue.slots, []);

  // Empty queue → nothing fires.
  res = bwPopTrap(res.queue);
  assert.equal(res.trap, null);
  assert.deepEqual(res.queue.slots, []);
});

test("bwPopTrap is immutable — original queue unchanged", () => {
  let q = bwInitTraps();
  q = bwQueueTrap(q, "alarm");
  q = bwQueueTrap(q, "counter");
  const res = bwPopTrap(q);
  assert.deepEqual(q.slots, ["alarm", "counter"], "original untouched");
  assert.deepEqual(res.queue.slots, ["counter"]);
});

test("bwNextTrapCost scales 1 → 2 → 4 then null when full", () => {
  assert.equal(bwNextTrapCost(0), 1);
  assert.equal(bwNextTrapCost(1), 2);
  assert.equal(bwNextTrapCost(2), 4);
  assert.equal(bwNextTrapCost(3), null);
  assert.equal(bwNextTrapCost(4), null);

  // Walk it via the real queue length.
  let q = bwInitTraps();
  for (const expected of [1, 2, 4]) {
    assert.equal(bwNextTrapCost(q.slots.length), expected);
    q = bwQueueTrap(q, "itsatrap");
  }
  assert.equal(bwNextTrapCost(q.slots.length), null);
});
