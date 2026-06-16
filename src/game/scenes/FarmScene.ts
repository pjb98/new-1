import Phaser from "phaser";
import { EventBus, EV } from "../EventBus";
import { loadState, saveState, defaultPot, GameState, PotState, calcLevel, xpForLevel, CUSTOMERS } from "../save";
import { getStrain, STRAINS } from "../strains";
import { getItem, SHOP_ITEMS } from "../items";
import {
  GAME_W, GAME_H, REAL_MS_PER_GAME_MIN,
  WATER_DECAY_PER_MIN, NUTRIENT_DECAY_PER_MIN,
  QUALITY_BOOST_WATER, QUALITY_PENALTY_DRY, QUALITY_BOOST_FED,
  HEAT_DECAY_PER_MIN, COLORS
} from "../constants";
import { Audio } from "../audio";

const POT_W = 110;
const POT_H = 110;
const POT_COLS = 4;
const ROOM_X = 60;
const ROOM_Y = 120;

export class FarmScene extends Phaser.Scene {
  state!: GameState;
  private potContainers: Phaser.GameObjects.Container[] = [];
  private plantSprites: (Phaser.GameObjects.Image | null)[] = [];
  private waterBars: Phaser.GameObjects.Graphics[] = [];
  private nutrientBars: Phaser.GameObjects.Graphics[] = [];
  private glowTweens: (Phaser.Tweens.Tween | null)[] = [];
  private roomGfx!: Phaser.GameObjects.Graphics;
  private lightGfx!: Phaser.GameObjects.Graphics;
  private gameTimer!: Phaser.Time.TimerEvent;
  private lastSaveMin = 0;
  private matrixParticles: Phaser.GameObjects.Text[] = [];

  constructor() { super("FarmScene"); }

  create() {
    this.state = loadState();
    this.drawRoom();
    this.buildPotGrid();
    this.startGameTimer();
    EventBus.emit(EV.GAME_READY, this);
    EventBus.emit(EV.STATE_UPDATE, this.state);

    // Listen for UI actions
    EventBus.on("action:plant", this.handlePlant, this);
    EventBus.on("action:water", this.handleWater, this);
    EventBus.on("action:nutrient", this.handleNutrient, this);
    EventBus.on("action:harvest", this.handleHarvest, this);
    EventBus.on("action:buy_item", this.handleBuyItem, this);
    EventBus.on("action:buy_item_token", this.handleBuyItemToken, this);
    EventBus.on("action:sell", this.handleSell, this);
    EventBus.on("action:use_burner", this.handleBurner, this);
    EventBus.on("action:reset", () => { localStorage.removeItem("weed_sim_save_v1"); location.reload(); });
    EventBus.on("action:go_street", () => {
      saveState(this.state);
      this.scene.start("StreetScene", { state: this.state });
    });
    EventBus.on("weed_tokens_updated", (amount: number) => {
      this.state.weedTokens = amount;
      EventBus.emit(EV.STATE_UPDATE, this.state);
    });
  }

  private drawRoom() {
    this.cameras.main.setBackgroundColor(COLORS.room);
    this.roomGfx = this.add.graphics();
    this.lightGfx = this.add.graphics();
    this.redrawRoom();
  }

