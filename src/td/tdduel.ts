/**
 * Tower-Defense DUEL logic — 1v1 vs an AI opponent. Pure logic (no THREE / no
 * DOM), unit-testable.
 *
 * Both sides face the SAME escalating shared waves on their own lane (yours is
 * rendered + real; the bot's is simulated abstractly here). The core engine,
 * lifted from Hypixel TowerWars / Legion-TD: SENDING creeps at your opponent is
 * the only way to permanently grow your own income — so offense IS your economy.
 * Leaks chip base HP (proportional to creep size); first base to 0 loses.
 *
 * The controller (tdmode in duel mode) calls:
 *   duelInit(D)                  → fresh match state at difficulty D∈[0,1]
 *   duelSend(state, id)          → you spend gold to pressure the bot (+income)
 *   duelPlayerLeak(state, dmg)   → a real creep reached YOUR base
 *   duelEndWave(state, D)        → resolve the bot's lane + economy + bot AI;
 *                                  returns the creeps the bot sends into YOUR lane
 */

import { waveThreat, waveClearBonus, creepHpAt } from "./tdwaves";
import type { TdSpawnSpec } from "./tdenemy";

export const DUEL_MAX_HP = 100;
export const DUEL_REGEN = 3;          // base HP healed between waves
export const DUEL_START_GOLD = 200;
export const DUEL_START_INCOME = 10;  // gold/wave before any sends
export const DUEL_MAX_WAVES = 25;     // sudden-death cap → higher HP wins
/** Fraction of a send's cost permanently added to income (the eco engine). */
const INCOME_RATE = 0.2;
/** Effective-HP of bot clear-capacity bought per gold. */
const DEF_PER_GOLD = 0.85;
/** Max HP a single wave's bot-lane overflow can deal (anti one-shot). */
const MAX_LEAK_DMG = 28;

export interface DuelSend {
  id: string;
  name: string;
  cost: number;
  incomeGain: number; // permanent +income/wave when sent
  gate: number;       // income required to unlock
  count: number;
  hpMul: number;      // creep HP = creepHpAt(wave) * hpMul
  kind?: string;
  armor?: number;
  leakDmg: number;
  desc: string;
}

/** Send catalog — cheap swarms eco best; pricey sends pressure but eco worse. */
export const DUEL_SENDS: DuelSend[] = [
  { id: "runner", name: "Runner Swarm", cost: 25, incomeGain: 5, gate: 0, count: 3, hpMul: 0.6, kind: "fast", leakDmg: 1, desc: "3 fast runners. Cheap eco — best income per gold." },
  { id: "grunt", name: "Grunt Pack", cost: 60, incomeGain: 12, gate: 0, count: 4, hpMul: 1.0, leakDmg: 2, desc: "4 sturdy grunts. Solid pressure + income." },
  { id: "brute", name: "Armored Brute", cost: 120, incomeGain: 15, gate: 30, count: 3, hpMul: 1.4, kind: "armored", armor: 0.5, leakDmg: 3, desc: "3 armored brutes. Needs piercing to stop." },
  { id: "ecopig", name: "Eco Pig", cost: 300, incomeGain: 60, gate: 0, count: 1, hpMul: 0.4, kind: "tank", leakDmg: 0, desc: "Pure income — harmless, huge eco boost." },
  { id: "jugg", name: "Juggernaut", cost: 1200, incomeGain: 150, gate: 120, count: 1, hpMul: 9, kind: "boss", leakDmg: 10, desc: "A lane-breaker. Game-ending pressure." },
];

export function duelSendById(id: string): DuelSend | undefined {
  return DUEL_SENDS.find((s) => s.id === id);
}

export interface DuelState {
  wave: number;
  playerHp: number; botHp: number;
  playerGold: number; playerIncome: number;
  botGold: number; botIncome: number; botDefense: number;
  botPressure: number;      // effective-HP of player sends queued against the bot this wave
  lightSends: number;       // for diminishing returns on spammed cheap sends
  over: boolean; win: boolean; // win = player won
}

export function duelInit(): DuelState {
  return {
    wave: 1,
    playerHp: DUEL_MAX_HP, botHp: DUEL_MAX_HP,
    playerGold: DUEL_START_GOLD, playerIncome: DUEL_START_INCOME,
    botGold: DUEL_START_GOLD, botIncome: DUEL_START_INCOME, botDefense: waveThreat(1) * 0.9,
    botPressure: 0, lightSends: 0, over: false, win: false,
  };
}

/** Send tiers currently UNLOCKED for the player (income-gated). */
export function duelUnlockedSends(state: DuelState): DuelSend[] {
  return DUEL_SENDS.filter((s) => state.playerIncome >= s.gate);
}

/** Effective HP (threat) a send represents at the current wave. */
function sendThreat(s: DuelSend, wave: number): number {
  const hp = creepHpAt(wave) * s.hpMul;
  return s.count * hp * (1 + (s.armor ?? 0));
}

/** Build the real creep specs for a send (bot → your lane). */
export function duelSendCreeps(s: DuelSend, wave: number): TdSpawnSpec[] {
  const hp = Math.round(creepHpAt(wave) * s.hpMul);
  const speed = 2.3 + wave * 0.04;
  const out: TdSpawnSpec[] = [];
  for (let i = 0; i < s.count; i++) {
    out.push({ hp, speed: speed * (s.kind === "fast" ? 1.5 : s.kind === "boss" ? 0.6 : 1), bounty: Math.max(2, Math.round(hp * 0.06)), kind: s.kind, armor: s.armor, leakDmg: s.leakDmg });
  }
  return out;
}

