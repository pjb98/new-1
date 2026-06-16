import type { Skills, ChosenPerks } from './skills';

// A seed offer in the shop's current stock.
export type ShopEntry = { plantId: string; stock: number };

// Progression snapshot for the UI (level/XP, upgrades, lifetime stats, unlocks).
export type Progress = {
  level: number;
  xpInto: number;
  xpNeed: number;
  upgrades: Record<string, number>;
  earned: number;
  harvested: number;
  mutationsFound: number;
  discoveredPlants: string[];
  discoveredMutations: string[];
  achievements: string[]; // unlocked ids
};

// State the Phaser game pushes up to the React UI on change.
export type UiState = {
  coins: number;
  selected: string; // 'hoe' | 'can' | 'seed'
  selectedSeed: string | null; // plant id used when planting
  seeds: Record<string, number>; // plantId -> count owned
  harvest: Record<string, number>; // stackKey -> count owned
  shop: ShopEntry[]; // full catalog with current stock
  animalCounts: Record<string, number>; // animal id -> owned count
  progress: Progress;
  skills: Skills; // xp per skill (farming/ranching/breeding/fishing/foraging)
  perks: ChosenPerks; // chosen milestone perks, key `${skillId}:${level}` -> perkId
};

// Lightweight time/restock state, emitted about once per second.
export type ClockState = {
  day: number;
  clock: string; // "06:30"
  phase: 'dawn' | 'day' | 'dusk' | 'night';
  restockIn: number; // seconds until shop restock
};
