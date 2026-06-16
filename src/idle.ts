/**
 * Pure offline / prestige / streak / daily math for Tiny Dead.
 *
 * EVERYTHING here is a side-effect-free function of plain numbers/records — no
 * THREE, no DOM, no localStorage — so it imports cleanly under the node:test
 * runner (`--experimental-strip-types`) exactly like config.ts. main.ts owns
 * the wiring (reading/writing the save, crediting currencies, showing HUD); this
 * module owns the FORMULAS so they're testable in isolation.
 *
 * Soft-currency only: every payout is gold + essence. Nothing here mints token.
 */
import { IDLE, PRESTIGE, STREAK, DAILY_QUESTS, type DailyQuestDef } from "./config";
import type { StreakState, DailyState } from "./save";

// ─────────────────────────── OFFLINE ACCRUAL ───────────────────────────

/**
 * Gold earned while away. Bankers keep minting at HALF their active rate
 * (IDLE.offlineRate) while the tab is closed, capped at `capMs` of real time so
 * an abandoned save can't pay out infinitely.
 *
 * @param bankerRatePerSec  summed ACTIVE gold/sec of every owned banker
 * @param elapsedMs         now - save.lastSeen (negative/garbage -> 0)
 * @param capMs             max window that pays out (default IDLE.offlineCapMs)
 * @returns floored gold (>= 0)
 */
export function offlineGold(
  bankerRatePerSec: number,
  elapsedMs: number,
  capMs: number = IDLE.offlineCapMs,
): number {
  if (!Number.isFinite(bankerRatePerSec) || bankerRatePerSec <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const cap = Number.isFinite(capMs) && capMs > 0 ? capMs : IDLE.offlineCapMs;
  const seconds = Math.min(elapsedMs, cap) / 1000;
  return Math.floor(bankerRatePerSec * IDLE.offlineRate * seconds);
}

// ─────────────────────────── PRESTIGE / ASCENSION ───────────────────────────

/**
 * Prestige points NEWLY available to claim. AdVenture-Capitalist √ curve:
 *   total = floor(sqrt(lifetimeGold / X))
 * minus whatever's already banked, so it only ever returns the *gain*.
 *
 * @param lifetimeGold  running total of all gold ever earned
 * @param alreadyOwned  prestige already banked (save.prestige)
 * @param x             tuning divisor (default PRESTIGE.x)
 * @returns gain (>= 0; 0 when not yet enough for the next point)
 */
export function prestigeGain(
  lifetimeGold: number,
  alreadyOwned: number,
  x: number = PRESTIGE.x,
): number {
  if (!Number.isFinite(lifetimeGold) || lifetimeGold <= 0) return 0;
  const div = Number.isFinite(x) && x > 0 ? x : PRESTIGE.x;
  const total = Math.floor(Math.sqrt(lifetimeGold / div));
  const owned = Number.isFinite(alreadyOwned) && alreadyOwned > 0 ? Math.floor(alreadyOwned) : 0;
  return Math.max(0, total - owned);
}

/** Permanent gold/essence multiplier from banked prestige: 1 + prestige * k. */
export function prestigeMultiplier(prestige: number, k: number = PRESTIGE.k): number {
  if (!Number.isFinite(prestige) || prestige <= 0) return 1;
  const kk = Number.isFinite(k) && k >= 0 ? k : PRESTIGE.k;
  return 1 + Math.floor(prestige) * kk;
}

// ─────────────────────────── DAY BUCKETS ───────────────────────────

/** UTC day-index: whole days since the Unix epoch. Same for everyone on a given
 *  calendar day in UTC, regardless of local timezone. */
export function dayUtc(nowMs: number): number {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return 0;
  return Math.floor(nowMs / 86_400_000);
}

// ─────────────────────────── LOGIN STREAK ───────────────────────────

export interface StreakResult {
  /** The streak after settling today's login (to write back to the save). */
  streak: StreakState;
  /** True when this call advanced the streak (i.e. first login of a new UTC day),
   *  meaning main.ts should pay the streak reward + show the chip. */
  advanced: boolean;
  /** True when a banked freeze was spent to forgive a single missed day. */
  usedFreeze: boolean;
  /** Gold / essence to award for today's login (0 unless `advanced`). */
  gold: number;
  essence: number;
}

/** Streak reward for a streak of length `count` (soft gold + essence, capped). */
export function streakReward(count: number): { gold: number; essence: number } {
  const c = Math.max(1, Math.floor(count));
  const gDays = Math.min(c, STREAK.capDays);
  const eDays = Math.min(c, STREAK.capDays);
  return {
    gold: STREAK.baseGold + STREAK.goldPerDay * gDays,
    essence: Math.min(STREAK.essenceCap, STREAK.baseEssence + STREAK.essencePerDay * eDays),
  };
}

/**
 * Settle the login streak for today's UTC day. Pure: takes the stored state +
 * today's day-index, returns the new state and what to pay.
 *
 *  - same day as last advance      -> no-op (already counted today)
 *  - exactly yesterday             -> +1 to streak
 *  - older, but a freeze is banked  -> spend ONE freeze, forgive the gap, +1
 *  - older with no freeze           -> streak resets to 1
 *  - first ever (lastDayUtc === 0)  -> streak starts at 1
 *
 * A fresh freeze is granted every STREAK.freezeGrantEvery advanced days
 * (capped at STREAK.freezeMax), so a regular player banks a safety net.
 */
export function settleStreak(prev: StreakState, today: number): StreakResult {
  const last = Math.floor(prev.lastDayUtc) || 0;
  let count = Math.max(0, Math.floor(prev.count));
  let freezes = Math.max(0, Math.floor(prev.freezes));

  // Already logged in today (or a clock that ran backwards) — nothing to do.
  if (last !== 0 && today <= last) {
    return { streak: { count, lastDayUtc: last, freezes }, advanced: false, usedFreeze: false, gold: 0, essence: 0 };
  }

  const gap = last === 0 ? 1 : today - last; // days since last advance
  let usedFreeze = false;
  if (last === 0 || gap === 1) {
    count += 1; // consecutive (or first ever)
  } else {
    // Missed at least one day. One banked freeze forgives a single-day gap.
    if (gap === 2 && freezes > 0) {
      freezes -= 1;
      usedFreeze = true;
      count += 1;
    } else {
      count = 1; // streak broken — start over
    }
  }

  // Grant a fresh freeze at milestone lengths (cap the bank).
  if (count > 0 && count % STREAK.freezeGrantEvery === 0 && freezes < STREAK.freezeMax) {
    freezes += 1;
  }

  const reward = streakReward(count);
  return {
    streak: { count, lastDayUtc: today, freezes },
    advanced: true,
    usedFreeze,
    gold: reward.gold,
    essence: reward.essence,
  };
}

// ─────────────────────────── DAILY QUESTS ───────────────────────────

/** Roll the daily-quest board over to `today` if it isn't already. Pure: returns
 *  a fresh board (progress cleared, claims cleared) on a new UTC day, else the
 *  state unchanged. */
export function rollDaily(prev: DailyState, today: number): DailyState {
  if (prev.dayUtc === today) return prev;
  return { dayUtc: today, progress: {}, claimed: [] };
}

export interface DailyRow {
  id: string;
  name: string;
  progress: number;
  goal: number;
  gold: number;
  essence: number;
  done: boolean; // goal met
  claimed: boolean; // reward already paid
}

/** Today's quest board: a seeded 3-of-the-pool deal so the board rotates daily
 *  and pulls the player across modes (zombies / TD / eggs). Deterministic per
 *  UTC day, so every call (and every device) agrees on the same board. */
export function questsForDay(today: number, pool: DailyQuestDef[] = DAILY_QUESTS): DailyQuestDef[] {
  if (pool.length <= 3) return pool;
  // tiny LCG seeded by the day bucket — same shuffle for the whole day
  let seed = (today * 2654435761) >>> 0 || 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const deck = [...pool];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, 3);
}

