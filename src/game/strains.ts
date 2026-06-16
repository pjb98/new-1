export type Rarity = "common" | "uncommon" | "rare" | "legendary" | "mythical" | "divine" | "prismatic" | "celestial";

export interface Strain {
  id: string;
  name: string;
  rarity: Rarity;
  growDays: number;       // game days to mature
  seedCost: number;       // $ per seed
  sellPricePerG: number;  // $ per gram base price
  yieldGrams: number;     // grams per pot at 100% quality
  color: number;          // hex color for plant visual
  glowColor: number;
  effects: string;
  unlockLevel: number;
  weedTokenGated?: boolean; // requires $WEED tokens to unlock
}

export const STRAINS: Strain[] = [
  // Common
  { id: "reggie", name: "Reggie", rarity: "common", growDays: 1, seedCost: 5, sellPricePerG: 3, yieldGrams: 14, color: 0x8bc34a, glowColor: 0xa5d6a7, effects: "Mild buzz. Gets the job done.", unlockLevel: 1 },
  { id: "swag", name: "Swag", rarity: "common", growDays: 1, seedCost: 8, sellPricePerG: 4, yieldGrams: 12, color: 0xc5e1a5, glowColor: 0xdcedc8, effects: "Nothing special. Sells fast.", unlockLevel: 1 },
  // Uncommon
  { id: "mids", name: "Mids", rarity: "uncommon", growDays: 2, seedCost: 20, sellPricePerG: 8, yieldGrams: 16, color: 0x66bb6a, glowColor: 0xa5d6a7, effects: "Decent quality. Popular with casuals.", unlockLevel: 2 },
  { id: "outdoor_kush", name: "Outdoor Kush", rarity: "uncommon", growDays: 2, seedCost: 25, sellPricePerG: 10, yieldGrams: 18, color: 0x43a047, glowColor: 0x81c784, effects: "Earthy. Relaxing body high.", unlockLevel: 2 },
  // Rare
  { id: "og_kush", name: "OG Kush", rarity: "rare", growDays: 3, seedCost: 60, sellPricePerG: 18, yieldGrams: 20, color: 0x1b5e20, glowColor: 0x4caf50, effects: "Classic strain. Stress-melting euphoria.", unlockLevel: 3 },
  { id: "purple_haze", name: "Purple Haze", rarity: "rare", growDays: 3, seedCost: 75, sellPricePerG: 22, yieldGrams: 18, color: 0x7b1fa2, glowColor: 0xce93d8, effects: "Psychedelic creativity boost.", unlockLevel: 3 },
  // Legendary
  { id: "blue_dream", name: "Blue Dream", rarity: "legendary", growDays: 4, seedCost: 150, sellPricePerG: 35, yieldGrams: 22, color: 0x1565c0, glowColor: 0x90caf9, effects: "Balanced hybrid. Clear-headed bliss.", unlockLevel: 4 },
  { id: "gelato", name: "Gelato", rarity: "legendary", growDays: 4, seedCost: 180, sellPricePerG: 42, yieldGrams: 20, color: 0xe64a19, glowColor: 0xffab91, effects: "Sweet flavor. Dessert for the mind.", unlockLevel: 4 },
  // Mythical
  { id: "white_widow", name: "White Widow", rarity: "mythical", growDays: 5, seedCost: 350, sellPricePerG: 65, yieldGrams: 24, color: 0xeceff1, glowColor: 0xffffff, effects: "Covered in crystals. Powerful euphoria.", unlockLevel: 5 },
  { id: "gorilla_glue", name: "Gorilla Glue #4", rarity: "mythical", growDays: 5, seedCost: 400, sellPricePerG: 70, yieldGrams: 22, color: 0x5d4037, glowColor: 0xa1887f, effects: "Heavy hitting. Couch-lock guaranteed.", unlockLevel: 5 },
  // Divine
  { id: "gsc", name: "Girl Scout Cookies", rarity: "divine", growDays: 6, seedCost: 700, sellPricePerG: 100, yieldGrams: 26, color: 0x00897b, glowColor: 0x80cbc4, effects: "Award-winning flavor. Total body melt.", unlockLevel: 6 },
  { id: "wedding_cake", name: "Wedding Cake", rarity: "divine", growDays: 6, seedCost: 800, sellPricePerG: 110, yieldGrams: 24, color: 0xf8bbd0, glowColor: 0xfce4ec, effects: "Tangy sweetness. Mood-lifting serenity.", unlockLevel: 6 },
  // Prismatic (token-gated)
  { id: "runtz", name: "Runtz", rarity: "prismatic", growDays: 7, seedCost: 1200, sellPricePerG: 160, yieldGrams: 28, color: 0xe91e63, glowColor: 0xf48fb1, effects: "Rainbow terps. Euphoric candy clouds.", unlockLevel: 7, weedTokenGated: true },
  { id: "zkittlez", name: "Zkittlez", rarity: "prismatic", growDays: 7, seedCost: 1400, sellPricePerG: 175, yieldGrams: 26, color: 0xff6f00, glowColor: 0xffcc02, effects: "Taste the rainbow, sell the rainbow.", unlockLevel: 7, weedTokenGated: true },
  // Celestial (token-gated)
  { id: "gods_gift", name: "God's Gift", rarity: "celestial", growDays: 8, seedCost: 2500, sellPricePerG: 250, yieldGrams: 32, color: 0xffd700, glowColor: 0xffff00, effects: "Blessed genetics. Transcendent experience.", unlockLevel: 8, weedTokenGated: true },
  { id: "unicorn_piss", name: "Unicorn Piss", rarity: "celestial", growDays: 8, seedCost: 3000, sellPricePerG: 300, yieldGrams: 30, color: 0xaa00ff, glowColor: 0xea80fc, effects: "Mythical potency. Only the worthy grow this.", unlockLevel: 8, weedTokenGated: true },
];

export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0x888888,
  uncommon: 0x4caf50,
  rare: 0x2196f3,
  legendary: 0xff9800,
  mythical: 0xe91e63,
  divine: 0x00bcd4,
  prismatic: 0xaa00ff,
  celestial: 0xffd700,
};

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
  mythical: "Mythical",
  divine: "Divine",
  prismatic: "Prismatic",
  celestial: "Celestial",
};

export function getStrain(id: string): Strain | undefined {
  return STRAINS.find(s => s.id === id);
}
