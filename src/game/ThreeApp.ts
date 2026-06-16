import * as THREE from "three";
import { EventBus, EV } from "./EventBus";
import { loadState, saveState, defaultPot, GameState, calcLevel, xpForLevel, CUSTOMERS } from "./save";
import { getStrain } from "./strains";
import { getItem, SHOP_ITEMS } from "./items";
import {
  REAL_MS_PER_GAME_MIN, WATER_DECAY_PER_MIN, NUTRIENT_DECAY_PER_MIN,
  QUALITY_BOOST_WATER, QUALITY_PENALTY_DRY, QUALITY_BOOST_FED, HEAT_DECAY_PER_MIN,
} from "./constants";
import { Audio } from "./audio";
import { FarmView } from "./scenes/FarmScene";
import { StreetView } from "./scenes/StreetScene";

export class ThreeApp {
  private renderer!: THREE.WebGLRenderer;
  private state!: GameState;
  private farmView?: FarmView;
  private streetView?: StreetView;
  private currentScene: "farm" | "street" = "farm";
  private lastTime = 0;
  private gameTickAccum = 0;
  private lastSaveMin = 0;
  private animFrameId = 0;

  init(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Use window dimensions — canvas may have 0 clientWidth at init time
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.state = loadState();

    // Register all action handlers once
    const evs = ["action:plant","action:water","action:nutrient","action:harvest",
                  "action:buy_item","action:buy_item_token","action:sell",
                  "action:use_burner","action:reset","action:go_street",
                  "action:go_farm","weed_tokens_updated"];
    evs.forEach(ev => EventBus.removeAllListeners(ev));

    EventBus.on("action:plant", this.handlePlant.bind(this));
    EventBus.on("action:water", this.handleWater.bind(this));
    EventBus.on("action:nutrient", this.handleNutrient.bind(this));
    EventBus.on("action:harvest", this.handleHarvest.bind(this));
    EventBus.on("action:buy_item", this.handleBuyItem.bind(this));
    EventBus.on("action:buy_item_token", this.handleBuyItemToken.bind(this));
    EventBus.on("action:sell", this.handleSell.bind(this));
    EventBus.on("action:use_burner", this.handleBurner.bind(this));
    EventBus.on("action:reset", () => { localStorage.removeItem("weed_sim_save_v1"); location.reload(); });
    EventBus.on("action:go_street", () => this.switchScene("street"));
    EventBus.on("action:go_farm", () => this.switchScene("farm"));
    EventBus.on("weed_tokens_updated", (amount: number) => {
      this.state.weedTokens = amount;
      EventBus.emit(EV.STATE_UPDATE, this.state);
    });

    window.addEventListener("resize", this.onResize.bind(this));

    this.showFarm();
    EventBus.emit(EV.GAME_READY, this.state);
    EventBus.emit(EV.STATE_UPDATE, this.state);

    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private showFarm() {
    this.streetView?.dispose();
    this.streetView = undefined;
    this.farmView = new FarmView();
    this.farmView.init(this.renderer, this.state);
    this.currentScene = "farm";
    EventBus.emit(EV.SCENE_CHANGE, "farm");
  }

  private showStreet() {
    this.farmView = undefined;
    this.streetView = new StreetView();
    this.streetView.init(this.renderer, this.state);
    this.currentScene = "street";
    EventBus.emit(EV.SCENE_CHANGE, "street");
  }

  private switchScene(to: "farm" | "street") {
    saveState(this.state);
    if (to === "street") this.showStreet();
    else this.showFarm();
  }

  private onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.farmView?.onResize(this.renderer);
    this.streetView?.onResize(this.renderer);
  }

  private loop(now: number) {
    this.animFrameId = requestAnimationFrame(this.loop.bind(this));
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // Game time tick
    this.gameTickAccum += dt * 1000;
    while (this.gameTickAccum >= REAL_MS_PER_GAME_MIN) {
      this.gameTickAccum -= REAL_MS_PER_GAME_MIN;
      this.tickGameMinute();
    }

    if (this.farmView) {
      this.farmView.update(dt, this.state);
      this.farmView.render(this.renderer);
    } else if (this.streetView) {
      this.streetView.update(dt, this.state);
      this.streetView.render(this.renderer);
    }
  }

