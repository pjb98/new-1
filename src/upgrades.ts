import { RunMods } from "./mods";

/**
 * In-run level-up picks. After each round you choose 1 of 3, and the effects
 * stack across the run — this is what makes one run diverge from the next (the
 * build fantasy). Upgrades repeat/stack, so a run can lean hard into one stat.
 */
export type Tier = "common" | "rare" | "legendary";

export interface RunUpgrade {
  id: string;
  name: string;
  desc: string;
  icon: string; // emoji glyph for quick visual identity
  color: string; // accent color (hex)
  tier: Tier;
  apply: (m: RunMods) => void;
}

export const RUN_UPGRADES: RunUpgrade[] = [
  // ---- common ----
  { id: "dmg", name: "Hollow Points", desc: "+20% damage", icon: "💥", color: "#ff6a4a", tier: "common", apply: (m) => (m.damageMul += 0.2) },
  { id: "rof", name: "Trigger Finger", desc: "+15% fire rate", icon: "🔥", color: "#ffb13a", tier: "common", apply: (m) => (m.fireRateMul += 0.15) },
  { id: "reload", name: "Quick Hands", desc: "+25% reload speed", icon: "🌀", color: "#6ad7ff", tier: "common", apply: (m) => (m.reloadMul += 0.25) },
  { id: "speed", name: "Track Shoes", desc: "+12% move speed", icon: "👟", color: "#7be08a", tier: "common", apply: (m) => (m.moveSpeedMul += 0.12) },
  { id: "hp", name: "Thick Skin", desc: "+25 max HP", icon: "❤️", color: "#ff7a9a", tier: "common", apply: (m) => (m.maxHealthBonus += 25) },
  { id: "crit", name: "Eagle Eye", desc: "+10% crit chance", icon: "🎯", color: "#ffe14a", tier: "common", apply: (m) => (m.critChance += 0.1) },
  { id: "combo", name: "Killing Spree", desc: "Combos last +1s", icon: "⚡", color: "#c792ea", tier: "common", apply: (m) => (m.comboWindowBonus += 1) },
  { id: "luck", name: "Lucky Charm", desc: "+5% loot drop chance", icon: "🍀", color: "#8fd0ff", tier: "common", apply: (m) => (m.dropChance += 0.05) },
  // ---- rare, run-defining ----
  { id: "lifesteal", name: "Vampirism", desc: "Heal 4 HP per kill", icon: "🧛", color: "#ff4a6a", tier: "rare", apply: (m) => (m.lifeSteal += 4) },
  { id: "critdmg", name: "Executioner", desc: "+1.0× crit damage", icon: "☠️", color: "#ffd24a", tier: "rare", apply: (m) => (m.critMul += 1) },
  { id: "berserk", name: "Berserker", desc: "+35% dmg, +20% fire rate", icon: "😡", color: "#ff5a3a", tier: "rare", apply: (m) => { m.damageMul += 0.35; m.fireRateMul += 0.2; } },
  { id: "glasscannon", name: "Glass Cannon", desc: "+50% dmg, +25% crit", icon: "💎", color: "#ff8af0", tier: "rare", apply: (m) => { m.damageMul += 0.5; m.critChance += 0.25; } },
  // ---- behavior upgrades: change HOW you play ----
  { id: "multishot", name: "Split Barrel", desc: "+1 projectile per shot", icon: "🎇", color: "#8fd0ff", tier: "rare", apply: (m) => (m.bonusPellets += 1) },
  { id: "bigbullets", name: "Heavy Rounds", desc: "+40% bullet size", icon: "🔵", color: "#9fb6ff", tier: "common", apply: (m) => (m.bulletScaleMul += 0.4) },
  { id: "pierce", name: "Armor Piercing", desc: "Shots pierce +1 enemy", icon: "🏹", color: "#cbd5e0", tier: "common", apply: (m) => (m.pierceBonus += 1) },
  { id: "ricochet", name: "Ricochet", desc: "Shots bounce to +1 enemy", icon: "🪀", color: "#6ad7ff", tier: "rare", apply: (m) => (m.ricochet += 1) },
  { id: "homing", name: "Smart Rounds", desc: "Bullets curve toward enemies", icon: "🧲", color: "#a0e0ff", tier: "rare", apply: (m) => (m.homing = 1) },
  { id: "explosive", name: "Explosive Rounds", desc: "Bullets explode on impact (+radius)", icon: "💣", color: "#ff8a3a", tier: "rare", apply: (m) => (m.explosiveRadius += 1.4) },
  { id: "detonate", name: "Chain Reaction", desc: "Kills make zombies explode", icon: "🧨", color: "#ff6a4a", tier: "rare", apply: (m) => (m.detonate += 2.2) },
  { id: "chain", name: "Chain Lightning", desc: "Hits arc to +1 nearby enemy", icon: "⚡", color: "#9fe8ff", tier: "rare", apply: (m) => (m.chainCount += 1) },
  { id: "frost", name: "Frostbite", desc: "Hits slow zombies by 35%", icon: "❄️", color: "#bfe8ff", tier: "common", apply: (m) => (m.cryoSlow = Math.max(m.cryoSlow, 0.35)) },
  { id: "thorns", name: "Spiked Armor", desc: "Touching zombies take 30 dmg", icon: "🌵", color: "#7be08a", tier: "common", apply: (m) => (m.thorns += 30) },
  { id: "dodge", name: "Evasion", desc: "+15% chance to dodge a hit", icon: "💨", color: "#cfe8ff", tier: "common", apply: (m) => (m.dodge = Math.min(0.6, m.dodge + 0.15)) },
  { id: "healnova", name: "Bloom", desc: "Heal +14 HP every 10 kills", icon: "🌸", color: "#ff9ec4", tier: "common", apply: (m) => (m.healNova += 14) },
  { id: "adrenaline", name: "Adrenaline", desc: "Fire faster the lower your HP", icon: "🔥", color: "#ff7a5a", tier: "rare", apply: (m) => (m.adrenaline = 1) },

  // ---- active↔idle cross-coupling: the active and idle economies feed each other ----
  // Effects are MULTIPLICATIVE but capped in config (SYNERGY) so they never run away.
  { id: "warbonds", name: "War Bonds", desc: "Banker pets earn more gold the higher your Damage is", icon: "🏦", color: "#ffd24a", tier: "rare", apply: (m) => (m.bankerFromWeapon += 1) },
  { id: "tithe", name: "Blood Tithe", desc: "More banker pets = more Essence earned per run", icon: "💠", color: "#a0e0ff", tier: "rare", apply: (m) => (m.essenceFromBankers += 1) },
  { id: "syndicate", name: "Syndicate", desc: "Both: bankers earn more from Damage, and more Essence per run", icon: "🤝", color: "#ffcf7a", tier: "legendary", apply: (m) => { m.bankerFromWeapon += 1; m.essenceFromBankers += 1; } },

  // ---- legendary: rare jackpots ----
  { id: "apex", name: "Apex Predator", desc: "+60% dmg, +30% fire rate, +5 lifesteal", icon: "👑", color: "#ffcf3a", tier: "legendary", apply: (m) => { m.damageMul += 0.6; m.fireRateMul += 0.3; m.lifeSteal += 5; } },
  { id: "jackpot", name: "Jackpot", desc: "+20% loot, +1.5× crit dmg, +15% crit", icon: "🎰", color: "#ffd24a", tier: "legendary", apply: (m) => { m.dropChance += 0.2; m.critMul += 1.5; m.critChance += 0.15; } },
  { id: "juggernaut", name: "Juggernaut", desc: "+80 max HP, +20% dmg, +20% speed", icon: "🛡️", color: "#7be0c0", tier: "legendary", apply: (m) => { m.maxHealthBonus += 80; m.damageMul += 0.2; m.moveSpeedMul += 0.2; } },
  { id: "stormcaller", name: "Stormcaller", desc: "Chain +1, ricochet +1, +20% fire rate", icon: "🌩️", color: "#9fe8ff", tier: "legendary", apply: (m) => { m.chainCount += 1; m.ricochet += 1; m.fireRateMul += 0.2; } },
  { id: "swarmlord", name: "Swarm Lord", desc: "+2 projectiles, homing, +1 pierce", icon: "🐝", color: "#ffd24a", tier: "legendary", apply: (m) => { m.bonusPellets += 2; m.homing = 1; m.pierceBonus += 1; } },

  // ---- more behavior cards (expand the pool so it doesn't run dry by R8) ----
  { id: "overkill", name: "Overkill", desc: "Big hits over-penetrate (+1 pierce, +15% dmg)", icon: "🔩", color: "#cbd5e0", tier: "common", apply: (m) => { m.pierceBonus += 1; m.damageMul += 0.15; } },
  { id: "deadeye", name: "Deadeye", desc: "+15% crit chance", icon: "🎯", color: "#ffe14a", tier: "common", apply: (m) => (m.critChance += 0.15) },
  { id: "fanfire", name: "Fan Fire", desc: "+25% fire rate", icon: "🔥", color: "#ffb13a", tier: "common", apply: (m) => (m.fireRateMul += 0.25) },
  { id: "bulwark", name: "Bulwark", desc: "+45 max HP, +8% dodge", icon: "🛡️", color: "#7be0c0", tier: "common", apply: (m) => { m.maxHealthBonus += 45; m.dodge = Math.min(0.6, m.dodge + 0.08); } },
  { id: "deepfreeze", name: "Deep Freeze", desc: "Stronger slow (to 60%) + chain +1", icon: "🧊", color: "#bfe8ff", tier: "rare", apply: (m) => { m.cryoSlow = Math.min(0.6, m.cryoSlow + 0.2); m.chainCount += 1; } },
  { id: "napalm", name: "Napalm", desc: "Bigger explosions + chain reaction", icon: "🔥", color: "#ff7a3a", tier: "rare", apply: (m) => { m.explosiveRadius += 1.0; m.detonate += 1.4; } },
  { id: "bloodfrenzy", name: "Blood Frenzy", desc: "+6 lifesteal, +15% fire rate", icon: "🩸", color: "#ff4a6a", tier: "rare", apply: (m) => { m.lifeSteal += 6; m.fireRateMul += 0.15; } },
  { id: "magnetfield", name: "Magnet Field", desc: "+12% loot, combos last +1.5s", icon: "🧲", color: "#8fd0ff", tier: "common", apply: (m) => { m.dropChance += 0.12; m.comboWindowBonus += 1.5; } },
  { id: "titan", name: "Titan", desc: "+120 max HP, +25% dmg", icon: "🦾", color: "#7be0c0", tier: "rare", apply: (m) => { m.maxHealthBonus += 120; m.damageMul += 0.25; } },
  { id: "annihilator", name: "Annihilator", desc: "+80% dmg, +40% crit dmg, +1 pierce", icon: "☄️", color: "#ff5a3a", tier: "legendary", apply: (m) => { m.damageMul += 0.8; m.critMul += 0.4; m.pierceBonus += 1; } },
  { id: "tempest", name: "Tempest", desc: "+3 projectiles, +30% fire rate", icon: "🌪️", color: "#9fe8ff", tier: "legendary", apply: (m) => { m.bonusPellets += 3; m.fireRateMul += 0.3; } },
  { id: "vampirelord", name: "Vampire Lord", desc: "+10 lifesteal, +25 heal nova, +40 HP", icon: "🧛", color: "#ff4a6a", tier: "legendary", apply: (m) => { m.lifeSteal += 10; m.healNova += 25; m.maxHealthBonus += 40; } },

  // ---- build-defining "transform" picks: change the run's whole identity ----
  // The flag marks the build; the bumps below give the effect a guaranteed FLOOR
  // (re-asserted at pick-time in main.ts applyUpgrade, idempotent). Kept inside
  // the late-game envelope: +1 pierce / modest splash / +1 chain, not a stack.
  { id: "tf_apex", name: "Apex Munitions", desc: "TRANSFORM: every shot pierces AND explodes", icon: "💥", color: "#ff7a3a", tier: "legendary", apply: (m) => { m.pierceExplode = 1; m.pierceBonus = Math.max(m.pierceBonus, 1) + 1; m.explosiveRadius = Math.max(m.explosiveRadius, 1.4); } },
  { id: "tf_tesla", name: "Tesla Conversion", desc: "TRANSFORM: crits arc chain-lightning", icon: "⚡", color: "#9fe8ff", tier: "legendary", apply: (m) => { m.critChain = 1; m.critChance = Math.min(1, m.critChance + 0.15); m.chainCount = Math.max(m.chainCount, 1) + 1; } },
];

