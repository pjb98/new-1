import { STRAINS } from "./strains";

export type PackagingType = "none" | "zip" | "jar" | "luxury" | "weed_pack";

export interface PotState {
  id: number;
  strainId: string | null;
  stage: "empty" | "planted" | "seedling" | "vegetative" | "flowering" | "ready";
  growProgress: number;   // 0-100
  waterLevel: number;     // 0-100
  nutrientLevel: number;  // 0-100
  quality: number;        // 0-100
  potType: string;        // item id
  dayPlanted: number;
}

export interface StashEntry {
  strainId: string;
  grams: number;
  quality: number;
  packaging: PackagingType;
}

export interface Customer {
  id: string;
  name: string;
  avatar: string;
  preferredRarities: string[];
  priceMultiplier: number;
  maxGrams: number;
  minQuality: number;
  unlockLevel: number;
  cooldownMins: number;
  lastBoughtAt: number;  // game minute timestamp
  reputation: number;    // 0-100, higher = better prices
  dialogue: { greeting: string; deal: string; reject: string };
}

export interface GameState {
  day: number;
  gameMins: number;       // total game minutes elapsed
  money: number;
  weedTokens: number;
  heat: number;
  xp: number;
  level: number;
  pots: PotState[];
  stash: StashEntry[];
  inventory: Record<string, number>;  // itemId → quantity
  ownedItems: string[];               // non-stackable owned items
  cosmetics: string[];                // equipped cosmetics
  unlockedCustomers: string[];
  customers: Customer[];
  stats: {
    totalHarvests: number;
    totalSold: number;
    totalEarned: number;
    bestDay: number;
  };
}

export const CUSTOMERS: Customer[] = [
  { id: "mikey", name: "Mikey", avatar: "😎", preferredRarities: ["common", "uncommon"], priceMultiplier: 0.80, maxGrams: 20, minQuality: 0, unlockLevel: 1, cooldownMins: 60, lastBoughtAt: 0, reputation: 50, dialogue: { greeting: "Yo, you holdin? I need something to take the edge off.", deal: "Bet, I'll take it. Here's the bread.", reject: "Nah, I'm broke right now. Come back later." } },
  { id: "tasha", name: "Tasha", avatar: "💅", preferredRarities: ["uncommon", "rare"], priceMultiplier: 0.90, maxGrams: 15, minQuality: 40, unlockLevel: 1, cooldownMins: 90, lastBoughtAt: 0, reputation: 50, dialogue: { greeting: "Hey boo. Got that good-good? None of that reggie.", deal: "Okay okay, this looks fire. I'll take it.", reject: "This ain't hitting right, come back when you got the good stuff." } },
  { id: "big_ron", name: "Big Ron", avatar: "🤑", preferredRarities: ["common", "uncommon", "rare", "legendary"], priceMultiplier: 0.85, maxGrams: 50, minQuality: 20, unlockLevel: 2, cooldownMins: 120, lastBoughtAt: 0, reputation: 50, dialogue: { greeting: "Aye! My guy! I need to re-up heavy.", deal: "Say less. Loading you up.", reject: "I'm already stocked, come back tomorrow." } },
  { id: "dr_stevens", name: "Dr. Stevens", avatar: "👨‍⚕️", preferredRarities: ["rare", "legendary", "mythical", "divine"], priceMultiplier: 1.10, maxGrams: 10, minQuality: 80, unlockLevel: 3, cooldownMins: 180, lastBoughtAt: 0, reputation: 50, dialogue: { greeting: "I require only the finest botanicals. Nothing below 80% quality.", deal: "Excellent. This meets my standards.", reject: "This doesn't meet my quality threshold. Good day." } },
  { id: "the_plug", name: "The Plug", avatar: "🔌", preferredRarities: ["common", "uncommon", "rare", "legendary", "mythical", "divine", "prismatic", "celestial"], priceMultiplier: 0.95, maxGrams: 100, minQuality: 0, unlockLevel: 4, cooldownMins: 240, lastBoughtAt: 0, reputation: 50, dialogue: { greeting: "What you got? I'll take whatever, as long as it moves.", deal: "Straight business. Good doing work with you.", reject: "Not today. I'll hit you up." } },
  { id: "sofia", name: "Sofia", avatar: "🌺", preferredRarities: ["legendary", "mythical", "divine", "prismatic", "celestial"], priceMultiplier: 1.15, maxGrams: 8, minQuality: 90, unlockLevel: 5, cooldownMins: 360, lastBoughtAt: 0, reputation: 50, dialogue: { greeting: "Only the rarest, sweetest flowers for my collection.", deal: "Magnifique. You've outdone yourself.", reject: "Not quite what I'm looking for. Try again with better stock." } },
  { id: "ghost", name: "Ghost", avatar: "👻", preferredRarities: ["mythical", "divine", "prismatic", "celestial"], priceMultiplier: 1.20, maxGrams: 30, minQuality: 70, unlockLevel: 6, cooldownMins: 480, lastBoughtAt: 0, reputation: 50, dialogue: { greeting: "...", deal: "*nods approvingly*", reject: "*disappears*" } },
  { id: "empress", name: "Empress", avatar: "👑", preferredRarities: ["prismatic", "celestial"], priceMultiplier: 1.30, maxGrams: 15, minQuality: 95, unlockLevel: 7, cooldownMins: 720, lastBoughtAt: 0, reputation: 50, dialogue: { greeting: "I accept only celestial quality. Do not waste my time.", deal: "Acceptable. You may keep my contact.", reject: "Unacceptable. Improve your craft." } },
];

const XP_PER_LEVEL = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5800, 8000];

export function xpForLevel(level: number): number {
  return XP_PER_LEVEL[Math.min(level, XP_PER_LEVEL.length - 1)] ?? 99999;
}

export function defaultPot(id: number): PotState {
  return { id, strainId: null, stage: "empty", growProgress: 0, waterLevel: 100, nutrientLevel: 100, quality: 50, potType: "basic_pot", dayPlanted: 0 };
}

function defaultState(): GameState {
  return {
    day: 1,
    gameMins: 0,
    money: 500,
    weedTokens: 0,
    heat: 0,
    xp: 0,
    level: 1,
    pots: [defaultPot(0), defaultPot(1), defaultPot(2), defaultPot(3)],
    stash: [],
    inventory: { basic_pot: 4, watering_can: 1, zip_bags: 10, basic_nutes: 3 },
    ownedItems: ["watering_can", "basic_led"],
    cosmetics: [],
    unlockedCustomers: ["mikey", "tasha"],
    customers: CUSTOMERS,
    stats: { totalHarvests: 0, totalSold: 0, totalEarned: 0, bestDay: 0 },
  };
}

const SAVE_KEY = "weed_sim_save_v1";

export function loadState(): GameState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GameState;
      // Merge customers to pick up any new ones
      parsed.customers = CUSTOMERS.map(c => {
        const saved = parsed.customers?.find(sc => sc.id === c.id);
        return saved ? { ...c, lastBoughtAt: saved.lastBoughtAt, reputation: saved.reputation } : c;
      });
      return parsed;
    }
  } catch {}
  return defaultState();
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {}
}

export function resetState(): GameState {
  localStorage.removeItem(SAVE_KEY);
  return defaultState();
}

export function calcLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < XP_PER_LEVEL.length; i++) {
    if (xp >= XP_PER_LEVEL[i]) level = i + 1;
    else break;
  }
  return Math.min(level, 10);
}

export function strainUnlocked(strainId: string, state: GameState): boolean {
  const strain = STRAINS.find(s => s.id === strainId);
  if (!strain) return false;
  return state.level >= strain.unlockLevel;
}
