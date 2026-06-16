import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() { super("BootScene"); }

  create() {
    // Generate all textures procedurally
    this.makePlantTextures();
    this.makePotTexture();
    this.makePlayerTexture();
    this.makeNpcTexture();
    this.makeGroundTexture();
    this.makeBuildingTextures();
    this.scene.start("FarmScene");
  }

  private makePlantTextures() {
    const stages = ["seedling", "vegetative", "flowering", "ready"];
    const colors = [0x81c784, 0x4caf50, 0x2e7d32, 0x00e676];

    stages.forEach((stage, si) => {
      const g = this.add.graphics();
      g.clear();
      const color = colors[si];
      const size = 12 + si * 10;

      // Stem
      g.fillStyle(0x33691e);
      g.fillRect(28, 64 - size, 4, size);

      if (si >= 1) {
        // Leaves
        g.fillStyle(color);
        g.fillEllipse(20, 64 - size + 8, 20, 10);
        g.fillEllipse(40, 64 - size + 8, 20, 10);
      }
      if (si >= 2) {
        // Buds
        g.fillStyle(0x558b2f);
        g.fillCircle(30, 64 - size - 4, 8);
        g.fillStyle(color);
        g.fillCircle(30, 64 - size - 4, 5);
        // Side branches
        g.fillStyle(0x33691e);
        g.fillRect(18, 64 - size + 20, 10, 3);
        g.fillRect(32, 64 - size + 20, 10, 3);
      }
      if (si === 3) {
        // Glow / crystals
        g.fillStyle(0xffffff, 0.4);
        for (let i = 0; i < 6; i++) {
          g.fillCircle(22 + Math.random() * 16, 64 - size - 2 + Math.random() * 12, 2);
        }
        // Bright top bud
        g.fillStyle(0x00e676);
        g.fillCircle(30, 64 - size - 8, 7);
      }

      g.generateTexture(`plant_${stage}`, 60, 70);
      g.destroy();
    });

    // Sprite for empty/seed state
    const g = this.add.graphics();
    g.fillStyle(0x5d4037, 0.8);
    g.fillEllipse(30, 50, 20, 10);
    g.generateTexture("plant_planted", 60, 70);
    g.destroy();
  }

  private makePotTexture() {
    const g = this.add.graphics();
    // Pot body
    g.fillStyle(0x5d4037);
    g.fillPoints([{ x: 10, y: 70 }, { x: 90, y: 70 }, { x: 80, y: 30 }, { x: 20, y: 30 }], true);
    // Rim
    g.fillStyle(0x4e342e);
    g.fillRect(5, 28, 90, 8);
    // Soil
    g.fillStyle(0x3e2723);
    g.fillEllipse(50, 34, 76, 20);
    g.generateTexture("pot", 100, 80);
    g.destroy();
  }

  private makePlayerTexture() {
    const g = this.add.graphics();
    // Body
    g.fillStyle(0x1565c0);
    g.fillRect(8, 16, 16, 20);
    // Head
    g.fillStyle(0xffcc80);
    g.fillCircle(16, 10, 10);
    // Hat
    g.fillStyle(0x1a1a1a);
    g.fillRect(6, 2, 20, 4);
    g.fillRect(9, -2, 14, 6);
    g.generateTexture("player", 32, 40);
    g.destroy();
  }

  private makeNpcTexture() {
    const g = this.add.graphics();
    g.fillStyle(0xe53935);
    g.fillRect(8, 16, 16, 20);
    g.fillStyle(0xffcc80);
    g.fillCircle(16, 10, 10);
    g.generateTexture("npc", 32, 40);
    g.destroy();
  }

  private makeGroundTexture() {
    const g = this.add.graphics();
    g.fillStyle(0x424242);
    g.fillRect(0, 0, 64, 64);
    // Road lines
    g.fillStyle(0x616161);
    g.fillRect(0, 30, 64, 4);
    g.generateTexture("ground", 64, 64);
    g.destroy();
  }

  private makeBuildingTextures() {
    const colors = [0x37474f, 0x455a64, 0x546e7a];
    colors.forEach((c, i) => {
      const g = this.add.graphics();
      g.fillStyle(c);
      g.fillRect(0, 0, 80, 120);
      // Windows
      g.fillStyle(0xfff9c4, 0.8);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          g.fillRect(10 + col * 35, 15 + row * 35, 20, 20);
        }
      }
      g.generateTexture(`building_${i}`, 80, 120);
      g.destroy();
    });
  }
}
