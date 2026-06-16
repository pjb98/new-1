import Phaser from 'phaser';
import { TILE, PLAYER_SPEED, STAGES } from '../constants';
import { PLANT_BY_ID } from '../economy';
import { growthFactor, lightsFactor, potsBonus, trimBonus, marketBonus, fortuneLuck, sprinklerIntervalMs } from '../progression';
import { pickMutation, stackKey } from '../economy';
import { sfx } from '../audio';

// ---- Indoor grow room constants ----
const ROOM_COLS = 22;   // room width in tiles
const ROOM_ROWS = 15;   // room height in tiles
const POT_COLS = 4;
const POT_ROWS = 3;
const NUM_POTS = POT_COLS * POT_ROWS;
const SAVE_KEY = 'weed_growroom_v1';
const HARVEST_KEY = 'weed_growroom_harvest_v1';

type Dir = 'up' | 'down' | 'left' | 'right';

type PotCrop = {
  plantId: string;
  grownMs: number;      // milliseconds of growth accumulated
  waterLevel: number;   // 0–100
  stage: number;        // 0–(STAGES-1), STAGES = matured
  wet: boolean;
  plantedAt: number;    // Date.now() when planted
  lastUpdated: number;  // Date.now() of last tick
  mutation?: string;
};

type GrowRoomState = {
  pots: (PotCrop | null)[];
  seeds: Record<string, number>;  // plantId -> count
  lastUpdated: number;
};

function defaultState(): GrowRoomState {
  return { pots: Array(NUM_POTS).fill(null), seeds: {}, lastUpdated: Date.now() };
}

function loadGrowRoom(): GrowRoomState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as GrowRoomState;
      if (!Array.isArray(s.pots) || s.pots.length !== NUM_POTS) return defaultState();
      return s;
    }
  } catch (_) {}
  return defaultState();
}

function saveGrowRoom(s: GrowRoomState) {
  s.lastUpdated = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
}

