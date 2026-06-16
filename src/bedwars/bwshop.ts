/**
 * Bed Wars-lite SHOP — the per-island item store + purchase math.
 *
 * The "Bed Wars-lite" mode swaps the survival faucet for a three-tier resource
 * economy: IRON drips fastest (cheap blocks + entry gear), GOLD is mid (better
 * weapons + utility), EMERALD is rare (the chase tier — diamond gear, obsidian,
 * the game-swinging utilities). You spend at a shop to defend your bed and raid
 * the enemy's; everything here is a tuned catalog + the affordability/deduction
 * math around it.
 *
 * Pure DATA + LOGIC (no THREE / DOM), so it unit-tests cleanly under node and
 * the integrator just reads BW_SHOP + the helpers to wire the shop UI and the
 * gameplay effects (each item carries an `effect` HINT — we deliberately don't
 * implement the gameplay here, only describe it).
 */

// The resource tiers + wallet are defined once in bwresources (iron, gold,
// diamond, emerald) — re-export them so the shop and its UI share one type.
export type { BwResource, BwWallet } from "./bwresources";
import type { BwResource, BwWallet } from "./bwresources";

export interface BwShopItem {
  id: string;
  name: string;
  category: "blocks" | "melee" | "ranged" | "armor" | "tools" | "utility";
  /** Price. Partial — most items cost a single tier; a few mix tiers. */
  cost: Partial<BwWallet>;
  desc: string;
  /** Effect HINTS the integrator reads to apply gameplay. Data only:
   *   value    — the magnitude (block HP, melee/ranged damage, armor reduction %).
   *   tier     — a 1-based rank within its category (armor 1-4, blocks, swords…).
   *   weaponId — loose reference to an existing weapon/projectile id (a string). */
  effect: { kind: string; value?: number; tier?: number; weaponId?: string };
}

/**
 * The catalog, grouped by category (cheapest/entry items first within each).
 * Costs follow the tier rule: iron is the everyday spend, gold buys the upgrades,
 * emerald gates the win-condition gear (diamond, obsidian) and the big utilities.
 */
