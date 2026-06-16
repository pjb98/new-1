import "./style.css";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { CAMERA, COSTS, ELITE, PETS_TUNING, PET_DEPTH, PLAYER, SCORE, ZOMBIE, IDLE, PRESTIGE, SYNERGY, RAMPAGE, GOBLIN, TRAP } from "./config";
import { Input } from "./input";
import { Arena } from "./arena";
import { Player } from "./player";
import { RoundManager } from "./rounds";
import { Zombie } from "./zombie";
import { BulletSystem, Weapon, WEAPONS, BOX_POOL, WONDER_POOL, styleForWeaponName, spreadForWeaponName, FireMods, Bullet } from "./weapons";
import { Interactables, GameApi } from "./interactables";
import { Hud } from "./hud";
import { AssetManager } from "./assets";
import { Powerups } from "./powerups";
import { FloatingText } from "./feedback";
import { Audio } from "./audio";
import { Combo } from "./combo";
import { Drops, DropKind } from "./drops";
import { Explosions } from "./explosions";
import { Island, IslandZone } from "./island";
import { IslandNet, makeBubble, makeNamePlate } from "./islandnet";
import { EmoteMenu } from "./emotes";
import type { EmoteId } from "./voxelChar";
import { petThumbnail } from "./petthumb";
import { Sparks } from "./particles";
import { Decals } from "./decals";
import { Pet, PETS, findAnyPet, petLevelCost, petXpForLevel, petStage, petStageName, petDamageMul, petStageMul, isTrialComplete, RARITY_COLOR, RARITY_LABEL, RARITY_ORDER, ROLE_LABEL, ROLE_ICON, type Rarity, type PetDef, type CombatRole } from "./pets";
import { EGGS, findEgg, rollEgg, eggOdds } from "./gacha";
import { RunMods, defaultMods, cloneMods, diffMods } from "./mods";
import { loadSave, writeSave, SaveData, recordScore, sanitizeSave, mergeSaves } from "./save";
import { cloudEnabled, cloudLogin, cloudPush } from "./cloudsave";
import { offlineGold, prestigeGain, prestigeMultiplier, dayUtc, settleStreak, rollDaily, applyDailyProgress, settleDaily, dailyRows, questsForDay, type DailyMetrics } from "./idle";
import { META_UPGRADES, essenceFor } from "./meta";
import { RUN_UPGRADES, rollUpgrades, RunUpgrade } from "./upgrades";
import { SKINS, findSkin } from "./cosmetics";
import { skinThumbnail } from "./skinthumb";
import { skinTexture } from "./skintex";
import { BedWarsMode } from "./bedwars/bwmode";
import { TdMode, type TdEnterOpts } from "./td/tdmode";
import { TD_TOWER_IDS } from "./td/tdtowers";
import { duelSendById } from "./td/tdduel";
import { tdDailyDay, tdDailyMods, tdDailyAvailable } from "./td/tddaily";
import { createWager, resolveWager, wagerPayout, WAGER_STAKES, type Wager } from "./wager";
import { Music } from "./music";
import { makeItem, rollRarity, rollRarityPity, resetPity, rarityColorHex, RARITIES, LootItem } from "./loot";
import { CHALLENGES, RunStats, blankRunStats } from "./challenges";
import { NetClient, InputMsg, ZombieSnap, AffixCode, warmServer, getServerUrl, setServerUrl } from "./net";
import { TouchControls, isTouchDevice } from "./touchControls";
import { Wallet } from "./wallet";
import { getTokenApiUrl, setTokenApiUrl, fetchClaimable, earnLogin, reportEarn } from "./token";
import { NetPlay, GuestSlot } from "./netplay";
import { COLORS, auraMaterial } from "./palette";
import { TiltShift } from "./tiltShift";
import { Puffs } from "./puffs";

type State = "menu" | "island" | "playing" | "paused" | "over" | "levelup" | "bedwars" | "td";

class Game implements GameApi {
  private renderer: THREE.WebGLRenderer;
  // ---- adaptive resolution: scale render DPR down when frames run long ----
  private _dprCap = 1.5; // device tier ceiling (1 on mobile, 1.5 desktop)
  private _lowSpec = false; // touch/mobile tier (set at construction)
  private _dprScale = 1; // live multiplier, stepped by the frame-time governor
  private _ss = 1; // supersample floor for the current scene (>1 = render above native)
  private _ftSmooth = 1 / 60; // exponentially-smoothed frame time (seconds)
  private _adaptT = 0; // seconds since the governor last adjusted
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private viewSize = 15; // half-height of the orthographic view, in world units
  private camZoom = 1; // live zoom multiplier (eased toward camZoomTarget)
  private camZoomTarget = 1; // player-set zoom (wheel / +- keys); >1 = zoomed out
  private _tiltStrength = 1.0; // base tilt-shift blur (eased off when zoomed in close)
  private _hatching = false; // an egg-hatch reveal is on screen (blocks re-hatch)
  private _gatherPortal = ""; // mode portal I'm currently standing in (co-op gather)
  private _portalStarting = false; // a portal match is being launched (host or guest)
  private _dwellZone = ""; // join-the-game structure I'm charging into (auto-enter)
  private _dwellTime = 0; // seconds stood inside it, fills the auto-enter charge
  private _localAura?: THREE.Mesh; // my own lobby flex aura (attached to player.group)
  private _localPlate?: THREE.Sprite; // my own nameplate over my head in the hub
  private _lbAcc = 0; // throttle accumulator for the lobby leaderboard refresh
  private composer?: EffectComposer; // post stack — absent on lowSpec (direct render)
  private clock = new THREE.Clock();

  private input: Input;
  private touch?: TouchControls;
  private arena: Arena;
  private island!: Island;
  private islandNet?: IslandNet;
  private _islandConnecting = false; // in-flight guard so we never open two island sockets
  private emoteMenu?: EmoteMenu;
  private footstepAcc = 0; // throttles island footstep puffs
  private islandPop = -1; // last-rendered "N players here" count (-1 = unset)
  private selfBubble?: THREE.Sprite; // my own speech bubble above my head
  private selfBubbleT = 0; // seconds remaining on my speech bubble
  private player: Player;
  private bullets: BulletSystem;
  private rounds: RoundManager;
  private interactables: Interactables;
  private hud: Hud;
  private puffs: Puffs;
  private floaters: FloatingText;
  private drops: Drops;
  private explosions: Explosions;
  private sparks: Sparks;
  private decals: Decals; // pooled corpse/gib/scorch decals (juice; capped + lowSpec-aware)
  private pets: Pet[] = [];
  private _petTgt = { x: 0, z: 0 };
  private _petDir = new THREE.Vector3();
  private _petGold = 0; // fractional gold accumulator for banker pets
  // lifetimeGold (the prestige basis) is reconciled from the monotonic goldEarned
  // total so EVERY gold faucet (kills, jackpot, loot, banker, offline) counts
  // without touching combat code. This marks goldEarned at the last reconcile.
  private _goldEarnedMark = 0;
  private _runGoldStart = 0; // goldEarned at this run's start (for the "earn gold" daily)
  private _earnMark = 0; // goldEarned already reported to the $TINY earn backend
  private _earnToken?: string; // short-lived earn-session token (sign once per session)
  private _earnBusy = false; // a flush is in flight (avoid overlapping reports)
  private _bankerRoundGold = 0; // gold minted by bankers this round (per-round cap)
  private _bankerRound = -1; // round the above was last reset for
  // ── PET DEPTH: role/synergy per-round accumulators (drainer heal + harvester
  // gold are capped per round; reset when the round changes). _petKillMark tracks
  // the squad kill delta each pet-frame so on-kill role bonuses stay tied to real
  // kills without touching the shared bullet/damageZombie path. ──
  private _petKillMark = 0; // runStats.kills at the last updatePets frame
  private _petLeveledThisFrame = false; // a pet hit a new level via XP → re-check evolutions after the loop
  private _drainerRoundHeal = 0; // HP healed by drainers this round (cap)
  private _harvesterRoundGold = 0; // bonus gold from harvesters this round (cap)
  private _petDepthRound = -1; // round the two accumulators above were reset for
  private audio = new Audio();
  private combo = new Combo();
  private hitStop = 0; // seconds of remaining sim freeze (game feel)
  private chronosActive = false; // Chronos in the active squad → permanent 2x sim
  private rampage = 0; // player-kill stacks (decays); drives the rampage multiplier
  private rampageDecay = 0; // seconds left before the stack starts draining
  private _rampageTier = ""; // last announced tier name (so we only toast on climb)
  /** Armed map traps: lethal hazard zones ticking damage to zombies inside. */
  private activeTraps: { x: number; z: number; r: number; dps: number; kind: "electric" | "fire"; t: number; fx: number }[] = [];
  private _trapFx = new THREE.Vector3(); // scratch for trap FX positions
  private wallet = new Wallet();
  // Wallet cloud-save session: set on a successful cloudLogin, cleared on
  // disconnect / token expiry. While set, meaningful saves debounce-push to the
  // backend keyed by this address. _cloudPushTimer coalesces those pushes.
  private _cloudToken?: string;
  private _cloudAddr?: string;
  private _cloudPushTimer = 0; // window.setTimeout handle (0 = idle)
  private _cloudSyncing = false; // guards against overlapping login round-trips
  private _cloudDeferred = false; // a connect arrived mid-run → sync on return to hub

  // progression
  private save: SaveData = loadSave();
  private mods: RunMods = defaultMods();
  // level-up picker state
  private levelNum = 0;
  private levelCards: RunUpgrade[] = [];
  private rerollCost = 0;
  private levelPicking = false;
  /** Timestamp (ms) a level-up pick was committed; the loop watchdog force-resumes
   *  the run if the normal setTimeout resume never fires (e.g. a throttled tab). 0 = idle. */
  private _levelPickAt = 0;
  private runStats: RunStats = blankRunStats();
  private _runCasts: Record<string, number> = {}; // per-pet ability casts this run (trial tracking)

  points = 0;
  private weapons: Weapon[] = [];
  private activeSlot = 0;
  private perks = new Set<"tough" | "quick">();
  private powerups = new Powerups();
  private state: State = "menu";
  private bw?: BedWarsMode; // Bed Wars-lite mode controller (lazy)
  private _bwEndTimer = 0;   // countdown after a BW match ends, then return to hub
  private td?: TdMode;       // Tower-Defense mode controller (lazy)
  private _tdEndTimer = 0;   // countdown after a TD run ends, then return to hub
  private _tdFreeze = 0;     // TD hit-stop timer (briefly slows the sim on big hits)
  private _tdWager: Wager | null = null; // live gold wager on the current duel
  private _tdIsDaily = false; // current TD run is today's Daily Challenge
  private music = new Music(); // generative lofi soundtrack (per-mode moods)

  // multiplayer (undefined = single-player)
  private net?: NetClient;
  private netplay?: NetPlay;
  private myId = 1;
  /** When set, GameApi buy/perk actions target this guest instead of the host. */
  private acting: GuestSlot | null = null;
  // reused scratch for guest-side cosmetic bullet impacts + homing/ricochet
  private guestZBuf: { x: number; z: number; r: number; color: number }[] = [];
  private hitTmp = new THREE.Vector3();
  private readonly UP = new THREE.Vector3(0, 1, 0);
  private healKills = 0; // counts toward Heal Nova upgrade
  // reused per-frame scratch to avoid GC churn in the hot loop
  private _axis = new THREE.Vector2();
  private _fire: FireMods = {};
  private _victims: Player[] = [];

  private tilt: TiltShift;

  private camTarget = new THREE.Vector3();
  private shake = 0;
  private _v2 = new THREE.Vector3();
  // reused camera offset (CAMERA.offset is constant) — avoids a per-frame Vector3 alloc
  private _camOffset = new THREE.Vector3(CAMERA.offset.x, CAMERA.offset.y, CAMERA.offset.z);
  // juice: transient camera punch-zoom (0 = none) + last combo tier shown
  private zoomPunch = 0;
  private lastComboTier = 1;
  // Nuke panic button: charge builds from kills; press F to wipe the screen.
  private nukeCharge = 1;
  // Glacial affix: remaining seconds the player is chilled (slowed) on touch.
  private chillTimer = 0;

