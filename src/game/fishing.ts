// Fishing: cast at the pond to catch a fish. Species range from common minnows
// to a legendary eel; the Fishing skill's luck boosts rare odds and value.
// Standalone data/logic — FarmScene runs the cast + awards coins/XP.

export type Fish = {
  id: string;
  name: string;
  value: number;
  weight: number; // relative catch chance at luck 1
  tint: number; // colour for the procedural fish sprite + popup
  css: string;
};

// Ordered common → legendary (rarer = lower weight, higher value).
export const FISH: Fish[] = [
  { id: 'minnow', name: 'Minnow', value: 14, weight: 100, tint: 0xbfe3ff, css: '#bfe3ff' },
  { id: 'perch', name: 'Perch', value: 34, weight: 62, tint: 0x86c34a, css: '#86c34a' },
  { id: 'carp', name: 'Carp', value: 75, weight: 34, tint: 0xc9a06a, css: '#c9a06a' },
  { id: 'bass', name: 'Bass', value: 160, weight: 16, tint: 0x4ea1ff, css: '#4ea1ff' },
  { id: 'trout', name: 'Rainbow Trout', value: 380, weight: 7, tint: 0xff8ad8, css: '#ff8ad8' },
  { id: 'salmon', name: 'King Salmon', value: 850, weight: 3, tint: 0xff5d5d, css: '#ff5d5d' },
  { id: 'koi', name: 'Golden Koi', value: 2200, weight: 1, tint: 0xffd21a, css: '#ffd21a' },
  { id: 'eel', name: 'Ancient Eel', value: 6000, weight: 0.35, tint: 0x8a4fd0, css: '#b56bff' },
];

// Pick a fish. `luck` (>=1, from the Fishing skill) tilts the odds toward rarer
// species (those later in the list).
export function catchFish(luck = 1): Fish {
  const weights = FISH.map((f, i) => f.weight * (1 + (luck - 1) * i * 0.35));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < FISH.length; i++) {
    r -= weights[i];
    if (r <= 0) return FISH[i];
  }
  return FISH[0];
}

// XP for landing a fish (rarer/heavier = more).
export function fishXp(fish: Fish): number {
  return Math.max(4, Math.round(Math.sqrt(fish.value) * 1.4));
}