function loadHarvest(): Record<string, number> {
  try {
    const raw = localStorage.getItem(HARVEST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

function saveHarvest(h: Record<string, number>) {
  localStorage.setItem(HARVEST_KEY, JSON.stringify(h));
}

export function consumeGrowRoomHarvest(): Record<string, number> {
  const h = loadHarvest();
  localStorage.removeItem(HARVEST_KEY);
  return h;
}

// ---- Scene ----
export class GrowRoomScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private facing: Dir = 'up';
  private actingUntil = 0;
  private state!: GrowRoomState;

  // Per-pot visuals
  private potSprites: (Phaser.GameObjects.Image | null)[] = [];
  private cropSprites: (Phaser.GameObjects.Sprite | null)[] = [];
  private waterBars: (Phaser.GameObjects.Rectangle | null)[] = [];
  private waterBarBgs: (Phaser.GameObjects.Rectangle | null)[] = [];

  // Upgrades (read from FarmScene via registry)
  private upgrades = { growth: 0, lights: 0, pots: 0, trim: 0, fortune: 0, sprinkler: 0, market: 0 };


  // Pot pixel positions (world coords)
  private potPos: { x: number; y: number }[] = [];

  // Interaction tooltip
  private tooltip!: Phaser.GameObjects.Text;

  private exiting = false;

  private lightTime = 0;

  // Grow light overlay particles/emitters
  private lightBeams: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super('GrowRoom');
  }

  // Pot grid layout: 4 columns × 3 rows, centred in the room
  private potGridOrigin() {
    const roomPixW = ROOM_COLS * TILE;
    const roomPixH = ROOM_ROWS * TILE;
    const potSpacingX = 96;
    const potSpacingY = 88;
    const gridW = (POT_COLS - 1) * potSpacingX;
    const gridH = (POT_ROWS - 1) * potSpacingY;
    return {
      x0: (roomPixW - gridW) / 2,
      y0: (roomPixH - gridH) / 2 - 20,
      sx: potSpacingX,
      sy: potSpacingY,
    };
  }

  create(data: { upgrades?: Record<string, number>; coins?: number; seeds?: Record<string, number> }) {
    if (data.upgrades) this.upgrades = data.upgrades as typeof this.upgrades;
    
    this.exiting = false;
    

    this.state = loadGrowRoom();
    // Merge seeds passed from FarmScene (player's seed inventory)
    if (data.seeds) {
      for (const [k, v] of Object.entries(data.seeds)) {
        this.state.seeds[k] = (this.state.seeds[k] ?? 0) + v;
      }
    }

    // Fast-forward growth for time spent outside
    this.fastForwardGrowth();

    this.buildRoom();
    this.buildPots();
    this.buildPlayer();
    this.buildLights();
    this.setupCamera();
    this.buildUI();
    this.setupInput();
    this.setupBusListeners();

    // Sprinkler auto-water
    if (this.upgrades.sprinkler > 0) {
      this.time.addEvent({
        delay: sprinklerIntervalMs(this.upgrades.sprinkler),
        loop: true,
        callback: () => {
          for (let i = 0; i < NUM_POTS; i++) {
            const p = this.state.pots[i];
            if (p) { p.waterLevel = Math.min(100, p.waterLevel + 70); p.wet = true; }
          }
          this.refreshAllPotVisuals();
          saveGrowRoom(this.state);
        },
      });
    }
  }

  private fastForwardGrowth() {
    const now = Date.now();
    const elapsed = now - this.state.lastUpdated; // ms while away
    if (elapsed < 1000) return;

    const speedMult = growthFactor(this.upgrades.growth) * lightsFactor(this.upgrades.lights);
    for (const p of this.state.pots) {
      if (!p) continue;
      const plant = PLANT_BY_ID[p.plantId];
      if (!plant) continue;
      const total = plant.growthSeconds * 1000;
      // water decays over time
      const mins = elapsed / 60_000;
      p.waterLevel = Math.max(0, p.waterLevel - mins * 1.5);
      p.wet = p.waterLevel > 30;
      const wetBonus = p.wet ? 2 : 1;
      p.grownMs = Math.min(total, p.grownMs + elapsed * speedMult * wetBonus);
      p.stage = Math.min(STAGES - 1, Math.floor((p.grownMs / total) * (STAGES - 1)));
      if (p.grownMs >= total) p.stage = STAGES; // mature marker
    }
    this.state.lastUpdated = now;
    saveGrowRoom(this.state);
  }

  // ---- Room visuals ----
  private buildRoom() {
    const W = ROOM_COLS * TILE;
    const H = ROOM_ROWS * TILE;

    // --- Background wall (back wall color) ---
    this.add.rectangle(W / 2, H / 2, W, H, 0x2e1f0e).setDepth(-10);

    // --- Floor (warm wood planks) ---
    // Alternate two shades of wood for a plank effect
    for (let ty = 1; ty < ROOM_ROWS - 1; ty++) {
      const shade = ty % 2 === 0 ? 0x7a5230 : 0x8a6240;
      this.add.rectangle(W / 2, ty * TILE + TILE / 2, W - 2 * TILE, TILE, shade).setDepth(-8);
      // Plank groove lines
      this.add.rectangle(W / 2, ty * TILE + TILE - 1, W - 2 * TILE, 2, 0x5a3a1a).setDepth(-7);
    }

    // --- Back wall (top 2 rows) — lighter color ---
    this.add.rectangle(W / 2, TILE, W, TILE * 2, 0x4a3020).setDepth(-6);
    // Wall trim / shadow line
    this.add.rectangle(W / 2, TILE * 2 + 1, W, 3, 0x2a1a08).setDepth(-5);

    // --- Side walls ---
    this.add.rectangle(TILE / 2, H / 2, TILE, H, 0x3a2010).setDepth(-6);
    this.add.rectangle(W - TILE / 2, H / 2, TILE, H, 0x3a2010).setDepth(-6);

    // --- Bottom wall ---
    this.add.rectangle(W / 2, H - TILE / 2, W, TILE, 0x3a2010).setDepth(-6);

    // --- Door at bottom center ---
    const doorX = Math.floor(ROOM_COLS / 2) * TILE + TILE / 2;
    const doorY = H - TILE;
    // Door frame
    this.add.rectangle(doorX, doorY, TILE * 2 + 6, TILE + 4, 0x6b3a10).setDepth(-4);
    // Door panel
    this.add.rectangle(doorX, doorY, TILE * 2 - 4, TILE - 4, 0x8b5a2a).setDepth(-3);
    // Door knob
    this.add.circle(doorX + 14, doorY, 3, 0xffd700).setDepth(-2);

    // --- Workstation (trimming desk) top-left ---
    this.add.image(2 * TILE + TILE / 2, 2 * TILE + TILE / 2, 'workstation').setScale(2).setDepth(200);

    // --- Chest / stash box bottom-right ---
    this.add.image((ROOM_COLS - 3) * TILE, (ROOM_ROWS - 3) * TILE, 'chest', 1).setScale(2).setDepth((ROOM_ROWS - 3) * TILE);

    // --- Decor shelves top-right ---
    this.add.image((ROOM_COLS - 3) * TILE, 2 * TILE, 'furniture', 12).setScale(2).setDepth(200);
    this.add.image((ROOM_COLS - 2) * TILE, 2 * TILE, 'furniture', 13).setScale(2).setDepth(200);

    // --- Green ambient glow (grow op feel) ---
    this.add.rectangle(W / 2, H / 2, W - 2 * TILE, H - 2 * TILE, 0x00ff44).setAlpha(0.04).setDepth(-1);
  }

  private buildPots() {
    this.potPos = [];
    this.potSprites = [];
    this.cropSprites = [];
    this.waterBars = [];
    this.waterBarBgs = [];

    const g = this.potGridOrigin();

    for (let i = 0; i < NUM_POTS; i++) {
      const col = i % POT_COLS;
      const row = Math.floor(i / POT_COLS);
      const px = g.x0 + col * g.sx;
      const py = g.y0 + row * g.sy;
      this.potPos.push({ x: px, y: py });

      // Pot base (tilled soil, tinted like a pot)
      const potTint = this.upgrades.pots >= 3 ? 0x4488ff :
                      this.upgrades.pots >= 2 ? 0x66aa44 :
                      this.upgrades.pots >= 1 ? 0x886622 : 0x7a5230;
      const pot = this.add.image(px, py + 4, 'tilled', 3).setScale(2.5).setTint(potTint).setDepth(py);
      this.potSprites.push(pot);

      // Crop sprite (hidden if empty)
      const crop = this.add.sprite(px, py - 8, 'cropsheet', 0).setScale(2.5).setDepth(py + 1).setVisible(false);
      this.cropSprites.push(crop);

      // Water bar BG
      const barW = 40;
      const bg = this.add.rectangle(px, py + 20, barW, 4, 0x222222).setDepth(py + 2);
      this.waterBarBgs.push(bg);
      const bar = this.add.rectangle(px - barW / 2, py + 20, barW, 4, 0x4fc3f7).setOrigin(0, 0.5).setDepth(py + 3);
      this.waterBars.push(bar);

      // Click zone
      const zone = this.add.zone(px, py, TILE * 2.5, TILE * 2.5).setInteractive({ cursor: 'pointer' });
      zone.on('pointerdown', () => this.onPotClick(i));
      zone.on('pointerover', () => this.showTooltip(i, px, py));
      zone.on('pointerout', () => { this.tooltip.setVisible(false); });
    }

    this.refreshAllPotVisuals();
  }

  private buildPlayer() {
    const W = ROOM_COLS * TILE;
    const H = ROOM_ROWS * TILE;
    const doorX = Math.floor(ROOM_COLS / 2) * TILE + TILE;
    const playerY = (ROOM_ROWS - 4) * TILE;
    this.player = this.physics.add.sprite(doorX, playerY, 'pchar', 0).setScale(2).setDepth(playerY + 18);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(TILE, TILE, W - 2 * TILE, H - 2 * TILE);
    this.player.anims.play('idle-up', true);
  }

  private buildLights() {
    const lightsLvl = this.upgrades.lights;
    const W = ROOM_COLS * TILE;
    const H = ROOM_ROWS * TILE;

    // Always show ceiling light bars (even with no upgrades — basic room lighting)
    const barColor = lightsLvl === 0 ? 0xaaaaaa : [0xffe4a0, 0xfff0c0, 0xfff8d0, 0xffffff][lightsLvl - 1];
    const barAlpha = lightsLvl === 0 ? 0.4 : 0.95;
    const glowAlpha = lightsLvl === 0 ? 0.03 : 0.06 + lightsLvl * 0.04;
    const glowColor = lightsLvl === 0 ? 0xffffff : [0xffcc44, 0xffdd88, 0xffeeaa, 0xffffff][lightsLvl - 1];

    const g = this.potGridOrigin();
    for (let col = 0; col < POT_COLS; col++) {
      const lx = g.x0 + col * g.sx;
      // Ceiling light bar
      const bar = this.add.rectangle(lx, TILE + 4, 24, 8, barColor).setAlpha(barAlpha).setDepth(1000);
      this.lightBeams.push(bar);
      // Light cone downward
      const cone = this.add.rectangle(lx, TILE * 4, 56 + lightsLvl * 14, (ROOM_ROWS - 4) * TILE, glowColor).setAlpha(glowAlpha).setDepth(-1);
      this.lightBeams.push(cone);
    }
    // Ambient fill
    this.add.rectangle(W / 2, H / 2, W - 2 * TILE, H - 2 * TILE, glowColor).setAlpha(glowAlpha * 0.4).setDepth(-1);
  }

  private setupCamera() {
    const W = ROOM_COLS * TILE;
    const H = ROOM_ROWS * TILE;
    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setZoom(2);
  }

  private buildUI() {
    // Fixed-camera UI layer
    const cam = this.cameras.main;
    this.tooltip = this.add.text(0, 0, '', {
      fontFamily: 'Pixelify Sans, monospace', fontSize: '12px',
      color: '#ffffff', backgroundColor: '#000000cc', padding: { x: 6, y: 4 },
    }).setDepth(9999).setScrollFactor(0).setVisible(false);

    this.add.text(cam.width / 2, cam.height - 18, '▼ Walk to door to exit', {
      fontFamily: 'Pixelify Sans, monospace', fontSize: '10px', color: '#aaffaa', align: 'center',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9999);

    // Lights level badge
    const lightsText = ['No lights', 'CFL Lights', 'LED Lights', 'HPS Lights', 'Full-Spectrum'][this.upgrades.lights] ?? '';
    this.add.text(6, 6, `🏠 Grow Room  💡 ${lightsText}`, {
      fontFamily: 'Pixelify Sans, monospace', fontSize: '9px', color: '#ffee88', backgroundColor: '#00000099', padding: { x: 4, y: 2 },
    }).setScrollFactor(0).setDepth(9999);
  }

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  private setupBusListeners() {
    // Nothing for now — pot clicks are handled in-scene
  }

  // ---- Pot interaction ----
  private onPotClick(i: number) {
    const pot = this.state.pots[i];
    const { x, y } = this.potPos[i];
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y);
    if (dist > 120) {
      this.showFloater('Too far away!', x, y, '#ff8888');
      return;
    }

    const toolSelected = this.registry.get('selected') as string ?? 'hoe';

    if (!pot) {
      // Empty pot — plant with selected seed
      const seedId = this.registry.get('selectedSeed') as string;
      if (!seedId) { this.showFloater('Select a strain first!', x, y, '#ff8888'); return; }
      const seedKey = seedId;
      const seedCount = this.state.seeds[seedKey] ?? 0;
      if (seedCount <= 0) { this.showFloater('No seeds!', x, y, '#ff8888'); sfx.play('error'); return; }
      this.state.seeds[seedKey]--;
      this.state.pots[i] = {
        plantId: seedId, grownMs: 0, waterLevel: 80, stage: 0,
        wet: true, plantedAt: Date.now(), lastUpdated: Date.now(),
      };
      sfx.play('plant');
      this.showFloater('Planted! 🌱', x, y, '#aaffaa');
    } else if (pot.stage >= STAGES) {
      // Mature — harvest
      this.harvestPot(i);
    } else if (toolSelected === 'can' || this.cursors.shift?.isDown) {
      // Water
      pot.waterLevel = Math.min(100, pot.waterLevel + 60);
      pot.wet = true;
      sfx.play('water');
      this.showFloater('Watered! 💧', x, y, '#88ccff');
    } else {
      // Info click
      const plant = PLANT_BY_ID[pot.plantId];
      const pct = Math.min(100, Math.round((pot.grownMs / (plant.growthSeconds * 1000)) * 100));
      this.showFloater(`${plant.name} ${pct}% 💧${Math.round(pot.waterLevel)}%`, x, y, '#ffffff');
    }

    this.refreshPotVisuals(i);
    saveGrowRoom(this.state);
  }

  private harvestPot(i: number) {
    const pot = this.state.pots[i];
    if (!pot) return;
    const plant = PLANT_BY_ID[pot.plantId];
    if (!plant) return;

    const luck = fortuneLuck(this.upgrades.fortune);
    const mut = pickMutation(luck);
    const key = stackKey(plant.id, mut.id, pot.wet);
    const harvest = loadHarvest();
    harvest[key] = (harvest[key] ?? 0) + 1;
    saveHarvest(harvest);

    const value = Math.round(plant.baseValue * mut.mult * potsBonus(this.upgrades.pots) * trimBonus(this.upgrades.trim) * marketBonus(this.upgrades.market));
    this.showFloater(`Harvested! ${mut.id !== 'normal' ? mut.name + ' ' : ''}${plant.name} ~${value}🪙`, this.potPos[i].x, this.potPos[i].y, '#ffd700');
    sfx.play('harvest');

    this.state.pots[i] = null;
    this.refreshPotVisuals(i);
    saveGrowRoom(this.state);
  }

  // ---- Visuals refresh ----
  private refreshPotVisuals(i: number) {
    const pot = this.state.pots[i];
    const cropSprite = this.cropSprites[i];
    const waterBar = this.waterBars[i];

    if (!cropSprite || !waterBar) return;

    if (!pot) {
      cropSprite.setVisible(false);
      waterBar.setVisible(false);
      this.waterBarBgs[i]?.setVisible(false);
    } else {
      const plant = PLANT_BY_ID[pot.plantId];
      const stage = Math.min(STAGES - 1, pot.stage >= STAGES ? STAGES - 1 : pot.stage);
      const frame = plant.cropRow * 5 + stage;
      cropSprite.setFrame(frame).setVisible(true);
      if (plant.cropTint) cropSprite.setTint(plant.cropTint);
      else cropSprite.setTint(plant.color);

      if (pot.stage >= STAGES) {
        // Ready to harvest — pulse
        this.tweens.add({ targets: cropSprite, alpha: { from: 0.6, to: 1.0 }, duration: 600, yoyo: true, repeat: -1 });
      }

      const wPct = Math.max(0, Math.min(1, pot.waterLevel / 100));
      waterBar.setDisplaySize(40 * wPct, 4);
      waterBar.setFillStyle(pot.waterLevel < 25 ? 0xff4444 : 0x4fc3f7);
      waterBar.setVisible(true);
      this.waterBarBgs[i]?.setVisible(true);
    }
  }

  private refreshAllPotVisuals() {
    for (let i = 0; i < NUM_POTS; i++) this.refreshPotVisuals(i);
  }

  private showTooltip(i: number, px: number, py: number) {
    const pot = this.state.pots[i];
    let text = `Pot #${i + 1}: Empty — click to plant`;
    if (pot) {
      const plant = PLANT_BY_ID[pot.plantId];
      const pct = Math.min(100, Math.round((pot.grownMs / (plant.growthSeconds * 1000)) * 100));
      const stageNames = ['Seedling', 'Vegetative', 'Flowering', 'Ready!'];
      const stageName = pot.stage >= STAGES ? '✂️ HARVEST' : stageNames[Math.min(pot.stage, 3)] ?? 'Growing';
      text = `${plant.name} · ${stageName} · ${pct}% · 💧${Math.round(pot.waterLevel)}%`;
    }
    const cam = this.cameras.main;
    this.tooltip.setText(text).setPosition(8, cam.height - 36).setScrollFactor(0).setVisible(true);
  }

  private showFloater(msg: string, wx: number, wy: number, color: string) {
    const t = this.add.text(wx, wy - 20, msg, {
      fontFamily: 'Pixelify Sans, monospace', fontSize: '10px', color,
    }).setOrigin(0.5).setDepth(9998);
    this.tweens.add({ targets: t, y: wy - 50, alpha: 0, duration: 1200, onComplete: () => t.destroy() });
  }

  // ---- Update loop ----
  update(time: number, delta: number) {
    if (this.exiting) return;

    // Movement
    let vx = 0; let vy = 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) vx = -1;
    else if (this.cursors.right.isDown || this.wasd.right.isDown) vx = 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy = -1;
    else if (this.cursors.down.isDown || this.wasd.down.isDown) vy = 1;
    const len = Math.hypot(vx, vy) || 1;
    this.player.setVelocity((vx / len) * PLAYER_SPEED, (vy / len) * PLAYER_SPEED);
    if (vx !== 0 || vy !== 0) {
      this.actingUntil = 0;
      if (vx < 0) this.facing = 'left';
      else if (vx > 0) this.facing = 'right';
      else this.facing = vy < 0 ? 'up' : 'down';
      this.player.anims.play(`walk-${this.facing}`, true);
    } else if (time < this.actingUntil) {
      // tool pose
    } else {
      this.player.anims.play(`idle-${this.facing}`, true);
    }
    this.player.setDepth(this.player.y + 18);

    // Grow light flicker
    this.lightTime += delta;
    if (this.upgrades.lights > 0 && this.lightBeams.length > 0) {
      const flicker = 0.92 + Math.sin(this.lightTime * 0.003) * 0.08;
      for (const b of this.lightBeams) b.setAlpha((b.alpha > 0.5 ? 0.06 + this.upgrades.lights * 0.04 : 0.85) * flicker);
    }

    // Crop growth tick
    const speedMult = growthFactor(this.upgrades.growth) * lightsFactor(this.upgrades.lights);
    for (let i = 0; i < NUM_POTS; i++) {
      const pot = this.state.pots[i];
      if (!pot || pot.stage >= STAGES) continue;
      const plant = PLANT_BY_ID[pot.plantId];
      if (!plant) continue;
      const total = plant.growthSeconds * 1000;
      const wetBonus = pot.wet ? 2 : 1;
      pot.grownMs = Math.min(total, pot.grownMs + delta * speedMult * wetBonus);
      const ns = Math.min(STAGES - 1, Math.floor((pot.grownMs / total) * (STAGES - 1)));
      if (pot.grownMs >= total) {
        pot.stage = STAGES;
        this.refreshPotVisuals(i);
        const plant = PLANT_BY_ID[pot.plantId];
        this.showFloater(`${plant.name} ready! ✂️`, this.potPos[i].x, this.potPos[i].y, '#ffd700');
        sfx.play('level');
      } else if (ns !== pot.stage) {
        pot.stage = ns;
        this.cropSprites[i]?.setFrame(plant.cropRow * 5 + ns);
      }
      // water decay
      pot.waterLevel = Math.max(0, pot.waterLevel - delta * 0.001);
      pot.wet = pot.waterLevel > 20;
    }

    // Auto-save every 5s
    if (Math.floor(time / 5000) !== Math.floor((time - delta) / 5000)) {
      saveGrowRoom(this.state);
    }

    // Exit: player walks to bottom door
    const doorX = Math.floor(ROOM_COLS / 2) * TILE + TILE;

    if (this.player.y > (ROOM_ROWS - 2) * TILE - 8 && Math.abs(this.player.x - doorX) < TILE * 1.5) {
      this.exitRoom();
    }
  }

  private exitRoom() {
    if (this.exiting) return;
    this.exiting = true;
    this.player.setVelocity(0, 0);
    saveGrowRoom(this.state);
    sfx.play('step');
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop('GrowRoom');
      this.scene.wake('Farm');
    });
    this.cameras.main.fadeOut(300, 0, 0, 0);
  }
}
