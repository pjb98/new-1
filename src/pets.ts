import * as THREE from "three";
import { voxelMaterial, glowMaterial, auraMaterial } from "./palette";
import { PET_STAGES } from "./config";

/**
 * One shared unit (1×1×1) BoxGeometry reused by every voxel `box()` in this
 * file AND by HouseView (house.ts) — each mesh scales it to its size instead
 * of allocating its own BoxGeometry. This is the single biggest avoidable
 * draw-call/allocation source for pets + house parts.
 *
 * LIFETIME: it is a process-wide singleton and must NEVER be disposed — code
 * that frees meshes (disposeObject in house.ts) checks `userData.shared` and
 * skips it, so removing a pet/part never frees the buffer other meshes share.
 */
export const SHARED_UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
SHARED_UNIT_BOX.userData.shared = true;

/**
 * Companion pets bought with gold. Each is a small floating voxel critter that
 * orbits the player, auto-targets the nearest zombie, and fires real bullets
 * through the shared BulletSystem (so all collision / damage / FX come free).
 *
 * Pets are the late-game chaos + the gold sink: stack several and the screen
 * fills with autonomous fire. The roster is deliberately deep (50+) so the
 * idle-simulator loop always has a next thing to chase across six rarities.
 */

export type PetShape =
  | "bee" | "drone" | "dragon" | "ghost" | "turret" | "wisp" | "piggy" | "totem"
  | "slime" | "golem" | "mushroom" | "frog" | "crystal" | "star" | "cat"
  | "eye" | "serpent" | "phoenix" | "ufo" | "orb"
  | "chronos" // Celestial — a clockwork-halo time god (timewarp)
  | "oracle"; // Celestial — an all-seeing eye-of-fate (auto-perk)

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic" | "celestial";

/**
 * Functional "verb" for a combat pet (distinct from the non-combat `role`).
 * Each gives a SMALL, capped on-hit/on-kill behavior in updatePets (not just a
 * damage number) so the roster stops being stat-clones. Pokémon-style roles:
 *  - tank: larger orbit + draws fire (bigger engage range, soaks)
 *  - drainer: heals the player a hair on each kill it lands
 *  - bomber: tiny bonus splash on its bullets
 *  - sniper: longer range + crit-flag on distant targets
 *  - harvester: tiny bonus gold on each kill it lands
 *  - saboteur: applies a brief slow to what it hits
 */
export type CombatRole = "tank" | "drainer" | "bomber" | "sniper" | "harvester" | "saboteur";

/** Per-role tuning. SMALL + capped — see ROLE_BEHAVIOR caps in main.ts/config. */
export const ROLE_LABEL: Record<CombatRole, string> = {
  tank: "Tank", drainer: "Drainer", bomber: "Bomber",
  sniper: "Sniper", harvester: "Harvester", saboteur: "Saboteur",
};
export const ROLE_ICON: Record<CombatRole, string> = {
  tank: "🛡", drainer: "❤", bomber: "💥", sniper: "🎯", harvester: "⛁", saboteur: "🕸",
};

/**
 * Signature special move. Every Epic+ pet has one — a periodic, screen-shaking
 * effect on top of its normal fire. Legendary tiers hit harder/wider and Mythic
 * abilities are deliberately overpowered (near board-clears, fountains of gold).
 */
/**
 * Ability archetype. Slay-the-Spire-style split:
 *  - PAYOFF kinds (nova/volley/chain/meteor/smite/execute/jackpot/obliterate)
 *    are immediate bursts — the classic "spend everything now" moment.
 *  - ENGINE kinds build a STACKING resource each cast that empowers the pet's
 *    own fire (or the squad), so they feel like a slow-burn snowball rather than
 *    a bigger number. Engines stay inside the late-game power envelope via a hard
 *    stack cap + a small per-stack bonus.
 */
export type AbilityKind =
  | "nova" | "volley" | "chain" | "meteor" | "smite" | "execute" | "jackpot" | "obliterate"
  // ── engine archetypes ──
  | "overcharge" // builds charge stacks → +pet damage (capped), discharges a small nova at max
  | "siphon" // builds stacks → +lifesteal & a trickle heal on cast (drain engine)
  | "resonance" // builds stacks → +crit chance/pierce flavor; small shard burst on cast
  // ── celestial signatures ──
  | "timewarp" // OVERDRIVE: the whole game runs at 2x for a few seconds (the Chronomancer)
  | "autoperk"; // ORACLE: auto-grants the best available perk at the end of each round

/** True for the stacking "engine" archetypes. */
export const ENGINE_KINDS: ReadonlySet<AbilityKind> = new Set<AbilityKind>(["overcharge", "siphon", "resonance"]);

export interface PetAbility {
  name: string;
  kind: AbilityKind;
  cd: number; // seconds between activations
  power: number; // base damage (further scaled by pet level + totem buff)
  count?: number; // projectiles / chain jumps / meteor strikes
  radius?: number; // AoE radius
  slow?: number; // 0..1 slow strength applied to caught zombies
  heal?: number; // HP restored to the player on proc
  gold?: number; // bonus gold minted on proc (jackpot)
  frac?: number; // execute: instakill zombies under this HP fraction
  // ── engine archetype fields ──
  perStack?: number; // engine: bonus per stack (damage frac / lifesteal / etc.)
  maxStacks?: number; // engine: hard cap on accumulated stacks
  // ── timewarp field ──
  dur?: number; // timewarp: seconds the 2x overdrive lasts
}

/**
 * Evolution trial. A pet evolves only once it reaches `evolveLevel` AND clears
 * every goal here. Goals are tracked "while equipped" — they accumulate across
 * runs for as long as the pet is in your squad (so it's a journey, not a dump).
 */
export type TrialStat = "kills" | "bosses" | "crits" | "bestRound" | "runs" | "casts";
export interface PetTrialGoal {
  stat: TrialStat;
  goal: number;
  label: string;
}
export interface PetTrial {
  goals: PetTrialGoal[];
}

export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "celestial"];
export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#b8c2cc",
  uncommon: "#6fdc8c",
  rare: "#5aa9ff",
  epic: "#c792ea",
  legendary: "#ffb84a",
  mythic: "#ff5a7a",
  celestial: "#7af7ff", // radiant cyan-white — the one tier above Mythic
};
export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common", uncommon: "Uncommon", rare: "Rare",
  epic: "Epic", legendary: "Legendary", mythic: "Mythic", celestial: "Celestial",
};

export interface PetDef {
  id: string;
  name: string;
  desc: string;
  cost: number; // gold
  color: number;
  /** Secondary tone (belly/accent) — falls back to a darkened color if unset. */
  accent?: number;
  /** Bullet damage, fire interval (s), bullet color/scale, special behavior. */
  damage: number;
  interval: number;
  bulletColor: number;
  bulletScale: number;
  pierce: number;
  splashRadius: number;
  splashDamage: number;
  homing: number;
  /** Visual builder tag. */
  shape: PetShape;
  range: number; // how far it will engage
  rarity?: Rarity;
  /** Non-combat roles. "banker": earns gold over time + on kills nearby.
   *  "buffer": boosts other pets' damage. (default = combat shooter) */
  role?: "banker" | "buffer";
  /** banker: gold per second passively. buffer: +damage fraction to other pets. */
  roleValue?: number;
  /** Functional combat "verb" — drives a small capped on-hit/on-kill behavior in
   *  updatePets (separate from the non-combat `role`). Combat pets only. */
  combatRole?: CombatRole;
  /** At `evolveLevel`, the pet transforms into the `evolvesTo` def (bigger,
   *  stronger model + new behavior). The big idle payoff. */
  evolveLevel?: number;
  evolvesTo?: string;
  /** Signature special (Epic+). Triggered on a cooldown in the game loop. */
  ability?: PetAbility;
  /** Evolution trial (gates `evolvesTo` alongside `evolveLevel`). */
  trial?: PetTrial;
}

type PetInit = Partial<PetDef> &
  Pick<PetDef, "id" | "name" | "desc" | "cost" | "color" | "shape" | "rarity">;

/** Terse factory — fills sensible combat defaults so each entry stays readable. */
function mk(p: PetInit): PetDef {
  return {
    damage: 0,
    interval: 1,
    bulletColor: p.color,
    bulletScale: 1,
    pierce: 0,
    splashRadius: 0,
    splashDamage: 0,
    homing: 0,
    range: 16,
    ...p,
  };
}

/** Evolved pet forms — not buyable directly; a base pet evolves into these. */
export const PET_EVOLUTIONS: PetDef[] = [
  mk({ id: "beebot_evo", name: "Queen Bee", desc: "A royal swarm of stingers", cost: 0, rarity: "rare", color: 0xffcf3a, accent: 0x2a2a2a,
    damage: 22, interval: 0.32, bulletColor: 0xffe14a, bulletScale: 0.7, pierce: 2, homing: 1, shape: "bee", range: 18 }),
  mk({ id: "turret_evo", name: "War Drone", desc: "Twin piercing autocannons", cost: 0, rarity: "rare", color: 0x9fb6ff, accent: 0x2a3450,
    damage: 70, interval: 0.45, bulletColor: 0x9fe8ff, bulletScale: 1.3, pierce: 5, shape: "turret", range: 22 }),
  mk({ id: "ghost_evo", name: "Reaper", desc: "Wide haunting splash", cost: 0, rarity: "rare", color: 0x9a5ad6, accent: 0xf3e6ff,
    damage: 55, interval: 0.7, bulletColor: 0xc792ea, bulletScale: 1.7, pierce: 1, splashRadius: 3.0, splashDamage: 50, homing: 1, shape: "ghost", range: 18 }),
  mk({ id: "dragon_evo", name: "Elder Dragon", desc: "Devastating fireball barrage", cost: 0, rarity: "epic", color: 0xff3a2a, accent: 0xffd24a,
    damage: 140, interval: 0.45, bulletColor: 0xff7a3a, bulletScale: 2.0, pierce: 4, splashRadius: 3.4, splashDamage: 110, homing: 1, shape: "dragon", range: 24 }),
];

