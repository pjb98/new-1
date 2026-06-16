import * as THREE from "three";
import { CURSE, DIFFICULTY, ELITE, GOBLIN, ROUNDS, SPECIAL_ROUNDS, ZOMBIE, ZOMBIE_TYPES, ZombieType } from "./config";
import { Affix, Zombie } from "./zombie";
import { Arena } from "./arena";
import { AssetManager } from "./assets";
import { SpatialGrid } from "./grid";

type Phase = "pre" | "active" | "intermission";

/**
 * A "special" round flavoring. `id` is stable for logic, `name` drives the loud
 * HUD banner, `tint` (CSS color) recolors the screen/fog while it's live, and
 * `restrictTo`/`biasTo` reshape the roster (see pickType). `guaranteedDrop`
 * tells the integrator to grant a good drop on clear (drops are another agent's
 * domain — we only raise the flag).
 */
export interface SpecialRound {
  id: string;
  name: string;
  tint?: string;
  /** Only spawn these type ids (the whole roster for this round). */
  restrictTo?: string[];
  /** Heavily favor these type ids in the weighted pick (but still allow others). */
  biasTo?: string[];
  /** Signal to main.ts: drop something good when the round clears. */
  guaranteedDrop?: boolean;
  /** MUTATION rounds: a global rule stamped onto every zombie as it spawns
   *  (see applyMutator). null/undefined on non-mutation rounds. */
  mutator?: "frenzy" | "volatile" | "inferno" | "armored";
  /** Score + gold multiplier this round pays out (mutation rounds reward risk).
   *  main folds it into points/gold alongside the Curse + Rampage multipliers. */
  rewardMul?: number;
}

/**
 * Owns the zombie pool and drives the round loop: spawn a budget of zombies,
 * wait until they're cleared, take a breather, then escalate.
 */
export class RoundManager {
  readonly zombies: Zombie[] = [];
  /** Per-frame spatial index of alive zombies (rebuilt in update). */
  readonly grid = new SpatialGrid();
  round = 0;
  phase: Phase = "pre";

  private toSpawn = 0;
  private curHealth = ZOMBIE.baseHealth;
  private curSpeed = ZOMBIE.baseSpeed;
  private spawnTimer = 0;
  private intermissionTimer = 0;
  private edge = new THREE.Vector3();
  // round-scaled difficulty state (computed in beginRound)
  private curMaxAlive = ROUNDS.maxAliveBase;
  private curSpawnInterval = ROUNDS.spawnIntervalBase;
  private isSwarm = false;
  /** Number of players in this run (host + guests). Co-op scales enemy HP AND
   *  count by this factor — 2 players = 2× HP & 2× zombies, 4 = 4×. Set by main
   *  when a run starts (see setPlayerCount); 1 = solo, no scaling. */
  private playerCount = 1;
  /** Lowered on mobile to protect the frame budget (set from main.ts). */
  maxAliveCeiling = ROUNDS.maxAliveCap;

  /**
   * HORDE REGIME flags, surfaced for main.ts (read-only). `hordeActive` is true
   * for any round at/after ROUNDS.hordeFromRound (the regime is live). `hordeJustRose`
   * is a ONE-SHOT set true only on the exact round the regime begins (R20) and
   * cleared on every later beginRound — main reads it in onRoundStart to fire the
   * "THE HORDE RISES" banner exactly once. We do NOT wire UI here; we only raise
   * the flag (same contract as specialRound / guaranteedDrop).
   */
  hordeActive = false;
  hordeJustRose = false;
  /** 0 below the regime, ramping 0→1 across [hordeFromRound, +hordeRampRounds],
   *  pinned at 1 after. Drives the alive-cap / budget / HP-discount lerps. Public
   *  so main.ts (or tests) can read how far into the climb the current round is. */
  hordeRamp = 0;

  /**
   * Opt-in Curse multiplier (≥1). Raising it makes enemies faster / tankier /
   * spawn quicker AND lifts score+loot proportionally (see curseRewardMul). The
   * player nudges it between rounds via the HUD slider; main applies the reward
   * side. Enemy-side scaling is baked into beginRound + spawn here.
   */
  curse = CURSE.min;

