// Central tuning knobs for gameplay + look. Tweak here, not in the systems.

export const WORLD = {
  /** Half-extent of the playable island (in voxels / world units from center). */
  half: 20,
  // Distant haze the color of the sky horizon, so far clouds fade softly.
  fogColor: 0xd9eeff,
  fogNear: 70,
  fogFar: 150,
};

export const CAMERA = {
  fov: 32, // long lens => flat, miniature/diorama feel
  // Offset from the player: high + behind, ~38° elevation for a 3/4 iso look.
  offset: { x: 0, y: 24, z: 30 },
  follow: 6, // higher = snappier follow
};

export const PLAYER = {
  radius: 0.55,
  speed: 8,
  maxHealth: 100,
  regenDelay: 4, // seconds after last hit before regen begins
  regenRate: 14, // hp per second (lowered from 24 — full-regen kiting was too safe)
  touchInvuln: 0.0,
};

export const ZOMBIE = {
  radius: 0.6,
  // HP is ADDITIVE through the inflection round, then COMPOUNDS multiplicatively
  // (CoD's exact trick: a 10%/round wall at R10 that's smooth at the seam but
  // never gets lapped by player DPS). See rounds.ts beginRound().
  baseHealth: 80, // was 70 — even R1 basics should take a real burst, not pop instantly
  healthPerRound: 32, // was 26 — much steeper flat ramp so R1-9 escalates HARD "the whole way"
  hpInflection: 9, // round after which HP goes multiplicative
  hpGrowth: 1.17, // per-round HP multiplier past the inflection (was 1.16 — pets+PaP DPS
  //                still outran 1.16; a hair steeper so mid/late zombies stay bullet-walls)
  baseSpeed: 2.6, // was 2.5 — a touch faster off the line so kiting is never free
  speedPerRound: 0.14, // was 0.12 — kiting gets riskier faster through 10→20
  speedCap: 6.9, // was 6.5 — late-game horde can genuinely run a kiter down
  touchDamage: 20, // was 16 — getting caught really hurts now (≈33 dps in contact)
  touchInterval: 0.6, // seconds between hits while in contact
  separation: 2.0, // how hard they push apart so they don't stack
};

export const ROUNDS = {
  baseCount: 6, // zombies in round 1
  countPerRound: 4, // extra zombies per round
  // Per-round zombie COUNT is CAPPED so high rounds stay short (the key to
  // reaching R100-200 in an hour or two). Past the cap, difficulty comes from
  // HP + elites + speed, NOT from infinite bodies — otherwise R200 would spawn
  // 800 zombies and take minutes. count = min(countCap, base + (n-1)*perRound).
  //
  // KEY: countCap is set ABOVE the alive ceiling on purpose. That's what makes
  // late game a real WALL of zombies — as you mow the front rank down, the spawn
  // queue refills the screen back to curMaxAlive instantly, so the horde never
  // thins until the round's whole budget is spent. (A countCap *below* the alive
  // cap would starve it — the screen could never fill.)
  // countCap was 200 (reached ~R50). The HORDE REGIME (R20+) needs a FATTER
  // budget so a horde round LASTS — the firehose has to keep refilling a far
  // bigger screen until the budget drains. Raised to 360: at the horde alive cap
  // (~230 desktop) a 360-body budget is ~1.5 screen-refills of mowing, which is
  // the "wade through a sea" feel without dragging a round past ~a minute.
  countCap: 360, // max zombies a round will spawn — fat enough to sustain the R20+ wall
  intermission: 2.2, // breather between rounds (seconds) — was 4, snappier pacing
  // The three ceilings are ROUND-SCALED: a rising alive-cap + faster spawns keep
  // the screen FULL even as pets clear. Aggressive so late game stays a wall.
  maxAliveBase: 40, // on-screen cap through the inflection round (was 32 — busier mid-game)
  maxAlivePerRound: 9, // +per round past inflection (was 6 — reach the ceiling by ~R22, not R30)
  // Desktop ceiling RAISED 170 → 230 for the horde regime: ~2× today's effective
  // mid-20s density. 230 individual voxel rigs is the frame-safe headroom we set
  // (the adaptive-resolution governor in main.ts absorbs the rest). Mobile uses a
  // distinctly lower ceiling set in main.ts (96) so phones never approach this.
  maxAliveCap: 230, // desktop ceiling — a genuinely packed WALL (mobile ceiling is lower, main.ts)
  spawnIntervalBase: 0.7, // seconds between spawns through inflection (was 0.9 — faster early too)
  spawnIntervalMin: 0.11, // floor of the spawn-interval ramp — a firehose that keeps the wall topped up
  spawnIntervalDecay: 0.08, // -per round past inflection (reach the floor by ~R16)
  swarmEvery: 7, // every Nth round is a fast "swarm/dog" round

  // ── HORDE REGIME (round 20+) ──────────────────────────────────────────────
  // From R20 the game escalates into true horde mode: a much higher alive cap +
  // a fatter budget so the wall NEVER thins. We do NOT step-function it — R20 is
  // the ANNOUNCED start of a steep climb that finishes at hordeRampRounds later.
  // beginRound() lerps a per-round multiplier from 1.0 (at R<20) up to the full
  // horde multipliers across [hordeFromRound, hordeFromRound+hordeRampRounds].
  hordeFromRound: 20, // round the horde regime begins (the "THE HORDE RISES" beat)
  hordeRampRounds: 10, // R20→R30 climb to full horde density (no one-round spike)
  // Alive-cap multiplier at FULL horde (applied on top of the normal ramp before
  // the ceiling clamp). 1.6× drives the cap hard into the raised 230 ceiling by
  // ~R24 and pins it there — the screen stays a wall through the climb's top.
  hordeAliveMul: 1.6, // ×curMaxAlive at full ramp (clamped by the ceiling)
  // Budget multiplier at FULL horde: the round's spawn BUDGET is what makes a
  // horde round LAST. 1.8× a count that's already near countCap keeps the
  // refill-the-wall loop going long enough to feel like a tide, then clamps.
  hordeBudgetMul: 1.8, // ×round count budget at full ramp (clamped by countCap)
  // Past R20 individual zombie HP growth gets a TINY DISCOUNT so a sea of bodies
  // still "mows" rather than gridlocks — but only a hair. 0.92 (the original)
  // compounded into ~5× weaker zombies by R40 and let a leveled pet squad insta-
  // kill everything; that overshot badly. 0.98 keeps the seam continuous and
  // shaves only the very top of the curve: 1.17*0.98 ≈ 1.147/round past R20, so
  // late zombies stay genuine bullet-walls that demand sustained focused fire even
  // from a maxed loadout+pets. (Density/firehose are untouched — the horde BITES.)
  hordeHpGrowthDiscount: 0.98, // multiplier on per-round HP growth for rounds past R20 (was 0.92 then 0.985 — both too generous)
};