export const PETS: PetDef[] = [
  // ───────────────────────── COMMON ─────────────────────────
  mk({ id: "ladybug", name: "Ladybug", desc: "Quick little nibbles", cost: 200, rarity: "common", color: 0xff5a4a, accent: 0x2a2a2a,
    damage: 11, interval: 0.45, bulletColor: 0xff8a6a, bulletScale: 0.55, shape: "bee", range: 14 }),
  mk({ id: "slime_g", name: "Green Slime", desc: "Splatty acid blobs", cost: 250, rarity: "common", color: 0x6fdc8c, accent: 0x3a8a5a,
    damage: 9, interval: 0.6, bulletColor: 0x9bf0b0, bulletScale: 0.7, splashRadius: 1.2, splashDamage: 6, shape: "slime", range: 12 }),
  mk({ id: "pebble", name: "Pebble Pup", desc: "Lobs heavy stones", cost: 280, rarity: "common", color: 0x9a8a78, accent: 0x4a4038,
    damage: 16, interval: 0.9, bulletColor: 0xc8b89a, bulletScale: 0.8, pierce: 1, shape: "golem", range: 12 }),
  mk({ id: "beebot", name: "Bee Buddy", desc: "Fires homing stingers", cost: 300, rarity: "common", color: 0xffd24a, accent: 0x2a2a2a,
    damage: 14, interval: 0.5, bulletColor: 0xffe14a, bulletScale: 0.6, pierce: 1, homing: 1, shape: "bee", range: 16,
    evolveLevel: 10, evolvesTo: "beebot_evo" }),
  mk({ id: "sproutling", name: "Sproutling", desc: "Pelts thorny seeds", cost: 300, rarity: "common", color: 0x8fcf5a, accent: 0xc8a06a,
    damage: 10, interval: 0.55, bulletColor: 0xbfe87a, bulletScale: 0.6, shape: "mushroom", range: 13 }),
  mk({ id: "firefly", name: "Firefly", desc: "Rapid green sparks", cost: 350, rarity: "common", color: 0x9be86a, accent: 0xeaffd6,
    damage: 8, interval: 0.3, bulletColor: 0xcfff8a, bulletScale: 0.45, shape: "wisp", range: 14 }),
  mk({ id: "tadpole", name: "Tadpole", desc: "Spits little bubbles", cost: 380, rarity: "common", color: 0x5ad6b0, accent: 0xd6fff0,
    damage: 11, interval: 0.5, bulletColor: 0x8ff0d6, bulletScale: 0.55, shape: "frog", range: 13 }),
  mk({ id: "batling", name: "Batling", desc: "Homing screech bolts", cost: 400, rarity: "common", color: 0x6a6a8a, accent: 0x2a2a3a,
    damage: 9, interval: 0.5, bulletColor: 0xa0a0d0, bulletScale: 0.5, homing: 1, shape: "ghost", range: 14 }),
  mk({ id: "wisp", name: "Spark Wisp", desc: "Rapid little zaps", cost: 450, rarity: "common", color: 0x6ad7ff, accent: 0xeaffff,
    damage: 10, interval: 0.28, bulletColor: 0x9fe8ff, bulletScale: 0.5, shape: "wisp", range: 15 }),
  mk({ id: "coin_chick", name: "Coin Chick", desc: "Earns a trickle of gold", cost: 500, rarity: "common", color: 0xffe07a, accent: 0xffd6a0,
    shape: "piggy", range: 0, role: "banker", roleValue: 0.8 }),

  // ───────────────────────── UNCOMMON ─────────────────────────
  mk({ id: "piggy", name: "Piggy Bank", desc: "Earns gold while you play", cost: 600, rarity: "uncommon", color: 0xff9ec7, accent: 0xffd6e6,
    shape: "piggy", range: 0, role: "banker", roleValue: 1.2 }),
  mk({ id: "kitling", name: "Kit Cat", desc: "Fast clawing darts", cost: 650, rarity: "uncommon", color: 0xffb87a, accent: 0x4a3a2a,
    damage: 20, interval: 0.45, bulletColor: 0xffd6a0, bulletScale: 0.6, shape: "cat", range: 15 }),
  mk({ id: "turret", name: "Mini Turret", desc: "Heavy piercing rounds", cost: 700, rarity: "uncommon", color: 0x8a98a8, accent: 0x3a4450,
    damage: 40, interval: 0.7, bulletColor: 0xffc06a, bulletScale: 1.1, pierce: 3, shape: "turret", range: 18,
    evolveLevel: 10, evolvesTo: "turret_evo" }),
  mk({ id: "toadstool", name: "Toadstool", desc: "Bursting spore caps", cost: 700, rarity: "uncommon", color: 0xff5a6a, accent: 0xffe0e0,
    damage: 24, interval: 0.7, bulletColor: 0xff8a9a, bulletScale: 0.9, splashRadius: 1.6, splashDamage: 12, shape: "mushroom", range: 14 }),
  mk({ id: "crystalite", name: "Crystalite", desc: "Piercing shards", cost: 750, rarity: "uncommon", color: 0x6ad7ff, accent: 0xeaffff,
    damage: 22, interval: 0.5, bulletColor: 0x9fe8ff, bulletScale: 0.7, pierce: 2, shape: "crystal", range: 16 }),
  mk({ id: "peeper", name: "Peeper", desc: "Homing gaze bolts", cost: 780, rarity: "uncommon", color: 0xff9ec7, accent: 0xfff0f6,
    damage: 28, interval: 0.6, bulletColor: 0xffc0e0, bulletScale: 0.7, homing: 1, shape: "eye", range: 17 }),
  mk({ id: "scout_drone", name: "Scout Drone", desc: "Pierce-tipped bursts", cost: 850, rarity: "uncommon", color: 0x9fb6ff, accent: 0x2a3450,
    damage: 26, interval: 0.55, bulletColor: 0xcfe0ff, bulletScale: 0.8, pierce: 1, shape: "drone", range: 18 }),
  mk({ id: "starlet", name: "Starlet", desc: "Twinkling fast shots", cost: 900, rarity: "uncommon", color: 0xffe14a, accent: 0xfffbd0,
    damage: 18, interval: 0.4, bulletColor: 0xfff080, bulletScale: 0.6, shape: "star", range: 16 }),
  mk({ id: "garden_snake", name: "Garden Snake", desc: "Piercing venom spit", cost: 950, rarity: "uncommon", color: 0x8fd65a, accent: 0x3a6a2a,
    damage: 30, interval: 0.65, bulletColor: 0xbfe87a, bulletScale: 0.8, pierce: 2, shape: "serpent", range: 16 }),
  mk({ id: "emberling", name: "Emberling", desc: "Little fire bursts", cost: 1000, rarity: "uncommon", color: 0xff7a4a, accent: 0xffd24a,
    damage: 30, interval: 0.6, bulletColor: 0xffa05a, bulletScale: 0.9, splashRadius: 1.4, splashDamage: 14, shape: "dragon", range: 16 }),

  // ───────────────────────── RARE ─────────────────────────
  mk({ id: "ghost", name: "Boo Ghost", desc: "Spooky splash orbs", cost: 1200, rarity: "rare", color: 0xc792ea, accent: 0xf3e6ff,
    damage: 30, interval: 0.9, bulletColor: 0xc792ea, bulletScale: 1.3, splashRadius: 2.0, splashDamage: 24, homing: 1, shape: "ghost", range: 16,
    evolveLevel: 10, evolvesTo: "ghost_evo" }),
  mk({ id: "sapphire_shard", name: "Sapphire Shard", desc: "Deep piercing beams", cost: 1500, rarity: "rare", color: 0x5aa9ff, accent: 0xeaf4ff,
    damage: 55, interval: 0.55, bulletColor: 0x9fd0ff, bulletScale: 0.9, pierce: 3, shape: "crystal", range: 18 }),
  mk({ id: "dragon", name: "Baby Dragon", desc: "Spits explosive fireballs", cost: 1600, rarity: "rare", color: 0xff5a3a, accent: 0xffd24a,
    damage: 70, interval: 0.6, bulletColor: 0xff7a3a, bulletScale: 1.5, pierce: 2, splashRadius: 2.6, splashDamage: 60, homing: 1, shape: "dragon", range: 20,
    evolveLevel: 10, evolvesTo: "dragon_evo" }),
  mk({ id: "shadow_cat", name: "Shadow Cat", desc: "Blistering shadow claws", cost: 1700, rarity: "rare", color: 0x7a6aff, accent: 0x1a1430,
    damage: 50, interval: 0.4, bulletColor: 0xb0a0ff, bulletScale: 0.7, pierce: 1, shape: "cat", range: 17 }),
  mk({ id: "stone_golem", name: "Stone Golem", desc: "Crushing boulder slams", cost: 1800, rarity: "rare", color: 0x8a98a8, accent: 0x3a4450,
    damage: 80, interval: 1.0, bulletColor: 0xc8d0d8, bulletScale: 1.3, pierce: 2, splashRadius: 1.8, splashDamage: 30, shape: "golem", range: 14 }),
  mk({ id: "lil_saucer", name: "Lil' Saucer", desc: "Homing plasma pings", cost: 2000, rarity: "rare", color: 0x9fe8ff, accent: 0x3a4450,
    damage: 40, interval: 0.45, bulletColor: 0xeaffff, bulletScale: 0.7, homing: 1, shape: "ufo", range: 20 }),
  mk({ id: "money_toad", name: "Money Toad", desc: "Burps up steady gold", cost: 2000, rarity: "rare", color: 0x6fdc8c, accent: 0xffd24a,
    shape: "frog", range: 0, role: "banker", roleValue: 2.4 }),
  mk({ id: "phoenix_chick", name: "Phoenix Chick", desc: "Piercing ember feathers", cost: 2200, rarity: "rare", color: 0xff7a3a, accent: 0xffd24a,
    damage: 45, interval: 0.5, bulletColor: 0xffb05a, bulletScale: 0.8, pierce: 2, shape: "phoenix", range: 18 }),
  mk({ id: "nova_star", name: "Nova Star", desc: "Bursting starlight", cost: 2400, rarity: "rare", color: 0xffd24a, accent: 0xfffbd0,
    damage: 48, interval: 0.45, bulletColor: 0xfff080, bulletScale: 0.9, splashRadius: 1.8, splashDamage: 22, shape: "star", range: 18 }),
  mk({ id: "totem", name: "Power Totem", desc: "+25% damage to your other pets", cost: 2600, rarity: "rare", color: 0x7be0c0, accent: 0xffd24a,
    shape: "totem", range: 0, role: "buffer", roleValue: 0.25 }),

  // ───────────────────────── EPIC ─────────────────────────
  mk({ id: "specter", name: "Specter", desc: "Wide haunting splash", cost: 3500, rarity: "epic", color: 0x9a5ad6, accent: 0xf3e6ff,
    damage: 90, interval: 0.7, bulletColor: 0xc792ea, bulletScale: 1.5, splashRadius: 2.6, splashDamage: 60, homing: 1, shape: "ghost", range: 18 }),
  mk({ id: "thunder_orb", name: "Thunder Orb", desc: "Machine-gun lightning", cost: 3800, rarity: "epic", color: 0x9fe8ff, accent: 0xffffff,
    damage: 70, interval: 0.3, bulletColor: 0xeaffff, bulletScale: 0.7, pierce: 2, shape: "orb", range: 18 }),
  mk({ id: "inferno_drake", name: "Inferno Drake", desc: "Roaring fireball storm", cost: 4000, rarity: "epic", color: 0xff3a2a, accent: 0xffd24a,
    damage: 95, interval: 0.55, bulletColor: 0xff7a3a, bulletScale: 1.7, pierce: 3, splashRadius: 3.0, splashDamage: 72, homing: 1, shape: "dragon", range: 22 }), // dmg 120→95, splash 90→72
  mk({ id: "prism_totem", name: "Prism Totem", desc: "+45% damage to your other pets", cost: 4200, rarity: "epic", color: 0xc792ea, accent: 0xffd24a,
    shape: "totem", range: 0, role: "buffer", roleValue: 0.45 }),
  mk({ id: "heavy_turret", name: "Heavy Turret", desc: "Armor-piercing shells", cost: 4500, rarity: "epic", color: 0x7a8aa8, accent: 0x2a3450,
    damage: 105, interval: 0.7, bulletColor: 0xffc06a, bulletScale: 1.4, pierce: 5, shape: "turret", range: 22 }), // dmg 130→105
  mk({ id: "void_eye", name: "Void Eye", desc: "Homing void lances", cost: 4800, rarity: "epic", color: 0x9a5ad6, accent: 0x1a1030,
    damage: 100, interval: 0.6, bulletColor: 0xc0a0ff, bulletScale: 1.0, homing: 1, splashRadius: 2.0, splashDamage: 40, shape: "eye", range: 20 }),
  mk({ id: "golden_piggy", name: "Golden Piggy", desc: "Mints serious gold", cost: 5000, rarity: "epic", color: 0xffd24a, accent: 0xfff0b0,
    shape: "piggy", range: 0, role: "banker", roleValue: 5 }),
  mk({ id: "seraph_star", name: "Seraph Star", desc: "Holy starlight nova", cost: 5200, rarity: "epic", color: 0xffffff, accent: 0xffe14a,
    damage: 120, interval: 0.45, bulletColor: 0xfffbd0, bulletScale: 1.2, splashRadius: 2.2, splashDamage: 55, shape: "star", range: 20 }),
  mk({ id: "crystal_wyrm", name: "Crystal Wyrm", desc: "Shattering shard breath", cost: 5500, rarity: "epic", color: 0x6ad7ff, accent: 0xeaffff,
    damage: 120, interval: 0.6, bulletColor: 0x9fe8ff, bulletScale: 1.6, pierce: 4, splashRadius: 2.6, splashDamage: 64, homing: 1, shape: "dragon", range: 22 }), // dmg 150→120, splash 80→64
  mk({ id: "solar_phoenix", name: "Solar Phoenix", desc: "Blazing rebirth flares", cost: 6000, rarity: "epic", color: 0xffb84a, accent: 0xff5a3a,
    damage: 140, interval: 0.5, bulletColor: 0xffd24a, bulletScale: 1.3, pierce: 3, splashRadius: 2.4, splashDamage: 70, shape: "phoenix", range: 20 }),

  // ───────────────────────── LEGENDARY ─────────────────────────
  // NOTE: top-end shooter base damage trimmed ~25-30% this pass (legendary/mythic/
  // celestial were the pet-snowball offenders). They're still the strongest pets by
  // a wide margin — just not "delete the whole horde" strong with a softened level mul.
  mk({ id: "reaper_lord", name: "Reaper Lord", desc: "Soul-harvest splash", cost: 8500, rarity: "legendary", color: 0x7a3aff, accent: 0xf3e6ff,
    damage: 160, interval: 0.65, bulletColor: 0xc0a0ff, bulletScale: 1.9, splashRadius: 3.4, splashDamage: 100, homing: 1, shape: "ghost", range: 22 }), // dmg 220→160, splash 140→100
  mk({ id: "celestial_dragon", name: "Celestial Dragon", desc: "Starfire devastation", cost: 9000, rarity: "legendary", color: 0x9fe8ff, accent: 0xffd24a,
    damage: 190, interval: 0.55, bulletColor: 0xeaffff, bulletScale: 1.9, pierce: 5, splashRadius: 3.2, splashDamage: 115, homing: 1, shape: "dragon", range: 24 }), // dmg 260→190, splash 160→115
  mk({ id: "divine_totem", name: "Divine Totem", desc: "+70% damage to your other pets", cost: 9500, rarity: "legendary", color: 0xffffff, accent: 0xffd24a,
    shape: "totem", range: 0, role: "buffer", roleValue: 0.7 }),
  mk({ id: "omni_cannon", name: "Omni Cannon", desc: "Ridiculous pierce barrage", cost: 10000, rarity: "legendary", color: 0xffd24a, accent: 0x2a3450,
    damage: 230, interval: 0.6, bulletColor: 0xfff080, bulletScale: 1.8, pierce: 8, shape: "turret", range: 26 }), // dmg 320→230
  mk({ id: "galaxy_orb", name: "Galaxy Orb", desc: "Hyper-rapid star bolts", cost: 11000, rarity: "legendary", color: 0xc792ea, accent: 0xffffff,
    damage: 145, interval: 0.28, bulletColor: 0xeaccff, bulletScale: 1.1, pierce: 4, splashRadius: 2.0, splashDamage: 60, homing: 1, shape: "orb", range: 22 }), // dmg 200→145, splash 80→60
  mk({ id: "fortune_dragon", name: "Fortune Dragon", desc: "Hoards gold by the second", cost: 12000, rarity: "legendary", color: 0xffd24a, accent: 0xff5a3a,
    shape: "dragon", range: 0, role: "banker", roleValue: 9 }),
  mk({ id: "eclipse_phoenix", name: "Eclipse Phoenix", desc: "Apocalyptic firestorm", cost: 14000, rarity: "legendary", color: 0xff5a7a, accent: 0xffd24a,
    damage: 245, interval: 0.5, bulletColor: 0xff8aa0, bulletScale: 1.7, pierce: 5, splashRadius: 3.0, splashDamage: 130, homing: 1, shape: "phoenix", range: 24 }), // dmg 340→245, splash 180→130

  // ───────────────────────── MYTHIC ─────────────────────────
  mk({ id: "cosmic_serpent", name: "Cosmic Serpent", desc: "Ten-pierce cosmic venom", cost: 22000, rarity: "mythic", color: 0x7a3aff, accent: 0x9fe8ff,
    damage: 360, interval: 0.5, bulletColor: 0xc0a0ff, bulletScale: 1.8, pierce: 10, splashRadius: 2.6, splashDamage: 145, homing: 1, shape: "serpent", range: 26 }), // dmg 500→360, splash 200→145
  mk({ id: "midas_golem", name: "Midas Golem", desc: "Turns the carnage to gold", cost: 26000, rarity: "mythic", color: 0xffd24a, accent: 0xfff0b0,
    shape: "golem", range: 0, role: "banker", roleValue: 20 }),
  mk({ id: "void_sovereign", name: "Void Sovereign", desc: "Reality-ending fireballs", cost: 30000, rarity: "mythic", color: 0x3a1a5a, accent: 0xff3aff,
    damage: 560, interval: 0.5, bulletColor: 0xff3aff, bulletScale: 2.2, pierce: 8, splashRadius: 4.0, splashDamage: 280, homing: 1, shape: "dragon", range: 28 }), // dmg 800→560, splash 400→280

  // ─────────────────────── ✦ CELESTIAL ✦ ───────────────────────
  // The single pet above Mythic. Its signature bends time itself: OVERDRIVE
  // runs the whole game at 2x for a few seconds. Radiant, one-of-a-kind.
  mk({ id: "chronos", name: "Chronos, the Eternal", desc: "Bends time — the whole game runs at 2× speed while equipped", cost: 0, rarity: "celestial", color: 0x9af7ff, accent: 0xfff6c8,
    damage: 430, interval: 0.32, bulletColor: 0xeaffff, bulletScale: 1.4, pierce: 6, splashRadius: 2.4, splashDamage: 160, homing: 1, shape: "chronos", range: 30 }), // dmg 600→430, splash 220→160
  mk({ id: "oracle", name: "The Oracle of Fate", desc: "Foresight — auto-grants the BEST perk at the end of every round", cost: 0, rarity: "celestial", color: 0xc89bff, accent: 0xffe89a,
    damage: 400, interval: 0.34, bulletColor: 0xe6ccff, bulletScale: 1.4, pierce: 5, splashRadius: 2.4, splashDamage: 150, homing: 1, shape: "oracle", range: 30 }), // dmg 560→400, splash 210→150
];