  private tickGameMinute() {
    this.state.gameMins++;
    const dayLen = 1440;
    if (this.state.gameMins % dayLen === 0) this.state.day++;

    const hasAutoWater = this.state.ownedItems.includes("sprinkler");

    this.state.pots.forEach((pot, i) => {
      if (pot.stage === "empty" || !pot.strainId) return;
      const strain = getStrain(pot.strainId);
      if (!strain) return;

      if (hasAutoWater && this.state.gameMins % 360 === 0)
        pot.waterLevel = Math.min(100, pot.waterLevel + 80);

      pot.waterLevel = Math.max(0, pot.waterLevel - WATER_DECAY_PER_MIN);
      pot.nutrientLevel = Math.max(0, pot.nutrientLevel - NUTRIENT_DECAY_PER_MIN);

      if (pot.waterLevel > 40) pot.quality = Math.min(100, pot.quality + QUALITY_BOOST_WATER);
      else pot.quality = Math.max(0, pot.quality - QUALITY_PENALTY_DRY);
      if (pot.nutrientLevel > 30) pot.quality = Math.min(100, pot.quality + QUALITY_BOOST_FED);

      let speedMult = 1;
      if (this.state.ownedItems.includes("hps_light")) speedMult += 0.25;
      else if (this.state.ownedItems.includes("pro_led")) speedMult += 0.1;
      if (this.state.ownedItems.includes("quantum_board")) speedMult += 0.4;

      const totalMins = strain.growDays * dayLen;
      pot.growProgress = Math.min(100, pot.growProgress + (100 / totalMins) * speedMult);

      const prevStage = pot.stage;
      if (pot.growProgress >= 100) pot.stage = "ready";
      else if (pot.growProgress >= 75) pot.stage = "flowering";
      else if (pot.growProgress >= 50) pot.stage = "vegetative";
      else if (pot.growProgress >= 25) pot.stage = "seedling";
      else pot.stage = "planted";

      if (pot.stage !== prevStage) {
        this.farmView?.updatePot(pot);
        if (pot.stage === "ready")
          EventBus.emit(EV.NOTIFICATION, { msg: `🌿 Pot #${i + 1} (${strain.name}) is ready to harvest!`, type: "success" });
      } else {
        this.farmView?.updatePot(pot);
      }
    });

    this.state.heat = Math.max(0, this.state.heat - HEAT_DECAY_PER_MIN);

    if (this.state.gameMins - this.lastSaveMin >= 5) {
      saveState(this.state);
      this.lastSaveMin = this.state.gameMins;
    }

    EventBus.emit(EV.STATE_UPDATE, this.state);
  }

  // ---- Action Handlers ----

  private handlePlant({ potIndex, strainId }: { potIndex: number; strainId: string }) {
    const pot = this.state.pots[potIndex];
    if (!pot || pot.stage !== "empty") return;
    const strain = getStrain(strainId);
    if (!strain) return;

    const needsLight = ["rare","legendary","mythical","divine","prismatic","celestial"].includes(strain.rarity);
    if (needsLight && !this.state.ownedItems.some(i => ["basic_led","pro_led","hps_light"].includes(i))) {
      EventBus.emit(EV.NOTIFICATION, { msg: "⚠️ Need a grow light for this strain!", type: "error" });
      return;
    }

    const seedKey = `seed_${strainId}`;
    if ((this.state.inventory[seedKey] ?? 0) < 1) {
      EventBus.emit(EV.NOTIFICATION, { msg: "No seeds! Buy some from the shop.", type: "error" });
      return;
    }

    this.state.inventory[seedKey]--;
    pot.strainId = strainId;
    pot.stage = "planted";
    pot.growProgress = 0;
    pot.waterLevel = 100;
    pot.nutrientLevel = 80;
    pot.quality = 50;
    pot.dayPlanted = this.state.day;
    Audio.plant();
    this.farmView?.updatePot(pot);
    EventBus.emit(EV.STATE_UPDATE, this.state);
    EventBus.emit(EV.NOTIFICATION, { msg: `🌱 Planted ${strain.name} in Pot #${potIndex + 1}`, type: "success" });
  }

