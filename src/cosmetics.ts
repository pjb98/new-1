/**
 * Visual-only player skins — a full cosmetic roster (no stat effect), the skins
 * counterpart to the pet collection. Each skin recolors the voxel hero's body +
 * head; higher rarities also carry a `glow` (emissive) so legendary/mythic skins
 * shine in the field. Bought once with Essence, then equipped freely.
 */
import type { HatStyle, BackStyle } from "./voxelChar";

export type SkinRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export interface Skin {
  id: string;
  name: string;
  body: number;
  head: number;
  rarity: SkinRarity;
  cost: number; // Essence; 0 = owned from the start
  /** Emissive glow colour for the live model + preview (high rarities only). */
  glow?: number;
  // ---- cosmetic kit: real headwear + back accessories (not just recolours) ----
  hat?: HatStyle;
  hatColor?: number;
  back?: BackStyle;
  backColor?: number;
  // ---- outfit detail (multi-zone clothing); pants/shoes/belt auto-derive if unset ----
  pants?: number;
  shoes?: number;
  belt?: number;
  gloves?: number;
  emblem?: number; // glowing chest emblem
  /** Themed texture pattern painted on the torso (stars/scales/bones/…). */
  pattern?:
    | "stars" | "stripes" | "scales" | "bones" | "bandage" | "circuit" | "runes" | "plate"
    | "weave" | "camo" | "feather" | "dots" | "gem" | "lightning" | "floral";
  /** Outfit template — gives a designed garment (hoodie/jacket/dress/…) not a flat shirt. */
  outfit?: "tee" | "hoodie" | "jacket" | "dress" | "robe" | "armor" | "tank" | "suit" | "tunic";
  /** Secondary garment / accent colour (hood trim, zipper inner, sash, tabard…). */
  trim?: number;
  /** Bare-leg shorts vs full pants. */
  legwear?: "pants" | "shorts";
  // ---- optional fine-detail (all texture-only; safe to omit) ----
  /** Iris colour for the painted face (defaults to glow/blue). */
  eyeColor?: number;
  /** Cheek / blush tint on the painted face (set 0 to suppress). */
  cheek?: number;
  /** Hair / crown colour override on the painted head (defaults derived from head). */
  hairColor?: number;
  /** Accent colour for cuffs, boot trim and seam highlights. */
  accent?: number;
  /** Painted face expression flair. */
  face?: "default" | "stern" | "wink" | "fanged" | "visor" | "skull" | "glow";
}

