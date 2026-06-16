/**
 * Tiny localStorage-backed save file. Persists meta-progression across runs so
 * every death still earns something — the "one more run" hook. Degrades to an
 * in-memory object if storage is unavailable (private mode, etc.).
 */
export interface LifetimeStats {
  kills: number;
  crits: number;
  bossKills: number;
  drops: number;
  games: number;
}

/** A tradable loot item stored in the player's stash. */
export interface SavedItem {
  id: string;
  name: string;
  rarity: string;
  gold: number;
}

/** Login-streak tracking (UTC day buckets — see idle.ts dayUtc/settleStreak). */
export interface StreakState {
  count: number; // consecutive UTC days played (current streak length)
  lastDayUtc: number; // UTC day-index of the last day the streak advanced (0 = never)
  freezes: number; // banked "skip a day" tokens — forgive ONE missed day each
}

/** Daily-quest tracking, reset on UTC day change (see idle.ts rollDaily). */
export interface DailyState {
  dayUtc: number; // UTC day-index these quests belong to (0 = uninitialised)
  progress: Record<string, number>; // quest id -> current progress count
  claimed: string[]; // quest ids whose reward has already been paid out
}

/** One run on the personal leaderboard (top runs by round, then score). */
export interface ScoreEntry {
  round: number;
  score: number;
  date: number; // ms epoch the run ended
}

/** Max runs kept on the personal leaderboard. */
export const LEADERBOARD_CAP = 10;

/**
 * Pure insert: fold a finished run into the leaderboard and return the new top
 * list (sorted by round desc, then score desc, capped). Exported + side-effect
 * free so it's unit-testable. The `rank` is the 0-based slot the new run landed
 * in, or -1 if it didn't make the board.
 */
export function recordScore(board: ScoreEntry[], entry: ScoreEntry, cap = LEADERBOARD_CAP): { board: ScoreEntry[]; rank: number } {
  const next = [...board, entry].sort((a, b) => b.round - a.round || b.score - a.score).slice(0, cap);
  const rank = next.indexOf(entry);
  return { board: next, rank };
}

export interface SaveData {
  version: number; // save-schema version (for future migrations; starts at 1)
  name: string; // player display name shown to others in the island hub
  dailyChestDay: number; // UTC day-bucket the lobby daily chest was last claimed
  lastSeen: number; // ms epoch of the last writeSave (drives offline accrual)
  prestige: number; // ascension currency — permanent gold/essence multiplier
  lifetimeGold: number; // running total of all gold ever earned (prestige basis)
  streak: StreakState; // login-streak state
  daily: DailyState; // daily-quest state
  essence: number; // permanent meta currency
  gold: number; // tradable soft currency (earned by selling loot)
  goldEarned: number; // lifetime gold earned (stats / future token bridge)
  bestRound: number;
  bestScore: number;
  bestWave: number; // best Tower-Defense wave reached (endless leaderboard basis)
  tdBestScore: number; // best Tower-Defense run score (combo-fed; replay chase)
  tdDailyDay: number; // UTC day-bucket of the last TD Daily Challenge attempt
  tdDailyWave: number; // wave reached on that attempt (today's score)
  scores: ScoreEntry[]; // personal leaderboard: top runs (round desc, score desc)
  owned: string[]; // purchased meta-upgrade ids
  skins: string[]; // unlocked cosmetic skin ids
  skin: string; // equipped skin id
  claimed: string[]; // completed challenge ids
  stash: SavedItem[]; // tradable loot inventory
  pets: string[]; // owned companion pet ids (bought with gold)
  petLevels: Record<string, number>; // pet id -> level (1+), leveled with gold
  petProgress: Record<string, Record<string, number>>; // pet id -> evolution-trial counters
  benchedPets: string[]; // combat pet ids the player has manually benched (not in the active squad)
  stats: LifetimeStats;
  muted: boolean;
  musicVolume: number; // music volume 0..1 (the pause-menu slider; default 0.5)
}

const KEY = "tinydead.save.v1";

function blankStats(): LifetimeStats {
  return { kills: 0, crits: 0, bossKills: 0, drops: 0, games: 0 };
}

function blankStreak(): StreakState {
  return { count: 0, lastDayUtc: 0, freezes: 0 };
}

function blankDaily(): DailyState {
  return { dayUtc: 0, progress: {}, claimed: [] };
}

/** A friendly default display name (e.g. "Survivor4821") for the hub. */
function randomName(): string {
  return `Survivor${1000 + Math.floor(Math.random() * 9000)}`;
}