  private redrawRoom() {
    const hasNeon = this.state.cosmetics.includes("neon_room");
    const hasMatrix = this.state.cosmetics.includes("matrix_room");
    const floorColor = hasNeon ? 0x1a0033 : hasMatrix ? 0x001a00 : COLORS.floor;
    const wallColor = hasNeon ? 0x4a0066 : hasMatrix ? 0x003300 : COLORS.wall;

    this.roomGfx.clear();
    // Floor
    this.roomGfx.fillStyle(floorColor);
    this.roomGfx.fillRect(0, 0, GAME_W, GAME_H);
    // Back wall
    this.roomGfx.fillStyle(wallColor);
    this.roomGfx.fillRect(0, 0, GAME_W, 80);
    // Side walls
    this.roomGfx.fillStyle(wallColor, 0.5);
    this.roomGfx.fillRect(0, 0, 40, GAME_H);
    this.roomGfx.fillRect(GAME_W - 40, 0, 40, GAME_H);

    // Grow lights
    this.lightGfx.clear();
    const hasHPS = this.state.ownedItems.includes("hps_light");
    const hasPro = this.state.ownedItems.includes("pro_led");
    const hasLED = this.state.ownedItems.includes("basic_led");
    const lightColor = hasHPS ? 0xffa500 : hasPro ? 0xffffff : hasNeon ? 0xcc00ff : 0x90ee90;
    const lightAlpha = hasHPS ? 0.3 : 0.18;

    if (hasLED || hasPro || hasHPS) {
      for (let col = 0; col < POT_COLS; col++) {
        const cx = ROOM_X + col * POT_W + POT_W / 2;
        // Light fixture
        this.lightGfx.fillStyle(0x333333);
        this.lightGfx.fillRect(cx - 35, 20, 70, 12);
        this.lightGfx.fillStyle(lightColor);
        this.lightGfx.fillRect(cx - 30, 24, 60, 6);
        // Glow cone
        this.lightGfx.fillStyle(lightColor, lightAlpha);
        this.lightGfx.fillTriangle(cx - 30, 30, cx + 30, 30, cx + 50, 110);
        this.lightGfx.fillTriangle(cx - 30, 30, cx + 30, 30, cx - 50, 110);
      }
    }

    // Matrix effect
    if (hasMatrix) {
      this.matrixParticles.forEach(p => p.destroy());
      this.matrixParticles = [];
      for (let i = 0; i < 20; i++) {
        const x = Phaser.Math.Between(50, GAME_W - 50);
        const t = this.add.text(x, Phaser.Math.Between(0, GAME_H), "01101\n10010\n00111", {
          fontSize: "10px", color: "#00ff41"
        }).setAlpha(0.12);
        this.matrixParticles.push(t);
      }
    }

    // Table surfaces
    const rows = Math.ceil(this.state.pots.length / POT_COLS);
    for (let row = 0; row < rows; row++) {
      this.roomGfx.fillStyle(0x3e2723, 0.8);
      this.roomGfx.fillRect(ROOM_X - 10, ROOM_Y + row * POT_H - 5, POT_COLS * POT_W + 20, 10);
    }
  }