/**
 * Limit Break: once the player has stacked a lot of cards, the deck still needs
 * to hand out something good every round. These infinite, repeatable micro-buffs
 * keep late-game level-ups rewarding (VS-style) instead of "nothing left".
 */
export const LIMIT_BREAKS: RunUpgrade[] = [
  { id: "lb_dmg", name: "Overload: Power", desc: "+10% damage", icon: "💥", color: "#ff6a4a", tier: "common", apply: (m) => (m.damageMul += 0.1) },
  { id: "lb_rof", name: "Overload: Speed", desc: "+8% fire rate", icon: "🔥", color: "#ffb13a", tier: "common", apply: (m) => (m.fireRateMul += 0.08) },
  { id: "lb_crit", name: "Overload: Focus", desc: "+5% crit + 0.2× crit dmg", icon: "🎯", color: "#ffe14a", tier: "common", apply: (m) => { m.critChance += 0.05; m.critMul += 0.2; } },
  { id: "lb_hp", name: "Overload: Vigor", desc: "+30 max HP + 2 lifesteal", icon: "❤️", color: "#ff7a9a", tier: "common", apply: (m) => { m.maxHealthBonus += 30; m.lifeSteal += 2; } },
  { id: "lb_pierce", name: "Overload: Pierce", desc: "+1 pierce", icon: "🏹", color: "#cbd5e0", tier: "common", apply: (m) => (m.pierceBonus += 1) },
];