function blank(): SaveData {
  return {
    version: 1,
    name: randomName(),
    dailyChestDay: 0,
    lastSeen: 0,
    prestige: 0,
    lifetimeGold: 0,
    streak: blankStreak(),
    daily: blankDaily(),
    essence: 0,
    gold: 0,
    goldEarned: 0,
    bestRound: 0,
    bestScore: 0,
    bestWave: 0,
    tdBestScore: 0,
    tdDailyDay: 0,
    tdDailyWave: 0,
    scores: [],
    owned: [],
    skins: ["classic"],
    skin: "classic",
    claimed: [],
    stash: [],
    pets: [],
    petLevels: {},
    petProgress: {},
    benchedPets: [],
    stats: blankStats(),
    muted: false,
    musicVolume: 0.5,
  };
}

/** Coerce to a finite, non-negative number — guards against corrupt/forged
 *  saves where a field is null / NaN / a string (which would otherwise turn
 *  the whole economy into NaN and permanently break the shop). */
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sanitizeStash(raw: unknown): SavedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Partial<SavedItem>;
    if (typeof o.id !== "string" || typeof o.name !== "string" || typeof o.rarity !== "string") continue;
    out.push({ id: o.id, name: o.name, rarity: o.rarity, gold: num(o.gold) });
  }
  return out;
}

function strArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** Coerce the saved leaderboard: drop junk, re-sort, and cap (guards a forged
 *  save from injecting absurd entries or a giant array). */
function sanitizeScores(raw: unknown): ScoreEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ScoreEntry[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Partial<ScoreEntry>;
    out.push({ round: Math.floor(num(o.round)), score: Math.floor(num(o.score)), date: num(o.date) });
  }
  return out.sort((a, b) => b.round - a.round || b.score - a.score).slice(0, LEADERBOARD_CAP);
}

/** Nested pet-id -> { stat -> finite count } map; drops anything malformed. */
function sanitizePetProgress(raw: unknown): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (raw && typeof raw === "object") {
    for (const [id, counters] of Object.entries(raw as Record<string, unknown>)) {
      if (!counters || typeof counters !== "object") continue;
      const inner: Record<string, number> = {};
      for (const [k, v] of Object.entries(counters as Record<string, unknown>)) {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n) && n >= 0) inner[k] = n;
      }
      out[id] = inner;
    }
  }
  return out;
}

function sanitizeLevels(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n >= 1) out[k] = Math.floor(n);
    }
  }
  return out;
}

/** Coerce a freeform record of finite non-negative numbers (daily quest progress). */
function sanitizeNumMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
  }
  return out;
}

function sanitizeStreak(raw: unknown): StreakState {
  if (!raw || typeof raw !== "object") return blankStreak();
  const o = raw as Partial<StreakState>;
  return {
    count: Math.floor(num(o.count)),
    lastDayUtc: Math.floor(num(o.lastDayUtc)),
    freezes: Math.floor(num(o.freezes)),
  };
}

function sanitizeDaily(raw: unknown): DailyState {
  if (!raw || typeof raw !== "object") return blankDaily();
  const o = raw as Partial<DailyState>;
  return {
    dayUtc: Math.floor(num(o.dayUtc)),
    progress: sanitizeNumMap(o.progress),
    claimed: strArray(o.claimed),
  };
}

/**
 * Coerce ANY untrusted blob into a fully-valid SaveData. Shared by loadSave (the
 * localStorage path) and the cloud-save path so a blob fetched from the backend
 * is hardened identically to a local one (a forged cloud save can't poison the
 * economy). Pure + side-effect free.
 */
export function sanitizeSave(raw: unknown): SaveData {
  const data = (raw && typeof raw === "object" ? raw : {}) as Partial<SaveData>;
  const skins = strArray(data.skins);
  return {
    // version: clamp to >=1 so a corrupt/0 value still reads as the v1 schema.
    version: Math.max(1, Math.floor(num(data.version, 1))),
    name: typeof data.name === "string" && data.name.trim() ? data.name.slice(0, 16) : randomName(),
    dailyChestDay: Math.floor(num(data.dailyChestDay)),
    lastSeen: num(data.lastSeen),
    prestige: Math.floor(num(data.prestige)),
    lifetimeGold: num(data.lifetimeGold),
    streak: sanitizeStreak(data.streak),
    daily: sanitizeDaily(data.daily),
    essence: num(data.essence),
    gold: num(data.gold),
    goldEarned: num(data.goldEarned),
    bestRound: num(data.bestRound),
    bestScore: num(data.bestScore),
    bestWave: num(data.bestWave),
    tdBestScore: num(data.tdBestScore),
    tdDailyDay: num(data.tdDailyDay),
    tdDailyWave: num(data.tdDailyWave),
    scores: sanitizeScores(data.scores),
    owned: strArray(data.owned),
    skins: skins.length ? skins : ["classic"],
    skin: typeof data.skin === "string" ? data.skin : "classic",
    claimed: strArray(data.claimed),
    stash: sanitizeStash(data.stash),
    pets: strArray(data.pets),
    petLevels: sanitizeLevels(data.petLevels),
    petProgress: sanitizePetProgress(data.petProgress),
    benchedPets: strArray(data.benchedPets),
    stats: {
      kills: num(data.stats?.kills),
      crits: num(data.stats?.crits),
      bossKills: num(data.stats?.bossKills),
      drops: num(data.stats?.drops),
      games: num(data.stats?.games),
    },
    muted: !!data.muted,
    // music volume 0..1; clamp a forged/out-of-range value to the default
    musicVolume: Math.min(1, num(data.musicVolume, 0.5)),
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    return sanitizeSave(JSON.parse(raw));
  } catch {
    return blank();
  }
}