  private buildPotGrid() {
    this.potContainers.forEach(c => c.destroy());
    this.potContainers = [];
    this.plantSprites = [];
    this.waterBars = [];
    this.nutrientBars = [];
    this.glowTweens = [];

    const hasGolden = this.state.cosmetics.includes("golden_pots");

    this.state.pots.forEach((pot, i) => {
      const col = i % POT_COLS;
      const row = Math.floor(i / POT_COLS);
      const x = ROOM_X + col * POT_W + POT_W / 2;
      const y = ROOM_Y + row * POT_H + POT_H / 2;

      const container = this.add.container(x, y);

      // Pot base
      const potGfx = this.add.graphics();
      const potColor = hasGolden ? 0xffd700 : 0x5d4037;
      const rimColor = hasGolden ? 0xffb300 : 0x4e342e;
      potGfx.fillStyle(potColor);
      // trapezoid shape
      potGfx.fillPoints([
        { x: -30, y: 25 }, { x: 30, y: 25 },
        { x: 25, y: -10 }, { x: -25, y: -10 }
      ], true);
      potGfx.fillStyle(rimColor);
      potGfx.fillRect(-32, -14, 64, 8);
      potGfx.fillStyle(0x3e2723);
      potGfx.fillEllipse(0, -10, 56, 18);
      container.add(potGfx);

      // Plant sprite
      let plantSprite: Phaser.GameObjects.Image | null = null;
      if (pot.strainId && pot.stage !== "empty") {
        const texKey = pot.stage === "planted" ? "plant_planted" :
                       pot.stage === "seedling" ? "plant_seedling" :
                       pot.stage === "vegetative" ? "plant_vegetative" :
                       pot.stage === "flowering" ? "plant_flowering" : "plant_ready";
        plantSprite = this.add.image(0, -30, texKey).setScale(0.8);
        // Tint with strain color
        const strain = getStrain(pot.strainId);
        if (strain) plantSprite.setTint(strain.color);
        container.add(plantSprite);

        // Glow for ready plants
        if (pot.stage === "ready") {
          const tween = this.tweens.add({
            targets: plantSprite,
            alpha: { from: 0.7, to: 1 },
            duration: 800,
            yoyo: true,
            repeat: -1,
          });
          this.glowTweens.push(tween);
        } else {
          this.glowTweens.push(null);
        }
      } else {
        this.glowTweens.push(null);
      }
      this.plantSprites.push(plantSprite);

      // Water bar
      const wBar = this.add.graphics();
      container.add(wBar);
      this.waterBars.push(wBar);

      // Nutrient bar
      const nBar = this.add.graphics();
      container.add(nBar);
      this.nutrientBars.push(nBar);

      this.drawPotBars(i);

      // Pot number label
      const label = this.add.text(0, 30, `#${i + 1}`, { fontSize: "10px", color: "#888888" }).setOrigin(0.5);
      container.add(label);

      // Stage label
      if (pot.stage !== "empty") {
        const stageTxt = this.add.text(0, -55, pot.stage.toUpperCase(), { fontSize: "9px", color: "#aaffaa", fontStyle: "bold" }).setOrigin(0.5);
        container.add(stageTxt);
      }

      // Click interaction
      const hitArea = this.add.rectangle(0, 0, POT_W - 10, POT_H - 10, 0xffffff, 0).setInteractive({ cursor: "pointer" });
      hitArea.on("pointerover", () => { potGfx.lineStyle(2, 0x00ff88); potGfx.strokeRect(-32, -14, 64, 40); });
      hitArea.on("pointerout", () => { potGfx.clear(); this.redrawPotGfx(potGfx, i); });
      hitArea.on("pointerdown", () => { EventBus.emit(EV.POT_CLICKED, { potIndex: i, pot }); });
      container.add(hitArea);

      this.potContainers.push(container);
    });
  }

  private redrawPotGfx(g: Phaser.GameObjects.Graphics, i: number) {
    const hasGolden = this.state.cosmetics.includes("golden_pots");
    const potColor = hasGolden ? 0xffd700 : 0x5d4037;
    const rimColor = hasGolden ? 0xffb300 : 0x4e342e;
    g.fillStyle(potColor);
    g.fillPoints([{ x: -30, y: 25 }, { x: 30, y: 25 }, { x: 25, y: -10 }, { x: -25, y: -10 }], true);
    g.fillStyle(rimColor);
    g.fillRect(-32, -14, 64, 8);
    g.fillStyle(0x3e2723);
    g.fillEllipse(0, -10, 56, 18);
  }

  private drawPotBars(i: number) {
    const pot = this.state.pots[i];
    if (!pot || pot.stage === "empty") return;

    const wBar = this.waterBars[i];
    const nBar = this.nutrientBars[i];
    if (!wBar || !nBar) return;

    wBar.clear();
    nBar.clear();

    const w = 50;
    const bh = 4;
    const y = 38;

    // Water bar (blue)
    wBar.fillStyle(0x333333);
    wBar.fillRect(-w / 2, y, w, bh);
    const wPct = Math.max(0, pot.waterLevel / 100);
    wBar.fillStyle(wPct < 0.3 ? 0xff5252 : 0x4fc3f7);
    wBar.fillRect(-w / 2, y, w * wPct, bh);

    // Nutrient bar (green)
    nBar.fillStyle(0x333333);
    nBar.fillRect(-w / 2, y + 6, w, bh);
    const nPct = Math.max(0, pot.nutrientLevel / 100);
    nBar.fillStyle(nPct < 0.3 ? 0xff5252 : 0x66bb6a);
    nBar.fillRect(-w / 2, y + 6, w * nPct, bh);
  }