/** The Loot Goblin: a rare fleeing bounty mob that drops a jackpot if you catch
 *  it before it escapes. A mid-round objective that breaks the kill-wave rhythm. */
export const GOBLIN = {
  fromRound: 4, // earliest round one can appear
  chance: 0.25, // per-round chance one shows up (skipped on boss rounds)
  lifespan: 16, // seconds it stays on the field before escaping (no reward)
  chestLuck: 0.6, // bonus drop-luck folded into its jackpot chest
};

export const PETS_TUNING = {
  /** Max ACTIVE combat pets spawned at once (owning more is fine — see spawnPets).
   *  Bankers/buffers are non-combat and don't count toward this. */
  activeSquadCap: 5,
  /** Hard clamp on the total Power-Totem buffer multiplier applied to pet damage.
   *  Was 2.5 — but the totem buff MULTIPLIES on top of the pet's level mul, stage
   *  mul AND the player's own Damage tree (applied again in resolveBulletHits), so
   *  2.5× was a big slice of the pet-snowball. 1.8 keeps totems a worthwhile pick
   *  without letting a stacked-totem squad delete the late-game horde. */
  buffCap: 1.8,
  /** Per-kill gold drip so COMBAT is the primary gold faucet (scaled by scoreMul). */
  killGoldBase: 2,
  /** Banker gold/sec is flattened: roleValue * (1 + level*this) instead of *level. */
  bankerLevelScale: 0.08,
  /** Cap on gold a banker squad can mint per round (idle income, not a firehose). */
  bankerGoldPerRoundCap: 1500,
  /** Combat XP each ACTIVE squad pet earns per squad kill. Pets level by fighting
   *  (see petXpForLevel); gold-leveling is an optional fast-track on top. */
  xpPerKill: 1,
};

export const SCORE = {
  hit: 10,
  kill: 40,
  roundBonusBase: 80,
  roundBonusPerRound: 20,
  startingPoints: 500,
};

/** RAMPAGE: a points+gold multiplier that ONLY builds from the player's OWN gun
 *  kills (not pets) and decays if you stop. Makes shooting matter when pets are
 *  auto-clearing — stack kills fast to ride a fat multiplier. */
export const RAMPAGE = {
  max: 100, // kill-stack cap (→ maxMul)
  maxMul: 5, // multiplier at `max` stacks
  window: 2.5, // seconds since your last gun-kill before it starts draining
  decayPerSec: 18, // stacks lost per second once the window lapses
  /** Named tiers shown as the meter climbs (by multiplier). */
  tiers: [
    { at: 1.5, name: "Rampage" },
    { at: 2.2, name: "Carnage" },
    { at: 3.0, name: "Slaughter" },
    { at: 4.0, name: "ANNIHILATION" },
  ],
};