  private handleWater({ potIndex }: { potIndex: number }) {
    const pot = this.state.pots[potIndex];
    if (!pot || pot.stage === "empty") return;
    const area = this.state.ownedItems.includes("hose") ? 3 : 1;
    this.state.pots.slice(potIndex, potIndex + area).forEach(p => {
      if (p.stage !== "empty") {
        p.waterLevel = Math.min(100, p.waterLevel + 60);
        this.farmView?.updatePot(p);
      }
    });
    Audio.water();
    EventBus.emit(EV.STATE_UPDATE, this.state);
  }

  private handleNutrient({ potIndex, itemId }: { potIndex: number; itemId: string }) {
    const pot = this.state.pots[potIndex];
    if (!pot || pot.stage === "empty") return;
    const item = getItem(itemId);
    if (!item) return;
    const qty = this.state.inventory[itemId] ?? 0;
    if (qty < 1) { EventBus.emit(EV.NOTIFICATION, { msg: "No nutrients left!", type: "error" }); return; }
    this.state.inventory[itemId] = qty - 1;
    pot.nutrientLevel = Math.min(100, pot.nutrientLevel + 40);
    pot.quality = Math.min(100, pot.quality + (item.effect?.qualityBoost ?? 5));
    if (item.effect?.speedBoost) {
      const strain = getStrain(pot.strainId ?? "");
      pot.growProgress = Math.min(99, pot.growProgress + (100 / ((strain?.growDays ?? 3) * 1440)) * item.effect.speedBoost * 1440);
    }
    Audio.nutrient();
    this.farmView?.updatePot(pot);
    EventBus.emit(EV.STATE_UPDATE, this.state);
  }

  private handleHarvest({ potIndex }: { potIndex: number }) {
    const pot = this.state.pots[potIndex];
    if (!pot || pot.stage !== "ready" || !pot.strainId) return;
    const strain = getStrain(pot.strainId);
    if (!strain) return;

    let grams = strain.yieldGrams;
    let quality = Math.round(pot.quality);
    if (this.state.ownedItems.includes("trimmer")) grams = Math.round(grams * 1.1);
    if (this.state.ownedItems.includes("ph_meter")) quality = Math.min(100, quality + 5);

    const existing = this.state.stash.find(s => s.strainId === pot.strainId && s.quality === quality && s.packaging === "none");
    if (existing) existing.grams += grams;
    else this.state.stash.push({ strainId: pot.strainId, grams, quality, packaging: "none" });

    const rarityXP: Record<string, number> = { common:5, uncommon:10, rare:20, legendary:35, mythical:55, divine:80, prismatic:120, celestial:180 };
    this.state.xp += rarityXP[strain.rarity] ?? 5;
    const newLevel = calcLevel(this.state.xp);
    if (newLevel > this.state.level) {
      this.state.level = newLevel;
      Audio.levelUp();
      EventBus.emit(EV.NOTIFICATION, { msg: `🎉 Level Up! You are now Level ${newLevel}!`, type: "success" });
      CUSTOMERS.filter(c => c.unlockLevel === newLevel).forEach(c => {
        if (!this.state.unlockedCustomers.includes(c.id)) {
          this.state.unlockedCustomers.push(c.id);
          EventBus.emit(EV.NOTIFICATION, { msg: `📱 New contact: ${c.name}!`, type: "success" });
        }
      });
    }

    this.state.stats.totalHarvests++;
    Audio.harvest();

    pot.strainId = null;
    pot.stage = "empty";
    pot.growProgress = 0;
    pot.waterLevel = 100;
    pot.nutrientLevel = 100;
    pot.quality = 50;

    this.farmView?.updatePot(pot);
    EventBus.emit(EV.STATE_UPDATE, this.state);
    EventBus.emit(EV.NOTIFICATION, { msg: `✂️ Harvested ${grams}g of ${strain.name} (Quality: ${quality}%)`, type: "success" });
    saveState(this.state);
  }

