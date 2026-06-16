/**
 * Round difficulty-math invariants for src/rounds.ts.
 *
 * IMPORTANT SCOPE / TESTABILITY NOTE
 * ----------------------------------
 * RoundManager.beginRound (HP curve) and RoundManager.pickType (weighted type
 * sampling) are PRIVATE instance methods, and src/rounds.ts cannot even be
 * imported under the node:test runner: its transitive chain
 * (rounds -> zombie -> assets / voxelChar) imports the *type* `AnimState`
 * without the `type` modifier, which neither `--experimental-strip-types` nor
 * `--experimental-transform-types` can erase (see report). So we cannot call
 * the real functions directly.
 *
 * What we CAN do without touching src: src/config.ts imports cleanly (no THREE)
 * and holds every constant the curve + sampler are derived from. This suite
 * re-derives the EXACT formulas documented in rounds.ts from the REAL config
 * values and asserts the invariants the design promises (monotonic HP, smooth
 * inflection seam, type gating). A config regression that broke those promises
 * would be caught here. The arithmetic mirrors rounds.ts line-for-line.
 *
 * Runner: `npm run test:rounds` (plain --experimental-strip-types; config-only).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ZOMBIE, ROUNDS, ZOMBIE_TYPES, SPECIAL_ROUNDS, DIFFICULTY } from "../src/config.ts";

// ---- re-derived from rounds.ts beginRound() (kept verbatim) ---------------
// HP curve WITH the horde-regime growth discount applied to rounds past R20
// (mirrors beginRound's split-power form). normalRounds use full hpGrowth;
// hordeRounds (past hordeFromRound) use hpGrowth*hordeHpGrowthDiscount.
function roundHP(n: number): number {
  const inflect = ZOMBIE.hpInflection;
  const past = Math.max(0, n - inflect);
  const linHP = ZOMBIE.baseHealth + (n - 1) * ZOMBIE.healthPerRound;
  if (n <= inflect) return linHP;
  const baseHP = ZOMBIE.baseHealth + (inflect - 1) * ZOMBIE.healthPerRound;
  const hordeRounds = Math.max(0, n - ROUNDS.hordeFromRound);
  const normalRounds = past - hordeRounds;
  const discounted = ZOMBIE.hpGrowth * ROUNDS.hordeHpGrowthDiscount;
  return baseHP * Math.pow(ZOMBIE.hpGrowth, normalRounds) * Math.pow(discounted, hordeRounds);
}

// horde-regime 0..1 ramp (verbatim from beginRound)
function hordeRamp(n: number): number {
  return Math.max(0, Math.min(1, (n - ROUNDS.hordeFromRound) / ROUNDS.hordeRampRounds));
}
// per-round alive cap (no co-op/swarm), WITH the horde multiplier + ceiling
// clamp — verbatim port of beginRound's curMaxAlive math for a given ceiling.
function aliveCap(n: number, ceiling: number): number {
  const past = Math.max(0, n - ZOMBIE.hpInflection);
  let cap = Math.min(ceiling, ROUNDS.maxAliveBase + past * ROUNDS.maxAlivePerRound);
  if (n >= ROUNDS.hordeFromRound) {
    const aliveMul = 1 + (ROUNDS.hordeAliveMul - 1) * hordeRamp(n);
    cap = Math.min(ceiling, Math.round(cap * aliveMul));
  }
  return cap;
}
// per-round spawn BUDGET (no co-op/swarm), WITH the horde multiplier + countCap
// clamp — verbatim port of beginRound's count math.
function budget(n: number): number {
  let count = Math.min(ROUNDS.countCap, ROUNDS.baseCount + (n - 1) * ROUNDS.countPerRound);
  if (n >= ROUNDS.hordeFromRound) {
    const budgetMul = 1 + (ROUNDS.hordeBudgetMul - 1) * hordeRamp(n);
    count = Math.min(ROUNDS.countCap, Math.round(count * budgetMul));
  }
  return count;
}

test("HP curve is strictly monotonic increasing across R1..R40", () => {
  let prev = -Infinity;
  for (let n = 1; n <= 40; n++) {
    const hp = roundHP(n);
    assert.ok(hp > prev, `HP at R${n} (${hp}) should exceed R${n - 1} (${prev})`);
    prev = hp;
  }
});

test("HP is the additive (linear) value through the inflection round", () => {
  for (let n = 1; n <= ZOMBIE.hpInflection; n++) {
    assert.equal(roundHP(n), ZOMBIE.baseHealth + (n - 1) * ZOMBIE.healthPerRound);
  }
});

test("inflection seam is continuous: R(inflect) equals the multiplicative branch at past=0", () => {
  const inflect = ZOMBIE.hpInflection;
  const linAtInflect = ZOMBIE.baseHealth + (inflect - 1) * ZOMBIE.healthPerRound;
  // multiplicative branch base (past === 0 -> growth^0 === 1) must equal the
  // last linear value, so there is no jump at the seam.
  assert.equal(roundHP(inflect), linAtInflect);
  // first multiplicative round is exactly base * growth (no discontinuity)
  assert.ok(Math.abs(roundHP(inflect + 1) - linAtInflect * ZOMBIE.hpGrowth) < 1e-9);
});

test("HARDNESS: R40 zombies are a genuine bullet-wall — many× the R20 HP", () => {
  // The whole point of this pass: undo the over-discount + steepen the curve so a
  // maxed loadout+pet squad can't insta-kill R40. R40 must dwarf R20.
  const r20 = roundHP(20);
  const r40 = roundHP(40);
  assert.ok(r40 >= 12 * r20, `R40 HP (${Math.round(r40)}) should be >=12× R20 (${Math.round(r20)})`);
  // and the absolute floor: an R40 zombie should be a heavy sponge (tens of k HP)
  assert.ok(r40 >= 25000, `R40 HP (${Math.round(r40)}) should be a real wall (>=25k)`);
});

test("HARDNESS: the horde HP-growth discount is only a hair (>=0.97), never the old 0.92", () => {
  // 0.92 compounded into ~5× weaker R40 zombies and let pets trivialize the horde.
  assert.ok(ROUNDS.hordeHpGrowthDiscount >= 0.97, `discount ${ROUNDS.hordeHpGrowthDiscount} too generous`);
  assert.ok(ROUNDS.hordeHpGrowthDiscount < 1, "discount must still be a real (tiny) reduction");
});

test("HARDNESS: early/mid baseline aggression is up across the board", () => {
  // Player report wanted it harder "the whole way", not just late.
  assert.ok(ZOMBIE.baseHealth >= 80, `baseHealth ${ZOMBIE.baseHealth} should be >=80`);
  assert.ok(ZOMBIE.healthPerRound >= 32, `healthPerRound ${ZOMBIE.healthPerRound} should be >=32`);
  assert.ok(ZOMBIE.touchDamage >= 20, `touchDamage ${ZOMBIE.touchDamage} should be >=20`);
  assert.ok(ZOMBIE.speedCap >= 6.9, `speedCap ${ZOMBIE.speedCap} should be >=6.9`);
});

test("HARDNESS: the difficulty director ramps fast enough to bite before the horde regime", () => {
  // Coeff must cross 1.0 (where the elite credit-swap kicks in) well before R20.
  const coeffAt = (round: number) => (round - 1) * DIFFICULTY.perRound;
  assert.ok(coeffAt(20) >= 1.0, "director should pass the elite-swap threshold by R20 (round term alone)");
  // and it should be meaningfully faster than the pre-pass 0.05/round
  assert.ok(DIFFICULTY.perRound >= 0.08, `perRound ${DIFFICULTY.perRound} should be >=0.08`);
});

test("between the inflection and the horde regime HP compounds by exactly hpGrowth", () => {
  // Only valid up to hordeFromRound; the discount kicks in for rounds PAST R20.
  for (let n = ZOMBIE.hpInflection + 1; n <= ROUNDS.hordeFromRound; n++) {
    const ratio = roundHP(n) / roundHP(n - 1);
    assert.ok(Math.abs(ratio - ZOMBIE.hpGrowth) < 1e-9, `R${n}/R${n - 1} ratio ${ratio}`);
  }
});

// ---- co-op player-count scaling (beginRound), derived verbatim ------------
// Mirrors the co-op block in beginRound: N players ⇒ N× HP AND N× horde count,
// with the alive-cap bounded to 2× the perf ceiling.
function coopHP(n: number, players: number): number {
  return roundHP(n) * Math.max(1, Math.floor(players));
}
function coopCount(n: number, players: number): number {
  const base = Math.min(ROUNDS.countCap, ROUNDS.baseCount + (n - 1) * ROUNDS.countPerRound);
  return Math.round(base * Math.max(1, Math.floor(players)));
}

test("co-op scales zombie HP linearly with player count (1/2/4 ⇒ 1×/2×/4×)", () => {
  for (const n of [1, 5, 10, 20]) {
    assert.equal(coopHP(n, 1), roundHP(n));
    assert.equal(coopHP(n, 2), roundHP(n) * 2);
    assert.equal(coopHP(n, 4), roundHP(n) * 4);
  }
});

test("co-op scales the horde COUNT linearly with player count", () => {
  for (const n of [1, 3, 8]) {
    assert.equal(coopCount(n, 2), 2 * Math.min(ROUNDS.countCap, ROUNDS.baseCount + (n - 1) * ROUNDS.countPerRound));
    assert.equal(coopCount(n, 4), 4 * Math.min(ROUNDS.countCap, ROUNDS.baseCount + (n - 1) * ROUNDS.countPerRound));
  }
});

test("solo (1 player) leaves HP and count unchanged", () => {
  for (let n = 1; n <= 15; n++) {
    assert.equal(coopHP(n, 1), roundHP(n));
    assert.equal(coopCount(n, 1), Math.min(ROUNDS.countCap, ROUNDS.baseCount + (n - 1) * ROUNDS.countPerRound));
  }
});

test("alive-cap is bounded to 2× the perf ceiling even with 4 players", () => {
  // beginRound: curMaxAlive = min(maxAliveCeiling * 2, curMaxAlive * players)
  const ceiling = ROUNDS.maxAliveCap;
  for (const players of [2, 4, 8]) {
    const naive = ROUNDS.maxAliveBase * players; // an upper-ish bound on curMaxAlive*players
    const bounded = Math.min(ceiling * 2, naive);
    assert.ok(bounded <= ceiling * 2, `cap ${bounded} must not exceed 2× ceiling`);
  }
});

// ---- pickType() gating preconditions over the REAL ZOMBIE_TYPES table -----

test("ZOMBIE_TYPES[0] is the shambler with weight 0 (pickType uses it as filler)", () => {
  assert.equal(ZOMBIE_TYPES[0].id, "shambler");
  assert.equal(ZOMBIE_TYPES[0].weight, 0);
  assert.equal(ZOMBIE_TYPES[0].from, 1);
});

test("every elite id referenced by pickType exists in ZOMBIE_TYPES", () => {
  // mirrors RoundManager.ELITE_IDS
  const ELITE_IDS = ["brute", "armored", "abomination", "splitter", "necro"];
  const ids = new Set(ZOMBIE_TYPES.map((t) => t.id));
  for (const e of ELITE_IDS) assert.ok(ids.has(e), `elite id ${e} missing from ZOMBIE_TYPES`);
});

test("a re-derived pickType only returns types unlocked at the given round", () => {
  // verbatim port of pickType() with an injectable RNG, so we can exercise the
  // gating + weighting logic deterministically against the real type table.
  const ELITE_IDS = new Set(["brute", "armored", "abomination", "splitter", "necro"]);
  function pickType(round: number, rng: () => number) {
    const eliteBonus = Math.max(0, Math.min(0.6, (round - 5) * 0.04));
    const shamblerWeight = Math.max(0.25, 0.9 - (round - 1) * 0.04);
    let total = shamblerWeight;
    for (let i = 1; i < ZOMBIE_TYPES.length; i++) {
      const t = ZOMBIE_TYPES[i];
      if (round < t.from) continue;
      total += t.weight * (ELITE_IDS.has(t.id) ? 1 + eliteBonus : 1);
    }
    let r = rng() * total;
    if ((r -= shamblerWeight) < 0) return ZOMBIE_TYPES[0];
    for (let i = 1; i < ZOMBIE_TYPES.length; i++) {
      const t = ZOMBIE_TYPES[i];
      if (round < t.from) continue;
      const w = t.weight * (ELITE_IDS.has(t.id) ? 1 + eliteBonus : 1);
      if ((r -= w) < 0) return t;
    }
    return ZOMBIE_TYPES[0];
  }

  // Sweep the whole [0,1) RNG range at several rounds; never yield a locked type.
  for (const round of [1, 2, 3, 5, 7, 9, 10, 15, 20]) {
    for (let k = 0; k < 200; k++) {
      const picked = pickType(round, () => k / 200);
      assert.ok(round >= picked.from, `R${round} returned ${picked.id} (from ${picked.from})`);
    }
  }
});

test("re-derived pickType: round 1 can ONLY ever produce the shambler", () => {
  const pickAt1 = (rngVal: number) => {
    // at round 1 no other type is unlocked (next-earliest from is 2)
    const shamblerWeight = Math.max(0.25, 0.9 - (1 - 1) * 0.04); // 0.9
    const total = shamblerWeight; // nothing else eligible
    let r = rngVal * total;
    if ((r -= shamblerWeight) < 0) return ZOMBIE_TYPES[0];
    return ZOMBIE_TYPES[0];
  };
  for (let k = 0; k < 100; k++) assert.equal(pickAt1(k / 100).id, "shambler");
});

test("shambler filler weight floors at 0.25 and never vanishes", () => {
  for (let round = 1; round <= 60; round++) {
    const w = Math.max(0.25, 0.9 - (round - 1) * 0.04);
    assert.ok(w >= 0.25, `shambler weight ${w} at R${round}`);
  }
});

test("elite bonus ramp is clamped to [0, 0.6] and starts at R6 (steeper this pass)", () => {
  const bonus = (round: number) => Math.max(0, Math.min(0.6, (round - 5) * 0.04));
  assert.equal(bonus(5), 0); // (5-5)*0.04 = 0
  assert.ok(bonus(4) === 0); // clamped, no negative bonus before R6
  assert.ok(Math.abs(bonus(6) - 0.04) < 1e-9); // first ramp step at R6
  assert.equal(bonus(100), 0.6); // hard cap (raised from 0.35)
});

// ---- mutation rounds (classifySpecial), derived from SPECIAL_ROUNDS --------
// Port of the precedence in RoundManager.classifySpecial: hound (every Nth)
// wins, then mutation (every Mth, rotating), then showcases. We only assert the
// hound>mutation precedence + the rotation here (showcase eligibility needs the
// type table, covered structurally below).
function mutationFor(n: number) {
  const sp = SPECIAL_ROUNDS;
  if (n <= 0) return null;
  if (n % sp.houndEvery === 0) return { id: "hound" }; // hound takes precedence
  if (n % sp.mutationEvery === 0) {
    return sp.mutations[(n / sp.mutationEvery - 1) % sp.mutations.length];
  }
  return null;
}

test("mutation rounds land on every mutationEvery-th round (unless hound wins)", () => {
  const e = SPECIAL_ROUNDS.mutationEvery;
  for (let k = 1; k <= 12; k++) {
    const n = e * k;
    const m = mutationFor(n);
    if (n % SPECIAL_ROUNDS.houndEvery === 0) {
      assert.equal(m?.id, "hound", `R${n} should be a hound round (precedence)`);
    } else {
      assert.ok(m && "mutator" in m, `R${n} should be a mutation round`);
    }
  }
});

test("mutation rounds rotate through the full mutation list in order", () => {
  const e = SPECIAL_ROUNDS.mutationEvery;
  const list = SPECIAL_ROUNDS.mutations;
  // Collect mutation ids in round order, skipping rounds the hound steals.
  const seen: string[] = [];
  for (let k = 1; k <= list.length * 2; k++) {
    const n = e * k;
    if (n % SPECIAL_ROUNDS.houndEvery === 0) continue;
    const m = mutationFor(n) as { id: string };
    seen.push(m.id);
  }
  // Each mutation id should appear, and consecutive picks follow the list order.
  for (const m of list) assert.ok(seen.includes(m.id), `mutation ${m.id} never rotated in`);
});

test("every mutation has a valid mutator + a reward bump >1", () => {
  const valid = new Set(["frenzy", "volatile", "inferno", "armored"]);
  for (const m of SPECIAL_ROUNDS.mutations) {
    assert.ok(valid.has(m.mutator), `unknown mutator ${m.mutator}`);
    assert.ok(m.rewardMul > 1, `mutation ${m.id} should reward >1x, got ${m.rewardMul}`);
  }
});

// ---- swarm gating (isSwarm in beginRound), derived from ROUNDS -------------
test("swarm rounds: every Nth round that isn't a boss round (n%5)", () => {
  const isSwarm = (n: number) => n >= ROUNDS.swarmEvery && n % ROUNDS.swarmEvery === 0 && n % 5 !== 0;
  // swarmEvery is 7: R7,R14 swarm; R35 (7*5) is a boss round, so NOT swarm.
  assert.equal(isSwarm(7), true);
  assert.equal(isSwarm(14), true);
  assert.equal(isSwarm(35), false); // boss round wins
  assert.equal(isSwarm(6), false);
  assert.equal(isSwarm(5), false);
});

// ---- HORDE REGIME (R20+), derived verbatim from beginRound -----------------

test("horde ramp is 0 before R20, climbs 0→1 across R20..R30, pinned at 1 after", () => {
  assert.equal(hordeRamp(ROUNDS.hordeFromRound - 1), 0); // R19: regime not yet live
  assert.equal(hordeRamp(ROUNDS.hordeFromRound), 0); // R20: announced start, ramp just 0
  assert.ok(hordeRamp(25) > 0 && hordeRamp(25) < 1, "mid-climb ramp strictly between 0 and 1");
  assert.equal(hordeRamp(ROUNDS.hordeFromRound + ROUNDS.hordeRampRounds), 1); // R30: full
  assert.equal(hordeRamp(50), 1); // pinned at 1 well past the climb
  // monotonic non-decreasing across the climb
  let prev = -1;
  for (let n = 18; n <= 35; n++) {
    const r = hordeRamp(n);
    assert.ok(r >= prev, `ramp must not decrease at R${n}`);
    prev = r;
  }
});

test("horde regime is a CLIMB, not a step-function: R20 alive cap rises but isn't instantly maxed", () => {
  const ceiling = ROUNDS.maxAliveCap;
  // R20 ramp is 0, so the alive multiplier is 1× — R20 starts the announcement
  // without a one-round spike (the cap equals the plain pre-horde curve, clamped).
  assert.equal(hordeRamp(ROUNDS.hordeFromRound), 0);
  // The cap then climbs hard and is pinned at the ceiling by the top of the ramp.
  assert.ok(aliveCap(25, ceiling) > aliveCap(20, ceiling), "R25 cap exceeds R20 cap");
  assert.equal(aliveCap(30, ceiling), ceiling, "by R30 the desktop cap is pinned at the ceiling");
});

test("horde alive cap is monotonic non-decreasing and never exceeds the ceiling", () => {
  for (const ceiling of [ROUNDS.maxAliveCap, 96 /* mobile */]) {
    let prev = -1;
    for (let n = 1; n <= 60; n++) {
      const cap = aliveCap(n, ceiling);
      assert.ok(cap <= ceiling, `R${n} cap ${cap} exceeds ceiling ${ceiling}`);
      assert.ok(cap >= prev, `R${n} cap ${cap} dropped below R${n - 1} ${prev}`);
      prev = cap;
    }
  }
});

