import * as THREE from "three";
import { BedWarsMap, type BwTeamId } from "./bwmap";
import { makeGenerator, tickGenerator, upgradeGenerator, emptyWallet, addToWallet, type BwGenerator, type BwResource, type BwWallet } from "./bwresources";
import { createMatch, breakBed, killPlayer, respawnPlayer, isTeamOut, aliveTeams, type BwMatch } from "./bwteams";
import { BwBots, RAIDER_REACH } from "./bwbots";
import { BwGolems } from "./bwgolem";
import { BwDragons } from "./bwdragon";
import { BwBlocks, bwBlockMat } from "./bwblocks";
import { BwShopUI } from "./bwshopui";
import { BwUpgradeUI } from "./bwupgradeui";
import { bwBuy, bwCanAfford, type BwShopItem } from "./bwshop";
import {
  bwInitUpgrades, bwBuyUpgrade, bwUpgradeCost, bwDamageMul, bwDamageReduction, bwFireRateMul,
  bwForgeMul, bwHealPoolRate, bwDragonBonus, bwInitTraps, bwQueueTrap, bwPopTrap, bwNextTrapCost,
  type BwUpgradeId, type BwUpgradeState, type BwTrapId, type BwTrapQueue,
} from "./bwupgrades";
import { glowMaterial } from "../palette";
import { VoxelChar } from "../voxelChar";

interface Bed { team: BwTeamId; pos: THREE.Vector3; color: number; hp: number; max: number; dead: boolean; group: THREE.Group }
interface Guardian { team: BwTeamId; playerId: number; char: VoxelChar; pos: THREE.Vector3; hp: number; max: number; alive: boolean; respawn: number; flash: number }
/** A resource node you must walk to (diamond at mid, emerald at centre). Drops
 *  pile up while un-collected, then sweep into your wallet when you stand near. */
interface GemGen { kind: BwResource; gen: BwGenerator; pos: THREE.Vector3; sitting: number; mesh: THREE.Mesh }

const WAVE_START = 7;
const WAVE_MIN = 2.4;
const WAVE_RAMP = 0.985;
const MAX_RAIDERS = 10;
const BED_HP = 120;

const PLAYER_HP = 100;
const PLAYER_RESPAWN = 5;
const RAIDER_DPS = 11;
const RAIDER_TOUCH = 1.7;

const GUARD_HP = 70;
const GUARD_RESPAWN = 4;
const GUARD_HIT_R = 1.3;

const BASE_RADIUS = 6;     // "near your base" for heal-pool + trap triggers
const GEM_COLLECT_R = 3;   // walk this close to sweep a gem pile into your wallet
const TRAP_COOLDOWN = 6;   // min seconds between trap triggers
const SUDDEN_DEATH = 210;  // seconds → beds auto-break + dragons descend
const DRAGON_DMG_MUL = 1;

/**
 * Bed Wars-lite controller (solo vs bots) — a faithful port of the Hypixel
 * feature set adapted to our engine. Owns the world, beds (HP), raider waves, an
 * enemy guardian per team, FOUR resources (iron/gold at base, diamond at the
 * mids, emerald at centre) with a Forge multiplier, the item shop + a diamond
 * Team-Upgrades shop (sharpness / protection / haste / forge / heal-pool /
 * dragon-buff) with a trap queue, summonable Dream-Defender golems, your health
 * + respawn, a sudden-death dragon phase, and the win loop.
 */
export class BedWarsMode {
  private map: BedWarsMap;
  private match: BwMatch;
  private beds = new Map<BwTeamId, Bed>();
  private guards: Guardian[] = [];
  private bots: BwBots;
  private golems: BwGolems;
  private dragons: BwDragons;
  private blocks: BwBlocks;
  private gens: { team: BwTeamId; gen: BwGenerator }[] = [];
  private gems: GemGen[] = [];
  private gemGroup = new THREE.Group();
  wallet: BwWallet = emptyWallet();
  readonly playerTeam: BwTeamId = "red";
  private readonly playerId = 1;
  private active = false;
  private hud?: HTMLElement;
  private leaveBtn?: HTMLElement; // on-screen "✕ Leave" (mobile soft-lock fix)
  private shop?: BwShopUI;
  private upgUI?: BwUpgradeUI;
  private waveTimer = WAVE_START;
  private waveInterval = WAVE_START;

