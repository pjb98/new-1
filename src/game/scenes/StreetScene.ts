import Phaser from "phaser";
import { EventBus, EV } from "../EventBus";
import { loadState, saveState, GameState, CUSTOMERS } from "../save";
import { GAME_W, GAME_H, COLORS } from "../constants";

interface NPC {
  sprite: Phaser.GameObjects.Container;
  customerId: string;
  targetX: number;
  targetY: number;
  speed: number;
  zone: { x: number; y: number; r: number };
  interactRange: number;
  nameLabel: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Container | null;
}

export class StreetScene extends Phaser.Scene {
  private state!: GameState;
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Graphics;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private npcs: NPC[] = [];
  private policeSprite: Phaser.GameObjects.Container | null = null;
  private policeDirX = 1;
  private heatWarning: Phaser.GameObjects.Text | null = null;
  private nearbyCustomerId: string | null = null;
  private interactPrompt: Phaser.GameObjects.Text | null = null;

  constructor() { super("StreetScene"); }

  init(data: { state: GameState }) {
    this.state = data?.state ?? loadState();
  }

  create() {
    this.cameras.main.setBackgroundColor(0x2d2d2d);
    this.drawStreet();
    this.spawnPlayer();
    this.spawnNPCs();
    this.setupInput();
    if (this.state.heat >= 60) this.spawnPolice();

    this.interactPrompt = this.add.text(GAME_W / 2, GAME_H - 40, "", {
      fontSize: "16px", color: "#ffffff", backgroundColor: "#000000aa", padding: { x: 10, y: 5 }
    }).setOrigin(0.5).setDepth(10);

    EventBus.emit(EV.STATE_UPDATE, this.state);
    EventBus.emit(EV.SCENE_CHANGE, "street");
    EventBus.on("action:go_farm", () => {
      saveState(this.state);
      EventBus.emit(EV.SCENE_CHANGE, "farm");
      this.scene.start("FarmScene");
    });
    EventBus.on("action:sell", this.handleSell, this);
  }