  private startGameTimer() {
    this.gameTimer = this.time.addEvent({
      delay: REAL_MS_PER_GAME_MIN,
      loop: true,
      callback: this.tickGameMinute,
      callbackScope: this,
    });
  }

  private tickGameMinute() {
    this.state.gameMins++;
    const dayLen = 1440;
    if (this.state.gameMins % dayLen === 0) {
      this.state.day++;
    }

    const hasAutoWater = this.state.ownedItems.includes("sprinkler");

    this.state.pots.forEach((pot, i) => {
      if (pot.stage === "empty" || !pot.strainId) return;

      const strain = getStrain(pot.strainId);
      if (!strain) return;

      // Auto water
      if (hasAutoWater && this.state.gameMins % 360 === 0) {
        pot.waterLevel = Math.min(100, pot.waterLevel + 80);
      }

      // Decay
      pot.waterLevel = Math.max(0, pot.waterLevel - WATER_DECAY_PER_MIN);
      pot.nutrientLevel = Math.max(0, pot.nutrientLevel - NUTRIENT_DECAY_PER_MIN);

      // Quality adjustments
      if (pot.waterLevel > 40) {
        pot.quality = Math.min(100, pot.quality + QUALITY_BOOST_WATER);
      } else {
        pot.quality = Math.max(0, pot.quality - QUALITY_PENALTY_DRY);
      }
      if (pot.nutrientLevel > 30) {
        pot.quality = Math.min(100, pot.quality + QUALITY_BOOST_FED);
      }

      // Grow speed modifiers
      let speedMult = 1;
      if (this.state.ownedItems.includes("hps_light")) speedMult += 0.25;
      else if (this.state.ownedItems.includes("pro_led")) speedMult += 0.1;
      if (this.state.ownedItems.includes("quantum_board")) speedMult += 0.4;

      // Progress (1440 mins per game day × growDays = total mins to grow)
      const totalMins = strain.growDays * dayLen;
      const increment = (100 / totalMins) * speedMult;
      pot.growProgress = Math.min(100, pot.growProgress + increment);

      // Stage transitions
      const prevStage = pot.stage;
      if (pot.growProgress >= 100) pot.stage = "ready";
      else if (pot.growProgress >= 75) pot.stage = "flowering";
      else if (pot.growProgress >= 50) pot.stage = "vegetative";
      else if (pot.growProgress >= 25) pot.stage = "seedling";
      else pot.stage = "planted";

      if (pot.stage !== prevStage) {
        this.rebuildPot(i);
        if (pot.stage === "ready") EventBus.emit(EV.NOTIFICATION, { msg: `🌿 Pot #${i + 1} (${strain.name}) is ready to harvest!`, type: "success" });
      } else {
        this.drawPotBars(i);
      }
    });

    // Heat decay
    this.state.heat = Math.max(0, this.state.heat - HEAT_DECAY_PER_MIN);

    // Auto-save every 5 game minutes
    if (this.state.gameMins - this.lastSaveMin >= 5) {
      saveState(this.state);
      this.lastSaveMin = this.state.gameMins;
    }

    EventBus.emit(EV.STATE_UPDATE, this.state);
  }

