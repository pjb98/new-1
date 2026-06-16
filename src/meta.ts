import { RunMods } from "./mods";

/**
 * Permanent meta-upgrades bought between runs with Essence. Each is a one-time
 * purchase that applies to every future run. This is the long-arc progression
 * that turns "I died" into "I'm stronger next time".
 */
export interface MetaUpgrade {
  id: string;
  name: string;
  desc: string;
  cost: number;
  apply: (m: RunMods) => void;
}

export const META_UPGRADES: MetaUpgrade[] = [
  { id: "vitality", name: "Vitality", desc: "+40 starting max HP", cost: 120, apply: (m) => (m.maxHealthBonus += 40) },
  { id: "power", name: "Power", desc: "+15% weapon damage", cost: 180, apply: (m) => (m.damageMul += 0.15) },
  { id: "haste", name: "Haste", desc: "+10% fire rate", cost: 160, apply: (m) => (m.fireRateMul += 0.1) },
  { id: "fortune", name: "Fortune", desc: "Start each run with +750 points", cost: 140, apply: (m) => (m.startPointsBonus += 750) },
  { id: "marksman", name: "Steady Hand", desc: "+8% crit chance", cost: 200, apply: (m) => (m.critChance += 0.08) },
  { id: "scavenger", name: "Scavenger", desc: "+6% loot drop chance", cost: 170, apply: (m) => (m.dropChance += 0.06) },
  { id: "endurance", name: "Endurance", desc: "Combos last +1.5s longer", cost: 150, apply: (m) => (m.comboWindowBonus += 1.5) },
  { id: "greed", name: "Greed", desc: "+25% Essence earned", cost: 220, apply: (m) => (m.essenceMul += 0.25) },
  { id: "loadout", name: "Loadout: Buzzgun", desc: "Start with the Buzzgun SMG", cost: 300, apply: (m) => (m.startWeapon = "buzzgun") },
];

/** Essence awarded for a finished run — every run pays out. */
export function essenceFor(round: number, score: number, mul: number): number {
  return Math.max(1, Math.round((round * 6 + score / 80) * mul));
}