  private handleBuyItem({ itemId, isSeed, strainId }: { itemId: string; isSeed?: boolean; strainId?: string }) {
    if (isSeed && strainId) {
      const strain = getStrain(strainId);
      if (!strain) return;
      if (this.state.level < strain.unlockLevel) {
        EventBus.emit(EV.NOTIFICATION, { msg: `🔒 Requires Level ${strain.unlockLevel}`, type: "error" }); return;
      }
      if (this.state.money < strain.seedCost) {
        EventBus.emit(EV.NOTIFICATION, { msg: "Not enough money!", type: "error" }); Audio.error(); return;
      }
      this.state.money -= strain.seedCost;
      const seedKey = `seed_${strainId}`;
      this.state.inventory[seedKey] = (this.state.inventory[seedKey] ?? 0) + 1;
      Audio.buy();
      EventBus.emit(EV.NOTIFICATION, { msg: `🌱 Bought 1x ${strain.name} seed`, type: "success" });
      EventBus.emit(EV.STATE_UPDATE, this.state);
      saveState(this.state);
      return;
    }

    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item || item.currency !== "cash") return;
    if (this.state.level < item.unlockLevel) {
      EventBus.emit(EV.NOTIFICATION, { msg: `🔒 Requires Level ${item.unlockLevel}`, type: "error" }); return;
    }
    if (this.state.money < item.cost) {
      EventBus.emit(EV.NOTIFICATION, { msg: "Not enough money!", type: "error" }); Audio.error(); return;
    }
    this.state.money -= item.cost;