  private rebuildPot(i: number) {
    // Rebuild single pot container instead of full grid
    const container = this.potContainers[i];
    if (!container) return;
    container.destroy();
    this.potContainers[i] = undefined as any;

    const pot = this.state.pots[i];
    const col = i % POT_COLS;
    const row = Math.floor(i / POT_COLS);
    const x = ROOM_X + col * POT_W + POT_W / 2;
    const y = ROOM_Y + row * POT_H + POT_H / 2;

    const container2 = this.add.container(x, y);
    const hasGolden = this.state.cosmetics.includes("golden_pots");
    const potColor = hasGolden ? 0xffd700 : 0x5d4037;
    const rimColor = hasGolden ? 0xffb300 : 0x4e342e;

    const potGfx = this.add.graphics();
    potGfx.fillStyle(potColor);
    potGfx.fillPoints([{ x: -30, y: 25 }, { x: 30, y: 25 }, { x: 25, y: -10 }, { x: -25, y: -10 }], true);
    potGfx.fillStyle(rimColor);
    potGfx.fillRect(-32, -14, 64, 8);
    potGfx.fillStyle(0x3e2723);
    potGfx.fillEllipse(0, -10, 56, 18);
    container2.add(potGfx);

    if (pot.strainId && pot.stage !== "empty") {
      const texKey = pot.stage === "planted" ? "plant_planted" :
                     pot.stage === "seedling" ? "plant_seedling" :
                     pot.stage === "vegetative" ? "plant_vegetative" :
                     pot.stage === "flowering" ? "plant_flowering" : "plant_ready";
      const ps = this.add.image(0, -30, texKey).setScale(0.8);
      const strain = getStrain(pot.strainId);
      if (strain) ps.setTint(strain.color);
      container2.add(ps);
      this.plantSprites[i] = ps;

      if (pot.stage === "ready") {
        const tween = this.tweens.add({ targets: ps, alpha: { from: 0.7, to: 1 }, duration: 800, yoyo: true, repeat: -1 });
        this.glowTweens[i] = tween;
      }

      const stageTxt = this.add.text(0, -55, pot.stage.toUpperCase(), { fontSize: "9px", color: "#aaffaa", fontStyle: "bold" }).setOrigin(0.5);
      container2.add(stageTxt);
    }

    const wBar = this.add.graphics();
    const nBar = this.add.graphics();
    container2.add(wBar);
    container2.add(nBar);
    this.waterBars[i] = wBar;
    this.nutrientBars[i] = nBar;
    this.drawPotBars(i);

    const label = this.add.text(0, 30, `#${i + 1}`, { fontSize: "10px", color: "#888888" }).setOrigin(0.5);
    container2.add(label);

    const hitArea = this.add.rectangle(0, 0, POT_W - 10, POT_H - 10, 0xffffff, 0).setInteractive({ cursor: "pointer" });
    hitArea.on("pointerdown", () => EventBus.emit(EV.POT_CLICKED, { potIndex: i, pot }));
    container2.add(hitArea);

    this.potContainers[i] = container2;
  }

  // ---- Action Handlers ----

  handlePlant({ potIndex, strainId }: { potIndex: number; strainId: string }) {
    const pot = this.state.pots[potIndex];
    if (!pot || pot.stage !== "empty") return;
    const strain = getStrain(strainId);
    if (!strain) return;

    // Check if strain needs light
    const needsLight = ["rare", "legendary", "mythical", "divine", "prismatic", "celestial"].includes(strain.rarity);
    if (needsLight && !this.state.ownedItems.includes("basic_led") && !this.state.ownedItems.includes("pro_led") && !this.state.ownedItems.includes("hps_light")) {
      EventBus.emit(EV.NOTIFICATION, { msg: "⚠️ Need a grow light for this strain!", type: "error" });
      return;
    }

    const seedKey = `seed_${strainId}`;
    if ((this.state.inventory[seedKey] ?? 0) < 1) {
      EventBus.emit(EV.NOTIFICATION, { msg: "No seeds! Buy some from the shop.", type: "error" });
      return;
    }

    this.state.inventory[seedKey] = (this.state.inventory[seedKey] ?? 1) - 1;
    pot.strainId = strainId;
    pot.stage = "planted";
    pot.growProgress = 0;
    pot.waterLevel = 100;
    pot.nutrientLevel = 80;
    pot.quality = 50;
    pot.dayPlanted = this.state.day;
    Audio.plant();
    this.rebuildPot(potIndex);
    EventBus.emit(EV.STATE_UPDATE, this.state);
    EventBus.emit(EV.NOTIFICATION, { msg: `🌱 Planted ${strain.name} in Pot #${potIndex + 1}`, type: "success" });
  }