  // ---- team upgrades + traps ----
  private upgrades: BwUpgradeState = bwInitUpgrades();
  private traps: BwTrapQueue = bwInitTraps();
  private trapCd = 0;       // cooldown gate so a single raid pops one trap
  private speedBuff = 0;    // Counter-Offensive trap / speed potion → move-speed boost

  // ---- permanent gear bought at the item shop ----
  private meleeMul = 1;        // Sword tier → bullet damage multiplier
  private armorReduction = 0;  // Armor tier → incoming damage reduction (0..0.6)
  private rangedMul = 1;       // Bow/Crossbow tier → fire-rate multiplier

  // ---- your life ----
  playerHp = PLAYER_HP;
  readonly playerMax = PLAYER_HP;
  respawnTimer = 0;
  private respawnReady = false;

  // ---- match clock + the wiki's timed "Game Progression" events ----
  private elapsed = 0;
  private suddenDeath = false;
  private bedDestruction = false;
  private events: { t: number; label: string; fire: () => void }[] = [];
  private eventIdx = 0;
  private announce: string[] = []; // drained by main → on-screen toasts

  result: { over: boolean; win: boolean } = { over: false, win: false };

  /** Optional leave hook — fired by the on-screen "✕ Leave" button so touch
   *  players (no Escape key) can quit. main passes its leaveBedWars(). */
  onLeave?: () => void;

  constructor(scene: THREE.Scene, onLeave?: () => void) {
    this.onLeave = onLeave;
    this.map = new BedWarsMap(scene);
    this.match = createMatch([]);
    this.bots = new BwBots(scene);
    this.golems = new BwGolems(scene);
    this.dragons = new BwDragons(scene);
    this.blocks = new BwBlocks(scene);
    scene.add(this.gemGroup);
  }

  spawn(): THREE.Vector3 {
    const t = this.map.teams.find((x) => x.id === this.playerTeam) ?? this.map.teams[0];
    return t.base.clone();
  }
  shopSpot(): THREE.Vector3 { return this.spawn(); }
  get shopOpen(): boolean { return !!this.shop?.isOpen; }
  get upgradesOpen(): boolean { return !!this.upgUI?.isOpen; }
  get anyMenuOpen(): boolean { return this.shopOpen || this.upgradesOpen; }
  get playerWaiting(): boolean { return this.respawnTimer > 0; }
  consumeRespawn(): boolean { const r = this.respawnReady; this.respawnReady = false; return r; }

  /** Fire-rate multiplier from Maniac Miner (haste) — main applies it on fire. */
  fireRateMul(): number { return bwFireRateMul(this.upgrades) * this.rangedMul; }
  /** Combined incoming-damage reduction: best of armor gear and Protection. */
  private incomingReduction(): number { return Math.max(this.armorReduction, bwDamageReduction(this.upgrades)); }
  /** Move-speed multiplier (Counter-Offensive trap buff while it lasts). */
  playerSpeedMul(): number { return this.speedBuff > 0 ? 1.4 : 1; }
  /** Seconds until sudden death (0 once it's begun) — for the HUD clock. */
  get timeToSuddenDeath(): number { return Math.max(0, SUDDEN_DEATH - this.elapsed); }

