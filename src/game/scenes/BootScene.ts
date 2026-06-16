import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() { super("BootScene"); }

  create() {
    this.makeTiles();
    this.makePlantTextures();
    this.makePlayerTexture();
    this.makeNpcTextures();
    this.makeUITextures();
    this.scene.start("FarmScene");
  }

  /** 16×16 pixel-art tiles drawn with Phaser Graphics */
  private makeTiles() {
    const S = 32; // tile size

    // --- Wood plank floor (grow room) ---
    const plank = this.add.graphics();
    plank.fillStyle(0x8b5e3c);
    plank.fillRect(0, 0, S, S);
    plank.fillStyle(0x7a5230, 0.6);
    plank.fillRect(0, 0, S, 2);
    plank.fillRect(0, 16, S, 2);
    plank.fillStyle(0x9c6b45, 0.4);
    plank.fillRect(2, 4, 28, 8);
    plank.fillRect(2, 20, 28, 8);
    plank.generateTexture("tile_floor", S, S);
    plank.destroy();

    // --- Stone wall ---
    const wall = this.add.graphics();
    wall.fillStyle(0x4a3f6b);
    wall.fillRect(0, 0, S, S);
    wall.fillStyle(0x3d3358, 0.8);
    // mortar lines
    wall.fillRect(0, 10, S, 2);
    wall.fillRect(0, 22, S, 2);
    wall.fillRect(16, 0, 2, 10);
    wall.fillRect(8, 12, 2, 10);
    wall.fillStyle(0x5a4d80, 0.5);
    wall.fillRect(2, 2, 12, 6);
    wall.fillRect(18, 2, 12, 6);
    wall.generateTexture("tile_wall", S, S);
    wall.destroy();

    // --- Dirt/soil ---
    const dirt = this.add.graphics();
    dirt.fillStyle(0x4a2e0a);
    dirt.fillRect(0, 0, S, S);
    dirt.fillStyle(0x5a3812, 0.6);
    for (let i = 0; i < 6; i++) {
      dirt.fillCircle(Phaser.Math.Between(4, 28), Phaser.Math.Between(4, 28), 3);
    }
    dirt.fillStyle(0x3a2008, 0.4);
    dirt.fillRect(0, 0, 2, S);
    dirt.fillRect(0, 0, S, 2);
    dirt.generateTexture("tile_dirt", S, S);
    dirt.destroy();

    // --- Street asphalt ---
    const asphalt = this.add.graphics();
    asphalt.fillStyle(0x2a2a2a);
    asphalt.fillRect(0, 0, S, S);
    asphalt.fillStyle(0x222222, 0.5);
    asphalt.fillRect(0, 0, S, 1);
    asphalt.fillRect(0, 0, 1, S);
    asphalt.generateTexture("tile_asphalt", S, S);
    asphalt.destroy();

    // --- Sidewalk ---
    const sidewalk = this.add.graphics();
    sidewalk.fillStyle(0x888888);
    sidewalk.fillRect(0, 0, S, S);
    sidewalk.fillStyle(0x777777, 0.5);
    sidewalk.fillRect(0, 0, S, 1);
    sidewalk.fillRect(0, 0, 1, S);
    sidewalk.fillStyle(0x999999, 0.3);
    sidewalk.fillRect(2, 2, 28, 28);
    sidewalk.generateTexture("tile_sidewalk", S, S);
    sidewalk.destroy();

    // --- Grass ---
    const grass = this.add.graphics();
    grass.fillStyle(0x2d6a2d);
    grass.fillRect(0, 0, S, S);
    grass.fillStyle(0x3a7a3a, 0.6);
    for (let i = 0; i < 8; i++) {
      grass.fillRect(Phaser.Math.Between(2, 28), Phaser.Math.Between(2, 28), 2, 4);
    }
    grass.fillStyle(0x256025, 0.3);
    grass.fillRect(0, 0, S, 2);
    grass.generateTexture("tile_grass", S, S);
    grass.destroy();

    // --- Road dashes ---
    const dash = this.add.graphics();
    dash.fillStyle(0xffcc00);
    dash.fillRect(12, 0, 8, S);
    dash.generateTexture("tile_roaddash", S, S);
    dash.destroy();

    // --- Table surface ---
    const table = this.add.graphics();
    table.fillStyle(0x6d4c41);
    table.fillRect(0, 0, S, S);
    table.fillStyle(0x8d6e63, 0.5);
    table.fillRect(2, 2, 28, 28);
    table.fillStyle(0x5d4037, 0.6);
    table.fillRect(0, 0, S, 3);
    table.fillRect(0, S - 3, S, 3);
    table.generateTexture("tile_table", S, S);
    table.destroy();
  }

  private makePlantTextures() {
    const stages = ["planted", "seedling", "vegetative", "flowering", "ready"] as const;

    stages.forEach((stage) => {
      const g = this.add.graphics();

      if (stage === "planted") {
        // Small seed mound
        g.fillStyle(0x5a3812);
        g.fillEllipse(32, 52, 30, 14);
        g.fillStyle(0x3a8c3a);
        g.fillRect(30, 40, 4, 14);
        g.fillStyle(0x4caf50);
        g.fillEllipse(32, 38, 10, 8);
      } else if (stage === "seedling") {
        g.fillStyle(0x5a3812);
        g.fillEllipse(32, 54, 30, 12);
        // Stem
        g.fillStyle(0x33691e);
        g.fillRect(31, 28, 3, 26);
        // Two tiny leaves
        g.fillStyle(0x66bb6a);
        g.fillEllipse(24, 36, 14, 8);
        g.fillEllipse(40, 36, 14, 8);
        g.fillStyle(0x4caf50);
        g.fillEllipse(32, 26, 10, 10);
      } else if (stage === "vegetative") {
        g.fillStyle(0x5a3812);
        g.fillEllipse(32, 56, 36, 12);
        // Stem
        g.fillStyle(0x33691e);
        g.fillRect(31, 16, 3, 40);
        // Bigger leaves
        g.fillStyle(0x4caf50);
        g.fillEllipse(18, 32, 24, 12);
        g.fillEllipse(46, 32, 24, 12);
        g.fillStyle(0x66bb6a);
        g.fillEllipse(22, 22, 18, 10);
        g.fillEllipse(42, 22, 18, 10);
        // Top bud
        g.fillStyle(0x388e3c);
        g.fillCircle(32, 14, 9);
      } else if (stage === "flowering") {
        g.fillStyle(0x5a3812);
        g.fillEllipse(32, 58, 38, 12);
        g.fillStyle(0x2e7d32);
        g.fillRect(30, 8, 4, 50);
        // Large fan leaves
        g.fillStyle(0x388e3c);
        g.fillEllipse(14, 30, 28, 13);
        g.fillEllipse(50, 30, 28, 13);
        g.fillEllipse(16, 18, 20, 10);
        g.fillEllipse(48, 18, 20, 10);
        // Buds
        g.fillStyle(0x1b5e20);
        g.fillCircle(32, 8, 10);
        g.fillCircle(24, 16, 7);
        g.fillCircle(40, 16, 7);
        // Trichomes
        g.fillStyle(0xb2dfdb, 0.6);
        g.fillCircle(32, 8, 5);
        g.fillCircle(24, 16, 3);
        g.fillCircle(40, 16, 3);
      } else {
        // ready — full, glowing
        g.fillStyle(0x5a3812);
        g.fillEllipse(32, 58, 40, 14);
        g.fillStyle(0x1b5e20);
        g.fillRect(30, 4, 4, 54);
        g.fillStyle(0x2e7d32);
        g.fillEllipse(12, 28, 30, 14);
        g.fillEllipse(52, 28, 30, 14);
        g.fillEllipse(14, 16, 22, 11);
        g.fillEllipse(50, 16, 22, 11);
        // Dense buds
        g.fillStyle(0x00c853);
        g.fillCircle(32, 6, 12);
        g.fillCircle(22, 18, 9);
        g.fillCircle(42, 18, 9);
        // Crystal shimmer
        g.fillStyle(0xffffff, 0.7);
        g.fillCircle(32, 6, 5);
        g.fillCircle(27, 4, 3);
        g.fillCircle(37, 4, 3);
        g.fillStyle(0xe8f5e9, 0.5);
        g.fillCircle(22, 18, 4);
        g.fillCircle(42, 18, 4);
      }

      g.generateTexture(`plant_${stage}`, 64, 64);
      g.destroy();
    });
  }

  private makePlayerTexture() {
    // Top-down 32×48 pixel art character (Solana Valley style)
    const g = this.add.graphics();

    // Shadow
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(16, 42, 22, 8);

    // Shoes
    g.fillStyle(0x1a1a1a);
    g.fillRect(10, 36, 7, 6);
    g.fillRect(19, 36, 7, 6);

    // Pants
    g.fillStyle(0x37474f);
    g.fillRect(9, 24, 7, 14);
    g.fillRect(18, 24, 7, 14);

    // Body/shirt
    g.fillStyle(0x1565c0);
    g.fillRect(8, 14, 20, 12);

    // Arms
    g.fillStyle(0xffcc80);
    g.fillRect(4, 14, 5, 10);
    g.fillRect(23, 14, 5, 10);

    // Neck
    g.fillStyle(0xffcc80);
    g.fillRect(14, 11, 6, 4);

    // Head
    g.fillStyle(0xffcc80);
    g.fillRoundedRect(9, 2, 16, 14, 4);

    // Hair
    g.fillStyle(0x4e342e);
    g.fillRect(9, 2, 16, 5);
    g.fillRect(9, 2, 3, 10);
    g.fillRect(22, 2, 3, 10);

    // Eyes
    g.fillStyle(0x212121);
    g.fillRect(12, 9, 3, 3);
    g.fillRect(19, 9, 3, 3);

    // Eye whites
    g.fillStyle(0xffffff);
    g.fillRect(13, 10, 1, 1);
    g.fillRect(20, 10, 1, 1);

    g.generateTexture("player", 32, 48);
    g.destroy();

    // Dealer fit variant
    const d = this.add.graphics();
    d.fillStyle(0x000000, 0.25);
    d.fillEllipse(16, 42, 22, 8);
    d.fillStyle(0x111111);
    d.fillRect(10, 36, 7, 6);
    d.fillRect(19, 36, 7, 6);
    d.fillRect(9, 24, 7, 14);
    d.fillRect(18, 24, 7, 14);
    d.fillRect(8, 14, 20, 12);
    d.fillStyle(0xffcc80);
    d.fillRect(4, 14, 5, 10);
    d.fillRect(23, 14, 5, 10);
    d.fillRect(14, 11, 6, 4);
    d.fillRoundedRect(9, 2, 16, 14, 4);
    // White chain
    d.fillStyle(0xffd700);
    d.fillRect(12, 14, 10, 2);
    // Dark cap
    d.fillStyle(0x111111);
    d.fillRect(8, 2, 18, 5);
    d.fillRect(6, 5, 22, 3);
    d.fillStyle(0x212121);
    d.fillRect(12, 9, 3, 3);
    d.fillRect(19, 9, 3, 3);
    d.generateTexture("player_dealer", 32, 48);
    d.destroy();
  }

  private makeNpcTextures() {
    const configs = [
      { key: "npc_0", shirt: 0xe53935, hair: 0x212121, skin: 0xffcc80 },
      { key: "npc_1", shirt: 0x7b1fa2, hair: 0x4e342e, skin: 0xffa07a },
      { key: "npc_2", shirt: 0x0288d1, hair: 0x1a1a1a, skin: 0xc68642 },
      { key: "npc_3", shirt: 0x388e3c, hair: 0x5d4037, skin: 0xffcc80 },
      { key: "npc_4", shirt: 0xf57c00, hair: 0x212121, skin: 0xffe0b2 },
      { key: "npc_5", shirt: 0xffd700, hair: 0x4e342e, skin: 0x8d5524 },
      { key: "npc_6", shirt: 0x00838f, hair: 0x1a1a1a, skin: 0xffe0b2 },
      { key: "npc_7", shirt: 0xad1457, hair: 0x212121, skin: 0xffcc80 },
    ];

    configs.forEach(({ key, shirt, hair, skin }) => {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.2);
      g.fillEllipse(16, 42, 20, 7);
      g.fillStyle(0x37474f);
      g.fillRect(10, 36, 6, 6);
      g.fillRect(18, 36, 6, 6);
      g.fillRect(9, 24, 6, 13);
      g.fillRect(17, 24, 6, 13);
      g.fillStyle(shirt);
      g.fillRect(8, 14, 18, 12);
      g.fillStyle(skin);
      g.fillRect(4, 14, 5, 9);
      g.fillRect(23, 14, 5, 9);
      g.fillRect(14, 11, 6, 4);
      g.fillRoundedRect(9, 2, 15, 13, 4);
      g.fillStyle(hair);
      g.fillRect(9, 2, 15, 4);
      g.fillStyle(0x212121);
      g.fillRect(12, 8, 2, 2);
      g.fillRect(18, 8, 2, 2);
      g.generateTexture(key, 32, 48);
      g.destroy();
    });

    // Police officer
    const p = this.add.graphics();
    p.fillStyle(0x1565c0);
    p.fillRect(8, 14, 18, 12);
    p.fillStyle(0x1565c0);
    p.fillRect(9, 24, 6, 13);
    p.fillRect(17, 24, 6, 13);
    p.fillStyle(0x0d47a1);
    p.fillRect(10, 36, 6, 6);
    p.fillRect(18, 36, 6, 6);
    p.fillStyle(0xffcc80);
    p.fillRect(4, 14, 5, 9);
    p.fillRect(23, 14, 5, 9);
    p.fillRoundedRect(9, 2, 15, 13, 4);
    // Police cap
    p.fillStyle(0x0d47a1);
    p.fillRect(7, 1, 19, 6);
    p.fillRect(5, 6, 23, 3);
    p.fillStyle(0xffd700);
    p.fillRect(10, 3, 12, 2);
    p.fillStyle(0x212121);
    p.fillRect(12, 8, 2, 2);
    p.fillRect(18, 8, 2, 2);
    p.generateTexture("npc_police", 32, 48);
    p.destroy();
  }

  private makeUITextures() {
    // Pot texture (top-down view)
    const pot = this.add.graphics();
    pot.fillStyle(0x5d4037);
    pot.fillEllipse(32, 32, 60, 60);
    pot.fillStyle(0x4e342e);
    pot.fillEllipse(32, 32, 52, 52);
    pot.fillStyle(0x3e2723);
    pot.fillEllipse(32, 32, 44, 44);
    pot.fillStyle(0x5d4037, 0.3);
    pot.fillRect(26, 10, 4, 44);
    pot.generateTexture("pot_top", 64, 64);
    pot.destroy();

    // Pot texture (golden)
    const gpot = this.add.graphics();
    gpot.fillStyle(0xffd700);
    gpot.fillEllipse(32, 32, 60, 60);
    gpot.fillStyle(0xffb300);
    gpot.fillEllipse(32, 32, 52, 52);
    gpot.fillStyle(0x3e2723);
    gpot.fillEllipse(32, 32, 44, 44);
    gpot.generateTexture("pot_top_gold", 64, 64);
    gpot.destroy();

    // Police car (top-down)
    const car = this.add.graphics();
    car.fillStyle(0x1565c0);
    car.fillRoundedRect(0, 0, 40, 72, 8);
    car.fillStyle(0xbbdefb);
    car.fillRect(6, 8, 28, 20);
    car.fillRect(6, 44, 28, 20);
    car.fillStyle(0x0d47a1);
    car.fillRect(0, 28, 40, 16);
    car.fillStyle(0xff1744);
    car.fillRect(8, 2, 10, 6);
    car.fillStyle(0x2196f3);
    car.fillRect(22, 2, 10, 6);
    car.fillStyle(0xffffff, 0.8);
    car.fillRect(4, 66, 12, 6);
    car.fillRect(24, 66, 12, 6);
    car.generateTexture("police_car", 40, 72);
    car.destroy();
  }
}