/**
 * Signature abilities for every Epic+ pet. Merged onto the defs below so the
 * roster entries stay readable. Power ramps hard by tier — Mythic moves are
 * meant to feel broken (that's the point of grinding to them).
 */
// Engine/payoff split (Slay-the-Spire-style): ~40% of Epic+ abilities are ENGINE
// archetypes (overcharge/siphon/resonance) that build a capped stacking resource
// to empower the pet's fire — distinct FEEL, not bigger numbers. Engine `power`
// is intentionally LOWER (the value is in the snowball, not the cast) so total
// output stays inside the last balance pass's late-game envelope. The rest stay
// PAYOFF bursts. 8 of 20 Epic+ = 40% engine.
const PET_ABILITIES: Record<string, PetAbility> = {
  // ── EPIC ──
  specter: { name: "Soul Nova", kind: "nova", cd: 8, power: 120, count: 10, radius: 1.6 }, // payoff
  thunder_orb: { name: "Overcharge", kind: "overcharge", cd: 4, power: 60, perStack: 0.05, maxStacks: 6, radius: 1.4 }, // ENGINE
  inferno_drake: { name: "Meteor Storm", kind: "meteor", cd: 8, power: 220, count: 5, radius: 2.6 }, // payoff
  prism_totem: { name: "Prism Resonance", kind: "resonance", cd: 5, power: 70, perStack: 0.06, maxStacks: 5, count: 8 }, // ENGINE
  heavy_turret: { name: "Barrage", kind: "volley", cd: 7, power: 130, count: 14 }, // payoff
  void_eye: { name: "Void Siphon", kind: "siphon", cd: 5, power: 90, perStack: 0.05, maxStacks: 5, radius: 3, slow: 0.4 }, // ENGINE
  golden_piggy: { name: "Jackpot", kind: "jackpot", cd: 9, power: 60, count: 8, gold: 250 }, // payoff
  seraph_star: { name: "Starfall", kind: "nova", cd: 8, power: 120, count: 12, heal: 8 }, // payoff
  crystal_wyrm: { name: "Resonant Shards", kind: "resonance", cd: 5, power: 90, perStack: 0.06, maxStacks: 6, count: 10 }, // ENGINE
  solar_phoenix: { name: "Flare Nova", kind: "nova", cd: 7, power: 150, count: 12, radius: 1.8 }, // payoff
  // ── LEGENDARY ──
  reaper_lord: { name: "Soul Siphon", kind: "siphon", cd: 5, power: 160, perStack: 0.06, maxStacks: 6, radius: 4 }, // ENGINE
  celestial_dragon: { name: "Starfire Rain", kind: "meteor", cd: 8, power: 380, count: 9, radius: 3 }, // payoff
  divine_totem: { name: "Judgment", kind: "smite", cd: 9, power: 360, radius: 7, heal: 15 }, // payoff
  omni_cannon: { name: "Mega Barrage", kind: "volley", cd: 8, power: 320, count: 26 }, // payoff
  galaxy_orb: { name: "Stellar Overcharge", kind: "overcharge", cd: 4, power: 130, perStack: 0.05, maxStacks: 7, radius: 1.6 }, // ENGINE
  fortune_dragon: { name: "Gold Rush", kind: "jackpot", cd: 9, power: 200, count: 16, gold: 1200 }, // payoff
  eclipse_phoenix: { name: "Eclipse", kind: "smite", cd: 9, power: 420, radius: 8, slow: 0.4 }, // payoff
  // ── MYTHIC ──
  cosmic_serpent: { name: "Cosmic Resonance", kind: "resonance", cd: 5, power: 220, perStack: 0.06, maxStacks: 8, count: 14, slow: 0.4 }, // ENGINE
  midas_golem: { name: "Midas Touch", kind: "jackpot", cd: 9, power: 600, count: 24, gold: 5000, radius: 9 }, // payoff
  void_sovereign: { name: "Annihilation", kind: "obliterate", cd: 10, power: 1200, radius: 6.5 }, // payoff
  // ── CELESTIAL ──
  chronos: { name: "OVERDRIVE", kind: "timewarp", cd: 999, power: 0 }, // PASSIVE: permanent 2x while in the squad (driven by chronosActive, not a timed cast)
  oracle: { name: "FORESIGHT", kind: "autoperk", cd: 999, power: 0 }, // passive: best perk each round (handled at intermission, not on a timer)
};
for (const p of PETS) {
  const a = PET_ABILITIES[p.id];
  if (a) p.ability = a;
}

/**
 * Combat-role ("verb") map — every COMBAT pet gets one so it plays distinctly,
 * not just by its damage number. Bankers/buffers are non-combat and stay out.
 * Roles are inferred from each pet's fantasy: piercing line-fire = sniper,
 * splash = bomber, homing/eye/ghost = saboteur (debuff), cats/serpents that
 * lifesteal-flavored = drainer, sturdy golems/turrets = tank, gold-tinged
 * shooters = harvester. Evolutions inherit their base pet's role below.
 */
const COMBAT_ROLES: Record<string, CombatRole> = {
  // COMMON
  ladybug: "drainer", pebble: "bomber", beebot: "saboteur", sproutling: "harvester",
  firefly: "sniper", tadpole: "saboteur", batling: "saboteur", wisp: "sniper",
  slime_g: "bomber",
  // UNCOMMON
  kitling: "drainer", turret: "tank", toadstool: "bomber", crystalite: "sniper",
  peeper: "saboteur", scout_drone: "sniper", starlet: "harvester", garden_snake: "drainer",
  emberling: "bomber",
  // RARE
  ghost: "saboteur", sapphire_shard: "sniper", dragon: "bomber", shadow_cat: "drainer",
  stone_golem: "tank", lil_saucer: "saboteur", phoenix_chick: "harvester", nova_star: "bomber",
  // EPIC
  specter: "saboteur", thunder_orb: "sniper", inferno_drake: "bomber", heavy_turret: "tank",
  void_eye: "saboteur", seraph_star: "drainer", crystal_wyrm: "sniper", solar_phoenix: "bomber",
  // LEGENDARY
  reaper_lord: "drainer", celestial_dragon: "bomber", omni_cannon: "tank", galaxy_orb: "sniper",
  eclipse_phoenix: "bomber",
  // MYTHIC
  cosmic_serpent: "saboteur", void_sovereign: "bomber",
  // CELESTIAL
  chronos: "sniper", oracle: "sniper",
};
for (const p of PETS) {
  const r = COMBAT_ROLES[p.id];
  if (r) p.combatRole = r;
}
// Hand-authored early evolutions inherit their base pet's combat role.
for (const evo of PET_EVOLUTIONS) {
  const baseId = evo.id.replace(/_evo$/, "");
  const r = COMBAT_ROLES[baseId];
  if (r && !evo.combatRole) evo.combatRole = r;
}

// ─────────────────────────── Evolution trials ───────────────────────────
// The 4 early-game evolvers (already have bespoke evolved forms + evolveLevel)
// get hand-authored trials. Every Epic+ pet gains a generated evolved form
// ("ascended"), an evolveLevel, and a trial themed around its signature move.

function g(stat: TrialStat, goal: number, label: string): PetTrialGoal {
  return { stat, goal, label };
}

const FIXED_TRIALS: Record<string, PetTrial> = {
  beebot: { goals: [g("kills", 600, "Zombies stung"), g("bestRound", 8, "Reach round 8")] },
  turret: { goals: [g("kills", 800, "Zombies pierced"), g("bestRound", 9, "Reach round 9")] },
  ghost: { goals: [g("kills", 700, "Souls reaped"), g("bosses", 1, "Slay a boss")] },
  dragon: { goals: [g("kills", 1000, "Burned to ash"), g("bosses", 2, "Slay 2 bosses")] },
};