export const BW_SHOP: BwShopItem[] = [
  // ── blocks: defend the bed. value = block HP (how much punishment it soaks). ──
  { id: "block_wool", name: "Wool", category: "blocks", cost: { iron: 4 }, desc: "Cheap bed wrap — quick to place, easy to shear.", effect: { kind: "block", value: 12, tier: 1 } },
  { id: "block_planks", name: "Wood Planks", category: "blocks", cost: { iron: 8 }, desc: "Sturdier than wool and fire-prone — buys you a moment.", effect: { kind: "block", value: 28, tier: 2 } },
  { id: "block_stone", name: "Stone", category: "blocks", cost: { iron: 14 }, desc: "Blast-resistant — shrugs off a fireball or two.", effect: { kind: "block", value: 60, tier: 3 } },
  { id: "block_obsidian", name: "Obsidian", category: "blocks", cost: { emerald: 4 }, desc: "Bed-proof wall — practically un-raidable without TNT.", effect: { kind: "block", value: 240, tier: 4 } },

  // ── melee: value = per-hit damage. ──
  { id: "melee_stone", name: "Stone Sword", category: "melee", cost: { iron: 10 }, desc: "Entry blade — a clear step up from fists.", effect: { kind: "melee", value: 5, tier: 1 } },
  { id: "melee_iron", name: "Iron Sword", category: "melee", cost: { gold: 7 }, desc: "Reliable mid-game cutter.", effect: { kind: "melee", value: 6, tier: 2 } },
  { id: "melee_diamond", name: "Diamond Sword", category: "melee", cost: { gold: 4, emerald: 3 }, desc: "Top-tier blade — wins most duels on the bridge.", effect: { kind: "melee", value: 8, tier: 3 } },

  // ── ranged: weaponId loosely references an existing projectile weapon. ──
  { id: "ranged_bow", name: "Bow", category: "ranged", cost: { gold: 12 }, desc: "Pick defenders off their island from range.", effect: { kind: "ranged", value: 6, tier: 1, weaponId: "bow" } },
  { id: "ranged_power_bow", name: "Power Bow", category: "ranged", cost: { gold: 24, emerald: 2 }, desc: "Enchanted draw — heavier arrows, real knockback.", effect: { kind: "ranged", value: 9, tier: 2, weaponId: "bow_power" } },
  { id: "ranged_crossbow", name: "Crossbow", category: "ranged", cost: { gold: 16, emerald: 1 }, desc: "Pre-cocked burst — punchy snap shots.", effect: { kind: "ranged", value: 8, tier: 2, weaponId: "crossbow" } },

  // ── armor: PERMANENT tiers. tier 1-4, value = damage-reduction %. ──
  { id: "armor_leather", name: "Leather Armor", category: "armor", cost: { iron: 20 }, desc: "Permanent — chips a little off every hit.", effect: { kind: "armor", value: 15, tier: 1 } },
  { id: "armor_chain", name: "Chainmail Armor", category: "armor", cost: { gold: 5 }, desc: "Permanent — solid mid-game protection.", effect: { kind: "armor", value: 30, tier: 2 } },
  { id: "armor_iron", name: "Iron Armor", category: "armor", cost: { gold: 12 }, desc: "Permanent — hold the bridge a lot longer.", effect: { kind: "armor", value: 45, tier: 3 } },
  { id: "armor_diamond", name: "Diamond Armor", category: "armor", cost: { emerald: 6 }, desc: "Permanent — the survivability win-button.", effect: { kind: "armor", value: 60, tier: 4 } },

  // ── tools: gather faster / cut wool. value = effectiveness multiplier-ish rank. ──
  { id: "tool_pickaxe_1", name: "Stone Pickaxe", category: "tools", cost: { iron: 10 }, desc: "Mine ore + raid blocks a little faster.", effect: { kind: "tool", value: 1, tier: 1 } },
  { id: "tool_pickaxe_2", name: "Iron Pickaxe", category: "tools", cost: { iron: 6, gold: 3 }, desc: "Faster mining — break stone defenses quicker.", effect: { kind: "tool", value: 2, tier: 2 } },
  { id: "tool_pickaxe_3", name: "Diamond Pickaxe", category: "tools", cost: { gold: 6, emerald: 2 }, desc: "Tear through blocks — even obsidian, eventually.", effect: { kind: "tool", value: 3, tier: 3 } },
  { id: "tool_shears", name: "Shears", category: "tools", cost: { iron: 20 }, desc: "Cut wool defenses instantly — the bed-rusher's tool.", effect: { kind: "tool", value: 1, tier: 1 } },

  // ── utility: the game-swinging gadgets. effect.kind names the gadget. ──
  { id: "util_heal_pool", name: "Healing Pool", category: "utility", cost: { gold: 3 }, desc: "Drop a pool by your bed — regen while you stand in it.", effect: { kind: "heal", value: 6 } },
  { id: "util_speed_pad", name: "Speed Pad", category: "utility", cost: { iron: 24 }, desc: "A boost pad — dash across the bridge.", effect: { kind: "speed", value: 40 } },
  { id: "util_tnt", name: "TNT", category: "utility", cost: { gold: 8 }, desc: "Blow a hole in a bed's defenses — the raid tool.", effect: { kind: "tnt", value: 80 } },
  { id: "util_fireball", name: "Fireball", category: "utility", cost: { iron: 40 }, desc: "Lob a fiery blast — clear bridges and chip wool.", effect: { kind: "fireball", value: 50 } },
  { id: "util_bridge_egg", name: "Bridge Egg", category: "utility", cost: { emerald: 1 }, desc: "Throw to auto-lay a wool bridge across the gap.", effect: { kind: "bridge", value: 12 } },
  { id: "util_bed_bug", name: "Bed Bug", category: "utility", cost: { gold: 2 }, desc: "A scurrying decoy that draws fire off you.", effect: { kind: "decoy", value: 15 } },
  { id: "util_dream_defender", name: "Dream Defender", category: "utility", cost: { gold: 5 }, desc: "Summon a guardian that defends your island.", effect: { kind: "guardian", value: 40 } },
  { id: "util_trap_alarm", name: "Alarm Trap", category: "utility", cost: { gold: 1 }, desc: "Reveals + slows the next invader who trips it.", effect: { kind: "trap", value: 1 } },
];

/** Resolve a shop item by id. undefined if no such id (mirrors gacha findEgg). */
export function bwItem(id: string): BwShopItem | undefined {
  return BW_SHOP.find((it) => it.id === id);
}

/** Can this wallet afford every tier of the item's cost? */
export function bwCanAfford(wallet: BwWallet, item: BwShopItem): boolean {
  return (Object.keys(item.cost) as BwResource[]).every(
    (r) => wallet[r] >= (item.cost[r] ?? 0),
  );
}

/** Returns a NEW wallet with the cost deducted (assumes affordable); pure —
 *  never mutates the input. */
export function bwBuy(wallet: BwWallet, item: BwShopItem): BwWallet {
  const next: BwWallet = { ...wallet };
  for (const r of Object.keys(item.cost) as BwResource[]) {
    next[r] -= item.cost[r] ?? 0;
  }
  return next;
}

/** Display order for the shop UI tabs. */
const BW_CATEGORY_ORDER: BwShopItem["category"][] = [
  "blocks", "melee", "ranged", "armor", "tools", "utility",
];

/** Items grouped for the shop UI, in tab order. Empty categories are dropped. */
export function bwShopByCategory(): { category: string; items: BwShopItem[] }[] {
  return BW_CATEGORY_ORDER
    .map((category) => ({ category, items: BW_SHOP.filter((it) => it.category === category) }))
    .filter((g) => g.items.length > 0);
}
