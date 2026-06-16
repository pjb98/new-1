// Foraging: wild finds you gather from the world (mushrooms, berries, herbs).
// Forageable nodes spawn on open grass and respawn over time; gathering one
// awards coins + Foraging XP, and the skill's luck tilts toward rarer finds.
// Standalone data/logic — FarmScene spawns the nodes and runs the gather.

export type Forage = {
  id: string;
  name: string;
  value: number;
  weight: number; // relative find chance at luck 1
  sheet: string; // texture key to draw the node
  frame: number; // frame within the sheet
  css: string;
};

// Ordered common → rare. Frames reference the already-loaded 'mfs' (mushrooms/
// flowers/stones) and 'nature' (berry bushes) sheets.
export const FORAGE: Forage[] = [
  { id: 'mushroom', name: 'Wild Mushroom', value: 18, weight: 100, sheet: 'mfs', frame: 0, css: '#d6a06a' },
  { id: 'berries', name: 'Wild Berries', value: 40, weight: 60, sheet: 'nature', frame: 37, css: '#e2402c' },
  { id: 'herb', name: 'Healing Herb', value: 85, weight: 30, sheet: 'mfs', frame: 12, css: '#86c34a' },
  { id: 'blueberries', name: 'Moonberries', value: 180, weight: 13, sheet: 'nature', frame: 40, css: '#4ea1ff' },
  { id: 'crystal', name: 'Crystal Shard', value: 420, weight: 5, sheet: 'mfs', frame: 25, css: '#b56bff' },
  { id: 'goldcap', name: 'Golden Truffle', value: 1100, weight: 1.5, sheet: 'mfs', frame: 3, css: '#ffd21a' },
];

// Pick a forage type; `luck` (>=1, from the Foraging skill) favours rarer finds.
export function pickForage(luck = 1): Forage {
  const weights = FORAGE.map((f, i) => f.weight * (1 + (luck - 1) * i * 0.35));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < FORAGE.length; i++) {
    r -= weights[i];
    if (r <= 0) return FORAGE[i];
  }
  return FORAGE[0];
}

export function forageXp(f: Forage): number {
  return Math.max(3, Math.round(Math.sqrt(f.value) * 1.1));
}