export const COSTS = {
  wallBuy: 1000,
  mysteryBox: 950,
  perkTough: 2500,
  perkQuick: 2000,
  packAPunch: 2500,
  gobblegum: 1500,
  debris: 750,
  trap: 1000, // arm a map trap (electric/fire hazard zone) for a few seconds
};

/** Lurable map traps: pay to electrify/ignite a zone for a few seconds, then it
 *  recharges. A skill-expression tool — herd the horde onto the pad and zap it. */
export const TRAP = {
  radius: 4.2, // hazard zone radius
  duration: 5, // seconds the trap stays lethal once armed
  cooldown: 11, // seconds before it can be re-armed
  dpsBase: 160, // base damage/sec to zombies in the zone
  dpsPerRound: 70, // +damage/sec per round so it scales into the late game
};

/** A zombie variant. Multipliers stack on the round's base health/speed. */
export interface ZombieType {
  id: string;
  name: string;
  /** Earliest round this type can appear. */
  from: number;
  /** Spawn chance once eligible (the basic Shambler fills whatever's left). */
  weight: number;
  healthMul: number;
  speedMul: number;
  scale: number;
  touchDamage: number;
  scoreMul: number;
  body: number;
  head: number;
  /** If set, detonates on death dealing AoE to a nearby player. */
  blastRadius?: number;
  blastDamage?: number;
  // ---- flying mobs (the aerial threat layer) ----
  /** Flies at `flyHeight` above the ground; ignores separation from grounded mobs. */
  flying?: boolean;
  flyHeight?: number;
  /** "dive": swoops to the ground to attack then pulls up. "ranged": hovers at a
   *  standoff distance and lobs a projectile. (default = drifts in like a melee flier) */
  airMode?: "dive" | "ranged" | "swarm";
  /** On death, spawn this many copies of `splitInto` (a type id) at reduced HP. */
  splitInto?: string;
  splitCount?: number;
  /** Summoner: every `summonInterval`s, raise `summonCount` shamblers nearby. */
  summonInterval?: number;
  summonCount?: number;
}

/**
 * The 10-strong undead roster, weakest → strongest. Each tier unlocks at a
 * later round and the round's flat health ramp stacks on top, so the horde gets
 * both more numerous AND individually beefier the deeper you go.
 */