/** Union of two string lists: keep order, dedupe, lose nothing (left first). */
function unionStr(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...a, ...b]) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/** Per-key max of two numeric maps (union of keys). */
function maxMap(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

/**
 * Three-way reconcile of a LOCAL save and a CLOUD save into one that NEVER loses
 * progress. The newer side (greater lastSeen; ties → local) supplies the live
 * "current state" fields (balances, equipped, settings, dailies); everything
 * cumulative is combined so neither device can roll the other back:
 *  - monotonic bests/lifetimes → max
 *  - unlock lists → set union
 *  - pet levels / pet progress / lifetime stats → per-key max
 *  - leaderboard → concat + re-sort + cap
 * The result is run back through sanitizeSave so it's always structurally valid.
 * Pure + order-independent for every combined field. Exported for unit tests.
 */
export function mergeSaves(local: SaveData, cloud: SaveData): SaveData {
  const primary = cloud.lastSeen > local.lastSeen ? cloud : local; // ties → local
  const merged: SaveData = {
    // current-balance / equipped / state fields come from the newer side
    version: Math.max(local.version, cloud.version),
    name: primary.name,
    dailyChestDay: primary.dailyChestDay,
    lastSeen: primary.lastSeen,
    prestige: Math.max(local.prestige, cloud.prestige),
    lifetimeGold: Math.max(local.lifetimeGold, cloud.lifetimeGold),
    streak: primary.streak,
    daily: primary.daily,
    essence: primary.essence,
    gold: primary.gold,
    goldEarned: Math.max(local.goldEarned, cloud.goldEarned),
    bestRound: Math.max(local.bestRound, cloud.bestRound),
    bestScore: Math.max(local.bestScore, cloud.bestScore),
    bestWave: Math.max(local.bestWave, cloud.bestWave),
    tdBestScore: Math.max(local.tdBestScore, cloud.tdBestScore),
    tdDailyDay: primary.tdDailyDay,
    tdDailyWave: primary.tdDailyWave,
    scores: [...local.scores, ...cloud.scores].sort((a, b) => b.round - a.round || b.score - a.score).slice(0, LEADERBOARD_CAP),
    owned: unionStr(local.owned, cloud.owned),
    skins: unionStr(local.skins, cloud.skins),
    skin: primary.skin,
    claimed: unionStr(local.claimed, cloud.claimed),
    stash: primary.stash,
    pets: unionStr(local.pets, cloud.pets),
    petLevels: maxMap(local.petLevels, cloud.petLevels),
    petProgress: (() => {
      const out: Record<string, Record<string, number>> = {};
      for (const id of new Set([...Object.keys(local.petProgress), ...Object.keys(cloud.petProgress)])) {
        out[id] = maxMap(local.petProgress[id] ?? {}, cloud.petProgress[id] ?? {});
      }
      return out;
    })(),
    benchedPets: unionStr(local.benchedPets, cloud.benchedPets),
    stats: {
      kills: Math.max(local.stats.kills, cloud.stats.kills),
      crits: Math.max(local.stats.crits, cloud.stats.crits),
      bossKills: Math.max(local.stats.bossKills, cloud.stats.bossKills),
      drops: Math.max(local.stats.drops, cloud.stats.drops),
      games: Math.max(local.stats.games, cloud.stats.games),
    },
    muted: primary.muted,
    musicVolume: primary.musicVolume,
  };
  // Belt-and-braces: guarantee a structurally valid result.
  const out = sanitizeSave(merged);
  out.lastSeen = merged.lastSeen; // sanitizeSave preserves it, but keep it explicit
  return out;
}

export function writeSave(data: SaveData) {
  // Stamp the "last seen" wall-clock on every persist so offline accrual on the
  // next boot measures from the true last interaction (see idle.offlineGold).
  data.lastSeen = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — progression is session-only this run */
  }
}
