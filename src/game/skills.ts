// Skill progression: five skills that level 1→20 from the activities you do,
// each with a smooth per-level passive PLUS milestone PERK CHOICES (Lv 5/10/15,
// pick 1 of 2), a Lv20 CAPSTONE, and endless MASTERY stars past 20. FarmScene
// reads `activeModifiers(skills, perks)` — one aggregated bag of multipliers and
// flags — and applies it across growth/value/breeding/fishing/foraging.

export type SkillId = 'farming' | 'ranching' | 'breeding' | 'fishing' | 'foraging';
export const SKILL_IDS: SkillId[] = ['farming', 'ranching', 'breeding', 'fishing', 'foraging'];
export const MAX_SKILL_LEVEL = 20;
export const PERK_LEVELS = [5, 10, 15]; // milestones that grant a perk choice

export type Skills = Record<SkillId, number>; // xp per skill
export const EMPTY_SKILLS: Skills = { farming: 0, ranching: 0, breeding: 0, fishing: 0, foraging: 0 };

// Chosen perks: key `${skillId}:${level}` -> perk id.
export type ChosenPerks = Record<string, string>;
export const EMPTY_PERKS: ChosenPerks = {};

// ---- level curve --------------------------------------------------------
export function skillXpForLevel(level: number): number {
  const l = Math.min(level, MAX_SKILL_LEVEL);
  let total = 0;
  for (let i = 1; i < l; i++) total += Math.round(40 * Math.pow(i, 1.55));
  return total;
}
const MASTERY_STEP = Math.round(40 * Math.pow(MAX_SKILL_LEVEL, 1.55)); // xp per mastery star past 20

export type SkillInfo = { level: number; into: number; need: number; pct: number; max: boolean; mastery: number };

export function skillInfo(xp: number): SkillInfo {
  let level = 1;
  while (level < MAX_SKILL_LEVEL && xp >= skillXpForLevel(level + 1)) level++;
  if (level >= MAX_SKILL_LEVEL) {
    const over = xp - skillXpForLevel(MAX_SKILL_LEVEL);
    const mastery = Math.floor(over / MASTERY_STEP);
    return { level: MAX_SKILL_LEVEL, into: over - mastery * MASTERY_STEP, need: MASTERY_STEP, pct: (over - mastery * MASTERY_STEP) / MASTERY_STEP, max: true, mastery };
  }
  const cur = skillXpForLevel(level);
  const next = skillXpForLevel(level + 1);
  const need = next - cur;
  return { level, into: xp - cur, need, pct: need > 0 ? (xp - cur) / need : 1, max: false, mastery: 0 };
}
export const skillLevel = (xp: number) => skillInfo(xp).level;
export const masteryLevel = (xp: number) => skillInfo(xp).mastery;

// ---- modifiers (everything gameplay reads) ------------------------------
export type Modifiers = {
  cropValueMult: number; cropGrowthMult: number; cropDoubleChance: number;
  seedSaveChance: number; mutationLuckMult: number; autoReplant: boolean;
  productValueMult: number; prodSpeedMult: number; productDoubleChance: number; goldenProductChance: number;
  breedCapBonus: number; breedSpeedMult: number; rareBabyChance: number;
  fishValueMult: number; fishLuckMult: number; treasureChance: number; legendaryFish: boolean;
  forageValueMult: number; forageLuckMult: number; forageRespawnMult: number; gemChance: number;
};
export const baseModifiers = (): Modifiers => ({
  cropValueMult: 1, cropGrowthMult: 1, cropDoubleChance: 0, seedSaveChance: 0, mutationLuckMult: 1, autoReplant: false,
  productValueMult: 1, prodSpeedMult: 1, productDoubleChance: 0, goldenProductChance: 0,
  breedCapBonus: 0, breedSpeedMult: 1, rareBabyChance: 0,
  fishValueMult: 1, fishLuckMult: 1, treasureChance: 0, legendaryFish: false,
  forageValueMult: 1, forageLuckMult: 1, forageRespawnMult: 1, gemChance: 0,
});

// ---- perks --------------------------------------------------------------
export type Perk = { id: string; name: string; desc: string; mods: Partial<Modifiers> };
type Milestone = { level: number; a: Perk; b: Perk };

