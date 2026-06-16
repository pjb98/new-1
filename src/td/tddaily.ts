/**
 * TD DAILY CHALLENGE — one seeded attempt per UTC day, scored by the wave you
 * reach in an endless run under that day's MODIFIER. Pure logic (no THREE /
 * DOM), so the day → modifier mapping is unit-testable and identical for every
 * player: same day, same challenge, comparable scores (the retention anchor —
 * and the fairness substrate any future zombies/TD score-wager rides on).
 */

export interface TdDailyMods {
  id: string;
  name: string; // banner/HUD label
  desc: string; // one-line rule summary
  hpMul: number; // creep HP multiplier
  speedMul: number; // creep speed multiplier
  bountyMul: number; // kill-gold multiplier (reward lever)
  goldStartMul: number; // starting-gold multiplier
}

/** The rotating modifier table — dealt by UTC day, deterministically. */
export const TD_DAILY_MODS: TdDailyMods[] = [
  { id: "swarm", name: "Swarm Day", desc: "Frail creeps, twice the pace — bring splash.", hpMul: 0.7, speedMul: 1.35, bountyMul: 1.0, goldStartMul: 1.0 },
  { id: "juggernaut", name: "Juggernaut Day", desc: "Slow, heavy creeps — bring single-target burst.", hpMul: 1.8, speedMul: 0.75, bountyMul: 1.3, goldStartMul: 1.0 },
  { id: "richrush", name: "Rich Rush", desc: "Double bounties, but creeps run hot.", hpMul: 1.0, speedMul: 1.25, bountyMul: 2.0, goldStartMul: 0.8 },
  { id: "shoestring", name: "Shoestring", desc: "Half the starting gold — earn your defense.", hpMul: 1.0, speedMul: 1.0, bountyMul: 1.2, goldStartMul: 0.5 },
  { id: "ironhide", name: "Ironhide", desc: "Everything is tougher. No tricks, just grit.", hpMul: 1.4, speedMul: 1.0, bountyMul: 1.25, goldStartMul: 1.2 },
];

/** UTC day bucket (matches idle.ts's dayUtc convention). */
export function tdDailyDay(now = Date.now()): number {
  return Math.floor(now / 86_400_000);
}

/** The modifier for a given UTC day — deterministic, same for all players. */
export function tdDailyMods(day: number): TdDailyMods {
  const i = ((day * 2654435761) >>> 0) % TD_DAILY_MODS.length;
  return TD_DAILY_MODS[i];
}

/** One attempt per day: true if `lastAttemptDay` predates `day`. */
export function tdDailyAvailable(lastAttemptDay: number, day: number): boolean {
  return lastAttemptDay < day;
}