/**
 * You spend gold to send `id` at the bot. Deducts cost, permanently raises your
 * income (with diminishing returns on spammed cheap "runner" sends), and adds
 * the send's threat to the bot's lane for this wave's resolution. Returns true
 * if the send went through.
 */
export function duelSend(state: DuelState, id: string): boolean {
  if (state.over) return false;
  const s = duelSendById(id);
  if (!s || state.playerIncome < s.gate || state.playerGold < s.cost) return false;
  state.playerGold -= s.cost;
  // diminishing income on spammed runners (anti-degenerate)
  let gain = s.incomeGain;
  if (s.id === "runner") {
    state.lightSends++;
    if (state.lightSends > 5) gain = Math.round(gain * 0.5);
  }
  state.playerIncome += gain;
  state.botPressure += sendThreat(s, state.wave);
  return true;
}

/** A real creep reached YOUR base — chip HP (proportional). */
export function duelPlayerLeak(state: DuelState, dmg: number): void {
  if (state.over) return;
  state.playerHp = Math.max(0, state.playerHp - dmg);
  if (state.playerHp <= 0) { state.over = true; state.win = false; }
}

/** Convert bot-lane overflow (effective-HP past its defense) to base-HP damage. */
function overflowToHp(threat: number, defense: number): number {
  const overflow = Math.max(0, threat - defense);
  if (overflow <= 0 || threat <= 0) return 0;
  return Math.min(MAX_LEAK_DMG, Math.round((overflow / threat) * 40));
}

/**
 * Resolve the wave that just finished: damage the bot from its lane overflow,
 * pay both economies, regen both bases, then run the bot's AI (difficulty `D`)
 * which buys defense and sends creeps back at you. Advances the wave and checks
 * the win/lose / sudden-death condition. Returns the creep specs the BOT sends
 * into your (real) lane for the upcoming wave.
 */
export function duelEndWave(state: DuelState, D: number): TdSpawnSpec[] {
  if (state.over) return [];
  const w = state.wave;

  // 1) bot lane resolution (shared wave threat + your sends vs its defense)
  const threatVsBot = waveThreat(w) + state.botPressure;
  state.botHp = Math.max(0, state.botHp - overflowToHp(threatVsBot, state.botDefense));
  state.botPressure = 0;

  // 2) economies pay out (income + wave-clear bonus)
  const bonus = waveClearBonus(w);
  state.playerGold += state.playerIncome + bonus;
  state.botGold += state.botIncome + bonus;

  // 3) regen both bases (only if still alive)
  if (state.playerHp > 0) state.playerHp = Math.min(DUEL_MAX_HP, state.playerHp + DUEL_REGEN);
  if (state.botHp > 0) state.botHp = Math.min(DUEL_MAX_HP, state.botHp + DUEL_REGEN);

  // 4) bot AI — defense first to a difficulty-scaled clear target, then eco/send
  const botSends = runBotAI(state, D);

  // 5) advance + win check
  state.wave = w + 1;
  if (state.botHp <= 0) { state.over = true; state.win = true; }
  else if (state.playerHp <= 0) { state.over = true; state.win = false; }
  else if (state.wave > DUEL_MAX_WAVES) { state.over = true; state.win = state.playerHp >= state.botHp; }
  return botSends;
}

/** The bot's per-wave spending policy. Mutates bot fields; returns its sends. */
function runBotAI(state: DuelState, D: number): TdSpawnSpec[] {
  const d = Math.max(0, Math.min(1, D));
  const nextWave = state.wave + 1;
  // defend the next shared wave to a clear target (easy bots under-defend → leak)
  const defenseTarget = waveThreat(nextWave) * (0.8 + 0.35 * d);
  if (state.botDefense < defenseTarget) {
    const need = (defenseTarget - state.botDefense) / DEF_PER_GOLD;
    const spend = Math.min(need, state.botGold * (0.85 - 0.25 * d)); // harder bots reserve more for offense
    state.botGold -= spend;
    state.botDefense += spend * DEF_PER_GOLD;
  }
  // spend the rest on a send at YOU (grows bot income + pressures your lane)
  const sends: TdSpawnSpec[] = [];
  const sendEvery = d > 0.7 ? 1 : d > 0.4 ? 2 : 3; // how often it bothers to attack
  if (state.wave % sendEvery === 0) {
    // pick the priciest affordable, unlocked send the bot will commit to
    const affordable = DUEL_SENDS.filter((s) => state.botIncome >= s.gate && state.botGold >= s.cost && (d > 0.6 || s.id !== "jugg"));
    if (affordable.length) {
      // easy bots favor cheap eco sends; hard bots reach for pressure
      const pick = d > 0.6 ? affordable[affordable.length - 1] : affordable[0];
      state.botGold -= pick.cost;
      state.botIncome += Math.round(pick.cost * INCOME_RATE * (0.8 + 0.4 * d));
      sends.push(...duelSendCreeps(pick, nextWave));
    }
  }
  return sends;
}