  private drawStreet() {
    const TILE = 32;

    // Top sidewalk rows (buildings sit above)
    for (let tx = 0; tx < Math.ceil(GAME_W / TILE); tx++) {
      for (let ty = 0; ty < 3; ty++) {
        this.add.image(tx * TILE + TILE / 2, ty * TILE + TILE / 2, "tile_sidewalk").setDepth(-3);
      }
      // Grass strip behind buildings
      this.add.image(tx * TILE + TILE / 2, TILE / 2, "tile_grass").setDepth(-3);
    }

    // Road
    for (let tx = 0; tx < Math.ceil(GAME_W / TILE); tx++) {
      for (let ty = 5; ty < 13; ty++) {
        this.add.image(tx * TILE + TILE / 2, ty * TILE + TILE / 2, "tile_asphalt").setDepth(-3);
      }
    }

    // Bottom sidewalk
    for (let tx = 0; tx < Math.ceil(GAME_W / TILE); tx++) {
      for (let ty = 13; ty < Math.ceil(GAME_H / TILE); ty++) {
        this.add.image(tx * TILE + TILE / 2, ty * TILE + TILE / 2, "tile_sidewalk").setDepth(-3);
      }
    }

    // Road center dashes
    const g = this.add.graphics().setDepth(-2);
    g.fillStyle(0xffd700, 0.8);
    for (let x = 0; x < GAME_W; x += 80) {
      g.fillRect(x, GAME_H / 2 - 3, 50, 6);
    }

    // Buildings (pixel art style)
    const buildingData = [
      { x: 30, y: 4, w: 120, h: 88, color: 0x37474f, sign: "DISPENSARY", signColor: "#00c853" },
      { x: 200, y: 4, w: 150, h: 88, color: 0x455a64, sign: "SMOKE SHOP", signColor: "#ff6d00" },
      { x: 410, y: 4, w: 130, h: 88, color: 0x546e7a, sign: null, signColor: "" },
      { x: 600, y: 4, w: 160, h: 88, color: 0x37474f, sign: "HEAD SHOP", signColor: "#aa00ff" },
      { x: 820, y: 4, w: 140, h: 88, color: 0x455a64, sign: null, signColor: "" },
      { x: 1020, y: 4, w: 120, h: 88, color: 0x546e7a, sign: "STASH HOUSE", signColor: "#4caf50" },
      { x: 1170, y: 4, w: 110, h: 88, color: 0x37474f, sign: null, signColor: "" },
    ];

    buildingData.forEach(b => {
      g.fillStyle(b.color);
      g.fillRect(b.x, b.y, b.w, b.h);
      // Roof edge
      g.fillStyle(0x000000, 0.3);
      g.fillRect(b.x, b.y + b.h - 4, b.w, 4);
      // Brick pattern
      g.fillStyle(0x000000, 0.08);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < Math.floor(b.w / 20); col++) {
          g.fillRect(b.x + col * 20 + (row % 2 === 0 ? 0 : 10), b.y + row * 28, 18, 26);
        }
      }
      // Windows
      g.fillStyle(0xfff9c4, 0.85);
      for (let col = 0; col < Math.floor((b.w - 20) / 36); col++) {
        for (let row = 0; row < 2; row++) {
          g.fillRect(b.x + 10 + col * 36, b.y + 12 + row * 36, 22, 22);
          g.fillStyle(0x000000, 0.15);
          g.fillRect(b.x + 20 + col * 36, b.y + 12 + row * 36, 2, 22);
          g.fillStyle(0xfff9c4, 0.85);
        }
      }
      // Door
      g.fillStyle(0x4e342e);
      g.fillRect(b.x + b.w / 2 - 10, b.y + b.h - 28, 20, 28);
      g.fillStyle(0xffd700, 0.7);
      g.fillCircle(b.x + b.w / 2 + 6, b.y + b.h - 16, 3);

      if (b.sign) {
        const signBg = this.add.graphics().setDepth(-1);
        signBg.fillStyle(0x000000, 0.7);
        signBg.fillRoundedRect(b.x + 5, b.y + b.h - 14, b.w - 10, 14, 3);
        this.add.text(b.x + b.w / 2, b.y + b.h - 6, b.sign, {
          fontSize: "9px", color: b.signColor, fontStyle: "bold"
        }).setOrigin(0.5).setDepth(0);
      }
    });

    // Street lamps
    for (let x = 100; x < GAME_W; x += 220) {
      g.fillStyle(0x555555);
      g.fillRect(x, 90, 5, 75);
      g.fillRect(x, 90, 22, 5);
      g.fillStyle(0xffff99, 0.9);
      g.fillCircle(x + 22, 90, 10);
      g.fillStyle(0xffff99, 0.2);
      g.fillCircle(x + 22, 90, 20);
    }

    // Bottom lamps
    for (let x = 200; x < GAME_W; x += 220) {
      g.fillStyle(0x555555);
      g.fillRect(x, GAME_H - 90, 5, -60);
      g.fillRect(x - 22, GAME_H - 148, 22, 5);
      g.fillStyle(0xffff99, 0.9);
      g.fillCircle(x - 22, GAME_H - 148, 10);
      g.fillStyle(0xffff99, 0.2);
      g.fillCircle(x - 22, GAME_H - 148, 20);
    }
  }

  private spawnPlayer() {
    const hasDealerFit = this.state.cosmetics.includes("dealer_fit");
    this.player = this.add.container(200, GAME_H - 130);
    this.playerBody = this.add.graphics();
    const playerImg = this.add.image(0, 0, hasDealerFit ? "player_dealer" : "player").setScale(1.2);
    this.player.add(this.playerBody);
    this.player.add(playerImg);
    this.player.setDepth(5);
  }

  private spawnNPCs() {
    const unlocked = this.state.unlockedCustomers;
    const zones = [
      { x: 300, y: GAME_H - 120, r: 80 },
      { x: 500, y: 150, r: 80 },
      { x: 700, y: GAME_H - 120, r: 80 },
      { x: 900, y: 150, r: 80 },
      { x: 1100, y: GAME_H - 120, r: 80 },
    ];

    const npcTextures = ["npc_0", "npc_1", "npc_2", "npc_3", "npc_4", "npc_5", "npc_6", "npc_7"];
    let zoneIdx = 0;
    CUSTOMERS.filter(c => unlocked.includes(c.id)).forEach((customer, ci) => {
      const zone = zones[zoneIdx % zones.length];
      zoneIdx++;

      const container = this.add.container(zone.x, zone.y);
      const npcImg = this.add.image(0, 0, npcTextures[ci % npcTextures.length]).setScale(1.2);
      container.add(npcImg);
      container.setDepth(4);

      const nameLabel = this.add.text(zone.x, zone.y - 25, `${customer.avatar} ${customer.name}`, {
        fontSize: "11px", color: "#ffffff", backgroundColor: "#000000", padding: { x: 4, y: 2 }
      }).setOrigin(0.5).setDepth(6);

      this.npcs.push({
        sprite: container,
        customerId: customer.id,
        targetX: zone.x,
        targetY: zone.y,
        speed: 40 + Math.random() * 30,
        zone,
        interactRange: 80,
        nameLabel,
        bubble: null,
      });
    });
  }

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  private spawnPolice() {
    if (this.policeSprite) return;
    this.policeSprite = this.add.container(-60, GAME_H / 2 - 20);
    const carImg = this.add.image(0, 0, "police_car").setScale(1.1);
    this.policeSprite.add(carImg);
    this.policeSprite.setDepth(5);
    this.policeDirX = 1;

    // Flashing siren tween
    this.tweens.add({
      targets: carImg,
      tint: { from: 0xff1744, to: 0x2196f3 },
      duration: 300,
      yoyo: true,
      repeat: -1,
    });
  }

  update(_t: number, dt: number) {
    const speed = 180;
    const dtSec = dt / 1000;
    let dx = 0, dy = 0;

    if (this.cursors.left?.isDown || this.wasd.A.isDown) dx = -speed;
    if (this.cursors.right?.isDown || this.wasd.D.isDown) dx = speed;
    if (this.cursors.up?.isDown || this.wasd.W.isDown) dy = -speed;
    if (this.cursors.down?.isDown || this.wasd.S.isDown) dy = speed;

    this.player.x = Phaser.Math.Clamp(this.player.x + dx * dtSec, 20, GAME_W - 20);
    this.player.y = Phaser.Math.Clamp(this.player.y + dy * dtSec, 110, GAME_H - 90);

    // NPC wander
    this.npcs.forEach(npc => {
      const dx2 = npc.targetX - npc.sprite.x;
      const dy2 = npc.targetY - npc.sprite.y;
      const dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (dist < 5) {
        // Pick new target within zone
        npc.targetX = npc.zone.x + (Math.random() - 0.5) * npc.zone.r * 2;
        npc.targetY = npc.zone.y + (Math.random() - 0.5) * 40;
        npc.targetY = Phaser.Math.Clamp(npc.targetY, 120, GAME_H - 100);
      } else {
        npc.sprite.x += (dx2 / dist) * npc.speed * dtSec;
        npc.sprite.y += (dy2 / dist) * npc.speed * dtSec;
      }
      npc.nameLabel.setPosition(npc.sprite.x, npc.sprite.y - 25);

      // Check proximity to player
      const pdx = this.player.x - npc.sprite.x;
      const pdy = this.player.y - npc.sprite.y;
      const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pdist < npc.interactRange) {
        this.nearbyCustomerId = npc.customerId;
      }
    });

    // Find closest NPC
    let closestDist = 999;
    let closestId: string | null = null;
    this.npcs.forEach(npc => {
      const pdx = this.player.x - npc.sprite.x;
      const pdy = this.player.y - npc.sprite.y;
      const d = Math.sqrt(pdx * pdx + pdy * pdy);
      if (d < npc.interactRange && d < closestDist) {
        closestDist = d;
        closestId = npc.customerId;
      }
    });
    this.nearbyCustomerId = closestId;

    if (this.nearbyCustomerId) {
      const c = CUSTOMERS.find(cu => cu.id === this.nearbyCustomerId);
      if (c) {
        this.interactPrompt!.setText(`Press E or click to deal with ${c.avatar} ${c.name}`);
        EventBus.emit("nearby_customer", this.nearbyCustomerId);
      }
    } else {
      this.interactPrompt!.setText("WASD to move • Find customers to sell");
      EventBus.emit("nearby_customer", null);
    }

    // E key to interact
    if (Phaser.Input.Keyboard.JustDown(this.input.keyboard!.addKey("E")) && this.nearbyCustomerId) {
      EventBus.emit("open_sell_panel", this.nearbyCustomerId);
    }

    // Police car
    if (this.policeSprite) {
      this.policeSprite.x += this.policeDirX * 120 * dtSec;
      if (this.policeSprite.x > GAME_W + 80) this.policeDirX = -1;
      if (this.policeSprite.x < -80) this.policeDirX = 1;

      // Catch player at high heat
      if (this.state.heat >= 80) {
        const pdx = this.player.x - this.policeSprite.x;
        const pdy = this.player.y - this.policeSprite.y;
        if (Math.sqrt(pdx * pdx + pdy * pdy) < 60) {
          const fine = Math.min(this.state.money, Math.round(this.state.money * 0.2));
          this.state.money -= fine;
          this.state.heat = Math.max(0, this.state.heat - 30);
          EventBus.emit(EV.NOTIFICATION, { msg: `🚔 Busted! Paid $${fine} fine. Heat reduced.`, type: "error" });
          EventBus.emit(EV.STATE_UPDATE, this.state);
          saveState(this.state);
        }
      }
    }
  }

  handleSell(data: { strainId: string; grams: number; quality: number; packaging: string; customerId: string }) {
    // Delegate to FarmScene-style logic but in street context
    EventBus.emit("street_sell", data);
  }

  shutdown() {
    this.npcs.forEach(n => { n.nameLabel.destroy(); n.bubble?.destroy(); });
    EventBus.off("action:go_farm");
    EventBus.off("action:sell", this.handleSell, this);
  }
}
