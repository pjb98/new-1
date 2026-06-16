import * as THREE from "three";
import { voxelMaterial, glowMaterial } from "../palette";
import { TdMap } from "./tdmap";
import { TdEnemies, type TdSpawnSpec } from "./tdenemy";
import { TD_PADS, TD_GOAL } from "./tdpath";
import {
  TD_TOWERS, TD_TOWER_IDS, TD_MAX_TIER, towerStats, tdUpgradeCost, tdSellValue,
  pickTarget, pickTargets, nearestCreep,
  TD_TARGET_MODES, type TdTowerId, type TdTargetMode, type TdTargetable, type TdTowerDef, type TdTowerStats,
} from "./tdtowers";
import { buildWave, spawnInterval, waveClearBonus, TD_START_GOLD, TD_START_LIVES, TD_TOTAL_WAVES } from "./tdwaves";
import {
  duelInit, duelSend, duelPlayerLeak, duelEndWave, duelUnlockedSends, DUEL_MAX_HP,
  type DuelState,
} from "./tdduel";
import { TdFx } from "./tdfx";
import { TdHud, type TdHudState } from "./tdhud";
import { TdAudio } from "./tdaudio";
import { loadVoxTurrets, hasVoxTurret, buildVoxTurret } from "./voxturret";
import type { TdDailyMods } from "./tddaily";

/** Entry options: endless keeps waves coming past TD_TOTAL_WAVES (score = wave
 *  reached); daily layers the day's seeded modifier on top of endless. */
export interface TdEnterOpts {
  endless?: boolean;
  daily?: TdDailyMods;
}

export type TdGameMode = "solo" | "duel";

/** A built turret occupying one pad. */
interface Tower {
  pad: number; id: TdTowerId; tier: number; target: TdTargetMode;
  def: TdTowerDef; pos: THREE.Vector3; cooldown: number;
  group: THREE.Group; barrel: THREE.Group;
  spin?: THREE.Object3D;   // orbiting energy ring (idle spin)
  spin2?: THREE.Object3D;  // inner counter-rotating ring
  scan?: THREE.Object3D;   // continuously spinning element (radar/etc.)
  core?: THREE.Object3D;   // pulsing energy core in the body
  muzzle?: THREE.Object3D; // glowing business-end (pulses + flashes on fire)
  sight?: THREE.Mesh;      // laser sight beam to the current target (world-space, in fx)
  aim: THREE.Vector3;      // current target world pos (when aiming)
  aiming: boolean;         // has a target this frame
  barrelY: number;         // rest Y of the barrel (for hover bob)
  deploy: number;          // 0..1 build/deploy animation progress
  recoil: number;          // 0..1 kickback decaying after a shot
  flash: number;           // 0..1 muzzle-flash decaying after a shot
  lastTarget: number;      // creep id locked last frame (for the acquire telegraph)
}

const BUILD_REACH = 4;
const TURRET_SCALE = 2.1;       // base turret size (they were dwarfed by the pads)
const NEXT_WAVE_DELAY = 10;     // auto-start the next wave after this many seconds
const EARLY_CALL_RATE = 2;      // bonus gold per second skipped when calling early
const COMBO_WINDOW = 2.6;       // seconds between kills before the streak drops
const COMBO_STEP = 0.04;        // gold/score multiplier gained per kill in a streak
const COMBO_CAP = 50;           // combo count past which the multiplier stops growing