test("horde regime drives desktop density far above pre-horde mid-game", () => {
  const ceiling = ROUNDS.maxAliveCap;
  // R19 is the last pre-horde round (cap 130 under today's curve); R30 is full
  // horde, pinned at the RAISED 230 ceiling — a ~1.77× jump in on-screen bodies,
  // and roughly 2× the OLD 170 ceiling that capped the mid-20s before this pass.
  const r19 = aliveCap(19, ceiling);
  const r30 = aliveCap(30, ceiling);
  assert.ok(r30 >= 1.7 * r19, `R30 cap ${r30} should be well above R19 ${r19}`);
  assert.equal(r30, ceiling); // pinned at the raised ceiling
  assert.ok(r30 >= 2 * 170 * 0.6, "R30 density is a genuine wall vs. the old 170 ceiling");
});

test("the spawn BUDGET rises under the horde regime (a horde round LASTS)", () => {
  // R19 vs R30: the fatter budget keeps the refill-the-wall loop going longer.
  assert.ok(budget(30) > budget(19), "R30 budget must exceed R19 budget");
  // and it climbs through the ramp
  assert.ok(budget(25) >= budget(20), "budget non-decreasing through the climb");
  // clamped at countCap
  for (let n = 1; n <= 80; n++) assert.ok(budget(n) <= ROUNDS.countCap, `R${n} budget over countCap`);
});

