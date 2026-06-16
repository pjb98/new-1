import { LifetimeStats } from "./save";

/**
 * One-time challenges (Kintara's quests, reframed for an arcade run). Each pays
 * Essence once when completed, giving goals beyond "don't die" and feeding the
 * meta economy. Some track lifetime totals; some are single-run feats.
 */
export interface RunStats {
  kills: number;
  crits: number;
  bossKills: number;
  drops: number;
  round: number;
  tookDamage: boolean;
}

export interface Challenge {
  id: string;
  name: string;
  desc: string;
  reward: number; // Essence
  /** Current progress toward `goal`, for the menu bar. */
  progress: (life: LifetimeStats, run: RunStats) => number;
  goal: number;
}

export const CHALLENGES: Challenge[] = [
  { id: "blood", name: "First Blood", desc: "Kill 100 zombies (lifetime)", reward: 40, goal: 100, progress: (l) => l.kills },
  { id: "centurion", name: "Centurion", desc: "Kill 1,000 zombies (lifetime)", reward: 200, goal: 1000, progress: (l) => l.kills },
  { id: "sharp", name: "Sharpshooter", desc: "Land 250 crits (lifetime)", reward: 150, goal: 250, progress: (l) => l.crits },
  { id: "slayer", name: "Boss Slayer", desc: "Kill 5 bosses (lifetime)", reward: 200, goal: 5, progress: (l) => l.bossKills },
  { id: "goblin", name: "Loot Goblin", desc: "Collect 50 drops (lifetime)", reward: 120, goal: 50, progress: (l) => l.drops },
  { id: "veteran", name: "Veteran", desc: "Play 25 runs", reward: 100, goal: 25, progress: (l) => l.games },
  { id: "diver", name: "Deep Diver", desc: "Reach round 10 in one run", reward: 150, goal: 10, progress: (_l, r) => r.round },
  { id: "survivor", name: "Survivor", desc: "Reach round 15 in one run", reward: 300, goal: 15, progress: (_l, r) => r.round },
  { id: "flawless", name: "Flawless", desc: "Kill a boss without taking a hit", reward: 250, goal: 1, progress: (_l, r) => (r.bossKills > 0 && !r.tookDamage ? 1 : 0) },
];

export function blankRunStats(): RunStats {
  return { kills: 0, crits: 0, bossKills: 0, drops: 0, round: 0, tookDamage: false };
}