  clamp(pos: THREE.Vector3) {
    const max = 33;
    pos.x = Math.max(-max, Math.min(max, pos.x));
    pos.z = Math.max(-max, Math.min(max, pos.z));
    pos.y = 0;
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.result = { over: false, win: false };
    this.map.setVisible(true);
    this.beds.clear();
    for (const t of this.map.teams) {
      const group = this.map.makeBed(t.color);
      group.position.copy(t.bed);
      this.map.group.add(group);
      this.beds.set(t.id, { team: t.id, pos: t.bed.clone(), color: t.color, hp: BED_HP, max: BED_HP, dead: false, group });
    }
    this.gens = this.map.teams.map((t) => ({ team: t.id, gen: makeGenerator(`${t.id}-iron`, "iron") }));
    this.gens.push({ team: this.playerTeam, gen: makeGenerator(`${this.playerTeam}-gold`, "gold") });
    this.buildGemGens();
    this.match = createMatch(this.map.teams.map((t, i) => ({ id: i + 1, team: t.id, bot: t.id !== this.playerTeam })));
    this.spawnGuardians();
    this.blocks.clear();
    // raiders must break any wall you've stacked between them and your bed.
    const myBedPos = this.beds.get(this.playerTeam)!.pos;
    this.bots.setObstacleProvider((pos) => this.blocks.obstacle(pos, myBedPos, RAIDER_REACH));
    this.wallet = emptyWallet();
    this.upgrades = bwInitUpgrades();
    this.traps = bwInitTraps();
    this.trapCd = 0;
    this.speedBuff = 0;
    this.meleeMul = 1;
    this.armorReduction = 0;
    this.rangedMul = 1;
    this.elapsed = 0;
    this.suddenDeath = false;
    this.bedDestruction = false;
    this.events = this.buildEvents();
    this.eventIdx = 0;
    this.announce = [];
    this.waveInterval = WAVE_START;
    this.waveTimer = WAVE_START;
    this.playerHp = PLAYER_HP;
    this.respawnTimer = 0;
    this.respawnReady = false;
    const uiRoot = document.getElementById("ui") ?? document.body;
    if (!this.shop) this.shop = new BwShopUI(uiRoot);
    if (!this.upgUI) this.upgUI = new BwUpgradeUI(uiRoot);
    this.buildHud();
  }

  leave() {
    if (!this.active) return;
    this.active = false;
    this.map.setVisible(false);
    for (const b of this.beds.values()) this.map.group.remove(b.group);
    this.beds.clear();
    for (const g of this.guards) this.disposeGuardian(g);
    this.guards.length = 0;
    this.clearGems();
    this.bots.clear();
    this.golems.clear();
    this.dragons.clear();
    this.blocks.clear();
    this.shop?.close();
    this.upgUI?.close();
    this.hud?.remove();
    this.hud = undefined;
    this.leaveBtn?.remove();
    this.leaveBtn = undefined;
  }

  // ── diamond / emerald gem generators (walk-to-collect) ─────────────────────
  private buildGemGens() {
    this.clearGems();
    // Diamonds sit on the four MID islands (between team bases); emeralds on the
    // big centre platform. Derive the mid radius from the team-island offset so
    // gems land ON the islands, not in the void gaps. (wiki 4-team layout:
    // 4 diamond generators + 2 emerald generators.)
    const R = Math.abs(this.map.teams[0]?.base.x ?? 22);
    const c = this.map.center;
    const spots: { kind: BwResource; pos: THREE.Vector3 }[] = [
      { kind: "diamond", pos: new THREE.Vector3(R, 0, 0) },
      { kind: "diamond", pos: new THREE.Vector3(-R, 0, 0) },
      { kind: "diamond", pos: new THREE.Vector3(0, 0, R) },
      { kind: "diamond", pos: new THREE.Vector3(0, 0, -R) },
      { kind: "emerald", pos: new THREE.Vector3(c.x - 4.5, 0, c.z) },
      { kind: "emerald", pos: new THREE.Vector3(c.x + 4.5, 0, c.z) },
    ];
    for (const s of spots) {
      const mesh = this.makeGemMesh(s.kind);
      mesh.position.copy(s.pos).setY(1.6);
      this.gemGroup.add(mesh);
      this.gems.push({ kind: s.kind, gen: makeGenerator(`${s.kind}-${s.pos.x}-${s.pos.z}`, s.kind), pos: s.pos.clone(), sitting: 0, mesh });
    }
    this.gemGroup.visible = true;
  }
  private makeGemMesh(kind: BwResource): THREE.Mesh {
    const col = kind === "diamond" ? 0x8fe6ff : 0x6bff9e;
    const geo = new THREE.OctahedronGeometry(0.45);
    const mesh = new THREE.Mesh(geo, glowMaterial(col, 0.7));
    mesh.castShadow = false;
    return mesh;
  }
  private clearGems() {
    for (const g of this.gems) {
      this.gemGroup.remove(g.mesh);
      g.mesh.geometry.dispose();
      (g.mesh.material as THREE.Material).dispose();
    }
    this.gems.length = 0;
  }

