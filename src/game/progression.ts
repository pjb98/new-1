// Progression: XP/levels, permanent upgrades, and achievements. Selling crops
// earns coins + XP; levels unlock rarer seed tiers (see RARITY_UNLOCK in
// economy.ts); coins buy upgrades that compound the economy.

// ---- levels -------------------------------------------------------------

// Cumulative XP required to *reach* a given level (level 1 = 0 XP).
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += Math.round(60 * Math.pow(l, 1.5));
  return total;
}

export type LevelInfo = { level: number; into: number; need: number; pct: number };

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const need = next - cur;
  const into = xp - cur;
  return { level, into, need, pct: need > 0 ? into / need : 1 };
}

// XP granted when a crop is harvested (rarer plants are worth more).
export function harvestXp(baseValue: number): number {
  return Math.max(2, Math.round(Math.sqrt(baseValue) * 1.5));
}

// ---- upgrades -----------------------------------------------------------

export type UpgradeId = 'water' | 'hoe' | 'growth' | 'fortune' | 'supply' | 'sprinkler' | 'market' | 'lights' | 'pots' | 'trim';

export type UpgradeDef = {
  id: UpgradeId;
  name: string;
  icon: string;
  max: number;
  cost: (level: number) => number; // cost to go from `level` -> level+1
  desc: (level: number) => string; // effect at a given level
};

const areaDesc = (lvl: number) => ['1 pot', '3×3 area', '5×5 area', '7×7 area'][lvl] ?? 'huge';

export const UPGRADES: UpgradeDef[] = [
  { id: 'water', name: 'Watering Can', icon: 'assets/sprout-ui/tool_can.png', max: 3, cost: (l) => 150 * (l + 1) * (l + 1), desc: areaDesc },
  { id: 'hoe', name: 'Trowel', icon: 'assets/sprout-ui/tool_hoe.png', max: 3, cost: (l) => 150 * (l + 1) * (l + 1), desc: areaDesc },
  { id: 'growth', name: 'Nutrients', icon: 'assets/sprout-ui/tool_seed.png', max: 5, cost: (l) => 250 * (l + 1) * (l + 1), desc: (l) => l === 0 ? 'no boost' : `+${l * 15}% grow speed` },
  { id: 'lights', name: 'Grow Lights', icon: 'assets/sprout-ui/dn_day.png', max: 4, cost: (l) => 400 * (l + 1) * (l + 1), desc: (l) => ['off (sunlight only)', 'CFL — +20% speed', 'LED — +45% speed', 'HPS — +75% speed', 'Full-Spectrum — +120% speed'][l] ?? '' },
  { id: 'pots', name: 'Pot Quality', icon: 'assets/sprout-ui/ic_mushroom.png', max: 3, cost: (l) => 600 * (l + 1) * (l + 1), desc: (l) => ['Basic pots', 'Smart Pots — +15% yield value', 'Fabric Pots — +30% yield value', 'Diamond Pots — +50% yield value'][l] ?? '' },
  { id: 'trim', name: 'Trim Tools', icon: 'assets/sprout-ui/icon_basket.png', max: 3, cost: (l) => 300 * (l + 1) * (l + 1), desc: (l) => l === 0 ? 'bare hands' : `+${l * 10}% harvest value` },
  { id: 'fortune', name: 'Lucky Genetics', icon: 'assets/sprout-ui/icon_star.png', max: 5, cost: (l) => 400 * (l + 1) * (l + 1), desc: (l) => l === 0 ? 'no boost' : `+${l * 20}% mutation luck` },
  { id: 'supply', name: 'Plug Network', icon: 'assets/sprout-ui/ic_cart_brown.png', max: 3, cost: (l) => 300 * (l + 1) * (l + 1), desc: (l) => l === 0 ? 'slow restocks' : `restock ${l * 20}s faster` },
  { id: 'sprinkler', name: 'Auto-Dripper', icon: 'assets/sprout-ui/ic_pond.png', max: 3, cost: (l) => 500 * (l + 1) * (l + 1), desc: (l) => (l === 0 ? 'off' : `drips every ${Math.round(45 / l)}s`) },
  { id: 'market', name: 'Street Connections', icon: 'assets/sprout-ui/icon_coin.png', max: 5, cost: (l) => 350 * (l + 1) * (l + 1), desc: (l) => l === 0 ? 'base price' : `+${l * 10}% sell price` },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(
  UPGRADES.map((u) => [u.id, u]),
) as Record<UpgradeId, UpgradeDef>;

export type Upgrades = Record<UpgradeId, number>;
export const EMPTY_UPGRADES: Upgrades = { water: 0, hoe: 0, growth: 0, fortune: 0, supply: 0, sprinkler: 0, market: 0, lights: 0, pots: 0, trim: 0 };

// Effects
export const toolRadius = (lvl: number) => lvl; // 0=1 tile, 1=3x3, 2=5x5, 3=7x7
export const growthFactor = (lvl: number): number => {
  const nutrientBoost = 1 + 0.15 * lvl;
  return nutrientBoost;
};
export const lightsFactor = (lvl: number): number => [1, 1.2, 1.45, 1.75, 2.2][lvl] ?? 2.2;
export const potsBonus = (lvl: number): number => [1, 1.15, 1.30, 1.50][lvl] ?? 1.5;
export const trimBonus = (lvl: number): number => 1 + 0.10 * lvl;
export const fortuneLuck = (lvl: number) => 1 + 0.2 * lvl;
export const restockReductionMs = (lvl: number) => lvl * 20_000;
export const marketBonus = (lvl: number) => 1 + 0.1 * lvl;
export const sprinklerIntervalMs = (lvl: number) => (lvl > 0 ? 45_000 / lvl : Infinity);

// ---- achievements -------------------------------------------------------

export type ProgressStats = {
  earned: number;
  harvested: number;
  mutationsFound: number;
  plantsDiscovered: number;
  level: number;
};

export type Achievement = {
  id: string;
  name: string;
  desc: string;
  reward: number; // coins
  test: (s: ProgressStats) => boolean;
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_harvest', name: 'First Trim', desc: 'Harvest your first strain', reward: 50, test: (s) => s.harvested >= 1 },
  { id: 'green_thumb', name: 'Green Thumb', desc: 'Harvest 50 plants', reward: 500, test: (s) => s.harvested >= 50 },
  { id: 'farmhand', name: 'Master Grower', desc: 'Harvest 250 plants', reward: 2500, test: (s) => s.harvested >= 250 },
  { id: 'first_mutation', name: 'Exotic Cut', desc: 'Find your first mutation', reward: 250, test: (s) => s.mutationsFound >= 1 },
  { id: 'mutant', name: 'Breeder', desc: 'Find 25 mutations', reward: 3000, test: (s) => s.mutationsFound >= 25 },
  { id: 'botanist', name: 'Strain Collector', desc: 'Grow 8 different strains', reward: 1000, test: (s) => s.plantsDiscovered >= 8 },
  { id: 'collector', name: 'Legend of the Block', desc: 'Grow all 19 strains', reward: 12000, test: (s) => s.plantsDiscovered >= 19 },
  { id: 'rich', name: 'On the Grind', desc: 'Earn 10,000 coins total', reward: 1000, test: (s) => s.earned >= 10000 },
  { id: 'tycoon', name: 'Drug Lord', desc: 'Earn 100,000 coins total', reward: 15000, test: (s) => s.earned >= 100000 },
  { id: 'seasoned', name: 'Plug Status', desc: 'Reach level 10', reward: 2000, test: (s) => s.level >= 10 },
];