export const ZOMBIE_TYPES: ZombieType[] = [
  { id: "shambler", name: "Shambler", from: 1, weight: 0.0, healthMul: 1.0, speedMul: 1.0, scale: 1.0, touchDamage: 10, scoreMul: 1.0, body: 0x8fcf6f, head: 0x5f9d4a },
  { id: "walker", name: "Walker", from: 2, weight: 0.26, healthMul: 1.35, speedMul: 0.95, scale: 1.05, touchDamage: 12, scoreMul: 1.1, body: 0x73b85a, head: 0x4c8038 },
  { id: "runner", name: "Runner", from: 3, weight: 0.22, healthMul: 0.7, speedMul: 1.9, scale: 0.82, touchDamage: 9, scoreMul: 1.2, body: 0xe8923a, head: 0xc9701f },
  { id: "crawler", name: "Crawler", from: 4, weight: 0.16, healthMul: 0.5, speedMul: 1.5, scale: 0.6, touchDamage: 8, scoreMul: 1.2, body: 0xbcae3c, head: 0x8f8424 },
  { id: "brute", name: "Brute", from: 4, weight: 0.24, healthMul: 4.5, speedMul: 0.74, scale: 1.55, touchDamage: 34, scoreMul: 3.0, body: 0xc0452f, head: 0x8f2f1f }, // weight 0.20→0.24, hp 4.0→4.5, touch 30→34: a tanky threat earlier, oftener, scarier
  { id: "bomber", name: "Bomber", from: 6, weight: 0.14, healthMul: 0.9, speedMul: 1.15, scale: 0.95, touchDamage: 12, scoreMul: 2.0, body: 0x9b6ad6, head: 0x6e4a9e, blastRadius: 3.6, blastDamage: 34 },
  { id: "spitter", name: "Spitter", from: 7, weight: 0.13, healthMul: 1.2, speedMul: 1.1, scale: 1.0, touchDamage: 14, scoreMul: 1.6, body: 0x3fbf9a, head: 0x278f72 },
  { id: "armored", name: "Armored", from: 6, weight: 0.2, healthMul: 7.0, speedMul: 0.62, scale: 1.35, touchDamage: 30, scoreMul: 3.5, body: 0x6c7a8a, head: 0x44505c }, // from 7→6, weight 0.16→0.20, hp 6.5→7.0: heavy walls join the wall sooner + thicker
  { id: "banshee", name: "Banshee", from: 9, weight: 0.13, healthMul: 0.85, speedMul: 2.4, scale: 0.9, touchDamage: 16, scoreMul: 2.2, body: 0xe85aa6, head: 0xb53a7e },
  { id: "abomination", name: "Abomination", from: 9, weight: 0.16, healthMul: 14.0, speedMul: 0.62, scale: 2.0, touchDamage: 48, scoreMul: 6.0, body: 0x7a1f1f, head: 0x4a0f0f, blastRadius: 4.2, blastDamage: 62 }, // from 10→9, hp 13→14, touch 42→48, blast 55→62: the megatank arrives a round sooner and hits harder
  // ---- flying mobs (aerial threat layer; forces dodging + priority targeting) ----
  { id: "vulture", name: "Vulture", from: 6, weight: 0.13, healthMul: 0.8, speedMul: 1.6, scale: 0.9, touchDamage: 20, scoreMul: 2.2, body: 0x6a5a7a, head: 0x9a7aa0, flying: true, flyHeight: 3.2, airMode: "dive" },
  { id: "gnat", name: "Gnat Swarm", from: 5, weight: 0.16, healthMul: 0.35, speedMul: 1.5, scale: 0.5, touchDamage: 7, scoreMul: 1.4, body: 0x9fb04a, head: 0x7a8a30, flying: true, flyHeight: 2.4, airMode: "swarm" },
  { id: "stinger", name: "Stinger", from: 9, weight: 0.12, healthMul: 0.9, speedMul: 1.0, scale: 0.85, touchDamage: 12, scoreMul: 2.4, body: 0xd6a23a, head: 0xb5841f, flying: true, flyHeight: 3.0, airMode: "ranged" },
  // ---- anti-camp grounded specials ----
  { id: "splitter", name: "Splitter", from: 9, weight: 0.12, healthMul: 2.2, speedMul: 0.9, scale: 1.2, touchDamage: 16, scoreMul: 2.4, body: 0x4ec98f, head: 0x2f8a60, splitInto: "splitling", splitCount: 2 },
  { id: "splitling", name: "Splitling", from: 999, weight: 0, healthMul: 0.6, speedMul: 1.4, scale: 0.7, touchDamage: 9, scoreMul: 0.8, body: 0x4ec98f, head: 0x2f8a60 },
  { id: "necro", name: "Necromancer", from: 12, weight: 0.1, healthMul: 2.6, speedMul: 0.7, scale: 1.15, touchDamage: 14, scoreMul: 3.5, body: 0x6e4a9e, head: 0x3a2456, summonInterval: 5, summonCount: 3 },
  // ---- bounty mob: the Loot Goblin. Never spawns via the normal weighted pick
  // (from:999, weight:0) — rounds.ts spawns it explicitly as a fleeing target
  // that drops a jackpot chest when caught. Golden, fast, lean HP. ----
  { id: "goblin", name: "Loot Goblin", from: 999, weight: 0, healthMul: 1.4, speedMul: 1.7, scale: 0.95, touchDamage: 6, scoreMul: 5.0, body: 0xffd24a, head: 0xffb13a },
];

/** Gobblegum-style power-ups from the bubblegum machine. `duration` 0 = instant. */
export interface GumDef {
  id: string;
  name: string;
  short: string;
  duration: number;
  color: number;
}

export const GUMS: GumDef[] = [
  { id: "doublePoints", name: "Double Points", short: "2X", duration: 30, color: 0xffd24a },
  { id: "instakill", name: "Insta-Kill", short: "INSTA", duration: 25, color: 0xff5d8f },
  { id: "rapidFire", name: "Rapid Fire", short: "RAPID", duration: 20, color: 0x6ad7ff },
  { id: "sugarRush", name: "Sugar Rush", short: "SPEED", duration: 25, color: 0x8fcf6f },
  { id: "fullPockets", name: "Full Pockets", short: "AMMO", duration: 0, color: 0xc792ea },
];

// ── IDLE & PRESTIGE TUNING ──
// Soft-currency idle/ascension economy. ALL rewards are gold/essence (soft);
// nothing here ever mints token — active shooting stays the primary faucet.
// The pure math lives in src/idle.ts; these are the only knobs to tweak.
export const IDLE = {
  /** Offline accrues at HALF the active banker rate, so logging in and SHOOTING
   *  always beats idling. (Spec-locked at 0.5 — don't raise without re-tuning.) */
  offlineRate: 0.5,
  /** Max offline window that pays out, in ms. 8h: a generous overnight catch-up
   *  that still can't replace a few active runs. */
  offlineCapMs: 8 * 60 * 60 * 1000,
  /** Don't bother showing the "While You Were Away" screen for trivial amounts
   *  (a quick tab-out). Below this many gold we credit silently. */
  welcomeBackMinGold: 25,
};

