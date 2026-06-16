// Economy model: rarity tiers, plants, and mutations — inspired by "Grow a
// Garden": cheap commons up to ultra-rare prismatics, plus harvest mutations
// (Gold/Rainbow/...) that multiply value. Tuned so chasing rare seeds and
// lucky mutations is the core money loop.

export type Rarity =
  | 'Common'
  | 'Uncommon'
  | 'Rare'
  | 'Legendary'
  | 'Mythical'
  | 'Divine'
  | 'Prismatic'
  | 'Celestial';

export const RARITY_ORDER: Rarity[] = [
  'Common',
  'Uncommon',
  'Rare',
  'Legendary',
  'Mythical',
  'Divine',
  'Prismatic',
  'Celestial',
];

export const RARITY: Record<
  Rarity,
  { color: number; css: string; glow: number; present: number; qty: [number, number] }
> = {
  // present = chance the shop stocks it on a restock; qty = stock range when it does
  Common: { color: 0xc3ccd4, css: '#c3ccd4', glow: 0x9aa4ad, present: 1.0, qty: [10, 22] },
  Uncommon: { color: 0x5fd35f, css: '#5fd35f', glow: 0x2e7d32, present: 0.9, qty: [5, 10] },
  Rare: { color: 0x4ea1ff, css: '#4ea1ff', glow: 0x1e5fae, present: 0.6, qty: [3, 6] },
  Legendary: { color: 0xffc23d, css: '#ffc23d', glow: 0xc8901a, present: 0.32, qty: [2, 4] },
  Mythical: { color: 0xb56bff, css: '#b56bff', glow: 0x7a2fd0, present: 0.14, qty: [1, 2] },
  Divine: { color: 0xff5d5d, css: '#ff5d5d', glow: 0xc02020, present: 0.06, qty: [1, 1] },
  Prismatic: { color: 0xff8ad8, css: '#ff8ad8', glow: 0xff66cc, present: 0.02, qty: [1, 1] },
  Celestial: { color: 0x9fe8ff, css: '#9fe8ff', glow: 0x6fd8ff, present: 0.009, qty: [1, 1] },
};

export type Plant = {
  id: string;
  name: string;
  rarity: Rarity;
  seedCost: number;
  baseValue: number;
  growthSeconds: number;
  cropRow: number; // row in the Sprout Lands "Farming Plants" sheet (5 stages/row)
  color: number; // glow / particle tint
  cropTint?: number; // optional base tint of the crop sprite (for palette variants)
};

// Roster mapped to the premium "Farming Plants" sprite rows (r2..r14), tiered
// into the rarity ladder so leveling unlocks progressively fancier crops.
export const PLANTS: Plant[] = [
  // Common
  { id: 'reggie', name: 'Reggie', rarity: 'Common', seedCost: 9, baseValue: 18, growthSeconds: 22, cropRow: 2, color: 0x4caf50 },
  { id: 'kush', name: 'Kush', rarity: 'Common', seedCost: 12, baseValue: 25, growthSeconds: 25, cropRow: 1, color: 0x66bb6a },
  { id: 'haze', name: 'Haze', rarity: 'Common', seedCost: 15, baseValue: 31, growthSeconds: 28, cropRow: 7, color: 0x81c784 },
  { id: 'skunk', name: 'Skunk', rarity: 'Common', seedCost: 20, baseValue: 41, growthSeconds: 32, cropRow: 10, color: 0xa5d6a7 },
  // Uncommon
  { id: 'og_kush', name: 'OG Kush', rarity: 'Uncommon', seedCost: 36, baseValue: 78, growthSeconds: 42, cropRow: 4, color: 0xe53935 },
  { id: 'purple_punch', name: 'Purple Punch', rarity: 'Uncommon', seedCost: 46, baseValue: 100, growthSeconds: 47, cropRow: 3, color: 0x9c27b0 },
  { id: 'gorilla_glue', name: 'Gorilla Glue', rarity: 'Uncommon', seedCost: 56, baseValue: 124, growthSeconds: 52, cropRow: 5, color: 0x5d4037 },
  // Rare
  { id: 'northern_lights', name: 'Northern Lights', rarity: 'Rare', seedCost: 85, baseValue: 195, growthSeconds: 64, cropRow: 12, color: 0x1a237e },
  { id: 'white_widow', name: 'White Widow', rarity: 'Rare', seedCost: 120, baseValue: 282, growthSeconds: 78, cropRow: 14, color: 0xeceff1 },
  // Legendary
  { id: 'sour_diesel', name: 'Sour Diesel', rarity: 'Legendary', seedCost: 210, baseValue: 560, growthSeconds: 104, cropRow: 8, color: 0xf9a825 },
  { id: 'granddaddy_purple', name: 'Granddaddy Purple', rarity: 'Legendary', seedCost: 300, baseValue: 820, growthSeconds: 124, cropRow: 9, color: 0x4a148c },
  // Mythical
  { id: 'gelato', name: 'Gelato', rarity: 'Mythical', seedCost: 560, baseValue: 1650, growthSeconds: 158, cropRow: 11, color: 0xff80ab },
  { id: 'gold_leaf', name: 'Gold Leaf', rarity: 'Mythical', seedCost: 820, baseValue: 2500, growthSeconds: 172, cropRow: 8, color: 0xffd600, cropTint: 0xffc400 },
  // Divine
  { id: 'blue_dream', name: 'Blue Dream', rarity: 'Divine', seedCost: 1350, baseValue: 5200, growthSeconds: 205, cropRow: 6, color: 0x1565c0 },
  { id: 'ice_cream_cake', name: 'Ice Cream Cake', rarity: 'Divine', seedCost: 2100, baseValue: 8200, growthSeconds: 230, cropRow: 9, color: 0xe3f2fd, cropTint: 0xb3e5fc },
  // Prismatic
  { id: 'godfather_og', name: 'Godfather OG', rarity: 'Prismatic', seedCost: 3800, baseValue: 16500, growthSeconds: 255, cropRow: 13, color: 0xff6d00 },
  { id: 'moon_rocks', name: 'Moon Rocks', rarity: 'Prismatic', seedCost: 6400, baseValue: 30000, growthSeconds: 285, cropRow: 6, color: 0xfff8e1, cropTint: 0xffe082 },
  // Celestial
  { id: 'alien_og', name: 'Alien OG', rarity: 'Celestial', seedCost: 13000, baseValue: 64000, growthSeconds: 330, cropRow: 13, color: 0xaa00ff, cropTint: 0xce93d8 },
  { id: 'zkittlez', name: 'Zkittlez', rarity: 'Celestial', seedCost: 26000, baseValue: 145000, growthSeconds: 400, cropRow: 11, color: 0xff1744, cropTint: 0xff6e6e },
];

