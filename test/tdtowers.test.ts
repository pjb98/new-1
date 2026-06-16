import test from "node:test";
import assert from "node:assert/strict";
import {
  TD_TOWERS, TD_TOWER_IDS, TD_MAX_TIER, TD_TARGET_MODES, tdTower, tdUpgradeCost, tdSellValue,
  towerStats, pickTarget, pickTargets, nearestCreep, type TdTargetable,
} from "../src/td/tdtowers.ts";

test("catalog has seven archetypes with the right roles", () => {
  assert.equal(TD_TOWER_IDS.length, 7);
  for (const id of TD_TOWER_IDS) {
    const d = tdTower(id);
    assert.ok(d.cost > 0 && d.range > 0 && d.fireRate > 0 && d.damage > 0);
    assert.ok(d.ability.length > 0, `${id} has a signature ability name`);
  }
  assert.ok(TD_TOWERS.cannon.splash > 0 && TD_TOWERS.cannon.pierce, "cannon splashes + pierces armor");
  assert.ok(TD_TOWERS.frost.slow > 0, "frost slows");
  assert.ok(TD_TOWERS.pylon.detect, "pylon detects camo");
  assert.ok(TD_TOWERS.sniper.pierce && TD_TOWERS.sniper.defaultTarget === "strong", "sniper pierces + targets strong");
  assert.equal(TD_TOWERS.arrow.splash, 0, "arrow is single-target");
  assert.ok(TD_TOWERS.venom.pierce, "venom poison ignores armor");
});

test("upgrade cost rises across all four tiers then null at max; sell refunds a fraction", () => {
  assert.ok((tdUpgradeCost("arrow", 1) ?? 0) > 0);
  assert.ok((tdUpgradeCost("arrow", 2) ?? 0) > (tdUpgradeCost("arrow", 1) ?? 0));
  assert.ok((tdUpgradeCost("arrow", 3) ?? 0) > (tdUpgradeCost("arrow", 2) ?? 0));
  assert.equal(tdUpgradeCost("arrow", TD_MAX_TIER), null);
  assert.ok(tdSellValue("cannon", 4) > tdSellValue("cannon", 1));
  assert.ok(tdSellValue("cannon", 1) < TD_TOWERS.cannon.cost);
});

test("towerStats scale up with tier and clamp", () => {
  const t1 = towerStats("cannon", 1), t4 = towerStats("cannon", 4);
  assert.ok(t4.damage > t1.damage && t4.range > t1.range && t4.fireRate > t1.fireRate);
  assert.deepEqual(towerStats("cannon", 99), towerStats("cannon", TD_MAX_TIER));
});

test("signature abilities unlock at the final tier", () => {
  assert.equal(towerStats("arrow", 1).multishot, 1);
  assert.equal(towerStats("arrow", 4).multishot, 3, "arrow T4 multishot");
  assert.equal(towerStats("frost", 3).stun, 0);
  assert.ok(towerStats("frost", 4).stun > 0, "frost T4 stuns");
  assert.equal(towerStats("cannon", 3).dot, 0);
  assert.ok(towerStats("cannon", 4).dot > 0, "cannon T4 burns");
  assert.equal(towerStats("pylon", 3).buff, 0);
  assert.ok(towerStats("pylon", 4).buff > 0, "pylon T4 amp aura");
  assert.ok(towerStats("sniper", 4).crit > towerStats("sniper", 2).crit, "sniper crit grows");
});

test("tesla chains more and venom poisons harder each tier", () => {
  assert.ok(towerStats("tesla", 4).chain > towerStats("tesla", 1).chain, "tesla chains grow");
  assert.ok(towerStats("tesla", 2).chainRange > 0);
  assert.ok(towerStats("venom", 4).dot > towerStats("venom", 1).dot, "venom dot ramps");
  assert.ok(towerStats("venom", 1).dotTime > 0);
});

const C = (id: number, x: number, dist: number, hp: number, targetable = true): TdTargetable =>
  ({ id, pos: { x, z: 0 }, dist, hp, alive: true, targetable });

test("pickTarget honors each target priority", () => {
  const creeps = [C(1, 1, 5, 100), C(2, 2, 30, 50), C(3, 3, 20, 200)];
  assert.equal(pickTarget(0, 0, 10, creeps, "first"), 2, "first = furthest along");
  assert.equal(pickTarget(0, 0, 10, creeps, "last"), 1, "last = least far");
  assert.equal(pickTarget(0, 0, 10, creeps, "strong"), 3, "strong = most HP");
  assert.equal(pickTarget(0, 0, 10, creeps, "close"), 1, "close = nearest to tower");
  assert.equal(pickTarget(0, 0, 10, []), -1);
});

test("pickTarget ignores out-of-range, dead, and un-revealed camo creeps", () => {
  assert.equal(pickTarget(1000, 1000, 5, [C(1, 1, 5, 100)]), -1, "out of range");
  const dead = { ...C(1, 1, 5, 100), alive: false };
  assert.equal(pickTarget(0, 0, 10, [dead]), -1, "dead");
  const camo = C(2, 1, 5, 100, false); // un-revealed camo
  assert.equal(pickTarget(0, 0, 10, [camo]), -1, "un-targetable camo");
});

test("pickTargets returns up to n distinct creeps, best-first, honoring excludes", () => {
  const creeps = [C(1, 1, 5, 100), C(2, 2, 30, 50), C(3, 3, 20, 200)];
  const top2 = pickTargets(0, 0, 10, creeps, "first", 2);
  assert.equal(top2.length, 2);
  assert.equal(top2[0], 2, "furthest along first");
  const excl = pickTargets(0, 0, 10, creeps, "first", 3, new Set([2]));
  assert.ok(!excl.includes(2), "excluded id skipped");
});

test("nearestCreep finds the closest non-excluded creep in radius (chain jumps)", () => {
  const creeps = [C(1, 1, 5, 100), C(2, 2, 30, 50), C(3, 8, 20, 200)];
  assert.equal(nearestCreep(0, 0, 5, creeps, new Set()), 1, "closest in range");
  assert.equal(nearestCreep(0, 0, 5, creeps, new Set([1])), 2, "skips excluded, next closest");
  assert.equal(nearestCreep(0, 0, 3, creeps, new Set([1, 2])), -1, "nothing else in radius");
});

test("target modes list is the standard four", () => {
  assert.deepEqual([...TD_TARGET_MODES].sort(), ["close", "first", "last", "strong"]);
});
