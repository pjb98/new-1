/**
 * Pure spawn-math tests for src/bedwars/bwresources.ts — generator interval
 * scaling, drop pacing over a simulated span, the anti-hoard cap, tier clamping,
 * and the immutable wallet helpers.
 *
 * bwresources.ts imports nothing (no THREE/DOM), so it strips and runs cleanly
 * under node:test exactly like the idle/rounds suites.
 *
 * Runner: `node --test --experimental-strip-types test/bwresources.test.ts`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeGenerator,
  genInterval,
  tickGenerator,
  upgradeGenerator,
  emptyWallet,
  addToWallet,
  BW_GEN_TUNING,
  type BwResource,
} from "../src/bedwars/bwresources.ts";

/** Simulate `span` seconds of ticks at a fixed `dt`, returning total dropped. */
function simulate(kind: BwResource, tier: number, span: number, dt = 0.1, cap = Infinity): number {
  const gen = makeGenerator("g", kind, tier);
  let sitting = 0;
  let total = 0;
  for (let t = 0; t < span - 1e-9; t += dt) {
    for (const drop of tickGenerator(gen, dt, Math.min(sitting, cap))) {
      total += drop.amount;
      sitting += drop.amount;
    }
  }
  return total;
}

// ──────────────────────────── genInterval ────────────────────────────

test("genInterval at tier 1 equals the base interval for each resource", () => {
  assert.equal(genInterval(makeGenerator("i", "iron")), BW_GEN_TUNING.baseInterval.iron);
  assert.equal(genInterval(makeGenerator("g", "gold")), BW_GEN_TUNING.baseInterval.gold);
  assert.equal(genInterval(makeGenerator("e", "emerald")), BW_GEN_TUNING.baseInterval.emerald);
});

test("genInterval strictly decreases as tier rises (higher tier = faster)", () => {
  for (const kind of ["iron", "gold", "emerald"] as BwResource[]) {
    const t1 = genInterval(makeGenerator("a", kind, 1));
    const t2 = genInterval(makeGenerator("a", kind, 2));
    const t3 = genInterval(makeGenerator("a", kind, 3));
    assert.ok(t1 > t2, `${kind} t1 ${t1} should exceed t2 ${t2}`);
    assert.ok(t2 > t3, `${kind} t2 ${t2} should exceed t3 ${t3}`);
    // exactly base * speedup^(tier-1)
    assert.ok(Math.abs(t2 - t1 * BW_GEN_TUNING.tierSpeedup) < 1e-9);
    assert.ok(Math.abs(t3 - t1 * BW_GEN_TUNING.tierSpeedup ** 2) < 1e-9);
  }
});

// ──────────────────────────── tickGenerator pacing ────────────────────────────

test("iron tier1 drops ~6 ingots over a simulated 10s (interval 1.5s)", () => {
  const total = simulate("iron", 1, 10);
  // 10 / 1.5 = 6.67 → 6 full drops, each amount 1 at tier 1.
  assert.equal(total, 6);
});

test("gold tier1 drops ~5 over 31s (interval 6s) — the slow trickle", () => {
  // 31 / 6 = 5.16 → 5 full drops (well clear of float-drift on the 30s seam).
  assert.equal(simulate("gold", 1, 31), 5);
});

test("tier 3 fires faster AND drops +1 amount per pop", () => {
  const gen = makeGenerator("e", "emerald", 3);
  // emerald t3 interval = 18 * 0.7^2 = 8.82s. One dt past it pops amount 2.
  const first = tickGenerator(gen, genInterval(gen), 0);
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, "emerald");
  assert.equal(first[0].amount, 2); // tier 3 bonus unit
});

test("tickGenerator returns nothing before an interval elapses, then exactly one drop", () => {
  const gen = makeGenerator("i", "iron"); // 1.5s
  assert.deepEqual(tickGenerator(gen, 1.0, 0), []); // not yet
  const popped = tickGenerator(gen, 0.6, 0); // acc now 1.6 ≥ 1.5
  assert.equal(popped.length, 1);
  assert.equal(popped[0].amount, 1);
});

test("tickGenerator ignores zero / negative / non-finite dt", () => {
  const gen = makeGenerator("i", "iron");
  assert.deepEqual(tickGenerator(gen, 0, 0), []);
  assert.deepEqual(tickGenerator(gen, -5, 0), []);
  assert.deepEqual(tickGenerator(gen, Number.NaN, 0), []);
  assert.equal(gen.acc, 0); // accumulator untouched by garbage dt
});

// ──────────────────────────── capPerGen (anti-hoard) ────────────────────────────

test("a full spawner (sitting >= cap) holds: no drops, charge preserved", () => {
  const gen = makeGenerator("g", "gold");
  const cap = BW_GEN_TUNING.capPerGen.gold;
  // Plenty of time, but the pile is already capped → nothing pops.
  const out = tickGenerator(gen, 100, cap);
  assert.deepEqual(out, []);
  // acc clamped to one interval so it pops INSTANTLY once collected.
  assert.ok(Math.abs(gen.acc - genInterval(gen)) < 1e-9);
  const resumed = tickGenerator(gen, 0.001, 0); // collected → pops on the next tick
  assert.equal(resumed.length, 1);
});

test("simulated run never exceeds the cap, then resumes when drained", () => {
  // gold over a huge span with the cap enforced: total dropped == cap, no more.
  const cap = BW_GEN_TUNING.capPerGen.gold;
  assert.equal(simulate("gold", 1, 10_000, 0.5, cap), cap);
});

// ──────────────────────────── upgradeGenerator ────────────────────────────

test("upgradeGenerator steps the tier up and clamps hard at 3", () => {
  const gen = makeGenerator("i", "iron", 1);
  assert.equal(upgradeGenerator(gen), 2);
  assert.equal(upgradeGenerator(gen), 3);
  assert.equal(upgradeGenerator(gen), 3); // clamped — no tier 4
  assert.equal(gen.tier, 3);
});

test("makeGenerator clamps an out-of-range starting tier into 1..3", () => {
  assert.equal(makeGenerator("a", "iron", 0).tier, 1);
  assert.equal(makeGenerator("a", "iron", 9).tier, 3);
  assert.equal(makeGenerator("a", "iron", Number.NaN).tier, 1);
});

// ──────────────────────────── wallet helpers ────────────────────────────

test("emptyWallet is fully zeroed", () => {
  assert.deepEqual(emptyWallet(), { iron: 0, gold: 0, diamond: 0, emerald: 0 });
});

test("addToWallet adds correctly and returns a NEW object (immutable)", () => {
  const w0 = emptyWallet();
  const w1 = addToWallet(w0, "iron", 5);
  assert.equal(w1.iron, 5);
  assert.notStrictEqual(w0, w1); // new object
  assert.equal(w0.iron, 0); // original untouched
  const w2 = addToWallet(w1, "iron", 3);
  assert.equal(w2.iron, 8);
  assert.equal(w2.gold, 0);
});

test("addToWallet ignores non-positive / non-finite amounts", () => {
  const w = addToWallet(emptyWallet(), "gold", 10);
  assert.equal(addToWallet(w, "gold", 0).gold, 10);
  assert.equal(addToWallet(w, "gold", -4).gold, 10);
  assert.equal(addToWallet(w, "gold", Number.NaN).gold, 10);
});