export const PLANT_BY_ID: Record<string, Plant> = Object.fromEntries(
  PLANTS.map((p) => [p.id, p]),
);

export function rarityRank(r: Rarity): number {
  return RARITY_ORDER.indexOf(r);
}

// Player level at which each rarity tier becomes available in the shop.
export const RARITY_UNLOCK: Record<Rarity, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 5,
  Legendary: 9,
  Mythical: 14,
  Divine: 20,
  Prismatic: 28,
  Celestial: 36,
};

// ---- mutations ----------------------------------------------------------

export type Mutation = {
  id: string;
  name: string;
  mult: number;
  weight: number; // relative chance at harvest
  tint: number | null; // sprite tint (null = use plant colors); 'rainbow' animates
  rainbow?: boolean;
  css: string;
};

export const MUTATIONS: Mutation[] = [
  { id: 'normal', name: 'Standard', mult: 1, weight: 100, tint: null, css: '#cfd6dd' },
  { id: 'shiny', name: 'Frosty', mult: 2, weight: 18, tint: 0xfff6c2, css: '#ffe98a' },
  { id: 'frosted', name: 'Crystalized', mult: 8, weight: 6, tint: 0xbdecff, css: '#bdecff' },
  { id: 'gold', name: 'Golden', mult: 20, weight: 4, tint: 0xffd21a, css: '#ffd21a' },
  { id: 'rainbow', name: 'Rainbow Kush', mult: 50, weight: 1, tint: 0xffffff, rainbow: true, css: '#ff7ad0' },
];

export const MUTATION_BY_ID: Record<string, Mutation> = Object.fromEntries(
  MUTATIONS.map((m) => [m.id, m]),
);

const MUT_TOTAL = MUTATIONS.reduce((s, m) => s + m.weight, 0);

// `luck` (>=1) scales up the odds of non-normal mutations (the Fortune upgrade).
export function pickMutation(luck = 1): Mutation {
  if (luck <= 1) {
    let r = Math.random() * MUT_TOTAL;
    for (const m of MUTATIONS) {
      r -= m.weight;
      if (r <= 0) return m;
    }
    return MUTATIONS[0];
  }
  const weights = MUTATIONS.map((m) => (m.id === 'normal' ? m.weight : m.weight * luck));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < MUTATIONS.length; i++) {
    r -= weights[i];
    if (r <= 0) return MUTATIONS[i];
  }
  return MUTATIONS[0];
}

// ---- value + shop -------------------------------------------------------

export function cropValue(plant: Plant, mutation: Mutation, wet: boolean): number {
  return Math.round(plant.baseValue * mutation.mult * (wet ? 1.5 : 1));
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// Roll a fresh shop stock map (plantId -> count). Commons always present;
// rarer tiers appear with decreasing probability — that's the "wait for the
// rare restock" chase.
export function rollShop(level = 99): Record<string, number> {
  const stock: Record<string, number> = {};
  for (const p of PLANTS) {
    if (RARITY_UNLOCK[p.rarity] > level) {
      stock[p.id] = 0; // tier not unlocked yet
      continue;
    }
    const r = RARITY[p.rarity];
    stock[p.id] = Math.random() < r.present ? randInt(r.qty[0], r.qty[1]) : 0;
  }
  return stock;
}

// Stable harvest-stack key so identical (plant + mutation + wet) items stack.
export function stackKey(plantId: string, mutationId: string, wet: boolean): string {
  return `${plantId}|${mutationId}|${wet ? 1 : 0}`;
}

export function parseStackKey(key: string): { plant: Plant; mutation: Mutation; wet: boolean } {
  const [plantId, mutationId, wet] = key.split('|');
  return { plant: PLANT_BY_ID[plantId], mutation: MUTATION_BY_ID[mutationId], wet: wet === '1' };
}