  // ── enemy guardians ────────────────────────────────────────────────────────
  private spawnGuardians() {
    this.guards = [];
    for (const t of this.map.teams) {
      if (t.id === this.playerTeam) continue;
      const playerId = this.map.teams.findIndex((x) => x.id === t.id) + 1;
      const pos = t.base.clone().add(this.map.center.clone().sub(t.base).normalize().multiplyScalar(1.4));
      pos.y = 0;
      this.guards.push({ team: t.id, playerId, char: this.makeGuardianChar(t.color, pos), pos, hp: GUARD_HP, max: GUARD_HP, alive: true, respawn: 0, flash: 0 });
    }
  }
  private makeGuardianChar(color: number, pos: THREE.Vector3): VoxelChar {
    const char = new VoxelChar({ body: color, head: 0xf2c9a0, eye: 0x222222 });
    char.setColor(color, 0xf2c9a0);
    char.play("idle");
    char.root.position.copy(pos);
    char.root.rotation.y = Math.atan2(this.map.center.x - pos.x, this.map.center.z - pos.z);
    this.map.group.add(char.root);
    return char;
  }
  private disposeGuardian(g: Guardian) {
    this.map.group.remove(g.char.root);
    g.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat?.dispose?.();
    });
  }

  private enemyBeds(): Bed[] {
    return [...this.beds.values()].filter((b) => b.team !== this.playerTeam && !b.dead);
  }

  /** A bullet impacted at `pos`. Sharpness scales the damage. Priority:
   *  raiders → enemy guardian → enemy bed. */
  resolveHit(pos: THREE.Vector3, dmg: number): "bot" | "guard" | "bed" | null {
    const d = dmg * bwDamageMul(this.upgrades) * this.meleeMul;
    for (const r of this.bots.positions()) {
      const dx = r.pos.x - pos.x, dz = r.pos.z - pos.z;
      if (dx * dx + dz * dz < 0.9 * 0.9) { this.bots.damageNear(pos, 0.9, d); return "bot"; }
    }
    for (const g of this.guards) {
      if (!g.alive) continue;
      const dx = g.pos.x - pos.x, dz = g.pos.z - pos.z;
      if (dx * dx + dz * dz < GUARD_HIT_R * GUARD_HIT_R) { this.damageGuardian(g, d); return "guard"; }
    }
    for (const b of this.enemyBeds()) {
      const dx = b.pos.x - pos.x, dz = b.pos.z - pos.z;
      if (dx * dx + dz * dz < 1.7 * 1.7) { this.damageBed(b.team, d); return "bed"; }
    }
    return null;
  }

  private damageGuardian(g: Guardian, dmg: number) {
    if (!g.alive) return;
    g.hp -= dmg;
    g.flash = 0.12;
    g.char.setHitFlash(1);
    if (g.hp <= 0) {
      g.alive = false;
      this.map.group.remove(g.char.root);
      const r = killPlayer(this.match, g.playerId);
      if (r === "respawn") g.respawn = GUARD_RESPAWN;
      this.checkEnd();
    }
  }

  private damageBed(team: BwTeamId, dmg: number) {
    const b = this.beds.get(team);
    if (!b || b.dead) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.dead = true;
      this.map.group.remove(b.group);
      breakBed(this.match, team);
      this.checkEnd();
    }
  }

  private damageMyBed(dmg: number) {
    const b = this.beds.get(this.playerTeam);
    if (!b || b.dead) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.dead = true;
      this.map.group.remove(b.group);
      breakBed(this.match, this.playerTeam);
      this.checkEnd();
    }
  }

  private checkEnd() {
    if (this.result.over) return;
    if (isTeamOut(this.match, this.playerTeam)) { this.result = { over: true, win: false }; return; }
    const alive = aliveTeams(this.match);
    if (alive.length === 1 && alive[0] === this.playerTeam) this.result = { over: true, win: true };
  }

  tick(dt: number, playerPos?: THREE.Vector3) {
    if (!this.active || this.result.over) return;
    this.map.update(dt);
    this.elapsed += dt;
    if (this.speedBuff > 0) this.speedBuff -= dt;
    if (this.trapCd > 0) this.trapCd -= dt;

    // ── resources ──
    const forge = bwForgeMul(this.upgrades);
    for (const g of this.gens) {
      // your base iron/gold pour faster with each Forge tier.
      const scaled = g.team === this.playerTeam ? dt * forge : dt;
      const drops = tickGenerator(g.gen, scaled, 0);
      if (g.team === this.playerTeam) for (const d of drops) this.wallet = addToWallet(this.wallet, d.kind, d.amount);
    }
    this.updateGems(dt, playerPos);

    this.bots.update(dt);
    this.blocks.update(dt);
    this.updateGuardians(dt);
    this.updateGolems(dt);

    // ── raider waves at the player bed ──
    this.waveTimer -= dt;
    const myBed = this.beds.get(this.playerTeam);
    if (this.waveTimer <= 0 && myBed && !myBed.dead && this.bots.count < MAX_RAIDERS) {
      this.waveTimer = this.waveInterval;
      this.waveInterval = Math.max(WAVE_MIN, this.waveInterval * WAVE_RAMP);
      const foes = this.enemyBeds();
      if (foes.length) {
        const foe = foes[Math.floor(Math.random() * foes.length)];
        const target = { pos: myBed.pos, alive: () => !myBed.dead, onHit: (d: number) => this.damageMyBed(d) };
        const from = foe.pos.clone().multiplyScalar(1.15);
        this.bots.spawn(this.beds.get(foe.team)!.color, from, target);
      }
    }

    this.maybeTriggerTrap();
    this.processEvents();
    this.updateDragons(dt, playerPos);
    this.updatePlayerLife(dt, playerPos);
    this.refreshHud();
  }

  private updateGems(dt: number, playerPos?: THREE.Vector3) {
    for (const g of this.gems) {
      const drops = tickGenerator(g.gen, dt, g.sitting);
      for (const d of drops) g.sitting += d.amount;
      // spin + bob the gem; scale a touch with the un-collected pile
      g.mesh.rotation.y += dt * 1.4;
      g.mesh.position.y = 1.6 + Math.sin(this.elapsed * 2 + g.pos.x) * 0.12;
      const s = 1 + Math.min(0.6, g.sitting * 0.06);
      g.mesh.scale.setScalar(s);
      if (playerPos && g.sitting > 0) {
        const dx = g.pos.x - playerPos.x, dz = g.pos.z - playerPos.z;
        if (dx * dx + dz * dz < GEM_COLLECT_R * GEM_COLLECT_R) {
          this.wallet = addToWallet(this.wallet, g.kind, g.sitting);
          g.sitting = 0;
        }
      }
    }
  }

  private updateGuardians(dt: number) {
    for (const g of this.guards) {
      if (g.alive) {
        if (g.flash > 0) { g.flash -= dt; g.char.setHitFlash(Math.max(0, g.flash / 0.12)); }
        g.char.update(dt);
        continue;
      }
      if (g.respawn > 0) {
        g.respawn -= dt;
        if (g.respawn <= 0) {
          g.hp = g.max; g.alive = true; g.flash = 0;
          g.char.setHitFlash(0);
          this.map.group.add(g.char.root);
          respawnPlayer(this.match, g.playerId);
        }
      }
    }
  }

  /** Dream Defender golems fight raiders near your base; apply their swings. */
  private updateGolems(dt: number) {
    const raiders = this.bots.positions().map((r) => ({ pos: r.pos }));
    const hits = this.golems.update(dt, raiders);
    for (const h of hits) this.bots.damageNear(h.pos, 0.9, h.dmg);
  }

  // ── traps: pop one when a raider breaches your base ──
  private maybeTriggerTrap() {
    if (this.trapCd > 0 || this.traps.slots.length === 0) return;
    const base = this.beds.get(this.playerTeam)?.pos ?? this.spawn();
    let breach = false;
    for (const r of this.bots.positions()) {
      const dx = r.pos.x - base.x, dz = r.pos.z - base.z;
      if (dx * dx + dz * dz < BASE_RADIUS * BASE_RADIUS) { breach = true; break; }
    }
    if (!breach) return;
    const { trap, queue } = bwPopTrap(this.traps);
    this.traps = queue;
    this.trapCd = TRAP_COOLDOWN;
    if (trap) this.applyTrap(trap, base);
  }
  private applyTrap(trap: BwTrapId, base: THREE.Vector3) {
    if (trap === "itsatrap") {
      // blind + snare intruders → a punishing AoE on the raiders at your base
      this.bots.damageNear(base, BASE_RADIUS, 22);
    } else if (trap === "minerfatigue") {
      this.bots.damageNear(base, BASE_RADIUS, 12);
    } else if (trap === "counter") {
      // Counter-Offensive: heal + speed for the defender
      this.playerHp = Math.min(this.playerMax, this.playerHp + 40);
      this.speedBuff = 6;
    } // "alarm" just reveals/warns — surfaced via the HUD trap pips
    this.flashTrapHud(trap);
  }

  // ── the wiki's timed Game Progression: generators ramp, then Bed
  //    Destruction, then Sudden Death dragons. Compressed for a quick match. ──
  private buildEvents(): { t: number; label: string; fire: () => void }[] {
    return [
      { t: 45,  label: "💎 Diamond Generator II",  fire: () => this.tierUpGems("diamond") },
      { t: 90,  label: "✦ Emerald Generator II",   fire: () => this.tierUpGems("emerald") },
      { t: 135, label: "💎 Diamond Generator III", fire: () => this.tierUpGems("diamond") },
      { t: 180, label: "✦ Emerald Generator III",  fire: () => this.tierUpGems("emerald") },
      { t: SUDDEN_DEATH - 45, label: "🛏 BED DESTRUCTION — every bed is gone!", fire: () => this.destroyAllBeds() },
      { t: SUDDEN_DEATH,      label: "🐉 SUDDEN DEATH — dragons incoming!",     fire: () => this.startSuddenDeath() },
    ];
  }
  private processEvents() {
    while (this.eventIdx < this.events.length && this.elapsed >= this.events[this.eventIdx].t) {
      const ev = this.events[this.eventIdx++];
      ev.fire();
      this.announce.push(ev.label);
    }
  }
  /** Drain queued event callouts so main can toast them. */
  drainAnnouncements(): string[] {
    if (this.announce.length === 0) return [];
    const out = this.announce;
    this.announce = [];
    return out;
  }
  private tierUpGems(kind: BwResource) {
    for (const g of this.gems) if (g.kind === kind) upgradeGenerator(g.gen);
  }
  private destroyAllBeds() {
    if (this.bedDestruction) return;
    this.bedDestruction = true;
    for (const b of this.beds.values()) {
      if (!b.dead) { b.dead = true; this.map.group.remove(b.group); breakBed(this.match, b.team); }
    }
    this.checkEnd();
  }
  private startSuddenDeath() {
    if (this.suddenDeath) return;
    this.suddenDeath = true;
    this.destroyAllBeds(); // safety net if the prior event was somehow skipped
    const hostile = Math.max(1, 2 - bwDragonBonus(this.upgrades));
    for (let i = 0; i < hostile; i++) this.dragons.spawn(0xc060ff, this.map.center);
    this.checkEnd();
  }
  private updateDragons(dt: number, playerPos?: THREE.Vector3) {
    if (this.dragons.count === 0) return;
    const targets = playerPos ? [{ pos: playerPos }] : [];
    const hits = this.dragons.update(dt, targets);
    if (!playerPos || this.respawnTimer > 0) return;
    const reduce = 1 - this.incomingReduction();
    for (const h of hits) {
      const dx = h.pos.x - playerPos.x, dz = h.pos.z - playerPos.z;
      if (dx * dx + dz * dz < 2.4 * 2.4) this.hurtPlayer(h.dmg * DRAGON_DMG_MUL * reduce);
    }
  }

  /** Contact damage from nearby raiders, heal-pool regen, then your death loop. */
  private updatePlayerLife(dt: number, playerPos?: THREE.Vector3) {
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawnTimer = 0;
        respawnPlayer(this.match, this.playerId);
        this.playerHp = this.playerMax;
        this.respawnReady = true;
      }
      return;
    }
    if (!playerPos) return;
    // heal pool: regen while you hold your own base
    const healRate = bwHealPoolRate(this.upgrades);
    if (healRate > 0 && playerPos.distanceTo(this.spawn()) < BASE_RADIUS) {
      this.playerHp = Math.min(this.playerMax, this.playerHp + healRate * dt);
    }
    let dps = 0;
    for (const r of this.bots.positions()) {
      const dx = r.pos.x - playerPos.x, dz = r.pos.z - playerPos.z;
      if (dx * dx + dz * dz < RAIDER_TOUCH * RAIDER_TOUCH) dps += RAIDER_DPS;
    }
    if (dps > 0) this.hurtPlayer(dps * dt * (1 - this.incomingReduction()));
  }
  private hurtPlayer(dmg: number) {
    if (this.respawnTimer > 0) return;
    this.playerHp = Math.max(0, this.playerHp - dmg);
    if (this.playerHp <= 0) {
      const r = killPlayer(this.match, this.playerId);
      if (r === "respawn") this.respawnTimer = PLAYER_RESPAWN;
      else this.checkEnd();
    }
  }

  // ── item shop (iron/gold/emerald) ──
  openShop() {
    if (!this.shop || this.anyMenuOpen || this.result.over) return;
    this.shop.open(this.wallet, (item) => this.buy(item), () => { /* closed */ });
  }
  private buy(item: BwShopItem) {
    if (!bwCanAfford(this.wallet, item)) return;
    this.wallet = bwBuy(this.wallet, item);
    this.applyEffect(item);
    this.shop?.refresh(this.wallet);
    this.refreshHud();
  }
  private applyEffect(item: BwShopItem) {
    const k = item.effect.kind;
    const v = item.effect.value ?? 0;
    const tier = item.effect.tier ?? 1;
    if (k === "block") {
      // lay/upgrade a real wall ring around your bed (raiders must break it).
      const b = this.beds.get(this.playerTeam);
      if (b && !b.dead) this.blocks.placeRing(b.pos, bwBlockMat(tier), Math.max(12, v));
    } else if (k === "melee") {
      // sword tier → bullet-damage multiplier (1.15 / 1.30 / 1.50)
      this.meleeMul = Math.max(this.meleeMul, 1 + tier * 0.16);
    } else if (k === "armor") {
      // armor tier → incoming damage reduction (15/30/45/60 → 0.15..0.60)
      this.armorReduction = Math.max(this.armorReduction, Math.min(0.6, v / 100));
    } else if (k === "ranged") {
      // bow/crossbow tier → faster fire (stacks with Maniac Miner haste)
      this.rangedMul = Math.max(this.rangedMul, 1 + tier * 0.18);
    } else if (k === "heal") {
      this.playerHp = Math.min(this.playerMax, this.playerHp + (v || 40));
    } else if (k === "speed") {
      this.speedBuff = 8;
    } else if (k === "guardian") {
      this.golems.spawn(this.beds.get(this.playerTeam)?.color ?? 0xbfc6cf, this.spawn());
    } else if (k === "trap") {
      this.traps = bwQueueTrap(this.traps, "alarm"); // the item-shop alarm trap
    } else if (k === "tnt" || k === "fireball") {
      // blast the nearest enemy bed AND chew a hole in its defenses
      const foe = this.enemyBeds()[0];
      if (foe) { this.damageBed(foe.team, k === "tnt" ? 45 : 28); this.blocks.damageNear(foe.pos, 2, 200); }
    }
  }

  // ── team upgrades shop (diamonds) ──
  openUpgrades() {
    if (!this.upgUI || this.anyMenuOpen || this.result.over) return;
    this.upgUI.open(this.upgrades, this.traps, this.wallet.diamond,
      (id) => this.buyUpgrade(id), (id) => this.buyTrap(id), () => { /* closed */ });
  }
  private buyUpgrade(id: BwUpgradeId) {
    const cost = bwUpgradeCost(this.upgrades, id);
    if (cost == null || this.wallet.diamond < cost) return;
    this.wallet = { ...this.wallet, diamond: this.wallet.diamond - cost };
    this.upgrades = bwBuyUpgrade(this.upgrades, id);
    this.upgUI?.refresh(this.upgrades, this.traps, this.wallet.diamond);
    this.refreshHud();
  }
  private buyTrap(id: BwTrapId) {
    const cost = bwNextTrapCost(this.traps.slots.length);
    if (cost == null || this.wallet.diamond < cost) return;
    this.wallet = { ...this.wallet, diamond: this.wallet.diamond - cost };
    this.traps = bwQueueTrap(this.traps, id);
    this.upgUI?.refresh(this.upgrades, this.traps, this.wallet.diamond);
    this.refreshHud();
  }

  // ── resource + status HUD ──
  private buildHud() {
    if (this.hud) return;
    const parent = document.getElementById("ui") ?? document.body;
    const el = document.createElement("div");
    el.id = "bw-res";
    parent.appendChild(el);
    this.hud = el;
    // Always-visible on-screen leave button (mobile has no Escape key). Reuses
    // the shared .mode-leave styling; tappable (pointer-events:auto via the class).
    const leave = document.createElement("button");
    leave.className = "mode-leave";
    leave.type = "button";
    leave.textContent = "✕ Leave";
    leave.addEventListener("click", () => this.onLeave?.());
    parent.appendChild(leave);
    this.leaveBtn = leave;
    this.refreshHud();
  }
  private flashTrapHud(trap: BwTrapId) {
    if (!this.hud) return;
    const pip = this.hud.querySelector(".bw-trap-flash");
    if (pip) pip.textContent = `⚠ ${trap === "counter" ? "Counter!" : trap === "alarm" ? "Alarm!" : "Trap sprung!"}`;
  }
  /** Clock chip: counts down to the next timed event, by name. */
  private nextEventLabel(): string {
    if (this.suddenDeath) return "🐉 SUDDEN DEATH";
    if (this.eventIdx >= this.events.length) return "";
    const ev = this.events[this.eventIdx];
    const secs = Math.max(0, Math.ceil(ev.t - this.elapsed));
    const short = ev.label.replace(/ —.*$/, ""); // trim the long Bed/Sudden blurbs
    return `⏳ ${short} ${secs}s`;
  }
  private refreshHud() {
    if (!this.hud) return;
    const w = this.wallet;
    const my = this.beds.get(this.playerTeam);
    const bedTxt = my && !my.dead ? `🛏 ${Math.max(0, Math.round(my.hp))}` : "🛏 ✖ FINAL LIFE";
    const enemies = aliveTeams(this.match).filter((t) => t !== this.playerTeam).length;
    const hpTxt = this.respawnTimer > 0 ? `💀 ${Math.ceil(this.respawnTimer)}s` : `❤ ${Math.round(this.playerHp)}`;
    const clock = this.nextEventLabel();
    const traps = this.traps.slots.length > 0 ? `🪤 ${this.traps.slots.length}` : "";
    const walls = this.blocks.count > 0 ? `🧱 ${this.blocks.count}` : "";
    this.hud.innerHTML =
      `<span class="bw-r bw-hp">${hpTxt}</span>` +
      `<span class="bw-r bw-iron">⛓ ${w.iron}</span>` +
      `<span class="bw-r bw-gold">⛀ ${w.gold}</span>` +
      `<span class="bw-r bw-diamond">◆ ${w.diamond}</span>` +
      `<span class="bw-r bw-emerald">✦ ${w.emerald}</span>` +
      `<span class="bw-r bw-bed">${bedTxt}</span>` +
      `<span class="bw-r bw-foes">⚔ ${enemies}</span>` +
      (walls ? `<span class="bw-r bw-walls">${walls}</span>` : "") +
      (traps ? `<span class="bw-r bw-traps">${traps}</span>` : "") +
      `<span class="bw-r bw-clock">${clock}</span>` +
      `<span class="bw-r bw-trap-flash"></span>`;
  }
}