/** Spring-overshoot easing (0..1 → past 1 then settle) for the deploy pop. */
function easeOutBack(x: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * Tower-Defense controller, Solo + 1v1 Duel.
 *
 * Solo: survive TD_TOTAL_WAVES; lives lost on leaks. Duel: you + an AI bot each
 * defend a lane against the same shared waves; you spend gold to SEND creeps at
 * the bot (which permanently grows your income), leaks chip base HP, first to 0
 * loses. The bot's lane is simulated in tdduel; only yours is rendered.
 *
 * main drives it: enter(mode) / tick() / build/upgrade/sell/cycleTarget / send /
 * startNextWave / leave, keeping the player (the engineer), camera and input.
 */
export class TdMode {
  private map: TdMap;
  private creeps: TdEnemies;
  private towers = new Map<number, Tower>(); // keyed by pad index
  private scene: THREE.Scene;
  private fx = new THREE.Group();
  private vfx!: TdFx;                           // pooled muzzle/tracer/impact/text effects (per match)
  private ui?: TdHud;                           // build-palette + status HUD
  private ring: THREE.Mesh;                    // range preview around the nearest tower

  mode: TdGameMode = "solo";
  /** Optional leave hook — fired by the HUD's on-screen "✕ Leave" button so
   *  touch players (no Escape key) can quit. main sets this to its leaveTd(). */
  onLeave?: () => void;
  private duel?: DuelState;
  private duelDifficulty = 0.5;
  private pendingBotSends: TdSpawnSpec[] = [];

  // solo economy
  private soloGold = TD_START_GOLD;
  private soloLives = TD_START_LIVES;

  private audio = new TdAudio();
  private ghost?: THREE.Group;  // translucent build preview at the nearest empty pad
  wave = 0;
  /** Waves fully cleared this session (cross-mode daily-quest metric). */
  wavesCleared = 0;
  /** Running run score (kills × bounty × combo). Read by main for the high score. */
  score = 0;
  /** Best kill-streak reached this session. */
  bestCombo = 0;
  // kill-streak combo: each kill within COMBO_WINDOW seconds raises the streak,
  // which multiplies gold + score. A leak resets it.
  private combo = 0;
  private comboTimer = 0;
  private _curPad = -1; // pad the engineer is standing at (HUD taps act on it)
  // active poison/burn DoTs keyed by creep id (venom + cannon incendiary)
  private poison = new Map<number, { dps: number; until: number; color: number; puff: number }>();
  private opts: TdEnterOpts = {};
  private _tAnim = 0; // animation clock for turret idle motion
  private _shakeImpulse = 0; // camera shake to hand to main (consumed each frame)
  private _hitStop = 0;      // brief freeze request to hand to main (consumed each frame)
  private _ended = false;    // guards the one-shot win/lose sting
  private spawnQueue: TdSpawnSpec[] = [];
  private spawnTimer = 0;
  private betweenWaves = true;
  private nextWaveIn = NEXT_WAVE_DELAY;
  private active = false;

  result: { over: boolean; win: boolean } = { over: false, win: false };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.map = new TdMap(scene);
    this.creeps = new TdEnemies(scene);
    scene.add(this.fx);
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.12, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.fx.add(this.ring);
    // Preload the baked voxel turret models (best-effort; falls back to procedural).
    void loadVoxTurrets(TD_TOWER_IDS);
  }

  spawn(): THREE.Vector3 { return new THREE.Vector3(0, 0, 0); }
  clamp(pos: THREE.Vector3) {
    pos.x = Math.max(-34, Math.min(34, pos.x));
    pos.z = Math.max(-26, Math.min(30, pos.z));
    pos.y = 0;
  }

  // ---- gold helpers (solo bank vs duel state) ----
  get gold(): number { return this.mode === "duel" && this.duel ? this.duel.playerGold : this.soloGold; }
  private addGold(n: number) { if (this.mode === "duel" && this.duel) this.duel.playerGold += n; else this.soloGold += n; }
  private spendGold(n: number) { this.addGold(-n); }

  /** Layer the daily modifier (if any) onto a creep about to spawn. */
  private applyDailyMods(spec: TdSpawnSpec): TdSpawnSpec {
    const d = this.opts.daily;
    if (!d) return spec;
    return {
      ...spec,
      hp: Math.max(1, Math.round(spec.hp * d.hpMul)),
      speed: spec.speed * d.speedMul,
      bounty: Math.max(1, Math.round(spec.bounty * d.bountyMul)),
    };
  }

  /** Camera-shake impulse accrued since last frame (main applies + decays it). */
  consumeShake(): number { const s = this._shakeImpulse; this._shakeImpulse = 0; return s; }
  /** Base health fraction (0..1) for the shield dome. */
  private baseHealthFrac(): number {
    if (this.mode === "duel" && this.duel) return Math.max(0, this.duel.playerHp / DUEL_MAX_HP);
    return Math.max(0, this.soloLives / TD_START_LIVES);
  }

  enter(mode: TdGameMode = "solo", opts: TdEnterOpts = {}) {
    if (this.active) return;
    this.active = true;
    this.mode = mode;
    this.opts = opts;
    this.result = { over: false, win: false };
    this.map.setVisible(true);
    this.soloGold = Math.round(TD_START_GOLD * (opts.daily?.goldStartMul ?? 1));
    this.soloLives = TD_START_LIVES;
    this.duel = mode === "duel" ? duelInit() : undefined;
    this.pendingBotSends = [];
    this.wave = 0;
    this.wavesCleared = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.poison.clear();
    this._ended = false;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.betweenWaves = true;
    this.nextWaveIn = NEXT_WAVE_DELAY;
    this.vfx = new TdFx(this.scene);
    this.buildHud();
    this.ui?.banner(
      opts.daily ? `DAILY — ${opts.daily.name}` :
      mode === "duel" ? "1v1 DUEL" :
      opts.endless ? "ENDLESS" : "TOWER DEFENSE",
    );
  }

  leave() {
    if (!this.active) return;
    this.active = false;
    this.map.setVisible(false);
    this.creeps.clear();
    for (const t of this.towers.values()) {
      this.fx.remove(t.group); this.disposeGroup(t.group);
      if (t.sight) { this.fx.remove(t.sight); t.sight.geometry.dispose(); (t.sight.material as THREE.Material).dispose(); }
    }
    this.towers.clear();
    this.vfx.clear();
    this.ring.visible = false;
    if (this.ghost) { this.fx.remove(this.ghost); this.disposeGroup(this.ghost); this.ghost = undefined; }
    this.map.setBossMood(false);
    this.ui?.destroy();
    this.ui = undefined;
  }

  // ---- pads / building ----
  nearestPad(pos: THREE.Vector3): number {
    let best = -1, bestD = BUILD_REACH * BUILD_REACH;
    for (let i = 0; i < TD_PADS.length; i++) {
      const dx = TD_PADS[i].x - pos.x, dz = TD_PADS[i].z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  padOccupied(i: number): boolean { return this.towers.has(i); }
  towerAt(i: number): { id: TdTowerId; tier: number; target: TdTargetMode } | null {
    const t = this.towers.get(i);
    return t ? { id: t.id, tier: t.tier, target: t.target } : null;
  }

  build(pad: number, id: TdTowerId): boolean {
    if (this.towers.has(pad) || this.result.over) return false;
    const def = TD_TOWERS[id];
    if (this.gold < def.cost) return false;
    this.spendGold(def.cost);
    const p = TD_PADS[pad];
    const pos = new THREE.Vector3(p.x, 0, p.z);
    const group = this.makeTurret(id, 1);
    group.position.copy(pos).setY(this.turretY(1));
    this.fx.add(group);
    // a laser sight beam (world-space, lives in fx) that locks onto the target
    const sight = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 1),
      glowMaterial(def.color, 1.2),
    );
    (sight.material as THREE.MeshStandardMaterial).transparent = true;
    sight.visible = false;
    this.fx.add(sight);
    const t: Tower = {
      pad, id, tier: 1, target: def.defaultTarget, def, pos, cooldown: 0, group,
      barrel: group.getObjectByName("barrel") as THREE.Group,
      sight, aim: new THREE.Vector3(), aiming: false, barrelY: 0, deploy: 0,
      recoil: 0, flash: 0, lastTarget: -1,
    };
    this.grabRefs(t, group);
    this.towers.set(pad, t);
    this.audio.build();
    this.refreshHud();
    return true;
  }
  /** Cache the animated child refs off a (re)built turret group. */
  private grabRefs(t: Tower, group: THREE.Group) {
    t.barrel = group.getObjectByName("barrel") as THREE.Group;
    t.spin = group.getObjectByName("spin") ?? undefined;
    t.spin2 = group.getObjectByName("spin2") ?? undefined;
    t.scan = group.getObjectByName("scan") ?? undefined;
    t.core = group.getObjectByName("core") ?? undefined;
    t.muzzle = group.getObjectByName("muzzle") ?? undefined;
    t.barrelY = t.barrel ? t.barrel.position.y : 0;
  }
  upgrade(pad: number): boolean {
    const t = this.towers.get(pad);
    if (!t || this.result.over) return false;
    const cost = tdUpgradeCost(t.id, t.tier);
    if (cost == null || this.gold < cost) return false;
    this.spendGold(cost);
    t.tier++;
    // rebuild the model so the tower visibly evolves (more shards, bigger weapon)
    this.fx.remove(t.group);
    this.disposeGroup(t.group);
    const ng = this.makeTurret(t.id, t.tier);
    ng.position.copy(t.pos).setY(this.turretY(t.tier));
    this.fx.add(ng);
    t.group = ng;
    this.grabRefs(t, ng);
    t.deploy = 0; // replay the deploy pop so the upgrade feels punchy
    if (t.sight) (t.sight.material as THREE.MeshStandardMaterial).color.setHex(t.def.color);
    this.audio.upgrade();
    this.refreshHud();
    return true;
  }
  sell(pad: number): boolean {
    const t = this.towers.get(pad);
    if (!t) return false;
    this.addGold(tdSellValue(t.id, t.tier));
    this.fx.remove(t.group);
    this.disposeGroup(t.group);
    if (t.sight) { this.fx.remove(t.sight); t.sight.geometry.dispose(); (t.sight.material as THREE.Material).dispose(); }
    this.towers.delete(pad);
    this.audio.sell();
    this.refreshHud();
    return true;
  }
  /** Brief hit-stop request (seconds) for main to apply, then reset. */
  consumeHitStop(): number { const s = this._hitStop; this._hitStop = 0; return s; }
  /** Cycle a tower's target priority (First→Last→Strong→Close). */
  cycleTarget(pad: number): boolean {
    const t = this.towers.get(pad);
    if (!t) return false;
    const i = TD_TARGET_MODES.indexOf(t.target);
    t.target = TD_TARGET_MODES[(i + 1) % TD_TARGET_MODES.length];
    this.refreshHud();
    return true;
  }

  // ---- duel sends ----
  /** Unlocked send ids for the prompt (duel only). */
  unlockedSendIds(): string[] {
    return this.mode === "duel" && this.duel ? duelUnlockedSends(this.duel).map((s) => s.id) : [];
  }
  /** Spend gold to send creeps at the bot (raises your income). Returns success. */
  send(id: string): boolean {
    if (this.mode !== "duel" || !this.duel) return false;
    return duelSend(this.duel, id);
  }

  // ---- waves ----
  get isBetweenWaves(): boolean { return this.betweenWaves; }
  /** Bonus gold you'd get for calling the next wave RIGHT NOW (early-call). */
  earlyCallBonus(): number {
    return this.betweenWaves ? Math.round(EARLY_CALL_RATE * Math.max(0, this.nextWaveIn)) : 0;
  }
  startNextWave() {
    if (!this.betweenWaves || this.result.over) return;
    this.addGold(this.earlyCallBonus()); // reward calling early
    if (this.mode === "duel" && this.duel) {
      this.wave = this.duel.wave;
      this.spawnQueue = buildWave(this.wave).concat(this.pendingBotSends);
      this.pendingBotSends = [];
    } else {
      this.wave++;
      this.spawnQueue = buildWave(this.wave);
    }
    this.spawnTimer = 0;
    this.betweenWaves = false;
    const boss = this.wave % 5 === 0;
    this.ui?.banner(boss ? `Wave ${this.wave} — BOSS` : `Wave ${this.wave}`);
    this.map.setBossMood(boss);   // ominous red haze on boss waves
    this.map.pulseSpawn();        // flare the spawn portal
    this.audio.waveStart(boss);
    this.refreshHud();
  }

  tick(dt: number, playerPos?: THREE.Vector3) {
    if (!this.active || this.result.over) return;
    this.map.update(dt);
    this._tAnim += dt; // animation/DoT clock (advanced early so poison reads it)

    // combo decay: the streak drops if no kill lands inside the window
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // wave pacing
    if (this.betweenWaves) {
      this.nextWaveIn -= dt;
      if (this.nextWaveIn <= 0) this.startNextWave();
    } else {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.spawnQueue.length) {
        this.creeps.spawn(this.applyDailyMods(this.spawnQueue.shift()!));
        this.spawnTimer = spawnInterval(this.wave);
      }
    }

    // poison/burn DoTs eat away at marked creeps before the reap
    this.tickPoison(dt);

    // advance creeps; bank kills (combo-multiplied), take leaks
    const res = this.creeps.update(dt);
    for (const b of res.bounties) this.registerKill(b);
    if (res.leaked > 0) {
      this.combo = 0; this.comboTimer = 0; // a leak breaks the streak
      this.map.flashBase(0.4);
      this.audio.leak();
      this._shakeImpulse = Math.min(0.5, this._shakeImpulse + 0.12 + res.leaked * 0.02);
      const dmg = this.mode === "duel" ? res.leakedDamage : res.leaked;
      this.vfx.floatText(new THREE.Vector3(TD_GOAL.x, 2.2, TD_GOAL.z), `-${dmg}`, 0xff5a4a);
      if (this.mode === "duel" && this.duel) {
        duelPlayerLeak(this.duel, res.leakedDamage);
        if (this.duel.over) this.result = { over: true, win: this.duel.win };
      } else {
        this.soloLives -= res.leaked;
        if (this.soloLives <= 0) { this.soloLives = 0; this.result = { over: true, win: false }; }
      }
    }
    this.map.setBaseHealth(this.baseHealthFrac());

    // detectors reveal camo creeps before towers pick targets
    for (const t of this.towers.values()) {
      if (t.def.detect) this.creeps.revealZone(t.pos, towerStats(t.id, t.tier).range);
    }

    this.fireTowers(dt);
    this.animateTowers(dt);
    this.vfx.update(dt);
    this._curPad = playerPos ? this.nearestPad(playerPos) : -1;
    if (playerPos) { this.updateRing(playerPos); this.updateTowerPanel(playerPos); }

    // wave cleared?
    if (!this.betweenWaves && this.spawnQueue.length === 0 && this.creeps.count === 0) {
      this.map.setBossMood(false); // clear the boss haze once the wave is down
      this.wavesCleared++;
      if (this.mode === "duel" && this.duel) {
        this.pendingBotSends = duelEndWave(this.duel, this.duelDifficulty);
        if (this.duel.over) this.result = { over: true, win: this.duel.win };
        else { this.betweenWaves = true; this.nextWaveIn = NEXT_WAVE_DELAY; }
      } else {
        const bonus = waveClearBonus(this.wave);
        this.addGold(bonus);
        this.vfx.floatText(new THREE.Vector3(TD_GOAL.x, 3, TD_GOAL.z), `+${bonus}g`, 0xffd24a);
        // endless (and daily) runs never "win" — the score is the wave you fall on
        if (!this.opts.endless && this.wave >= TD_TOTAL_WAVES) this.result = { over: true, win: true };
        else { this.betweenWaves = true; this.nextWaveIn = NEXT_WAVE_DELAY; }
      }
    }

    // one-shot win/lose sting + clear any boss haze
    if (this.result.over && !this._ended) {
      this._ended = true;
      this.map.setBossMood(false);
      if (this.result.win) this.audio.win(); else this.audio.lose();
    }

    this.refreshHud();
  }

  // ---- combo / score ----
  /** Live gold/score multiplier from the current kill streak (1× … ~3×). */
  private comboMult(): number { return 1 + Math.min(this.combo, COMBO_CAP) * COMBO_STEP; }
  /** Credit a kill: bump the streak, pay combo-scaled gold, accrue score, and
   *  punch a little feedback at streak milestones. */
  private registerKill(bounty: number) {
    this.combo++;
    this.comboTimer = COMBO_WINDOW;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const mult = this.comboMult();
    this.addGold(Math.round(bounty * mult));
    this.score += Math.round(bounty * mult * 10);
    // streak milestones: a celebratory pop over the base + a tiny shake
    if (this.combo >= 5 && this.combo % 5 === 0) {
      this.vfx.floatText(new THREE.Vector3(TD_GOAL.x, 3.6, TD_GOAL.z), `COMBO ×${mult.toFixed(1)}`, 0xffe14a);
      this._shakeImpulse = Math.min(0.5, this._shakeImpulse + 0.03);
    }
  }

  // ---- poison / burn DoTs ----
  /** Mark a creep with a poison/burn tick (strongest dps wins; longest time kept). */
  private addPoison(id: number, dps: number, time: number, color: number) {
    if (dps <= 0 || time <= 0) return;
    const until = this._tAnim + time;
    const cur = this.poison.get(id);
    if (!cur) this.poison.set(id, { dps, until, color, puff: 0 });
    else { cur.dps = Math.max(cur.dps, dps); cur.until = Math.max(cur.until, until); cur.color = color; }
  }
  /** Splash-apply a DoT to every creep within radius of a point. */
  private poisonNear(x: number, z: number, radius: number, dps: number, time: number, color: number) {
    const r2 = radius * radius;
    for (const e of this.creeps.enemies()) {
      const dx = e.pos.x - x, dz = e.pos.z - z;
      if (dx * dx + dz * dz <= r2) this.addPoison(e.id, dps, time, color);
    }
  }
  /** Drain HP from poisoned creeps each frame; expire finished marks + puff FX. */
  private tickPoison(dt: number) {
    if (this.poison.size === 0) return;
    const now = this._tAnim;
    for (const [id, p] of this.poison) {
      if (now >= p.until) { this.poison.delete(id); continue; }
      this.creeps.damage(id, p.dps * dt, true); // poison/burn ignores armor (no-op if reaped)
      p.puff -= dt;
      if (p.puff <= 0) {
        p.puff = 0.4;
        const e = this.creeps.enemies().find((v) => v.id === id);
        if (e) this.vfx.ring(new THREE.Vector3(e.pos.x, 0.5, e.pos.z), p.color, 0.7);
        else { this.poison.delete(id); }
      }
    }
  }

  // ---- tower firing ----
  private fireTowers(dt: number) {
    if (this.towers.size === 0) return;
    const view = this.creeps.enemies();
    // adapt to the targeting shape (camo gated by reveal)
    const targets: TdTargetable[] = view.map((e) => ({
      id: e.id, pos: { x: e.pos.x, z: e.pos.z }, dist: e.dist, hp: e.hp,
      alive: e.alive, targetable: !e.camo || e.revealed,
    }));
    const byId = new Map<number, (typeof view)[number]>();
    for (const e of view) byId.set(e.id, e);

    // OVERCHARGE auras (pylon t4): a tower's outgoing damage is amplified by the
    // sum of overlapping aura buffs. Precompute the aura discs once per frame.
    const auras: { x: number; z: number; r2: number; buff: number }[] = [];
    for (const t of this.towers.values()) {
      const s = towerStats(t.id, t.tier);
      if (s.buff > 0) auras.push({ x: t.pos.x, z: t.pos.z, r2: s.buffRange * s.buffRange, buff: s.buff });
    }
    const ampAt = (x: number, z: number) => {
      let m = 1;
      for (const a of auras) { const dx = x - a.x, dz = z - a.z; if (dx * dx + dz * dz <= a.r2) m += a.buff; }
      return m;
    };

    for (const t of this.towers.values()) {
      t.cooldown -= dt;
      t.aiming = false;
      const st = towerStats(t.id, t.tier);
      const tid = pickTarget(t.pos.x, t.pos.z, st.range, targets, t.target);
      if (tid < 0) continue;
      const tgt = byId.get(tid);
      if (!tgt) continue;
      t.barrel.rotation.y = Math.atan2(tgt.pos.x - t.pos.x, tgt.pos.z - t.pos.z);
      t.aiming = true;
      t.aim.set(tgt.pos.x, 0.7, tgt.pos.z); // for the laser sight
      // acquire telegraph: a quick lock-ring pops when a tower picks a NEW target
      if (tid !== t.lastTarget) {
        this.vfx.ring(new THREE.Vector3(tgt.pos.x, 0.6, tgt.pos.z), t.def.color, 1.1);
        t.lastTarget = tid;
      }
      if (t.cooldown > 0) continue;
      t.cooldown = 1 / st.fireRate;

      const amp = ampAt(t.pos.x, t.pos.z);
      const from = new THREE.Vector3(t.pos.x, 1.4, t.pos.z);
      // MULTISHOT (arrow t4): the volley forks to several distinct targets.
      const shotIds = st.multishot > 1
        ? pickTargets(t.pos.x, t.pos.z, st.range, targets, t.target, st.multishot)
        : [tid];
      for (const sid of shotIds) {
        const e = byId.get(sid);
        if (e) this.fireShot(t, st, amp, from, e, view, byId);
      }

      const dir = new THREE.Vector3(tgt.pos.x - t.pos.x, 0, tgt.pos.z - t.pos.z).normalize();
      this.vfx.muzzleFlash(from, dir, t.def.color);
      this.audio.fire(t.id);
      t.recoil = 1; t.flash = 1; // kick + muzzle glow
      if (t.id === "cannon") { // a heavy boom: shake + a sliver of hit-stop
        this._shakeImpulse = Math.min(0.5, this._shakeImpulse + 0.05);
        this._hitStop = Math.max(this._hitStop, 0.045);
      }
    }
  }

  /** Resolve a single bolt against creep `e`: crit roll, splash/single damage,
   *  slow/stun, DoT seeding, and the chain arc — plus the travelling tracer. */
  private fireShot(
    t: Tower, st: TdTowerStats, amp: number, from: THREE.Vector3,
    e: { id: number; pos: THREE.Vector3 }, view: ReturnType<TdEnemies["enemies"]>,
    byId: Map<number, (typeof view)[number]>,
  ) {
    const big = st.splash > 0;
    const crit = st.crit > 0 && Math.random() < st.crit;
    const dmg = st.damage * amp * (crit ? st.critMul : 1);
    const ex = e.pos.x, ez = e.pos.z;

    if (st.splash > 0) {
      this.creeps.damageNear(e.pos, st.splash, dmg, t.def.pierce);
      if (st.dot > 0) this.poisonNear(ex, ez, st.splash, st.dot * amp, st.dotTime, t.def.color);
    } else {
      this.creeps.damage(e.id, dmg, t.def.pierce);
      if (st.dot > 0) this.addPoison(e.id, st.dot * amp, st.dotTime, t.def.color);
    }
    if (st.slow > 0) this.creeps.applySlow(e.id, st.slow, st.slowTime);
    if (st.stun > 0) this.creeps.applySlow(e.id, 0.96, st.stun); // flash-freeze ≈ stun

    // CHAIN ARC (tesla): jump to the nearest creeps, damage falling off per hop.
    if (st.chain > 0) this.chainArc(ex, ez, e.id, st, dmg, t.def.color, byId);

    const to = new THREE.Vector3(ex, 0.7, ez);
    const kind = (t.id === "sniper" || t.id === "pylon" || t.id === "tesla") ? "beam" : t.id === "cannon" ? "shell" : "bolt";
    this.vfx.tracer(from, to, t.def.color, kind, (p, c) => {
      this.vfx.impact(p, c, big || crit);
      if (crit) this.vfx.floatText(new THREE.Vector3(ex, 1.7, ez), "CRIT", 0xffe14a);
      this.audio.impact(big || crit);
    });
  }

  /** Arc lightning from (x,z) to up to st.chain nearby creeps, fading per hop. */
  private chainArc(
    x: number, z: number, fromId: number, st: TdTowerStats, baseDmg: number, color: number,
    byId: Map<number, { id: number; pos: THREE.Vector3; camo: boolean; revealed: boolean; alive: boolean; hp: number; dist: number }>,
  ) {
    const chainTargets: TdTargetable[] = [];
    for (const e of byId.values()) {
      chainTargets.push({ id: e.id, pos: { x: e.pos.x, z: e.pos.z }, dist: e.dist, hp: e.hp, alive: e.alive, targetable: !e.camo || e.revealed });
    }
    const excl = new Set<number>([fromId]);
    let cx = x, cz = z, dmg = baseDmg * st.chainFalloff;
    for (let i = 0; i < st.chain; i++) {
      const nid = nearestCreep(cx, cz, st.chainRange, chainTargets, excl);
      if (nid < 0) break;
      const ne = byId.get(nid);
      if (!ne) break;
      this.creeps.damage(nid, dmg, false);
      this.vfx.tracer(new THREE.Vector3(cx, 0.8, cz), new THREE.Vector3(ne.pos.x, 0.8, ne.pos.z), color, "beam");
      excl.add(nid);
      cx = ne.pos.x; cz = ne.pos.z; dmg *= st.chainFalloff;
    }
  }

  /** Idle + firing life: a build/deploy pop, hovering weapon, counter-rotating
   *  energy rings, a spinning scanner, a pulsing core, recoil/flash, and a laser
   *  sight that locks onto the target. */
  private animateTowers(dt: number) {
    const tt = this._tAnim;
    for (const t of this.towers.values()) {
      // ---- deploy pop: spring up from the pad when built/upgraded ----
      if (t.deploy < 1) {
        t.deploy = Math.min(1, t.deploy + dt / 0.4);
        const e = easeOutBack(t.deploy);
        t.group.scale.setScalar(this.turretScale(t.tier) * e);
        t.group.position.y = this.turretY(t.tier) * (0.4 + 0.6 * t.deploy);
      }
      const charge = this.towerCharge(t);

      // ---- idle motion ----
      if (t.spin) {
        t.spin.rotation.y += dt * (1.0 + t.tier * 0.35);
        t.spin.position.y = 0.6 + Math.sin(tt * 1.6 + t.pad) * 0.08;
      }
      if (t.spin2) t.spin2.rotation.y -= dt * (1.6 + t.tier * 0.4); // counter-rotate
      if (t.scan) t.scan.rotation.y += dt * 2.6;                    // radar sweep
      // hover bob of the whole weapon (plus recoil along its aim axis)
      if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 5);
      t.barrel.position.y = t.barrelY + Math.sin(tt * 2.0 + t.pad) * 0.06;
      t.barrel.position.z = -t.recoil * 0.32;

      // ---- pulsing energy core ----
      if (t.core) {
        const cm = (t.core as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (cm && cm.emissiveIntensity !== undefined) cm.emissiveIntensity = 0.7 + charge * 1.4 + Math.sin(tt * 4 + t.pad) * 0.3;
        t.core.rotation.y += dt * 1.4;
      }

      // ---- muzzle charge + flash ----
      if (t.muzzle) {
        const m = t.muzzle as THREE.Mesh;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (t.flash > 0) t.flash = Math.max(0, t.flash - dt * 6);
        m.scale.setScalar(1 + t.flash * 1.4 + charge * 0.3);
        if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0.6 + charge * 1.3 + t.flash * 2.6 + Math.sin(tt * 3 + t.pad) * 0.2;
      }

      // ---- laser sight beam to the locked target ----
      if (t.sight) {
        if (t.aiming) {
          const fx = t.pos.x, fz = t.pos.z, fy = 1.5;
          const dx = t.aim.x - fx, dz = t.aim.z - fz, dy = t.aim.y - fy;
          const len = Math.hypot(dx, dy, dz) || 0.01;
          t.sight.position.set(fx + dx / 2, fy + dy / 2, fz + dz / 2);
          t.sight.scale.set(1, 1, len);
          t.sight.lookAt(t.aim);
          const sm = t.sight.material as THREE.MeshStandardMaterial;
          // sniper paints a bold beam; others just a faint targeting thread
          sm.opacity = (t.id === "sniper" ? 0.55 : 0.22) + charge * 0.25;
          t.sight.visible = true;
        } else if (t.sight.visible) {
          t.sight.visible = false;
        }
      }
    }
  }

  /** 0..1 charge toward the tower's next shot (drives core/muzzle brightness). */
  private towerCharge(t: Tower): number {
    const interval = 1 / towerStats(t.id, t.tier).fireRate;
    return interval > 0 ? Math.max(0, Math.min(1, 1 - t.cooldown / interval)) : 1;
  }

  // ---- visuals ----
  private updateRing(playerPos: THREE.Vector3) {
    const pad = this.nearestPad(playerPos);
    const t = pad >= 0 ? this.towers.get(pad) : undefined;
    if (t) {
      // standing at an owned tower → show its real range
      const r = towerStats(t.id, t.tier).range;
      this.ring.position.set(t.pos.x, 0.4, t.pos.z);
      this.ring.scale.set(r, r, 1);
      (this.ring.material as THREE.MeshBasicMaterial).color.setHex(t.def.color);
      this.ring.visible = true;
      this.hideGhost();
    } else if (pad >= 0) {
      // standing at an EMPTY pad → build preview: green range ring + a ghost turret
      const p = TD_PADS[pad];
      const r = TD_TOWERS.arrow.range;
      this.ring.position.set(p.x, 0.4, p.z);
      this.ring.scale.set(r, r, 1);
      (this.ring.material as THREE.MeshBasicMaterial).color.setHex(0x9fffb0);
      this.ring.visible = true;
      this.showGhost(p.x, p.z);
    } else {
      this.ring.visible = false;
      this.hideGhost();
    }
  }
  private showGhost(x: number, z: number) {
    if (!this.ghost) {
      this.ghost = new THREE.Group();
      const mat = () => new THREE.MeshStandardMaterial({ color: 0x9fffb0, emissive: 0x4fd06a, emissiveIntensity: 0.5, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, 0.5, 8), mat()); base.position.y = 0.25;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat()); body.position.y = 1.3;
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), mat()); tip.position.y = 2.3;
      this.ghost.add(base, body, tip);
      this.fx.add(this.ghost);
    }
    this.ghost.position.set(x, 0.4 + Math.sin(this._tAnim * 3) * 0.1, z);
    this.ghost.rotation.y = this._tAnim * 0.8;
    this.ghost.visible = true;
  }
  private hideGhost() { if (this.ghost) this.ghost.visible = false; }

  /**
   * A distinct voxel turret model per archetype (the rotating weapon lives in a
   * child group named "barrel" that aims at the target; the pedestal stays put):
   *   arrow  — wooden post + a rotating crossbow with a glowing bolt
   *   frost  — icy plinth ringed by crystals + a spinning frost orb
   *   pylon  — tech pole + a tilted radar dish & glowing scanner lens
   *   cannon — wide stone fort + a fat angled mortar barrel + muzzle ring
   *   sniper — tall watchtower w/ peaked roof + a long scoped rifle
   */
  private makeTurret(id: TdTowerId, tier: number): THREE.Group {
    // Use the baked MagicaVoxel turret model if it's loaded; otherwise fall back
    // to the procedural turret below (offline / asset missing).
    if (hasVoxTurret(id)) {
      const vox = buildVoxTurret(id, TURRET_SCALE, TD_TOWERS[id].color);
      if (vox) { vox.scale.setScalar(this.turretScale(tier)); return vox; }
    }
    const accent = TD_TOWERS[id].color;
    const stone = 0x6b7079, stoneDark = 0x4e535b, wood = 0x6b4a2b, woodDark = 0x4a3320, metal = 0x33363d;
    const g = new THREE.Group();
    const barrel = new THREE.Group(); barrel.name = "barrel";
    const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), voxelMaterial(color));
      m.position.set(x, y, z); m.castShadow = true; return m;
    };
    const glow = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, i = 0.9) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glowMaterial(color, i));
      m.position.set(x, y, z); return m;
    };

    // a few shared shades for the new detailing
    const iron = 0x2b2e34, brass = 0xc89b4a, ice = 0x9fd6f5, iceDeep = 0x6fb0e0, bone = 0x2a2f26;

    if (id === "arrow") {
      // ---- fortified archer turret: stone battlements + a mounted ballista ----
      g.add(box(1.7, 0.45, 1.7, stone, 0, -0.38, 0));                 // stone footing
      // crenellated battlement ring (merlons on the four corners + sides)
      for (const [mx, mz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7], [0, -0.75], [0, 0.75], [-0.75, 0], [0.75, 0]] as const)
        g.add(box(0.34, 0.42, 0.34, stoneDark, mx, 0.05, mz));
      g.add(box(1.15, 0.55, 1.15, stone, 0, -0.05, 0));               // inner rampart deck
      g.add(box(0.7, 0.95, 0.7, wood, 0, 0.45, 0));                   // timber mount post
      g.add(box(0.86, 0.18, 0.86, woodDark, 0, 0.9, 0));              // pivot collar
      // --- ballista weapon (aims) ---
      barrel.add(box(0.3, 0.3, 1.35, wood, 0, 0, 0.4));               // stock rail
      barrel.add(box(0.42, 0.16, 0.42, woodDark, 0, 0.02, -0.15));    // tiller block
      const lL = box(0.16, 0.18, 1.0, woodDark, 0, 0.04, 0.62); lL.rotation.y = 0.6;
      const lR = box(0.16, 0.18, 1.0, woodDark, 0, 0.04, 0.62); lR.rotation.y = -0.6;
      barrel.add(lL, lR);                                             // prod limbs
      barrel.add(glow(0.04, 0.04, 0.95, accent, 0, 0.04, 0.62, 0.6)); // taut bowstring glow
      { const mz = glow(0.16, 0.16, 0.7, accent, 0, 0.04, 1.05, 1.1); mz.name = "muzzle"; barrel.add(mz); } // nocked glowing bolt
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), glowMaterial(accent, 1.0));
      head.rotation.x = Math.PI / 2; head.position.set(0, 0.04, 1.42); barrel.add(head); // arrowhead
      if (tier >= 2) { // a quiver of glowing arrows mounted on the rail
        g.add(box(0.3, 0.6, 0.3, woodDark, 0.62, 0.65, -0.4));
        for (const ax of [-0.08, 0.06, 0.2]) g.add(glow(0.05, 0.55, 0.05, accent, 0.62 + ax, 1.05, -0.4, 0.7));
      }
      if (tier >= 3) { // a heavier repeating cross-prod (second limb set)
        const l2L = box(0.16, 0.16, 0.85, woodDark, 0, -0.24, 0.5); l2L.rotation.y = 0.5;
        const l2R = box(0.16, 0.16, 0.85, woodDark, 0, -0.24, 0.5); l2R.rotation.y = -0.5;
        barrel.add(l2L, l2R, glow(0.13, 0.13, 0.55, accent, 0, -0.24, 0.95, 1.0));
      }
      if (tier >= 4) { // ULTIMATE: big repeating crossbow — magazine + extra bolt rails
        barrel.add(box(0.5, 0.5, 0.45, woodDark, 0, 0.34, 0.0));      // bolt magazine
        for (const bx of [-0.13, 0.13]) barrel.add(glow(0.05, 0.05, 0.6, accent, bx, 0.34, 0.3, 0.9));
        for (const lx of [-1, 1]) {                                   // outer reinforced limbs
          const lo = box(0.18, 0.2, 1.1, brass, 0, -0.02, 0.7); lo.rotation.y = lx * 0.7; barrel.add(lo);
        }
        for (const sx of [-1, 1]) g.add(box(0.22, 1.0, 0.22, stoneDark, sx * 0.62, 0.55, 0.62)); // corner watch-spikes
      }
      barrel.position.y = 1.0;
    } else if (id === "frost") {
      // ---- frozen crystal cannon: an ice spire ringed with icicles ----
      g.add(box(1.6, 0.4, 1.6, stoneDark, 0, -0.4, 0));
      g.add(box(1.05, 0.5, 1.05, iceDeep, 0, -0.05, 0));              // frosted base
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 6), glowMaterial(ice, 0.4));
      spire.position.y = 0.55; spire.castShadow = true; g.add(spire); // central ice spire
      // a ring of jagged icicles around the base
      for (const [cx, cz, s] of [[-0.34, -0.22, 1.0], [0.34, -0.1, 1.4], [0.0, 0.34, 1.15], [-0.2, 0.3, 0.9]] as const) {
        const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), glowMaterial(ice, 0.65));
        cr.scale.set(1, s, 1); cr.position.set(cx, 0.45 + s * 0.25, cz); g.add(cr);
      }
      // --- frozen cannon (aims) ---
      barrel.add(box(0.42, 0.42, 0.7, iceDeep, 0, 0, 0.15));          // crystal breech
      const facet = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 6, 1, true), glowMaterial(ice, 0.55));
      facet.rotation.x = -Math.PI / 2; facet.position.z = 0.62; barrel.add(facet); // faceted muzzle cone
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.3 + (tier - 1) * 0.05, 0), glowMaterial(accent, 1.2));
      orb.position.z = 0.7; orb.name = "muzzle"; barrel.add(orb);     // frozen core charge
      if (tier >= 2) { // a thicker crown of crystals around the spire
        for (const [cx, cz, s] of [[-0.5, 0.1, 1.3], [0.5, 0.2, 1.5], [0.1, -0.48, 1.2], [-0.18, 0.5, 1.4]] as const) {
          const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glowMaterial(ice, 0.7));
          cr.scale.set(1, s, 1); cr.position.set(cx, 0.4 + s * 0.25, cz); g.add(cr);
        }
      }
      if (tier >= 3) { // a frosty halo ring spinning around the muzzle
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 6, 20), glowMaterial(0xc7f0ff, 1.0));
        halo.rotation.x = Math.PI / 2; halo.position.z = 0.65; barrel.add(halo);
      }
      if (tier >= 4) { // ULTIMATE: a towering glacial obelisk + twin frost emitters
        const ob = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.3, 4), glowMaterial(accent, 0.6));
        ob.position.y = 1.5; ob.rotation.y = Math.PI / 4; g.add(ob);  // glacial obelisk
        for (const sx of [-1, 1]) {
          const sub = box(0.22, 0.22, 0.8, iceDeep, sx * 0.34, -0.04, 0.35); barrel.add(sub);
          barrel.add(glow(0.16, 0.16, 0.18, accent, sx * 0.34, -0.04, 0.78, 1.1));
        }
      }
      barrel.position.y = 1.05;
    } else if (id === "pylon") {
      // ---- sci-fi radar/detector array ----
      g.add(box(1.5, 0.4, 1.5, metal, 0, -0.4, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.14, 0.5, 0.14, iron, sx * 0.6, -0.1, sz * 0.6)); // strut feet
      g.add(box(0.5, 1.5, 0.5, iron, 0, 0.5, 0));                     // mast
      for (const yy of [0.2, 0.7, 1.2]) g.add(glow(0.55, 0.06, 0.55, accent, 0, yy, 0, 0.5)); // glowing data bands
      // continuously-spinning radar sweep (independent of aim)
      const scan = new THREE.Group(); scan.name = "scan"; scan.position.y = 1.5;
      scan.add(glow(0.1, 0.04, 1.2, accent, 0, 0, 0.5, 1.0));         // sweep bar
      scan.add(glow(0.18, 0.06, 0.18, accent, 0, 0, 1.05, 1.3));      // sweep beacon
      g.add(scan);
      // --- detector dish (aims) ---
      const dish = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.5, 12, 1, true), glowMaterial(accent, 0.45));
      dish.rotation.x = Math.PI * 0.5 - 0.45; dish.position.set(0, 0.05, 0.34); barrel.add(dish);
      barrel.add(box(0.08, 0.08, 0.4, iron, 0, 0.05, 0.1));           // feed boom
      { const mz = glow(0.24, 0.24, 0.24, accent, 0, 0.12, 0.52, 1.3); mz.name = "muzzle"; barrel.add(mz); } // scanner lens
      barrel.add(box(0.06, 0.6, 0.06, iron, 0, 0.42, -0.05));         // antenna
      barrel.add(glow(0.1, 0.1, 0.1, accent, 0, 0.78, -0.05, 1.0));   // antenna tip
      if (tier >= 2) { // a second smaller dish stacked above
        const d2 = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.32, 10, 1, true), glowMaterial(accent, 0.45));
        d2.rotation.x = Math.PI * 0.5 - 0.45; d2.position.set(0, 0.62, 0.24); barrel.add(d2);
      }
      if (tier >= 3) { // bristling antenna array + blinking tips
        for (const ax of [-0.32, 0.32]) {
          barrel.add(box(0.05, 0.7, 0.05, iron, ax, 0.45, -0.12));
          barrel.add(glow(0.1, 0.1, 0.1, accent, ax, 0.82, -0.12, 1.2));
        }
      }
      if (tier >= 4) { // ULTIMATE: a wide phased-array panel + rotating outer ring frame
        const panel = box(1.05, 0.7, 0.1, iron, 0, 0.1, -0.2); barrel.add(panel);
        for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++)
          barrel.add(glow(0.18, 0.18, 0.06, accent, c * 0.32, 0.1 + r * 0.2, -0.13, 0.9)); // emitter grid
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.05, 6, 22), glowMaterial(accent, 0.9));
        ring.rotation.x = Math.PI / 2; ring.position.y = 1.0; g.add(ring);
      }
      barrel.position.y = 1.3;
    } else if (id === "cannon") {
      // ---- heavy armored howitzer/mortar ----
      g.add(box(1.9, 0.55, 1.9, stone, 0, -0.32, 0));                 // wide footing
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.4, 0.66, 0.4, stoneDark, sx * 0.74, 0.12, sz * 0.74)); // corner bastions
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(glow(0.1, 0.1, 0.1, accent, sx * 0.74, 0.46, sz * 0.74, 0.8)); // corner rivets
      g.add(box(1.1, 0.75, 1.1, stoneDark, 0, 0.28, 0));              // armored turret box
      g.add(box(1.2, 0.16, 1.2, iron, 0, 0.66, 0));                   // top deck plate
      // --- big mortar tube (aims) ---
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 1.4, 12), voxelMaterial(iron));
      tube.rotation.x = Math.PI / 2 - 0.2; tube.position.set(0, 0.22, 0.55); tube.castShadow = true; barrel.add(tube);
      barrel.add(box(0.6, 0.6, 0.5, iron, 0, 0.08, -0.05));           // breech block
      for (const bz of [0.2, 0.55, 0.9]) barrel.add(box(0.78, 0.12, 0.16, metal, 0, 0.22 + bz * 0.12, bz)); // barrel reinforcement bands
      { const mz = glow(0.56, 0.56, 0.24, accent, 0, 0.46, 1.1, 0.8); mz.name = "muzzle"; barrel.add(mz); } // muzzle blast ring
      if (tier >= 2) { // bolted side armor plates
        for (const sx of [-1, 1]) {
          g.add(box(0.22, 0.75, 1.1, iron, sx * 0.64, 0.32, 0));
          for (const bz of [-0.35, 0.35]) g.add(glow(0.09, 0.09, 0.09, accent, sx * 0.66, 0.32, bz, 0.7)); // plate bolts
        }
      }
      if (tier >= 3) { // twin side barrels
        for (const ox of [-0.36, 0.36]) {
          const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.15, 10), voxelMaterial(iron));
          t2.rotation.x = Math.PI / 2 - 0.2; t2.position.set(ox, 0.04, 0.5); t2.castShadow = true; barrel.add(t2);
          barrel.add(glow(0.24, 0.24, 0.16, accent, ox, 0.16, 1.0, 0.7));
        }
      }
      if (tier >= 4) { // ULTIMATE: a third high mortar + shell rack + smoke stacks
        const t3 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.3, 12), voxelMaterial(iron));
        t3.rotation.x = Math.PI / 2 - 0.34; t3.position.set(0, 0.5, 0.45); t3.castShadow = true; barrel.add(t3);
        barrel.add(glow(0.4, 0.4, 0.2, accent, 0, 0.84, 0.98, 0.9));
        for (const sx of [-1, 1]) { // ammo drums on the deck
          g.add(box(0.26, 0.4, 0.26, brass, sx * 0.42, 0.85, -0.45));
          g.add(glow(0.12, 0.12, 0.12, accent, sx * 0.42, 1.08, -0.45, 0.8));
        }
      }
      barrel.position.y = 0.78;
    } else if (id === "sniper") {
      // ---- tall watchtower with a long railgun rifle ----
      g.add(box(1.25, 0.4, 1.25, stone, 0, -0.4, 0));
      g.add(box(0.9, 1.85, 0.9, stoneDark, 0, 0.72, 0));              // tower shaft
      for (const yy of [0.1, 0.7, 1.3]) g.add(box(0.96, 0.1, 0.96, stone, 0, yy, 0)); // course lines
      g.add(box(1.15, 0.32, 1.15, wood, 0, 1.7, 0));                  // lookout platform
      for (const [mx, mz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const)
        g.add(box(0.2, 0.3, 0.2, stoneDark, mx, 1.95, mz));          // platform merlons
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.85, 4), voxelMaterial(accent));
      roof.position.y = 2.35; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
      g.add(glow(0.12, 0.12, 0.12, accent, 0, 2.85, 0, 1.1));         // roof finial
      // --- long railgun rifle (aims) ---
      const barrelLen = 1.95 + (tier - 1) * 0.45;
      barrel.add(box(0.16, 0.16, barrelLen, iron, 0, 0, barrelLen / 2 - 0.2)); // barrel
      barrel.add(box(0.34, 0.22, 0.5, stoneDark, 0, -0.02, -0.05));   // receiver body
      barrel.add(box(0.24, 0.26, 0.46, iron, 0, 0.2, 0.05));          // scope housing
      { const sc = glow(0.1, 0.1, 0.1, accent, 0, 0.2, 0.28, 1.1); barrel.add(sc); } // scope lens
      { const mz = glow(0.14, 0.14, 0.24, accent, 0, 0, barrelLen - 0.25, 1.3); mz.name = "muzzle"; barrel.add(mz); }
      if (tier >= 2) { // a banner hung from the lookout
        const banner = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.08), glowMaterial(accent, 0.4));
        banner.position.set(0, 0.85, 0.5); g.add(banner);
      }
      if (tier >= 3) { // a steadying bipod under the long barrel
        for (const sx of [-1, 1]) { const leg = box(0.06, 0.75, 0.06, iron, sx * 0.2, -0.38, 0.95); leg.rotation.z = sx * 0.32; barrel.add(leg); }
      }
      if (tier >= 4) { // ULTIMATE: energy coils + heavier muzzle brake on a huge barrel
        for (const cz of [0.5, 0.9, 1.3, 1.7]) {
          const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 14), glowMaterial(accent, 1.0));
          coil.position.z = cz; barrel.add(coil);
        }
        barrel.add(box(0.3, 0.3, 0.4, iron, 0, 0, barrelLen - 0.1));  // muzzle brake
        for (const sx of [-1, 1]) barrel.add(glow(0.06, 0.06, 0.3, accent, sx * 0.16, 0, barrelLen - 0.1, 1.1));
      }
      barrel.position.y = 1.65;
    } else if (id === "tesla") {
      // ---- Tesla coil: insulator column, copper coils, crackling toroid ----
      g.add(box(1.45, 0.4, 1.45, metal, 0, -0.4, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.18, 0.4, 0.18, iron, sx * 0.55, -0.1, sz * 0.55)); // grounding posts
      // stacked ceramic insulator discs
      for (let i = 0; i < 3; i++) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - i * 0.04, 0.46 - i * 0.04, 0.18, 8), voxelMaterial(0xd9d2c4));
        disc.position.y = -0.05 + i * 0.22; g.add(disc);
      }
      g.add(box(0.34, 0.9, 0.34, iron, 0, 0.65, 0));                  // central core rod
      // stacked copper coil rings winding up the column
      const coils = 3 + (tier >= 2 ? 1 : 0) + (tier >= 4 ? 1 : 0);
      for (let i = 0; i < coils; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34 - i * 0.035, 0.06, 6, 16), glowMaterial(brass, 0.55));
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.55 + i * 0.18; g.add(ring);
      }
      // the crackling toroid ball cap
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32 + (tier - 1) * 0.05, 12, 8), glowMaterial(accent, 1.1));
      ball.position.y = 1.55; g.add(ball);
      const cap = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 6, 16), glowMaterial(accent, 1.0));
      cap.rotation.x = Math.PI / 2; cap.position.y = 1.4; g.add(cap); // toroid ring
      // --- aiming emitter prong (barrel) ---
      barrel.add(box(0.14, 0.14, 0.75, iron, 0, 0, 0.38));
      barrel.add(box(0.24, 0.24, 0.2, 0xd9d2c4, 0, 0, -0.02));        // insulator base
      { const mz = glow(0.24, 0.24, 0.24, accent, 0, 0, 0.78, 1.4); mz.name = "muzzle"; barrel.add(mz); }
      if (tier >= 3) for (const ax of [-0.22, 0.22]) barrel.add(glow(0.08, 0.08, 0.55, accent, ax, 0, 0.6, 1.1)); // side arcs
      if (tier >= 4) { // ULTIMATE: arcing prongs splayed around the emitter
        for (const a of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
          const px = Math.cos(a) * 0.3, py = Math.sin(a) * 0.3;
          const prong = box(0.07, 0.07, 0.6, iron, px, py, 0.4); prong.lookAt(px * 2, py * 2, 1.2); barrel.add(prong);
          barrel.add(glow(0.13, 0.13, 0.13, accent, px * 1.3, py * 1.3, 0.82, 1.2));
        }
      }
      barrel.position.y = 1.05;
    } else { // venom
      // ---- alchemist's cauldron / spire of bubbling toxin ----
      g.add(box(1.6, 0.4, 1.6, stoneDark, 0, -0.4, 0));
      g.add(box(1.0, 0.5, 1.0, 0x3a2f23, 0, -0.05, 0));              // dark plinth
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.16, 0.55, 0.16, bone, sx * 0.42, 0.1, sz * 0.42)); // cauldron legs
      // the cauldron brimming with bubbling toxin
      const cauldron = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.55, 12), voxelMaterial(bone));
      cauldron.position.y = 0.45; cauldron.castShadow = true; g.add(cauldron);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 14), voxelMaterial(0x4a4036));
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.72; g.add(rim);
      const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.14, 12), glowMaterial(accent, 1.0));
      brew.position.y = 0.7; g.add(brew);                            // toxic surface
      for (const [bx, bz, s] of [[-0.16, 0.1, 1], [0.2, -0.06, 1.3], [0.0, 0.22, 0.8], [0.1, -0.2, 1.1]] as const) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.08 * s, 6, 6), glowMaterial(accent, 0.9));
        b.position.set(bx, 0.82, bz); g.add(b);                      // rising bubbles
      }
      // --- aiming nozzle (barrel) that spits venom globs ---
      barrel.add(box(0.2, 0.2, 0.6, bone, 0, 0, 0.3));
      barrel.add(box(0.3, 0.3, 0.24, 0x4a4036, 0, 0, -0.02));        // valve block
      { const mz = glow(0.26, 0.26, 0.26, accent, 0, 0, 0.62, 1.2); mz.name = "muzzle"; barrel.add(mz); }
      const drip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 5), glowMaterial(accent, 1.0));
      drip.rotation.x = Math.PI; drip.position.z = 0.6; drip.position.y = -0.12; barrel.add(drip); // dripping toxin
      if (tier >= 2) for (const [bx, bz] of [[-0.46, 0.18], [0.46, 0.24]] as const) { // spore pods
        const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), glowMaterial(accent, 0.7));
        sp.position.set(bx, 0.62, bz); g.add(sp);
      }
      if (tier >= 3) { // a toxic vapor halo
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 18), glowMaterial(accent, 0.8));
        halo.rotation.x = Math.PI / 2; halo.position.y = 1.0; g.add(halo);
      }
      if (tier >= 4) { // ULTIMATE: alchemist spire of vials + extra spitting nozzles
        const spire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.1, 6), glowMaterial(accent, 0.55));
        spire.position.y = 1.5; g.add(spire);                        // toxin spire
        for (const sx of [-1, 1]) {                                  // glass vials of brew
          g.add(box(0.18, 0.5, 0.18, 0x4a4036, sx * 0.62, 0.55, -0.5));
          g.add(glow(0.12, 0.34, 0.12, accent, sx * 0.62, 0.55, -0.5, 0.9));
        }
        for (const sx of [-1, 1]) { // secondary aiming nozzles
          barrel.add(box(0.13, 0.13, 0.5, bone, sx * 0.26, 0, 0.28));
          barrel.add(glow(0.18, 0.18, 0.18, accent, sx * 0.26, 0, 0.55, 1.0));
        }
      }
      barrel.position.y = 0.98;
    }

    g.add(barrel);

    // ---- shared flourishes (life + an upgrade tell) ----
    // a glowing rune ring grounding the turret (matches the build pads)
    const rune = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 6, 24), glowMaterial(accent, 0.5));
    rune.rotation.x = Math.PI / 2; rune.position.y = -0.18;
    g.add(rune);
    // orbiting energy shards — MORE + faster per tier (so upgrades read at a glance)
    const spin = new THREE.Group(); spin.name = "spin"; spin.position.y = 0.6;
    const shards = 2 + tier; // 3 / 4 / 5
    for (let k = 0; k < shards; k++) {
      const a = (k / shards) * Math.PI * 2;
      const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.1 + tier * 0.02, 0), glowMaterial(accent, 1.0));
      sh.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0);
      spin.add(sh);
    }
    g.add(spin);
    // an inner counter-rotating ring (tighter, glows brighter) for extra life
    const spin2 = new THREE.Group(); spin2.name = "spin2"; spin2.position.y = 0.9;
    const inner = 2 + tier;
    for (let k = 0; k < inner; k++) {
      const a = (k / inner) * Math.PI * 2 + 0.5;
      const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), glowMaterial(0xffffff, 1.2));
      sh.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
      spin2.add(sh);
    }
    g.add(spin2);
    // a pulsing energy CORE floating in the turret body
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glowMaterial(accent, 1.0));
    core.name = "core"; core.position.y = 0.55; core.scale.y = 1.4;
    g.add(core);
    // tier crown: a floating gem above tier-2/3 turrets
    if (tier >= 2) {
      const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 + (tier - 2) * 0.08, 0), glowMaterial(0xfff2c0, 1.3));
      crown.position.y = (id === "sniper" ? 2.7 : id === "pylon" ? 2.1 : 1.7);
      g.add(crown);
    }

    g.scale.setScalar(this.turretScale(tier));
    return g;
  }

  /** Overall turret scale at a tier (base size + a small per-tier bump). */
  private turretScale(tier: number): number {
    return TURRET_SCALE * (1 + (tier - 1) * 0.1);
  }
  /** Y to seat a turret so its base rests on the pad at the given tier. */
  private turretY(tier: number): number {
    return 0.6 * this.turretScale(tier);
  }

  private disposeGroup(g: THREE.Object3D) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) for (const x of mat) x.dispose();
      else (mat as THREE.Material | undefined)?.dispose?.();
    });
  }

  // ---- HUD ----
  private buildHud() {
    if (this.ui) return;
    // Wire the HUD buttons to the controller so TOUCH players (no keyboard) can
    // build/upgrade/sell/retarget by tapping. Desktop keeps the 1-7/E/X/T keys
    // too — both routes act on the pad the engineer is standing at (_curPad).
    this.ui = new TdHud(document.getElementById("ui") ?? document.body, {
      onBuild: (_t, i) => {
        const id = TD_TOWER_IDS[i];
        if (id && this._curPad >= 0 && !this.towers.has(this._curPad)) this.build(this._curPad, id);
      },
      onUpgrade: () => { if (this._curPad >= 0) this.upgrade(this._curPad); },
      onSell: () => { if (this._curPad >= 0) this.sell(this._curPad); },
      onTarget: () => { if (this._curPad >= 0) this.cycleTarget(this._curPad); },
      onCall: () => this.startNextWave(),
      onLeave: () => this.onLeave?.(),
    });
    this.ui.setTowers(TD_TOWER_IDS.map((id, i) => ({
      name: TD_TOWERS[id].name, cost: TD_TOWERS[id].cost, key: String(i + 1),
      color: TD_TOWERS[id].color, ability: TD_TOWERS[id].ability,
    })));
    this.refreshHud();
  }
  /** Build the per-frame HUD state snapshot. */
  private hudState(): TdHudState {
    if (this.mode === "duel" && this.duel) {
      const d = this.duel;
      return {
        mode: "duel", gold: Math.floor(d.playerGold), wave: this.wave || d.wave,
        betweenWaves: this.betweenWaves, earlyCallBonus: this.earlyCallBonus(),
        playerHp: d.playerHp, botHp: d.botHp, income: Math.round(d.playerIncome),
        over: this.result.over, win: this.result.win,
      };
    }
    return {
      mode: "solo", gold: Math.floor(this.soloGold), wave: this.wave,
      totalWaves: this.opts.endless ? undefined : TD_TOTAL_WAVES, // endless shows a bare wave count
      betweenWaves: this.betweenWaves, earlyCallBonus: this.earlyCallBonus(), lives: this.soloLives,
      over: this.result.over, win: this.result.win,
      combo: this.combo, comboMult: this.comboMult(), score: this.score,
    };
  }
  private refreshHud() {
    this.ui?.update(this.hudState());
  }
  /** Drive the bottom panel: show an owned tower's upgrade/sell/target info when
   *  the engineer stands at it, else the build palette. Called from tick. */
  private updateTowerPanel(playerPos: THREE.Vector3) {
    if (!this.ui) return;
    const pad = this.nearestPad(playerPos);
    const t = pad >= 0 ? this.towers.get(pad) : undefined;
    if (t) {
      this.ui.showTowerPanel({
        name: t.def.name, tier: t.tier, maxTier: TD_MAX_TIER, target: t.target,
        upgradeCost: tdUpgradeCost(t.id, t.tier), sellValue: tdSellValue(t.id, t.tier),
        ability: t.def.ability, abilityUnlocked: t.tier >= TD_MAX_TIER,
      });
    } else {
      this.ui.showTowerPanel(null);
    }
  }
}
