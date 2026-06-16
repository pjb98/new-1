/**
 * Pure-math tests for src/idle.ts — offline accrual, prestige curve, day buckets,
 * login streak (+ freeze), and daily quests.
 *
 * idle.ts imports only ./config + ./save TYPES (no THREE/DOM), so it strips and
 * runs cleanly under node:test exactly like the rounds/save suites.
 *
 * Runner: `npm run test:idle` -> node --test --experimental-strip-types.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  offlineGold,
  prestigeGain,
  prestigeMultiplier,
  dayUtc,
  settleStreak,
  streakReward,
  rollDaily,
  applyDailyProgress,
  settleDaily,
  dailyRows,
} from "../src/idle.ts";
import { IDLE, PRESTIGE, STREAK, DAILY_QUESTS } from "../src/config.ts";
import type { StreakState, DailyState } from "../src/save.ts";

const DAY = 86_400_000;
const mkStreak = (count: number, lastDayUtc: number, freezes = 0): StreakState => ({ count, lastDayUtc, freezes });
const mkDaily = (dayUtc: number, progress: Record<string, number> = {}, claimed: string[] = []): DailyState => ({ dayUtc, progress, claimed });

const HOUR = 60 * 60 * 1000;

// ──────────────────────────── offlineGold ────────────────────────────

test("offlineGold pays HALF the active rate over the elapsed window", () => {
  // 10 gold/sec active -> 5 gold/sec offline. 1h = 3600s -> 18000 gold.
  assert.equal(offlineGold(10, HOUR), Math.floor(10 * IDLE.offlineRate * 3600));
  assert.equal(offlineGold(10, HOUR), 18_000);
});

test("offlineGold respects the cap (long absence clamps to capMs)", () => {
  const rate = 4;
  // 100h elapsed but default cap is 8h -> paid for 8h only.
  const capped = offlineGold(rate, 100 * HOUR);
  assert.equal(capped, offlineGold(rate, IDLE.offlineCapMs));
  assert.equal(capped, Math.floor(rate * IDLE.offlineRate * (IDLE.offlineCapMs / 1000)));
});

test("offlineGold honours a custom capMs", () => {
  // cap at 30 min: 5 gold/sec active, 10h elapsed -> only 30min paid.
  const g = offlineGold(5, 10 * HOUR, 30 * 60 * 1000);
  assert.equal(g, Math.floor(5 * IDLE.offlineRate * 1800));
});

test("offlineGold is zero for zero / negative / non-finite elapsed", () => {
  assert.equal(offlineGold(10, 0), 0);
  assert.equal(offlineGold(10, -5000), 0);
  assert.equal(offlineGold(10, Number.NaN), 0);
  assert.equal(offlineGold(10, Infinity), 0); // non-finite elapsed (corrupt clock) -> no payout
});

test("offlineGold is zero for zero / negative / non-finite rate", () => {
  assert.equal(offlineGold(0, HOUR), 0);
  assert.equal(offlineGold(-3, HOUR), 0);
  assert.equal(offlineGold(Number.NaN, HOUR), 0);
});

test("offlineGold floors fractional gold (never over-pays)", () => {
  // 1 gold/sec active -> 0.5/sec offline. 3s -> 1.5 -> floors to 1.
  assert.equal(offlineGold(1, 3000), 1);
  assert.equal(offlineGold(1, 1000), 0); // 0.5 -> 0
});

// ──────────────────────────── prestigeGain ────────────────────────────

test("prestigeGain follows floor(sqrt(lifetimeGold / X)) minus owned", () => {
  const X = PRESTIGE.x; // 50_000
  assert.equal(prestigeGain(0, 0, X), 0);
  assert.equal(prestigeGain(X - 1, 0, X), 0); // just under the first point
  assert.equal(prestigeGain(X, 0, X), 1); // exactly enough for #1
  assert.equal(prestigeGain(4 * X, 0, X), 2); // sqrt(4)=2
  assert.equal(prestigeGain(9 * X, 0, X), 3); // sqrt(9)=3
  assert.equal(prestigeGain(16 * X, 0, X), 4);
});

test("prestigeGain returns only the GAIN above already-owned", () => {
  const X = PRESTIGE.x;
  assert.equal(prestigeGain(9 * X, 2, X), 1); // total 3, own 2 -> +1
  assert.equal(prestigeGain(9 * X, 3, X), 0); // already claimed all
  assert.equal(prestigeGain(9 * X, 5, X), 0); // never negative
});

test("prestigeGain guards against garbage input", () => {
  assert.equal(prestigeGain(Number.NaN, 0), 0);
  assert.equal(prestigeGain(-100, 0), 0);
  assert.equal(prestigeGain(1e9, Number.NaN), prestigeGain(1e9, 0)); // bad owned -> treat as 0
});

test("prestigeGain X tuned so first ascension needs ~50k lifetime gold (2-3h)", () => {
  // Sanity-lock the chosen constant so a config edit that breaks the pacing
  // promise is caught here.
  assert.equal(PRESTIGE.x, 50_000);
  assert.equal(prestigeGain(49_999, 0), 0);
  assert.equal(prestigeGain(50_000, 0), 1);
});

// ──────────────────────────── prestigeMultiplier ────────────────────────────

test("prestigeMultiplier is 1 + prestige * k", () => {
  const k = PRESTIGE.k; // 0.10
  assert.equal(prestigeMultiplier(0), 1);
  assert.equal(prestigeMultiplier(1), 1 + k);
  assert.equal(prestigeMultiplier(5), 1 + 5 * k);
  assert.equal(prestigeMultiplier(10, 0.2), 1 + 10 * 0.2);
});

test("prestigeMultiplier floors prestige and guards garbage (never < 1)", () => {
  assert.equal(prestigeMultiplier(2.9), 1 + 2 * PRESTIGE.k);
  assert.equal(prestigeMultiplier(-3), 1);
  assert.equal(prestigeMultiplier(Number.NaN), 1);
});

// ──────────────────────────── dayUtc ────────────────────────────

test("dayUtc buckets ms-epoch into whole UTC days", () => {
  assert.equal(dayUtc(0), 0);
  assert.equal(dayUtc(DAY - 1), 0); // still day 0
  assert.equal(dayUtc(DAY), 1);
  assert.equal(dayUtc(DAY * 100 + 12345), 100);
  assert.equal(dayUtc(-5), 0); // garbage/negative -> 0
  assert.equal(dayUtc(Number.NaN), 0);
});

// ──────────────────────────── settleStreak ────────────────────────────

test("settleStreak: first ever login starts the streak at 1 and pays", () => {
  const r = settleStreak(mkStreak(0, 0), 1000);
  assert.equal(r.advanced, true);
  assert.equal(r.streak.count, 1);
  assert.equal(r.streak.lastDayUtc, 1000);
  assert.equal(r.usedFreeze, false);
  assert.ok(r.gold > 0);
});

test("settleStreak: same UTC day is a no-op (no double pay)", () => {
  const r = settleStreak(mkStreak(3, 1000), 1000);
  assert.equal(r.advanced, false);
  assert.equal(r.gold, 0);
  assert.equal(r.streak.count, 3);
});

test("settleStreak: a clock that ran backwards is a no-op", () => {
  const r = settleStreak(mkStreak(3, 1000), 999);
  assert.equal(r.advanced, false);
  assert.equal(r.streak.count, 3);
});

test("settleStreak: consecutive day (yesterday) increments", () => {
  const r = settleStreak(mkStreak(3, 1000), 1001);
  assert.equal(r.advanced, true);
  assert.equal(r.streak.count, 4);
  assert.equal(r.usedFreeze, false);
});

test("settleStreak: a 2-day gap with NO freeze resets to 1", () => {
  const r = settleStreak(mkStreak(5, 1000, 0), 1002); // missed day 1001
  assert.equal(r.advanced, true);
  assert.equal(r.streak.count, 1);
  assert.equal(r.usedFreeze, false);
});

test("settleStreak: a 2-day gap WITH a freeze forgives the miss (+1, freeze spent)", () => {
  const r = settleStreak(mkStreak(5, 1000, 1), 1002); // missed one day, 1 freeze banked
  assert.equal(r.advanced, true);
  assert.equal(r.usedFreeze, true);
  assert.equal(r.streak.count, 6);
  assert.equal(r.streak.freezes, 0); // spent
});

test("settleStreak: a freeze only forgives ONE day — a 3-day gap still resets", () => {
  const r = settleStreak(mkStreak(5, 1000, 2), 1003); // 2-day miss, too big for one freeze
  assert.equal(r.streak.count, 1);
  assert.equal(r.usedFreeze, false);
  assert.equal(r.streak.freezes, 2); // not spent on an unforgivable gap
});

test("settleStreak: a fresh freeze is granted at the milestone length (capped)", () => {
  // count 4 -> 5 (== freezeGrantEvery) grants one freeze.
  const r = settleStreak(mkStreak(STREAK.freezeGrantEvery - 1, 1000, 0), 1001);
  assert.equal(r.streak.count, STREAK.freezeGrantEvery);
  assert.equal(r.streak.freezes, 1);
  // never bank more than freezeMax
  const capped = settleStreak(mkStreak(STREAK.freezeGrantEvery - 1, 1000, STREAK.freezeMax), 1001);
  assert.equal(capped.streak.freezes, STREAK.freezeMax);
});

test("streakReward grows with streak then caps", () => {
  const d1 = streakReward(1);
  const d10 = streakReward(10);
  assert.ok(d10.gold > d1.gold);
  // beyond capDays gold stops growing
  assert.deepEqual(streakReward(STREAK.capDays), streakReward(STREAK.capDays + 50));
  assert.ok(streakReward(9999).essence <= STREAK.essenceCap);
});

// ──────────────────────────── daily quests ────────────────────────────

test("rollDaily clears the board on a new UTC day, no-ops on the same day", () => {
  const today = mkDaily(100, { kills: 50 }, ["play"]);
  assert.strictEqual(rollDaily(today, 100), today); // same day -> same ref
  const rolled = rollDaily(today, 101);
  assert.equal(rolled.dayUtc, 101);
  assert.deepEqual(rolled.progress, {});
  assert.deepEqual(rolled.claimed, []);
});

test("applyDailyProgress adds run deltas onto the matching quest metrics", () => {
  const d0 = mkDaily(1);
  const d1 = applyDailyProgress(d0, { runs: 1, kills: 120, gold: 300 });
  assert.equal(d1.progress.play, 1); // metric "runs"
  assert.equal(d1.progress.cull, 120); // metric "kills"
  assert.equal(d1.progress.earn, 300); // metric "gold"
  const d2 = applyDailyProgress(d1, { runs: 1, kills: 100, gold: 250 });
  assert.equal(d2.progress.play, 2);
  assert.equal(d2.progress.cull, 220);
  assert.equal(d2.progress.earn, 550);
  // purity: original untouched
  assert.equal(d0.progress.play, undefined);
});

test("settleDaily pays + claims only newly-finished quests, never twice", () => {
  const d = mkDaily(1, { play: 1, cull: 220, earn: 100 }); // play+cull done, earn not (goal 500)
  const r = settleDaily(d);
  assert.deepEqual(r.completed.sort(), ["cull", "play"]);
  const playQ = DAILY_QUESTS.find((q) => q.id === "play")!;
  const cullQ = DAILY_QUESTS.find((q) => q.id === "cull")!;
  assert.equal(r.gold, playQ.gold + cullQ.gold);
  assert.equal(r.essence, playQ.essence + cullQ.essence);
  // settling again pays nothing (already claimed)
  const again = settleDaily(r.daily);
  assert.equal(again.gold, 0);
  assert.deepEqual(again.completed, []);
});

test("dailyRows reports clamped progress, done + claimed flags", () => {
  const d = mkDaily(1, { play: 5, cull: 50 }, ["play"]);
  const rows = dailyRows(d);
  const play = rows.find((r) => r.id === "play")!;
  const cull = rows.find((r) => r.id === "cull")!;
  assert.equal(play.progress, play.goal); // clamped to goal
  assert.equal(play.done, true);
  assert.equal(play.claimed, true);
  assert.equal(cull.done, false);
  assert.equal(cull.claimed, false);
});

// ──────────────────────────── daily board deal ────────────────────────────

test("questsForDay deals a deterministic 3-quest board that rotates by day", async () => {
  const { questsForDay } = await import("../src/idle.ts");
  const day = 20_600;
  const a = questsForDay(day).map((q) => q.id);
  const b = questsForDay(day).map((q) => q.id);
  assert.deepEqual(a, b, "same day → same board");
  assert.equal(a.length, 3);
  assert.equal(new Set(a).size, 3, "no duplicate quests on a board");
  // boards differ across a week (rotation actually happens)
  const week = new Set<string>();
  for (let d = 0; d < 7; d++) week.add(questsForDay(day + d).map((q) => q.id).join(","));
  assert.ok(week.size > 1, "boards rotate across days");
});