  constructor(private assets: AssetManager) {
    const canvas = document.getElementById("scene") as HTMLCanvasElement;
    const ui = document.getElementById("ui") as HTMLElement;

    // LOW-SPEC (mobile) is decided FIRST — it changes how the renderer itself
    // is created. Mobile has struggled since day one because the full post
    // pipeline (offscreen RenderPass + 3-pass SMAA + OutputPass blit) ran on
    // phones too: ~5 full-screen passes/frame before drawing a single voxel.
    // On lowSpec we now skip the composer entirely and render DIRECT with
    // hardware MSAA (near-free on mobile tile GPUs), no shadow depth pass,
    // and Lambert-tier materials (see palette.ts).
    const lowSpec = isTouchDevice();
    this._lowSpec = lowSpec;
    this._dprCap = lowSpec ? 1 : 1.5;

    // Desktop: antialias:false — SMAA in the composer handles edges; MSAA here
    // would be redundant cost. Mobile: MSAA is the AA (no SMAA).
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: lowSpec });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this._dprCap));
    // Clear to the page cream (not the default black) so any pixel a scene's
    // background doesn't cover reads as the page, never a dark/navy bar.
    this.renderer.setClearColor(0xe9dcc2, 1);
    this.renderer.shadowMap.enabled = !lowSpec; // shadow pass is too hot for phones
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Orthographic = true isometric look (no perspective convergence), like both refs.
    const aspect = innerWidth / innerHeight;
    this.camera = new THREE.OrthographicCamera(
      -this.viewSize * aspect, this.viewSize * aspect, this.viewSize, -this.viewSize, 0.1, 1000,
    );
    this.camera.position.set(CAMERA.offset.x, CAMERA.offset.y, CAMERA.offset.z);
    this.camera.lookAt(0, 0, 0);

    // Soft image-based ambient light — the key to the "soft 3D" cozy look.
    // Skipped on lowSpec: the Lambert-tier materials ignore the env map, so a
    // plain warm ambient stands in for the lost IBL fill (much cheaper).
    if (!lowSpec) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.5;
    } else {
      this.scene.add(new THREE.AmbientLight(0xfff2e2, 0.45));
    }

    // Desktop gets the full post stack; lowSpec renders DIRECT (no composer).
    if (!lowSpec) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
    }
    // Tilt-shift is built unconditionally (onResize touches it) but only ever
    // added as passes on desktop.
    this.tilt = new TiltShift(innerWidth, innerHeight, {
      focus: 0.5, band: 0.58, strength: this._tiltStrength, vignette: 0.26, saturation: 1.08, warmth: 0.12,
    });
    if (this.composer) {
      // Gentle bloom — only the brightest emissives glow. Half-res.
      const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.16, 0.5, 0.92);
      this.composer.addPass(bloom);
      // Tilt-shift: subtle miniature-diorama blur + grade (two full-screen passes).
      this.composer.addPass(this.tilt.horizontal);
      this.composer.addPass(this.tilt.vertical);
      this.composer.addPass(new SMAAPass(innerWidth, innerHeight));
      this.composer.addPass(new OutputPass());
    }

    this.input = new Input(canvas);
    if (isTouchDevice()) {
      document.body.classList.add("touch");
      this.touch = new TouchControls(this.input);
    }
    // Mouse-wheel zoom (scroll up = zoom in, down = zoom out); the hub allows a
    // wider range so you can survey the whole village.
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.nudgeZoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    // Pinch-to-zoom on touch.
    let pinchDist = 0;
    canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 2) return;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchDist > 0 && Math.abs(d - pinchDist) > 1) this.nudgeZoom(pinchDist / d);
      pinchDist = d;
    }, { passive: true });
    canvas.addEventListener("touchend", () => { pinchDist = 0; });
    this.arena = new Arena(this.scene);
    this.island = new Island(this.scene);
    this.player = new Player(this.scene, this.assets);
    this.bullets = new BulletSystem(this.scene);
    if (lowSpec) this.bullets.maxLive = 70; // fewer live tracers on mobile GPUs
    this.rounds = new RoundManager(this.scene, this.assets);
    if (lowSpec) this.rounds.maxAliveCeiling = 84; // dense horde wall, trimmed for phone draw-call budget
    this.interactables = new Interactables(this.scene, this.arena.half);
    this.puffs = new Puffs(this.scene, lowSpec);
    this.floaters = new FloatingText(this.scene);
    this.drops = new Drops(this.scene, this.audio);
    this.explosions = new Explosions(this.scene, lowSpec);
    this.sparks = new Sparks(this.scene, lowSpec);
    this.decals = new Decals(this.scene, lowSpec); // corpse decals; no-op on lowSpec (cap 0)
    this.hud = new Hud(ui);

    // Resume audio on the first user gesture (browser autoplay policy).
    const unlock = () => this.audio.unlock();
    addEventListener("pointerdown", unlock, { once: true });
    addEventListener("keydown", unlock, { once: true });
    this.audio.setEnabled(!this.save.muted);
    this.music.setEnabled(!this.save.muted);
    this.music.setVolume(this.save.musicVolume); // restore the saved music volume

    // Menu progression UI (best run + Essence shop) + equipped cosmetic skin.
    this.hud.setBest(this.save.bestRound, this.save.bestScore);
    this.applyPlayerSkin();
    this.renderShop();

    this.rounds.onRoundStart = (n) => {
      this.hud.setRound(n);
      if (n > 1) {
        const tag = this.rounds.isBossRound ? " — BOSS" : this.rounds.isSwarmRound ? " — SWARM!" : "";
        this.hud.toast(`Round ${n}${tag}`);
      }
      // Special round: loud banner + screen tint + a sting; plain rounds clear it.
      const sp = this.rounds.specialRound;
      if (sp) {
        this.hud.showRoundBanner(sp.name, sp.tint ?? "#ffd24a");
        this.hud.setScreenTint(sp.tint ?? null);
        this.audio.roundStart(); // reuse the existing round sting (no new audio API)
        this.shake = Math.min(0.5, this.shake + 0.25);
      } else {
        this.hud.setScreenTint(null);
      }
      // One-shot HORDE REGIME announcement the round the climb begins (R20).
      if (this.rounds.hordeJustRose) {
        this.hud.showRoundBanner("☠️ THE HORDE RISES ☠️", "#ff5a3a");
        this.shake = Math.min(0.6, this.shake + 0.35);
        // Proactively shed a step of internal resolution on phones so the
        // density spike doesn't stall before the governor reacts.
        if (this._lowSpec && this._dprScale > 0.7) { this._dprScale -= 0.2; this.applyPixelRatio(); }
      }
      this.audio.roundStart();
      this.audio.setIntensity(n / 20);
      this.hud.setCurseVisible(false); // lock the dial while the round is live
    };
    this.rounds.onIntermission = () => {
      const cleared = this.rounds.round;
      const bonus = SCORE.roundBonusBase + (cleared - 1) * SCORE.roundBonusPerRound;
      this.addPoints(bonus);
      this.hud.toast(`Round clear  +${bonus}`);
      // Special rounds with a guaranteed reward (Hound) drop a treasure chest at
      // the player on clear. classifySpecial(cleared) since `special` has advanced.
      if (RoundManager.classifySpecial(cleared)?.guaranteedDrop) {
        this.drops.spawnChest(this.player.pos, this.mods.dropChance + 0.5);
      }
      // Between rounds: surface the Curse dial so the player can up the stakes.
      this.hud.setCurse(this.rounds.curse, this.rounds.curseRewardMul);
      this.hud.setCurseVisible(true);
      // Solo: offer a level-up pick during the breather (skipped in co-op).
      // ✦ The Oracle of Fate (Celestial) AUTO-PICKS the best card for you — no
      // screen — instead of the manual chooser (handled inside offerLevelUp).
      if (!this.netplay) this.offerLevelUp();
    };
    this.rounds.onBossSpawn = () => {
      this.audio.roundStart();
      this.hud.toast("A BOSS APPROACHES");
      this.shake = Math.min(0.6, this.shake + 0.4);
    };
    // Loot Goblin: a fleeing bounty mob. Loud call-out on arrival; a wry note if
    // it gets away. Catching it pays a jackpot (see damageZombie z.bounty).
    this.rounds.onGoblinSpawn = () => {
      this.hud.toast("💰 A LOOT GOBLIN! Catch it before it escapes!");
      this.audio.roundStart();
    };
    this.rounds.onGoblinEscape = () => {
      this.hud.toast("💨 The Loot Goblin got away…");
    };
    // Difficulty director: a loud tier banner each time the horde escalates.
    this.rounds.onDifficultyTier = (name, color) => {
      this.hud.showRoundBanner(name, color);
      this.audio.roundStart();
      this.shake = Math.min(0.4, this.shake + 0.2);
    };

    // Curse slider: between-rounds risk→reward dial. Adjust clamps in rounds +
    // reflects the new reward multiplier on the chip.
    this.hud.buildCurseSlider((dir) => {
      this.rounds.adjustCurse(dir);
      this.hud.setCurse(this.rounds.curse, this.rounds.curseRewardMul);
    });
    this.hud.setCurse(this.rounds.curse, this.rounds.curseRewardMul);

    this.hud.onStart(() => this.startRun());
    this.hud.onRestart(() => this.startRun());
    // Game-over "Lobby" button: clean up the dead run, then drop straight into
    // the island hub — skipping the splash screen entirely.
    this.hud.onMenu(() => { this.toMenu(); this.enterIsland(); });
    this.hud.onPrestige(() => this.openPrestige());
    this.hud.onHost(() => this.hostGame());
    this.hud.onJoin((code) => this.joinGame(code));
    this.hud.onServer(() => this.changeServer());
    this.hud.onIsland(() => this.enterIsland());
    this.hud.onLeaveIsland(() => this.leaveIsland());
    // Island social: emote wheel + preset quick-chat (T key or on-screen button).
    this.emoteMenu = new EmoteMenu(ui, {
      onEmote: (id) => this.playSelfEmote(id),
      onChat: (text) => this.saySelf(text),
      onOpenChange: (open) => this.islandNet?.setMenuOpen(open),
    });
    this.hud.onWallet(() => this.toggleWallet());
    this.hud.onClaim(() => this.claimTokens(), () => this.changeTokenApi());
    this.wallet.onChange = () => this.syncWallet();
    this.wallet.tryEagerConnect();

    addEventListener("resize", this.onResize);
    // Entering/leaving fullscreen changes the viewport without always firing a
    // timely "resize"; re-fit on the next frame (when innerHeight is settled).
    addEventListener("fullscreenchange", () => requestAnimationFrame(this.onResize));
    this.onResize();
    // DEV/TEST cheat: visit with ?money to top up local gold + essence for testing
    // the shop/pets. Only touches the LOCAL save — it CANNOT mint $TINY (that's
    // server-ledgered + daily-capped). Remove before public launch.
    if (new URLSearchParams(location.search).has("money")) {
      this.save.gold = Math.max(this.save.gold, 1_000_000_000);
      this.save.essence = Math.max(this.save.essence, 1_000_000);
      writeSave(this.save);
    }
    this.hud.showStart();
    this.showMenuBackdrop(); // render the lobby behind the splash

    // Idle economy boot: credit offline banker gold (capped, half-rate) and show
    // the "While You Were Away" screen, then settle the daily login streak +
    // roll the daily-quest board. All read wall-clock vs save.lastSeen and
    // persist; safe no-ops on a brand-new save.
    this.settleOffline();
    this.settleLogin();
    // Anchor the lifetimeGold reconciler at the post-boot goldEarned so only
    // NEW gold (this session onward) feeds the prestige basis — migrated saves
    // with a large pre-feature goldEarned don't dump it into prestige at once.
    this._goldEarnedMark = this.save.goldEarned;
    this._earnMark = this.save.goldEarned; // don't credit pre-boot gold on first connect
    this.refreshPrestigeUi();

    this.resetRun(); // place player + default weapon so the menu scene looks alive
    requestAnimationFrame(this.loop);
  }

  // ---- run lifecycle ----
  private resetRun() {
    // Rebuild this run's modifier bundle from owned permanent meta-upgrades.
    this.mods = defaultMods();
    for (const u of META_UPGRADES) if (this.save.owned.includes(u.id)) u.apply(this.mods);

    this.player.reset();
    this.player.maxHealth = PLAYER.maxHealth + this.mods.maxHealthBonus;
    this.player.health = this.player.maxHealth;
    this.player.pos.set(0, 0, 9); // start on the plaza, south of the fountain
    this.player.group.position.copy(this.player.pos);
    this.bullets.clear();
    this.rounds.reset();
    this.spawnPets();
    this.points = SCORE.startingPoints + this.mods.startPointsBonus;
    const starter = this.mods.startWeapon && WEAPONS[this.mods.startWeapon] ? WEAPONS[this.mods.startWeapon] : WEAPONS.peashooter;
    this.weapons = [new Weapon(starter)];
    this.activeSlot = 0;
    this.perks.clear();
    this.powerups.clear();
    this.levelNum = 0;
    this.levelPicking = false;
    this.acting = null; // clear any dangling guest-interaction actor from last run
    this.healKills = 0;
    this.lastComboTier = 1;
    this.zoomPunch = 0;
    this.nukeCharge = 1;
    this.runStats = blankRunStats();
    this._runCasts = {};
    // PET DEPTH: reset on-kill role accumulators so a new run starts clean.
    this._petKillMark = 0;
    this._drainerRoundHeal = 0;
    this._harvesterRoundGold = 0;
    this._petDepthRound = -1;
    this.combo.windowBonus = this.mods.comboWindowBonus;
    this.hud.setPowerups([]);
    this.shake = 0;
    this.combo.reset();
    resetPity(); // fresh bad-luck-protection streak each run (non-cashable)
    this.floaters.clear();
    this.drops.clear();
    this.explosions.clear();
    this.sparks.clear();
    this.hitStop = 0;
    this.rampage = 0; this.rampageDecay = 0; this._rampageTier = "";
    this.activeTraps.length = 0;
    // NOTE: chronosActive is owned by spawnPets() (called above) — do NOT reset
    // it here or it wipes the flag spawnPets just set, killing OVERDRIVE.
    this.hud.setCombo(0, 0);
    this.hud.hideBoss();
    this.hud.hideLevelUp();
    this.hud.setPoints(this.points);
    this.hud.setRound(1);
    if (!this.netplay) this.hud.hideRoomCode();
    this.syncWeaponHud();
  }

  // ---- progression / menus ----
  /** Re-render all three menu shop tabs (upgrades / skins / challenges). */
  private renderShop() {
    const upgrades = META_UPGRADES.map((u) => ({
      id: u.id,
      name: u.name,
      desc: u.desc,
      cost: u.cost,
      owned: this.save.owned.includes(u.id),
      affordable: this.save.essence >= u.cost,
    }));
    this.hud.renderMeta(this.save.essence, upgrades, (id) => this.buyMeta(id));

    const skins = SKINS.map((s) => ({
      id: s.id,
      name: s.name,
      body: s.body,
      head: s.head,
      cost: s.cost,
      owned: this.save.skins.includes(s.id) || s.cost === 0,
      equipped: this.save.skin === s.id,
      affordable: this.save.essence >= s.cost,
      rarity: s.rarity,
      rarityColor: RARITY_COLOR[s.rarity as Rarity] ?? "#b8c2cc",
      thumb: skinThumbnail(s.id),
    }));
    this.hud.renderSkins(this.save.essence, skins, (id) => this.selectSkin(id));

    const chals = CHALLENGES.map((c) => ({
      name: c.name,
      desc: c.desc,
      reward: c.reward,
      progress: c.progress(this.save.stats, this.runStats),
      goal: c.goal,
      done: this.save.claimed.includes(c.id),
    }));
    this.hud.renderChallenges(this.save.essence, chals);

    // Market: sell tradable loot for gold (the in-game economy).
    this.hud.renderMarket(
      this.save.gold,
      this.save.stash.map((it) => ({ id: it.id, name: it.name, rarity: it.rarity, gold: it.gold, color: rarityColorHex(it.rarity as any) })),
      (id) => this.sellItem(id),
      () => this.sellAll(),
    );

    // Pets: buy companions with gold (the gold sink + late-game chaos).
    const activeIds = new Set(this.pets.map((pp) => pp.def.id));
    this.hud.renderPets(
      this.save.gold,
      PETS.map((base) => {
        // If this pet has evolved, show its evolved form (continue leveling it).
        const evoId = base.evolvesTo;
        const isEvolved = !!evoId && this.save.pets.includes(evoId);
        const p = isEvolved ? (findAnyPet(evoId!) ?? base) : base;
        const ownId = isEvolved ? evoId! : base.id;
        const owned = this.save.pets.includes(ownId);
        const level = this.save.petLevels[ownId] ?? 1;
        const upCost = petLevelCost(base, level); // cost curve keyed off the base
        const rarity = (base.rarity ?? "common") as Rarity;
        // Evolution-trial progress (only for an owned, not-yet-evolved evolver).
        let trial: { label: string; cur: number; goal: number; done: boolean }[] | undefined;
        if (owned && !isEvolved && base.trial && base.evolveLevel) {
          const prog = this.save.petProgress[ownId] ?? {};
          trial = [
            { label: `Reach Lv ${base.evolveLevel}`, cur: Math.min(level, base.evolveLevel), goal: base.evolveLevel, done: level >= base.evolveLevel },
            ...base.trial.goals.map((go) => {
              const cur = prog[go.stat] ?? 0;
              return { label: go.label, cur: Math.min(cur, go.goal), goal: go.goal, done: cur >= go.goal };
            }),
          ];
        }
        // ── PET DEPTH: role / star-ascension / shiny display + dupe-convert hook ──
        const role = p.combatRole;
        const stars = this.petStars(ownId);
        const maxStars = PET_DEPTH.stars.maxStars;
        const shiny = (this.save.petProgress[ownId]?._shiny ?? 0) > 0;
        const starCost = Math.round(base.cost * PET_DEPTH.stars.convertCostMul);
        const canStar = owned && stars < maxStars; // re-buying mints a star (dupe)
        // combat stats for the card (DPS headline + DMG/RATE/RANGE), scaled by level+stage
        const dmgMul = petDamageMul(level) * petStageMul(level);
        const dmg = Math.round(p.damage * dmgMul);
        const rate = p.interval > 0 ? 1 / p.interval : 0;
        let dps = dmg * rate;
        if (p.splashRadius > 0) dps += p.splashDamage * dmgMul * rate;
        const stats = p.damage > 0 ? [
          { label: "DPS", value: Math.round(dps).toLocaleString() },
          { label: "DMG", value: dmg.toLocaleString() },
          { label: "RATE", value: `${rate.toFixed(1)}/s` },
          { label: "RANGE", value: `${Math.round(p.range)}` },
        ] : undefined;
        return {
          id: ownId, name: p.name, desc: p.desc, cost: base.cost,
          color: `#${p.color.toString(16).padStart(6, "0")}`,
          owned, level,
          xp: this.save.petProgress[ownId]?._xp ?? 0,
          xpNext: petXpForLevel(level),
          stage: petStage(level),
          stageName: petStageName(level),
          upCost,
          affordable: owned ? this.save.gold >= upCost : this.save.gold >= base.cost,
          rarity,
          rarityColor: RARITY_COLOR[rarity],
          stats,
          ability: p.ability?.name ?? base.ability?.name,
          thumb: petThumbnail(p.id, level), // cached voxel-model preview (per evolution stage)
          trial,
          roleIcon: role ? ROLE_ICON[role] : undefined,
          roleLabel: role ? ROLE_LABEL[role] : undefined,
          stars, maxStars, shiny,
          canStar, starCost: canStar ? starCost : undefined,
          active: activeIds.has(ownId),
          // owned COMBAT pets can be deployed/benched (bankers/buffers always active)
          canSquad: owned && p.role !== "banker" && p.role !== "buffer",
          benched: this.save.benchedPets.includes(ownId),
        };
      }),
      (id) => this.buyOrLevelPet(id),
      this.petCollectionInfo(),
      (id) => this.convertDupeToStar(id),
      (id) => this.toggleSquad(id),
    );
  }

  /** Distinct owned pet count (counts an evolved pet as its slot). */
  private petCollectedCount(): number {
    return this.save.pets.length;
  }

  /** Squad-role tally + synergy bonuses + collection progress for the Pets tab. */
  private petCollectionInfo() {
    const sq = this.petSquadInfo();
    const collected = this.petCollectedCount();
    const total = PETS.length;
    const next = PET_DEPTH.cosmetic.milestones.find((m) => collected < m.own);
    return { roles: sq.roles, bonuses: sq.bonuses, collected, total, nextMilestone: next, members: sq.members, cap: sq.cap };
  }

  /** Buy a companion pet with gold; it joins you on the next run (and this one). */
  /** Buy a pet if unowned, else spend gold to level it up (the idle loop). */
  private buyOrLevelPet(id: string) {
    const def = findAnyPet(id);
    if (!def) return;
    // For an evolved pet, the level-cost curve still uses the base pet's cost.
    const baseForCost = PETS.find((p) => p.evolvesTo === id) ?? def;
    const owned = this.save.pets.includes(id);
    if (!owned) {
      // Pets can no longer be bought directly — they're hatched from eggs.
      this.audio.deny();
      this.hud.toast(`🥚 ${def.name} is hatched from eggs!`);
      return;
    }
    {
      const level = this.save.petLevels[id] ?? 1;
      const cost = petLevelCost(baseForCost, level);
      if (this.save.gold < cost) { this.audio.deny(); return; }
      this.save.gold -= cost;
      const newLevel = level + 1;
      this.save.petLevels[id] = newLevel;
      const live = this.pets.find((p) => p.def.id === id);
      if (live) live.setLevel(newLevel);
      // Evolution is gated on level + trial — only fires when both are met.
      this.checkPetEvolutions();
    }
    this.persist();
    this.audio.powerup();
    if (!owned) this.spawnPets();
    this.renderShop();
  }

  /** Pay any newly-crossed collection-completion milestone in SOFT essence.
   *  The highest `own` threshold already rewarded is persisted under a reserved
   *  pseudo-pet-id `petProgress["_collection"].paid` (save.ts sanitizes it as a
   *  numeric counter — no save.ts edit needed). NON-CASHABLE: essence only. */
  private grantCollectionMilestones() {
    const collected = this.petCollectedCount();
    const meta = (this.save.petProgress["_collection"] ??= {});
    const paid = meta.paid ?? 0;
    let totalEssence = 0;
    let highest = paid;
    for (const m of PET_DEPTH.cosmetic.milestones) {
      if (collected >= m.own && m.own > paid) {
        totalEssence += m.essence;
        highest = Math.max(highest, m.own);
      }
    }
    if (totalEssence > 0) {
      meta.paid = highest;
      this.save.essence += totalEssence;
      this.hud.toast(`✦ Collection ${collected}/${PETS.length} — +${totalEssence} essence!`);
    }
  }

  /** Dupe → STAR ascension. Buying a copy of a pet you already own converts the
   *  gold into a star (petProgress[id]._stars, capped at PET_DEPTH.stars.maxStars).
   *  Stars give a small flat damage bump (dmgPerStar) AND, at thresholds, a role-
   *  behavior kicker (see updatePets roleKickAt/eliteKickAt) — skills, not raw
   *  stat creep. NON-CASHABLE: cost is gold only; nothing pays out tokens. */
  private convertDupeToStar(id: string) {
    if (!this.save.pets.includes(id)) { this.audio.deny(); return; }
    const stars = this.petStars(id);
    if (stars >= PET_DEPTH.stars.maxStars) { this.audio.deny(); return; }
    // Cost keys off the base pet's price (evolved forms have cost 0).
    const base = PETS.find((p) => p.evolvesTo === id) ?? findAnyPet(id);
    const cost = Math.round((base?.cost ?? 0) * PET_DEPTH.stars.convertCostMul);
    if (this.save.gold < cost) { this.audio.deny(); return; }
    this.save.gold -= cost;
    const pr = (this.save.petProgress[id] ??= {});
    pr._stars = stars + 1;
    this.persist();
    this.audio.levelUp();
    const liveName = findAnyPet(id)?.name ?? "Pet";
    this.hud.toast(`★ ${liveName} ascended to ${pr._stars}★!`);
    this.renderShop();
  }

  /**
   * Crack a pet egg: spend its gold, roll a weighted-random pet from its rarity
   * table, and grant it. A NEW pet is added to the collection (with the usual
   * shiny roll + collection milestones); a DUPLICATE auto-converts into a star
   * (up to the cap) so a hatch is never wasted. Returns the rolled pet so the
   * island can play the reveal, or null if the player couldn't afford it.
   */
  private hatchEgg(eggId: string): { pet: PetDef; dupe: boolean; shiny: boolean; stars: number } | null {
    const egg = findEgg(eggId);
    if (!egg) return null;
    if (this.save.gold < egg.cost) { this.audio.deny(); this.hud.toast("Not enough gold"); return null; }
    this.save.gold -= egg.cost;
    const pet = rollEgg(egg);
    const id = pet.id;
    const owned = this.save.pets.includes(id);
    let shiny = false;
    let stars = 0; // new star count when a dupe ascends (0 = refunded/maxed)
    if (!owned) {
      this.save.pets.push(id);
      this.save.petLevels[id] = 1;
      if (Math.random() < PET_DEPTH.cosmetic.shinyOdds) {
        (this.save.petProgress[id] ??= {})._shiny = 1;
        shiny = true;
      }
      this.grantCollectionMilestones();
    } else {
      // duplicate → ascend a star if there's room; otherwise it's a courtesy
      // refund of part of the egg so a maxed dupe still isn't a total loss.
      const cur = this.petStars(id);
      if (cur < PET_DEPTH.stars.maxStars) {
        stars = cur + 1;
        (this.save.petProgress[id] ??= {})._stars = stars;
      } else {
        const refund = Math.round(egg.cost * 0.25);
        this.save.gold += refund;
      }
    }
    this.persist();
    this.audio.powerup();
    this.spawnPets();
    this.renderShop();
    return { pet, dupe: owned, shiny, stars };
  }

  /** Accumulate this run's "while-equipped" totals into each owned pet's trial. */
  private foldPetTrials() {
    for (const id of this.save.pets) {
      const def = findAnyPet(id);
      if (!def || !def.trial) continue; // evolved already, or never evolves
      const pr = (this.save.petProgress[id] ??= {});
      pr.kills = (pr.kills ?? 0) + this.runStats.kills;
      pr.bosses = (pr.bosses ?? 0) + this.runStats.bossKills;
      pr.crits = (pr.crits ?? 0) + this.runStats.crits;
      pr.runs = (pr.runs ?? 0) + 1;
      pr.casts = (pr.casts ?? 0) + (this._runCasts[id] ?? 0);
      pr.bestRound = Math.max(pr.bestRound ?? 0, this.runStats.round);
    }
  }

  /** Evolve any owned pet that has met BOTH its level and trial requirements. */
  private checkPetEvolutions() {
    let evolved = false;
    for (const id of [...this.save.pets]) {
      const def = findAnyPet(id);
      if (!def || !def.evolvesTo || !def.evolveLevel) continue;
      if ((this.save.petLevels[id] ?? 1) < def.evolveLevel) continue;
      if (!isTrialComplete(def, this.save.petProgress[id])) continue;
      this.evolvePet(id, def);
      evolved = true;
    }
    if (evolved) {
      this.persist();
      this.spawnPets();
      this.renderShop();
    }
  }

  /** Swap an owned base pet for its evolved form (level carries over). */
  private evolvePet(id: string, def: PetDef) {
    if (!def.evolvesTo) return;
    const idx = this.save.pets.indexOf(id);
    if (idx < 0) return;
    const lvl = this.save.petLevels[id] ?? 1;
    // Carry the cosmetic/ascension reserved keys across evolution so stars + shiny
    // survive the form swap (trial counters are reset — the evo no longer evolves).
    const stars = this.save.petProgress[id]?._stars ?? 0;
    const shiny = this.save.petProgress[id]?._shiny ?? 0;
    this.save.pets[idx] = def.evolvesTo;
    this.save.petLevels[def.evolvesTo] = lvl;
    delete this.save.petLevels[id];
    delete this.save.petProgress[id];
    if (stars > 0 || shiny > 0) {
      const pr = (this.save.petProgress[def.evolvesTo] ??= {});
      if (stars > 0) pr._stars = stars;
      if (shiny > 0) pr._shiny = shiny;
    }
    this.audio.levelUp();
    this.hud.toast("✦ Evolved into " + (findAnyPet(def.evolvesTo)?.name ?? "?") + "!");
  }

  /** Add a freshly-dropped item to the stash + announce it in-run. */
  private grantLoot(item: LootItem) {
    this.save.stash.push(item);
    this.persist();
    const info = RARITIES[item.rarity];
    this.floaters.spawn(this.player.pos, `${info.label} LOOT!`, rarityColorHex(item.rarity), 1.1, true);
    this.audio.powerup();
  }

  /** Sell one stashed item for its gold value. */
  private sellItem(id: string) {
    const i = this.save.stash.findIndex((it) => it.id === id);
    if (i < 0) return;
    const [item] = this.save.stash.splice(i, 1);
    this.save.gold += item.gold;
    this.save.goldEarned += item.gold;
    this.persist();
    this.audio.buy();
    this.renderShop();
  }

  /** Sell the whole stash at once. */
  private sellAll() {
    if (!this.save.stash.length) return;
    const total = this.save.stash.reduce((s, it) => s + it.gold, 0);
    this.save.gold += total;
    this.save.goldEarned += total;
    this.save.stash = [];
    this.persist();
    this.audio.powerup();
    this.renderShop();
  }

  private buyMeta(id: string) {
    const u = META_UPGRADES.find((m) => m.id === id);
    if (!u || this.save.owned.includes(id)) return;
    if (this.save.essence < u.cost) {
      this.audio.deny();
      return;
    }
    this.save.essence -= u.cost;
    this.save.owned.push(id);
    this.persist();
    this.audio.powerup();
    this.renderShop();
  }

  /** Apply the equipped skin to the live hero: true pixel TEXTURE + glow + the
   *  3D cosmetic kit (hat/cape). Falls back to flat colour if textures are off. */
  private applyPlayerSkin() {
    const skin = findSkin(this.save.skin);
    const tex = skinTexture(skin.id);
    if (tex) {
      this.player.applyTexture(tex, skin.glow ?? 0x000000);
    } else {
      this.player.setSkin(skin.body, skin.head, skin.glow ?? 0x000000);
      this.player.setOutfit({ body: skin.body, pants: skin.pants, shoes: skin.shoes, belt: skin.belt, gloves: skin.gloves, emblem: skin.emblem });
    }
    this.player.setCosmetic({ hat: skin.hat, hatColor: skin.hatColor, back: skin.back, backColor: skin.backColor });
  }

  /** Equip an owned skin, or buy it with Essence then equip. */
  private selectSkin(id: string) {
    const skin = findSkin(id);
    if (!this.save.skins.includes(id)) {
      if (this.save.essence < skin.cost) {
        this.audio.deny();
        return;
      }
      this.save.essence -= skin.cost;
      this.save.skins.push(id);
      this.audio.powerup();
    } else {
      this.audio.ui();
    }
    this.save.skin = id;
    this.persist();
    this.applyPlayerSkin();
    this.renderShop();
  }

  /** Return to the main menu (from the game-over screen) to spend Essence. */
  private toMenu() {
    this.teardownNet();
    this.state = "menu";
    this.resetRun();
    this.hud.hideGameOver();
    this.hud.hideGuestDown(); // clear the co-op spectator overlay if it was up
    this.hud.setBest(this.save.bestRound, this.save.bestScore);
    this.renderShop();
    this.hud.showStart();
    this.showMenuBackdrop(); // lobby glows behind the splash here too
  }

  /** Render the island lobby as a calm backdrop behind the splash/menu overlay.
   *  Not the playable hub (no presence/pets/sim) — just the cozy scene showing
   *  through the semi-transparent splash scrim. */
  private showMenuBackdrop() {
    this.arena.group.visible = false;
    this.island.setVisible(true);
    this.interactables.setVisible(false);
    this.drops.clearAll();
    this.player.pos.set(0, 0, 11); // stand at the front of the square (mostly behind the hero card)
    this.player.group.position.copy(this.player.pos);
    this.setRenderTier(this._lowSpec ? 1.6 : 3, this._lowSpec ? 1.4 : 2); // crisp backdrop
    this.camZoom = this.camZoomTarget = 1.9; // frame the hub immediately (no ease-in from a stale zoom)
    this.applyView();
  }

  /** Pause the breather and offer 1 of 3 stacking run upgrades. */
  private offerLevelUp() {
    this.levelNum++;
    this.levelCards = rollUpgrades(3, this.rounds.round);
    this.rerollCost = 500;
    this.levelPicking = false;
    // ✦ Oracle of Fate: auto-resolve the pick — choose the BEST of the three
    // offered cards and apply it instantly, NO chooser screen. (Owned + active.)
    if (this.ownsActiveOracle()) {
      const rank: Record<string, number> = { legendary: 3, rare: 2, common: 1 };
      const best = this.levelCards.reduce((a, b) => (rank[b.tier] > rank[a.tier] ? b : a), this.levelCards[0]);
      this.applyUpgradeCard(best);
      this.hud.toast(`🔮 Oracle chose: ${best.name}!`);
      this.audio.levelUp();
      return; // skip the manual picker entirely
    }
    this.state = "levelup";
    this.audio.levelUp();
    this.renderLevelUp();
  }

  /** True if the player owns The Oracle and it's in the active squad. */
  private ownsActiveOracle(): boolean {
    return this.save.pets.includes("oracle") && !this.save.benchedPets.includes("oracle");
  }

  /** Build card view-models (with live stat previews) and hand them to the HUD. */
  private renderLevelUp() {
    const cards = this.levelCards.map((u) => {
      const after = cloneMods(this.mods);
      u.apply(after);
      return { id: u.id, name: u.name, desc: u.desc, icon: u.icon, color: u.color, tier: u.tier, deltas: diffMods(this.mods, after) };
    });
    this.hud.showLevelUp({
      level: this.levelNum,
      cards,
      rerollCost: this.rerollCost,
      canReroll: this.points >= this.rerollCost,
      onPick: (id) => this.applyUpgrade(id),
      onReroll: () => this.rerollLevel(),
    });
  }

  /** Spend points to re-roll the three offered cards (cost escalates). */
  private rerollLevel() {
    if (this.levelPicking) return;
    if (!this.spend(this.rerollCost)) return; // handles "can't afford" feedback
    this.rerollCost += 250;
    this.levelCards = rollUpgrades(3, this.rounds.round);
    this.audio.ui();
    this.renderLevelUp();
  }

  /** Apply a card's effects to this.mods + refresh live state. Pure of any UI
   *  freeze/timer, so both the manual picker AND the Oracle auto-pick reuse it.
   *  Searches both the normal deck and the Limit-Break pool (Oracle can roll LBs). */
  private applyUpgradeCard(card: RunUpgrade) {
    card.apply(this.mods);
    // ── TRANSFORM picks: re-assert the pierce+explode / crit+chain floors so the
    // build identity holds even if later cards leave a field at 0. Idempotent. ──
    if (this.mods.pierceExplode > 0) {
      this.mods.pierceBonus = Math.max(this.mods.pierceBonus, 1);
      this.mods.explosiveRadius = Math.max(this.mods.explosiveRadius, 1.4);
    }
    if (this.mods.critChain > 0) {
      this.mods.chainCount = Math.max(this.mods.chainCount, 1);
      this.mods.critChance = Math.max(this.mods.critChance, 0.15);
    }
    // live-state effects
    this.player.maxHealth = PLAYER.maxHealth + this.mods.maxHealthBonus;
    this.player.heal(25); // small reward heal on every pick
    this.combo.windowBonus = this.mods.comboWindowBonus;
  }

  private applyUpgrade(id: string) {
    if (this.levelPicking) return;
    // The HUD has ALREADY locked the cards + visually "chosen" this one before
    // calling us, so from here EVERY path must end by dismissing the picker and
    // resuming — otherwise the run hangs "stuck on the chosen card". We mark
    // levelPicking immediately and let scheduleLevelUpResume() be the one and
    // only exit; a stale id or a throw inside applyUpgradeCard can't strand it.
    this.levelPicking = true;
    try {
      // the picker only ever offers cards from this.levelCards (deck + limit-breaks)
      const u = this.levelCards.find((x) => x.id === id) ?? RUN_UPGRADES.find((x) => x.id === id);
      if (u) {
        this.applyUpgradeCard(u);
        this.hud.toast(`${u.name}!`);
        this.audio.powerup();
      }
    } catch (e) {
      // A bad upgrade must never freeze the run on the picker — log and recover.
      console.error("level-up apply failed:", e);
    } finally {
      this.scheduleLevelUpResume();
    }
  }

  /** Dismiss the level-up picker and unfreeze the run after the card's selection
   *  animation. The primary resume path (see applyUpgrade); the loop watchdog
   *  (_levelPickAt) is an independent backstop if this timer is ever dropped. */
  private scheduleLevelUpResume() {
    this._levelPickAt = performance.now(); // arm the watchdog
    // let the card's selection animation finish before unfreezing the game
    setTimeout(() => this.resumeFromLevelUp(), 420);
  }

  /** Actually dismiss the picker + resume play. Idempotent and safe to call from
   *  either the setTimeout above or the loop watchdog — whichever fires first. */
  private resumeFromLevelUp() {
    this._levelPickAt = 0; // disarm the watchdog
    this.hud.hideLevelUp();
    this.levelPicking = false;
    if (this.state === "levelup") this.state = "playing";
  }

  private startRun() {
    // leaving the hub for the zombie world: swap scenes back to the arena
    this.disconnectIslandPresence(); // free the island socket during a solo run
    this.setRenderTier(this._lowSpec ? 1.3 : 1.5); // start crisp; the governor drops res if a heavy wave needs it
    this.island.setVisible(false);
    this.arena.group.visible = true;
    this.interactables.setVisible(true); // restore the map fixtures for the run
    this.setLocalAura(0); this.setLocalPlate(false); // drop the lobby cosmetics for the run
    this.hud.setIslandMode(false);
    this.hud.hidePrompt();
    this.hud.hideTdModeSelect();          // dismiss the gateway mode-select panel
    this.hud.setIslandPopulation(-1);     // no social chip during a run
    this.emoteMenu?.setAvailable(false);  // no island emote button in combat
    this.resetRun();
    this.hud.hideStart();
    this.hud.hideGameOver();
    this._runGoldStart = this.save.goldEarned; // baseline for the daily "earn gold" quest
    this.camZoomTarget = 1; // reset hub zoom-out for the run
    this.music.play("zombies"); // dark ambient under the arena
    this.state = "playing";
    // Co-op difficulty: scale by player count (host + guests). Refreshed each
    // frame in simulate() so a mid-run join ramps difficulty at the next round.
    this.rounds.setPlayerCount(1 + (this.netplay?.hostGuestSlots().length ?? 0));
    this.rounds.start();
    this.audio.startMusic(0);
  }

  /** Toast the current co-op difficulty multiplier (host-side). Fires on every
   *  roster change so the squad sees the horde scale as friends join/leave. */
  private announceCoopDifficulty(players: number) {
    if (players <= 1) { this.hud.toast("Solo — standard difficulty"); return; }
    this.hud.toast(`👥 ${players} players — zombies ×${players} HP & ×${players} horde!`);
  }

  private gameOver() {
    if (this.state === "over") return; // guard: never pay out essence / count stats twice
    this.state = "over";
    this.input.firing = false;
    this.audio.stopMusic();
    this.audio.hurt();
    this.hud.hideBoss();
    this.hud.setCurseVisible(false);
    this.hud.setScreenTint(null);
    // Co-op host: let guests know the team wiped (they resume when host replays).
    this.netplay?.hostNotify("Team wiped — waiting for host…");

    // Every run pays out Essence and may set a new personal best. The prestige
    // multiplier (1 + prestige*k) boosts the payout — that's the ascension reward.
    const pMul = prestigeMultiplier(this.save.prestige, PRESTIGE.k);
    // effectiveEssenceMul folds in the Blood Tithe (essenceFromBankers) synergy.
    const earned = Math.round(essenceFor(this.rounds.round, this.points, this.effectiveEssenceMul()) * pMul);
    this.save.essence += earned;
    const newBest = this.rounds.round > this.save.bestRound || (this.rounds.round === this.save.bestRound && this.points > this.save.bestScore);
    if (newBest) {
      this.save.bestRound = Math.max(this.save.bestRound, this.rounds.round);
      this.save.bestScore = Math.max(this.save.bestScore, this.points);
    }
    // Fold this run into the personal leaderboard (top runs by round, then score).
    const entry = { round: this.rounds.round, score: this.points, date: Date.now() };
    const lb = recordScore(this.save.scores, entry);
    this.save.scores = lb.board;

    // Fold this run into lifetime stats, then settle any newly-met challenges.
    this.runStats.round = this.rounds.round;
    const s = this.save.stats;
    s.kills += this.runStats.kills;
    s.crits += this.runStats.crits;
    s.bossKills += this.runStats.bossKills;
    s.drops += this.runStats.drops;
    s.games += 1;
    const bonus = this.settleChallenges();
    this.foldPetTrials();
    this.checkPetEvolutions();
    this.settleDailies(); // fold run into daily quests + pay finished ones

    // Fold this run's gold into the prestige basis, then refresh the menu chip.
    this.reconcileLifetimeGold();

    this.persist();
    this.renderShop();
    this.refreshPrestigeUi();
    this.hud.setBest(this.save.bestRound, this.save.bestScore);
    this.hud.showGameOver(this.rounds.round, this.points, earned + bonus, newBest, this.save.scores, lb.rank);
  }

  /** Award Essence for any challenges completed this run. Returns the total. */
  private settleChallenges(): number {
    let total = 0;
    for (const c of CHALLENGES) {
      if (this.save.claimed.includes(c.id)) continue;
      if (c.progress(this.save.stats, this.runStats) >= c.goal) {
        this.save.claimed.push(c.id);
        this.save.essence += c.reward;
        total += c.reward;
        this.hud.toast(`Challenge: ${c.name}  +${c.reward} ✦`);
      }
    }
    return total;
  }

  // ---- multiplayer ----
  /** Let the player point the client at their own relay (no rebuild needed). */
  private changeServer() {
    const next = window.prompt(
      "Co-op relay server URL (wss://… or https://…):\n\nDeploy the server in /server to Render/Railway/Fly and paste its URL here.",
      getServerUrl(),
    );
    if (next && next.trim()) {
      const url = setServerUrl(next);
      this.hud.setLobbyStatus(`Server set to ${url}`);
    }
  }

  /** Connect the wallet, or disconnect if already connected. */
  private async toggleWallet() {
    if (this.wallet.state.connected) {
      await this.wallet.disconnect();
      return;
    }
    // On the splash the status line + address row are hidden, so the connect
    // button itself is the feedback: show progress, then success (via syncWallet)
    // or a clear failure hint.
    this.hud.setConnectLabel("⏳ Connecting…");
    const addr = await this.wallet.connect();
    if (!addr && !this.wallet.state.connected) {
      this.hud.setConnectLabel(
        this.wallet.available ? "🔗 Connect Wallet (tap to retry)" : "🔗 Open in Phantom to connect",
      );
    }
  }

  /** Reflect wallet state on the menu, then ask the backend what's claimable. */
  private async syncWallet() {
    const s = this.wallet.state;
    if (!s.connected || !s.address) {
      this.hud.setWallet(false, "", "");
      this.hud.setClaimStatus("");
      this.endCloudSession(); // wallet gone → stop pushing, drop the token
      this._earnToken = undefined; // drop the earn session too
      return;
    }
    // Only credit gold earned WHILE connected — baseline the earn mark at connect
    // so prior gold isn't retroactively dumped into a freshly linked wallet.
    this._earnMark = this.save.goldEarned;
    // Cloud-save sync rides the same connect signal as the token check. It's a
    // no-op unless a save backend URL is configured; mid-run it defers until the
    // player is back in the hub so we never pop a sign request during combat.
    this.maybeCloudSync(s.address);
    // Optimistic label until the authoritative backend answers.
    this.hud.setWallet(true, this.wallet.short, "checking…");
    this.hud.setLobbyStatus("Wallet linked.");
    // The ONLY source of truth for claimable tokens is the server ledger.
    const claimable = await fetchClaimable(s.address);
    if (claimable !== null) {
      this.hud.setWallet(true, this.wallet.short, `${claimable} $TINY claimable`);
      this.hud.setClaimStatus(claimable > 0 ? "Ready to claim" : "Keep playing to earn");
    } else {
      // No backend yet — show local Essence as a provisional, unverified preview.
      this.hud.setWallet(true, this.wallet.short, `${this.save.essence} ✦ pending`);
      this.hud.setClaimStatus(getTokenApiUrl() ? "Backend unreachable" : "Set token backend ⚙ to enable claims");
    }
  }

  /** True only in the lobby / menu — never mid-run, TD, or bedwars. Cloud sync
   *  (which can pop a wallet sign request) only runs in these calm states. */
  private inHub(): boolean {
    return this.state === "island" || this.state === "menu";
  }

  /** Report gold earned since the last flush to the $TINY earn backend, which
   *  caps + credits it as claimable. No-op unless a wallet is connected AND a
   *  token backend URL is configured. Signs once per session (lazy login); the
   *  server's per-day caps bound the payout. Called on each return to the hub. */
  private async flushEarnings(): Promise<void> {
    if (this._earnBusy) return;
    const addr = this.wallet.state.address;
    if (!addr || !getTokenApiUrl()) return;
    const delta = Math.floor(this.save.goldEarned - this._earnMark);
    if (delta <= 0) return;
    this._earnBusy = true;
    try {
      if (!this._earnToken) {
        this._earnToken = (await earnLogin(addr, (m) => this.wallet.signText(m))) ?? undefined;
        if (!this._earnToken) return; // declined / unreachable — try again next hub visit
      }
      const res = await reportEarn(this._earnToken, delta);
      if (res === "expired") { this._earnToken = undefined; return; } // re-login next time
      if (res === null) return; // transient failure — keep the mark so we retry the same delta
      this._earnMark = this.save.goldEarned; // credited (even if 0 from daily cap) — advance
      const claimable = await fetchClaimable(addr);
      if (claimable !== null) {
        this.hud.setWallet(true, this.wallet.short, `${claimable} $TINY claimable`);
        if (res > 0) this.hud.toast(`+${res} $TINY earned`);
      }
    } finally {
      this._earnBusy = false;
    }
  }

  /**
   * Log in to the cloud-save backend (if enabled), merge the stored save with the
   * local one losing nothing, apply the result to the live UI, then push it back.
   * Signing pops a wallet popup, so we only do this in the hub — if the wallet
   * connects mid-run we set _cloudDeferred and retry on return (see enterIsland).
   * Fully graceful: any failure leaves the game on its local save.
   */
  private async maybeCloudSync(address: string) {
    if (!cloudEnabled()) return; // no URL → cloud save disabled, pure no-op
    if (this._cloudToken && this._cloudAddr === address) return; // already synced this session
    if (!this.inHub()) { this._cloudDeferred = true; return; } // defer past combat
    if (this._cloudSyncing) return; // a login is already in flight
    this._cloudSyncing = true;
    this._cloudDeferred = false;
    try {
      const resp = await cloudLogin(address, (t) => this.wallet.signText(t));
      if (!resp) {
        this.hud.toast("Cloud save unavailable — playing locally");
        return;
      }
      // Merge cloud ↔ local so neither device rolls the other back, then make the
      // merged save the live one and reflect it everywhere the game shows it.
      const merged = mergeSaves(this.save, sanitizeSave(resp.save ?? {}));
      this.save = merged;
      writeSave(merged);
      this.applyMergedSaveToUi();
      this._cloudToken = resp.token;
      this._cloudAddr = address;
      // Persist the freshly merged blob back so the cloud holds the union too.
      const updated = await cloudPush(address, resp.token, merged, merged.lastSeen);
      if (updated === null) {
        this._cloudToken = undefined; // token rejected → re-login next connect
        this.hud.toast("☁ Synced (push deferred)");
      } else {
        this.hud.toast("☁ Progress synced to your wallet");
      }
    } finally {
      this._cloudSyncing = false;
    }
  }

  /** Reflect a (cloud-merged) save into every live surface the game already uses
   *  after gold/pet/skin/setting changes — gold/essence/market/pets/skins via the
   *  shop rebuild, equipped skin, best-run chip, and mute/volume. */
  private applyMergedSaveToUi() {
    this.audio.setEnabled(!this.save.muted);
    this.music.setEnabled(!this.save.muted);
    this.music.setVolume(this.save.musicVolume);
    this.hud.setBest(this.save.bestRound, this.save.bestScore);
    this.applyPlayerSkin();
    this.renderShop();
    // If we're standing in the hub, re-spawn the equipped squad so newly-merged
    // pets appear immediately (spawnPets reads this.save.pets).
    if (this.state === "island") this.spawnPets();
  }

  /**
   * (Re)arm a debounced push of the latest save to the cloud. Coalesces rapid
   * gold/pet/skin changes into at most one push per ~5s and never blocks the
   * frame. No-op unless we hold a session token. On 401/expiry the token is
   * dropped so the next connect / hub-return re-logins. Never signs.
   */
  private scheduleCloudPush() {
    if (!this._cloudToken || !this._cloudAddr) return;
    if (this._cloudPushTimer) return; // a push is already queued — it'll send the latest
    this._cloudPushTimer = window.setTimeout(() => {
      this._cloudPushTimer = 0;
      const token = this._cloudToken;
      const addr = this._cloudAddr;
      if (!token || !addr) return;
      // Stamp lastSeen so the cloud's "newer side" matches what we just wrote.
      const snapshot = this.save;
      cloudPush(addr, token, snapshot, snapshot.lastSeen).then((updated) => {
        if (updated === null && this._cloudAddr === addr) {
          this._cloudToken = undefined; // expired/invalid → re-login on next connect
        }
      });
    }, 5000);
  }

  /** Persist the save locally AND debounce a cloud push. Use this everywhere we
   *  previously called writeSave(this.save) so gold/pet/skin/score changes both
   *  hit localStorage and (when a wallet session is live) sync to the cloud. */
  private persist() {
    writeSave(this.save);
    this.scheduleCloudPush();
  }

  /** Tear down the cloud session (disconnect / wallet gone): stop pushing, drop
   *  the token so a future connect re-logins cleanly. */
  private endCloudSession() {
    if (this._cloudPushTimer) {
      clearTimeout(this._cloudPushTimer);
      this._cloudPushTimer = 0;
    }
    this._cloudToken = undefined;
    this._cloudAddr = undefined;
    this._cloudDeferred = false;
  }

  /** Ask the reward backend to pay out earnings to the connected wallet. */
  private async claimTokens() {
    this.hud.setClaimStatus("Requesting claim…");
    const r = await this.wallet.requestClaim();
    this.hud.setClaimStatus(r.message);
    this.audio[r.ok ? "powerup" : "deny"]();
    if (r.ok) this.syncWallet();
  }

  /** Point the client at a deployed token-backend (claims route through it). */
  private changeTokenApi() {
    const next = window.prompt(
      "Token reward backend URL (https://…):\n\nDeploy /token-backend and paste its URL here. The backend verifies your wallet, reads its own ledger, and signs the payout — the game client never mints tokens.",
      getTokenApiUrl(),
    );
    if (next === null) return;
    const url = setTokenApiUrl(next);
    this.hud.setClaimStatus(url ? `Backend set: ${url}` : "Backend cleared");
    this.syncWallet();
  }

  /** Tick a "<label>… (Ns)" status so a cold-starting server doesn't look frozen. */
  private connectingTicker(label: string): () => void {
    const t0 = Date.now();
    const tick = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      this.hud.setLobbyStatus(`${label}… ${s}s${s > 8 ? " (free server is waking up — up to ~45s)" : ""}`);
    };
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => clearInterval(iv);
  }

  /**
   * Retry a connect attempt while the free server cold-starts. Render returns a
   * fast 502 (instant onerror) until the dyno is up, so a single try fails
   * immediately — we keep poking /health and retrying for up to ~55s.
   */
  private async connectWithRetry<T>(makeAttempt: () => Promise<T>, budgetMs = 55000): Promise<T> {
    const t0 = Date.now();
    let lastErr: unknown;
    while (Date.now() - t0 < budgetMs) {
      try {
        return await makeAttempt();
      } catch (e) {
        lastErr = e;
        this.net?.close();
        if (Date.now() - t0 >= budgetMs) break;
        warmServer(); // keep nudging the dyno awake
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    throw lastErr ?? new Error("could not reach the server");
  }

  private async hostGame(targetPlayers = 2) {
    this.disconnectIslandPresence(); // free the island socket before co-op
    warmServer(); // poke the dyno in case it's cold-starting
    const stop = this.connectingTicker("Connecting");
    try {
      const { code } = await this.connectWithRetry(() => {
        this.net = new NetClient();
        this.net.onClose = (r) => this.onNetClose(r);
        return this.net.host();
      });
      stop();
      this.netplay = new NetPlay(this.net!, this.scene, this.assets, this.bullets);
      // Announce the co-op difficulty whenever the roster changes (join/leave).
      this.netplay.onRosterChange = (players) => this.announceCoopDifficulty(players);
      this.myId = 1;
      this.startRun();
      this.hud.showRoomCode(code);
      const word = targetPlayers >= 4 ? "Squad (up to 4)" : "Duo (2)";
      this.hud.setLobbyStatus(`Hosting ${word} room ${code} — share the code!`);
    } catch (e) {
      stop();
      console.error("[coop] host failed:", e);
      this.teardownNet();
      this.hud.setLobbyStatus("Server unreachable — it may be asleep or down. Try again in a minute.");
    }
  }

  private modeName(players: number): string {
    return players >= 4 ? "Squad" : players === 2 ? "Duo" : "Solo";
  }

  /**
   * Co-op gather leader: host a fresh room on a SECOND connection (so we can keep
   * the island socket alive long enough to share the code), broadcast it to the
   * portal's other occupants, then transition ourselves into the match as host.
   */
  private async startPortalMatchAsHost(portalId: string, target: number) {
    const stop = this.connectingTicker("Starting match");
    try {
      const coopNet = new NetClient();
      const { code } = await coopNet.host();
      coopNet.onClose = (r) => this.onNetClose(r);
      // tell the other occupants which room to join, then give the relay a beat
      this.islandNet?.sendPortalStart(portalId, code);
      await new Promise((r) => setTimeout(r, 220));
      stop();
      this.disconnectIslandPresence(); // closes the island socket (not coopNet)
      this.net = coopNet;
      this.netplay = new NetPlay(this.net, this.scene, this.assets, this.bullets);
      this.netplay.onRosterChange = (players) => this.announceCoopDifficulty(players);
      this.myId = 1;
      this.startRun();
      this.hud.showRoomCode(code);
      this.hud.setLobbyStatus(`${this.modeName(target)} match — share ${code} for friends!`);
    } catch (e) {
      stop();
      console.error("[gather] host failed:", e);
      this._portalStarting = false;
      this.hud.toast("Couldn't start the match — try again.");
    }
  }

  /** A gather leader hosted a room — join it if I'm waiting in that same portal. */
  private onPortalStart(portal: string, code: string) {
    if (this._portalStarting) return; // I'm the host, or already joining
    if (this._gatherPortal !== portal) return; // not my portal
    this._portalStarting = true;
    this.joinGame(code);
  }

  private async joinGame(code: string) {
    if (!code.trim()) {
      this.hud.setLobbyStatus("Enter a room code");
      return;
    }
    this.disconnectIslandPresence(); // free the island socket before co-op
    warmServer();
    const stop = this.connectingTicker("Joining");
    try {
      const { id } = await this.connectWithRetry(() => {
        this.net = new NetClient();
        this.net.onClose = (r) => this.onNetClose(r);
        return this.net!.join(code);
      });
      stop();
      this.myId = id;
      this.netplay = new NetPlay(this.net!, this.scene, this.assets, this.bullets);
      this.netplay.onToast = (m) => this.hud.toast(m); // host-pushed feedback
      // guests render the host's authoritative world; no local sim
      this.island.setVisible(false);
      this.arena.group.visible = true;
      this.interactables.setVisible(true);
      this.setLocalAura(0); this.setLocalPlate(false);
      this.hud.setIslandMode(false);
      this.hud.hidePrompt();
      this.resetRun();
      this.hud.hideStart();
      this.hud.hideGameOver();
      this.state = "playing";
      this.hud.toast(`Joined ${this.net!.room}`);
    } catch (e) {
      stop();
      console.error("[coop] join failed:", e);
      this.teardownNet();
      // Clear the gather/portal latch so the hub stays interactive after a failed
      // join (otherwise simulateIsland's portal guard freezes all interaction).
      this._portalStarting = false;
      this._gatherPortal = "";
      this.hud.setLobbyStatus("Couldn't join — check the code, or the server may be down.");
    }
  }

  private onNetClose(reason: string) {
    this.teardownNet();
    this.state = "menu";
    this.hud.hideGuestDown(); // a downed guest forced out (e.g. host left) clears the overlay
    this.hud.showStart();
    this.hud.setLobbyStatus(reason);
  }

  private teardownNet() {
    this.netplay?.dispose();
    this.netplay = undefined;
    this.net?.close();
    this.net = undefined;
  }

  // ---- GameApi (used by interactables) ----
  // Points are a shared team pool. When `this.acting` is set, weapon/perk
  // actions target that guest's inventory instead of the host's.
  spend(amount: number): boolean {
    if (this.points < amount) {
      this.toast("Not enough points");
      this.audio.deny();
      return false;
    }
    this.points -= amount;
    this.hud.setPoints(this.points);
    this.audio.buy();
    return true;
  }
  private addPoints(n: number) {
    this.points += n;
    this.hud.setPoints(this.points);
  }

  /** Quantize a points value for the floating "+N" text so we don't mint a
   *  unique GPU texture for every exact number (that churn caused frame hitches).
   *  Buckets keep the distinct-string count small and stable. */
  private floatNum(n: number): string {
    if (n < 100) return `+${Math.round(n / 5) * 5}`;
    if (n < 1000) return `+${Math.round(n / 25) * 25}`;
    return `+${(Math.round(n / 100) / 10).toFixed(1)}k`;
  }
  /** Weapon inventory of whoever is currently acting (host or a guest). */
  private actorWeapons(): Weapon[] {
    return this.acting ? this.acting.weapons : this.weapons;
  }
  private actorSlot(): number {
    return this.acting ? this.acting.activeSlot : this.activeSlot;
  }
  private setActorSlot(i: number) {
    if (this.acting) this.acting.activeSlot = i;
    else this.activeSlot = i;
  }
  private actorWeapon(): Weapon {
    return this.actorWeapons()[this.actorSlot()];
  }
  giveWeapon(id: string) {
    const def = WEAPONS[id];
    const weapons = this.actorWeapons();
    const existing = weapons.findIndex((w) => w.def.id === id);
    if (existing >= 0) {
      const w = weapons[existing];
      w.ammo = def.magSize;
      w.reserve = def.reserve;
      this.setActorSlot(existing);
    } else {
      const w = new Weapon(def);
      if (weapons.length < 2) {
        weapons.push(w);
        this.setActorSlot(weapons.length - 1);
      } else {
        weapons[this.actorSlot()] = w;
      }
    }
    if (!this.acting) this.syncWeaponHud();
  }
  randomBoxWeapon(): string {
    // ~12% of pulls are a wonder weapon; the rest are normal guns.
    if (Math.random() < 0.12) return WONDER_POOL[Math.floor(Math.random() * WONDER_POOL.length)];
    return BOX_POOL[Math.floor(Math.random() * BOX_POOL.length)];
  }
  grantPerk(perk: "tough" | "quick") {
    const perks = this.acting ? this.acting.perks : this.perks;
    const player = this.acting ? this.acting.player : this.player;
    perks.add(perk);
    if (perk === "tough") {
      player.maxHealth = 200;
      player.health = 200;
    } else {
      player.speedMul = 1.35;
      player.reloadMul = 1.7;
    }
  }
  hasPerk(perk: "tough" | "quick"): boolean {
    return (this.acting ? this.acting.perks : this.perks).has(perk);
  }
  upgradeCurrentWeapon() {
    const w = this.actorWeapon();
    if (w.maxUpgraded) {
      this.toast("Fully Pack-a-Punched (+++)");
      return;
    }
    // Cost climbs with each tier: I = base, II = 2x, III = 3x.
    const cost = COSTS.packAPunch * (w.tier + 1);
    if (!this.spend(cost)) return;
    w.upgrade();
    if (!this.acting) this.syncWeaponHud();
    this.toast(`${w.def.name}!`);
  }
  giveRandomGum() {
    const id = this.powerups.randomId();
    const def = this.powerups.grant(id);
    if (!def) return;
    if (id === "fullPockets") {
      for (const w of this.actorWeapons()) w.refill();
      if (!this.acting) this.syncWeaponHud();
    }
    this.audio.powerup();
    this.toast(`${def.name}!`);
  }
  /** Feedback message — shown locally for the host, sent over the wire to a guest. */
  toast(msg: string) {
    if (this.acting && this.netplay) this.netplay.hostToast(this.acting.id, msg);
    else this.hud.toast(msg);
  }

  private get weapon(): Weapon {
    return this.weapons[this.activeSlot];
  }
  private syncWeaponHud() {
    const w = this.weapon;
    this.hud.setWeapon(w.def.name, w.ammo, w.reserveLabel, w.reloading);
    this.player.setWeaponModel(w.def.style);
    this.player.setAimSpread(w.def.spread, w.def.pellets);
  }

  /** Run `fn` with `actor` as the acting player, restoring the previous actor
   *  after. Used so deferred interactable rewards bill the right inventory. */
  private withActor<T>(actor: GuestSlot, fn: () => T): T {
    const prev = this.acting;
    this.acting = actor;
    try {
      return fn();
    } finally {
      this.acting = prev;
    }
  }

  /**
   * A GameApi view bound to one guest. The Mystery Box (and anything else that
   * defers its reward to a later frame) captures this, so the deferred reward
   * still bills/credits the guest who pulled it — not whoever acts next.
   */
  private apiFor(actor: GuestSlot): GameApi {
    const self = this;
    return {
      get points() {
        return self.points;
      },
      spend: (a) => self.withActor(actor, () => self.spend(a)),
      giveWeapon: (id) => self.withActor(actor, () => self.giveWeapon(id)),
      randomBoxWeapon: () => self.randomBoxWeapon(),
      grantPerk: (p) => self.withActor(actor, () => self.grantPerk(p)),
      hasPerk: (p) => self.withActor(actor, () => self.hasPerk(p)),
      upgradeCurrentWeapon: () => self.withActor(actor, () => self.upgradeCurrentWeapon()),
      papInfo: () => self.withActor(actor, () => self.papInfo()),
      triggerTrap: (pos, radius, kind) => self.withActor(actor, () => self.triggerTrap(pos, radius, kind)),
      giveRandomGum: () => self.withActor(actor, () => self.giveRandomGum()),
      toast: (m) => self.withActor(actor, () => self.toast(m)),
    };
  }

  /** Live Pack-a-Punch state for the acting player's weapon (station prompt). */
  papInfo(): { cost: number | null; tier: number } {
    const w = this.actorWeapon();
    return { cost: w.maxUpgraded ? null : COSTS.packAPunch * (w.tier + 1), tier: w.tier };
  }

  /** Host: run any guest interactions queued this tick (buy / perk / Pack-a-Punch). */
  private processGuestInteractions() {
    if (!this.netplay) return;
    for (const slot of this.netplay.hostGuestSlots()) {
      if (!slot.wantInteract) continue;
      slot.wantInteract = false;
      if (!slot.player.alive) continue;
      const near = this.interactables.nearest(slot.player.pos);
      if (near) near.interact(this.apiFor(slot));
    }
  }

  // ---- main loop ----
  /** Apply the current adaptive DPR to the renderer + composer (rebuilds the
   *  post-stack buffers at the new internal resolution). */
  private applyPixelRatio() {
    // Supersample on low-DPI displays — render above native and downsample so the
    // voxel art reads crisp instead of soft on a standard 1× monitor. The hub
    // pushes 2× (perf doesn't matter in the lobby); the heavy horde never SS's.
    // Note the SS floor also lifts the adaptive-scale floor (2× × 0.55 ≈ 1.1×),
    // so even under load the lobby never drops below native resolution.
    const base = Math.max(devicePixelRatio, this._ss);
    const pr = Math.min(base, this._dprCap) * this._dprScale;
    this.renderer.setPixelRatio(pr);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(innerWidth, innerHeight);
  }

  /** Set the device-pixel-ratio ceiling for the scene we're entering and snap the
   *  internal render scale back to full (crisp). Light scenes (lobby / Tower
   *  Defense) get a higher ceiling than the heavy zombie horde, so they render
   *  sharp on phones instead of inheriting the horde's low scale. The frame
   *  governor still steps the scale back down if THIS scene actually struggles. */
  private setRenderTier(cap: number, ss = 1) {
    this._dprCap = cap;
    this._ss = ss;
    this._dprScale = 1;
    this._ftSmooth = 1 / 60;
    this._adaptT = 0;
    this.applyPixelRatio();
  }

  /** Frame-time governor: if frames run long for a sustained stretch, step the
   *  internal resolution down (to 55% min); recover slowly when there's
   *  headroom. This is what keeps dense waves playable on phones. */
  private governFrameBudget(dt: number) {
    this._ftSmooth += (dt - this._ftSmooth) * 0.05;
    this._adaptT += dt;
    // React FASTER when frames are badly over budget (e.g. the horde-rise spike):
    // a hard overrun (>~30fps sustained) may step down after 0.5s, not the full
    // 1.5s, so the heaviest moments don't stall for seconds before adapting.
    const hardOverrun = this._ftSmooth > 0.033;
    const minInterval = hardOverrun ? 0.5 : 1.5;
    if (this._adaptT < minInterval) return;
    if (this._ftSmooth > 0.026 && this._dprScale > 0.55) {
      // sustained under ~38fps → drop internal res (a bigger step on a hard overrun)
      this._dprScale = Math.max(0.55, this._dprScale - (hardOverrun ? 0.2 : 0.15));
      this.applyPixelRatio();
      this._adaptT = 0;
    } else if (this._ftSmooth < 0.0168 && this._dprScale < 1) {
      // comfortable headroom → climb back gently
      this._dprScale = Math.min(1, this._dprScale + 0.07);
      this.applyPixelRatio();
      this._adaptT = 0;
    }
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    let dt = Math.min(0.05, this.clock.getDelta());
    this.governFrameBudget(dt);

    if (this.input.pressed("KeyP") || this.input.pressed("Escape")) {
      if (this.state === "playing") this.pauseGame();
      else if (this.state === "paused") this.resumeGame();
    }
    if (this.input.pressed("KeyF") && this.state === "playing" && this.nukeCharge >= 1) {
      this.nukeCharge = 0;
      this.nukeBoard();
      this.zoomPunch = 1;
      this.floaters.spawn(this.player.pos, "NUKE!", "#ff7a3a", 1.6, true);
    }
    if (this.input.pressed("KeyM")) this.toggleMasterMute();

    // Level-up picker: keyboard shortcuts (1/2/3 to pick, R to reroll).
    if (this.state === "levelup") {
      if (this.input.pressed("Digit1")) this.hud.pickLevelByIndex(0);
      else if (this.input.pressed("Digit2")) this.hud.pickLevelByIndex(1);
      else if (this.input.pressed("Digit3")) this.hud.pickLevelByIndex(2);
      else if (this.input.pressed("KeyR")) this.hud.triggerReroll();
    }
    // Watchdog: if a pick was committed but the normal resume never fired (a
    // dropped/throttled setTimeout in a backgrounded tab, etc.), force the run
    // back to playing so it can NEVER hang on the chosen card. Frame-loop based,
    // independent of any timer. 2s >> the 420ms selection animation.
    if (this._levelPickAt && performance.now() - this._levelPickAt > 2000) {
      console.warn("level-up resume watchdog fired — forcing resume");
      this.resumeFromLevelUp();
    }

    this.input.updateAim(this.camera);

    // Keyboard zoom (+/= zoom in, -/_ zoom out); mirrors the wheel/pinch.
    if (this.input.pressed("Equal") || this.input.pressed("NumpadAdd")) this.nudgeZoom(1 / 1.15);
    if (this.input.pressed("Minus") || this.input.pressed("NumpadSubtract")) this.nudgeZoom(1.15);

    // Hit-stop: briefly freeze the sim (not rendering/FX) for impact weight.
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt = 0;
    }

    // Chronos OVERDRIVE: PERMANENT 2x. While Chronos is in the active squad the
    // ENTIRE sim runs at double speed for the whole run (the only pet that does
    // this) — not a timed proc, so it never flickers on/off. Live play only.
    const warpActive = this.state === "playing" && this.chronosActive;
    if (warpActive) dt *= 2;
    this.hud.setOverdrive(warpActive); // persistent "2× OVERDRIVE" banner

    this.touch?.setActive(this.state === "playing" || this.state === "paused" || this.state === "island" || this.state === "bedwars" || this.state === "td");
    // Reload/Swap/Nuke buttons only in the shooter; lobby/TD/BW just need E + emote
    this.touch?.setCombatButtons(this.state === "playing" || this.state === "paused");
    // Right-hand AIM stick only where you actually shoot (zombies + Bed Wars).
    // The lobby and Tower Defense move-only, so suppress the stray aim stick.
    this.touch?.setAimEnabled(this.state === "playing" || this.state === "paused" || this.state === "bedwars");
    this.player.showAimGuide(this.state === "playing");
    if (this.state === "playing") {
      if (this.netplay && !this.netplay.isHost) this.simulateGuest(dt);
      else this.simulate(dt);
    } else if (this.state === "island") {
      this.simulateIsland(dt);
    } else if (this.state === "bedwars") {
      this.simulateBedwars(dt);
    } else if (this.state === "td") {
      this.simulateTd(dt);
    } else {
      this.player.idle(dt); // keep the figure breathing on menu / pause / over
      // Splash backdrop: step + render other players so the lobby looks alive.
      // No-op in pause/over (presence is disconnected there → islandNet undefined).
      this.islandNet?.update(dt, {
        x: this.player.pos.x, z: this.player.pos.z,
        ry: this.player.group.rotation.y, moving: false,
      });
    }

    this.island.update(dt);
    this.arena.update(dt);
    this.interactables.update(dt);
    this.puffs.update(dt);
    this.explosions.update(dt);
    this.sparks.update(dt);
    this.decals.update(dt); // corpse decals: linger then fade + recycle
    this.floaters.update(dt);
    this.updateCamera(dt);

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera); // lowSpec: direct + MSAA
    this.input.endFrame();
  };

  /** Flip the master mute (audio + music follows) and persist it. Returns the
   *  new muted state so callers (e.g. the pause menu toggle) can update labels. */
  private toggleMasterMute(): boolean {
    this.audio.setEnabled(!this.audio.enabled);
    this.save.muted = !this.audio.enabled;
    this.music.setEnabled(!this.save.muted); // music follows the master mute
    this.persist();
    return this.save.muted;
  }

  /** Pause the run and raise the pause/settings overlay (RESUME · QUIT · mute ·
   *  music volume). Reachable on desktop (P/Escape) and mobile (touch Pause btn).
   *  Quit leaves the run cleanly to the hub (toMenu → menu, then enterIsland). */
  private pauseGame() {
    this.state = "paused";
    this.hud.showPause({
      muted: this.save.muted,
      volume: this.save.musicVolume,
      onResume: () => this.resumeGame(),
      onQuit: () => this.quitRunToIsland(),
      onToggleMute: () => this.toggleMasterMute(),
      onVolume: (v) => {
        this.save.musicVolume = v;
        this.music.setVolume(v);
        this.persist();
      },
    });
  }

  /** Dismiss the pause overlay and resume play. */
  private resumeGame() {
    this.hud.hidePause();
    if (this.state === "paused") this.state = "playing";
  }

  /** Quit the active run from the pause menu: tear the run down like a normal
   *  exit (toMenu settles net + resets), then drop the player back in the hub. */
  private quitRunToIsland() {
    this.hud.hidePause();
    this.toMenu();        // clean teardown: disconnect net, resetRun, show menu state
    this.enterIsland();   // …then hop straight into the island hub
  }

  /** Enter the Bed Wars-lite mode (vertical slice): hide hub/arena, load the BW
   *  world, spawn on your team island, resources start ticking. */
  private enterBedWars() {
    if (!this.bw) this.bw = new BedWarsMode(this.scene, () => this.leaveBedWars()); // on-screen "✕ Leave" (mobile)
    this.disconnectIslandPresence();
    this.setRenderTier(this._lowSpec ? 1.4 : 2, this._lowSpec ? 1 : 1.5); // crisp start; parity with enterTd/enterIsland
    this.island.setVisible(false);
    this.arena.group.visible = false;
    this.interactables.setVisible(false);
    this.setLocalAura(0); this.setLocalPlate(false);
    this.hud.hideEggPanel();
    this.hud.hidePrompt();
    this.hud.hideTdModeSelect();  // dismiss the gateway mode-select panel
    this.hud.hideCombatHud(true); // hide combat HUD; BW draws its own resource HUD
    this.hud.setIslandPopulation(-1); // drop the "N players here" presence chip
    this.emoteMenu?.setAvailable(false); // hide the island emote button (T = upgrades here)
    // Arm the raider with a fast auto SMG (own loadout, separate from the run).
    this.weapons = [new Weapon(WEAPONS.buzzgun)];
    this.activeSlot = 0;
    this.bullets.clear();
    this._bwEndTimer = 0;
    this.music.play("td"); // the calm-focused mood suits Bed Wars too
    this.bw.enter();
    this.player.pos.copy(this.bw.spawn());
    this.player.group.position.copy(this.player.pos);
    this.camZoomTarget = 1.9;
    this.applyPlayerSkin();
    this.spawnPets();
    this.state = "bedwars";
  }

  private leaveBedWars() {
    this.bw?.leave();
    this.bullets.clear();
    this.hud.hidePrompt();
    this.enterIsland();
  }

  /** Gate the wager variant behind an honest confirm dialog (stake / payout /
   *  90-10 House rake / mid-match forfeit warning) before any gold leaves the
   *  balance; every other variant enters straight away. All TD entry points go
   *  through here so the confirm can never be bypassed. */
  private requestTd(kind: "solo" | "duel" | "endless" | "daily" | "wager") {
    if (kind !== "wager") { this.enterTd(kind); return; }
    const stake = WAGER_STAKES[1]; // 250g table for v1 (matches enterTd)
    this.hud.hideTdModeSelect();
    this.hud.showWagerConfirm(
      { stake, payout: wagerPayout(stake), fee: stake * 2 - wagerPayout(stake), canAfford: this.save.gold >= stake },
      () => this.enterTd("wager"),
    );
  }

  /** Enter Tower-Defense: hide hub/arena, load the TD field; you're the engineer
   *  who walks between pads raising towers while waves march your lane.
   *  Variants: solo (18 waves) · duel (vs AI) · endless · daily (seeded, one
   *  attempt/day) · wager (a gold-staked duel — 90% of the pot to the winner). */
  private enterTd(kind: "solo" | "duel" | "endless" | "daily" | "wager" = "solo") {
    if (!this.td) this.td = new TdMode(this.scene);
    this.td.onLeave = () => this.leaveTd(); // on-screen "✕ Leave" → clean quit (mobile has no Escape)
    this._tdIsDaily = false;
    this._tdWager = null;
    let mode: "solo" | "duel" = "solo";
    let opts: TdEnterOpts = {};
    if (kind === "duel") mode = "duel";
    else if (kind === "endless") opts = { endless: true };
    else if (kind === "daily") {
      const today = tdDailyDay();
      if (!tdDailyAvailable(this.save.tdDailyDay, today)) {
        this.hud.toast(`🗓 Daily done — wave ${this.save.tdDailyWave}. New challenge at midnight UTC!`);
        return;
      }
      // the attempt is consumed on ENTRY (no retry-scumming via refresh)
      this.save.tdDailyDay = today;
      this.save.tdDailyWave = 0;
      this.persist();
      this._tdIsDaily = true;
      opts = { endless: true, daily: tdDailyMods(today) };
    } else if (kind === "wager") {
      const stake = WAGER_STAKES[1]; // 250g table for v1
      if (this.save.gold < stake) {
        this.hud.toast(`Need ${stake} 🪙 to sit at the wager table`);
        return;
      }
      // stake leaves your balance NOW and lives in the locked pot
      this.save.gold -= stake;
      this.persist();
      this._tdWager = createWager(stake, "you", "treasury-bot");
      mode = "duel";
      this.hud.toast(`💰 ${stake}g staked vs the House — win the duel for ${wagerPayout(stake)}g`);
    }
    this.disconnectIslandPresence();
    this.island.setVisible(false);
    this.arena.group.visible = false;
    this.interactables.setVisible(false);
    this.setLocalAura(0); this.setLocalPlate(false);
    this.hud.hideEggPanel();
    this.hud.hidePrompt();
    this.hud.hideTdModeSelect();      // dismiss the gateway mode-select panel
    this.hud.hideCombatHud(true);     // hide combat HUD; TD draws its own
    this.hud.setIslandPopulation(-1); // drop the island presence chip
    this.emoteMenu?.setAvailable(false);
    this.weapons = [];                // no personal weapon — your towers do the shooting
    this.bullets.clear();
    this._tdEndTimer = 0;
    this.td.enter(mode, opts);
    this.setRenderTier(this._lowSpec ? 1.5 : 2, this._lowSpec ? 1 : 1.5); // TD is light — render it sharp (governor drops only if it struggles)
    this.player.pos.copy(this.td.spawn());
    this.player.group.position.copy(this.player.pos);
    this.camZoomTarget = 2.2;         // pull back to read the whole lane
    this.applyPlayerSkin();
    this.spawnPets();
    this.music.play("td");
    this.state = "td";
  }

  private leaveTd() {
    this.settleTdSession();
    this.td?.leave();
    this.hud.hidePrompt();
    this.enterIsland();
  }

  /** Fold the finished TD session into persistence: best-wave record, the daily
   *  score, cross-mode quest progress, and any unsettled wager (leaving a
   *  wagered duel mid-match is a FORFEIT — anti rage-quit). */
  private settleTdSession() {
    const td = this.td;
    if (!td) return;
    // wager: settle if the duel ended; forfeit if the player bailed mid-match
    if (this._tdWager) {
      const won = td.result.over && td.result.win;
      const r = resolveWager(this._tdWager, won ? "you" : "treasury-bot");
      if (won) {
        this.save.gold += r.payout;
        this.save.goldEarned += r.payout;
        this.hud.toast(`💰 Wager won  +${r.payout} 🪙 (the House kept ${r.fee})`);
      } else {
        this.hud.toast(td.result.over ? `💸 Wager lost — ${this._tdWager.stake} 🪙 to the House` : "💸 Left the table — stake forfeited");
      }
      this._tdWager = null;
    }
    // endless/daily score: the wave you fell on (or cleared up to)
    const reached = Math.max(td.wavesCleared, td.result.over ? td.wave : Math.max(0, td.wave - 1));
    if (reached > this.save.bestWave) {
      this.save.bestWave = reached;
      this.hud.toast(`🌊 New best — wave ${reached}!`);
    }
    // run score (combo-fed) — the replay chase. Record the personal best.
    if (td.score > this.save.tdBestScore) {
      this.save.tdBestScore = td.score;
      this.hud.toast(`🏅 New TD high score — ${td.score.toLocaleString()}! (best combo ×${td.bestCombo})`);
    }
    if (this._tdIsDaily) {
      this.save.tdDailyWave = Math.max(this.save.tdDailyWave, reached);
      this._tdIsDaily = false;
    }
    // cross-mode daily quests: TD waves + duel wins
    this.applyQuestProgress({
      waves: td.wavesCleared,
      duels: td.mode === "duel" && td.result.over && td.result.win ? 1 : 0,
    });
  }

  /** Walk the engineer, build/upgrade/sell at pads, call waves, run the loop. */
  private simulateTd(dt: number) {
    const td = this.td;
    if (!td) return;

    if (td.result.over) {
      if (this._tdEndTimer > 0) { this._tdEndTimer -= dt; if (this._tdEndTimer <= 0) this.leaveTd(); }
      this.player.idle(dt);
      td.tick(dt, this.player.pos);
      return;
    }

    // hit-stop: briefly slow the TD sim on big hits (decay by REAL dt, then scale)
    this._tdFreeze = Math.max(0, this._tdFreeze - dt);
    const simDt = this._tdFreeze > 0 ? dt * 0.12 : dt;

    // move the engineer (no aiming/firing — towers fight for you)
    const axis = this.input.moveAxis(this._axis);
    this.player.update(simDt, axis.x, -axis.y, this.input.aimPoint, false);
    td.clamp(this.player.pos);
    this.player.group.position.copy(this.player.pos);
    this.pets.forEach((p, i) => p.update(simDt, this.player.pos.x, this.player.pos.z, i, this.pets.length, null));

    // Context-sensitive controls:
    //  • at an empty pad → 1-5 build a tower
    //  • at your tower   → E upgrade · X sell · T cycle target
    //  • away from pads (Duel) → 1-5 send a creep tier at the opponent
    // (The TD HUD shows the build palette + tower panel; here we just read keys.)
    const pad = td.nearestPad(this.player.pos);
    const dkeys = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7"] as const;
    if (pad >= 0) {
      if (td.towerAt(pad)) {
        if (this.input.pressed("KeyE")) td.upgrade(pad);
        if (this.input.pressed("KeyX")) td.sell(pad);
        if (this.input.pressed("KeyT")) td.cycleTarget(pad);
        this.hud.hidePrompt();
      } else {
        for (let i = 0; i < TD_TOWER_IDS.length; i++) if (this.input.pressed(dkeys[i])) td.build(pad, TD_TOWER_IDS[i]);
        this.hud.hidePrompt();
      }
    } else if (td.mode === "duel") {
      const sends = td.unlockedSendIds();
      this.hud.showPrompt(
        "Send at opponent: " + sends.map((id, i) => `${i + 1} ${duelSendById(id)?.name}`).join(" · "),
        true,
      );
      for (let i = 0; i < sends.length; i++) if (this.input.pressed(dkeys[i])) td.send(sends[i]);
    } else {
      this.hud.hidePrompt();
    }

    if (td.isBetweenWaves && this.input.pressed("Space")) td.startNextWave();

    td.tick(simDt, this.player.pos);
    this.shake = Math.min(0.6, this.shake + td.consumeShake()); // TD events shake the camera
    this._tdFreeze = Math.max(this._tdFreeze, td.consumeHitStop()); // big hits freeze briefly

    if (td.result.over) {
      this.hud.hidePrompt();
      this.hud.toast(td.result.win ? "🏆 All waves cleared — base held!" : "💀 The base was overrun.");
      this.audio.shoot(td.result.win ? 0.9 : 0.2);
      this._tdEndTimer = 3.4;
    }
    if (this.input.pressed("Escape")) this.leaveTd();
  }

  /** Raid + defend: move, shoot raiders & enemy beds, shop at your base, win/lose. */
  private simulateBedwars(dt: number) {
    const bw = this.bw;
    if (!bw) return;

    // Win/lose already decided: run the leave countdown and freeze the loop.
    if (bw.result.over) {
      if (this._bwEndTimer > 0) {
        this._bwEndTimer -= dt;
        if (this._bwEndTimer <= 0) this.leaveBedWars();
      }
      this.player.idle(dt);
      bw.tick(dt);
      return;
    }

    // A shop modal (items or team upgrades) owns input while open — freeze
    // movement/fire; the modal closes itself on Escape/backdrop.
    if (bw.anyMenuOpen) {
      this.player.idle(dt);
      bw.tick(dt, this.player.pos);
      for (const msg of bw.drainAnnouncements()) this.hud.toast(msg);
      return;
    }

    // Dead and waiting to respawn (your bed still stands): freeze + sit it out.
    // When the clock runs out BW re-seats you at base; we mirror that here.
    if (bw.playerWaiting) {
      this.player.idle(dt);
      bw.tick(dt, this.player.pos);
      for (const msg of bw.drainAnnouncements()) this.hud.toast(msg);
      if (bw.consumeRespawn()) {
        this.player.pos.copy(bw.spawn());
        this.player.group.position.copy(this.player.pos);
      }
      this.hud.hidePrompt();
      if (this.input.pressed("Escape")) this.leaveBedWars();
      return;
    }

    // --- movement + aim (mirrors simulate()) ---
    const axis = this.input.moveAxis(this._axis);
    if (this.input.touchAim) {
      this.input.aimPoint.set(
        this.player.pos.x + this.input.touchAim.x * 6, 0,
        this.player.pos.z + this.input.touchAim.y * 6,
      );
    }
    const aiming = this.input.firing || this.input.touchAim != null;
    this.player.speedMul = bw.playerSpeedMul(); // Counter-Offensive trap buff
    this.player.update(dt, axis.x, -axis.y, this.input.aimPoint, aiming);
    bw.clamp(this.player.pos);
    this.player.group.position.copy(this.player.pos);
    this.pets.forEach((p, i) => p.update(dt, this.player.pos.x, this.player.pos.z, i, this.pets.length, null));

    // --- weapon fire (Maniac Miner haste speeds the fire rate) ---
    const w = this.weapon;
    w.update(dt, this.player.reloadMul);
    const wantFire = this.input.touchAim ? true : w.def.auto ? this.input.firing : this.input.clicked();
    if (wantFire) {
      const f = this._fire;
      f.fireRateMul = bw.fireRateMul(); f.bonusPellets = 0; f.pierceBonus = 0;
      f.scaleMul = 1; f.homing = 0; f.bounces = 0;
      if (w.tryFire(this.player.muzzle, this.player.aimDir, this.bullets, f)) {
        this.player.flash();
        this.audio.shoot(0.4);
      }
    }
    if (this.input.pressed("KeyR")) w.reload();

    this.bullets.update(dt);
    // Per-bullet: hand the impact point to BW, which damages raiders, the enemy
    // guardian, or the enemy bed (in that priority).
    for (const b of this.bullets.bullets) {
      if (!b.alive) continue;
      const hit = bw.resolveHit(b.mesh.position, b.damage);
      if (hit) {
        const col = hit === "bed" ? 0xff5a4a : hit === "guard" ? 0xffffff : 0xffe14a;
        this.sparks.burst(b.mesh.position, col, 5, { speed: 8, spread: 2, streak: true });
        this.bullets.retire(b);
      }
    }

    // --- shops near base: E = Item Shop, T = Team Upgrades ---
    const nearBase = this.player.pos.distanceTo(bw.shopSpot()) < 4.5;
    if (nearBase) this.hud.showPrompt("E — Item Shop   ·   T — Team Upgrades", true);
    else this.hud.hidePrompt();
    if (nearBase && this.input.pressed("KeyE")) bw.openShop();
    if (nearBase && this.input.pressed("KeyT")) bw.openUpgrades();

    bw.tick(dt, this.player.pos);

    // Timed Game-Progression callouts (generator tiers, bed destruction, dragons).
    for (const msg of bw.drainAnnouncements()) this.hud.toast(msg);

    // --- win / lose ---
    if (bw.result.over) {
      this.hud.hidePrompt();
      this.hud.toast(bw.result.win ? "🏆 Victory! Every enemy eliminated." : "💀 Defeat — your bed fell and you're out.");
      this.audio.shoot(bw.result.win ? 0.9 : 0.2);
      this._bwEndTimer = 3.2;
    }

    if (this.input.pressed("Escape")) this.leaveBedWars();
  }

  /** Enter the island hub: hide the arena, show the island, drop the player in. */
  private enterIsland() {
    this.teardownNet();
    this.setRenderTier(this._lowSpec ? 1.6 : 3, this._lowSpec ? 1.4 : 2); // lobby renders extra-sharp (2× supersample on desktop — perf doesn't matter here)
    this.music.play("hub"); // warm lofi for the lobby
    this.state = "island";
    this.hud.hideStart();
    this.hud.hideGameOver();
    this.arena.group.visible = false;
    this.island.setVisible(true);
    this.player.alive = true;
    this.player.pos.set(0, 0, 11); // stand at the front of the village square
    this.camZoomTarget = 1.9; // framed so the hub fills the view without showing the empty water/horizon band below the island (wheel/pinch to pull back further)
    // hide the zombie-map fixtures (perk pads, gum, mystery box, traps) + any
    // leftover loot — the hub shares world coords with the arena.
    this.interactables.setVisible(false);
    this.drops.clearAll();
    this._portalStarting = false; // fresh gather state on (re)entering the hub
    this._gatherPortal = "";
    this._dwellZone = ""; // no auto-enter charge until we actually stand in a portal
    this._dwellTime = 0;
    this.island.setDailyReady(dayUtc(Date.now()) !== this.save.dailyChestDay); // chest glow
    this.spawnPets(); // bring the equipped squad into the hub so they follow + flex
    this.setLocalAura(this.auraTierFor()); // show my own earned aura in the hub
    this.setLocalPlate(true); // and my own nameplate over my head
    this.player.group.position.copy(this.player.pos);
    this.hud.setIslandMode(true);
    this.emoteMenu?.setAvailable(true);
    this.islandPop = -1; // force the population indicator to refresh
    // spawn burst: a friendly arrival pop so dropping in feels like an event
    this.portalBurst(this.player.pos);
    this.connectIslandPresence();
    // A wallet that connected mid-run deferred its cloud sync — now that we're
    // back in the calm hub, run it (safe to sign here). No-op if already synced.
    const addr = this.wallet.state.address;
    if (addr && (this._cloudDeferred || (cloudEnabled() && !this._cloudToken))) {
      this.maybeCloudSync(addr);
    }
    // Settle this run's gold into claimable $TINY (no-op without wallet + backend).
    void this.flushEarnings();
  }

  /** Join the shared island instance so other players appear (best-effort). */
  private async connectIslandPresence() {
    // Guard against double-connect: islandNet/net set once connected, _islandConnecting
    // covers the in-flight window (so a second call can't open a 2nd socket → 2nd room).
    if (this.islandNet || this.net || this._islandConnecting) return;
    this._islandConnecting = true;
    warmServer();
    try {
      this.net = new NetClient();
      this.net.onClose = () => this.disconnectIslandPresence();
      await this.net.island();
      const skin = findSkin(this.save.skin);
      this.islandNet = new IslandNet(this.net, this.scene, skin.body, skin.head, this.save.name);
      console.log("[island] connected as id", this.net.id, "room peers", [...this.net.peers], "state", this.state);
      // a peer hatched an egg → play the celebration over their figure for us too
      this.islandNet.onHatch = (x, z, rarity, shiny, petId) => this.hatchCelebration(x, z, rarity, shiny, petId, true);
      // the co-op gather leader hosted a room → join it if I'm in that portal
      this.islandNet.onPortalStart = (portal, code) => this.onPortalStart(portal, code);
      this.updateIslandFlex(); // broadcast my squad + title + prestige to peers
      this.islandNet.setMenuOpen(this.emoteMenu?.isOpen ?? false);
      if (this.state === "island") this.hud.toast("Island: press T to emote 👋"); // not on the splash backdrop
    } catch {
      // presence is optional — the hub still works solo if the relay is asleep
      this.net?.close();
      this.net = undefined;
      this.hud.setLobbyStatus("Island presence offline (relay asleep) — hub still works.");
    } finally {
      this._islandConnecting = false;
    }
  }

  private disconnectIslandPresence() {
    this.islandNet?.dispose();
    this.islandNet = undefined;
    this.net?.close();
    this.net = undefined;
  }

  /** Leave the island back to the classic menu (arena visible behind it). */
  private leaveIsland() {
    this.disconnectIslandPresence();
    this.hud.hideEggPanel();
    this.setLocalAura(0); this.setLocalPlate(false);
    this.island.setVisible(false);
    this.arena.group.visible = true;
    this.hud.setIslandMode(false);
    this.hud.hidePrompt();
    this.emoteMenu?.setAvailable(false); // also closes the menu if open
    this.hud.setIslandPopulation(-1); // hide the "N players here" chip
    this.updateSelfBubble(999); // drop any lingering speech bubble
    this.state = "menu";
    this.hud.showStart();
  }

  /** Free-roam the island: walk the character, clamp to shore, drive prompts. */
  private simulateIsland(dt: number) {
    const axis = this.input.moveAxis(this._axis);
    const moving = axis.x !== 0 || axis.y !== 0;
    // aiming=false → the character faces where it walks (no gun aim in the hub)
    this.player.update(dt, axis.x, -axis.y, this.input.aimPoint, false);
    this.island.clamp(this.player.pos);
    this.player.group.position.copy(this.player.pos);

    // Equipped pets float around you in the hub so you can flex them (no combat
    // here — target=null just orbits + idles them around the player).
    this.pets.forEach((p, i) =>
      p.update(dt, this.player.pos.x, this.player.pos.z, i, this.pets.length, null));

    // open the emote wheel + quick-chat with "T" (touch uses the on-screen button)
    if (this.input.pressed("KeyT")) this.emoteMenu?.toggle();

    // footstep puff under the chibi while walking (throttled + pooled)
    if (moving) {
      this.footstepAcc += dt;
      if (this.footstepAcc >= 0.18) {
        this.footstepAcc = 0;
        this.sparks.burst(this.player.pos, 0xe6d9a8, 3, { speed: 1.6, spread: 0.8, gravity: 10 });
      }
    } else {
      this.footstepAcc = 0.18; // puff immediately on the next step
    }

    // my own speech bubble lifetime + reactive pads (bounce/brighten on stand)
    this.updateSelfBubble(dt);
    this.island.reactPads(this.player.pos, dt);

    // broadcast my pose + render other players on this island instance
    this.islandNet?.update(dt, {
      x: this.player.pos.x, z: this.player.pos.z,
      ry: this.player.group.rotation.y, moving,
    });

    // "N players here" social presence chip (only refresh on change)
    const pop = (this.islandNet?.peerCount ?? 0) + 1; // +1 = me
    if (pop !== this.islandPop) {
      this.islandPop = pop;
      this.hud.setIslandPopulation(pop);
    }

    // refresh the lobby leaderboard ~once a second (me + every named peer)
    this._lbAcc = (this._lbAcc ?? 0) + dt;
    if (this._lbAcc >= 1) {
      this._lbAcc = 0;
      const me = { name: this.save.name, best: this.save.bestRound };
      this.island.setLeaderboard([me, ...(this.islandNet?.standings() ?? [])]);
    }

    // a dismissable menu (shop / pet index) is up → E / Space / Esc closes it,
    // and nothing else happens behind it this frame.
    if (this.hud.isMenuOpen()) {
      if (this.input.pressed("KeyE") || this.input.pressed("Space") || this.input.pressed("Escape")) this.hud.closeTopMenu();
      this.hud.hidePrompt();
      this.hud.hideEggPanel();
      return;
    }

    // while a hatch reveal is on screen, keep the world prompts hidden behind it
    if (this._hatching) { this.hud.hideEggPanel(); this.hud.hidePrompt(); return; }
    // a portal match is launching — hold prompts until we transition out
    if (this._portalStarting) { this.hud.hideEggPanel(); this.hud.hidePrompt(); return; }

    // proximity prompt for the nearest interactive pad / egg / mode gate
    const near = this.island.nearestZone(this.player.pos);

    // Duo & Squad are temporarily disabled — intercept those pads before any
    // gather/dwell/host logic and just show "Coming Soon". (Solo still works.)
    if (near && near.kind === "mode" && (near.modePlayers ?? 1) >= 2) {
      if (this._gatherPortal) { this._gatherPortal = ""; this.islandNet?.setPortal(null); }
      this.hud.hideEggPanel();
      this.hud.showPrompt("Duo & Squad — Coming Soon ⏳", false);
      return;
    }

    // Co-op GATHER: standing in a Duo/Squad portal (online) pools players; when it
    // hits the target the lowest-id occupant hosts a room, shares the code over
    // the relay, and everyone jumps into the match together. Walk off to cancel.
    const gatherZone = near && near.kind === "mode" && (near.modePlayers ?? 1) >= 2 ? near : null;
    if (gatherZone && this.islandNet) {
      const target = gatherZone.modePlayers!;
      this._gatherPortal = gatherZone.id;
      this.islandNet.setPortal(gatherZone.id);
      const occ = [this.islandNet.localId, ...this.islandNet.occupants(gatherZone.id)];
      const count = occ.length;
      this.hud.hideEggPanel();
      this.hud.showPrompt(`🚪 ${this.modeName(target)} — waiting ${Math.min(count, target)}/${target}…  (walk off to cancel)`, true);
      if (count >= target) {
        this._portalStarting = true;
        // deterministic leader: lowest id hosts; everyone else waits for the code
        if (this.islandNet.localId === Math.min(...occ)) {
          this.startPortalMatchAsHost(gatherZone.id, target);
        } else {
          // waiting on the leader's code — recover if it never arrives (e.g. the
          // leader walked off the pad at the last instant) so we don't soft-lock.
          window.setTimeout(() => {
            if (this._portalStarting && this.state === "island") this._portalStarting = false;
          }, 5000);
        }
      }
      return; // gather portals don't use the normal [E] activation
    }
    // left the portal — clear my gather state
    if (this._gatherPortal) { this._gatherPortal = ""; this.islandNet?.setPortal(null); }

    const egg = near?.kind === "egg" ? findEgg(near.eggId ?? "") : undefined;

    // Auto-enter: walking into a "join the game" structure (zombie portals, the
    // Tower Defense gateway, the Bed Wars portal) charges a short timer and then
    // launches — no button press needed. Walk off to cancel. Vendors (shop, eggs,
    // pets, wardrobe, daily chest, wheel) still want a deliberate [E] press.
    const autoPortal = !!near && (near.kind === "mode" || near.kind === "td" || near.kind === "bedwars");
    if (autoPortal && near) {
      if (this._dwellZone !== near.id) { this._dwellZone = near.id; this._dwellTime = 0; }
      this._dwellTime += dt;
    } else {
      this._dwellZone = "";
      this._dwellTime = 0;
    }
    const DWELL = 0.75; // seconds of standing inside before the portal fires
    const ready = this._dwellTime >= DWELL;
    const filled = Math.round(Math.min(1, this._dwellTime / DWELL) * 8);
    const bar = "▰".repeat(filled) + "▱".repeat(8 - filled);

    if (egg) {
      // egg pedestal: a drop-rate panel + an affordability-aware [E] prompt.
      const affordable = this.save.gold >= egg.cost;
      this.hud.showEggPanel(
        egg.name,
        egg.cost,
        affordable,
        eggOdds(egg).map((o) => ({
          label: RARITY_LABEL[o.rarity],
          pct: o.pct,
          color: RARITY_COLOR[o.rarity],
        })),
      );
      this.hud.showPrompt(`Hatch ${egg.name} — ${egg.cost.toLocaleString()}g  [E]`, affordable);
    } else if (near?.kind === "td") {
      // Tower Defense gateway: a TAP/CLICK mode-select panel (so mobile can reach
      // Duel/Endless/Daily/Wager — they used to be number-key-only). NO dwell
      // auto-enter here; the player explicitly chooses. Desktop number keys 1-5
      // still work as shortcuts. Wager routes through an honest confirm dialog.
      this.hud.hideEggPanel();
      this.hud.hidePrompt();
      const dailyDone = !tdDailyAvailable(this.save.tdDailyDay, tdDailyDay());
      const wagerStake = WAGER_STAKES[1];
      this.hud.showTdModeSelect(
        { bestWave: this.save.bestWave, dailyDone, wagerStake, canWager: this.save.gold >= wagerStake },
        (kind) => { this._dwellTime = 0; this._dwellZone = ""; this.requestTd(kind); },
      );
      if (this.input.pressed("Digit1")) { this._dwellTime = 0; this.requestTd("solo"); return; }
      if (this.input.pressed("Digit2")) { this._dwellTime = 0; this.requestTd("duel"); return; }
      if (this.input.pressed("Digit3")) { this._dwellTime = 0; this.requestTd("endless"); return; }
      if (this.input.pressed("Digit4")) { this._dwellTime = 0; this.requestTd("daily"); return; }
      if (this.input.pressed("Digit5")) { this._dwellTime = 0; this.requestTd("wager"); return; }
      return; // don't fall through to the generic E-to-activate (panel owns entry)
    } else if (autoPortal && near) {
      // zombie mode portals + the Bed Wars portal: charge, then launch.
      this.hud.hideEggPanel();
      this.hud.hideTdModeSelect();
      this.hud.showPrompt(`${near.label} ${bar}  (walk off to cancel)`, true);
      if (ready) { this._dwellTime = 0; this._dwellZone = ""; this.activateIslandZone(near); return; }
    } else {
      this.hud.hideEggPanel();
      this.hud.hideTdModeSelect();
      if (near) this.hud.showPrompt(near.label + "  [E]", true);
      else this.hud.hidePrompt();
    }

    // E (or tap-confirm) still activates whatever you're standing on instantly
    // (handy on desktop / to skip the dwell). Blocked during a hatch reveal so you
    // can't spam eggs.
    if (!this._hatching && near && (this.input.pressed("KeyE") || this.input.pressed("Space"))) {
      this._dwellTime = 0;
      this._dwellZone = "";
      this.activateIslandZone(near);
    }
  }

  /** Act on the pad the player triggered. */
  private activateIslandZone(zone: IslandZone) {
    // mode/join pads warp you to the zombie world — give the launch a portal burst.
    if (zone.kind === "mode" || zone.kind === "join") this.portalBurst(zone.pos);
    switch (zone.kind) {
      case "mode": {
        // SOLO starts a local run. DUO/SQUAD co-op is temporarily disabled.
        const players = zone.modePlayers ?? 1;
        if (players <= 1) this.startRun();
        else this.hud.toast("Duo & Squad — coming soon! ⏳");
        break;
      }
      case "join": {
        const code = window.prompt("Enter your friend's 4-letter room code:");
        if (code && code.trim()) this.joinGame(code.trim());
        break;
      }
      case "shop":
        this.renderShop();
        this.hud.openShop();
        break;
      case "pets":
        this.renderShop();
        this.hud.openShop("pets", true); // pets-ONLY panel (no menu/Play chrome)
        break;
      case "wardrobe":
        this.renderShop();
        this.hud.openShop("skins", true); // skins-ONLY panel
        break;
      case "egg":
        this.openEgg(zone.eggId ?? "");
        break;
      case "daily":
        this.claimDailyChest();
        break;
      case "index":
        this.openPetIndex();
        break;
      case "wheel":
        this.spinWheel();
        break;
      case "bedwars":
        this.enterBedWars();
        break;
      case "td":
        this.enterTd("solo");
        break;
      case "soon":
        this.hud.toast("🚧 New island coming soon!");
        break;
    }
  }

  /** Hatch a pet from an egg pedestal with a reveal toast + reward FX. */
  private openEgg(eggId: string) {
    const egg = findEgg(eggId);
    const result = this.hatchEgg(eggId);
    if (!result || !egg) return; // couldn't afford (hatchEgg already gave feedback)
    const { pet, dupe, shiny, stars } = result;
    const rarity = (pet.rarity ?? "common") as Rarity;
    const rarityIdx = Math.max(0, RARITY_ORDER.indexOf(rarity));
    this.portalBurst(this.player.pos);
    this.applyQuestProgress({ hatches: 1 }); // cross-mode daily-quest metric
    // In-world celebration everyone can see (+ broadcast it to the lobby).
    this.hatchCelebration(this.player.pos.x, this.player.pos.z, rarityIdx, shiny, pet.id, false);
    this.islandNet?.sendHatch(pet.id, rarityIdx, shiny);
    // Cinematic reveal modal with the pet preview thumbnail + rarity glow.
    const status: "new" | "dupe" | "shiny" = shiny ? "shiny" : dupe ? "dupe" : "new";
    const statusText = shiny ? "✨ SHINY ✨" : dupe ? (stars ? `★ Ascended to ${stars}★` : "Duplicate — refunded") : "NEW!";
    this._hatching = true;
    this.hud.showEggReveal({
      eggColor: `#${egg.color.toString(16).padStart(6, "0")}`,
      petName: pet.name,
      petThumb: petThumbnail(pet.id, this.save.petLevels[pet.id] ?? 1),
      rarityLabel: RARITY_LABEL[rarity],
      rarityColor: RARITY_COLOR[rarity],
      status,
      statusText,
      confetti: rarityIdx >= 2 || shiny, // Rare+ (or any shiny) gets the confetti shower
      onDone: () => { this._hatching = false; },
    });
  }

  /**
   * In-world hatch celebration the whole lobby sees: a rarity-coloured light
   * burst + a floating "<Pet>!" tag over the player, and — for high grades
   * (Rare+) — a shower of multi-coloured confetti that scales with rarity.
   * `remote` plays the version for a peer's hatch (no extra sfx spam).
   */
  private hatchCelebration(x: number, z: number, rarity: number, shiny: boolean, petId: string, remote: boolean) {
    const at = new THREE.Vector3(x, 1.5, z);
    const rc = RARITY_COLOR[RARITY_ORDER[rarity] ?? "common"];
    const rcNum = parseInt(rc.replace("#", ""), 16);
    this.explosions.flash(at, 2.4, rcNum);
    this.sparks.burst(at, rcNum, 16, { speed: 7, spread: 4, streak: true });
    if (shiny) this.sparks.burst(at, 0xffffff, 12, { speed: 9, spread: 5, streak: true });
    // floating tag over the player/peer (their name on a peer hatch would need a
    // lookup; the rarity + pet name read clearly enough on their own).
    const name = findAnyPet(petId)?.name ?? "a pet";
    const tag = `${remote ? "" : "🥚 "}${RARITY_LABEL[RARITY_ORDER[rarity] ?? "common"]} — ${name}!`;
    this.floaters.spawn(new THREE.Vector3(x, 2.6, z), tag, rc, 1.15, true);
    // confetti for Rare and above (index 2+), bigger for Legendary/Mythic
    if (rarity >= 2) this.confettiBurst(at, rarity);
    if (!remote && rarity >= 4) this.shake = Math.min(0.5, this.shake + 0.25); // a little pop on big self-pulls
  }

  /** A festive multi-coloured confetti shower; waves + reach scale with rarity. */
  private confettiBurst(pos: THREE.Vector3, rarity: number) {
    const colors = [0xff5a7a, 0xffd24a, 0x6ad7ff, 0x7be08a, 0xc792ea, 0xff9ec7, 0xffffff];
    const waves = rarity >= 4 ? 3 : rarity >= 3 ? 2 : 1; // mythic/legendary burst harder
    const top = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
    for (let w = 0; w < waves; w++) {
      for (const c of colors) {
        this.sparks.burst(top, c, 5, { speed: 9 + rarity, spread: 7 + w * 1.5, gravity: 13 });
      }
    }
  }

  // ---- lobby attractions: daily chest / pet index / fortune wheel ----

  /** Claim the once-per-UTC-day lobby chest: gold (+ essence) scaling with the
   *  login streak. Marks the day claimed and dims the chest until tomorrow. */
  private claimDailyChest() {
    const today = dayUtc(Date.now());
    if (this.save.dailyChestDay === today) {
      this.audio.deny();
      this.hud.toast("Daily chest claimed — come back tomorrow!");
      return;
    }
    const streak = Math.max(1, this.save.streak.count);
    const gold = Math.min(3000, 250 + streak * 150);
    const essence = streak >= 7 ? 2 : streak >= 3 ? 1 : 0;
    this.save.dailyChestDay = today;
    this.save.gold += gold;
    this.save.goldEarned += gold;
    this.save.essence += essence;
    this.persist();
    this.island.setDailyReady(false);
    this.audio.powerup();
    this.portalBurst(this.player.pos);
    this.confettiBurst(new THREE.Vector3(this.player.pos.x, 1.5, this.player.pos.z), 2);
    this.hud.toast(`🎁 Daily Chest! +${gold} gold${essence ? ` · +${essence} essence` : ""} (Day ${streak})`);
    this.renderShop();
  }

  /** Open the pet-collection index overlay (every pet, owned + completion). */
  private openPetIndex() {
    const owned = new Set(this.save.pets);
    const pool = PETS.filter((p) => p.rarity && p.rarity !== "celestial" && (p.cost ?? 0) > 0);
    const entries = pool.map((p) => ({
      name: p.name,
      thumb: petThumbnail(p.id, this.save.petLevels[p.id] ?? 1),
      owned: owned.has(p.id),
      rarityColor: RARITY_COLOR[(p.rarity ?? "common") as Rarity],
      shiny: (this.save.petProgress[p.id]?._shiny ?? 0) > 0,
      stars: this.petStars(p.id),
    }));
    this.hud.showPetIndex(entries);
  }

  /** Spin the fortune wheel: pay gold, roll a reward, play the spin, then grant. */
  private spinWheel() {
    const cost = 400;
    if (this.save.gold < cost) { this.audio.deny(); this.hud.toast("Need 400 gold to spin"); return; }
    if (this._hatching) return;
    this.save.gold -= cost;
    // weighted reward table (index aligns with the wheel's 8 labelled segments)
    const segments = [
      { label: "+150g", gold: 150, essence: 0, pet: false, w: 26 },
      { label: "+300g", gold: 300, essence: 0, pet: false, w: 22 },
      { label: "+600g", gold: 600, essence: 0, pet: false, w: 14 },
      { label: "+1200g", gold: 1200, essence: 0, pet: false, w: 7 },
      { label: "+1 ✦", gold: 0, essence: 1, pet: false, w: 12 },
      { label: "+3 ✦", gold: 0, essence: 3, pet: false, w: 5 },
      { label: "JACKPOT", gold: 2500, essence: 0, pet: false, w: 4 },
      { label: "PET!", gold: 0, essence: 0, pet: true, w: 10 },
    ];
    const total = segments.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let win = 0;
    for (let i = 0; i < segments.length; i++) { if ((r -= segments[i].w) < 0) { win = i; break; } }
    const seg = segments[win];
    this._hatching = true; // reuse the modal-busy guard so prompts hide + no spam
    this.hud.showWheel(segments.map((s) => s.label), win, () => {
      // grant on reveal
      if (seg.pet) {
        const pet = rollEgg(EGGS[1]); // a River-egg-grade pet from the wheel
        if (!this.save.pets.includes(pet.id)) {
          this.save.pets.push(pet.id); this.save.petLevels[pet.id] = 1; this.grantCollectionMilestones();
          this.hud.toast(`🎡 Won ${pet.name}! (${RARITY_LABEL[(pet.rarity ?? "common") as Rarity]})`);
        } else {
          const refund = 600; this.save.gold += refund;
          this.hud.toast(`🎡 Duplicate ${pet.name} — +${refund} gold`);
        }
        this.spawnPets();
      } else {
        this.save.gold += seg.gold; this.save.goldEarned += seg.gold; this.save.essence += seg.essence;
        this.hud.toast(`🎡 ${seg.label}!`);
      }
      this.persist();
      this.renderShop();
      this._hatching = false;
    });
  }

  // ---- lobby "flex" cosmetics: title / aura derived from progress ----

  /** An earned display title from best-round milestones (shown on the nameplate). */
  private titleFor(): string {
    const b = this.save.bestRound;
    if (b >= 50) return "Apocalypse Veteran";
    if (b >= 40) return "Nightmare Slayer";
    if (b >= 30) return "Horde Breaker";
    if (b >= 20) return "Survivor";
    if (b >= 10) return "Seasoned";
    return "";
  }

  /** Cosmetic aura tier (0..3) from prestige / best round. */
  private auraTierFor(): number {
    if (this.save.prestige >= 3) return 3;
    if (this.save.prestige >= 1 || this.save.bestRound >= 40) return 2;
    if (this.save.bestRound >= 20) return 1;
    return 0;
  }

  /** Push my flex cosmetics to peers (equipped squad + title + prestige + best). */
  private updateIslandFlex() {
    this.islandNet?.setFlex({
      pets: this.pets.map((p) => p.def.id).slice(0, 6),
      title: this.titleFor(),
      prestige: this.save.prestige,
      best: this.save.bestRound,
      aura: this.auraTierFor(),
      skinId: this.save.skin,
    });
  }

  /** Attach/refresh my own nameplate over my head in the hub (null = remove). */
  private setLocalPlate(on: boolean) {
    if (this._localPlate) { this.player.group.remove(this._localPlate); this._localPlate = undefined; }
    if (on) {
      const plate = makeNamePlate(this.save.name, this.titleFor(), this.save.prestige, this.save.bestRound);
      plate.position.set(0, 2.5, 0);
      this.player.group.add(plate);
      this._localPlate = plate;
    }
  }

  /** Attach/refresh my own aura disc (so I see my flex too); tier 0 removes it. */
  private setLocalAura(tier: number) {
    if (this._localAura) { this.player.group.remove(this._localAura); this._localAura = undefined; }
    if (tier > 0) {
      const cols = [0x000000, 0x6ad7ff, 0xc792ea, 0xffd24a];
      const aura = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.12, 18), auraMaterial(cols[tier], 0.7));
      aura.position.y = 0.08;
      this.player.group.add(aura);
      this._localAura = aura;
    }
  }

  /** A juicy warp/portal pop at a pad (flash + pillar + sparks + sfx). */
  private portalBurst(pos: THREE.Vector3) {
    this.explosions.flash(pos, 3.2, 0xbfe0ff);
    this.explosions.beam(pos, 6, 0x8fd0ff);
    this.explosions.shockwave(pos, 4, 0xffffff);
    this.sparks.burst(pos, 0xbfe0ff, 18, { speed: 8, spread: 5, streak: true });
    this.audio.powerup();
    this.shake = Math.min(0.6, this.shake + 0.25);
  }

  // ---- island social: emote + quick-chat on MY figure ----
  /** Play an emote on my own voxel figure + broadcast it to peers. */
  private playSelfEmote(id: EmoteId) {
    this.player.voxelRig?.emote(id);
    this.islandNet?.sendEmote(id);
    this.audio.ui();
  }

  /** Show a speech bubble above MY head + broadcast the preset phrase. */
  private saySelf(text: string) {
    if (this.selfBubble) {
      this.player.group.remove(this.selfBubble);
      (this.selfBubble.material as THREE.SpriteMaterial).map?.dispose();
      (this.selfBubble.material as THREE.SpriteMaterial).dispose();
    }
    this.selfBubble = makeBubble(text);
    this.player.group.add(this.selfBubble);
    this.selfBubbleT = 3.0;
    this.islandNet?.sendChat(text);
    this.audio.ui();
  }

  /** Tick my own speech bubble lifetime (called from simulateIsland + on leave). */
  private updateSelfBubble(dt: number) {
    if (!this.selfBubble) return;
    this.selfBubbleT -= dt;
    if (this.selfBubbleT <= 0) {
      this.player.group.remove(this.selfBubble);
      (this.selfBubble.material as THREE.SpriteMaterial).map?.dispose();
      (this.selfBubble.material as THREE.SpriteMaterial).dispose();
      this.selfBubble = undefined;
    }
  }

  private simulate(dt: number) {
    this.powerups.update(dt);
    this.combo.update(dt);
    this.updateRampage(dt); // player-kill rampage meter (hold + decay + HUD)
    if (this.chillTimer > 0) this.chillTimer -= dt; // glacial affix chill decays
    // Sugar Rush stacks on the Quick perk + upgrades for movement speed.
    // A glacial-affix hit folds in a temporary chill (on-hit affix hook).
    const chill = this.chillTimer > 0 ? 1 - ELITE.glacialSlow : 1;
    this.player.speedMul = (this.perks.has("quick") ? 1.35 : 1) * this.powerups.speedMul() * this.mods.moveSpeedMul * chill;

    const axis = this.input.moveAxis(this._axis);
    // Touch aim stick points the reticle relative to the player (twin-stick).
    if (this.input.touchAim) {
      this.input.aimPoint.set(
        this.player.pos.x + this.input.touchAim.x * 6,
        0,
        this.player.pos.z + this.input.touchAim.y * 6,
      );
    }
    // Camera looks down the -Z axis, so W (axis.y +1) moves toward -Z.
    // Face the aim while firing; otherwise face the movement direction.
    const aiming = this.input.firing || this.input.touchAim != null;
    this.player.update(dt, axis.x, -axis.y, this.input.aimPoint, aiming);
    this.arena.clamp(this.player.pos, PLAYER.radius);
    this.arena.resolveObstacles(this.player.pos, PLAYER.radius);
    this.player.group.position.copy(this.player.pos);

    // weapon
    const w = this.weapon;
    w.update(dt, this.player.reloadMul * this.mods.reloadMul);
    // On touch, holding the aim stick fires (all weapons); cooldown gates rate.
    const wantFire = this.input.touchAim ? true : w.def.auto ? this.input.firing : this.input.clicked();
    if (wantFire) {
      // Adrenaline: fire faster the lower your health is. Reuse _fire (no alloc).
      const adr = this.mods.adrenaline ? 1 + (1 - this.player.health / this.player.maxHealth) * 0.6 : 1;
      const f = this._fire;
      f.fireRateMul = this.powerups.fireRateMul() * this.mods.fireRateMul * adr;
      f.bonusPellets = this.mods.bonusPellets;
      f.pierceBonus = this.mods.pierceBonus;
      f.scaleMul = this.mods.bulletScaleMul;
      f.homing = this.mods.homing;
      f.bounces = this.mods.ricochet;
      if (w.tryFire(this.player.muzzle, this.player.aimDir, this.bullets, f)) {
        this.player.flash();
        this.audio.shoot(w.def.wonder ? 0.85 : 0.4);
        this.netplay?.hostShot(
          this.player.muzzle.x, this.player.muzzle.z, this.player.aimDir.x, this.player.aimDir.z,
          w.def.bulletColor ?? COLORS.bullet, w.def.bulletScale ?? 1,
        );
      }
    }
    if (this.input.pressed("KeyR")) w.reload();
    if (this.input.pressed("KeyQ") && this.weapons.length > 1) {
      this.activeSlot = (this.activeSlot + 1) % this.weapons.length;
    }

    // host also simulates each connected guest's player into the shared world
    if (this.netplay) {
      this.netplay.hostSimulateGuests(dt, this.arena, this.bullets, (x, z, dx, dz, color, scale) =>
        this.netplay!.hostShot(x, z, dx, dz, color, scale),
      );
      this.processGuestInteractions();
    }

    this.steerHomingBullets(dt);
    this.bullets.update(dt);
    const targets = this.netplay ? this.netplay.hostPlayerPositions(this.player) : [this.player.pos];
    // Keep co-op difficulty in sync with the live roster (guests can join/leave
    // mid-run); the new factor takes effect at the next round's beginRound().
    if (this.netplay) this.rounds.setPlayerCount(1 + this.netplay.hostGuestSlots().length);
    this.rounds.update(dt, this.arena, targets);
    this.updatePets(dt);
    // XP level-ups can push a pet past its evolve gate; re-check now (outside the
    // pet loop) since evolving rebuilds the squad. Persist so progress isn't lost
    // on a mid-run crash/refresh.
    if (this._petLeveledThisFrame) {
      this._petLeveledThisFrame = false;
      this.checkPetEvolutions();
      this.persist();
    }
    this.resolveRangedFliers();
    this.resolveBlazingTrails();
    this.resolveTraps(dt);

    this.resolveBulletHits();
    this.resolveZombieTouch(dt);

    // broadcast the authoritative snapshot to guests
    if (this.netplay) {
      const zs: ZombieSnap[] = [];
      for (const z of this.rounds.zombies) {
        if (!z.alive && !z.dying) continue;
        // Map the host-side elite affix (zombie.ts) to a tiny wire code so guests
        // can render the matching aura/tell. 0 = plain. Kept out of the hot path's
        // way: a cheap switch, no allocation.
        const affix =
          z.affix === "blazing" ? AffixCode.Blazing :
          z.affix === "glacial" ? AffixCode.Glacial :
          z.affix === "overloading" ? AffixCode.Overloading :
          AffixCode.None;
        zs.push({ id: z.id, x: z.pos.x, z: z.pos.z, ry: z.group.rotation.y, type: z.typeIndex, state: z.dying ? 1 : 0, affix });
      }
      this.netplay.hostBroadcast(dt, this.player, this.weapon, zs, this.rounds.round, this.points, this.rounds.phase);
    }

    // interaction prompt + buy
    const near = this.interactables.nearest(this.player.pos);
    if (near) {
      const p = near.prompt(this);
      if (p) this.hud.showPrompt(p.text, p.affordable);
      else this.hud.hidePrompt();
      if (this.input.pressed("KeyE") || this.input.pressed("Space")) near.interact(this);
    } else {
      this.hud.hidePrompt();
    }

    // game over when every player (host + guests) is down
    const anyAlive = this.player.alive || this.netplay?.hostGuestSlots().some((s) => s.player.alive);
    if (!anyAlive) {
      this.gameOver();
      return;
    }

    // loot pickups: bob + collect anything the player walks over
    this.drops.update(dt, this.player.pos, (kind, label, color) => this.collectDrop(kind, label, color));

    // boss health bar
    const boss = this.rounds.boss;
    if (boss) this.hud.setBoss(boss.typeName, boss.health / boss.maxHealth);
    else this.hud.hideBoss();

    // occasional ambient groan scaled to how many are shambling about
    if (this.rounds.aliveCount > 0 && Math.random() < dt * (0.5 + this.rounds.aliveCount * 0.08)) {
      this.audio.groan();
    }

    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setPowerups(this.powerups.list());
    this.hud.setCombo(this.combo.active ? this.combo.multiplier : 0, this.combo.fraction);
    this.syncWeaponHud();
  }

  /** Apply a collected loot drop. */
  private collectDrop(kind: DropKind, label: string, color: number) {
    this.runStats.drops++;
    this.floaters.spawn(this.player.pos, label, `#${color.toString(16).padStart(6, "0")}`, 1.1, true);
    this.audio.powerup();
    switch (kind) {
      case "ammo":
        for (const w of this.weapons) w.refill();
        this.syncWeaponHud();
        break;
      case "points":
        this.addPoints(250);
        break;
      case "heal":
        this.player.heal(60);
        break;
      case "doublePoints":
        this.powerups.grant("doublePoints");
        break;
      case "rapidFire":
        this.powerups.grant("rapidFire");
        break;
      case "instakill":
        this.powerups.grant("instakill");
        break;
      case "treasure":
        this.save.essence += 30;
        this.persist();
        this.hud.toast("+30 ✦ Essence");
        break;
      case "nuke":
        this.nukeBoard();
        break;
    }
  }

  /** Nuke drop: wipe every living zombie on the field for points. */
  private nukeBoard() {
    this.audio.boom();
    this.shake = Math.min(0.6, this.shake + 0.4);
    // Route kills through damageZombie so they count toward stats / challenges /
    // combo / loot like every other kill (snapshot the list — damageZombie can
    // trigger detonate/splash that mutate alive state mid-loop).
    const targets = this.rounds.zombies.filter((z) => z.alive && !z.isBoss);
    for (const z of targets) {
      if (!z.alive) continue;
      this.damageZombie(z, 1e9, this.powerups.scoreMul());
    }
  }

  /** Guest path: send input to the host and render the authoritative snapshot. */
  private simulateGuest(dt: number) {
    const axis = this.input.moveAxis(new THREE.Vector2());
    // Touch aim relative to the guest's (snapshot-driven) position.
    if (this.input.touchAim) {
      this.input.aimPoint.set(
        this.player.pos.x + this.input.touchAim.x * 6,
        0,
        this.player.pos.z + this.input.touchAim.y * 6,
      );
    }
    const aim = this.input.aimPoint;
    const inp: InputMsg = {
      t: "input",
      mx: axis.x,
      mz: -axis.y,
      ax: aim.x,
      az: aim.z,
      fire: this.input.touchAim != null || this.input.firing || this.input.clicked(),
      reload: this.input.pressed("KeyR"),
      swap: this.input.pressed("KeyQ"),
      interact: this.input.pressed("KeyE") || this.input.pressed("Space"),
    };
    if (inp.fire) this.audio.shoot(0.4); // local fire feedback (host is authoritative)
    this.netplay!.guestSendInput(inp);
    this.netplay!.guestRender(dt, this.myId); // remotes + zombies + my auth state

    // --- client-side prediction for the guest's OWN player ---
    // Move locally at 60fps for instant response, then gently reconcile toward
    // the host's authoritative position so collisions/damage stay host-ruled.
    this.player.alive = this.netplay!.myAlive;
    if (this.player.alive) {
      this.player.update(dt, axis.x, -axis.y, aim);
      this.arena.clamp(this.player.pos, PLAYER.radius);
      this.arena.resolveObstacles(this.player.pos, PLAYER.radius);
    } else {
      this.player.idle(dt);
    }
    if (this.netplay!.myHasAuth) {
      const ex = this.netplay!.myX - this.player.pos.x;
      const ez = this.netplay!.myZ - this.player.pos.z;
      if (Math.hypot(ex, ez) > 3) {
        // large desync (spawn / knockback / teleport) → snap
        this.player.pos.set(this.netplay!.myX, 0, this.netplay!.myZ);
      } else {
        const k = 1 - Math.exp(-7 * dt); // soft pull toward authoritative
        this.player.pos.x += ex * k;
        this.player.pos.z += ez * k;
      }
      this.player.group.position.copy(this.player.pos);
    }

    this.bullets.update(dt); // moves the local tracer ghosts

    // Cosmetic only: stop tracers when they reach a zombie + puff, so bullets
    // visibly impact instead of passing through. The host does the real damage.
    this.netplay!.guestZombieViews(this.guestZBuf);
    if (this.guestZBuf.length) {
      for (const b of this.bullets.bullets) {
        if (!b.alive) continue;
        for (const zv of this.guestZBuf) {
          const dx = zv.x - b.mesh.position.x;
          const dz = zv.z - b.mesh.position.z;
          if (dx * dx + dz * dz < zv.r * zv.r) {
            this.hitTmp.set(zv.x, 0.9, zv.z);
            this.puffs.burst(this.hitTmp, zv.color, 5);
            this.audio.hit(false);
            this.bullets.retire(b);
            break;
          }
        }
      }
    }

    this.hud.setRound(this.netplay!.netRound);
    this.hud.setPoints(this.netplay!.netPoints);
    this.hud.setHealth(this.netplay!.myHp, this.netplay!.myMaxHp);
    this.hud.setWeapon(this.netplay!.myWeapon, this.netplay!.myAmmo, this.netplay!.myReserve, this.netplay!.myReloading);
    this.player.setWeaponModel(styleForWeaponName(this.netplay!.myWeapon));
    const sp = spreadForWeaponName(this.netplay!.myWeapon);
    this.player.setAimSpread(sp.spread, sp.pellets);

    // Co-op death: gameOver only fires for the host/solo (in simulate), so a
    // downed guest would otherwise be stuck in "playing" with no UI and no exit.
    // Show a spectator overlay driven by myAlive; its button bails to the menu
    // (tearing down the net session via toMenu). Suppress the buy prompt while
    // down. Hidden again automatically if the host revives them (myAlive true).
    if (!this.netplay!.myAlive) {
      this.hud.showGuestDown(() => this.toMenu());
      this.hud.hidePrompt();
      return;
    }
    this.hud.hideGuestDown();

    // Local buy prompt: interactables sit at fixed positions, so the guest can
    // compute its own prompt from the snapshot-driven position + shared points.
    this.points = this.netplay!.netPoints; // so prompt affordability is correct
    const near = this.interactables.nearest(this.player.pos);
    if (near) {
      const p = near.prompt(this);
      if (p) this.hud.showPrompt(p.text, p.affordable);
      else this.hud.hidePrompt();
    } else {
      this.hud.hidePrompt();
    }
  }

  private resolveBulletHits() {
    const dmgMul = this.powerups.damageMul();
    const sMul = this.powerups.scoreMul();
    const grid = this.rounds.grid;
    for (const b of this.bullets.bullets) {
      if (!b.alive) continue;
      // query only zombies in cells near the bullet (was: scan all zombies)
      grid.forNear(b.mesh.position.x, b.mesh.position.z, ZOMBIE.radius * 2 + 0.25, (z) => {
        if (!b.alive) return false; // bullet already retired this pass
        if (!z.alive || b.hit.has(z.id)) return;
        const scale = z.group.scale.x;
        const hitR = ZOMBIE.radius * scale + 0.25;
        const dx = z.pos.x - b.mesh.position.x;
        const dz = z.pos.z - b.mesh.position.z;
        const horiz2 = dx * dx + dz * dz;
        if (horiz2 < hitR * hitR) {
          b.hit.add(z.id);
          // Crit = precise center hit OR a random roll from crit-chance upgrades.
          const crit = horiz2 < (hitR * 0.4) * (hitR * 0.4) || Math.random() < this.mods.critChance;
          const critMul = crit ? this.mods.critMul : 1;
          const dmg = b.damage * dmgMul * this.mods.damageMul * critMul;
          this.addPoints(Math.round(SCORE.hit * sMul * (crit ? 2 : 1)));
          z.knockback(b.mesh.position.x, b.mesh.position.z, Math.max(crit ? 5 : 3, b.knockback));
          if (this.mods.cryoSlow > 0) z.applySlow(this.mods.cryoSlow, 2);
          // keep the rising-pitch ladder in sync on every connect (0 when no chain)
          this.audio.comboStep(this.combo.active ? this.combo.count : 0);
          this.audio.hit(crit);
          if (crit) {
            this.runStats.crits++;
            this.floaters.spawn(z.pos, "CRIT", "#ffe14a", 1, true);
            this.sparks.burst(z.pos, 0xffe14a, 5, { speed: 9, spread: 2, streak: true });
          }
          this.damageZombie(z, dmg, sMul, crit, !b.fromPet); // player kills feed the rampage
          // the bullet's own splash, or the Explosive Rounds upgrade
          const splashR = Math.max(b.splashRadius, this.mods.explosiveRadius);
          if (splashR > 0) {
            this.puffs.burst(z.pos, 0xffd0a0, 6);
            this.explosions.burst(z.pos, splashR * 1.2, 0xffc06a);
            const sd = b.splashRadius > 0 ? b.splashDamage * dmgMul : dmg * 0.5;
            this.splash(z.pos, splashR, sd, z.id, sMul);
          }
          if (this.mods.chainCount > 0) this.chainLightning(z, dmg * 0.5, sMul);
          // pierce first, then ricochet, then the round stops (return false to
          // end this bullet's grid scan)
          if (b.pierce > 0) {
            b.pierce--;
          } else if (b.bounces > 0 && this.ricochetBullet(b)) {
            b.bounces--;
            return false;
          } else {
            this.bullets.retire(b);
            return false;
          }
        }
      });
    }
  }

  /** Summed ACTIVE gold/sec of every owned banker pet, using the SAME flattened
   *  rate as the live updatePets loop (roleValue * (1 + (level-1)*scale)). This
   *  is the basis for offline accrual (idle.offlineGold halves it). */
  private ownedBankerRatePerSec(): number {
    let rate = 0;
    for (const id of this.save.pets) {
      const def = findAnyPet(id);
      if (!def || def.role !== "banker") continue;
      const level = this.save.petLevels[id] ?? 1;
      rate += (def.roleValue ?? 0) * (1 + (level - 1) * PETS_TUNING.bankerLevelScale);
    }
    return rate;
  }

  /** ── SYNERGY (idle→active): effective end-of-run essence multiplier.
   *  Folds the base essenceMul with `essenceFromBankers` (Blood Tithe): each
   *  owned banker LEVEL past the first lifts essence, MULTIPLICATIVE but
   *  HARD-CAPPED by SYNERGY.essenceBankerCap so idle never dwarfs active.
   *
   *  INTEGRATOR NOTE: the essence payout in gameOver() lives outside this
   *  batch's allowed edit region, so it still reads `this.mods.essenceMul`
   *  directly. To wire this synergy, swap that read for
   *  `this.effectiveEssenceMul()`. Until then this getter is a no-op on the
   *  payout (the field is parsed + capped here, ready to drop in). */
  effectiveEssenceMul(): number {
    if (this.mods.essenceFromBankers <= 0) return this.mods.essenceMul;
    let bankerLevels = 0;
    for (const id of this.save.pets) {
      const def = findAnyPet(id);
      if (!def || def.role !== "banker") continue;
      bankerLevels += Math.max(0, (this.save.petLevels[id] ?? 1) - 1);
    }
    const synBankerMul = Math.min(
      SYNERGY.essenceBankerCap,
      1 + this.mods.essenceFromBankers * bankerLevels * SYNERGY.essencePerBankerLevel,
    );
    return this.mods.essenceMul * synBankerMul;
  }

  /** On boot: pay out gold the owned bankers minted while the tab was closed
   *  (half rate, capped), and show the "While You Were Away" screen if it's
   *  worth surfacing. Silent for first-ever saves (lastSeen === 0). */
  private settleOffline() {
    if (this.save.lastSeen <= 0) return; // brand-new save — nothing accrued yet
    const elapsed = Date.now() - this.save.lastSeen;
    const rate = this.ownedBankerRatePerSec();
    const gross = offlineGold(rate, elapsed, IDLE.offlineCapMs);
    if (gross <= 0) return;
    // Prestige multiplier applies to offline gold too (it's the same faucet).
    const mul = prestigeMultiplier(this.save.prestige, PRESTIGE.k);
    const gold = Math.floor(gross * mul);
    if (gold <= 0) return;
    this.save.gold += gold;
    this.save.goldEarned += gold;
    this.persist();
    this.renderShop();
    if (gold >= IDLE.welcomeBackMinGold) {
      const durationMs = Math.min(elapsed, IDLE.offlineCapMs);
      this.hud.showWelcomeBack({ gold, essence: 0, durationMs });
    }
  }

  /** Boot: settle the login streak (UTC day buckets, with freeze) and roll the
   *  daily-quest board over if the UTC day changed. Pays the streak reward in
   *  soft gold + essence, surfaces the streak chip, and refreshes the daily board. */
  private settleLogin() {
    const today = dayUtc(Date.now());
    if (today <= 0) return; // unusable clock — leave state untouched

    const r = settleStreak(this.save.streak, today);
    this.save.streak = r.streak;
    if (r.advanced) {
      this.save.gold += r.gold;
      this.save.goldEarned += r.gold;
      this.save.essence += r.essence;
      const freezeNote = r.usedFreeze ? " (streak freeze used)" : "";
      this.hud.toast(`Day ${r.streak.count} streak${freezeNote}  +${r.gold} 🪙 +${r.essence} ✦`);
    }

    // Roll the daily board to today (clears progress/claims on a new UTC day).
    this.save.daily = rollDaily(this.save.daily, today);

    this.persist();
    this.renderShop();
    this.refreshStreakUi();
    this.refreshDailyUi();
  }

  private refreshStreakUi() {
    this.hud.setStreak(this.save.streak.count, this.save.streak.freezes);
  }

  /** The 3 quests dealt for the current board's day (seeded, cross-mode). */
  private todaysQuests() {
    return questsForDay(this.save.daily.dayUtc);
  }

  private refreshDailyUi() {
    this.hud.showDailies(dailyRows(this.save.daily, this.todaysQuests()));
  }

  /** Run-settle: fold this run's deltas (1 run, kills, gold) into the daily
   *  board, pay out any newly-finished quests, and refresh the board. */
  private settleDailies() {
    const runGold = Math.max(0, this.save.goldEarned - this._runGoldStart);
    this.applyQuestProgress({ runs: 1, kills: this.runStats.kills, gold: runGold });
  }

  /** Fold cross-mode metric deltas (zombies runs, TD waves/duels, egg hatches)
   *  into today's quest board and pay any newly-finished quests. */
  private applyQuestProgress(metrics: DailyMetrics) {
    const quests = this.todaysQuests();
    this.save.daily = applyDailyProgress(this.save.daily, metrics, quests);
    const done = settleDaily(this.save.daily, quests);
    this.save.daily = done.daily;
    if (done.gold > 0 || done.essence > 0) {
      this.save.gold += done.gold;
      this.save.goldEarned += done.gold;
      this.save.essence += done.essence;
      this.hud.toast(`Daily complete  +${done.gold} 🪙 +${done.essence} ✦`);
    }
    this.refreshDailyUi();
    this.persist();
  }

  /** Roll any newly-earned gold (goldEarned delta) into lifetimeGold — the
   *  prestige basis. Idempotent; called before reading prestige availability. */
  private reconcileLifetimeGold() {
    const delta = this.save.goldEarned - this._goldEarnedMark;
    if (delta > 0) this.save.lifetimeGold += delta;
    this._goldEarnedMark = this.save.goldEarned;
  }

  /** Push the current prestige standing to the menu (banked count + multiplier +
   *  how many points are claimable right now). */
  private refreshPrestigeUi() {
    this.reconcileLifetimeGold();
    const available = prestigeGain(this.save.lifetimeGold, this.save.prestige, PRESTIGE.x);
    const mul = prestigeMultiplier(this.save.prestige, PRESTIGE.k);
    this.hud.setPrestige(this.save.prestige, mul, available);
  }

  /**
   * Open the ascension confirmation. Prestige BANKS the newly-available points
   * (√ curve over lifetimeGold) for a permanent +k gold/essence multiplier, then
   * RESETS the run-scoped gold economy.
   *
   *  RESETS:    gold, goldEarned, lifetimeGold, owned (essence meta-upgrades).
   *  PRESERVES: prestige (incremented), essence, pets/petLevels/petProgress,
   *             skins/skin, stash, bestRound/bestScore, stats, claimed,
   *             streak, daily, muted.
   */
  private openPrestige() {
    this.reconcileLifetimeGold();
    const gain = prestigeGain(this.save.lifetimeGold, this.save.prestige, PRESTIGE.x);
    const afterMul = prestigeMultiplier(this.save.prestige + gain, PRESTIGE.k);
    this.hud.showPrestige(
      { current: this.save.prestige, gain, lifetimeGold: this.save.lifetimeGold, nextMultiplier: afterMul },
      () => this.doPrestige(),
    );
  }

  private doPrestige() {
    this.reconcileLifetimeGold();
    const gain = prestigeGain(this.save.lifetimeGold, this.save.prestige, PRESTIGE.x);
    if (gain <= 0) return; // not enough yet — no-op (button is disabled too)
    this.save.prestige += gain;
    // Reset the gold economy that fed this ascension; keep the long-arc meta.
    this.save.gold = 0;
    this.save.goldEarned = 0;
    this.save.lifetimeGold = 0;
    this.save.owned = [];
    this._goldEarnedMark = 0;
    this._petGold = 0;
    this.persist();
    this.resetRun(); // rebuild mods from the now-empty owned list + respawn pets
    this.renderShop();
    this.refreshPrestigeUi();
    this.hud.toast(`Ascended! +${gain} ✦✦ prestige`);
  }

  /** Rebuild live pets from the owned list (called on run start / purchase). */
  private spawnPets() {
    for (const p of this.pets) this.scene.remove(p.group);
    this.pets = [];
    // Active-squad cap: bankers/buffers (non-combat) always spawn; combat pets are
    // limited to the first N owned (in save order) so a huge collection can't blanket
    // the screen. Owning >N is fine — the rest just stay benched, save.pets is untouched.
    let combat = 0;
    const defs: { def: ReturnType<typeof findAnyPet>; lvl: number; shiny: boolean }[] = [];
    for (const id of this.save.pets) {
      const def = findAnyPet(id);
      if (!def) continue;
      const isCombat = def.role !== "banker" && def.role !== "buffer";
      if (isCombat) {
        // Player-benched combat pets sit out; the rest fill the squad up to the cap.
        if (this.save.benchedPets.includes(id)) continue;
        if (combat >= PETS_TUNING.activeSquadCap) continue;
        combat++;
      }
      // Cosmetic shiny flag (petProgress[id]._shiny) — purely visual, see config.
      const shiny = (this.save.petProgress[id]?._shiny ?? 0) > 0;
      defs.push({ def, lvl: this.save.petLevels[id] ?? 1, shiny });
    }
    defs.forEach((d) => {
      // orbitAngle starts at 0 for every pet — the even angular spacing comes
      // from the `slot` (idx/total) in Pet.update, so they fan out, not clump.
      const pet = new Pet(d.def!, 0, d.lvl, d.shiny);
      this.scene.add(pet.group);
      this.pets.push(pet);
    });
    // Squad changed → recompute synergy lazily next frame.
    this._petSynergyKey = "";
    // Chronos = permanent 2x OVERDRIVE while OWNED + not benched. Keyed off
    // ownership (not the spawn list) so a full combat squad can't crowd the
    // time-god out of its passive.
    this.chronosActive = this.save.pets.includes("chronos") && !this.save.benchedPets.includes("chronos");
    // re-equipping in the hub → re-broadcast my squad so peers see the change
    if (this.state === "island") this.updateIslandFlex();
  }

  /** Stars a pet has earned via dupe-ascension (petProgress[id]._stars). */
  private petStars(id: string): number {
    const s = this.save.petProgress[id]?._stars ?? 0;
    return Math.max(0, Math.min(PET_DEPTH.stars.maxStars, Math.floor(s)));
  }

  /** Squad-wide synergy bonuses from the ACTIVE combat squad's combatRole mix.
   *  Recomputed only when the squad roster changes (cheap; called each frame).
   *  Every term is hard-clamped so a stacked comp can't break the buffCap envelope. */
  private _petSynergy = {
    range: 0, splashFrac: 0, damageMul: 1, lifesteal: 0, gold: 0, slow: 0, critMul: 1,
    pairs: [] as string[],
  };
  private _petSynergyKey = "";
  private computePetSynergy() {
    // Cheap roster fingerprint so we only recompute when the squad changes.
    const key = this.pets.map((p) => p.def.id).join("|");
    if (key === this._petSynergyKey) return;
    this._petSynergyKey = key;
    const counts: Partial<Record<CombatRole, number>> = {};
    for (const p of this.pets) {
      const r = p.def.combatRole;
      if (!r) continue;
      counts[r] = (counts[r] ?? 0) + 1;
    }
    const S = PET_DEPTH.synergy;
    const s = this._petSynergy;
    s.range = 0; s.splashFrac = 0; s.damageMul = 1; s.lifesteal = 0; s.gold = 0; s.slow = 0; s.critMul = 1;
    const pairs: string[] = [];
    const has = (r: CombatRole) => (counts[r] ?? 0) >= 1;
    const two = (r: CombatRole) => (counts[r] ?? 0) >= 2;
    // Same-role (2+) bonuses.
    if (two("sniper")) { s.range += S.twoSnipers.range; pairs.push("2× Sniper +range"); }
    if (two("bomber")) { s.splashFrac += S.twoBombers.splashFrac; pairs.push("2× Bomber +splash"); }
    if (two("tank")) { s.damageMul += S.twoTanks.damageMul; pairs.push("2× Tank +dmg"); }
    if (two("drainer")) { s.lifesteal += S.twoDrainers.lifesteal; pairs.push("2× Drainer +heal"); }
    if (two("harvester")) { s.gold += S.twoHarvesters.gold; pairs.push("2× Harvester +gold"); }
    if (two("saboteur")) { s.slow += S.twoSaboteurs.slow; pairs.push("2× Saboteur +slow"); }
    // Named combos (one of each).
    if (has("tank") && has("drainer")) { s.lifesteal += S.tankDrainer.lifesteal; pairs.push("Tank+Drainer lifesteal"); }
    if (has("sniper") && has("saboteur")) { s.critMul += S.sniperSaboteur.critMul; pairs.push("Sniper+Saboteur crit"); }
    if (has("bomber") && has("harvester")) { s.gold += S.bomberHarvester.gold; pairs.push("Bomber+Harvester gold"); }
    // Hard caps (stay under the buffCap power envelope).
    s.damageMul = Math.min(s.damageMul, S.synergyDamageCap);
    s.lifesteal = Math.min(s.lifesteal, S.synergyLifestealCap);
    s.pairs = pairs;
  }

  /** Snapshot of the active squad's synergy for the HUD pets tab. */
  petSquadInfo(): { roles: { role: CombatRole; icon: string; label: string; count: number }[]; bonuses: string[]; members: { id: string; name: string; icon: string; color: string }[]; cap: number } {
    this.computePetSynergy();
    const counts = new Map<CombatRole, number>();
    for (const p of this.pets) {
      const r = p.def.combatRole;
      if (!r) continue;
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const roles = [...counts.entries()].map(([role, count]) => ({
      role, icon: ROLE_ICON[role], label: ROLE_LABEL[role], count,
    }));
    // the actual active combat squad, in orbit order (bankers/buffers excluded —
    // they aren't squad-capped and don't take a slot).
    const members = this.pets
      .filter((p) => p.def.role !== "banker" && p.def.role !== "buffer")
      .map((p) => ({
        id: p.def.id,
        name: p.def.name,
        icon: p.def.combatRole ? ROLE_ICON[p.def.combatRole] : "✦",
        color: `#${p.def.color.toString(16).padStart(6, "0")}`,
      }));
    return { roles, bonuses: this._petSynergy.pairs, members, cap: PETS_TUNING.activeSquadCap };
  }

  /** Deploy/bench a combat pet (the squad picker). Owned only; respects the cap. */
  private toggleSquad(id: string) {
    if (!this.save.pets.includes(id)) return;
    const def = findAnyPet(id);
    if (!def || def.role === "banker" || def.role === "buffer") return; // non-combat: always active
    const benched = this.save.benchedPets;
    const i = benched.indexOf(id);
    if (i >= 0) {
      // deploy — but only if there's room under the cap
      const active = this.pets.filter((p) => p.def.role !== "banker" && p.def.role !== "buffer").length;
      if (active >= PETS_TUNING.activeSquadCap) { this.hud.toast(`Squad full (${PETS_TUNING.activeSquadCap}) — bench one first`); this.audio.deny(); return; }
      benched.splice(i, 1);
      this.audio.ui();
    } else {
      benched.push(id); // bench it
      this.audio.ui();
    }
    this.persist();
    this.spawnPets();
    this.renderShop();
  }

  /** Tick companion pets: orbit the player, auto-target, fire real bullets. */
  /**
   * Drip combat XP to every ACTIVE pet for the squad's kills this frame, leveling
   * them up live (with a floating "Lv N!" + puff). XP lives in petProgress[id]._xp
   * and carries leftover across level-ups; a pet can multi-level on a big burst.
   * Sets _petLeveledThisFrame so simulate re-checks evolutions after the loop
   * (mutating the squad mid-updatePets would be unsafe).
   */
  private grantSquadXp(kills: number) {
    const gain = kills * PETS_TUNING.xpPerKill;
    if (gain <= 0) return;
    let leveled = false;
    for (const p of this.pets) {
      const id = p.def.id;
      const pr = (this.save.petProgress[id] ??= {});
      let xp = (pr._xp ?? 0) + gain;
      let lvl = this.save.petLevels[id] ?? 1;
      let need = petXpForLevel(lvl);
      let did = false;
      while (xp >= need) {
        xp -= need;
        lvl++;
        did = true;
        need = petXpForLevel(lvl);
      }
      pr._xp = xp;
      if (did) {
        const prevStage = petStage(this.save.petLevels[id] ?? 1);
        this.save.petLevels[id] = lvl;
        p.setLevel(lvl);
        const newStage = petStage(lvl);
        if (newStage > prevStage) {
          // crossed an evolution-stage threshold — a louder celebration
          this.floaters.spawn(p.group.position, `✦ ${petStageName(lvl)}!`, "#ffd24a", 1.5, true);
          for (let i = 0; i < 3; i++) this.puffs.burst(p.group.position, 0xffd24a, 8);
          this.toast(`✦ ${p.def.name} evolved — ${petStageName(lvl)}!`);
          this.shake = Math.min(0.3, this.shake + 0.12);
        } else {
          this.floaters.spawn(p.group.position, `Lv ${lvl}!`, "#9be86a", 1.1, true);
          this.puffs.burst(p.group.position, p.def.color, 6);
        }
        leveled = true;
      }
    }
    if (leveled) {
      this.audio.levelUp();
      this._petLeveledThisFrame = true;
    }
  }

  private updatePets(dt: number) {
    if (!this.pets.length) return;
    this.computePetSynergy();
    const syn = this._petSynergy;
    // Per-round drainer/harvester accumulators (capped). Reset on round change.
    if (this.rounds.round !== this._petDepthRound) {
      this._petDepthRound = this.rounds.round;
      this._drainerRoundHeal = 0;
      this._harvesterRoundGold = 0;
    }
    // On-kill role economy (drainer heal + harvester gold): pet bullets resolve
    // through the shared resolveBulletHits path (no per-bullet owner hook we may
    // touch), so we attribute the squad's kill DELTA this frame to the drainer /
    // harvester share of the combat squad — proportional to investment, capped.
    const killsNow = this.runStats.kills;
    const killsThisFrame = Math.max(0, killsNow - this._petKillMark);
    this._petKillMark = killsNow;
    // ── COMBAT XP: every squad kill drips XP to each active pet so they LEVEL by
    // fighting (gold-leveling is now an optional fast-track). Live level-ups grow
    // the pet on the spot; an evolution re-check is deferred to after the loop. ──
    if (killsThisFrame > 0) this.grantSquadXp(killsThisFrame);
    if (killsThisFrame > 0) {
      let combat = 0, drainers = 0, harvesters = 0;
      // 3★+ drainers/harvesters add a small per-pet star kicker to their faucet.
      let drainerStarKick = 0, harvesterStarKick = 0;
      for (const p of this.pets) {
        if (p.def.role === "banker" || p.def.role === "buffer") continue;
        combat++;
        const st = this.petStars(p.def.id);
        const kick = st >= PET_DEPTH.stars.roleKickAt ? 1 : 0;
        if (p.def.combatRole === "drainer") { drainers++; drainerStarKick += kick; }
        if (p.def.combatRole === "harvester") { harvesters++; harvesterStarKick += kick; }
      }
      if (combat > 0) {
        const R = PET_DEPTH.roles;
        if (drainers > 0 && this._drainerRoundHeal < R.drainer.healCapPerRound) {
          // share = drainer fraction; + squad lifesteal synergy bump + star kicker.
          const share = drainers / combat;
          const starFrac = drainerStarKick / drainers; // 0..1 of drainers at 3★+
          let heal = (R.drainer.healPerKill * (1 + starFrac * 0.5) + syn.lifesteal) * killsThisFrame * share;
          heal = Math.min(heal, R.drainer.healCapPerRound - this._drainerRoundHeal);
          if (heal > 0.01) {
            this._drainerRoundHeal += heal;
            this.player.heal(heal);
          }
        }
        if (harvesters > 0 && this._harvesterRoundGold < R.harvester.goldCapPerRound) {
          const share = harvesters / combat;
          const starFrac = harvesterStarKick / harvesters;
          let g = Math.round((R.harvester.goldPerKill * (1 + starFrac * 0.5) + syn.gold) * killsThisFrame * share);
          g = Math.min(g, R.harvester.goldCapPerRound - this._harvesterRoundGold);
          if (g > 0) {
            this._harvesterRoundGold += g;
            this.save.gold += g;
            this.save.goldEarned += g;
          }
        }
      }
    }
    const px = this.player.pos.x;
    const pz = this.player.pos.z;
    const grid = this.rounds.grid;
    // Power Totem(s): sum their buff so combat pets hit harder (+roleValue x level),
    // then HARD-CLAMP the total to buffCap. Without the clamp, 3 totems at L20 stack
    // to ~7x and one-shot the late game (see audit). Stacking still helps, but caps.
    let petBuff = 1;
    for (const p of this.pets) {
      if (p.def.role === "buffer") petBuff += (p.def.roleValue ?? 0) * p.level;
    }
    petBuff = Math.min(petBuff, PETS_TUNING.buffCap);
    // Pets inherit your whole upgrade tree, exactly like your own gun. Fire Rate
    // (incl. Adrenaline) speeds their cadence the same way it speeds yours.
    const adr = this.mods.adrenaline ? 1 + (1 - this.player.health / this.player.maxHealth) * 0.6 : 1;
    const petFireRate = this.powerups.fireRateMul() * this.mods.fireRateMul * adr;
    for (let i = 0; i < this.pets.length; i++) {
      const pet = this.pets[i];
      // Signature ability (Epic+): periodic special, fires regardless of role.
      if (pet.tickAbility(dt)) this.firePetAbility(pet, petBuff);
      // Banker (Piggy Bank): earn gold over time — the idle-economy hook. Output
      // is FLATTENED (roleValue * (1 + level*scale), not * level) and CAPPED per
      // round so it stays meaningful idle income, not a level-20 firehose.
      if (pet.def.role === "banker") {
        if (this.rounds.round !== this._bankerRound) {
          this._bankerRound = this.rounds.round;
          this._bankerRoundGold = 0;
        }
        // Prestige multiplier (1 + prestige*k) couples ascension into the live
        // banker faucet — same boost the offline accrual gets, so active income
        // always leads offline at any prestige level.
        const pMul = prestigeMultiplier(this.save.prestige, PRESTIGE.k);
        // ── SYNERGY (active→idle, read-only ADD): War Bonds — the run's damage
        // tier lifts banker gold rate. MULTIPLIED alongside pMul (never replaces
        // it), and HARD-CAPPED by SYNERGY.bankerWeaponCap so it can't run away. ──
        const synWeaponMul = this.mods.bankerFromWeapon > 0
          ? Math.min(SYNERGY.bankerWeaponCap, 1 + this.mods.bankerFromWeapon * Math.max(0, this.mods.damageMul - 1) * SYNERGY.bankerPerDamage)
          : 1;
        const rate = (pet.def.roleValue ?? 0) * (1 + (pet.level - 1) * PETS_TUNING.bankerLevelScale) * pMul * synWeaponMul;
        this._petGold += rate * dt;
        if (this._petGold >= 1 && this._bankerRoundGold < PETS_TUNING.bankerGoldPerRoundCap) {
          let g = Math.floor(this._petGold);
          this._petGold -= g;
          g = Math.min(g, PETS_TUNING.bankerGoldPerRoundCap - this._bankerRoundGold);
          this._bankerRoundGold += g;
          this.save.gold += g;
          this.save.goldEarned += g;
        }
        pet.update(dt, px, pz, i, this.pets.length, null); // orbit/animate only
        continue;
      }
      const d = pet.def;
      const role = d.combatRole;
      const stars = this.petStars(d.id);
      const R = PET_DEPTH.roles;
      // ── role: engage RANGE verbs (tank soaks wider, sniper reaches far) +
      // squad-range synergy. All additive, tiny. ──
      let range = d.range;
      if (role === "tank") range += R.tank.orbitRange + (stars >= PET_DEPTH.stars.roleKickAt ? 2 : 0);
      if (role === "sniper") range += R.sniper.bonusRange + (stars >= PET_DEPTH.stars.eliteKickAt ? 2 : 0);
      range += syn.range;
      // nearest zombie to the pet, within its (role-adjusted) range
      const near = grid.nearest(pet.group.position.x, pet.group.position.z, range);
      let tgt: { x: number; z: number } | null = null;
      if (near) {
        this._petTgt.x = near.pos.x;
        this._petTgt.z = near.pos.z;
        tgt = this._petTgt;
      }
      // ── role: saboteur applies a brief, capped slow to its current target each
      // frame it's engaged (the "debuff" verb — no damage spike). ──
      if (role === "saboteur" && near && near.alive) {
        const slow = R.saboteur.slow + syn.slow + (stars >= PET_DEPTH.stars.roleKickAt ? 0.05 : 0);
        near.applySlow(Math.min(0.6, slow), R.saboteur.slowDur);
      }
      const shot = pet.update(dt, px, pz, i, this.pets.length, tgt, petFireRate, range);
      if (shot) {
        // Base damage only — damageMul / crit / cryo / explosive / chain are
        // applied for ALL bullets in resolveBulletHits (the shared player path),
        // so pets scale with Damage 1:1 with you (no double-dip). Here we attach
        // the spawn-time mods your gun gets: pierce, bullet size, ricochet,
        // homing, and Multishot (extra fanned pellets).
        // ── role + star + synergy spawn-time tweaks (all SMALL, no one-shots) ──
        // engineMul: pets with an "engine" signature ability snowball their normal
        // fire as they build stacks (capped by the ability's maxStacks).
        let dmgMul = pet.damageMul * petBuff * syn.damageMul * pet.engineMul;
        dmgMul *= 1 + stars * PET_DEPTH.stars.dmgPerStar; // dupe→star: flat, capped
        // sniper: crit-on-distant — a modest multiplier when the target is far.
        // 3★+ snipers crit from a shorter distance (skill bump, not raw damage).
        const dist = shot.dist;
        const critRange = R.sniper.critRange - (stars >= PET_DEPTH.stars.roleKickAt ? 3 : 0);
        if (role === "sniper" && dist >= critRange) {
          dmgMul *= R.sniper.critMul * syn.critMul;
        }
        let splashRadius = d.splashRadius;
        let splashDamage = d.splashDamage;
        // bomber: small splash on every bullet (adds, or seeds it if the pet had none).
        if (role === "bomber") {
          splashRadius += R.bomber.bonusSplashRadius + (stars >= PET_DEPTH.stars.roleKickAt ? 0.4 : 0);
          if (splashDamage <= 0) splashDamage = d.damage * R.bomber.bonusSplashFrac;
        }
        // squad bomber synergy: extra splash for the whole squad.
        if (syn.splashFrac > 0) {
          if (splashRadius <= 0) splashRadius = 1.0;
          splashDamage += d.damage * syn.splashFrac;
        }
        const baseDamage = d.damage * dmgMul;
        const pellets = 1 + Math.max(0, this.mods.bonusPellets);
        for (let s = 0; s < pellets; s++) {
          if (s === 0) {
            this._petDir.set(shot.dx, 0, shot.dz);
          } else {
            // fan the extra multishot pellets symmetrically around the aim
            const ang = (s % 2 === 0 ? 1 : -1) * Math.ceil(s / 2) * 0.12;
            const c = Math.cos(ang), sn = Math.sin(ang);
            this._petDir.set(shot.dx * c - shot.dz * sn, 0, shot.dx * sn + shot.dz * c);
          }
          this.hitTmp.set(shot.ox, 1.0, shot.oz);
          this.bullets.spawn(this.hitTmp, this._petDir, {
            fromPet: true,
            speed: 56, damage: baseDamage, pierce: d.pierce + this.mods.pierceBonus,
            splashRadius, splashDamage, color: d.bulletColor,
            scale: d.bulletScale * this.mods.bulletScaleMul, homing: Math.max(d.homing, this.mods.homing),
            bounces: this.mods.ricochet,
          });
        }
      }
    }
  }

  private _abilTmp = new THREE.Vector3();
  /**
   * Resolve a pet's signature ability. Everything routes through the existing
   * bullet / splash / explosion / damageZombie machinery so kills still count
   * toward combo, loot, stats and challenges. Damage scales with the pet's
   * level (damageMul) and any Power Totem buff — so abilities snowball too.
   */
  private firePetAbility(pet: Pet, petBuff: number) {
    const ab = pet.def.ability;
    if (!ab) return;
    // Celestial passives aren't timed casts: Oracle "autoperk" auto-resolves the
    // level-up at round end (offerLevelUp); Chronos "timewarp" is a PERMANENT 2x
    // driven by squad presence (chronosActive). Neither fires here.
    if (ab.kind === "autoperk" || ab.kind === "timewarp") return;
    const grid = this.rounds.grid;
    const px = pet.group.position.x;
    const pz = pet.group.position.z;
    const sMul = this.powerups.scoreMul();
    const dmg = ab.power * pet.damageMul * petBuff;
    // Bullet-based abilities (nova/volley/coins) inherit Damage via resolveBulletHits.
    // Direct-hit abilities (chain/meteor/smite/execute/obliterate) bypass it, so
    // bake your Damage upgrade in here for the same 1:1 scaling.
    const dmgDirect = dmg * this.mods.damageMul;
    const col = pet.def.bulletColor;
    const near = grid.nearest(px, pz, 64);
    // count this cast toward the pet's evolution trial (per-pet, free to attribute)
    this._runCasts[pet.def.id] = (this._runCasts[pet.def.id] ?? 0) + 1;
    // distinct, power-scaled cast sound per ability kind. Engine archetypes reuse
    // an existing payoff sound (audio.ts is owned elsewhere — no new SFX added):
    // overcharge→chain, resonance→nova, siphon→smite.
    const sfxKind =
      ab.kind === "overcharge" ? "chain"
      : ab.kind === "resonance" ? "nova"
      : ab.kind === "siphon" ? "smite"
      : ab.kind;
    this.audio.ability(sfxKind, ab.power / 200);

    switch (ab.kind) {
      case "nova": {
        const n = ab.count ?? 10;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          this._abilTmp.set(px, 1.0, pz);
          this._petDir.set(Math.cos(a), 0, Math.sin(a));
          this.bullets.spawn(this._abilTmp, this._petDir, {
            fromPet: true,
            speed: 50, damage: dmg, pierce: 3, splashRadius: ab.radius ?? 0,
            splashDamage: ab.radius ? dmg * 0.5 : 0, color: col, scale: pet.def.bulletScale * 1.25, homing: 0,
          });
        }
        // radiant double-pop: hot core flash + a big ring racing out with the shells
        this._abilTmp.set(px, 0.6, pz);
        this.explosions.flash(this._abilTmp, 2.8, col);
        this.explosions.shockwave(this._abilTmp, 4 + n * 0.22, col);
        this.sparks.burst(this._abilTmp, col, Math.min(20, n), { speed: 12, spread: 3, streak: true });
        if (ab.slow) for (const z of this.rounds.zombies) if (z.alive) z.applySlow(ab.slow, 2.5);
        break;
      }
      case "volley": {
        if (!near) break;
        const n = ab.count ?? 12;
        for (let k = 0; k < n; k++) {
          const dx = near.pos.x - px;
          const dz = near.pos.z - pz;
          const len = Math.hypot(dx, dz) || 1;
          this._abilTmp.set(px, 1.0, pz);
          this._petDir.set(dx / len + (Math.random() - 0.5) * 0.5, 0, dz / len + (Math.random() - 0.5) * 0.5).normalize();
          this.bullets.spawn(this._abilTmp, this._petDir, {
            fromPet: true,
            speed: 66, damage: dmg, pierce: 4, splashRadius: 0, splashDamage: 0, color: col, scale: pet.def.bulletScale, homing: 1,
          });
        }
        // muzzle pop + tracer sparks spraying toward the cluster
        this._abilTmp.set(px, 1.0, pz);
        this.explosions.flash(this._abilTmp, 1.7, col);
        this.sparks.burst(this._abilTmp, col, 8, { speed: 10, spread: 2, streak: true });
        break;
      }
      case "chain": {
        let cur = near;
        const hit = new Set<number>();
        let jumps = ab.count ?? 6;
        while (cur && jumps-- > 0) {
          hit.add(cur.id);
          // electric snap at each arc node
          this.explosions.flash(cur.pos, 1.5, 0x9fe8ff);
          this.sparks.burst(cur.pos, 0xcdefff, 6, { speed: 9, spread: 3, streak: true });
          this.damageZombie(cur, dmgDirect, sMul);
          cur = this.nearestZombie(cur.pos.x, cur.pos.z, 7, hit);
        }
        break;
      }
      case "meteor": {
        const n = ab.count ?? 4;
        const r = ab.radius ?? 2.6;
        const pool = this.rounds.zombies.filter((z) => z.alive && !z.isBoss);
        for (let k = 0; k < n; k++) {
          const z = pool.length ? pool[(Math.random() * pool.length) | 0] : null;
          const cx = z ? z.pos.x : px + (Math.random() - 0.5) * 12;
          const cz = z ? z.pos.z : pz + (Math.random() - 0.5) * 12;
          this._abilTmp.set(cx, 0.6, cz);
          // fiery impact column + blast + chunky debris kicking off the ground
          this.explosions.beam(this._abilTmp, 5.5, 0xffb04a);
          this.explosions.burst(this._abilTmp, r * 1.2, 0xff7a3a);
          this.sparks.burst(this._abilTmp, 0xffa23a, 8, { speed: 7, spread: 5 });
          this.splash(this._abilTmp, r, dmgDirect, -1, sMul);
        }
        this.shake = Math.min(0.6, this.shake + 0.18);
        break;
      }
      case "smite": {
        const r = ab.radius ?? 5;
        const cx = near ? near.pos.x : px;
        const cz = near ? near.pos.z : pz;
        this._abilTmp.set(cx, 0.6, cz);
        // pillar of light slams down with a blast + radiant sparks
        this.explosions.beam(this._abilTmp, 9, col);
        this.explosions.flash(this._abilTmp, r, col);
        this.explosions.burst(this._abilTmp, r * 1.1, col);
        this.sparks.burst(this._abilTmp, col, 14, { speed: 9, spread: 6, streak: true });
        this.splash(this._abilTmp, r, dmgDirect, -1, sMul);
        if (ab.slow) grid.forNear(cx, cz, r, (z) => { if (z.alive) z.applySlow(ab.slow!, 2.5); });
        if (ab.heal) {
          this.player.heal(ab.heal);
          this.sparks.burst(this.player.pos, 0x7be08a, 8, { speed: 5, spread: 4, streak: true });
        }
        this.shake = Math.min(0.6, this.shake + 0.14);
        break;
      }
      case "execute": {
        const r = ab.radius ?? 6;
        const thr = ab.frac ?? 0.35;
        const r2 = r * r;
        this._abilTmp.set(px, 0.6, pz);
        // dark reaper column + soul-purple shroud
        this.explosions.beam(this._abilTmp, 7, 0x9a5ad6);
        this.explosions.burst(this._abilTmp, r, 0x9a5ad6);
        this.sparks.burst(this._abilTmp, 0xc0a0ff, 10, { speed: 8, spread: 4, streak: true });
        grid.forNear(px, pz, r, (z) => {
          if (!z.alive) return;
          const dx = z.pos.x - px;
          const dz = z.pos.z - pz;
          if (dx * dx + dz * dz > r2) return;
          const lethal = !z.isBoss && z.health <= z.maxHealth * thr;
          if (lethal) this.sparks.burst(z.pos, 0xc0a0ff, 5, { speed: 7, spread: 4, streak: true });
          this.damageZombie(z, lethal ? 1e9 : dmgDirect, sMul);
        });
        break;
      }
      case "jackpot": {
        const g = Math.round((ab.gold ?? 200) * (1 + (pet.level - 1) * 0.15));
        this.save.gold += g;
        this.save.goldEarned += g;
        this.floaters.spawn(pet.group.position, `+⛀${g}`, "#ffd24a", 1.5, true);
        // a glittering fountain of coins erupting off the pet
        this._abilTmp.set(px, 1.0, pz);
        this.explosions.flash(this._abilTmp, 2.0, 0xffd24a);
        this.sparks.burst(this._abilTmp, 0xffd24a, 16, { speed: 8, spread: 7, streak: true });
        // a damaging shower of coins so even the bankers join the carnage
        const n = ab.count ?? 8;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          this._abilTmp.set(px, 1.0, pz);
          this._petDir.set(Math.cos(a), 0, Math.sin(a));
          this.bullets.spawn(this._abilTmp, this._petDir, {
            fromPet: true,
            speed: 48, damage: dmg, pierce: 2, splashRadius: 0, splashDamage: 0, color: 0xffd24a, scale: 0.8, homing: 0,
          });
        }
        // Midas-tier banker also pulps everything nearby into gold.
        if (ab.radius) {
          this._abilTmp.set(px, 0.6, pz);
          this.explosions.burst(this._abilTmp, ab.radius, 0xffd24a);
          this.explosions.beam(this._abilTmp, 7, 0xffe07a);
          this.sparks.burst(this._abilTmp, 0xffe07a, 18, { speed: 10, spread: 8, streak: true });
          this.splash(this._abilTmp, ab.radius, dmgDirect, -1, sMul);
        }
        break;
      }
      case "obliterate": {
        const r = ab.radius ?? 14;
        this.shake = Math.min(0.8, this.shake + 0.6);
        this._abilTmp.set(px, 0.6, pz);
        // cataclysm: twin light pillars, layered blast, twin shockwaves, shrapnel
        this.explosions.beam(this._abilTmp, 16, 0xff3aff);
        this.explosions.beam(this._abilTmp, 11, 0xffffff);
        this.explosions.burst(this._abilTmp, r, 0xff3aff);
        this.explosions.shockwave(this._abilTmp, r * 1.3, 0xff7aff);
        this.explosions.shockwave(this._abilTmp, r * 0.65, 0xffffff);
        this.sparks.burst(this._abilTmp, 0xff7aff, 24, { speed: 14, spread: 8, streak: true });
        this.splash(this._abilTmp, r, dmgDirect, -1, sMul);
        this.floaters.spawn(pet.group.position, "ANNIHILATE!", "#ff3aff", 1.7, true);
        break;
      }
      // ── ENGINE archetypes: build a capped stacking resource that empowers the
      // pet's NORMAL fire (engineMul), plus a small immediate effect on cast so the
      // build-up feels active. The snowball — not a bigger burst — is the payoff. ──
      case "overcharge": {
        // gain a charge stack (capped); discharge a small nova when at max.
        const max = ab.maxStacks ?? 6;
        pet.engineStacks = Math.min(max, pet.engineStacks + 1);
        const atMax = pet.engineStacks >= max;
        this._abilTmp.set(px, 1.0, pz);
        this.explosions.flash(this._abilTmp, 1.6 + pet.engineStacks * 0.2, 0x9fe8ff);
        this.sparks.burst(this._abilTmp, 0xcdefff, 6 + (pet.engineStacks | 0), { speed: 9, spread: 3, streak: true });
        this.floaters.spawn(pet.group.position, `⚡${pet.engineStacks | 0}`, "#9fe8ff", 1.1, atMax);
        if (atMax) {
          // discharge: a modest ring of bolts (power is small — value was the snowball).
          const n = ab.count ?? 8;
          const rr = ab.radius ?? 1.4;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            this._abilTmp.set(px, 1.0, pz);
            this._petDir.set(Math.cos(a), 0, Math.sin(a));
            this.bullets.spawn(this._abilTmp, this._petDir, {
            fromPet: true,
              speed: 54, damage: dmg, pierce: 2, splashRadius: rr, splashDamage: dmg * 0.4, color: col, scale: pet.def.bulletScale, homing: 0,
            });
          }
          pet.engineStacks = Math.max(0, pet.engineStacks - 2); // partial vent, keep snowball going
        }
        break;
      }
      case "siphon": {
        // build siphon stacks (capped) + a small heal trickle on cast (drain engine).
        const max = ab.maxStacks ?? 5;
        pet.engineStacks = Math.min(max, pet.engineStacks + 1);
        const r = ab.radius ?? 3;
        this._abilTmp.set(px, 0.7, pz);
        this.explosions.flash(this._abilTmp, r, 0x9a5ad6);
        this.sparks.burst(this._abilTmp, 0xc0a0ff, 8, { speed: 7, spread: 4, streak: true });
        this.floaters.spawn(pet.group.position, `🩸${pet.engineStacks | 0}`, "#c0a0ff", 1.1, false);
        // small nearby drain + heal scaled by stacks (capped via engine cap below).
        let drained = 0;
        grid.forNear(px, pz, r, (z) => {
          if (!z.alive) return;
          this.damageZombie(z, dmgDirect * 0.5, sMul);
          if (ab.slow) z.applySlow(ab.slow, 1.5);
          drained++;
        });
        if (drained > 0) {
          const heal = Math.min(8, 1.5 + pet.engineStacks * 1.2);
          this.player.heal(heal);
          this.sparks.burst(this.player.pos, 0x7be08a, 5, { speed: 5, spread: 4, streak: true });
        }
        break;
      }
      case "resonance": {
        // build resonance stacks (capped) → empowers fire; cast sprays a few shards.
        const max = ab.maxStacks ?? 5;
        pet.engineStacks = Math.min(max, pet.engineStacks + 1);
        const n = (ab.count ?? 8);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + pet.engineStacks * 0.3;
          this._abilTmp.set(px, 1.0, pz);
          this._petDir.set(Math.cos(a), 0, Math.sin(a));
          this.bullets.spawn(this._abilTmp, this._petDir, {
            fromPet: true,
            speed: 52, damage: dmg, pierce: 2 + (pet.engineStacks | 0), splashRadius: 0, splashDamage: 0, color: col, scale: pet.def.bulletScale * 0.9, homing: 0,
          });
        }
        this._abilTmp.set(px, 0.6, pz);
        this.explosions.flash(this._abilTmp, 1.8, col);
        this.explosions.shockwave(this._abilTmp, 3 + pet.engineStacks * 0.4, col);
        this.floaters.spawn(pet.group.position, `✦${pet.engineStacks | 0}`, "#9fe8ff", 1.1, false);
        if (ab.slow) for (const z of this.rounds.zombies) if (z.alive) z.applySlow(ab.slow, 1.5);
        break;
      }
    }
  }

  /** Steer homing rounds toward the nearest zombie each frame. */
  private steerHomingBullets(dt: number) {
    const turn = 1 - Math.exp(-7 * dt);
    for (const b of this.bullets.bullets) {
      if (!b.alive || b.homing <= 0) continue;
      const t = this.nearestZombie(b.mesh.position.x, b.mesh.position.z, 16, b.hit);
      if (!t) continue;
      const speed = Math.hypot(b.vel.x, b.vel.z) || 40;
      const dx = t.pos.x - b.mesh.position.x;
      const dz = t.pos.z - b.mesh.position.z;
      const len = Math.hypot(dx, dz) || 1;
      b.vel.x += ((dx / len) * speed - b.vel.x) * turn;
      b.vel.z += ((dz / len) * speed - b.vel.z) * turn;
      const nl = Math.hypot(b.vel.x, b.vel.z) || 1;
      b.vel.x = (b.vel.x / nl) * speed;
      b.vel.z = (b.vel.z / nl) * speed;
      this.hitTmp.set(b.vel.x, 0, b.vel.z).normalize();
      b.mesh.quaternion.setFromUnitVectors(this.UP, this.hitTmp);
    }
  }

  /** Redirect a ricocheting bullet to the nearest fresh zombie. */
  private ricochetBullet(b: Bullet): boolean {
    const t = this.nearestZombie(b.mesh.position.x, b.mesh.position.z, 9, b.hit);
    if (!t) return false;
    const speed = Math.hypot(b.vel.x, b.vel.z) || 40;
    const dx = t.pos.x - b.mesh.position.x;
    const dz = t.pos.z - b.mesh.position.z;
    const len = Math.hypot(dx, dz) || 1;
    b.vel.set((dx / len) * speed, 0, (dz / len) * speed);
    this.hitTmp.set(b.vel.x, 0, b.vel.z).normalize();
    b.mesh.quaternion.setFromUnitVectors(this.UP, this.hitTmp);
    b.life = Math.max(b.life, 0.7);
    return true;
  }

  /** Arc bonus damage to a few zombies near `from`. */
  private chainLightning(from: Zombie, dmg: number, sMul: number) {
    let hits = 0;
    this.rounds.grid.forNear(from.pos.x, from.pos.z, 5, (z) => {
      if (hits >= this.mods.chainCount) return false;
      if (!z.alive || z === from) return;
      this.puffs.burst(z.pos, 0x9fe8ff, 4);
      this.damageZombie(z, dmg, sMul);
      hits++;
    });
  }

  /** Nearest alive zombie to (x,z) within `range`, skipping ids in `skip`.
   *  Thin wrapper over the spatial grid (O(local) not O(n)). The grid is rebuilt
   *  in rounds.update (after steerHomingBullets in simulate), so callers here may
   *  see a 1-frame-stale grid — fine for homing/ricochet/chain targeting. */
  private nearestZombie(x: number, z: number, range: number, skip?: Set<number>): Zombie | null {
    return this.rounds.grid.nearest(x, z, range, skip);
  }

  /** Current rampage multiplier (1 → RAMPAGE.maxMul) from the player-kill stack. */
  private rampageMul(): number {
    return 1 + (this.rampage / RAMPAGE.max) * (RAMPAGE.maxMul - 1);
  }
  /** Tick the rampage stack: hold during the window, then drain. Drives the HUD. */
  private updateRampage(dt: number) {
    if (this.rampage > 0) {
      this.rampageDecay -= dt;
      if (this.rampageDecay <= 0) this.rampage = Math.max(0, this.rampage - RAMPAGE.decayPerSec * dt);
    }
    const mul = this.rampageMul();
    // announce each tier as it's first crossed (a punchy "CARNAGE!" pop)
    let tier = "";
    for (const t of RAMPAGE.tiers) if (mul >= t.at) tier = t.name;
    if (tier && tier !== this._rampageTier) {
      this.floaters.spawn(this.player.pos, `${tier}!`, "#ff7a3a", 1.5, true);
      this.audio.levelUp();
    }
    this._rampageTier = tier;
    this.hud.setRampage(mul, this.rampage / RAMPAGE.max, tier);
  }

  /** Apply damage to one zombie and handle the score/FX if it dies. `byPlayer`
   *  is true for YOUR gun (and world effects); false for pet bullets — used to
   *  feed the Rampage meter so killing with your own gun still matters. */
  private damageZombie(z: Zombie, dmg: number, scoreMul: number, crit = false, byPlayer = true) {
    const wasBoss = z.isBoss;
    const wasBounty = z.bounty; // Loot Goblin — pays a jackpot on death
    const killed = z.hit(dmg);
    if (killed) {
      this.runStats.kills++;
      if (wasBoss) this.runStats.bossKills++;
      const mult = this.combo.onKill();
      // ── RAMPAGE: a multiplier that ONLY builds from YOUR gun kills (not pets),
      // decays over time, and boosts your points + gold. Gives a reason to keep
      // shooting even when pets are clearing the field. ──
      let rampMul = 1;
      if (byPlayer && !z.isBoss) {
        this.rampage = Math.min(RAMPAGE.max, this.rampage + 1);
        this.rampageDecay = RAMPAGE.window; // refresh the decay timer
      }
      rampMul = this.rampageMul();
      // Curse is opt-in risk→reward: a higher curse boosts both score and gold.
      // Mutation rounds (Blood Moon etc.) pay their own bonus on top.
      const cMul = this.rounds.curseRewardMul * this.rounds.specialRewardMul;
      const pts = Math.round(SCORE.kill * z.scoreMul * scoreMul * mult * cMul * rampMul);
      this.addPoints(pts);
      // Per-kill gold drip: COMBAT is the primary gold faucet (bankers are now
      // capped). Scales with the zombie's worth + scoreMul (Double Points etc) + curse + rampage.
      const kg = Math.max(1, Math.round(PETS_TUNING.killGoldBase * z.scoreMul * scoreMul * cMul * rampMul));
      this.save.gold += kg;
      this.save.goldEarned += kg;
      // tiered pop: crit > combo > plain (color/size handled by FloatingText)
      this.floaters.spawn(z.pos, this.floatNum(pts), "#ffffff", 1, crit ? "crit" : mult > 1 ? "combo" : "normal");
      // beefier, warmer burst on crit / combo kills; ragdoll fling on big hits
      const burstN = crit ? 13 : mult >= 3 ? 11 : 8;
      this.puffs.burst(z.pos, crit ? 0xffe14a : z.puffColor, burstN);
      // crunchy gib sparks flinging off the corpse (streaky, bigger on crit/combo)
      this.sparks.burst(z.pos, crit ? 0xffe14a : z.puffColor, crit || mult >= 3 ? 7 : 4, { speed: 7, spread: 4, streak: true });
      // ── CORPSE DECALS (juice, ADD-only): pooled voxel gibs + scorch that linger
      // then fade. HARD-CAPPED, recycled, and a no-op on lowSpec (cap 0). Gib
      // count scales up on crit / combo kills. See decals.ts for the pool/cap. ──
      this.decals.emit(z.pos, crit ? 0xffe14a : z.puffColor, crit ? 1.8 : mult >= 3 ? 1.5 : 1);
      z.flingDeath(crit || mult >= 3 ? 6 : 2);
      // rising-pitch streak: feed the live combo length so kill/hit tones ascend
      this.audio.comboStep(this.combo.count);
      this.audio.kill();
      // combo milestone celebration: a big "xN!" pop when the tier climbs
      if (mult > this.lastComboTier && mult >= 2) {
        this.floaters.spawn(this.player.pos, `x${mult}!`, "#ffd24a", 1.6, true);
        this.audio.levelUp();
      }
      this.lastComboTier = mult;
      if (this.mods.lifeSteal > 0) this.player.heal(this.mods.lifeSteal);
      if (this.nukeCharge < 1) this.nukeCharge = Math.min(1, this.nukeCharge + 0.012); // ~85 kills to recharge
      // Detonate: killed zombies explode, damaging (and chaining through) neighbors.
      if (this.mods.detonate > 0 && !wasBoss) {
        this.puffs.burst(z.pos, 0xffa23a, 10);
        this.explosions.burst(z.pos, this.mods.detonate * 1.3, 0xffa23a);
        this.audio.boom();
        this.splash(z.pos, this.mods.detonate, dmg * 0.4, z.id, scoreMul);
      }
      // Heal Nova: a healing pulse every 10th kill.
      if (this.mods.healNova > 0 && ++this.healKills >= 10) {
        this.healKills = 0;
        this.player.heal(this.mods.healNova);
        this.puffs.burst(this.player.pos, 0x7be08a, 8);
      }
      // a satisfying micro-freeze on crits / combo kills (local visual only)
      if (crit || mult >= 2 || wasBoss) this.hitStop = Math.min(wasBoss ? 0.12 : 0.07, this.hitStop + 0.045);
      // loot: bosses always drop something juicy; normal kills roll the dice
      // Tradable loot: bosses always drop a good item; normal kills rarely do.
      if (wasBoss) {
        this.grantLoot(makeItem(rollRarity(2))); // boss → biased toward rare+
      } else if (Math.random() < 0.03 + this.mods.dropChance * 0.25) {
        // pity-aware rarity: dry rare-less streaks self-correct (non-cashable)
        this.grantLoot(makeItem(rollRarityPity()));
      }
      if (wasBoss) {
        this.hud.hideBoss();
        this.audio.boom();
        this.audio.levelUp(); // victory fanfare
        // boss → a cascading treasure chest (Luck-scaled 1/3/5 items) instead of
        // three flat drops, for a proper jackpot moment.
        this.drops.spawnChest(z.pos, this.mods.dropChance);
        // boss candy explosion: multi-color radial puff blast + camera punch-zoom
        const candy = [0xff5d8f, 0x6ad7ff, 0xffd24a, 0x8fcf6f, 0xc792ea];
        for (let i = 0; i < 5; i++) this.puffs.burst(z.pos, candy[i], 10);
        this.shake = Math.min(0.8, this.shake + 0.5);
        this.zoomPunch = 1;
        this.hitStop = Math.min(0.18, this.hitStop + 0.12);
      } else if (wasBounty) {
        // Loot Goblin caught! A jackpot chest, a fat gold bonus, and a fanfare.
        this.drops.spawnChest(z.pos, this.mods.dropChance + GOBLIN.chestLuck);
        const bonus = 1500 + this.rounds.round * 120;
        this.save.gold += bonus;
        this.save.goldEarned += bonus;
        this.floaters.spawn(z.pos, `+${bonus} 💰`, "#ffd24a", 1.9, true);
        this.hud.toast("💰 LOOT GOBLIN DOWN — JACKPOT!");
        this.audio.levelUp();
        const candy = [0xffd24a, 0xff5d8f, 0x6ad7ff, 0x8fcf6f];
        for (let i = 0; i < 4; i++) this.puffs.burst(z.pos, candy[i], 10);
        this.shake = Math.min(0.6, this.shake + 0.35);
      } else {
        this.drops.maybeSpawn(z.pos, this.mods.dropChance);
      }
      if (z.explodes) {
        this.detonate(z);
        this.audio.boom();
      }
      // Splitter: spawn its smaller copies at the corpse (anti-cluster pressure).
      if (z.splitInto) this.rounds.splitOn(z);
      // Elite affix death-burst: glacial shatters into a freeze AoE, overloading
      // detonates for damage. zombie.ts hands us the descriptor; we apply it here
      // so it shares the explosion/slow/FX paths.
      const aoe = z.deathAoe();
      if (aoe) {
        this.explosions.burst(z.pos, aoe.radius * 1.1, aoe.color);
        this.puffs.burst(z.pos, aoe.color, 12);
        this.audio.boom();
        const r2 = aoe.radius * aoe.radius;
        this.rounds.grid.forNear(z.pos.x, z.pos.z, aoe.radius, (o) => {
          if (!o.alive || o.id === z.id) return;
          const dx = o.pos.x - z.pos.x;
          const dz = o.pos.z - z.pos.z;
          if (dx * dx + dz * dz > r2) return;
          if (aoe.damage > 0) this.damageZombie(o, aoe.damage, scoreMul);
          if (aoe.slow > 0) o.applySlow(aoe.slow, ELITE.glacialSlowDur);
        });
        // overloading also threatens the player if they're hugging the corpse
        if (aoe.damage > 0) {
          const pdx = this.player.pos.x - z.pos.x;
          const pdz = this.player.pos.z - z.pos.z;
          if (pdx * pdx + pdz * pdz < r2 && this.player.alive) {
            this.player.damage(aoe.damage);
            this.shake = Math.min(0.5, this.shake + 0.3);
            this.runStats.tookDamage = true;
          }
        }
      }
    }
  }

  /** AoE damage to every zombie in range (except the one already hit directly). */
  private splash(center: THREE.Vector3, radius: number, dmg: number, exceptId: number, scoreMul: number) {
    const r2 = radius * radius;
    this.rounds.grid.forNear(center.x, center.z, radius, (z) => {
      if (!z.alive || z.id === exceptId) return;
      const dx = z.pos.x - center.x;
      const dz = z.pos.z - center.z;
      if (dx * dx + dz * dz < r2) {
        z.knockback(center.x, center.z, 4);
        this.damageZombie(z, dmg, scoreMul);
      }
    });
  }

  /** Stinger fliers spit a ranged hit at the player (a quick splash at the
   *  player's spot — punishes ignoring them / standing still). */
  private resolveRangedFliers() {
    for (const z of this.rounds.zombies) {
      if (!z.alive || !z.wantsRangedShot) continue;
      z.wantsRangedShot = false;
      // telegraph + hit: a goo splash under the player; partial damage if close.
      this.hitTmp.set(this.player.pos.x, 0.1, this.player.pos.z);
      this.explosions.burst(this.hitTmp, 1.6, 0x9fb04a);
      const dx = this.player.pos.x - z.pos.x;
      const dz = this.player.pos.z - z.pos.z;
      if (dx * dx + dz * dz < 18 * 18 && this.player.alive) {
        this.player.damage(z.touchDamage);
        this.shake = Math.min(0.4, this.shake + 0.18);
        this.audio.hurt();
        this.runStats.tookDamage = true;
      }
    }
  }

  /** GameApi: arm a map trap. Spends the cost, registers a lethal hazard zone
   *  the simulate loop runs for TRAP.duration (damage scales with the round). */
  triggerTrap(pos: THREE.Vector3, radius: number, kind: "electric" | "fire"): boolean {
    if (!this.spend(COSTS.trap)) return false;
    const dps = TRAP.dpsBase + this.rounds.round * TRAP.dpsPerRound;
    this.activeTraps.push({ x: pos.x, z: pos.z, r: radius, dps, kind, t: TRAP.duration, fx: 0 });
    this.audio.powerup();
    this.toast(kind === "electric" ? "⚡ TESLA TRAP ARMED" : "🔥 FLAME TRAP ARMED");
    this.shake = Math.min(0.4, this.shake + 0.15);
    return true;
  }

  /** Tick armed map traps: damage every zombie inside the zone (dt-scaled) and
   *  throw off crackle/flame FX a few times a second. */
  private resolveTraps(dt: number) {
    if (this.activeTraps.length === 0) return;
    for (let i = this.activeTraps.length - 1; i >= 0; i--) {
      const tr = this.activeTraps[i];
      tr.t -= dt;
      tr.fx -= dt;
      const color = tr.kind === "electric" ? 0x6ad7ff : 0xff6a1f;
      const r2 = tr.r * tr.r;
      const dmg = tr.dps * dt;
      const sMul = this.powerups.scoreMul();
      this.rounds.grid.forNear(tr.x, tr.z, tr.r, (z) => {
        if (!z.alive || z.isBoss) return; // bosses shrug off traps
        const dx = z.pos.x - tr.x;
        const dz = z.pos.z - tr.z;
        if (dx * dx + dz * dz > r2) return;
        this.damageZombie(z, dmg, sMul);
      });
      if (tr.fx <= 0) {
        tr.fx = 0.12;
        const ax = tr.x + (Math.random() - 0.5) * tr.r * 1.7;
        const az = tr.z + (Math.random() - 0.5) * tr.r * 1.7;
        this._trapFx.set(ax, 0.3, az);
        this.puffs.burst(this._trapFx, color, 4);
        this.sparks.burst(this._trapFx, color, 3, { speed: 7, spread: 3, streak: tr.kind === "electric" });
      }
      if (tr.t <= 0) this.activeTraps.splice(i, 1);
    }
  }

  /** Blazing affix on-update hook: drop a fire puff under each blazing zombie
   *  when it flags a trail tick, and burn the player if they're standing on it. */
  private resolveBlazingTrails() {
    for (const z of this.rounds.zombies) {
      if (!z.alive || z.affix !== "blazing" || !z.burnTrailReady) continue;
      z.burnTrailReady = false;
      this.puffs.burst(z.pos, 0xff6a1f, 4);
      const dx = this.player.pos.x - z.pos.x;
      const dz = this.player.pos.z - z.pos.z;
      if (dx * dx + dz * dz < 1.6 * 1.6 && this.player.alive) {
        // ~burnDps over the trail's tick cadence (0.35s) → a steady DoT while on it
        this.player.damage(ELITE.blazingBurnDps * 0.35);
        this.runStats.tookDamage = true;
      }
    }
  }

  private resolveZombieTouch(dt: number) {
    const r = ZOMBIE.radius + PLAYER.radius;
    // candidate victims: local player + any guests (host-authoritative).
    // Reuse a scratch array each frame to avoid GC churn.
    const victims = this._victims;
    victims.length = 0;
    victims.push(this.player);
    if (this.netplay) for (const s of this.netplay.hostGuestSlots()) victims.push(s.player);
    for (const z of this.rounds.zombies) {
      if (!z.alive) continue;
      if (z.touchCooldown > 0) {
        z.touchCooldown -= dt;
        continue;
      }
      const reach = r * z.group.scale.x; // bigger variants reach a little farther
      for (const victim of victims) {
        if (!victim.alive) continue;
        const dx = z.pos.x - victim.pos.x;
        const dz = z.pos.z - victim.pos.z;
        if (dx * dx + dz * dz < reach * reach) {
          z.touchCooldown = ZOMBIE.touchInterval;
          // Thorns: zombies that touch the host player take damage + get shoved.
          // Scales with round so it stays relevant against beefy late zombies.
          if (victim === this.player && this.mods.thorns > 0) {
            z.knockback(victim.pos.x, victim.pos.z, 6);
            this.damageZombie(z, this.mods.thorns + 8 * this.rounds.round, this.powerups.scoreMul());
          }
          // Dodge: the host player has a chance to shrug the hit off entirely.
          if (victim === this.player && this.mods.dodge > 0 && Math.random() < this.mods.dodge) {
            this.floaters.spawn(this.player.pos, "DODGE", "#9fe8ff", 1);
            break;
          }
          victim.damage(z.touchDamage);
          if (victim === this.player) {
            this.shake = Math.min(0.5, this.shake + 0.25);
            this.audio.hurt();
            this.runStats.tookDamage = true;
            // Glacial affix on-hit: chill the player (movement slow) + a frosty puff.
            if (z.affix === "glacial") {
              this.chillTimer = Math.max(this.chillTimer, ELITE.glacialSlowDur);
              this.puffs.burst(this.player.pos, 0x6ad7ff, 6);
            }
          }
          break;
        }
      }
    }
  }

  /** Bomber death: orange burst + AoE damage if the player is in range. */
  private detonate(z: Zombie) {
    this.puffs.burst(z.pos, 0xff7a3a, 20);
    this.explosions.burst(z.pos, z.blastRadius * 1.2, 0xff7a3a);
    const dx = this.player.pos.x - z.pos.x;
    const dz = this.player.pos.z - z.pos.z;
    if (dx * dx + dz * dz < z.blastRadius * z.blastRadius) {
      this.player.damage(z.blastDamage);
      this.shake = Math.min(0.7, this.shake + 0.4);
      this.runStats.tookDamage = true;
    }
  }

  private updateCamera(dt: number) {
    this._v2.copy(this.player.pos).add(this._camOffset);
    const k = 1 - Math.exp(-CAMERA.follow * dt);
    this.camera.position.lerp(this._v2, k);

    this.camTarget.lerp(this.player.pos, k);
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 1, this.camTarget.z);

    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.0001, dt); // fast decay
    }

    // player-controlled zoom (wheel / +- keys) eased toward the target, with the
    // boss-death punch-zoom folded in. Re-apply the ortho frustum every frame.
    this.camZoomTarget = Math.max(0.7, Math.min(1.9, this.camZoomTarget));
    this.camZoom += (this.camZoomTarget - this.camZoom) * (1 - Math.exp(-12 * dt));
    if (this.zoomPunch > 0.001) this.zoomPunch *= Math.pow(0.02, dt);
    this.applyView();
  }

  /** Set the orthographic frustum from the base view × the live zoom. */
  private applyView() {
    const aspect = innerWidth / innerHeight;
    const vs = this.viewSize * this.camZoom * (1 - this.zoomPunch * 0.18);
    this.camera.left = -vs * aspect;
    this.camera.right = vs * aspect;
    this.camera.top = vs;
    this.camera.bottom = -vs;
    this.camera.updateProjectionMatrix();
    // Ease the diorama defocus off as the camera zooms in close (camZoom < 1):
    // at full zoom-in the magnified, low-poly world reads sharper without the
    // miniature blur smearing it; default/zoomed-out keeps the full effect.
    this.tilt?.setStrength(this._tiltStrength * Math.min(1, Math.max(0.25, (this.camZoom - 0.55) / 0.45)));
  }

  /** Nudge the zoom target (mult>1 zooms out), clamped. Wider range in the hub. */
  private nudgeZoom(factor: number) {
    // Cap the lobby zoom-out at the default framing so the empty water/horizon
    // band below the island can never be brought into view.
    this.camZoomTarget = Math.max(0.7, Math.min(1.9, this.camZoomTarget * factor));
  }

  private onResize = () => {
    this.applyView();
    // updateStyle=false: let the CSS (#scene { width/height: 100% }) own the
    // canvas's *display* size so it always fills the viewport exactly. With the
    // default (true), three.js writes an explicit px height that can lag the real
    // viewport (esp. entering fullscreen), leaving a strip of the black clear
    // color showing at the bottom.
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer?.setSize(innerWidth, innerHeight);
    this.tilt.setSize(innerWidth, innerHeight);
  };
}

// Load GLB models (best-effort; falls back to primitives) then start the game.
(async () => {
  const assets = new AssetManager();
  await assets.loadAll();
  new Game(assets);
})();