const TIER_WEIGHT: Record<Tier, number> = { common: 1, rare: 0.5, legendary: 0.14 };

/**
 * Roll `n` distinct upgrade cards. Past `round` 12, Limit-Break micro-buffs mix
 * into the pool (chance rising with round) so deep runs never offer junk — the
 * deck always has something worth taking.
 */
export function rollUpgrades(n = 3, round = 1): RunUpgrade[] {
  const lbChance = Math.max(0, Math.min(0.6, (round - 12) * 0.06)); // 0 at R12 → 0.6 by R22
  const picks: RunUpgrade[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (picks.length < n && guard++ < 400) {
    if (Math.random() < lbChance) {
      const lb = LIMIT_BREAKS[Math.floor(Math.random() * LIMIT_BREAKS.length)];
      if (!used.has(lb.id)) { used.add(lb.id); picks.push(lb); }
      continue;
    }
    const u = RUN_UPGRADES[Math.floor(Math.random() * RUN_UPGRADES.length)];
    if (used.has(u.id)) continue;
    if (Math.random() > TIER_WEIGHT[u.tier]) continue; // weighted rejection by tier
    used.add(u.id);
    picks.push(u);
  }
  // top up with anything distinct if weighting starved us
  if (picks.length < n) {
    for (const u of [...RUN_UPGRADES, ...LIMIT_BREAKS]) {
      if (picks.length >= n) break;
      if (!used.has(u.id)) { used.add(u.id); picks.push(u); }
    }
  }
  return picks;
}