export const PRESTIGE = {
  /** AdVenture-Capitalist √ shape: prestige = floor(sqrt(lifetimeGold / X)).
   *  X = 50_000 ⇒ the FIRST ascension lands once lifetime gold crosses ~50k,
   *  which with bankers + kill-gold is roughly a 2–3h investment. The √ means
   *  each additional prestige point costs quadratically more lifetime gold
   *  (50k, 200k, 450k, 800k …), so early ascensions feel fast and it self-paces. */
  x: 50_000,
  /** Permanent gold/essence multiplier = 1 + prestige * k. k = 0.10 ⇒ +10% per
   *  ascension point — meaningful but never runaway (no compounding). */
  k: 0.1,
};

export const STREAK = {
  /** Soft daily-login reward, scaled by streak length (capped). Gold + a pinch
   *  of essence so a streak is worth keeping but never cashable. */
  baseGold: 100,
  goldPerDay: 50, // + this * min(count, capDays)
  capDays: 14, // streak reward stops growing past two weeks
  baseEssence: 2,
  essencePerDay: 1,
  essenceCap: 20,
  /** A "freeze" forgives ONE missed UTC day so a single skip won't reset the
   *  streak. Grant 1 every `freezeGrantEvery` days; never bank more than max. */
  freezeGrantEvery: 5,
  freezeMax: 2,
};

/** A finishable daily quest. `metric` keys into the run/lifetime delta settled
 *  at run-end (see main.ts settleDaily). All rewards are soft gold/essence.
 *  Metrics span every mode so the board pulls players across the whole game:
 *  runs/kills/gold = zombies, waves/duels = Tower Defense, hatches = eggs. */
export interface DailyQuestDef {
  id: string;
  name: string;
  metric: "runs" | "kills" | "gold" | "waves" | "hatches" | "duels";
  goal: number;
  gold: number;
  essence: number;
}

/** The full quest pool — `questsForDay` (idle.ts) deals 3 of these per UTC day
 *  so the board rotates and touches different modes through the week. */
export const DAILY_QUESTS: DailyQuestDef[] = [
  { id: "play", name: "Do 1 zombies run", metric: "runs", goal: 1, gold: 150, essence: 3 },
  { id: "cull", name: "Kill 200 zombies", metric: "kills", goal: 200, gold: 250, essence: 5 },
  { id: "earn", name: "Earn 500 gold", metric: "gold", goal: 500, gold: 200, essence: 4 },
  { id: "waves", name: "Clear 12 TD waves", metric: "waves", goal: 12, gold: 250, essence: 5 },
  { id: "defend", name: "Clear 25 TD waves", metric: "waves", goal: 25, gold: 450, essence: 8 },
  { id: "duelist", name: "Win a 1v1 TD Duel", metric: "duels", goal: 1, gold: 350, essence: 6 },
  { id: "hatch", name: "Hatch 2 eggs", metric: "hatches", goal: 2, gold: 200, essence: 4 },
];

// ── SPECIAL ROUNDS & DIFFICULTY ──
// Knobs for the special-round system (rounds.ts), the elite-affix layer
// (zombie.ts), the difficulty director, and the opt-in Curse multiplier. Added
// as a self-contained block so the integrator can tune without touching the
// combat/economy exports above.

/** Cadence + theming for special rounds. Hound every Nth; showcases every Mth,
 *  offset so they never collide with a hound or boss round. */
export const SPECIAL_ROUNDS = {
  houndEvery: 5, // every Nth round is a Hound Round (fastest type only)
  showcaseEvery: 4, // every Mth round is a rotating themed showcase
  showcaseOffset: 2, // phase offset so showcases dodge hound/boss rounds
  mutationEvery: 6, // every Nth round is a MUTATION round (global horde rule)
  /** Hound Round tint (CSS color) for the screen/fog wash. */
  houndTint: "#b53a2a",
  /** Rotating showcase themes, picked round-robin by showcase index. */
  showcases: [
    { id: "skyTerror", name: "SKY TERROR", tint: "#5a3a8a", roles: ["flying"] },
    { id: "summonerSiege", name: "SUMMONER SIEGE", tint: "#3a6a4a", roles: ["summon"] },
    { id: "splitterSwarm", name: "SPLITTER SWARM", tint: "#2f8a60", roles: ["split"] },
  ] as { id: string; name: string; tint: string; roles: ("flying" | "summon" | "split")[] }[],
  /**
   * Rotating MUTATION rounds — a single global rule applied to the WHOLE horde,
   * so the round PLAYS differently instead of just looking different. Each pays a
   * reward bump (you're earning the extra risk) and drops a chest on clear. The
   * `mutator` drives spawn-time stat/behavior changes in rounds.ts applyMutator().
   *   frenzy   — Blood Moon: fast + fragile glass horde, double rewards.
   *   volatile — every zombie explodes on death (chain-reaction chaos).
   *   inferno  — every zombie is Blazing (fire trails everywhere).
   *   armored  — Juggernaut wave: slow but very tanky wall.
   */
  mutations: [
    { id: "bloodMoon", name: "BLOOD MOON", tint: "#7a0e1e", mutator: "frenzy", rewardMul: 2.0 },
    { id: "volatile", name: "VOLATILE HORDE", tint: "#c2531a", mutator: "volatile", rewardMul: 1.6 },
    { id: "inferno", name: "INFERNO", tint: "#d23a16", mutator: "inferno", rewardMul: 1.6 },
    { id: "juggernaut", name: "JUGGERNAUT WAVE", tint: "#34507a", mutator: "armored", rewardMul: 1.7 },
  ] as { id: string; name: string; tint: string; mutator: "frenzy" | "volatile" | "inferno" | "armored"; rewardMul: number }[],
};

