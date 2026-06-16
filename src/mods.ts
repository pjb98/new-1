/**
 * Run-modifier bundle. Both permanent meta-upgrades (bought between runs) and
 * in-run level-up picks write into the same shape, and the combat/movement code
 * reads from it each frame. One place to add a new stat knob.
 */
export interface RunMods {
  damageMul: number;
  fireRateMul: number;
  reloadMul: number;
  moveSpeedMul: number;
  maxHealthBonus: number;
  critChance: number; // 0..1 chance any hit crits (on top of precise center hits)
  critMul: number; // crit damage multiplier
  lifeSteal: number; // hp restored per kill
  comboWindowBonus: number; // extra seconds before a combo decays
  essenceMul: number; // meta-currency earned at end of run
  dropChance: number; // base chance a kill drops loot
  startPointsBonus: number;
  startWeapon?: string; // weapon id to start the run with (meta unlock)

  // ---- behavior upgrades (0 = off) ----
  bonusPellets: number; // +projectiles per shot (multishot)
  bulletScaleMul: number; // bigger bullets
  pierceBonus: number; // +enemies pierced
  homing: number; // 0/1: bullets curve toward enemies
  ricochet: number; // bounces to another enemy after a hit
  explosiveRadius: number; // every bullet splashes on impact
  detonate: number; // killed zombies explode (radius)
  chainCount: number; // hits arc lightning to N nearby enemies
  cryoSlow: number; // 0..1: hits slow zombies by this fraction
  thorns: number; // damage dealt to zombies that touch you
  dodge: number; // 0..1 chance to ignore a hit
  healNova: number; // HP healed every 10th kill
  adrenaline: number; // 0/1: fire rate ramps as HP drops

  // ---- active↔idle cross-coupling (multiplicative, capped — see config SYNERGY) ----
  bankerFromWeapon: number; // 0..N: scales how much the run's damage tier feeds banker gold rate
  essenceFromBankers: number; // 0..N: scales how much owned banker levels feed end-of-run essence

  // ---- build-defining "transform" picks (VS-style; flags resolved at pick-time) ----
  pierceExplode: number; // 0/1: chosen → guarantees a pierce + explosive floor on ALL shots
  critChain: number; // 0/1: chosen → guarantees a crit + chain floor (crits arc lightning)
}

export function defaultMods(): RunMods {
  return {
    damageMul: 1,
    fireRateMul: 1,
    reloadMul: 1,
    moveSpeedMul: 1,
    maxHealthBonus: 0,
    critChance: 0,
    critMul: 2,
    lifeSteal: 0,
    comboWindowBonus: 0,
    essenceMul: 1,
    dropChance: 0.08,
    startPointsBonus: 0,
    startWeapon: undefined,
    bonusPellets: 0,
    bulletScaleMul: 1,
    pierceBonus: 0,
    homing: 0,
    ricochet: 0,
    explosiveRadius: 0,
    detonate: 0,
    chainCount: 0,
    cryoSlow: 0,
    thorns: 0,
    dodge: 0,
    healNova: 0,
    adrenaline: 0,
    bankerFromWeapon: 0,
    essenceFromBankers: 0,
    pierceExplode: 0,
    critChain: 0,
  };
}

/** Shallow copy for previewing an upgrade without committing it. */
export function cloneMods(m: RunMods): RunMods {
  return { ...m };
}

type FieldMeta = { key: keyof RunMods; label: string; fmt: (v: number) => string };
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Human-readable metadata for the stat fields run-upgrades can change. */
const FIELDS: FieldMeta[] = [
  { key: "damageMul", label: "Damage", fmt: pct },
  { key: "fireRateMul", label: "Fire Rate", fmt: pct },
  { key: "reloadMul", label: "Reload", fmt: pct },
  { key: "moveSpeedMul", label: "Move Speed", fmt: pct },
  { key: "maxHealthBonus", label: "Bonus HP", fmt: (v) => `+${v}` },
  { key: "critChance", label: "Crit Chance", fmt: pct },
  { key: "critMul", label: "Crit Dmg", fmt: (v) => `${v.toFixed(1)}×` },
  { key: "lifeSteal", label: "Life Steal", fmt: (v) => `${v} HP` },
  { key: "comboWindowBonus", label: "Combo Time", fmt: (v) => `+${v}s` },
  { key: "dropChance", label: "Loot Chance", fmt: pct },
  { key: "bonusPellets", label: "Extra Shots", fmt: (v) => `+${v}` },
  { key: "pierceBonus", label: "Pierce", fmt: (v) => `+${v}` },
  { key: "bulletScaleMul", label: "Bullet Size", fmt: pct },
  { key: "ricochet", label: "Ricochet", fmt: (v) => `+${v}` },
  { key: "chainCount", label: "Chain", fmt: (v) => `+${v}` },
  { key: "dodge", label: "Dodge", fmt: pct },
];

export interface ModDelta {
  label: string;
  from: string;
  to: string;
}

/** Diff two mod bundles into a list of changed stats for UI previews. */
export function diffMods(before: RunMods, after: RunMods): ModDelta[] {
  const out: ModDelta[] = [];
  for (const f of FIELDS) {
    const a = before[f.key] as number;
    const b = after[f.key] as number;
    if (a !== b) out.push({ label: f.label, from: f.fmt(a), to: f.fmt(b) });
  }
  return out;
}
