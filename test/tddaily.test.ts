import test from "node:test";
import assert from "node:assert/strict";
import { TD_DAILY_MODS, tdDailyDay, tdDailyMods, tdDailyAvailable } from "../src/td/tddaily.ts";

test("modifier table is well-formed", () => {
  assert.ok(TD_DAILY_MODS.length >= 3);
  for (const m of TD_DAILY_MODS) {
    assert.ok(m.hpMul > 0 && m.speedMul > 0 && m.bountyMul > 0 && m.goldStartMul > 0);
    assert.ok(m.name.length > 0 && m.desc.length > 0);
  }
});

test("the day's modifier is deterministic and covers the table over time", () => {
  const day = 20_600;
  assert.equal(tdDailyMods(day).id, tdDailyMods(day).id);
  const seen = new Set<string>();
  for (let d = 0; d < 60; d++) seen.add(tdDailyMods(day + d).id);
  assert.ok(seen.size >= TD_DAILY_MODS.length - 1, "rotation visits (nearly) every modifier");
});

test("one attempt per day gating", () => {
  const today = tdDailyDay();
  assert.ok(tdDailyAvailable(0, today), "never attempted → available");
  assert.ok(tdDailyAvailable(today - 1, today), "yesterday's attempt → available");
  assert.ok(!tdDailyAvailable(today, today), "already attempted today → locked");
});

test("dayUtc bucketing is stable across a day and rolls at midnight UTC", () => {
  const t0 = Date.UTC(2026, 5, 10, 0, 0, 1);
  const t1 = Date.UTC(2026, 5, 10, 23, 59, 59);
  const t2 = Date.UTC(2026, 5, 11, 0, 0, 1);
  assert.equal(tdDailyDay(t0), tdDailyDay(t1));
  assert.equal(tdDailyDay(t2), tdDailyDay(t0) + 1);
});