    if (item.category === "pot") {
      if (this.state.pots.length < 24) {
        const newPot = defaultPot(this.state.pots.length);
        newPot.potType = itemId;
        this.state.pots.push(newPot);
        this.switchScene("farm"); // Rebuild farm view
        EventBus.emit(EV.NOTIFICATION, { msg: `🪴 Added new pot! (${this.state.pots.length} total)`, type: "success" });
      }
    } else if (item.stackable) {
      this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) + 1;
      EventBus.emit(EV.NOTIFICATION, { msg: `✅ Bought ${item.name}`, type: "success" });
    } else {
      if (!this.state.ownedItems.includes(itemId)) this.state.ownedItems.push(itemId);
      EventBus.emit(EV.NOTIFICATION, { msg: `✅ Bought ${item.name}`, type: "success" });
    }
    Audio.buy();
    EventBus.emit(EV.STATE_UPDATE, this.state);
    saveState(this.state);
  }

  private handleBuyItemToken({ itemId, isSeed, strainId }: { itemId: string; isSeed?: boolean; strainId?: string }) {
    if (isSeed && strainId) {
      const strain = getStrain(strainId);
      if (!strain) return;
      if (this.state.level < strain.unlockLevel) {
        EventBus.emit(EV.NOTIFICATION, { msg: `🔒 Requires Level ${strain.unlockLevel}`, type: "error" }); return;
      }
      if (this.state.weedTokens < strain.seedCost) {
        EventBus.emit(EV.NOTIFICATION, { msg: `Need ${strain.seedCost} $WEED tokens!`, type: "error" }); Audio.error(); return;
      }
      this.state.weedTokens -= strain.seedCost;
      const seedKey = `seed_${strainId}`;
      this.state.inventory[seedKey] = (this.state.inventory[seedKey] ?? 0) + 1;
      Audio.buy();
      EventBus.emit(EV.NOTIFICATION, { msg: `🌱 Bought 1x ${strain.name} seed with $WEED`, type: "success" });
      EventBus.emit(EV.STATE_UPDATE, this.state);
      saveState(this.state);
      return;
    }

    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item || item.currency !== "weed_token") return;
    if (this.state.level < item.unlockLevel) {
      EventBus.emit(EV.NOTIFICATION, { msg: `🔒 Requires Level ${item.unlockLevel}`, type: "error" }); return;
    }
    if (this.state.weedTokens < item.cost) {
      EventBus.emit(EV.NOTIFICATION, { msg: `Need ${item.cost} $WEED tokens!`, type: "error" }); Audio.error(); return;
    }
    this.state.weedTokens -= item.cost;

    if (item.category === "cosmetic") {
      if (!this.state.cosmetics.includes(itemId)) this.state.cosmetics.push(itemId);
    } else if (item.category === "pot") {
      if (this.state.pots.length < 24) {
        const newPot = defaultPot(this.state.pots.length);
        newPot.potType = itemId;
        this.state.pots.push(newPot);
        this.switchScene("farm");
      }
    } else if (item.stackable) {
      this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) + 1;
    } else {
      if (!this.state.ownedItems.includes(itemId)) this.state.ownedItems.push(itemId);
    }
    Audio.buy();
    EventBus.emit(EV.NOTIFICATION, { msg: `✅ Bought ${item.name} with $WEED`, type: "success" });
    EventBus.emit(EV.STATE_UPDATE, this.state);
    saveState(this.state);
  }

  private handleSell({ strainId, grams, quality, packaging, customerId }: { strainId: string; grams: number; quality: number; packaging: string; customerId: string }) {
    const strain = getStrain(strainId);
    const customer = this.state.customers.find(c => c.id === customerId);
    if (!strain || !customer) return;

    const stashEntry = this.state.stash.find(s => s.strainId === strainId && s.quality === quality);
    if (!stashEntry || stashEntry.grams < grams) {
      EventBus.emit(EV.NOTIFICATION, { msg: "Not enough product in stash!", type: "error" }); return;
    }

    let price = strain.sellPricePerG * customer.priceMultiplier * (quality / 100) * grams;
    const packBonuses: Record<string, number> = { zip: 1, jar: 1.1, luxury: 1.25, weed_pack: 1.4 };
    price = Math.round(price * (packBonuses[packaging] ?? 1));

    stashEntry.grams -= grams;
    if (stashEntry.grams <= 0) this.state.stash = this.state.stash.filter(s => s !== stashEntry);
    this.state.money += price;
    this.state.stats.totalSold += grams;
    this.state.stats.totalEarned += price;
    this.state.xp += Math.round(grams * 0.5);
    this.state.heat = Math.min(100, this.state.heat + grams * 0.3);

    const cust = this.state.customers.find(c => c.id === customerId);
    if (cust) cust.lastBoughtAt = this.state.gameMins;

    Audio.sell();
    EventBus.emit(EV.STATE_UPDATE, this.state);
    EventBus.emit(EV.NOTIFICATION, { msg: `💰 Sold ${grams}g to ${customer.name} for $${price}!`, type: "success" });
    saveState(this.state);
  }

  private handleBurner({ itemId }: { itemId: string }) {
    const item = getItem(itemId);
    if (!item) return;
    const qty = this.state.inventory[itemId] ?? 0;
    if (qty < 1) { EventBus.emit(EV.NOTIFICATION, { msg: "No burner phones!", type: "error" }); return; }
    this.state.inventory[itemId] = qty - 1;
    this.state.heat = Math.max(0, this.state.heat - (item.effect?.heatReduce ?? 30));
    EventBus.emit(EV.NOTIFICATION, { msg: `📱 Heat reduced!`, type: "success" });
    EventBus.emit(EV.STATE_UPDATE, this.state);
    saveState(this.state);
  }

  destroy() {
    cancelAnimationFrame(this.animFrameId);
    this.streetView?.dispose();
    this.renderer.dispose();
    window.removeEventListener("resize", this.onResize.bind(this));
  }
}