/** Elite affix layer: late-game zombies get a behavior affix + colored tell. */
export const ELITE = {
  /** Round before which no affixes appear at all. */
  fromRound: 6, // was 8 — affixes start biting earlier in the mid-game
  /** Base fraction of eligible spawns that get an affix at fromRound. */
  baseFraction: 0.14, // was 0.1 — more elites sooner
  /** Extra fraction per round past fromRound (clamped by maxFraction). */
  fractionPerRound: 0.035, // was 0.03 — ramps to a real elite-heavy horde
  maxFraction: 0.6, // was 0.5 — by late game well over half the horde is affixed
  /** Hard cap on simultaneously-alive affixed zombies (perf + readability). */
  maxAlive: 24, // was 10 — let the late-game elite swarm actually fill out
  /** Difficulty-coeff weight folded into the affix fraction. */
  coeffBoost: 0.12,
  // Per-affix tuning.
  blazingBurnDps: 10, // burn-trail DPS to the player standing in it
  glacialSlow: 0.45, // player slow fraction on hit
  glacialSlowDur: 1.6,
  glacialShatterRadius: 3.2, // freeze AoE on death
  overloadShield: 0.5, // fraction of an extra healthbar as shield
  overloadAoeRadius: 4.0,
  overloadAoeDamage: 30,
} as const;

/** Continuous difficulty director: a coefficient that climbs with round + time,
 *  surfaced as escalating zombie-themed tier names on the HUD banner. */
export const DIFFICULTY = {
  /** Coeff contribution per round. (was 0.05 — director ramped too slowly; the
   *  elite-credit swap + affix fraction barely bit before R20. 0.08 pushes the
   *  coeff past 1.0 — where the elite credit-swap kicks in — by ~R14 instead of R20.) */
  perRound: 0.08,
  /** Coeff contribution per minute of run time. (was 0.08 — a slow camper should
   *  also feel the director climb, so time pressure ramps harder too.) */
  perMinute: 0.12,
  /** Tiers (ascending). `at` is the coeff threshold the tier unlocks at. */
  tiers: [
    { at: 0.0, name: "RESTLESS", color: "#8fcf6f" },
    { at: 0.6, name: "HUNGRY", color: "#ffd24a" },
    { at: 1.1, name: "RAVENOUS", color: "#e8923a" },
    { at: 1.7, name: "FERAL", color: "#ff5d8f" },
    { at: 2.4, name: "APOCALYPSE", color: "#c0452f" },
  ] as { at: number; name: string; color: string }[],
};

/** Opt-in Curse multiplier (risk → reward). Raising it makes enemies faster /
 *  tankier / spawn quicker AND lifts score+loot by the same proportion. */
export const CURSE = {
  min: 1.0,
  max: 3.0,
  step: 0.25,
  /** How much of the curse delta feeds each stat (1 = full proportional). */
  hpScale: 1.0,
  speedScale: 0.5, // speed is touchier — half-weight so it stays playable
  spawnScale: 0.6, // faster spawns, but not punishingly so
  /** Reward multiplier = 1 + (curse-1) * rewardScale. */
  rewardScale: 1.0,
};

// ── JUICE & LOOT TUNING ──
// Feel/feedback constants for the audio + number-pop + pickup + chest/pity
// systems (audio.ts, feedback.ts, drops.ts, loot.ts). NON-CASHABLE: these only
// affect cosmetics/soft-currency feedback, never the gold↔token bridge.
export const JUICE = {
  // Tiered floating number-pops (feedback.ts).
  critColor: "#ffe14a", // crits: bright gold
  comboColor: "#ff8a3a", // combo-scaled hits: hot orange
  critScale: 1.6, // size multiplier for crits
  comboScale: 1.25, // size multiplier for combo (xN) hits
  popPunch: 1.7, // initial punch-out scale, eases to 1
  popPunchTime: 0.12, // seconds of punch-out ease
  popArc: 1.3, // horizontal drift speed (sideways arc)

  // Rarity-tiered pickup juice (drops.ts). Glow scale per rarity tier 0..4.
  glowByRarity: [1.9, 2.1, 2.4, 2.9, 3.4] as const,
  beamFromTier: 3, // epic+ (tier index ≥3) get a vertical light beam
  beamHeight: 5.5,
  beamWidth: 0.7,
  chimeBaseHz: 523, // C5 — pickup chime root, pitched up per rarity tier
} as const;