  handleWater({ potIndex }: { potIndex: number }) {
    const pot = this.state.pots[potIndex];
    if (!pot || pot.stage === "empty") return;
    const hasHose = this.state.ownedItems.includes("hose");
    const area = hasHose ? 3 : 1;
    const pots = this.state.pots.slice(potIndex, potIndex + area);
    pots.forEach((p, offset) => {
      if (p.stage !== "empty") {
        p.waterLevel = Math.min(100, p.waterLevel + 60);
        this.drawPotBars(potIndex + offset);
      }
    });
    Audio.water();
    EventBus.emit(EV.STATE_UPDATE, this.state);
  }

  handleNutrient({ potIndex, itemId }: { potIndex: number; itemId: string }) {
    const pot = this.state.pots[potIndex];
    if (!pot || pot.stage === "empty") return;
    const item = getItem(itemId);
    if (!item) return;

    const qty = this.state.inventory[itemId] ?? 0;
    if (qty < 1) {
      EventBus.emit(EV.NOTIFICATION, { msg: "No nutrients left!", type: "error" });
      return;
    }

    this.state.inventory[itemId] = qty - 1;
    const boost = item.effect?.qualityBoost ?? 5;
    pot.nutrientLevel = Math.min(100, pot.nutrientLevel + 40);
    pot.quality = Math.min(100, pot.quality + boost);

    if (item.effect?.speedBoost) {
      pot.growProgress = Math.min(99, pot.growProgress + (100 / (getStrain(pot.strainId ?? "")?.growDays ?? 3)) * item.effect.speedBoost);
    }

    Audio.nutrient();
    this.drawPotBars(potIndex);
    EventBus.emit(EV.STATE_UPDATE, this.state);
  }

  handleHarvest({ potIndex }: { potIndex: number }) {
    const pot = this.state.pots[potIndex];
    if (!pot || pot.stage !== "ready" || !pot.strainId) return;
    const strain = getStrain(pot.strainId);
    if (!strain) return;

    let grams = strain.yieldGrams;
    let quality = Math.round(pot.quality);

    // Tool bonuses
    if (this.state.ownedItems.includes("trimmer")) grams = Math.round(grams * 1.1);
    if (this.state.ownedItems.includes("ph_meter")) quality = Math.min(100, quality + 5);

    // Add to stash
    const existing = this.state.stash.find(s => s.strainId === pot.strainId && s.quality === quality && s.packaging === "none");
    if (existing) {
      existing.grams += grams;
    } else {
      this.state.stash.push({ strainId: pot.strainId, grams, quality, packaging: "none" });
    }

    // XP
    const rarityXP: Record<string, number> = { common: 5, uncommon: 10, rare: 20, legendary: 35, mythical: 55, divine: 80, prismatic: 120, celestial: 180 };
    const xpGain = rarityXP[strain.rarity] ?? 5;
    this.state.xp += xpGain;
    const newLevel = calcLevel(this.state.xp);
    if (newLevel > this.state.level) {
      this.state.level = newLevel;
      Audio.levelUp();
      EventBus.emit(EV.NOTIFICATION, { msg: `🎉 Level Up! You are now Level ${newLevel}!`, type: "success" });
      // Unlock customers
      const newCustomers = CUSTOMERS.filter(c => c.unlockLevel === newLevel).map(c => c.id);
      newCustomers.forEach(id => {
        if (!this.state.unlockedCustomers.includes(id)) {
          this.state.unlockedCustomers.push(id);
          const customer = CUSTOMERS.find(c => c.id === id);
          EventBus.emit(EV.NOTIFICATION, { msg: `📱 New contact: ${customer?.name}!`, type: "success" });
        }
      });
    }

    this.state.stats.totalHarvests++;
    Audio.harvest();

    // Reset pot
    pot.strainId = null;
    pot.stage = "empty";
    pot.growProgress = 0;
    pot.waterLevel = 100;
    pot.nutrientLevel = 100;
    pot.quality = 50;

    this.rebuildPot(potIndex);
    EventBus.emit(EV.STATE_UPDATE, this.state);
    EventBus.emit(EV.NOTIFICATION, { msg: `✂️ Harvested ${grams}g of ${strain.name} (Quality: ${quality}%)`, type: "success" });
    saveState(this.state);
  }