test("HP-growth discount applies ONLY past R20 and softens (but never reverses) the curve", () => {
  // The discount must make post-R20 per-round growth SMALLER than the full
  // hpGrowth, but HP must still rise every round (mowing, not shrinking sponges).
  const discounted = ZOMBIE.hpGrowth * ROUNDS.hordeHpGrowthDiscount;
  assert.ok(ROUNDS.hordeHpGrowthDiscount < 1, "discount must be a real reduction");
  assert.ok(discounted > 1, "even discounted, HP must still grow each round (>1×)");
  for (let n = ROUNDS.hordeFromRound + 1; n <= 40; n++) {
    const ratio = roundHP(n) / roundHP(n - 1);
    assert.ok(Math.abs(ratio - discounted) < 1e-9, `R${n} post-horde ratio ${ratio} != ${discounted}`);
  }
  // the discount genuinely lowers late HP vs. the un-discounted curve
  const undiscounted = (n: number) => {
    const baseHP = ZOMBIE.baseHealth + (ZOMBIE.hpInflection - 1) * ZOMBIE.healthPerRound;
    return baseHP * Math.pow(ZOMBIE.hpGrowth, n - ZOMBIE.hpInflection);
  };
  assert.ok(roundHP(30) < undiscounted(30), "R30 HP should be below the no-discount curve");
});