// Cascading multi-item treasure chest (drops.ts + loot.ts). Vampire-Survivors
// style quantity cascade, Luck-scaled. Probabilities are checked in order.
export const CHEST = {
  fiveChance: 0.03, // base p(5 items)
  threeChance: 0.1, // base p(3 items) if the 5-roll misses
  luckFiveBonus: 0.04, // +p(5) per luck point (clamped)
  luckThreeBonus: 0.06, // +p(3) per luck point (clamped)
  fanSpread: 1.6, // radius items fan out to
  fanLift: 4.0, // upward pop velocity of the fan
} as const;

// Pity / bad-luck protection (loot.ts). Raises the luck fed to rollRarity as a
// rare-less streak grows; resets on rare+. SOFT-CURRENCY/COSMETIC ONLY — never
// wire pity to anything cashable (see loot.ts token-bridge note).
export const PITY = {
  rareThreshold: 2, // rarity index ≥ this counts as "rare+" and resets pity
  perKillLuck: 0.06, // luck added per dry kill
  maxLuck: 2.5, // cap so pity can't trivialize legendaries
} as const;

// ── SYNERGY & CORPSES ──
// Tier-1 content roadmap leftovers: (a) active↔idle cross-coupling so the two
// economies feed each other (multiplicative but HARD-CAPPED — no runaway), and
// (b) short-lived corpse/gib/scorch decals (juice). All NON-CASHABLE: synergy
// only scales the existing soft-gold/essence faucets, decals are pure cosmetic.
export const SYNERGY = {
  /** `bankerFromWeapon`: each +100% of the player's run damageMul lifts the live
   *  banker gold rate by this fraction. Read-only in the updatePets BANKER block,
   *  MULTIPLIED alongside the prestige multiplier (which it never replaces). */
  bankerPerDamage: 0.18,
  /** Hard ceiling on the bankerFromWeapon multiplier so a hyper-damage build
   *  can't turn bankers into a firehose (stacks on top of the per-round cap). */
  bankerWeaponCap: 2.0,
  /** `essenceFromBankers`: each owned banker LEVEL past the first lifts end-of-run
   *  essence by this fraction. Surfaced via effectiveEssenceMul() for the
   *  integrator to fold into the essence payout (see main.ts note). */
  essencePerBankerLevel: 0.05,
  /** Hard ceiling on the essenceFromBankers multiplier (idle never dwarfs active). */
  essenceBankerCap: 1.5,
} as const;

export const DECALS = {
  /** Hard cap on simultaneously-alive corpse decals (pooled; oldest recycled).
   *  Mirrors the Puffs/Sparks cap discipline. Mobile uses lowSpecCap. */
  cap: 90,
  lowSpecCap: 0, // lowSpec/mobile: skip corpse decals entirely (GPU budget)
  /** Voxel gib cubes left per kill (scaled UP by crit/combo, clamped to maxPerKill). */
  gibsPerKill: 3,
  maxPerKill: 7,
  /** Seconds a decal lingers before it finishes fading out. */
  life: 2.6,
  /** Fraction of `life` spent at full opacity before the fade begins. */
  holdFrac: 0.45,
  gibScale: 0.16, // edge length of a gib cube (world units)
  gibSpread: 0.55, // how far gibs scatter from the corpse
  scorchScale: 1.1, // diameter of the flat scorch decal under the corpse
  scorchOpacity: 0.5,
} as const;

// ── PET DEPTH ──
// Depth layer on top of the existing PETS_TUNING envelope: per-role combat
// "verbs", same-role/combo squad synergies, dupe→star ascension, and the
// shiny/collection cosmetic chase. EVERYTHING here is SMALL + capped and lives
// strictly inside the last balance pass's late-game ceiling (squad cap 5,
// buffCap 2.5, no one-shots). NON-CASHABLE: the collection reward pays soft
// essence only — never tokens, never the gold↔token bridge.
/**
 * Universal evolution STAGES. Every pet climbs a 3-stage ladder as it levels
 * (by combat XP or gold): the model grows + gains a glowing crown, and its
 * damage takes a real jump at each stage. `levels[i]` is the level stage `i`
 * begins at. The handful of hand-authored evolved forms (PET_EVOLUTIONS) slot
 * in as the FINAL form for their pet — the "hybrid" hero path on top of this.
 */
