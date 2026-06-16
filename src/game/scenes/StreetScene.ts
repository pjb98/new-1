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
    EventBus.on("action:go_farm", () => {
      saveState(this.state);
      this.scene.start("FarmScene");
    });
    EventBus.on("action:sell", this.handleSell, this);
  }

  private drawStreet() {
    const g = this.add.graphics();

    // Sky / background
    g.fillStyle(0x1a1a2e);
    g.fillRect(0, 0, GAME_W, 100);

    // Sidewalks
    g.fillStyle(0x616161);
    g.fillRect(0, 100, GAME_W, 80);
    g.fillRect(0, GAME_H - 80, GAME_W, 80);

    // Road
    g.fillStyle(0x424242);
    g.fillRect(0, 180, GAME_W, GAME_H - 260);

    // Road markings
    g.fillStyle(0xffc107, 0.6);
    for (let x = 0; x < GAME_W; x += 80) {
      g.fillRect(x, GAME_H / 2 - 3, 50, 6);
    }

    // Buildings
    const buildingData = [
      { x: 50, y: 0, w: 100, h: 100, color: 0x37474f },
      { x: 200, y: 10, w: 140, h: 90, color: 0x455a64 },
      { x: 400, y: 0, w: 120, h: 100, color: 0x546e7a },
      { x: 580, y: 5, w: 160, h: 95, color: 0x37474f },
      { x: 800, y: 0, w: 130, h: 100, color: 0x455a64 },
      { x: 990, y: 10, w: 110, h: 90, color: 0x546e7a },
      { x: 1160, y: 0, w: 120, h: 100, color: 0x37474f },
    ];

    buildingData.forEach(b => {
      g.fillStyle(b.color);
      g.fillRect(b.x, b.y, b.w, b.h);
      // Windows
      g.fillStyle(0xfff9c4, 0.7);
      for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 2; row++) {
          g.fillRect(b.x + 10 + col * 30, b.y + 10 + row * 35, 18, 18);
        }
      }
    });

    // Street lamps
    for (let x = 100; x < GAME_W; x += 200) {
      g.fillStyle(0x555555);
      g.fillRect(x, 100, 4, 80);
      g.fillStyle(0xffff88, 0.8);
      g.fillCircle(x + 2, 100, 12);
    }

    // Shop signs
    const signs = [
      { x: 220, text: "DISPENSARY", color: 0x00c853 },
      { x: 600, text: "SMOKE SHOP", color: 0xff6d00 },
      { x: 1000, text: "HEAD SHOP", color: 0xaa00ff },
    ];
    signs.forEach(s => {
      g.fillStyle(s.color);
      g.fillRect(s.x, 60, 100, 25);
      this.add.text(s.x + 50, 72, s.text, { fontSize: "10px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
    });
  }

  private spawnPlayer() {
    const hasDealerFit = this.state.cosmetics.includes("dealer_fit");
    this.player = this.add.container(200, GAME_H - 130);
    this.playerBody = this.add.graphics();

    // Body
    this.playerBody.fillStyle(hasDealerFit ? 0x000000 : 0x1565c0);
    this.playerBody.fillRect(-8, 0, 16, 20);
    // Head
    this.playerBody.fillStyle(0xffcc80);
    this.playerBody.fillCircle(0, -8, 10);
    // Hat
    if (hasDealerFit) {
      this.playerBody.fillStyle(0x111111);
      this.playerBody.fillRect(-10, -20, 20, 4);
      this.playerBody.fillRect(-7, -28, 14, 10);
    }

    this.player.add(this.playerBody);
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

    let zoneIdx = 0;
    CUSTOMERS.filter(c => unlocked.includes(c.id)).forEach(customer => {
      const zone = zones[zoneIdx % zones.length];
      zoneIdx++;

      const container = this.add.container(zone.x, zone.y);
      const body = this.add.graphics();
      body.fillStyle(0xe53935);
      body.fillRect(-8, 0, 16, 20);
      body.fillStyle(0xffcc80);
      body.fillCircle(0, -8, 10);
      container.add(body);
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
    const g = this.add.graphics();
    // Car body
    g.fillStyle(0x1565c0);
    g.fillRect(0, 5, 60, 30);
    g.fillRect(10, 0, 40, 15);
    // Lights
    g.fillStyle(0xff1744);
    g.fillRect(12, -3, 12, 6);
    g.fillStyle(0x2196f3);
    g.fillRect(30, -3, 12, 6);
    g.fillStyle(0xffffff, 0.7);
    g.fillRect(55, 12, 8, 8);
    this.policeSprite.add(g);
    this.policeSprite.setDepth(5);
    this.add.text(0, -25, "⚠️ POLICE", { fontSize: "12px", color: "#ff1744", fontStyle: "bold" });
    this.policeDirX = 1;
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