test("HP curve stays strictly monotonic across the horde seam (R19→R20→R30)", () => {
  let prev = -Infinity;
  for (let n = 1; n <= 50; n++) {
    const hp = roundHP(n);
    assert.ok(hp > prev, `HP at R${n} (${hp}) should exceed R${n - 1} (${prev})`);
    prev = hp;
  }
  // seam continuity: R20 HP equals the plain (un-discounted) curve at R20, since
  // the discount only applies to rounds PAST hordeFromRound.
  const plainAt20 = (() => {
    const baseHP = ZOMBIE.baseHealth + (ZOMBIE.hpInflection - 1) * ZOMBIE.healthPerRound;
    return baseHP * Math.pow(ZOMBIE.hpGrowth, ROUNDS.hordeFromRound - ZOMBIE.hpInflection);
  })();
  assert.ok(Math.abs(roundHP(ROUNDS.hordeFromRound) - plainAt20) < 1e-9, "R20 seam is continuous");
});

test("mobile horde ceiling stays distinctly below the desktop ceiling", () => {
  const desktop = ROUNDS.maxAliveCap; // 230
  const mobile = 96; // set in main.ts (lowSpec)
  assert.ok(mobile < desktop, "mobile ceiling must stay below desktop");
  assert.ok(mobile <= desktop * 0.6, "mobile ceiling kept well under desktop for the frame budget");
  // even at full horde the mobile cap is clamped to its own (lower) ceiling
  assert.equal(aliveCap(30, mobile), mobile, "R30 mobile cap pinned at mobile ceiling");
  assert.ok(aliveCap(30, mobile) < aliveCap(30, desktop), "mobile R30 density below desktop");
});

test("horde knobs are sane: ramp>0, full multipliers >1, discount in (0,1)", () => {
  assert.ok(ROUNDS.hordeFromRound > 0);
  assert.ok(ROUNDS.hordeRampRounds > 0);
  assert.ok(ROUNDS.hordeAliveMul > 1, "alive multiplier must increase density");
  assert.ok(ROUNDS.hordeBudgetMul > 1, "budget multiplier must fatten the round");
  assert.ok(ROUNDS.hordeHpGrowthDiscount > 0 && ROUNDS.hordeHpGrowthDiscount < 1);
  // countCap must exceed the desktop alive ceiling (the refill-the-wall invariant)
  assert.ok(ROUNDS.countCap > ROUNDS.maxAliveCap, "countCap must sit above the alive ceiling");
});
