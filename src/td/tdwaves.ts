/**
 * Tower-Defense WAVES + economy. Pure logic (no THREE / no DOM), unit-testable.
 *
 * Research-driven pacing (Bloons): a gentle on-ramp, then ONE new creep
 * archetype introduced every few waves on a telegraphed wave, spiky elite/boss
 * rounds every 5th wave, and a hardened boss finale. Each archetype demands a
 * different tower answer:
 *   runner  → fast single-target (arrow)
 *   swarm   → AoE/splash (cannon)
 *   armored → piercing damage (cannon/sniper) — armor shrugs off normal hits
 *   camo    → a detector pylon to reveal it
 *   regrow  → burst it down before it heals (sniper/cannon)
 *   boss    → single-target boss damage + a slow (sniper + frost)
 */

import type { TdSpawnSpec } from "./tdenemy";

/** Starting resources for a run. */
export const TD_START_GOLD = 220;
export const TD_START_LIVES = 20;
/** Waves to survive to win (Solo). */
export const TD_TOTAL_WAVES = 18;

/** End-of-wave clear bonus (flat + scaling), per the BTD6 round-bonus model. */
export function waveClearBonus(wave: number): number {
  return 18 + 6 * Math.max(1, Math.floor(wave));
}

/** Seconds between individual creep spawns within a wave (faster later). */
export function spawnInterval(wave: number): number {
  return Math.max(0.32, 0.9 - wave * 0.03);
}

/** HP of a "standard" creep at wave n (geometric ramp ~+14%/wave). */
function baseHp(wave: number): number {
  return Math.round(24 * Math.pow(1.14, wave - 1));
}

/** Public accessor for the standard creep HP at a wave (used by the Duel sends). */
export function creepHpAt(wave: number): number {
  return baseHp(Math.max(1, Math.floor(wave)));
}

/**
 * The creeps for wave `n` (1-based). Builds an archetype mix per the pacing
 * schedule and attaches the traits (armor/camo/regen) that gate the counter:
 *   fast    → runner (arrow/tesla)        armored → piercing (cannon/sniper/venom)
 *   tank    → high-HP wall (venom/sniper)  camo    → detector pylon
 *   regrow  → burst or poison it down      boss    → single-target + slow
 */
export function buildWave(n: number): TdSpawnSpec[] {
  const wave = Math.max(1, Math.floor(n));
  const hp = baseHp(wave);
  const speed = 2.3 + wave * 0.04;
  const out: TdSpawnSpec[] = [];
  const bounty = (h: number) => Math.max(2, Math.round(h * 0.08));

  const isBoss = wave % 5 === 0;

  // ---- boss / elite waves (every 5th) ----
  if (isBoss) {
    const mega = wave >= 15;
    const bhp = Math.round(hp * (mega ? 16 : 10));
    out.push({ hp: bhp, speed: speed * 0.6, bounty: Math.round(bhp * 0.05), kind: "boss",
      armor: mega ? 0.3 : 0, regen: wave >= 10 ? hp * 0.5 : 0, leakDmg: 12 });
    // a co-boss tank from wave 10 so the finale isn't a single check
    if (wave >= 10) {
      out.push({ hp: Math.round(hp * 5), speed: speed * 0.7, bounty: Math.round(hp * 5 * 0.05),
        kind: "tank", armor: 0.4, leakDmg: 6 });
    }
    // escort pack — fast runners up front, armored bruisers from wave 10
    const escorts = 5 + Math.floor(wave / 5) * 2;
    for (let i = 0; i < escorts; i++) {
      out.push({ hp: Math.round(hp * 0.8), speed: speed * 1.35, bounty: bounty(hp * 0.8), kind: "fast", leakDmg: 1 });
    }
    if (wave >= 10) {
      const bruisers = 2 + Math.floor((wave - 10) / 5);
      for (let i = 0; i < bruisers; i++) {
        out.push({ hp: Math.round(hp * 1.5), speed: speed * 0.85, bounty: bounty(hp * 1.5), kind: "armored", armor: 0.6, leakDmg: 2 });
      }
    }
    return out;
  }

  // ---- normal waves: a base pack + the archetype(s) unlocked by this wave ----
  const count = 6 + wave * 2;
  // every 3rd non-boss wave from 4+ is a SWARM SURGE: more, faster, frailer
  const surge = wave >= 4 && wave % 3 === 1;
  for (let i = 0; i < count + (surge ? 6 : 0); i++) {
    // swarm filler from wave 3+: a quarter are fast runners (more during a surge)
    const fast = wave >= 3 && (surge ? i % 2 === 1 : i % 4 === 3);
    out.push({
      hp: Math.round(hp * (fast ? 0.6 : 1)),
      speed: speed * (fast ? (surge ? 1.65 : 1.5) : 1),
      bounty: bounty(hp * (fast ? 0.6 : 1)),
      kind: fast ? "fast" : undefined,
    });
  }

  // ARMORED debuts ~wave 6: needs piercing (cannon/sniper/venom)
  if (wave >= 6) {
    const n2 = 2 + Math.floor((wave - 6) / 2);
    for (let i = 0; i < n2; i++) {
      out.push({ hp: Math.round(hp * 1.4), speed: speed * 0.85, bounty: bounty(hp * 1.4), kind: "armored", armor: 0.6, leakDmg: 2 });
    }
  }
  // CAMO debuts ~wave 8: needs a detector pylon
  if (wave >= 8) {
    const n2 = 2 + Math.floor((wave - 8) / 3);
    for (let i = 0; i < n2; i++) {
      out.push({ hp: Math.round(hp * 0.7), speed: speed * 1.15, bounty: bounty(hp * 0.7), kind: "camo", camo: true, leakDmg: 1 });
    }
  }
  // TANK debuts ~wave 9: a slow high-HP wall — poison & big single hits answer it
  if (wave >= 9) {
    const n2 = 1 + Math.floor((wave - 9) / 4);
    for (let i = 0; i < n2; i++) {
      out.push({ hp: Math.round(hp * 3.2), speed: speed * 0.7, bounty: bounty(hp * 3.2), kind: "tank", armor: 0.25, leakDmg: 4 });
    }
  }
  // REGROW debuts ~wave 11: self-heals, must be burst or poisoned down
  if (wave >= 11) {
    const n2 = 2 + Math.floor((wave - 11) / 3);
    for (let i = 0; i < n2; i++) {
      out.push({ hp: Math.round(hp * 1.1), speed: speed * 0.95, bounty: bounty(hp * 1.1), kind: "regrow", regen: hp * 0.25, leakDmg: 2 });
    }
  }
  return out;
}

/** Total creeps in wave n (for HUD progress). */
export function waveSize(n: number): number {
  return buildWave(n).length;
}

/** Aggregate "threat" of a wave = total effective HP — used by the Duel mode to
 *  size how much defense the AI opponent needs to clear it without leaking. */
export function waveThreat(n: number): number {
  let t = 0;
  for (const s of buildWave(n)) t += s.hp * (1 + (s.armor ?? 0)); // armor inflates effective HP
  return Math.round(t);
}