/** Add this run's deltas onto the daily board's progress (pure — returns a new
 *  progress map). `metrics` maps a quest metric -> amount earned this run. */
export type DailyMetrics = Partial<Record<DailyQuestDef["metric"], number>>;
export function applyDailyProgress(
  prev: DailyState,
  metrics: DailyMetrics,
  quests: DailyQuestDef[] = DAILY_QUESTS,
): DailyState {
  const progress: Record<string, number> = { ...prev.progress };
  for (const q of quests) {
    const delta = metrics[q.metric] ?? 0;
    if (delta > 0) progress[q.id] = (progress[q.id] ?? 0) + delta;
  }
  return { ...prev, progress };
}

/**
 * Settle any newly-completed (goal met, not yet claimed) daily quests. Pure:
 * returns the updated state (those ids appended to `claimed`) and the total
 * soft reward to credit.
 */
export function settleDaily(
  prev: DailyState,
  quests: DailyQuestDef[] = DAILY_QUESTS,
): { daily: DailyState; gold: number; essence: number; completed: string[] } {
  const claimed = [...prev.claimed];
  let gold = 0;
  let essence = 0;
  const completed: string[] = [];
  for (const q of quests) {
    if (claimed.includes(q.id)) continue;
    if ((prev.progress[q.id] ?? 0) >= q.goal) {
      claimed.push(q.id);
      completed.push(q.id);
      gold += q.gold;
      essence += q.essence;
    }
  }
  return { daily: { ...prev, claimed }, gold, essence, completed };
}

/** Build display rows for the daily board (for hud.showDailies). */
export function dailyRows(state: DailyState, quests: DailyQuestDef[] = DAILY_QUESTS): DailyRow[] {
  return quests.map((q) => {
    const progress = Math.min(state.progress[q.id] ?? 0, q.goal);
    return {
      id: q.id,
      name: q.name,
      progress,
      goal: q.goal,
      gold: q.gold,
      essence: q.essence,
      done: (state.progress[q.id] ?? 0) >= q.goal,
      claimed: state.claimed.includes(q.id),
    };
  });
}