export const SKINS: Skin[] = [
  // ===== COMMON — survivors & starters (grounded, civilian/military) =====
  { id: "classic", name: "Classic", body: 0x4a78d6, head: 0xfff4d6, rarity: "common", cost: 0, outfit: "tee", legwear: "shorts", pattern: "stripes", trim: 0xf2f5ff, accent: 0xf2f5ff, pants: 0x2a3f6e, shoes: 0xe8eef7, hairColor: 0x6a4a2a, eyeColor: 0x3a6abf },
  { id: "recruit", name: "Recruit", body: 0x5d6757, head: 0xe8d6a8, rarity: "common", cost: 0, hat: "cap", hatColor: 0x434c3c, outfit: "jacket", pattern: "camo", trim: 0x6f7a64, accent: 0x8a9678, pants: 0x3c4438, shoes: 0x2a2018, gloves: 0x3c4438, belt: 0x2a2018, hairColor: 0x4a3a22, face: "stern" },
  { id: "ranger", name: "Ranger", body: 0x3f7d4a, head: 0xe8d6a8, rarity: "common", cost: 40, hat: "cap", hatColor: 0x2f5d3a, outfit: "tunic", trim: 0x8a5a2a, accent: 0xc8a05a, pants: 0x4a3a24, shoes: 0x3a2a18, belt: 0x6a4a2a, gloves: 0x6a4a2a, emblem: 0x9ad05a, hairColor: 0x5a3a1a, eyeColor: 0x4a8a4a },
  { id: "scout", name: "Scout", body: 0xc8a45a, head: 0xf0e0c0, rarity: "common", cost: 40, hat: "cap", hatColor: 0x8a5e2e, outfit: "tee", legwear: "shorts", pattern: "stripes", trim: 0xe8d8a8, accent: 0xf0e4bc, pants: 0x6a4a2a, shoes: 0x4a3420, hairColor: 0x8a5a2a, cheek: 0xff9a6a },
  { id: "medic", name: "Medic", body: 0xf2f5f7, head: 0xffe0d0, rarity: "common", cost: 50, hat: "helmet", hatColor: 0xe24a4a, emblem: 0xe23a3a, outfit: "jacket", trim: 0xe23a3a, accent: 0xff8a8a, pants: 0xd8dde4, shoes: 0xc2c8d0, gloves: 0xe6ebf0, belt: 0xc8ccd2, hairColor: 0x7a5230 },
  { id: "diver", name: "Skyfarer", body: 0x4f9bd8, head: 0xeaf6ff, rarity: "common", cost: 50, hat: "antenna", hatColor: 0x6ad7ff, outfit: "suit", pattern: "dots", trim: 0xbfeaff, accent: 0xeaf6ff, emblem: 0x6ad7ff, pants: 0x2f6a9e, shoes: 0x24527a, gloves: 0xbfeaff, eyeColor: 0x6ad7ff },

  // ===== UNCOMMON — critters & characters (playful, cute) =====
  { id: "kitty", name: "Tabby", body: 0xe09a4a, head: 0xffe0b0, rarity: "uncommon", cost: 90, hat: "ears", hatColor: 0xe09a4a, outfit: "hoodie", pattern: "stripes", trim: 0xb8702a, accent: 0xfff0d8, pants: 0xb8702a, shoes: 0x6a4424, gloves: 0xfff0d8, hairColor: 0xb8702a, cheek: 0xffaa7a, face: "wink" },
  { id: "bunny", name: "Cottontail", body: 0xf6eef2, head: 0xfff4f0, rarity: "uncommon", cost: 90, hat: "ears", hatColor: 0xffffff, back: "pack", backColor: 0xffd6e6, outfit: "hoodie", pattern: "dots", trim: 0xffc2d8, accent: 0xffe2ee, pants: 0xe8dde6, shoes: 0xffc2d8, gloves: 0xffe2ee, hairColor: 0xe8dde6, cheek: 0xffaec8, eyeColor: 0xff9ec7 },
  { id: "frog", name: "Frogling", body: 0x5fae3a, head: 0x9ad05a, rarity: "uncommon", cost: 100, hat: "antenna", hatColor: 0x7ad14a, outfit: "tee", legwear: "shorts", pattern: "dots", trim: 0xc8f08a, accent: 0xeefcc8, pants: 0x3a7a2a, shoes: 0x2a5a1a, hairColor: 0x3a7a2a, cheek: 0xffb08a, eyeColor: 0xffd24a, face: "wink" },
  { id: "jester", name: "Jester", body: 0x8a3a8a, head: 0xffe0ea, rarity: "uncommon", cost: 110, hat: "bow", hatColor: 0xff9ec7, outfit: "tunic", pattern: "stripes", trim: 0xffd24a, accent: 0x7be08a, pants: 0x4a8a4a, shoes: 0xffd24a, gloves: 0xffd24a, belt: 0xffd24a, emblem: 0xffd24a, hairColor: 0x6a2a6a, cheek: 0xff8ac0 },
  { id: "miner", name: "Miner", body: 0x5a6270, head: 0xe8d6a8, rarity: "uncommon", cost: 110, hat: "helmet", hatColor: 0xffd24a, back: "pack", backColor: 0x3a4250, outfit: "jacket", pattern: "stripes", trim: 0xffd24a, accent: 0xffe88a, pants: 0x3a4250, shoes: 0x241a12, gloves: 0x6a4a2a, belt: 0x6a4a2a, emblem: 0xffd24a, hairColor: 0x4a3a22, face: "stern" },
  { id: "punk", name: "Punk", body: 0x2a2a36, head: 0xf0d2c0, rarity: "uncommon", cost: 120, hat: "mohawk", hatColor: 0xff3a7a, outfit: "jacket", pattern: "stripes", trim: 0xff3a7a, accent: 0x6ad7ff, pants: 0x1c1c26, shoes: 0x14141c, gloves: 0x14141c, belt: 0x6ad7ff, hairColor: 0xff3a7a, eyeColor: 0xff3a7a, face: "stern" },
  { id: "rosewood", name: "Rosewood", body: 0xd06a8a, head: 0xffe0ea, rarity: "uncommon", cost: 120, hat: "bow", hatColor: 0xff9ec7, back: "cape", backColor: 0xb24a6a, outfit: "dress", pattern: "floral", trim: 0xffd6e6, accent: 0xff9ec7, shoes: 0xb24a6a, hairColor: 0x8a3a52, cheek: 0xff8ac0, eyeColor: 0xc05a8a },

  // ===== RARE — classes & undead (martial / spooky) =====
  { id: "knight", name: "Knight", body: 0x9aa3b0, head: 0xc8d2dc, rarity: "rare", cost: 200, hat: "helmet", hatColor: 0xc2ccd8, back: "cape", backColor: 0xb23a3a, pattern: "plate", outfit: "armor", trim: 0xb23a3a, accent: 0xe6ebf2, pants: 0x6a7280, shoes: 0x4a525e, gloves: 0x7a8390, belt: 0x8a5a2a, emblem: 0xffd24a, face: "stern" },
  { id: "wizard", name: "Wizard", body: 0x3a4ea0, head: 0xe8d6c0, rarity: "rare", cost: 210, hat: "wizard", hatColor: 0x2e3a82, pattern: "runes", outfit: "robe", trim: 0xffd24a, accent: 0x9fb0ff, shoes: 0x2a2058, belt: 0xffd24a, emblem: 0x9fe8ff, hairColor: 0xcfd4e8, eyeColor: 0x9fe8ff },
  { id: "ninja", name: "Ninja", body: 0x1c1c24, head: 0x2a2a36, rarity: "rare", cost: 210, hat: "hood", hatColor: 0x14141c, outfit: "suit", trim: 0xb23a3a, accent: 0x6a6a7a, pants: 0x14141c, shoes: 0x0a0a10, gloves: 0x0a0a10, belt: 0xb23a3a, eyeColor: 0xff5a5a, face: "visor" },
  { id: "pirate", name: "Buccaneer", body: 0x6a3a2a, head: 0xe8c0a0, rarity: "rare", cost: 220, hat: "pirate", hatColor: 0x2a2018, back: "cape", backColor: 0x8a2a2a, outfit: "jacket", pattern: "stripes", trim: 0xd8c060, accent: 0xe8d49a, pants: 0x3a2a1a, shoes: 0x241a12, gloves: 0x4a3424, belt: 0xd8c060, hairColor: 0x2a1a10, face: "fanged" },
  { id: "skeleton", name: "Rattlebones", body: 0x20202a, head: 0xfff8ee, rarity: "rare", cost: 230, hat: "none", pattern: "bones", outfit: "tee", trim: 0xe8e4d8, accent: 0xe8e4d8, pants: 0x18181f, shoes: 0x101015, hairColor: 0xe8e4d8, eyeColor: 0x7af7c0, face: "skull" },
  { id: "mummy", name: "Mummy", body: 0xd8cba0, head: 0xe8dcc0, rarity: "rare", cost: 230, hat: "none", back: "cape", backColor: 0xc8b88a, pattern: "bandage", outfit: "robe", trim: 0xbcae82, accent: 0xefe6c8, shoes: 0xb0a072, hairColor: 0xc8b88a, eyeColor: 0xffd24a, face: "glow" },
  { id: "robot", name: "Mk-II Bot", body: 0x8a93a0, head: 0xb6c0cc, rarity: "rare", cost: 240, hat: "antenna", hatColor: 0xff5a4a, back: "pack", backColor: 0x5a6270, emblem: 0x6ad7ff, pattern: "circuit", outfit: "suit", trim: 0x6ad7ff, accent: 0xd8dde4, pants: 0x5a6270, shoes: 0x3a4250, gloves: 0x6a7280, eyeColor: 0x6ad7ff, face: "visor" },

  // ===== EPIC — heroes & elements (bold, themed) =====
  { id: "astronaut", name: "Astronaut", body: 0xf2f5f7, head: 0xbfe2f0, rarity: "epic", cost: 380, hat: "helmet", hatColor: 0xffffff, back: "jetpack", backColor: 0xcfd6dc, pattern: "plate", outfit: "suit", trim: 0xff8a3a, accent: 0xbfeaff, emblem: 0x6ad7ff, pants: 0xd8dde4, shoes: 0xb6c0cc, gloves: 0xe6ebf0, eyeColor: 0x6ad7ff, face: "visor" },
  { id: "samurai", name: "Samurai", body: 0x9a2a2a, head: 0xf0d2c0, rarity: "epic", cost: 390, hat: "helmet", hatColor: 0x2a2a36, back: "cape", backColor: 0x7a1f1f, pattern: "plate", outfit: "armor", trim: 0xffd24a, accent: 0xd84a4a, pants: 0x3a2230, shoes: 0x2a2018, gloves: 0x6a1f1f, belt: 0x2a2a36, emblem: 0xffd24a, hairColor: 0x14141c, face: "stern" },
  { id: "vampire", name: "Vampire", body: 0x2a1420, head: 0xe8dcea, rarity: "epic", cost: 400, hat: "tophat", hatColor: 0x140a14, back: "cape", backColor: 0x7a1a2a, pattern: "weave", outfit: "jacket", trim: 0xb23a4a, accent: 0x9a2a3a, pants: 0x1c0e16, shoes: 0x100810, gloves: 0x140a14, belt: 0xb23a4a, emblem: 0xb23a4a, hairColor: 0x14141c, eyeColor: 0xff3a4a, face: "fanged" },
  { id: "pumpkin", name: "Pumpkin King", body: 0x4a2e16, head: 0xff7a2a, rarity: "epic", cost: 400, hat: "crown", hatColor: 0x5a8a2a, outfit: "tunic", pattern: "weave", trim: 0xff9a3a, accent: 0xffb24a, pants: 0x3a2412, shoes: 0x241a0e, belt: 0x5a8a2a, emblem: 0xffb24a, hairColor: 0x5a8a2a, eyeColor: 0xffb24a, face: "glow" },
  { id: "cyborg", name: "Cyborg", body: 0x2a3450, head: 0x9fb6ff, rarity: "epic", cost: 410, hat: "visor", hatColor: 0x6ad7ff, back: "jetpack", backColor: 0x3a4660, emblem: 0x6ad7ff, pattern: "circuit", outfit: "suit", trim: 0x6ad7ff, accent: 0x9fe8ff, pants: 0x222a42, shoes: 0x161c30, gloves: 0x3a4660, eyeColor: 0x6ad7ff, face: "visor" },
  { id: "pharaoh", name: "Pharaoh", body: 0x2a3a8a, head: 0xffd24a, rarity: "epic", cost: 420, hat: "crown", hatColor: 0xffe14a, back: "cape", backColor: 0x223072, emblem: 0xffe14a, pattern: "runes", outfit: "robe", trim: 0xffe14a, accent: 0x4a5ec0, shoes: 0xc8a02a, belt: 0xffe14a, hairColor: 0x14182a, eyeColor: 0xffe14a, face: "glow" },
  { id: "glacier", name: "Glacier", body: 0x6fd0ff, head: 0xffffff, rarity: "epic", cost: 420, hat: "helmet", hatColor: 0xeaf6ff, back: "wings", backColor: 0xbfeaff, pattern: "gem", outfit: "armor", trim: 0xeaf6ff, accent: 0xbfeaff, pants: 0x4aa0d8, shoes: 0x3a80b0, gloves: 0xbfeaff, emblem: 0xeaf6ff, hairColor: 0xbfeaff, eyeColor: 0x9fe8ff, face: "glow" },
  { id: "inferno", name: "Inferno", body: 0xff4a2a, head: 0xffd24a, rarity: "epic", cost: 430, hat: "horns", hatColor: 0xff7a2a, back: "jetpack", backColor: 0x6f3822, pattern: "scales", outfit: "armor", trim: 0xffd24a, accent: 0xffae3a, pants: 0x8a2a14, shoes: 0x5a1a0c, gloves: 0xb23218, emblem: 0xffd24a, hairColor: 0x8a2a14, eyeColor: 0xffd24a, face: "glow" },
  { id: "midas", name: "Midas", body: 0xffcf52, head: 0xfff4d6, rarity: "epic", cost: 450, hat: "crown", hatColor: 0xffe14a, back: "cape", backColor: 0xe0a83a, emblem: 0xffe14a, pattern: "plate", outfit: "armor", trim: 0xfff0a8, accent: 0xffe88a, pants: 0xd8a83a, shoes: 0xb0822a, gloves: 0xffe88a, belt: 0xfff0a8, hairColor: 0xc8932a, eyeColor: 0xfff0a8, face: "glow" },

  // ===== LEGENDARY — mythics of the realm (glow) =====
  { id: "phoenix", name: "Phoenix", body: 0xff6a2a, head: 0xffe14a, rarity: "legendary", cost: 700, glow: 0xff7a2a, hat: "crown", hatColor: 0xffe14a, back: "wings", backColor: 0xff7a2a, emblem: 0xffd24a, outfit: "armor", pattern: "feather", trim: 0xffe14a, accent: 0xffb24a, pants: 0xc8401a, shoes: 0x8a2a10, gloves: 0xff9a3a, hairColor: 0xc8401a, eyeColor: 0xffe14a, face: "glow" },
  { id: "angel", name: "Seraph", body: 0xfff4e0, head: 0xffe9b0, rarity: "legendary", cost: 700, glow: 0xfff0c0, hat: "halo", hatColor: 0xffe14a, back: "wings", backColor: 0xffffff, outfit: "dress", pattern: "feather", trim: 0xffe14a, accent: 0xfff0c0, shoes: 0xe8d6a8, emblem: 0xffe14a, hairColor: 0xffe9b0, cheek: 0xffd0b0, eyeColor: 0xfff0c0, face: "glow" },
  { id: "demon", name: "Demon", body: 0x7a1420, head: 0xff5a4a, rarity: "legendary", cost: 720, glow: 0xff3a2a, hat: "horns", hatColor: 0x2a0a0e, back: "cape", backColor: 0x2a0a0e, emblem: 0xff3a2a, outfit: "jacket", pattern: "scales", trim: 0xff3a2a, accent: 0xb22018, pants: 0x4a0e16, shoes: 0x2a080c, gloves: 0x2a0a0e, belt: 0xff3a2a, hairColor: 0x14141c, eyeColor: 0xffd24a, face: "fanged" },
  { id: "reaper", name: "Reaper", body: 0x14141c, head: 0x4a4a5e, rarity: "legendary", cost: 750, glow: 0x7af7c0, hat: "hood", hatColor: 0x0a0a10, back: "cape", backColor: 0x0a0a10, outfit: "robe", pattern: "runes", trim: 0x7af7c0, accent: 0x2a4a40, shoes: 0x0a0a10, belt: 0x7af7c0, emblem: 0x7af7c0, hairColor: 0x2a2a36, eyeColor: 0x7af7c0, face: "skull" },
  { id: "lich", name: "Lich King", body: 0x1a2a3a, head: 0x6ad7c0, rarity: "legendary", cost: 780, glow: 0x6ad7ff, hat: "crown", hatColor: 0x6ad7ff, back: "cape", backColor: 0x122030, emblem: 0x6ad7ff, pattern: "runes", outfit: "robe", trim: 0x6ad7ff, accent: 0x2a5a7a, shoes: 0x0e1828, belt: 0x6ad7ff, hairColor: 0x2a5a6a, eyeColor: 0x9fe8ff, face: "skull" },
  { id: "dragonlord", name: "Dragonlord", body: 0x2a6a3a, head: 0xc8ff8a, rarity: "legendary", cost: 820, glow: 0x9aff5a, hat: "horns", hatColor: 0x1a4a2a, back: "wings", backColor: 0x2a6a3a, emblem: 0x9aff5a, pattern: "scales", outfit: "armor", trim: 0x9aff5a, accent: 0x3a8a4a, pants: 0x1a4a2a, shoes: 0x103018, gloves: 0x1a4a2a, hairColor: 0x1a4a2a, eyeColor: 0x9aff5a, face: "fanged" },
  { id: "aurora", name: "Aurora", body: 0x4ad6c0, head: 0xc8a0ff, rarity: "legendary", cost: 820, glow: 0x6ad7ff, hat: "halo", hatColor: 0x9fe8ff, back: "wings", backColor: 0x6ad7ff, outfit: "dress", pattern: "stars", trim: 0xc8a0ff, accent: 0x9fe8ff, shoes: 0x3a9a8a, emblem: 0x9fe8ff, hairColor: 0xc8a0ff, cheek: 0xff9ec7, eyeColor: 0x9fe8ff, face: "glow" },

  // ===== MYTHIC — cosmic apex (bright glow) =====
  { id: "cosmic", name: "Cosmic", body: 0x2a1a5e, head: 0xff9ec7, rarity: "mythic", cost: 1300, glow: 0xc792ea, hat: "wizard", hatColor: 0x4a2a8e, back: "wings", backColor: 0xc792ea, emblem: 0xffd24a, pattern: "stars", outfit: "robe", trim: 0xc792ea, accent: 0x6ad7ff, shoes: 0x1a1040, belt: 0xffd24a, hairColor: 0x4a2a8e, eyeColor: 0xffd24a, face: "glow" },
  { id: "prismatic", name: "Prismatic", body: 0xff5a7a, head: 0x6ad7ff, rarity: "mythic", cost: 1500, glow: 0xffd24a, hat: "halo", hatColor: 0xffd24a, back: "wings", backColor: 0xff5a7a, emblem: 0x7be08a, pattern: "stripes", outfit: "hoodie", trim: 0x6ad7ff, accent: 0x7be08a, pants: 0x9a3a8a, shoes: 0xffd24a, gloves: 0xffd24a, hairColor: 0x9a3a8a, eyeColor: 0xffd24a, face: "glow" },
  { id: "voidemperor", name: "Void Emperor", body: 0x140a26, head: 0x8a5ad6, rarity: "mythic", cost: 1600, glow: 0x9a5ad6, hat: "crown", hatColor: 0x9a5ad6, back: "cape", backColor: 0x0e0618, emblem: 0xc792ea, pattern: "runes", outfit: "robe", trim: 0xc792ea, accent: 0x6a3aa6, shoes: 0x0a0414, belt: 0xc792ea, hairColor: 0x4a2a8e, eyeColor: 0xc792ea, face: "glow" },
  { id: "starseraph", name: "Star Seraph", body: 0xeaf0ff, head: 0x9fe8ff, rarity: "mythic", cost: 1700, glow: 0x7af7ff, hat: "halo", hatColor: 0x7af7ff, back: "wings", backColor: 0xffffff, emblem: 0x7af7ff, pattern: "stars", outfit: "dress", trim: 0x7af7ff, accent: 0xc8e8ff, shoes: 0xbfd8f0, hairColor: 0xbfeaff, cheek: 0x9fe8ff, eyeColor: 0x7af7ff, face: "glow" },
  { id: "eclipse", name: "Eclipse", body: 0x0e0e14, head: 0xffd24a, rarity: "mythic", cost: 1800, glow: 0xffe14a, hat: "crown", hatColor: 0xffe14a, back: "wings", backColor: 0x0a0a10, emblem: 0xffe14a, outfit: "armor", pattern: "gem", trim: 0xffe14a, accent: 0xff8a3a, pants: 0x14141c, shoes: 0x0a0a10, gloves: 0x1a1a24, hairColor: 0x14141c, eyeColor: 0xffe14a, face: "glow" },
];

export function findSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