  private bossPending = false;

  /** The active round's special flavoring (null on a plain round). */
  private special: SpecialRound | null = null;

  /** Continuous difficulty director coefficient: rises with round + run time.
   *  Recomputed every update(); biases affix frequency + the elite-credit swap. */
  difficultyCoeff = 0;
  /** Accumulated active-run seconds (drives the time term of difficultyCoeff). */
  private runTime = 0;
  /** Index of the difficulty tier whose banner we last surfaced (-1 = none). */
  private lastTier = -1;
  /** Fires when the difficulty director crosses into a new named tier. */
  onDifficultyTier?: (name: string, color: string) => void;

  onRoundStart?: (round: number) => void;
  onIntermission?: (nextRound: number) => void;
  onBossSpawn?: (boss: Zombie) => void;
  /** Fires when a Loot Goblin appears (toast/audio) and when it escapes uncaught. */
  onGoblinSpawn?: () => void;
  onGoblinEscape?: () => void;

  /** Live Loot Goblin (a fleeing bounty mob) + its escape countdown, if any. */
  private goblin: Zombie | null = null;
  private goblinTimer = 0;

  constructor(private scene: THREE.Scene, private assets: AssetManager) {}

  get aliveCount(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive) n++;
    return n;
  }

  /** The living round boss, if one is on the field. */
  get boss(): Zombie | undefined {
    return this.zombies.find((z) => z.alive && z.isBoss);
  }

  /** Every 5th round is a boss round. */
  get isBossRound(): boolean {
    return this.round > 0 && this.round % 5 === 0;
  }

  /** This round is a fast "swarm/dog" round. */
  get isSwarmRound(): boolean {
    return this.isSwarm;
  }

  /**
   * The active special round's surfaced descriptor (id/name/tint), or null on a
   * plain round. main.ts shows the banner + screen tint off this and reads
   * `guaranteedDrop` to gate the hound-round reward.
   */
  get specialRound(): SpecialRound | null {
    return this.special;
  }

  /** Score + loot multiplier earned by the current Curse level (≥1). main folds
   *  this into points/loot so the risk pays out proportionally. */
  get curseRewardMul(): number {
    return 1 + (this.curse - 1) * CURSE.rewardScale;
  }

  /** Bonus score/gold multiplier from the active MUTATION round (1 on a plain
   *  round). main multiplies this into kill rewards. */
  get specialRewardMul(): number {
    return this.special?.rewardMul ?? 1;
  }

  /** Co-op difficulty: set the number of players in this run (host + guests).
   *  Clamped to >=1. Applied in beginRound — scales enemy HP and count by N. */
  setPlayerCount(n: number) {
    this.playerCount = Math.max(1, Math.floor(n));
  }
  get players(): number {
    return this.playerCount;
  }

  /** Nudge the Curse up/down by `dir` steps, clamped to [min,max]. Returns the
   *  new value. Intended for the between-rounds HUD slider. */
  adjustCurse(dir: number): number {
    const next = this.curse + Math.sign(dir) * CURSE.step;
    this.curse = Math.max(CURSE.min, Math.min(CURSE.max, Math.round(next / CURSE.step) * CURSE.step));
    return this.curse;
  }

  /** Highest difficulty tier unlocked by the current coeff. */
  get difficultyTier(): { name: string; color: string } {
    const tiers = DIFFICULTY.tiers;
    let cur = tiers[0];
    for (const t of tiers) if (this.difficultyCoeff >= t.at) cur = t;
    return cur;
  }

  /**
   * Classify a round number into its special flavoring (or null). Pure so it can
   * be unit-tested and previewed. Boss rounds (every 5th) take precedence as
   * Hound Rounds; showcases rotate on their own offset cadence and skip any
   * round that's already a boss/hound round.
   */
  static classifySpecial(n: number): SpecialRound | null {
    if (n <= 0) return null;
    const sp = SPECIAL_ROUNDS;
    // Hound Round: fastest existing type only, themed tint, guaranteed drop.
    if (n % sp.houndEvery === 0) {
      const fastest = RoundManager.fastestTypeId();
      return {
        id: "hound",
        name: "HOUND ROUND",
        tint: sp.houndTint,
        restrictTo: [fastest],
        guaranteedDrop: true,
      };
    }
    // Mutation rounds: a global horde rule (Blood Moon / Volatile / Inferno /
    // Juggernaut) that changes how the round PLAYS, with bonus rewards + a chest
    // on clear. Checked before showcases so it wins ties; hound (above) still
    // takes precedence on the rare LCM collision.
    if (n % sp.mutationEvery === 0) {
      const m = sp.mutations[(n / sp.mutationEvery - 1) % sp.mutations.length];
      return {
        id: m.id,
        name: m.name,
        tint: m.tint,
        mutator: m.mutator,
        rewardMul: m.rewardMul,
        guaranteedDrop: true,
      };
    }
    // Showcase rounds: rotate Sky Terror / Summoner Siege / Splitter Swarm.
    if ((n + sp.showcaseOffset) % sp.showcaseEvery === 0) {
      const idx = Math.floor((n + sp.showcaseOffset) / sp.showcaseEvery) % sp.showcases.length;
      const sc = sp.showcases[idx];
      const ids = RoundManager.typeIdsForRoles(sc.roles, n);
      if (ids.length === 0) return null; // nothing eligible yet — stay plain
      return { id: sc.id, name: sc.name, tint: sc.tint, biasTo: ids };
    }
    return null;
  }

  /** Id of the single fastest non-boss roster type (Hound Round roster). */
  private static fastestTypeId(): string {
    let best = ZOMBIE_TYPES[0];
    for (const t of ZOMBIE_TYPES) {
      if (t.from >= 999) continue; // skip non-spawnable internal types (splitling)
      if (t.speedMul > best.speedMul) best = t;
    }
    return best.id;
  }

  /** Type ids matching a showcase's roles that are eligible by round `n`. */
  private static typeIdsForRoles(roles: ("flying" | "summon" | "split")[], n: number): string[] {
    return ZOMBIE_TYPES.filter((t) => {
      if (t.from > n) return false;
      for (const r of roles) {
        if (r === "flying" && t.flying) return true;
        if (r === "summon" && (t.summonInterval ?? 0) > 0) return true;
        if (r === "split" && t.splitInto) return true;
      }
      return false;
    }).map((t) => t.id);
  }

  /** Kick off round 1. */
  start() {
    this.beginRound(1);
  }

  private beginRound(n: number) {
    this.round = n;
    // Tag this round's special flavoring (null on a plain round). Surfaced to
    // main.ts via `specialRound` for the banner + screen tint + drop flag.
    this.special = RoundManager.classifySpecial(n);
    const inflect = ZOMBIE.hpInflection;
    const past = Math.max(0, n - inflect); // rounds past the inflection point

    // HORDE REGIME ramp: 0 below hordeFromRound, climbing linearly 0→1 across
    // [hordeFromRound, hordeFromRound+hordeRampRounds], pinned at 1 after. This
    // single 0..1 scalar drives the alive-cap, budget, and HP-discount lerps so
    // R20 is the ANNOUNCED start of a steep climb — never a one-round step.
    this.hordeRamp = Math.max(0, Math.min(1, (n - ROUNDS.hordeFromRound) / ROUNDS.hordeRampRounds));
    const wasActive = this.hordeActive;
    this.hordeActive = n >= ROUNDS.hordeFromRound;
    // One-shot "THE HORDE RISES" beat: true ONLY on the exact round the regime
    // begins (the first beginRound that flips hordeActive on). Cleared otherwise.
    this.hordeJustRose = this.hordeActive && !wasActive;

    // HP: additive through the inflection, then compounds ×hpGrowth/round. Past
    // R20 the per-round growth gets a DISCOUNT (hpGrowth*hordeHpGrowthDiscount,
    // lerped in over the ramp) so time-to-kill drops — a "mow the sea" feel, not
    // bullet-sponge gridlock. The discount applies ONLY to the rounds spent past
    // hordeFromRound, so the seam at R20 stays continuous (it equals the plain
    // curve at R20 and only bends downward after).
    const linHP = ZOMBIE.baseHealth + (n - 1) * ZOMBIE.healthPerRound;
    if (n <= inflect) {
      this.curHealth = linHP;
    } else {
      const baseHP = ZOMBIE.baseHealth + (inflect - 1) * ZOMBIE.healthPerRound;
      // rounds spent in the pre-horde regime (full growth) vs. past R20 (discounted)
      const hordeRounds = Math.max(0, n - ROUNDS.hordeFromRound);
      const normalRounds = past - hordeRounds; // rounds past inflection but pre-R20
      const discounted = ZOMBIE.hpGrowth * ROUNDS.hordeHpGrowthDiscount;
      this.curHealth = baseHP * Math.pow(ZOMBIE.hpGrowth, normalRounds) * Math.pow(discounted, hordeRounds);
    }
    this.curSpeed = Math.min(ZOMBIE.speedCap, ZOMBIE.baseSpeed + (n - 1) * ZOMBIE.speedPerRound);

    // Round-scaled ceilings: cap rises + spawns speed up past the inflection.
    this.curMaxAlive = Math.min(this.maxAliveCeiling, ROUNDS.maxAliveBase + past * ROUNDS.maxAlivePerRound);
    this.curSpawnInterval = Math.max(ROUNDS.spawnIntervalMin, ROUNDS.spawnIntervalBase - past * ROUNDS.spawnIntervalDecay);

    // HORDE REGIME: drive the alive cap HARD toward the (raised) ceiling and fatten
    // the round's spawn budget so the wall never thins. Both multipliers lerp from
    // 1.0 at R20 up to their full value at R30, then clamp (alive → maxAliveCeiling,
    // budget → countCap). Applied BEFORE the swarm/curse/co-op stack so those still
    // compound on top of the horde-scaled base.
    let count = Math.min(ROUNDS.countCap, ROUNDS.baseCount + (n - 1) * ROUNDS.countPerRound);
    if (this.hordeActive) {
      const aliveMul = 1 + (ROUNDS.hordeAliveMul - 1) * this.hordeRamp;
      const budgetMul = 1 + (ROUNDS.hordeBudgetMul - 1) * this.hordeRamp;
      this.curMaxAlive = Math.min(this.maxAliveCeiling, Math.round(this.curMaxAlive * aliveMul));
      count = Math.min(ROUNDS.countCap, Math.round(count * budgetMul));
    }

    // Swarm/dog round: short burst of fast/weak enemies from all sides.
    this.isSwarm = n >= ROUNDS.swarmEvery && n % ROUNDS.swarmEvery === 0 && n % 5 !== 0;
    if (this.isSwarm) {
      count = Math.round(count * 0.7);
      this.curMaxAlive = Math.min(this.maxAliveCeiling + 8, Math.round(this.curMaxAlive * 1.4));
      this.curSpawnInterval *= 0.5; // twice as fast
    }
    this.toSpawn = count;

    // Curse: opt-in risk→reward. A curse >1 scales enemy HP/speed up and spawns
    // in quicker; the matching reward bump lives in curseRewardMul (applied by
    // main). Folded in last so it stacks on every round/swarm adjustment above.
    const c = this.curse - 1;
    if (c > 0) {
      this.curHealth *= 1 + c * CURSE.hpScale;
      this.curSpeed = Math.min(ZOMBIE.speedCap * 1.3, this.curSpeed * (1 + c * CURSE.speedScale));
      this.curSpawnInterval = Math.max(ROUNDS.spawnIntervalMin * 0.5, this.curSpawnInterval / (1 + c * CURSE.spawnScale));
    }

    // Co-op scaling: N players ⇒ N× zombie HP AND N× the horde size. Speed is
    // left alone (a faster horde with N× the bodies is unfair); instead the
    // alive-cap and spawn rate rise so the bigger wave actually fills the arena
    // rather than trickling in. Folded in last so it multiplies curse/swarm too.
    const pc = this.playerCount;
    if (pc > 1) {
      this.curHealth *= pc;
      this.toSpawn = Math.round(this.toSpawn * pc); // N× the TOTAL horde this round
      // Let more be on-screen at once so the bigger wave actually fills the
      // arena, but bound it to 2× the perf ceiling (more players = more machines
      // sharing the sim, yet the host renders all of it — don't tank its FPS).
      this.curMaxAlive = Math.min(this.maxAliveCeiling * 2, Math.round(this.curMaxAlive * pc));
      this.curSpawnInterval = Math.max(ROUNDS.spawnIntervalMin * 0.4, this.curSpawnInterval / pc);
    }

    this.spawnTimer = 0;
    this.phase = "active";
    this.bossPending = n % 5 === 0;
    // Loot Goblin: a rare fleeing bounty mob. Rolls per round (not on boss
    // rounds — the boss already owns the spotlight). Spawned a moment in so it
    // doesn't get lost in the opening rush; see update()'s goblinTimer arm.
    this.goblin = null;
    this.goblinTimer = 0;
    if (n >= GOBLIN.fromRound && !this.bossPending && Math.random() < GOBLIN.chance) {
      this.goblinTimer = -1; // sentinel: "pending spawn" — armed in update()
    }
    this.onRoundStart?.(n);
  }

  /** Spawn the Loot Goblin: a fast, fleeing, golden bounty mob. */
  private spawnGoblin(arena: Arena) {
    const z = this.freeZombie();
    arena.randomEdgePoint(this.edge);
    const goblin = ZOMBIE_TYPES.find((t) => t.id === "goblin") ?? ZOMBIE_TYPES[0];
    z.spawn(this.edge, Math.max(this.curHealth, ZOMBIE.baseHealth * 2), this.curSpeed, goblin);
    z.fleer = true;
    z.bounty = true;
    this.goblin = z;
    this.goblinTimer = GOBLIN.lifespan;
    this.onGoblinSpawn?.();
  }

  /** True while a live Loot Goblin is on the field (HUD marker / objective). */
  get goblinAlive(): boolean {
    return !!this.goblin && this.goblin.alive;
  }

  /** The live Loot Goblin's world position, if one is fleeing right now. */
  get goblinPos(): THREE.Vector3 | null {
    return this.goblin && this.goblin.alive ? this.goblin.pos : null;
  }

  private spawnBoss(arena: Arena) {
    let z = this.zombies.find((q) => !q.alive && !q.dying) ?? this.zombies.find((q) => !q.alive);
    if (!z) {
      z = new Zombie(this.assets);
      this.scene.add(z.group);
      this.zombies.push(z);
    }
    arena.randomEdgePoint(this.edge);
    // spawn as the toughest eligible type, then crank it into a boss
    z.spawn(this.edge, this.curHealth, this.curSpeed * 0.7, ZOMBIE_TYPES[ZOMBIE_TYPES.length - 1]);
    z.promoteToBoss(this.curHealth * (6 + this.round), 2.6);
    this.bossPending = false;
    this.onBossSpawn?.(z);
  }

  /**
   * Pick a zombie type eligible at the current round. Tougher tiers unlock
   * later and consume their weight slice; the basic Shambler (index 0) fills
   * whatever probability is left.
   */
  // tanky "elite" tiers that the elite-weight ramp boosts in the 10->20 band
  private static ELITE_IDS = new Set(["brute", "armored", "abomination", "splitter", "necro"]);

  /**
   * Pick a zombie type via PROPER weighted sampling over eligible types, so the
   * mix stays sane no matter how many types have unlocked. The basic Shambler
   * keeps a guaranteed share (so mid-rounds arent a pure wall of specials), and
   * elites get a small ramp from R10.
   */
  private pickType(): ZombieType {
    // Themed showcase rounds bias the pick hard toward the theme's type ids
    // (still allowing a thin spread of others so the horde reads as a horde).
    const bias = this.special?.biasTo;
    // Elite weight ramp: starts at R6 (was R10) and climbs to a higher ceiling so
    // the brute/armored/abomination tiers dominate the mid+late horde, not basics.
    const eliteBonus = Math.max(0, Math.min(0.6, (this.round - 5) * 0.04));
    // Shambler always keeps a baseline slice that shrinks as rounds climb but
    // never vanishes, so basics are always part of the horde. On a biased round
    // the shambler share is cut right down so the theme dominates.
    const shamblerWeight = bias ? 0.06 : Math.max(0.25, 0.9 - (this.round - 1) * 0.04);
    let total = shamblerWeight;
    for (let i = 1; i < ZOMBIE_TYPES.length; i++) {
      const t = ZOMBIE_TYPES[i];
      if (this.round < t.from) continue;
      total += this.typeWeight(t, eliteBonus, bias);
    }
    let r = Math.random() * total;
    if ((r -= shamblerWeight) < 0) return ZOMBIE_TYPES[0];
    for (let i = 1; i < ZOMBIE_TYPES.length; i++) {
      const t = ZOMBIE_TYPES[i];
      if (this.round < t.from) continue;
      const w = this.typeWeight(t, eliteBonus, bias);
      if ((r -= w) < 0) return t;
    }
    return ZOMBIE_TYPES[0];
  }

  /** Sampling weight for a type, folding in the elite ramp + any showcase bias. */
  private typeWeight(t: ZombieType, eliteBonus: number, bias: string[] | undefined): number {
    let w = t.weight * (RoundManager.ELITE_IDS.has(t.id) ? 1 + eliteBonus : 1);
    if (bias) w *= bias.includes(t.id) ? 8 : 0.15; // heavy thumb on the scale
    return w;
  }

  private spawnOne(arena: Arena) {
    // Prefer a fully-idle zombie; avoid snatching one mid death-animation.
    let z = this.zombies.find((q) => !q.alive && !q.dying) ?? this.zombies.find((q) => !q.alive);
    if (!z) {
      z = new Zombie(this.assets);
      this.scene.add(z.group);
      this.zombies.push(z);
    }
    arena.randomEdgePoint(this.edge);
    const restrict = this.special?.restrictTo;
    if (restrict && restrict.length) {
      // Hound Round: roster locked to the fastest type — lean HP, extra pace, so
      // it reads as a relentless pack rather than a damage wall.
      const id = restrict[(Math.random() * restrict.length) | 0];
      const t = ZOMBIE_TYPES.find((q) => q.id === id) ?? ZOMBIE_TYPES[0];
      z.spawn(this.edge, this.curHealth * 0.55, this.curSpeed * 1.25, t);
    } else if (this.isSwarm) {
      // swarm round: weak + fast, from anywhere (full surround)
      z.spawn(this.edge, this.curHealth * 0.5, this.curSpeed * 1.35, ZOMBIE_TYPES[0]);
    } else {
      z.spawn(this.edge, this.curHealth, this.curSpeed, this.pickType());
    }
    // MUTATION rounds stamp a global rule onto each zombie. Inferno forces the
    // Blazing affix itself, so it skips the normal affix roll; the rest still
    // roll elites on top of the mutation.
    const mut = this.special?.mutator;
    if (mut) this.applyMutator(z, mut);
    if (mut !== "inferno") this.maybeAffix(z);
    this.toSpawn--;
  }

  /** Stamp a mutation round's global rule onto a freshly-spawned zombie. */
  private applyMutator(z: Zombie, mut: NonNullable<SpecialRound["mutator"]>) {
    switch (mut) {
      case "frenzy": // Blood Moon: a fast, fragile glass horde that floods you.
        z.speed *= 1.35;
        z.health *= 0.6;
        z.maxHealth = z.health;
        break;
      case "volatile": // every corpse detonates (main reads z.explodes on death).
        z.explodes = true;
        z.blastRadius = Math.max(z.blastRadius, 2.4);
        z.blastDamage = Math.max(z.blastDamage, this.curHealth * 0.5);
        break;
      case "inferno": // the whole horde is on fire — burn trails everywhere.
        z.applyAffix("blazing");
        break;
      case "armored": // Juggernaut wave: a slow, very tanky wall.
        z.speed *= 0.78;
        z.health *= 2.0;
        z.maxHealth = z.health;
        break;
    }
  }

  /** Count of currently-alive affixed zombies (cap + HUD use). */
  get affixedAlive(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive && z.affix) n++;
    return n;
  }

  /** Roll an elite affix onto a freshly-spawned zombie, respecting the cap +
   *  round/difficulty-scaled fraction. Bosses + flying swarmers are skipped. */
  private maybeAffix(z: Zombie) {
    if (this.round < ELITE.fromRound || z.isBoss) return;
    if (this.affixedAlive >= ELITE.maxAlive) return;
    const frac = Math.min(
      ELITE.maxFraction,
      ELITE.baseFraction + (this.round - ELITE.fromRound) * ELITE.fractionPerRound + this.difficultyCoeff * ELITE.coeffBoost,
    );
    if (Math.random() >= frac) return;
    const roll = Math.random();
    const affix: Affix = roll < 0.34 ? "blazing" : roll < 0.67 ? "glacial" : "overloading";
    z.applyAffix(affix);
  }

  /** Grab an idle pooled zombie (or grow the pool). */
  private freeZombie(): Zombie {
    let z = this.zombies.find((q) => !q.alive && !q.dying) ?? this.zombies.find((q) => !q.alive);
    if (!z) {
      z = new Zombie(this.assets);
      this.scene.add(z.group);
      this.zombies.push(z);
    }
    return z;
  }

  /** Difficulty credit: quietly recycle one weak, unaffixed basic so an elite
   *  can take the freed slot. Picks a low-value type (cheap to lose) and just
   *  flips it idle — no FX, it's a behind-the-scenes density swap. */
  private retireWeakForElite() {
    let victim: Zombie | undefined;
    for (const z of this.zombies) {
      if (!z.alive || z.affix || z.isBoss || z.flying) continue;
      // prefer the cheapest fodder (low score multiplier ≈ basic)
      if (!victim || z.scoreMul < victim.scoreMul) victim = z;
    }
    if (victim) {
      victim.alive = false;
      victim.dying = false;
      victim.group.visible = false;
    }
  }

  /** Necromancer summon: raise a few fast crawlers near the summoner. */
  private summonAdds(from: Zombie, count: number) {
    if (this.aliveCount >= this.curMaxAlive + 6) return; // respect the cap (+small slack)
    const crawler = ZOMBIE_TYPES.find((t) => t.id === "crawler") ?? ZOMBIE_TYPES[0];
    for (let i = 0; i < count; i++) {
      const z = this.freeZombie();
      this.edge.set(from.pos.x + (Math.random() - 0.5) * 3, 0, from.pos.z + (Math.random() - 0.5) * 3);
      z.spawn(this.edge, this.curHealth * 0.6, this.curSpeed * 1.1, crawler);
    }
  }

  /** Splitter death: spawn its smaller copies at the corpse. Called by main. */
  splitOn(z: Zombie) {
    if (!z.splitInto || z.splitCount <= 0) return;
    if (this.aliveCount >= this.curMaxAlive + 6) return;
    const t = ZOMBIE_TYPES.find((q) => q.id === z.splitInto);
    if (!t) return;
    for (let i = 0; i < z.splitCount; i++) {
      const c = this.freeZombie();
      this.edge.set(z.pos.x + (Math.random() - 0.5) * 1.6, 0, z.pos.z + (Math.random() - 0.5) * 1.6);
      c.spawn(this.edge, this.curHealth, this.curSpeed, t);
    }
  }

  update(dt: number, arena: Arena, playerPositions: THREE.Vector3[]) {
    // Difficulty director: accumulate run time while a round is live, recompute
    // the continuous coeff, and surface a banner each time we cross into a new
    // named tier (Restless → Hungry → … → Apocalypse).
    if (this.phase === "active") this.runTime += dt;
    this.difficultyCoeff = (this.round - 1) * DIFFICULTY.perRound + (this.runTime / 60) * DIFFICULTY.perMinute;
    let tier = 0;
    for (let i = 0; i < DIFFICULTY.tiers.length; i++) if (this.difficultyCoeff >= DIFFICULTY.tiers[i].at) tier = i;
    if (tier > this.lastTier) {
      this.lastTier = tier;
      const t = DIFFICULTY.tiers[tier];
      if (this.round > 0) this.onDifficultyTier?.(t.name, t.color);
    }

    // Loot Goblin lifecycle: arm a pending spawn a few seconds into the round,
    // then count down its escape timer. If it survives the timer it flees the
    // map (despawn, no reward); catching it is handled in main via z.bounty.
    if (this.phase === "active" && this.goblinTimer !== 0) {
      if (this.goblinTimer < 0) {
        // pending: hold until the opening rush settles, then drop it in
        this.goblinTimer -= dt;
        if (this.goblinTimer <= -2.5) this.spawnGoblin(arena);
      } else if (this.goblin) {
        if (!this.goblin.alive) {
          this.goblin = null; // caught (main spawned the chest) — clear the slot
          this.goblinTimer = 0;
        } else {
          this.goblinTimer -= dt;
          if (this.goblinTimer <= 0) {
            // escaped: spirit it away with no payout
            this.goblin.alive = false;
            this.goblin.dying = false;
            this.goblin.group.visible = false;
            this.goblin = null;
            this.onGoblinEscape?.();
          }
        }
      }
    }

    // Rebuild the spatial grid once per frame; zombies + combat systems query it.
    this.grid.rebuild(this.zombies);
    if (this.phase === "active") {
      // boss rounds: drop the boss in first, then the supporting horde
      if (this.bossPending) this.spawnBoss(arena);
      if (this.toSpawn > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          // Normally we stall at the alive cap. Past a high difficulty coeff we
          // "credit-swap": retire one weak basic to make room for an elite, so
          // late rounds get scarier in QUALITY without blowing the perf budget.
          if (this.aliveCount >= this.curMaxAlive && this.difficultyCoeff >= 1 && this.affixedAlive < ELITE.maxAlive) {
            this.retireWeakForElite();
          }
          if (this.aliveCount < this.curMaxAlive) {
            this.spawnOne(arena);
            this.spawnTimer = this.curSpawnInterval;
          }
        }
      } else if (this.aliveCount === 0) {
        this.phase = "intermission";
        this.intermissionTimer = ROUNDS.intermission;
        this.onIntermission?.(this.round + 1);
      }
    } else if (this.phase === "intermission") {
      this.intermissionTimer -= dt;
      if (this.intermissionTimer <= 0) this.beginRound(this.round + 1);
    }

    // move + animate the living horde; advance death animations for corpses
    for (const z of this.zombies) {
      if (z.alive) {
        const target = this.nearestPlayer(z.pos, playerPositions);
        if (target) {
          z.update(dt, target, this.grid);
          arena.resolveObstacles(z.pos, ZOMBIE.radius);
          z.group.position.x = z.pos.x;
          z.group.position.z = z.pos.z;
          if (z.wantsSummon) {
            z.wantsSummon = false;
            this.summonAdds(z, z.summonCount);
          }
        }
      } else if (z.dying) {
        z.updateDying(dt);
      }
    }
  }

  private nearestPlayer(pos: THREE.Vector3, players: THREE.Vector3[]): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const p of players) {
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  reset() {
    for (const z of this.zombies) {
      z.alive = false;
      z.dying = false;
      z.group.visible = false;
    }
    this.round = 0;
    this.phase = "pre";
    this.toSpawn = 0;
    this.special = null;
    this.goblin = null;
    this.goblinTimer = 0;
    this.runTime = 0;
    this.difficultyCoeff = 0;
    this.lastTier = -1;
    this.hordeActive = false;
    this.hordeJustRose = false;
    this.hordeRamp = 0;
  }
}