export const SKILLS: { id: SkillId; name: string; icon: string; blurb: string; milestones: Milestone[]; capstone: Perk }[] = [
  {
    id: 'farming', name: 'Farming', icon: 'assets/crops/corn.png', blurb: 'Harvesting crops.',
    milestones: [
      { level: 5,
        a: { id: 'cultivator', name: 'Cultivator', desc: '+25% crop sell value', mods: { cropValueMult: 0.25 } },
        b: { id: 'agriculturist', name: 'Agriculturist', desc: '+25% crop growth speed', mods: { cropGrowthMult: 0.25 } } },
      { level: 10,
        a: { id: 'fortune', name: 'Fortune', desc: '+50% mutation luck', mods: { mutationLuckMult: 0.5 } },
        b: { id: 'bountiful', name: 'Bountiful', desc: '12% chance a harvest yields 2', mods: { cropDoubleChance: 0.12 } } },
      { level: 15,
        a: { id: 'thrifty', name: 'Thrifty', desc: '30% chance not to use the seed', mods: { seedSaveChance: 0.30 } },
        b: { id: 'prodigy', name: 'Prodigy', desc: '+20% value, +10% growth', mods: { cropValueMult: 0.20, cropGrowthMult: 0.10 } } },
    ],
    capstone: { id: 'master_farmer', name: 'Master Farmer', desc: '15% chance to auto-replant on harvest · +15% value', mods: { autoReplant: true, cropValueMult: 0.15 } },
  },
  {
    id: 'ranching', name: 'Ranching', icon: 'assets/sprout-ui/icon_cow.png', blurb: 'Collecting eggs, milk & fruit.',
    milestones: [
      { level: 5,
        a: { id: 'shepherd', name: 'Shepherd', desc: '+30% product value', mods: { productValueMult: 0.30 } },
        b: { id: 'quickhand', name: 'Quickhand', desc: '+25% production speed', mods: { prodSpeedMult: 0.25 } } },
      { level: 10,
        a: { id: 'bountiful_herd', name: 'Bountiful Herd', desc: '12% chance of double product', mods: { productDoubleChance: 0.12 } },
        b: { id: 'golden_touch', name: 'Golden Touch', desc: '4% chance of a golden (×5) product', mods: { goldenProductChance: 0.04 } } },
      { level: 15,
        a: { id: 'devoted', name: 'Devoted', desc: '+35% product value', mods: { productValueMult: 0.35 } },
        b: { id: 'efficient', name: 'Efficient', desc: '+35% production speed', mods: { prodSpeedMult: 0.35 } } },
    ],
    capstone: { id: 'rancher_lord', name: 'Rancher Lord', desc: '+25% value · +6% golden chance', mods: { productValueMult: 0.25, goldenProductChance: 0.06 } },
  },
  {
    id: 'breeding', name: 'Breeding', icon: 'assets/sprout-ui/icon_egg.png', blurb: 'Raising baby animals.',
    milestones: [
      { level: 5,
        a: { id: 'fertile', name: 'Fertile', desc: '+2 herd cap', mods: { breedCapBonus: 2 } },
        b: { id: 'nurturer', name: 'Nurturer', desc: '+30% faster breeding & growth', mods: { breedSpeedMult: 0.30 } } },
      { level: 10,
        a: { id: 'prolific', name: 'Prolific', desc: '+35% faster breeding', mods: { breedSpeedMult: 0.35 } },
        b: { id: 'hardy', name: 'Hardy Stock', desc: '+3 herd cap', mods: { breedCapBonus: 3 } } },
      { level: 15,
        a: { id: 'bloodline', name: 'Rare Bloodline', desc: '+15% chance of a rare-colour baby', mods: { rareBabyChance: 0.15 } },
        b: { id: 'big_ranch', name: 'Big Ranch', desc: '+3 herd cap', mods: { breedCapBonus: 3 } } },
    ],
    capstone: { id: 'master_breeder', name: 'Master Breeder', desc: '+25% rare babies · +20% faster', mods: { rareBabyChance: 0.25, breedSpeedMult: 0.20 } },
  },
  {
    id: 'fishing', name: 'Fishing', icon: 'assets/sprout-ui/ic_pond.png', blurb: 'Casting at the pond.',
    milestones: [
      { level: 5,
        a: { id: 'angler', name: 'Angler', desc: '+40% fish value', mods: { fishValueMult: 0.40 } },
        b: { id: 'trawler', name: 'Trawler', desc: '+40% rare-catch luck', mods: { fishLuckMult: 0.40 } } },
      { level: 10,
        a: { id: 'treasure_hunter', name: 'Treasure Hunter', desc: '10% chance to reel a treasure', mods: { treasureChance: 0.10 } },
        b: { id: 'deep_liner', name: 'Deep Liner', desc: '+50% rare-catch luck', mods: { fishLuckMult: 0.50 } } },
      { level: 15,
        a: { id: 'master_caster', name: 'Master Caster', desc: '+40% fish value', mods: { fishValueMult: 0.40 } },
        b: { id: 'lucky_hook', name: 'Lucky Hook', desc: '+50% luck · +5% treasure', mods: { fishLuckMult: 0.50, treasureChance: 0.05 } } },
    ],
    capstone: { id: 'legendary_angler', name: 'Legendary Angler', desc: 'Can hook legendary fish · +30% value', mods: { legendaryFish: true, fishValueMult: 0.30 } },
  },
  {
    id: 'foraging', name: 'Foraging', icon: 'assets/sprout-ui/ic_mushroom.png', blurb: 'Gathering wild finds.',
    milestones: [
      { level: 5,
        a: { id: 'gatherer', name: 'Gatherer', desc: '+40% forage value', mods: { forageValueMult: 0.40 } },
        b: { id: 'botanist', name: 'Botanist', desc: '+50% faster respawn · +20% luck', mods: { forageRespawnMult: 0.50, forageLuckMult: 0.20 } } },
      { level: 10,
        a: { id: 'truffle_hog', name: 'Truffle Hog', desc: '+50% rare-find luck', mods: { forageLuckMult: 0.50 } },
        b: { id: 'keen_eye', name: 'Keen Eye', desc: '+40% forage value', mods: { forageValueMult: 0.40 } } },
      { level: 15,
        a: { id: 'naturalist', name: 'Naturalist', desc: '+30% value · +30% luck', mods: { forageValueMult: 0.30, forageLuckMult: 0.30 } },
        b: { id: 'quick_hands', name: 'Quick Hands', desc: '+60% faster respawn', mods: { forageRespawnMult: 0.60 } } },
    ],
    capstone: { id: 'forest_spirit', name: 'Forest Spirit', desc: '6% chance of a gem · +30% value', mods: { gemChance: 0.06, forageValueMult: 0.30 } },
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, (typeof SKILLS)[number]>;

// Per-level smooth passive (the base track), folded into the modifiers below.
function basePassive(id: SkillId, lvl: number, m: Modifiers) {
  if (id === 'farming') { m.cropGrowthMult += 0.02 * lvl; m.cropValueMult += 0.015 * lvl; }
  else if (id === 'ranching') { m.productValueMult += 0.02 * lvl; m.prodSpeedMult += 0.015 * lvl; }
  else if (id === 'breeding') { m.breedSpeedMult += 0.015 * lvl; m.breedCapBonus += Math.floor(lvl / 5); }
  else if (id === 'fishing') { m.fishValueMult += 0.02 * lvl; m.fishLuckMult += 0.03 * lvl; }
  else if (id === 'foraging') { m.forageValueMult += 0.02 * lvl; m.forageLuckMult += 0.03 * lvl; }
}
// Each mastery star adds a small bonus to the skill's primary value lever.
function masteryBonus(id: SkillId, stars: number, m: Modifiers) {
  const v = 0.03 * stars;
  if (id === 'farming') m.cropValueMult += v;
  else if (id === 'ranching') m.productValueMult += v;
  else if (id === 'breeding') m.breedSpeedMult += v;
  else if (id === 'fishing') m.fishValueMult += v;
  else if (id === 'foraging') m.forageValueMult += v;
}
function mergePerk(m: Modifiers, p: Perk) {
  const rec = m as unknown as Record<string, number | boolean>;
  for (const [k, val] of Object.entries(p.mods)) {
    if (typeof val === 'boolean') rec[k] = val;
    else (rec[k] as number) += val as number;
  }
}

// Aggregate everything a player currently has into one Modifiers bag.
export function activeModifiers(skills: Skills, perks: ChosenPerks): Modifiers {
  const m = baseModifiers();
  for (const s of SKILLS) {
    const info = skillInfo(skills[s.id] ?? 0);
    basePassive(s.id, info.level, m);
    for (const ms of s.milestones) {
      if (info.level < ms.level) continue;
      const chosen = perks[`${s.id}:${ms.level}`];
      const perk = chosen === ms.a.id ? ms.a : chosen === ms.b.id ? ms.b : null;
      if (perk) mergePerk(m, perk);
    }
    if (info.level >= MAX_SKILL_LEVEL) mergePerk(m, s.capstone);
    if (info.mastery > 0) masteryBonus(s.id, info.mastery, m);
  }
  return m;
}

// Milestones the player has unlocked (level reached) but not yet chosen.
export function pendingChoices(skills: Skills, perks: ChosenPerks): { skill: SkillId; level: number }[] {
  const out: { skill: SkillId; level: number }[] = [];
  for (const s of SKILLS) {
    const lvl = skillLevel(skills[s.id] ?? 0);
    for (const ms of s.milestones) {
      if (lvl >= ms.level && !perks[`${s.id}:${ms.level}`]) out.push({ skill: s.id, level: ms.level });
    }
  }
  return out;
}