/** Build a themed trial for an Epic+ ability pet (or fall back to fixed ones). */
function makeTrial(def: PetDef): PetTrial {
  if (FIXED_TRIALS[def.id]) return FIXED_TRIALS[def.id];
  const tiers = { epic: { k: 1500, c: 40 }, legendary: { k: 3000, c: 80 }, mythic: { k: 6000, c: 150 } } as const;
  const t = tiers[(def.rarity as "epic" | "legendary" | "mythic") ?? "epic"] ?? tiers.epic;
  const abName = def.ability?.name ?? "its power";
  return { goals: [g("casts", t.c, `Cast ${abName}`), g("kills", t.k, "Zombies slain together")] };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Derive a stronger "ascended" evolved form from a base pet. */
function ascend(base: PetDef, name: string, color: number, accent?: number): PetDef {
  const ab = base.ability;
  return {
    ...base,
    id: base.id + "_evo",
    name,
    desc: "Ascended " + base.name,
    cost: 0,
    color,
    accent: accent ?? base.accent,
    damage: Math.round(base.damage * 1.7),
    interval: r2(base.interval * 0.85),
    bulletScale: r2(base.bulletScale * 1.2),
    pierce: base.pierce + 2,
    splashRadius: base.splashRadius ? r2(base.splashRadius * 1.2) : 0,
    splashDamage: Math.round(base.splashDamage * 1.7),
    roleValue: base.roleValue !== undefined ? r2(base.roleValue * 1.8) : undefined,
    range: base.range > 0 ? base.range + 2 : 0,
    evolveLevel: undefined,
    evolvesTo: undefined,
    trial: undefined,
    ability: ab
      ? {
          ...ab,
          name: ab.name + "+",
          power: Math.round(ab.power * 1.6),
          count: ab.count !== undefined ? Math.round(ab.count * 1.4) : undefined,
          cd: Math.max(3, r2(ab.cd * 0.8)),
          gold: ab.gold !== undefined ? Math.round(ab.gold * 1.8) : undefined,
          radius: ab.radius !== undefined ? r2(ab.radius * 1.2) : undefined,
        }
      : undefined,
  };
}

// [evolvedName, evolvedColor, evolvedAccent?] for each Epic+ pet.
const ASCENSIONS: Record<string, [string, number, number?]> = {
  // EPIC
  specter: ["Wraith King", 0x7a3aff, 0xf3e6ff],
  thunder_orb: ["Storm Core", 0xeaffff, 0x9fe8ff],
  inferno_drake: ["Cinder Tyrant", 0xff2a1a, 0xffd24a],
  prism_totem: ["Spectrum Totem", 0xff7af0],
  heavy_turret: ["Siege Turret", 0xaab8d0, 0x2a3450],
  void_eye: ["Abyss Eye", 0x7a2ad6, 0x1a1030],
  golden_piggy: ["Diamond Piggy", 0xeaffff, 0xfff0b0],
  seraph_star: ["Archseraph", 0xffffff, 0xffe14a],
  crystal_wyrm: ["Prism Wyrm", 0x8af0ff, 0xeaffff],
  solar_phoenix: ["Sunflare Phoenix", 0xffd24a, 0xff5a3a],
  // LEGENDARY
  reaper_lord: ["Death Sovereign", 0x9a3aff, 0xf3e6ff],
  celestial_dragon: ["Astral Dragon", 0xbfeaff, 0xffd24a],
  divine_totem: ["Celestial Totem", 0xffffff, 0xffe14a],
  omni_cannon: ["Apex Cannon", 0xffe07a, 0x2a3450],
  galaxy_orb: ["Nebula Orb", 0xe0a0ff, 0xffffff],
  fortune_dragon: ["Dragon of Avarice", 0xffe07a, 0xff5a3a],
  eclipse_phoenix: ["Twilight Phoenix", 0xff5a7a, 0xffd24a],
  // MYTHIC
  cosmic_serpent: ["Worldeater Serpent", 0x9a5aff, 0x9fe8ff],
  midas_golem: ["Aurum Colossus", 0xfff0a0, 0xfff8d0],
  void_sovereign: ["Null Emperor", 0x1a0a3a, 0xff3aff],
};

for (const [id, meta] of Object.entries(ASCENSIONS)) {
  const base = PETS.find((p) => p.id === id);
  if (!base) continue;
  const evo = ascend(base, meta[0], meta[1], meta[2]);
  PET_EVOLUTIONS.push(evo);
  base.evolvesTo = evo.id;
  base.evolveLevel = 12; // Epic+ evolve a touch later than the early pets
}
// Attach trials to every evolvable pet (early 4 + all Epic+).
for (const p of PETS) {
  if (p.evolvesTo) p.trial = makeTrial(p);
}

/** True if `prog` clears every goal of `def`'s trial (or there is no trial). */
export function isTrialComplete(def: PetDef, prog: Record<string, number> | undefined): boolean {
  if (!def.trial) return true;
  return def.trial.goals.every((go) => (prog?.[go.stat] ?? 0) >= go.goal);
}

export function findPet(id: string): PetDef | undefined {
  return PETS.find((p) => p.id === id);
}
export function findAnyPet(id: string): PetDef | undefined {
  return PETS.find((p) => p.id === id) ?? PET_EVOLUTIONS.find((p) => p.id === id);
}

/** Gold cost to take a pet from `level` to `level+1` (escalating).
 *  Flatter geometric base (1.22) keeps early levels cheap and stops Mythic L12
 *  from hitting ~1M gold; past `soft` the curve switches to a gentler linear
 *  ramp so the deep levels stay reachable in an idle loop (soft level cap ~10). */
export function petLevelCost(def: PetDef, level: number): number {
  const soft = 10;
  const base = def.cost * 0.5;
  if (level <= soft) return Math.round(base * Math.pow(1.22, level - 1));
  // beyond the soft cap, grow linearly off the level-`soft` cost (no more compounding)
  const at = base * Math.pow(1.22, soft - 1);
  return Math.round(at * (1 + (level - soft) * 0.5));
}

/**
 * Damage multiplier from a pet's level. Was an UNBOUNDED +18%/level (L30 ≈ 6.2×,
 * L50 ≈ 9.8×) which — stacked with petStageMul, the totem buffCap and the player's
 * own Damage tree — let a leveled squad insta-kill the whole late-game horde.
 *
 * Now: +11%/level up to a SOFT CAP (level 12, ≈2.2×), then steep diminishing
 * returns past it (each extra level adds ~3.3% of the soft-cap value, not a fresh
 * +11% of base). A maxed pet lands around 3× instead of 6-10×, so pets stay strong
 * SUPPORT (~a third of your DPS) without being the whole army.
 */
export function petDamageMul(level: number): number {
  const soft = 12;
  const perLevel = 0.11;
  if (level <= soft) return 1 + (level - 1) * perLevel;
  const atSoft = 1 + (soft - 1) * perLevel; // ≈2.21 at the soft cap
  return atSoft + (level - soft) * perLevel * 0.3; // diminishing past the cap
}

/**
 * Combat XP needed to advance from `level` to `level+1`. Pets earn XP by
 * FIGHTING in your squad (every squad kill drips XP to each member), so they
 * "raise" through play; gold-leveling is just an optional fast-track on top.
 * Curve: cheap early (a fresh pet shoots up the first few levels — that raising
 * dopamine) then compounds, so late levels still take a real grind even when the
 * late-game horde feeds hundreds of kills a round.
 */
export function petXpForLevel(level: number): number {
  return Math.round(6 * Math.pow(1.16, Math.max(1, level) - 1));
}

/** Evolution stage (0-based) a pet is at for a given level. */
export function petStage(level: number): number {
  let s = 0;
  for (let i = 0; i < PET_STAGES.levels.length; i++) if (level >= PET_STAGES.levels[i]) s = i;
  return s;
}
/** Damage multiplier from the evolution stage (the per-stage stat jump). */
export function petStageMul(level: number): number {
  return 1 + petStage(level) * PET_STAGES.damagePerStage;
}
/** Stage label ("", "Evolved", "Ascended") for the HUD. */
export function petStageName(level: number): string {
  return PET_STAGES.names[petStage(level)] ?? "";
}
/** Fire-rate (interval) multiplier — pets fire faster as they level (caps). */
export function petIntervalMul(level: number): number {
  return Math.max(0.5, 1 - (level - 1) * 0.04);
}

/** Darken a hex color by `f` (0..1). */
function darken(c: number, f: number): number {
  const r = ((c >> 16) & 255) * (1 - f);
  const g = ((c >> 8) & 255) * (1 - f);
  const b = (c & 255) * (1 - f);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** A live pet orbiting the player. */
export class Pet {
  readonly group = new THREE.Group();
  private body = new THREE.Group(); // animated inner body (bob/breathe/recoil)
  private wingL?: THREE.Mesh;
  private wingR?: THREE.Mesh;
  private aura?: THREE.Mesh; // pulsing glow (wisp/ghost)
  private muzzle?: THREE.Mesh; // fire-flash node
  private halo?: THREE.Group; // counter-rotating clockwork rings (Chronos)
  private halo2?: THREE.Group;
  private orbiters?: THREE.Group; // shape-specific orbiting bits (crystal shards, eye runes, etc.)
  private orbiters2?: THREE.Group; // a second, counter-spinning orbit ring (richer shapes)
  private cd: number;
  private bob: number;
  private flap = 0;
  private recoil = 0; // 0..1, decays — pulls the body back when firing
  private flashLife = 0;
  private abilityTimer = 0; // counts down to the next signature-ability proc
  level: number;
  private baseScale = 0.7;
  /** Engine-ability stacks (overcharge/siphon/resonance). Grow on each cast,
   *  capped by ability.maxStacks; empower the pet's normal fire. Decays slowly
   *  so the snowball is real but not permanent. */
  engineStacks = 0;
  /** Tanks orbit a touch wider (they "draw fire" out front of the squad). */
  private readonly orbitScale: number;
  /** Cosmetic shiny/chroma variant (purely visual — sparkle + hue cycle). */
  readonly shiny: boolean;
  private shinyMesh?: THREE.Mesh; // extra sparkle node, shiny only
  private shinyT = 0;
  private stageCrown?: THREE.Group; // crown ring sub-group (spins above the head)
  private stageKit?: THREE.Group; // whole evolution-stage model add-on (wings/horns/etc.)
  private stageWings: THREE.Mesh[] = []; // stage wings (flap in update)
  private stageShards?: THREE.Group; // orbiting power shards (top stage)
  private stageAura?: THREE.Mesh; // pulsing aura shell (top stage)
  private _crownStage = -1; // stage the current kit was built for (rebuild on change)
  /** Per-pet (cloned) body materials + their base colour, re-tinted per stage. */
  private _stageRecolor: { mat: THREE.MeshStandardMaterial; base: number }[] = [];

  constructor(readonly def: PetDef, private orbitAngle: number, level = 1, shiny = false) {
    this.level = Math.max(1, level);
    this.cd = Math.random() * def.interval;
    // stagger first cast so a fresh squad doesn't all fire abilities in sync
    if (def.ability) this.abilityTimer = def.ability.cd * (0.4 + Math.random() * 0.6);
    this.bob = Math.random() * Math.PI * 2;
    this.flap = Math.random() * Math.PI * 2;
    this.orbitScale = def.combatRole === "tank" ? 1.35 : 1;
    this.shiny = shiny;
    this.group.add(this.body);
    this.build();
    if (this.shiny) this.buildShiny();
    this.applyLevelVisuals();
  }

  /** Shiny cosmetic: a bright sparkle crown above the body, hue-cycled in update.
   *  Reuses SHARED_UNIT_BOX (no new geometry) per the perf-agent's pooling note. */
  private buildShiny() {
    const m = new THREE.Mesh(SHARED_UNIT_BOX, glowMaterial(0xffffff, 1.6));
    m.scale.set(0.12, 0.12, 0.12);
    m.userData.bw = 0.12; m.userData.bh = 0.12; m.userData.bd = 0.12;
    m.position.set(0, 0.5, 0);
    this.body.add(m);
    this.shinyMesh = m;
  }

  /** Pet fires faster + (in main) hits harder as it levels. */
  get interval(): number {
    return this.def.interval * petIntervalMul(this.level);
  }
  get damageMul(): number {
    return petDamageMul(this.level) * petStageMul(this.level);
  }
  /** Current evolution stage (0-based) — drives the crown flourish + stat jump. */
  get stage(): number {
    return petStage(this.level);
  }
  /** Engine archetype: +perStack * stacks to the pet's fire (1 if not an engine).
   *  Capped implicitly because engineStacks is clamped to ability.maxStacks. */
  get engineMul(): number {
    const ab = this.def.ability;
    if (!ab || !ENGINE_KINDS.has(ab.kind) || !ab.perStack) return 1;
    return 1 + this.engineStacks * ab.perStack;
  }

  /** Visible growth: pet gets bigger + glows brighter with level. */
  setLevel(level: number) {
    this.level = Math.max(1, level);
    this.applyLevelVisuals();
  }
  private applyLevelVisuals() {
    // grows ~6%/level up to ~+60%; emissive ramps so high pets glow hot.
    // Chronos (Celestial) is built bigger so it towers over the roster.
    const baseSize = this.def.shape === "chronos" || this.def.shape === "oracle" ? 0.92 : 0.7;
    const stage = petStage(this.level);
    // Evolution stages add a chunk of size on top of the per-level growth, so a
    // stage-up reads instantly, and (re)build the glowing crown for the stage.
    this.baseScale = baseSize * (1 + Math.min(0.6, (this.level - 1) * 0.06)) * (1 + stage * PET_STAGES.scalePerStage);
    this.group.scale.setScalar(this.baseScale);
    this.rebuildStageFlourish(stage);
    // Restyle the whole body per evolution stage with a real COLOUR shift, so an
    // Evolved/Ascended pet reads as a different creature, not just bigger. We
    // rotate the hue + boost saturation/lightness in HSL (a clear, per-pet colour
    // change), then add a gold sheen at the Ascended tier to match its crown.
    for (const r of this._stageRecolor) {
      const c = new THREE.Color(r.base);
      if (stage >= 1) {
        const hsl = { h: 0, s: 0, l: 0 };
        c.getHSL(hsl);
        hsl.h = (hsl.h + (stage >= 2 ? 0.55 : 0.3) + 1) % 1; // rotate around the wheel
        hsl.s = Math.min(1, hsl.s * (stage >= 2 ? 1.5 : 1.3) + 0.12); // richer
        hsl.l = Math.min(0.82, hsl.l + (stage >= 2 ? 0.14 : 0.08)); // brighter
        c.setHSL(hsl.h, hsl.s, hsl.l);
        if (stage >= 2) c.lerp(new THREE.Color(0xffd24a), 0.14); // ascended gold sheen
      }
      r.mat.color.copy(c);
      r.mat.emissive.copy(c);
    }
    const glowBoost = Math.min(1.6, 0.9 + (this.level - 1) * 0.12);
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) {
        m.emissiveIntensity = glowBoost;
      }
    });
  }

  /**
   * (Re)build the evolution-stage MODEL kit — the geometry that makes an evolved
   * pet read as a genuinely different creature, not just a bigger one:
   *   • Stage 1 "Evolved":  energy wings + a dorsal crest + a floating crown.
   *   • Stage 2 "Ascended": grander spread wings, a horned crown, orbiting power
   *     shards, and a pulsing aura shell — all gilded.
   * Built additively on top of the base voxel body (so every pet inherits it),
   * parented to `body` so it scales/breathes with the pet, and rebuilt only when
   * the stage actually changes. All boxes reuse SHARED_UNIT_BOX per the pooling
   * convention; the wings/shards/aura animate in update().
   */
  private rebuildStageFlourish(stage: number) {
    if (stage === this._crownStage) return;
    this._crownStage = stage;
    if (this.stageKit) this.body.remove(this.stageKit);
    this.stageKit = undefined;
    this.stageCrown = undefined;
    this.stageShards = undefined;
    this.stageAura = undefined;
    this.stageWings = [];
    if (stage <= 0) return;
    const kit = new THREE.Group();
    // box helper: encode size in scale (no per-voxel geometry alloc), remember
    // the base size in userData so animations can multiply it.
    const mk = (w: number, h: number, d: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(SHARED_UNIT_BOX, mat);
      m.scale.set(w, h, d);
      m.userData.bw = w; m.userData.bh = h; m.userData.bd = d;
      return m;
    };
    const base = this.def.accent ?? this.def.color;
    const gild = 0xffd24a; // gold for the ascended tier
    const wingCol = stage >= 2 ? 0xffe9a8 : base;
    const crownCol = stage >= 2 ? gild : 0xfff2c0;

    // ── wings: a layered energy pair swept off the back (the headline change) ──
    const wspan = stage >= 2 ? 0.62 : 0.42;
    for (const side of [-1, 1]) {
      const w = mk(wspan, 0.05, 0.46, auraMaterial(wingCol, 0.75));
      w.position.set(side * 0.42, 0.14, -0.12);
      w.userData.side = side;
      kit.add(w);
      this.stageWings.push(w);
      if (stage >= 2) {
        // a second, smaller blade behind the main wing → a fuller spread
        const w2 = mk(wspan * 0.7, 0.05, 0.34, auraMaterial(gild, 0.6));
        w2.position.set(side * 0.5, 0.0, -0.22);
        w2.userData.side = side;
        kit.add(w2);
        this.stageWings.push(w2);
      }
    }

    // ── dorsal crest: a row of ascending fins down the spine ──
    for (let i = 0; i < 3; i++) {
      const f = mk(0.07, 0.2 - i * 0.04, 0.09, glowMaterial(crownCol, 1.4));
      f.position.set(0, 0.34 - i * 0.015, -0.06 - i * 0.13);
      kit.add(f);
    }

    // ── floating crown ring above the head ──
    const crown = new THREE.Group();
    const n = stage * 3; // 3 / 6 cubes
    const cs = stage >= 2 ? 0.12 : 0.1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = mk(cs, cs, cs, glowMaterial(crownCol, 1.6));
      c.position.set(Math.cos(a) * 0.34, 0.56, Math.sin(a) * 0.34);
      crown.add(c);
    }
    kit.add(crown);
    this.stageCrown = crown;

    // ── top-stage extras: horns, orbiting shards, aura shell ──
    if (stage >= 2) {
      for (const side of [-1, 1]) {
        const horn = mk(0.07, 0.28, 0.07, glowMaterial(gild, 1.5));
        horn.position.set(side * 0.17, 0.5, 0.06);
        horn.rotation.z = side * 0.5;
        kit.add(horn);
      }
      const shards = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const sh = mk(0.1, 0.1, 0.1, glowMaterial(gild, 1.7));
        sh.position.set(Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62);
        shards.add(sh);
      }
      kit.add(shards);
      this.stageShards = shards;

      const aura = mk(0.98, 0.98, 0.98, auraMaterial(wingCol, 0.32));
      kit.add(aura);
      this.stageAura = aura;
    }

    this.body.add(kit);
    this.stageKit = kit;
  }

  private build() {
    const col = this.def.color;
    const acc = this.def.accent ?? darken(col, 0.4);
    // Clone the primary body materials so each pet OWNS them — lets evolution
    // stages recolor (gild) the whole creature without mutating the shared
    // material cache (which the world/zombies/other pets draw from). The base
    // colours are remembered so each stage re-tints from the original, not
    // compounding. Faces (`dark`) stay shared — eyes/smile never recolor.
    const body = voxelMaterial(col).clone();
    const accent = voxelMaterial(acc).clone();
    const glow = glowMaterial(col, 0.9).clone();
    const dark = voxelMaterial(0x141414);
    this._stageRecolor = [
      { mat: body, base: col },
      { mat: accent, base: acc },
      { mat: glow, base: col },
    ];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, into = this.body) => {
      // Reuse the shared unit box and encode size via mesh.scale (no per-voxel
      // BoxGeometry alloc). Meshes whose scale is later animated (muzzle/aura)
      // remember their base size in userData so the animation can multiply it.
      const m = new THREE.Mesh(SHARED_UNIT_BOX, mat);
      m.scale.set(w, h, d);
      m.userData.bw = w;
      m.userData.bh = h;
      m.userData.bd = d;
      m.position.set(x, y, z);
      into.add(m);
      return m;
    };
    // ── cute kit: big sparkly eyes, rosy cheeks, little smiles ──
    // The single biggest "awww" lever on voxel critters is oversized eyes with
    // a white shine pixel + blush — every shape gets them.
    const shine = voxelMaterial(0xffffff);
    const blush = glowMaterial(0xff8fb0, 0.55);
    // Cuter, more readable eyes: a white eyeball backing makes the dark pupil
    // pop against any body colour, with a bright catch-light for life. One
    // change here upgrades the face of ALL 20 pet shapes at once.
    const eye = (x: number, y: number, z: number, s = 0.14, into = this.body) => {
      box(s * 1.18, s * 1.55, 0.04, x, y, z - 0.005, shine, into); // white eyeball backing
      box(s, s * 1.35, 0.05, x, y, z, dark, into); // big round pupil
      box(s * 0.5, s * 0.55, 0.04, x - s * 0.24, y + s * 0.4, z + 0.02, shine, into); // catch-light sparkle
    };
    const cheeks = (y: number, z: number, dx = 0.21, into = this.body) => {
      box(0.11, 0.08, 0.04, -dx, y, z, blush, into);
      box(0.11, 0.08, 0.04, dx, y, z, blush, into);
    };
    // A little upturned smile: a center bar + two raised corner pips so it reads
    // as a happy curve rather than a flat dash.
    const smile = (y: number, z: number, w = 0.12, into = this.body) => {
      box(w, 0.04, 0.04, 0, y, z, dark, into);
      box(0.04, 0.04, 0.04, -(w / 2 + 0.01), y + 0.045, z, dark, into);
      box(0.04, 0.04, 0.04, (w / 2 + 0.01), y + 0.045, z, dark, into);
    };
    switch (this.def.shape) {
      case "bee": {
        // fuzzy striped thorax + abdomen, a real stinger, twin flutter wings.
        box(0.46, 0.46, 0.34, 0, 0.04, 0.12, body); // furry head/thorax (front)
        box(0.52, 0.5, 0.42, 0, -0.02, -0.16, body); // plump striped abdomen (rear)
        box(0.54, 0.1, 0.44, 0, 0.1, -0.16, accent); // abdomen stripes
        box(0.54, 0.1, 0.44, 0, -0.12, -0.16, accent);
        box(0.5, 0.08, 0.36, 0, 0.18, 0.12, accent); // collar stripe on thorax
        box(0.12, 0.1, 0.1, 0, -0.04, -0.42, dark); // tapered stinger base
        box(0.05, 0.05, 0.12, 0, -0.04, -0.52, glowMaterial(0xfff080, 1.1)); // glowing stinger tip
        eye(-0.13, 0.07, 0.3);
        eye(0.13, 0.07, 0.3);
        cheeks(-0.06, 0.31);
        smile(-0.11, 0.31);
        box(0.05, 0.15, 0.05, -0.07, 0.34, 0.18, dark); // antennae
        box(0.05, 0.15, 0.05, 0.07, 0.34, 0.18, dark);
        box(0.08, 0.08, 0.08, -0.07, 0.44, 0.18, glow); // bobble tips
        box(0.08, 0.08, 0.08, 0.07, 0.44, 0.18, glow);
        // two-feather flutter wings each side (rear blade gives a fuller spread)
        this.wingL = box(0.3, 0.04, 0.4, -0.36, 0.2, 0.02, glowMaterial(0xeaffff, 0.6));
        box(0.18, 0.04, 0.26, -0.32, 0.14, -0.18, glowMaterial(0xcfeaff, 0.45));
        this.wingR = box(0.3, 0.04, 0.4, 0.36, 0.2, 0.02, glowMaterial(0xeaffff, 0.6));
        box(0.18, 0.04, 0.26, 0.32, 0.14, -0.18, glowMaterial(0xcfeaff, 0.45));
        this.muzzle = box(0.1, 0.1, 0.1, 0, 0.02, 0.34, glow);
        break;
      }
      case "wisp":
        // a flickering spirit flame: layered glow core, a teardrop crown of
        // motes tapering up, and a soft trailing wisp tail below.
        this.aura = box(0.56, 0.62, 0.56, 0, 0.02, 0, auraMaterial(col, 0.5));
        box(0.34, 0.4, 0.34, 0, 0.02, 0, glow); // soft body
        box(0.24, 0.24, 0.24, 0, 0.04, 0, glowMaterial(0xffffff, 0.7)); // hot inner core
        box(0.16, 0.16, 0.16, 0, 0.34, 0, glow); // spark crown
        box(0.1, 0.1, 0.1, 0, 0.5, 0, glowMaterial(0xffffff, 1.1)); // rising flame tip
        box(0.12, 0.12, 0.12, -0.18, -0.22, 0, glowMaterial(col, 0.7)); // trailing motes
        box(0.09, 0.09, 0.09, 0.16, -0.3, 0.04, glowMaterial(col, 0.6));
        eye(-0.1, 0.03, 0.2, 0.11);
        eye(0.1, 0.03, 0.2, 0.11);
        cheeks(-0.08, 0.21, 0.18);
        smile(-0.09, 0.21, 0.1);
        this.muzzle = box(0.08, 0.08, 0.08, 0, 0.04, 0.28, glowMaterial(0xffffff, 1.2));
        break;
      case "turret":
        // squat armored bunker: wide tread base, riveted hull, twin barrels,
        // an ammo drum on the back, and a glowing targeting visor.
        box(0.66, 0.16, 0.58, 0, -0.3, 0, dark); // tread base
        box(0.7, 0.08, 0.62, 0, -0.36, 0, accent); // ground plate
        box(0.6, 0.42, 0.58, 0, -0.04, 0, body); // armored hull
        box(0.64, 0.1, 0.62, 0, 0.18, 0, accent); // turret collar
        box(0.5, 0.26, 0.5, 0, 0.3, 0, body); // rounded turret dome
        // corner rivets
        box(0.07, 0.07, 0.07, -0.26, -0.04, 0.27, accent);
        box(0.07, 0.07, 0.07, 0.26, -0.04, 0.27, accent);
        // twin barrels
        box(0.13, 0.13, 0.42, -0.12, 0.16, 0.42, dark);
        box(0.13, 0.13, 0.42, 0.12, 0.16, 0.42, dark);
        box(0.16, 0.16, 0.1, -0.12, 0.16, 0.64, glow); // muzzle brakes
        box(0.16, 0.16, 0.1, 0.12, 0.16, 0.64, glow);
        box(0.28, 0.28, 0.22, 0, 0.0, -0.4, accent); // ammo drum
        box(0.18, 0.18, 0.06, 0, 0.0, -0.52, glowMaterial(this.def.color, 0.9)); // drum light
        box(0.34, 0.1, 0.06, 0, 0.32, 0.27, glowMaterial(0xff5a5a, 1.0)); // targeting visor
        eye(-0.13, 0.32, 0.3, 0.12);
        eye(0.13, 0.32, 0.3, 0.12);
        cheeks(-0.04, 0.32, 0.2);
        this.muzzle = box(0.18, 0.18, 0.1, 0, 0.16, 0.72, glow);
        break;
      case "ghost":
        // a rounded sheeted spook: domed head, floaty stub arms, and a wispy
        // tattered tail of three descending lobes.
        this.aura = box(0.66, 0.74, 0.66, 0, 0.04, 0, auraMaterial(col, 0.35));
        box(0.5, 0.42, 0.5, 0, 0.16, 0, glowMaterial(col, 0.7)); // domed head
        box(0.54, 0.28, 0.52, 0, -0.08, 0, glowMaterial(col, 0.6)); // body
        box(0.13, 0.2, 0.13, -0.31, -0.04, 0, glowMaterial(col, 0.55)); // stub arms
        box(0.13, 0.2, 0.13, 0.31, -0.04, 0, glowMaterial(col, 0.55));
        eye(-0.13, 0.18, 0.26, 0.17); // big adorable peepers
        eye(0.13, 0.18, 0.26, 0.17);
        cheeks(0.02, 0.27);
        smile(-0.02, 0.27, 0.1);
        // tattered scalloped tail (three lobes of decreasing size)
        box(0.16, 0.16, 0.16, -0.18, -0.3, 0, glowMaterial(col, 0.65));
        box(0.14, 0.2, 0.14, 0.02, -0.36, 0, glowMaterial(col, 0.6));
        box(0.13, 0.14, 0.13, 0.2, -0.3, 0, glowMaterial(col, 0.55));
        this.muzzle = box(0.12, 0.12, 0.12, 0, 0.0, 0.3, glow);
        break;
      case "dragon":
        box(0.58, 0.46, 0.6, 0, -0.04, -0.06, body); // chibi body
        box(0.58, 0.14, 0.58, 0, -0.22, -0.06, accent); // belly plate
        box(0.2, 0.06, 0.5, 0, -0.18, -0.06, glowMaterial(acc, 0.5)); // belly scute glow seam
        box(0.5, 0.5, 0.48, 0, 0.22, 0.46, body); // big chibi head
        box(0.22, 0.18, 0.18, 0, 0.12, 0.72, accent); // snout
        box(0.05, 0.05, 0.04, -0.06, 0.16, 0.81, dark); // nostrils
        box(0.05, 0.05, 0.04, 0.06, 0.16, 0.81, dark);
        eye(-0.15, 0.3, 0.68, 0.16); // huge baby eyes
        eye(0.15, 0.3, 0.68, 0.16);
        cheeks(0.16, 0.71, 0.24);
        // swept-back horns (two segments for a real curve)
        box(0.07, 0.14, 0.07, -0.14, 0.5, 0.4, accent);
        box(0.06, 0.12, 0.06, -0.18, 0.6, 0.32, glowMaterial(acc, 0.8));
        box(0.07, 0.14, 0.07, 0.14, 0.5, 0.4, accent);
        box(0.06, 0.12, 0.06, 0.18, 0.6, 0.32, glowMaterial(acc, 0.8));
        // dorsal spine fins down the back
        box(0.05, 0.12, 0.07, 0, 0.24, 0.04, accent);
        box(0.05, 0.1, 0.07, 0, 0.2, -0.16, accent);
        // tapering tail with a spiked spade tip
        box(0.16, 0.16, 0.24, 0, -0.08, -0.4, body);
        box(0.11, 0.11, 0.18, 0, -0.1, -0.58, body);
        box(0.2, 0.16, 0.08, 0, -0.12, -0.72, accent); // spade
        box(0.05, 0.12, 0.05, 0, -0.04, -0.72, glowMaterial(acc, 0.8)); // tail spike
        // membrane wings: a glowing membrane with a darker leading-edge frame
        this.wingL = box(0.52, 0.06, 0.44, -0.5, 0.2, -0.16, glowMaterial(acc, 0.5));
        box(0.52, 0.08, 0.06, -0.5, 0.24, 0.04, accent); // wing frame
        this.wingR = box(0.52, 0.06, 0.44, 0.5, 0.2, -0.16, glowMaterial(acc, 0.5));
        box(0.52, 0.08, 0.06, 0.5, 0.24, 0.04, accent);
        this.muzzle = box(0.16, 0.16, 0.16, 0, 0.14, 0.86, glowMaterial(0xffd24a, 1.4)); // fire breath
        break;
      case "piggy":
        box(0.64, 0.54, 0.72, 0, 0, 0, body); // round chubby body
        box(0.26, 0.24, 0.16, 0, -0.02, 0.42, accent); // big snout disc
        box(0.05, 0.07, 0.04, -0.07, -0.02, 0.5, dark); // nostrils
        box(0.05, 0.07, 0.04, 0.07, -0.02, 0.5, dark);
        eye(-0.14, 0.12, 0.36, 0.12); // sparkly eyes
        eye(0.14, 0.12, 0.36, 0.12);
        cheeks(0.02, 0.37, 0.26);
        smile(-0.14, 0.36, 0.08);
        box(0.14, 0.15, 0.04, -0.18, 0.3, 0.18, body); // floppy ears
        box(0.14, 0.15, 0.04, 0.18, 0.3, 0.18, body);
        box(0.07, 0.08, 0.03, -0.18, 0.27, 0.2, blush); // inner ear
        box(0.07, 0.08, 0.03, 0.18, 0.27, 0.2, blush);
        // raised gilded coin slot on the back
        box(0.28, 0.1, 0.16, 0, 0.3, -0.04, accent);
        box(0.22, 0.05, 0.04, 0, 0.36, -0.04, glowMaterial(0xffd24a, 1.2)); // coin slot
        box(0.13, 0.13, 0.04, 0, 0.46, -0.04, glowMaterial(0xffe07a, 1.3)); // a coin poking out
        // four little hooves
        box(0.13, 0.12, 0.13, -0.2, -0.32, 0.2, accent);
        box(0.13, 0.12, 0.13, 0.2, -0.32, 0.2, accent);
        box(0.13, 0.12, 0.13, -0.2, -0.32, -0.2, accent);
        box(0.13, 0.12, 0.13, 0.2, -0.32, -0.2, accent);
        box(0.08, 0.08, 0.06, 0, 0.04, -0.4, accent); // curly tail base
        box(0.06, 0.1, 0.05, 0.06, 0.1, -0.42, accent); // curl
        break;
      case "totem":
        // a stacked tiki: a small carved guardian face above the main mask,
        // glowing rune seams, side ears, and a feathered headdress crown.
        box(0.46, 0.16, 0.44, 0, -0.34, 0, accent); // plinth base
        box(0.5, 0.46, 0.46, 0, -0.06, 0, body); // main mask block
        box(0.52, 0.06, 0.48, 0, 0.16, 0, glowMaterial(this.def.color, 0.9)); // glow seam
        box(0.42, 0.3, 0.4, 0, 0.34, 0, accent); // smaller upper guardian face
        box(0.14, 0.22, 0.06, -0.28, -0.04, 0, body); // carved side ears
        box(0.14, 0.22, 0.06, 0.28, -0.04, 0, body);
        eye(-0.12, 0.0, 0.24, 0.13); // big friendly eyes (main face)
        eye(0.12, 0.0, 0.24, 0.13);
        cheeks(-0.1, 0.25);
        smile(-0.14, 0.25, 0.12);
        box(0.06, 0.06, 0.05, -0.08, 0.36, 0.21, glow); // upper face eyes
        box(0.06, 0.06, 0.05, 0.08, 0.36, 0.21, glow);
        // feathered headdress crown
        box(0.07, 0.18, 0.06, 0, 0.56, 0, glowMaterial(0xffd24a, 1.2));
        box(0.06, 0.13, 0.05, -0.13, 0.52, 0, glowMaterial(this.def.color, 1.0));
        box(0.06, 0.13, 0.05, 0.13, 0.52, 0, glowMaterial(this.def.color, 1.0));
        this.aura = box(0.74, 0.78, 0.74, 0, 0, 0, auraMaterial(this.def.color, 0.3)); // buff aura
        break;
      case "drone":
        // sleek quadcopter: rounded chassis, four arms with rotor housings +
        // glowing blades, an antenna, and a chin-mounted blaster.
        box(0.46, 0.3, 0.44, 0, 0.06, 0, body); // chassis
        box(0.5, 0.08, 0.48, 0, 0.22, 0, accent); // top plate
        box(0.5, 0.06, 0.4, 0, -0.08, 0, accent); // belly fin
        // arms + rotors at four corners
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          box(0.2, 0.05, 0.06, sx * 0.26, 0.2, sz * 0.26, accent); // arm strut
          box(0.16, 0.06, 0.16, sx * 0.34, 0.24, sz * 0.24, dark); // rotor housing
          box(0.26, 0.03, 0.05, sx * 0.34, 0.28, sz * 0.24, glowMaterial(0xeaffff, 0.7)); // blade glow
        }
        box(0.04, 0.16, 0.04, 0, 0.34, -0.08, accent); // antenna
        box(0.07, 0.07, 0.07, 0, 0.44, -0.08, glow); // antenna light
        eye(-0.12, 0.08, 0.24, 0.13); // big lens eyes
        eye(0.12, 0.08, 0.24, 0.13);
        cheeks(-0.04, 0.25, 0.22);
        box(0.16, 0.12, 0.22, 0, -0.12, 0.28, dark); // chin blaster
        this.muzzle = box(0.14, 0.14, 0.1, 0, -0.12, 0.44, glow);
        break;
      case "slime":
        // a translucent wobbling gel-dome with suspended bubbles, a glossy
        // top shine, and little drips oozing off the base rim.
        this.aura = box(0.7, 0.56, 0.7, 0, -0.02, 0, auraMaterial(col, 0.3));
        box(0.62, 0.4, 0.62, 0, -0.08, 0, glowMaterial(col, 0.45)); // squat base
        box(0.5, 0.5, 0.5, 0, 0.12, 0, body); // wobbly blob top
        box(0.16, 0.1, 0.12, 0, 0.4, 0.06, glowMaterial(0xffffff, 0.8)); // glossy top shine
        // suspended inner bubbles
        box(0.1, 0.1, 0.06, -0.16, 0.06, 0.22, glowMaterial(0xffffff, 0.5));
        box(0.07, 0.07, 0.06, 0.18, -0.04, 0.2, glowMaterial(0xffffff, 0.45));
        // drips off the rim
        box(0.07, 0.12, 0.07, -0.26, -0.18, 0.1, glowMaterial(col, 0.5));
        box(0.06, 0.1, 0.06, 0.24, -0.2, -0.06, glowMaterial(col, 0.5));
        eye(-0.12, 0.14, 0.24, 0.13); // big jelly eyes
        eye(0.12, 0.14, 0.24, 0.13);
        cheeks(0.04, 0.25, 0.2);
        smile(0.0, 0.25, 0.1);
        this.muzzle = box(0.12, 0.12, 0.12, 0, 0.04, 0.34, glow);
        break;
      case "golem":
        // a craggy boulder-being: stacked rock plates with glowing magma seams,
        // a heavy brow, mossy shoulder chunks, and big blocky fists.
        box(0.6, 0.5, 0.6, 0, 0.04, 0, body); // torso boulder
        box(0.66, 0.2, 0.66, 0, -0.26, 0, accent); // base
        box(0.5, 0.06, 0.5, 0, 0.24, 0, glowMaterial(0xff8a3a, 0.9)); // upper magma seam
        box(0.06, 0.36, 0.5, -0.02, 0.04, 0.005, glowMaterial(0xff8a3a, 0.7)); // vertical crack seam
        box(0.6, 0.12, 0.5, 0, 0.26, 0.06, accent); // heavy stone brow
        eye(-0.14, 0.08, 0.3, 0.15); // big gentle-giant eyes
        eye(0.14, 0.08, 0.3, 0.15);
        cheeks(-0.1, 0.31, 0.26);
        smile(-0.14, 0.31, 0.14);
        // mossy shoulder chunks
        box(0.16, 0.1, 0.16, -0.28, 0.28, 0, glowMaterial(0x6fdc8c, 0.4));
        box(0.16, 0.1, 0.16, 0.28, 0.28, 0, glowMaterial(0x6fdc8c, 0.4));
        // arms ending in chunky fists
        box(0.16, 0.26, 0.16, -0.42, -0.02, 0, body);
        box(0.16, 0.26, 0.16, 0.42, -0.02, 0, body);
        box(0.22, 0.2, 0.22, -0.42, -0.22, 0.02, accent); // fists
        box(0.22, 0.2, 0.22, 0.42, -0.22, 0.02, accent);
        this.muzzle = box(0.16, 0.16, 0.12, 0, -0.06, 0.34, glow);
        break;
      case "mushroom":
        // a toadstool sprite: chunky stem with a collar ring, a domed two-tier
        // spotted cap with gills underneath, and little stubby arms.
        box(0.36, 0.4, 0.36, 0, -0.1, 0, accent); // chubby stem
        box(0.44, 0.05, 0.44, 0, 0.06, 0, glowMaterial(0xffffff, 0.5)); // gill ring under cap
        box(0.64, 0.26, 0.64, 0, 0.18, 0, body); // cap lower
        box(0.4, 0.18, 0.4, 0, 0.34, 0, body); // cap dome top
        // bright spots scattered on the cap
        box(0.14, 0.14, 0.14, -0.18, 0.24, 0.16, glowMaterial(0xffffff, 0.85));
        box(0.13, 0.13, 0.13, 0.2, 0.22, -0.06, glowMaterial(0xffffff, 0.85));
        box(0.1, 0.1, 0.1, 0.04, 0.42, 0.04, glowMaterial(0xffffff, 0.85));
        box(0.1, 0.1, 0.1, -0.1, 0.22, -0.2, glowMaterial(0xffffff, 0.75));
        eye(-0.11, -0.08, 0.19, 0.12); // eyes on the stem face
        eye(0.11, -0.08, 0.19, 0.12);
        cheeks(-0.16, 0.19, 0.18);
        smile(-0.18, 0.19, 0.1);
        box(0.08, 0.16, 0.08, -0.22, -0.1, 0.04, accent); // stubby arms
        box(0.08, 0.16, 0.08, 0.22, -0.1, 0.04, accent);
        this.muzzle = box(0.12, 0.12, 0.12, 0, -0.04, 0.24, glow);
        break;
      case "frog":
        box(0.6, 0.4, 0.52, 0, 0, 0, body);
        box(0.6, 0.18, 0.54, 0, -0.16, 0.02, accent); // pale belly
        box(0.24, 0.16, 0.22, 0, -0.02, 0.18, glowMaterial(acc, 0.4)); // puffing throat sac
        box(0.22, 0.22, 0.2, -0.16, 0.24, 0.04, body); // big eye bulges
        box(0.22, 0.22, 0.2, 0.16, 0.24, 0.04, body);
        eye(-0.16, 0.26, 0.17, 0.13); // sparkly froggy eyes
        eye(0.16, 0.26, 0.17, 0.13);
        cheeks(0.0, 0.16, 0.22);
        smile(-0.02, 0.04, 0.24); // wide froggy grin
        // splayed webbed feet (toe pips)
        box(0.18, 0.1, 0.16, -0.26, -0.16, 0.16, accent);
        box(0.18, 0.1, 0.16, 0.26, -0.16, 0.16, accent);
        box(0.05, 0.05, 0.05, -0.32, -0.14, 0.26, body); // toes
        box(0.05, 0.05, 0.05, -0.2, -0.14, 0.28, body);
        box(0.05, 0.05, 0.05, 0.32, -0.14, 0.26, body);
        box(0.05, 0.05, 0.05, 0.2, -0.14, 0.28, body);
        box(0.12, 0.12, 0.14, -0.28, -0.06, -0.16, body); // tucked hind legs
        box(0.12, 0.12, 0.14, 0.28, -0.06, -0.16, body);
        this.muzzle = box(0.1, 0.1, 0.1, 0, 0, 0.32, glow);
        break;
      case "crystal": {
        // a faceted gem core with a bright tip and a ring of smaller shards
        // orbiting it (the orbit ring spins in update via `orbiters`).
        this.aura = box(0.62, 0.74, 0.62, 0, 0, 0, auraMaterial(col, 0.35));
        box(0.3, 0.46, 0.3, 0, 0.06, 0, glowMaterial(col, 0.85)); // central shard
        box(0.42, 0.18, 0.42, 0, -0.06, 0, glowMaterial(col, 0.6)); // faceted mid-band
        box(0.18, 0.18, 0.18, 0, 0.34, 0, glowMaterial(0xffffff, 1.1)); // bright tip
        box(0.1, 0.1, 0.1, 0, 0.46, 0, glow); // tip spark
        // orbiting satellite shards
        this.orbiters = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          box(0.1, 0.26, 0.1, Math.cos(a) * 0.4, -0.02 + (i % 2) * 0.1, Math.sin(a) * 0.4, glowMaterial(col, 0.8), this.orbiters);
        }
        this.body.add(this.orbiters);
        eye(-0.09, 0.08, 0.16, 0.1); // little gem face
        eye(0.09, 0.08, 0.16, 0.1);
        cheeks(-0.02, 0.2, 0.14);
        smile(-0.04, 0.2, 0.07);
        this.muzzle = box(0.12, 0.12, 0.12, 0, 0.06, 0.26, glowMaterial(0xffffff, 1.2));
        break;
      }
      case "star": {
        // a five-point star: a glowing core with one up-point and two angled
        // arms each side, plus tiny twinkles orbiting it.
        this.aura = box(0.66, 0.66, 0.2, 0, 0, 0, auraMaterial(col, 0.4));
        box(0.42, 0.42, 0.16, 0, 0, 0, glowMaterial(col, 0.95)); // core
        box(0.18, 0.34, 0.12, 0, 0.34, 0, glow); // top point
        // four diagonal arms forming the lower 4 points
        for (const sx of [-1, 1]) {
          const arm = box(0.36, 0.12, 0.12, sx * 0.26, 0.14, 0, glow); // upper arms
          arm.rotation.z = sx * -0.5;
          const leg = box(0.32, 0.12, 0.12, sx * 0.2, -0.24, 0, glow); // lower legs
          leg.rotation.z = sx * 0.7;
        }
        box(0.12, 0.12, 0.12, 0, 0.5, 0, glowMaterial(0xffffff, 1.3)); // crown spark
        // orbiting twinkles
        this.orbiters = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          box(0.07, 0.07, 0.07, Math.cos(a) * 0.46, 0.0, Math.sin(a) * 0.46, glowMaterial(0xffffff, 1.1), this.orbiters);
        }
        this.body.add(this.orbiters);
        eye(-0.1, 0.04, 0.12, 0.11); // twinkly star eyes
        eye(0.1, 0.04, 0.12, 0.11);
        cheeks(-0.08, 0.12, 0.16);
        smile(-0.1, 0.12, 0.1);
        this.muzzle = box(0.12, 0.12, 0.12, 0, 0, 0.2, glowMaterial(0xffffff, 1.3));
        break;
      }
      case "cat":
        box(0.52, 0.46, 0.5, 0, 0, 0, body);
        box(0.5, 0.14, 0.5, 0, -0.2, 0, accent); // belly/chest
        // perky triangular ears with inner pink + a tuft
        box(0.15, 0.18, 0.05, -0.16, 0.3, 0.04, body);
        box(0.15, 0.18, 0.05, 0.16, 0.3, 0.04, body);
        box(0.08, 0.1, 0.04, -0.16, 0.32, 0.06, blush); // inner ears
        box(0.08, 0.1, 0.04, 0.16, 0.32, 0.06, blush);
        eye(-0.13, 0.06, 0.25, 0.14); // big kitty eyes
        eye(0.13, 0.06, 0.25, 0.14);
        cheeks(-0.06, 0.26);
        box(0.06, 0.05, 0.05, 0, -0.04, 0.27, blush); // tiny nose
        smile(-0.1, 0.27, 0.08);
        // whiskers (three per side)
        for (const sx of [-1, 1]) {
          box(0.16, 0.02, 0.02, sx * 0.26, 0.0, 0.24, shine);
          box(0.16, 0.02, 0.02, sx * 0.26, -0.05, 0.24, shine);
          box(0.14, 0.02, 0.02, sx * 0.25, -0.1, 0.24, shine);
        }
        // little front paws
        box(0.12, 0.1, 0.12, -0.16, -0.24, 0.18, accent);
        box(0.12, 0.1, 0.12, 0.16, -0.24, 0.18, accent);
        // curling tail with a striped tip
        box(0.1, 0.1, 0.3, 0, -0.04, -0.4, body);
        box(0.1, 0.18, 0.1, 0, 0.08, -0.54, body);
        box(0.1, 0.1, 0.1, 0, 0.18, -0.54, accent); // tail tip
        this.muzzle = box(0.1, 0.1, 0.1, 0, -0.02, 0.3, glow);
        break;
      case "eye": {
        // a watchful floating eyeball: domed sclera, big colored iris with a
        // glowing pupil, a heavy lid + lashes, and a ring of orbiting motes.
        this.aura = box(0.64, 0.64, 0.64, 0, 0, 0, auraMaterial(col, 0.3));
        box(0.52, 0.54, 0.5, 0, 0, 0, glowMaterial(0xffffff, 0.5)); // round sclera
        box(0.3, 0.32, 0.1, 0, -0.02, 0.23, glowMaterial(col, 0.95)); // big iris
        box(0.18, 0.18, 0.06, 0, -0.03, 0.31, dark); // pupil
        box(0.06, 0.06, 0.05, 0, -0.03, 0.36, glowMaterial(col, 1.2)); // glowing pupil core
        box(0.08, 0.08, 0.04, -0.07, 0.07, 0.34, shine); // big catch-light
        box(0.05, 0.05, 0.04, 0.06, -0.09, 0.34, shine); // second sparkle
        box(0.52, 0.12, 0.46, 0, 0.28, 0.02, accent); // heavy upper lid
        // lashes along the lid
        box(0.05, 0.08, 0.04, -0.18, 0.36, 0.18, dark);
        box(0.05, 0.1, 0.04, 0, 0.38, 0.2, dark);
        box(0.05, 0.08, 0.04, 0.18, 0.36, 0.18, dark);
        cheeks(-0.16, 0.26, 0.24);
        // orbiting watcher-motes
        this.orbiters = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          box(0.07, 0.07, 0.07, Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42, glowMaterial(col, 1.0), this.orbiters);
        }
        this.body.add(this.orbiters);
        this.muzzle = box(0.12, 0.12, 0.12, 0, -0.18, 0.3, glow);
        break;
      }
      case "serpent":
        box(0.46, 0.44, 0.46, 0, 0.1, 0.22, body); // cute head
        box(0.2, 0.14, 0.1, 0, 0.04, 0.46, accent); // snout
        // flared cobra hood frill behind the head
        box(0.62, 0.36, 0.06, 0, 0.1, 0.08, glowMaterial(acc, 0.5));
        box(0.5, 0.3, 0.04, 0, 0.1, 0.04, accent);
        eye(-0.12, 0.16, 0.38, 0.12); // sparkly snake eyes
        eye(0.12, 0.16, 0.38, 0.12);
        cheeks(0.04, 0.4, 0.18);
        // forked tongue
        box(0.04, 0.03, 0.1, 0, 0.0, 0.52, glowMaterial(0xff5a6a, 0.9));
        box(0.03, 0.03, 0.05, -0.04, 0.0, 0.58, glowMaterial(0xff5a6a, 0.9));
        box(0.03, 0.03, 0.05, 0.04, 0.0, 0.58, glowMaterial(0xff5a6a, 0.9));
        // tapering coiled body segments with belly scale glow
        box(0.34, 0.34, 0.3, 0.08, -0.04, -0.08, body);
        box(0.3, 0.1, 0.26, 0.08, -0.16, -0.08, glowMaterial(acc, 0.4)); // belly
        box(0.28, 0.28, 0.26, -0.1, -0.08, -0.34, accent);
        box(0.22, 0.22, 0.22, 0.06, -0.1, -0.56, body);
        box(0.14, 0.14, 0.16, 0, -0.12, -0.74, accent); // tail
        box(0.1, 0.1, 0.08, 0, -0.12, -0.86, glowMaterial(0xfff080, 0.9)); // rattle tip
        this.muzzle = box(0.1, 0.1, 0.1, 0, 0.06, 0.54, glow);
        break;
      case "phoenix":
        box(0.4, 0.46, 0.4, 0, -0.04, 0, body); // body
        box(0.4, 0.16, 0.4, 0, -0.18, 0, glowMaterial(acc, 0.6)); // glowing breast
        box(0.34, 0.34, 0.32, 0, 0.34, 0.04, body); // big chibi head
        box(0.12, 0.12, 0.12, 0, 0.32, 0.24, accent); // beak
        eye(-0.1, 0.38, 0.2, 0.12); // big baby-bird eyes
        eye(0.1, 0.38, 0.2, 0.12);
        cheeks(0.28, 0.22, 0.16);
        // layered ember crest (three rising flame tongues)
        box(0.09, 0.16, 0.09, 0, 0.54, 0.02, glow);
        box(0.07, 0.13, 0.07, -0.1, 0.5, 0.0, glowMaterial(acc, 1.2));
        box(0.07, 0.13, 0.07, 0.1, 0.5, 0.0, glowMaterial(acc, 1.2));
        // fanned tail flames
        box(0.12, 0.1, 0.32, 0, -0.12, -0.32, glowMaterial(col, 0.7));
        box(0.1, 0.1, 0.24, -0.14, -0.08, -0.28, glowMaterial(acc, 0.7));
        box(0.1, 0.1, 0.24, 0.14, -0.08, -0.28, glowMaterial(acc, 0.7));
        box(0.07, 0.07, 0.14, 0, -0.12, -0.5, glowMaterial(0xffd24a, 1.1)); // tail ember tip
        // layered flame-feather wings (main blade + a hot inner feather)
        this.wingL = box(0.52, 0.06, 0.42, -0.44, 0.02, -0.04, glowMaterial(col, 0.6));
        box(0.32, 0.05, 0.28, -0.34, -0.1, -0.1, glowMaterial(acc, 0.7));
        this.wingR = box(0.52, 0.06, 0.42, 0.44, 0.02, -0.04, glowMaterial(col, 0.6));
        box(0.32, 0.05, 0.28, 0.34, -0.1, -0.1, glowMaterial(acc, 0.7));
        this.muzzle = box(0.12, 0.12, 0.12, 0, 0.32, 0.32, glowMaterial(0xffd24a, 1.4));
        break;
      case "ufo": {
        // a polished saucer: a beveled hull (wide rim + a slimmer underbelly),
        // a glowing glass dome with a peeking pilot, a spinning ring of running
        // lights, and a tractor beam below.
        box(0.74, 0.1, 0.74, 0, 0.02, 0, accent); // wide rim
        box(0.5, 0.12, 0.5, 0, -0.1, 0, body); // tapered underbelly
        box(0.3, 0.1, 0.3, 0, -0.22, 0, accent); // belly emitter housing
        box(0.5, 0.08, 0.5, 0, 0.08, 0, glowMaterial(this.def.color, 0.6)); // glow trim
        box(0.4, 0.26, 0.4, 0, 0.18, 0, glowMaterial(0xffffff, 0.45)); // glass dome
        box(0.12, 0.12, 0.12, 0, 0.34, 0, glow); // dome beacon
        eye(-0.1, 0.18, 0.2, 0.12); // tiny pilot peeking out
        eye(0.1, 0.18, 0.2, 0.12);
        cheeks(0.1, 0.21, 0.16);
        smile(0.08, 0.21, 0.1);
        // spinning ring of running lights
        this.orbiters = new THREE.Group();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          box(0.08, 0.08, 0.08, Math.cos(a) * 0.34, 0.02, Math.sin(a) * 0.34, glow, this.orbiters);
        }
        this.body.add(this.orbiters);
        this.aura = box(0.34, 0.46, 0.34, 0, -0.3, 0, auraMaterial(col, 0.45)); // tractor beam
        this.muzzle = box(0.14, 0.14, 0.14, 0, -0.16, 0.34, glowMaterial(0x9fe8ff, 1.2));
        break;
      }
      case "orb": {
        // a crackling energy core wrapped in two counter-spinning gyro-rings of
        // satellite sparks (orbiters / orbiters2), with a glowing little face.
        this.aura = box(0.64, 0.64, 0.64, 0, 0, 0, auraMaterial(col, 0.4));
        box(0.36, 0.36, 0.36, 0, 0, 0, glow); // inner core
        box(0.24, 0.24, 0.24, 0, 0, 0, glowMaterial(0xffffff, 1.0)); // hot center
        // static frame band
        box(0.58, 0.08, 0.08, 0, 0, 0, glowMaterial(0xffffff, 0.6));
        // horizontal spinning ring of sparks
        this.orbiters = new THREE.Group();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          box(0.08, 0.08, 0.08, Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42, glowMaterial(0xffffff, 0.9), this.orbiters);
        }
        this.body.add(this.orbiters);
        // a second, tilted counter-rotating ring
        this.orbiters2 = new THREE.Group();
        this.orbiters2.rotation.z = Math.PI / 2;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          box(0.07, 0.07, 0.07, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, glowMaterial(col, 0.9), this.orbiters2);
        }
        this.body.add(this.orbiters2);
        eye(-0.1, 0.03, 0.21, 0.11); // little glowing face
        eye(0.1, 0.03, 0.21, 0.11);
        cheeks(-0.06, 0.22, 0.16);
        smile(-0.08, 0.22, 0.1);
        this.muzzle = box(0.14, 0.14, 0.14, 0, 0, 0.3, glowMaterial(0xffffff, 1.4));
        break;
      }
      case "chronos": {
        // ✦ The Celestial time-god. Built for PRESENCE: a large luminous core,
        // TWO counter-rotating clockwork halo-rings, a tall five-point crown,
        // big sweeping seraph wings, and a wide radiant aura — keeping the cute
        // face. `acc` is gold; body is radiant cyan-white. (The whole thing is
        // scaled up in build() so it reads bigger than any other pet.)
        const goldGlow = glowMaterial(acc, 1.3);
        const goldBright = glowMaterial(0xfff2b0, 1.6);
        const white = glowMaterial(0xffffff, 1.6);
        // wide layered aura (two shells for a soft corona)
        this.aura = box(1.15, 1.15, 0.7, 0, 0.05, 0, auraMaterial(col, 0.6));
        box(0.85, 0.85, 0.5, 0, 0.05, -0.02, auraMaterial(0xeaffff, 0.4));
        // big glowing core body
        box(0.6, 0.64, 0.58, 0, 0.05, 0, glowMaterial(col, 1.1));
        box(0.46, 0.5, 0.46, 0, 0.05, 0.08, glowMaterial(0xeaffff, 0.9)); // bright inner face plate
        // ── outer clockwork ring (12 teeth) — lives in `halo`, spins one way ──
        this.halo = new THREE.Group();
        this.halo.position.set(0, 0.05, -0.02);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          box(0.1, 0.1, 0.08, Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0, goldGlow, this.halo);
        }
        // four cardinal markers (12/3/6/9 o'clock) brighter
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          box(0.13, 0.13, 0.1, Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0, goldBright, this.halo);
        }
        this.body.add(this.halo);
        // ── inner ring (8 teeth) — lives in `halo2`, counter-rotates ──
        this.halo2 = new THREE.Group();
        this.halo2.position.set(0, 0.05, 0.0);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8 + 0.06) * Math.PI * 2;
          box(0.08, 0.08, 0.07, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0, white, this.halo2);
        }
        box(0.84, 0.09, 0.06, 0, 0.05, 0, goldBright); // clock hands across the core
        box(0.09, 0.6, 0.06, 0, 0.05, 0, goldBright);
        // ── tall five-point crown ──
        box(0.08, 0.28, 0.08, 0, 0.66, 0, goldGlow); // center spire
        box(0.07, 0.2, 0.07, -0.17, 0.58, 0, goldGlow);
        box(0.07, 0.2, 0.07, 0.17, 0.58, 0, goldGlow);
        box(0.06, 0.13, 0.06, -0.31, 0.5, 0, goldGlow);
        box(0.06, 0.13, 0.06, 0.31, 0.5, 0, goldGlow);
        box(0.1, 0.1, 0.1, 0, 0.83, 0, white); // crown gem
        box(0.06, 0.06, 0.06, -0.17, 0.7, 0, white); // side gems
        box(0.06, 0.06, 0.06, 0.17, 0.7, 0, white);
        // ── big sweeping seraph wings (two feathers each side) ──
        this.wingL = box(0.6, 0.06, 0.5, -0.78, 0.12, -0.12, auraMaterial(0xeaffff, 0.8));
        box(0.4, 0.05, 0.34, -0.72, -0.18, -0.16, auraMaterial(col, 0.6));
        this.wingR = box(0.6, 0.06, 0.5, 0.78, 0.12, -0.12, auraMaterial(0xeaffff, 0.8));
        box(0.4, 0.05, 0.34, 0.72, -0.18, -0.16, auraMaterial(col, 0.6));
        // a ring of orbiting time-motes outside the rings (extra celestial heft)
        this.orbiters = new THREE.Group();
        this.orbiters.position.set(0, 0.05, 0.06);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          box(0.07, 0.07, 0.07, Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95, goldBright, this.orbiters);
        }
        this.body.add(this.orbiters);
        // cute face (kept), nudged onto the bright face plate
        eye(-0.13, 0.06, 0.3, 0.14);
        eye(0.13, 0.06, 0.3, 0.14);
        cheeks(-0.04, 0.3);
        smile(-0.1, 0.3, 0.13);
        this.muzzle = box(0.16, 0.16, 0.16, 0, 0.05, 0.4, glowMaterial(0xffffff, 1.6));
        break;
      }
      case "oracle": {
        // ✦ The all-seeing Oracle of Fate. A grand mystic eye: a luminous orb
        // with a deep violet iris + glowing pupil, a radiant halo of "fate"
        // rays, a floating laurel/crown, and big wings. Reads as ancient + wise
        // but still cute (blush + tiny catch-lights). acc=gold, body=violet.
        const goldGlow = glowMaterial(acc, 1.3);
        const white = glowMaterial(0xffffff, 1.5);
        this.aura = box(1.15, 1.15, 0.7, 0, 0.05, 0, auraMaterial(col, 0.6)); // wide mystic aura
        box(0.82, 0.82, 0.5, 0, 0.05, -0.02, auraMaterial(0xeed6ff, 0.4));
        // sclera (big white eyeball)
        box(0.72, 0.72, 0.5, 0, 0.05, 0.02, glowMaterial(0xfff4ff, 1.0));
        box(0.36, 0.36, 0.12, 0, 0.05, 0.28, glowMaterial(col, 1.0)); // violet iris
        box(0.18, 0.18, 0.08, 0, 0.05, 0.36, dark); // pupil
        box(0.08, 0.08, 0.05, -0.07, 0.13, 0.4, white); // catch-light
        box(0.05, 0.05, 0.05, 0.06, -0.04, 0.4, white); // second sparkle
        box(0.78, 0.12, 0.5, 0, 0.36, 0.02, goldGlow); // gold upper eyelid/brow
        // ── radiant halo of fate-rays around the eye (8 spokes) ──
        this.halo = new THREE.Group();
        this.halo.position.set(0, 0.05, -0.04);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          box(0.07, 0.2, 0.06, Math.cos(a) * 0.6, Math.sin(a) * 0.6 + 0.05, 0, goldGlow, this.halo);
        }
        this.body.add(this.halo);
        // floating laurel crown
        box(0.1, 0.1, 0.1, 0, 0.7, 0, white);
        box(0.07, 0.14, 0.07, -0.16, 0.62, 0, goldGlow);
        box(0.07, 0.14, 0.07, 0.16, 0.62, 0, goldGlow);
        // big wings
        this.wingL = box(0.58, 0.06, 0.48, -0.78, 0.1, -0.12, auraMaterial(0xeed6ff, 0.8));
        this.wingR = box(0.58, 0.06, 0.48, 0.78, 0.1, -0.12, auraMaterial(0xeed6ff, 0.8));
        cheeks(-0.22, 0.32, 0.34); // blush low on the orb so it stays cute
        // a slow ring of orbiting "fate" runes circling the eye
        this.orbiters = new THREE.Group();
        this.orbiters.position.set(0, 0.05, 0);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          box(0.09, 0.13, 0.05, Math.cos(a) * 0.86, 0, Math.sin(a) * 0.86, goldGlow, this.orbiters);
        }
        this.body.add(this.orbiters);
        this.muzzle = box(0.16, 0.16, 0.16, 0, 0.05, 0.42, white);
        break;
      }
      default:
        box(0.5, 0.5, 0.5, 0, 0, 0, body);
    }
    if (this.muzzle) this.setMuzzleScale(0.01); // hidden until firing
  }

  /** Scale the muzzle mesh by `f`, preserving its base box dimensions. */
  private setMuzzleScale(f: number) {
    const m = this.muzzle!;
    m.scale.set(m.userData.bw * f, m.userData.bh * f, m.userData.bd * f);
  }

  /** Tick the signature-ability cooldown; returns true on the frame it fires. */
  tickAbility(dt: number): boolean {
    const ab = this.def.ability;
    if (!ab) return false;
    this.abilityTimer -= dt;
    if (this.abilityTimer <= 0) {
      this.abilityTimer = ab.cd;
      this.onFire(); // recoil/flash punch on the cast too
      return true;
    }
    return false;
  }

  /** Visually react to firing — recoil punch + muzzle flash. */
  private onFire() {
    this.recoil = 1;
    this.flashLife = 0.12;
  }

  /**
   * Update orbit + animation + fire. Returns a shot when it fires this frame.
   */
  update(dt: number, playerX: number, playerZ: number, idx: number, total: number, target: { x: number; z: number } | null, fireRateMul = 1, engageRange?: number): { ox: number; oz: number; dx: number; dz: number; dist: number } | null {
    // Orbit around the player. A SHARED phase (orbitAngle, advanced at the same
    // rate for every pet) spins the whole ring; the evenly-spaced `slot` keeps
    // each pet at a fixed angular offset so they never bunch up. The ring radius
    // grows with squad size so 5+ pets fan out instead of overlapping.
    this.orbitAngle += dt * 1.0;
    const slot = (idx / Math.max(1, total)) * Math.PI * 2;
    const r = (1.9 + Math.max(0, total - 2) * 0.32) * this.orbitScale;
    const ox = playerX + Math.cos(this.orbitAngle + slot) * r;
    const oz = playerZ + Math.sin(this.orbitAngle + slot) * r;
    this.bob += dt * 4;
    this.group.position.set(ox, 1.4 + Math.sin(this.bob) * 0.12, oz);
    // engine stacks bleed off slowly so the snowball must be maintained by casting.
    if (this.engineStacks > 0) this.engineStacks = Math.max(0, this.engineStacks - dt * 0.25);

    // ---- idle animation ----
    this.flap += dt * (this.wingL ? 26 : 8); // bees/dragons flap fast
    if (this.wingL && this.wingR) {
      const a = Math.sin(this.flap) * (this.def.shape === "dragon" ? 0.5 : 0.9);
      this.wingL.rotation.z = a;
      this.wingR.rotation.z = -a;
    }
    if (this.aura) {
      const p = 1 + Math.sin(this.bob * 1.3) * 0.12;
      const a = this.aura;
      a.scale.set(a.userData.bw * p, a.userData.bh * p, a.userData.bd * p);
      (a.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + (Math.sin(this.bob * 2) + 1) * 0.2;
    }
    // ── evolution-stage kit animation ──
    if (this.stageCrown) {
      this.stageCrown.rotation.y += dt * 1.3;
      this.stageCrown.position.y = Math.sin(this.bob * 1.5) * 0.03;
    }
    if (this.stageWings.length) {
      // resting downward sweep + a slower, statelier flap than the base wings
      const a = Math.sin(this.flap * 0.5) * 0.45 - 0.15;
      for (const w of this.stageWings) w.rotation.z = (w.userData.side as number) * a;
    }
    if (this.stageShards) {
      this.stageShards.rotation.y += dt * 1.5;
      this.stageShards.position.y = Math.sin(this.bob * 1.2) * 0.05;
    }
    if (this.stageAura) {
      const p = 1 + Math.sin(this.bob * 1.1) * 0.06;
      const a = this.stageAura;
      a.scale.set(a.userData.bw * p, a.userData.bh * p, a.userData.bd * p);
      (a.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + (Math.sin(this.bob * 2) + 1) * 0.15;
    }
    // Chronos: the two clockwork halo-rings counter-rotate (the time motif).
    if (this.halo) this.halo.rotation.z += dt * 0.6;
    if (this.halo2) this.halo2.rotation.z -= dt * 1.1;
    // shape-specific orbiting bits (crystal shards / eye runes / orb satellites):
    // a gentle spin + bob, second ring counter-rotates for parallax.
    if (this.orbiters) {
      this.orbiters.rotation.y += dt * 1.4;
      this.orbiters.position.y = Math.sin(this.bob * 1.2) * 0.04;
    }
    if (this.orbiters2) {
      this.orbiters2.rotation.y -= dt * 1.0;
      this.orbiters2.rotation.x = Math.sin(this.bob * 0.6) * 0.25;
    }
    // breathe + recoil: body squashes back when it just fired
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const breathe = 1 + Math.sin(this.bob * 0.8) * 0.04;
    this.body.scale.set(breathe, breathe, breathe * (1 - this.recoil * 0.25));
    this.body.position.z = -this.recoil * 0.12;
    // muzzle flash
    if (this.muzzle) {
      this.flashLife = Math.max(0, this.flashLife - dt);
      const f = this.flashLife / 0.12;
      this.setMuzzleScale(0.01 + f * 1.1);
    }
    // shiny sparkle: hue-cycle + twinkle the crown (cosmetic only).
    if (this.shinyMesh) {
      this.shinyT += dt * 2.2;
      const mat = this.shinyMesh.material as THREE.MeshStandardMaterial;
      const hue = (this.shinyT * 0.15) % 1;
      mat.color.setHSL(hue, 0.9, 0.7);
      mat.emissive.setHSL(hue, 0.9, 0.6);
      const tw = 0.09 + (Math.sin(this.shinyT * 3) + 1) * 0.05;
      this.shinyMesh.scale.set(tw, tw, tw);
      this.shinyMesh.position.y = 0.5 + Math.sin(this.shinyT) * 0.04;
    }

    // face + fire at target
    this.cd -= dt;
    if (target) {
      const dx = target.x - ox;
      const dz = target.z - oz;
      const dist = Math.hypot(dx, dz);
      this.group.rotation.y = Math.atan2(dx, dz);
      // engageRange lets callers widen the engage band per-role (tank/sniper) and
      // via squad synergy; falls back to the def's own range.
      const reach = engageRange ?? this.def.range;
      if (dist <= reach && this.cd <= 0) {
        // your Fire Rate upgrades make pets shoot faster too (same as your gun)
        this.cd = this.interval / Math.max(0.1, fireRateMul);
        this.onFire();
        const len = dist || 1;
        return { ox, oz, dx: dx / len, dz: dz / len, dist };
      }
    }
    return null;
  }
}