export const PET_STAGES = {
  levels: [1, 8, 18], // stage 0 / 1 / 2 begin at these levels
  names: ["", "Evolved", "Ascended"], // stage label (blank = base, no tag)
  scalePerStage: 0.4, // +size per stage — Evolved is visibly bigger, Ascended bigger still
  damagePerStage: 0.16, // was 0.22 — Ascended (×1.32) still a real jump, but the stage mul
  //                       stacked with the level mul + totem buff was a big chunk of the
  //                       pet-snowball; trimmed so pets are support, not the whole army
};

export const PET_DEPTH = {
  /** Per-combatRole behavior knobs (updatePets/firePetAbility). All tiny + flat
   *  so they read as a "verb", never a power spike. */
  roles: {
    tank: {
      orbitRange: 4, // +engage range (units) — soaks/draws fire a bit wider
      aggroPull: 1.0, // pets target zombies near the tank first (handled implicitly via range)
    },
    drainer: {
      healPerKill: 0.6, // HP restored to the player per kill this pet lands
      healCapPerRound: 120, // hard cap on drainer heal per round (anti-immortal)
    },
    bomber: {
      bonusSplashRadius: 0.8, // added to the bullet's splashRadius
      bonusSplashFrac: 0.35, // splash damage = bullet damage * this (if it had none)
    },
    sniper: {
      bonusRange: 4, // +engage range
      critRange: 14, // beyond this distance, the shot is flagged a crit
      critMul: 1.5, // crit damage multiplier on distant shots (modest)
    },
    harvester: {
      goldPerKill: 1, // flat bonus gold per kill this pet lands
      goldCapPerRound: 400, // cap on harvester bonus gold per round
    },
    saboteur: {
      slow: 0.25, // brief slow fraction applied to what it hits/kills near
      slowDur: 1.2, // seconds
    },
  },

  /** Squad synergies: when the ACTIVE squad has 2+ of a combatRole (or a defined
   *  combo) grant a small squad-wide bonus. The TOTAL synergy multiplier is
   *  hard-clamped by `synergyDamageCap` so stacking comps can't break the
   *  buffCap envelope. */
  synergy: {
    /** Per-pair (2+) same-role bonuses. */
    twoSnipers: { range: 3 }, // 2+ snipers → +range for all combat pets
    twoBombers: { splashFrac: 0.2 }, // 2+ bombers → +splash on all combat pets
    twoTanks: { damageMul: 0.08 }, // 2+ tanks → small squad damage (held line)
    twoDrainers: { lifesteal: 0.4 }, // 2+ drainers → extra heal/kill squad-wide
    twoHarvesters: { gold: 1 }, // 2+ harvesters → +gold/kill squad-wide
    twoSaboteurs: { slow: 0.1 }, // 2+ saboteurs → deeper slow
    /** Named combos (one of each). */
    tankDrainer: { lifesteal: 0.5 }, // tank + drainer → +lifesteal (front-line vamp)
    sniperSaboteur: { critMul: 0.15 }, // sniper + saboteur → +crit on slowed targets
    bomberHarvester: { gold: 1 }, // bomber + harvester → gold from splash kills
    /** Hard cap on the cumulative synergy DAMAGE multiplier (stays under buffCap). */
    synergyDamageCap: 1.25,
    /** Hard cap on cumulative synergy lifesteal (HP/kill) so it never trivializes. */
    synergyLifestealCap: 2.0,
  },

  /** Dupe → star ascension. Buying a pet you already own converts the purchase
   *  into a star (stored in petProgress[id]._stars). Stars unlock skill bumps,
   *  NOT raw stat creep — capped at `maxStars`. */
  stars: {
    maxStars: 5,
    /** Damage bonus per star (flat, small): +`dmgPerStar` each star, capped. */
    dmgPerStar: 0.04, // +4%/star → +20% at 5★ (well within envelope)
    /** Star thresholds that unlock an extra role kicker (see updatePets). */
    roleKickAt: 3, // 3★+ : the pet's role behavior gets a small bump
    eliteKickAt: 5, // 5★ : a second, capped kicker
    /** Cost to convert a dupe into a star = base pet cost * this. */
    convertCostMul: 1.0,
  },

  /** Shiny/chroma cosmetic chase + collection-completion reward. PURELY visual
   *  + soft-currency; never affects power or pays tokens. */
  cosmetic: {
    shinyOdds: 0.02, // 2% chance a freshly-bought pet rolls shiny (petProgress._shiny=1)
    /** Collection-completion milestones: own N distinct pets → soft essence. */
    milestones: [
      { own: 10, essence: 5 },
      { own: 20, essence: 12 },
      { own: 30, essence: 25 },
      { own: 40, essence: 50 },
      { own: 50, essence: 100 },
    ] as { own: number; essence: number }[],
  },
} as const;