  handleBuyItem({ itemId, isSeed, strainId }: { itemId: string; isSeed?: boolean; strainId?: string }) {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item || item.currency !== "cash") return;
    if (this.state.level < item.unlockLevel) {
      EventBus.emit(EV.NOTIFICATION, { msg: `🔒 Requires Level ${item.unlockLevel}`, type: "error" });
      return;
    }

    const cost = item.cost;
    if (this.state.money < cost) {
      EventBus.emit(EV.NOTIFICATION, { msg: "Not enough money!", type: "error" });
      Audio.error();
      return;
    }

    this.state.money -= cost;

    if (isSeed && strainId) {
      const seedKey = `seed_${strainId}`;
      this.state.inventory[seedKey] = (this.state.inventory[seedKey] ?? 0) + 1;
      const strain = getStrain(strainId);
      EventBus.emit(EV.NOTIFICATION, { msg: `🌱 Bought 1x ${strain?.name} seed`, type: "success" });
    } else if (item.category === "pot") {
      // Add a new pot slot
      if (this.state.pots.length < 24) {
        const newPot = defaultPot(this.state.pots.length);
        newPot.potType = itemId;
        this.state.pots.push(newPot);
        this.buildPotGrid();
        this.redrawRoom();
        EventBus.emit(EV.NOTIFICATION, { msg: `🪴 Added new pot slot! (${this.state.pots.length} total)`, type: "success" });
      }
    } else if (item.stackable) {
      this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) + 1;
      EventBus.emit(EV.NOTIFICATION, { msg: `✅ Bought ${item.name}`, type: "success" });
    } else {
      if (!this.state.ownedItems.includes(itemId)) {
        this.state.ownedItems.push(itemId);
        this.redrawRoom();
      }
      EventBus.emit(EV.NOTIFICATION, { msg: `✅ Bought ${item.name}`, type: "success" });
    }

    Audio.buy();
    EventBus.emit(EV.STATE_UPDATE, this.state);
    saveState(this.state);
  }

  handleBuyItemToken({ itemId, isSeed, strainId }: { itemId: string; isSeed?: boolean; strainId?: string }) {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item || item.currency !== "weed_token") return;
    if (this.state.level < item.unlockLevel) {
      EventBus.emit(EV.NOTIFICATION, { msg: `🔒 Requires Level ${item.unlockLevel}`, type: "error" });
      return;
    }
    if (this.state.weedTokens < item.cost) {
      EventBus.emit(EV.NOTIFICATION, { msg: `Need ${item.cost} $WEED tokens!`, type: "error" });
      Audio.error();
      return;
    }

    this.state.weedTokens -= item.cost;
    EventBus.emit("spend_weed_tokens", item.cost);

    if (isSeed && strainId) {
      const seedKey = `seed_${strainId}`;
      this.state.inventory[seedKey] = (this.state.inventory[seedKey] ?? 0) + 1;
    } else if (item.category === "cosmetic") {
      if (!this.state.cosmetics.includes(itemId)) {
        this.state.cosmetics.push(itemId);
        this.redrawRoom();
        this.buildPotGrid();
      }
    } else if (item.category === "pot") {
      if (this.state.pots.length < 24) {
        const newPot = defaultPot(this.state.pots.length);
        newPot.potType = itemId;
        this.state.pots.push(newPot);
        this.buildPotGrid();
        this.redrawRoom();
      }
    } else if (item.stackable) {
      this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) + 1;
    } else {
      if (!this.state.ownedItems.includes(itemId)) this.state.ownedItems.push(itemId);
      this.redrawRoom();
    }

    Audio.buy();
    EventBus.emit(EV.NOTIFICATION, { msg: `✅ Bought ${item.name} with $WEED`, type: "success" });
    EventBus.emit(EV.STATE_UPDATE, this.state);
    saveState(this.state);
  }

  handleSell({ strainId, grams, quality, packaging, customerId }: { strainId: string; grams: number; quality: number; packaging: string; customerId: string }) {
    const strain = getStrain(strainId);
    const customer = this.state.customers.find(c => c.id === customerId);
    if (!strain || !customer) return;

    const stashEntry = this.state.stash.find(s => s.strainId === strainId && s.quality === quality);
    if (!stashEntry || stashEntry.grams < grams) {
      EventBus.emit(EV.NOTIFICATION, { msg: "Not enough product in stash!", type: "error" });
      return;
    }

    let price = strain.sellPricePerG * customer.priceMultiplier * (quality / 100) * grams;
    // Packaging bonus
    const packBonuses: Record<string, number> = { zip: 1, jar: 1.1, luxury: 1.25, weed_pack: 1.4 };
    price *= packBonuses[packaging] ?? 1;
    price = Math.round(price);

    stashEntry.grams -= grams;
    if (stashEntry.grams <= 0) this.state.stash = this.state.stash.filter(s => s !== stashEntry);

    this.state.money += price;
    this.state.stats.totalSold += grams;
    this.state.stats.totalEarned += price;
    this.state.xp += Math.round(grams * 0.5);

    // Heat
    const heatGain = grams * 0.3 + (strain.rarity === "prismatic" || strain.rarity === "celestial" ? 10 : 0);
    this.state.heat = Math.min(100, this.state.heat + heatGain);

    // Customer cooldown
    const cust = this.state.customers.find(c => c.id === customerId);
    if (cust) cust.lastBoughtAt = this.state.gameMins;

    Audio.sell();
    EventBus.emit(EV.STATE_UPDATE, this.state);
    EventBus.emit(EV.NOTIFICATION, { msg: `💰 Sold ${grams}g to ${customer.name} for $${price}!`, type: "success" });
    saveState(this.state);
  }

  handleBurner({ itemId }: { itemId: string }) {
    const item = getItem(itemId);
    if (!item) return;
    const qty = this.state.inventory[itemId] ?? 0;
    if (qty < 1) { EventBus.emit(EV.NOTIFICATION, { msg: "No burner phones!", type: "error" }); return; }
    this.state.inventory[itemId] = qty - 1;
    const reduction = item.effect?.heatReduce ?? 30;
    this.state.heat = Math.max(0, this.state.heat - reduction);
    EventBus.emit(EV.NOTIFICATION, { msg: `📱 Used burner phone. Heat -${reduction}`, type: "success" });
    EventBus.emit(EV.STATE_UPDATE, this.state);
    saveState(this.state);
  }

  shutdown() {
    EventBus.off("action:plant", this.handlePlant, this);
    EventBus.off("action:water", this.handleWater, this);
    EventBus.off("action:nutrient", this.handleNutrient, this);
    EventBus.off("action:harvest", this.handleHarvest, this);
    EventBus.off("action:buy_item", this.handleBuyItem, this);
    EventBus.off("action:buy_item_token", this.handleBuyItemToken, this);
    EventBus.off("action:sell", this.handleSell, this);
    EventBus.off("action:use_burner", this.handleBurner, this);
  }
}
