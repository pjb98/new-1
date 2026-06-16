/**
 * Security-surface tests for src/save.ts loadSave + its sanitizers.
 *
 * Forged / corrupt saves are an attack surface: a single NaN or string in a
 * numeric field would otherwise poison the whole economy. loadSave reads
 * localStorage, so we install a minimal in-memory localStorage shim on
 * globalThis BEFORE importing the module (the module captures the global at
 * call time, not import time, so a late shim is fine — but we set it up front
 * to be safe).
 *
 * Runner: `npm run test:save` -> node --test --experimental-strip-types
 * (mirrors the existing test:rating setup; save.ts has no THREE/DOM imports).
 */
import test from "node:test";
import assert from "node:assert/strict";

// ---- minimal localStorage shim -------------------------------------------
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const store = new MemStorage();
(globalThis as unknown as { localStorage: MemStorage }).localStorage = store;

const KEY = "tinydead.save.v1";

const { loadSave, recordScore, mergeSaves, sanitizeSave } = await import("../src/save.ts");

type SaveData = ReturnType<typeof loadSave>;

/** A fully-valid blank save (sanitizeSave({}) yields one) for building fixtures. */
function fresh(over: Record<string, unknown> = {}): SaveData {
  return sanitizeSave(over);
}

/** Helper: write a raw blob under the save key, then load it. */
function load(raw: unknown) {
  if (raw === undefined) store.removeItem(KEY);
  else store.setItem(KEY, typeof raw === "string" ? raw : JSON.stringify(raw));
  return loadSave();
}

test("missing save returns a valid blank", () => {
  const s = load(undefined);
  assert.equal(s.essence, 0);
  assert.equal(s.gold, 0);
  assert.deepEqual(s.skins, ["classic"]);
  assert.equal(s.skin, "classic");
  assert.deepEqual(s.owned, []);
  assert.deepEqual(s.stash, []);
  assert.deepEqual(s.pets, []);
  assert.deepEqual(s.petLevels, {});
  assert.deepEqual(s.petProgress, {});
  assert.deepEqual(s.stats, { kills: 0, crits: 0, bossKills: 0, drops: 0, games: 0 });
  assert.equal(s.muted, false);
});

test("totally garbage (non-JSON) blob returns a valid blank", () => {
  const s = load("this is not json {{{");
  assert.equal(s.essence, 0);
  assert.deepEqual(s.skins, ["classic"]);
  assert.deepEqual(s.stats, { kills: 0, crits: 0, bossKills: 0, drops: 0, games: 0 });
});

test("blank save starts with an empty leaderboard", () => {
  assert.deepEqual(load(undefined).scores, []);
});

test("leaderboard sanitizer drops junk, sorts by round then score, and caps", () => {
  const scores = [
    { round: 5, score: 100, date: 1 },
    "garbage",
    { round: 20, score: 50, date: 2 },
    { round: 20, score: 999, date: 3 }, // same round, higher score → ranks above
    { round: -3, score: 1e9, date: 4 }, // negative round coerced to 0
    null,
  ];
  const s = load({ scores });
  assert.equal(s.scores[0].round, 20);
  assert.equal(s.scores[0].score, 999); // higher score wins the tie
  assert.equal(s.scores[1].round, 20);
  assert.equal(s.scores[1].score, 50);
  assert.equal(s.scores[2].round, 5);
  assert.ok(s.scores.every((e) => Number.isFinite(e.round) && e.round >= 0));
});

test("recordScore inserts in sorted order and reports the rank", () => {
  const board = [
    { round: 30, score: 500, date: 1 },
    { round: 10, score: 200, date: 2 },
  ];
  const entry = { round: 20, score: 300, date: 3 };
  const { board: next, rank } = recordScore(board, entry);
  assert.equal(rank, 1); // lands between R30 and R10
  assert.equal(next[1], entry);
  assert.equal(next.length, 3);
});

test("recordScore caps the board and returns -1 when a run doesn't make it", () => {
  const full = Array.from({ length: 10 }, (_, i) => ({ round: 100 - i, score: 0, date: i }));
  const tooLow = { round: 1, score: 0, date: 99 };
  const { board, rank } = recordScore(full, tooLow);
  assert.equal(board.length, 10);
  assert.equal(rank, -1); // didn't crack the top 10
});

test("JSON 'null' blob returns a valid blank", () => {
  const s = load("null");
  assert.equal(s.gold, 0);
  assert.deepEqual(s.owned, []);
});

test("numeric fields: NaN / string / null / negative / missing all default to 0", () => {
  const s = load({
    essence: "abc", // non-numeric string -> NaN -> 0
    gold: null, // null -> 0
    goldEarned: -50, // negative -> 0 (rejected)
    bestRound: Number.NaN, // serialises to null in JSON, then NaN -> 0
    // bestScore missing entirely -> 0
  });
  assert.equal(s.essence, 0);
  assert.equal(s.gold, 0);
  assert.equal(s.goldEarned, 0);
  assert.equal(s.bestRound, 0);
  assert.equal(s.bestScore, 0);
});

test("numeric fields: valid non-negative numbers (incl. numeric strings) pass through", () => {
  const s = load({ essence: 123, gold: "456", goldEarned: 0, bestRound: 7.5, bestScore: 9001 });
  assert.equal(s.essence, 123);
  assert.equal(s.gold, 456); // Number("456") === 456 is accepted
  assert.equal(s.goldEarned, 0);
  assert.equal(s.bestRound, 7.5);
  assert.equal(s.bestScore, 9001);
});

test("non-array owned/skins/claimed/pets become [] (skins falls back to classic)", () => {
  const s = load({ owned: "nope", skins: 42, claimed: { a: 1 }, pets: null });
  assert.deepEqual(s.owned, []);
  assert.deepEqual(s.skins, ["classic"]); // empty -> default skin
  assert.deepEqual(s.claimed, []);
  assert.deepEqual(s.pets, []);
});

test("string arrays drop non-string members", () => {
  const s = load({ owned: ["a", 1, null, "b", {}], skins: ["red", 2, "blue"], pets: ["dog", false] });
  assert.deepEqual(s.owned, ["a", "b"]);
  assert.deepEqual(s.skins, ["red", "blue"]);
  assert.deepEqual(s.pets, ["dog"]);
});

test("skin: non-string defaults to 'classic'", () => {
  assert.equal(load({ skin: 12345 }).skin, "classic");
  assert.equal(load({ skin: null }).skin, "classic");
  assert.equal(load({ skin: "midnight" }).skin, "midnight");
});

test("stats: non-object / NaN / negative members default to 0", () => {
  const s = load({ stats: { kills: -5, crits: "x", bossKills: null, drops: 3, games: Number.NaN } });
  assert.deepEqual(s.stats, { kills: 0, crits: 0, bossKills: 0, drops: 3, games: 0 });
});

test("stats: a non-object stats blob yields all-zero stats", () => {
  assert.deepEqual(load({ stats: "broken" }).stats, { kills: 0, crits: 0, bossKills: 0, drops: 0, games: 0 });
  assert.deepEqual(load({ stats: null }).stats, { kills: 0, crits: 0, bossKills: 0, drops: 0, games: 0 });
  assert.deepEqual(load({ stats: 99 }).stats, { kills: 0, crits: 0, bossKills: 0, drops: 0, games: 0 });
});

test("stash: a corrupt item is dropped, valid items kept (gold coerced)", () => {
  const s = load({
    stash: [
      { id: "i1", name: "Sword", rarity: "rare", gold: 100 }, // valid
      { id: "i2", name: "Shield", rarity: "common", gold: "bad" }, // gold NaN -> 0, item kept
      { id: 5, name: "X", rarity: "r", gold: 1 }, // id not string -> dropped
      { name: "NoId", rarity: "r", gold: 1 }, // missing id -> dropped
      { id: "i5", rarity: "r", gold: 1 }, // missing name -> dropped
      null, // -> dropped
      "string", // -> dropped
      42, // -> dropped
    ],
  });
  assert.deepEqual(s.stash, [
    { id: "i1", name: "Sword", rarity: "rare", gold: 100 },
    { id: "i2", name: "Shield", rarity: "common", gold: 0 },
  ]);
});

test("stash: negative gold on an item is rejected to 0", () => {
  const s = load({ stash: [{ id: "x", name: "n", rarity: "r", gold: -777 }] });
  assert.deepEqual(s.stash, [{ id: "x", name: "n", rarity: "r", gold: 0 }]);
});

test("stash: non-array becomes []", () => {
  assert.deepEqual(load({ stash: "nope" }).stash, []);
  assert.deepEqual(load({ stash: { 0: { id: "a", name: "b", rarity: "c", gold: 1 } } }).stash, []);
});

test("petLevels: non-object -> {}, members < 1 / NaN dropped, valid floored", () => {
  assert.deepEqual(load({ petLevels: "nope" }).petLevels, {});
  const s = load({ petLevels: { dog: 3.9, cat: 0, bird: -2, fish: "x", owl: 1 } });
  assert.deepEqual(s.petLevels, { dog: 3, owl: 1 }); // 0/-2/NaN dropped; 3.9 floored
});

test("petProgress: nested map cleaned; non-object inner / NaN / negative dropped", () => {
  const s = load({
    petProgress: {
      dog: { kills: 10, crits: "bad", neg: -3, ok: 0 }, // kills+ok kept, crits/neg dropped
      cat: "not-an-object", // inner non-object -> still produces an entry? see assertion
      bird: { x: 5.5 },
    },
  });
  assert.deepEqual(s.petProgress.dog, { kills: 10, ok: 0 });
  assert.deepEqual(s.petProgress.bird, { x: 5.5 });
  // "cat" had a non-object counter map -> skipped entirely (no key)
  assert.equal("cat" in s.petProgress, false);
});

test("petProgress: non-object top-level -> {}", () => {
  assert.deepEqual(load({ petProgress: 123 }).petProgress, {});
  assert.deepEqual(load({ petProgress: null }).petProgress, {});
});

test("muted coerces to a strict boolean", () => {
  assert.equal(load({ muted: 1 }).muted, true);
  assert.equal(load({ muted: 0 }).muted, false);
  assert.equal(load({ muted: "yes" }).muted, true);
  assert.equal(load({ muted: undefined }).muted, false);
});

// ---- v1 idle/prestige fields (migration defaults + sanitization) ----------

test("missing idle fields default cleanly (version 1, zeroed currencies, blank streak/daily)", () => {
  const s = load({ essence: 5 }); // legacy save with no idle fields
  assert.equal(s.version, 1);
  assert.equal(s.lastSeen, 0);
  assert.equal(s.prestige, 0);
  assert.equal(s.lifetimeGold, 0);
  assert.deepEqual(s.streak, { count: 0, lastDayUtc: 0, freezes: 0 });
  assert.deepEqual(s.daily, { dayUtc: 0, progress: {}, claimed: [] });
});

test("version clamps to >=1 even when corrupt/zero/negative", () => {
  assert.equal(load({ version: 0 }).version, 1);
  assert.equal(load({ version: -3 }).version, 1);
  assert.equal(load({ version: "bad" }).version, 1);
  assert.equal(load({ version: 2 }).version, 2);
  assert.equal(load({ version: 3.9 }).version, 3); // floored
});

test("prestige/lifetimeGold/lastSeen coerce like other numerics (NaN/neg/string -> 0)", () => {
  const s = load({ prestige: -5, lifetimeGold: "abc", lastSeen: Number.NaN });
  assert.equal(s.prestige, 0);
  assert.equal(s.lifetimeGold, 0);
  assert.equal(s.lastSeen, 0);
  const t = load({ prestige: 4.7, lifetimeGold: 12345, lastSeen: 1700000000000 });
  assert.equal(t.prestige, 4); // floored
  assert.equal(t.lifetimeGold, 12345);
  assert.equal(t.lastSeen, 1700000000000);
});

test("streak: corrupt members floor/zero; non-object -> blank", () => {
  assert.deepEqual(load({ streak: "nope" }).streak, { count: 0, lastDayUtc: 0, freezes: 0 });
  const s = load({ streak: { count: 6.9, lastDayUtc: -2, freezes: "x" } });
  assert.deepEqual(s.streak, { count: 6, lastDayUtc: 0, freezes: 0 });
});

test("daily: progress keeps finite non-negative; claimed drops non-strings; non-object -> blank", () => {
  assert.deepEqual(load({ daily: 99 }).daily, { dayUtc: 0, progress: {}, claimed: [] });
  const s = load({
    daily: { dayUtc: 20000.5, progress: { runs: 1, kills: -3, bad: "x", ok: 0 }, claimed: ["runs", 5, null] },
  });
  assert.equal(s.daily.dayUtc, 20000); // floored
  assert.deepEqual(s.daily.progress, { runs: 1, ok: 0 }); // negatives/NaN dropped
  assert.deepEqual(s.daily.claimed, ["runs"]); // non-strings dropped
  assert.equal(Array.isArray(s.daily.progress), false);
});

test("a fully-forged adversarial blob still yields a structurally valid save", () => {
  const s = load({
    essence: "9e999", // -> Number("9e999") === Infinity -> not finite -> 0
    gold: Infinity, // serialises to null -> 0
    owned: 12345,
    skins: [null, null],
    stash: [{}],
    pets: "x",
    petLevels: [1, 2, 3], // array is typeof object -> entries by index, all < 1? values 1,2,3 floored -> {0:?}
    petProgress: { a: [1] }, // inner array typeof object
    stats: [],
    muted: [],
    version: [],
    prestige: "lots",
    lifetimeGold: -1,
    streak: 42,
    daily: [1, 2],
  });
  // idle fields safe
  assert.equal(s.version, 1);
  assert.equal(s.prestige, 0);
  assert.equal(s.lifetimeGold, 0);
  assert.deepEqual(s.streak, { count: 0, lastDayUtc: 0, freezes: 0 });
  assert.deepEqual(s.daily, { dayUtc: 0, progress: {}, claimed: [] });
  // economy fields safe
  assert.equal(Number.isFinite(s.essence), true);
  assert.equal(s.essence, 0);
  assert.equal(s.gold, 0);
  // arrays valid
  assert.ok(Array.isArray(s.owned) && s.owned.length === 0);
  assert.deepEqual(s.skins, ["classic"]);
  assert.ok(Array.isArray(s.stash) && s.stash.length === 0);
  assert.ok(Array.isArray(s.pets) && s.pets.length === 0);
  // maps are plain objects with only finite values
  for (const v of Object.values(s.petLevels)) assert.ok(Number.isFinite(v) && v >= 1);
  for (const inner of Object.values(s.petProgress))
    for (const v of Object.values(inner)) assert.ok(Number.isFinite(v) && v >= 0);
  // stats fully zeroed (array .kills etc are undefined -> 0)
  assert.deepEqual(s.stats, { kills: 0, crits: 0, bossKills: 0, drops: 0, games: 0 });
  assert.equal(s.muted, true); // [] is truthy
});

// ---- mergeSaves: cloud ↔ local reconcile (never loses progress) -----------

test("mergeSaves: unlock lists are a UNION keeping items from BOTH sides", () => {
  const local = fresh({ owned: ["a", "b"], skins: ["classic", "red"], claimed: ["c1"], pets: ["dog"], benchedPets: ["dog"] });
  const cloud = fresh({ owned: ["b", "c"], skins: ["classic", "blue"], claimed: ["c2"], pets: ["cat"], benchedPets: ["cat"] });
  const m = mergeSaves(local, cloud);
  assert.deepEqual(m.owned, ["a", "b", "c"]);
  assert.deepEqual(m.skins, ["classic", "red", "blue"]); // order preserved, deduped
  assert.deepEqual(m.claimed, ["c1", "c2"]);
  assert.deepEqual(m.pets, ["dog", "cat"]);
  assert.deepEqual(m.benchedPets, ["dog", "cat"]);
});

test("mergeSaves: monotonic bests/lifetimes take the MAX of the two sides", () => {
  const local = fresh({ bestRound: 30, bestScore: 5, bestWave: 2, tdBestScore: 100, lifetimeGold: 10, goldEarned: 7, prestige: 1 });
  const cloud = fresh({ bestRound: 12, bestScore: 9000, bestWave: 40, tdBestScore: 50, lifetimeGold: 999, goldEarned: 3, prestige: 4 });
  const m = mergeSaves(local, cloud);
  assert.equal(m.bestRound, 30);
  assert.equal(m.bestScore, 9000);
  assert.equal(m.bestWave, 40);
  assert.equal(m.tdBestScore, 100);
  assert.equal(m.lifetimeGold, 999);
  assert.equal(m.goldEarned, 7);
  assert.equal(m.prestige, 4);
});

test("mergeSaves: balances/equipped/settings follow the NEWER lastSeen", () => {
  const older = fresh({ lastSeen: 1000, gold: 10, essence: 1, name: "Old", skin: "red", muted: true, musicVolume: 0.2, tdDailyWave: 3 });
  const newer = fresh({ lastSeen: 2000, gold: 999, essence: 50, name: "New", skin: "blue", muted: false, musicVolume: 0.9, tdDailyWave: 7 });
  // newer is cloud
  const a = mergeSaves(older, newer);
  assert.equal(a.gold, 999);
  assert.equal(a.essence, 50);
  assert.equal(a.name, "New");
  assert.equal(a.skin, "blue");
  assert.equal(a.muted, false);
  assert.equal(a.musicVolume, 0.9);
  assert.equal(a.tdDailyWave, 7);
  assert.equal(a.lastSeen, 2000);
  // newer is local — same winner regardless of side
  const b = mergeSaves(newer, older);
  assert.equal(b.gold, 999);
  assert.equal(b.name, "New");
});

test("mergeSaves: equal lastSeen → LOCAL wins the current-state tie", () => {
  const local = fresh({ lastSeen: 5000, gold: 111, name: "Local" });
  const cloud = fresh({ lastSeen: 5000, gold: 222, name: "Cloud" });
  const m = mergeSaves(local, cloud);
  assert.equal(m.gold, 111);
  assert.equal(m.name, "Local");
});

test("mergeSaves: petLevels are a per-key MAX (union of keys)", () => {
  const local = fresh({ petLevels: { dog: 5, cat: 2 } });
  const cloud = fresh({ petLevels: { dog: 3, owl: 7 } });
  const m = mergeSaves(local, cloud);
  assert.deepEqual(m.petLevels, { dog: 5, cat: 2, owl: 7 });
});

test("mergeSaves: petProgress is per-pet, per-counter MAX", () => {
  const local = fresh({ petProgress: { dog: { kills: 10, casts: 1 } } });
  const cloud = fresh({ petProgress: { dog: { kills: 4, evos: 2 }, cat: { kills: 9 } } });
  const m = mergeSaves(local, cloud);
  assert.deepEqual(m.petProgress.dog, { kills: 10, casts: 1, evos: 2 });
  assert.deepEqual(m.petProgress.cat, { kills: 9 });
});

test("mergeSaves: lifetime stats are per-field MAX", () => {
  const local = fresh({ stats: { kills: 100, crits: 5, bossKills: 1, drops: 2, games: 9 } });
  const cloud = fresh({ stats: { kills: 50, crits: 50, bossKills: 3, drops: 1, games: 4 } });
  const m = mergeSaves(local, cloud);
  assert.deepEqual(m.stats, { kills: 100, crits: 50, bossKills: 3, drops: 2, games: 9 });
});

test("mergeSaves: leaderboard concats, re-sorts (round desc, score desc), caps", () => {
  const local = fresh({ scores: [{ round: 30, score: 5, date: 1 }, { round: 10, score: 1, date: 2 }] });
  const cloud = fresh({ scores: [{ round: 30, score: 999, date: 3 }, { round: 20, score: 1, date: 4 }] });
  const m = mergeSaves(local, cloud);
  assert.equal(m.scores[0].round, 30);
  assert.equal(m.scores[0].score, 999); // higher score wins the round-30 tie
  assert.equal(m.scores[1].round, 30);
  assert.equal(m.scores[1].score, 5);
  assert.equal(m.scores[2].round, 20);
  assert.equal(m.scores[3].round, 10);
  assert.ok(m.scores.length <= 10);
});

test("mergeSaves: blank() + a rich save NEVER drops the rich side", () => {
  const blankLocal = fresh(); // pristine
  const rich = fresh({
    lastSeen: 9999,
    gold: 12345,
    essence: 200,
    owned: ["a", "b", "c"],
    skins: ["classic", "gold", "void"],
    pets: ["dog", "cat", "owl"],
    petLevels: { dog: 9 },
    bestRound: 77,
    tdBestScore: 4242,
    stats: { kills: 1000, crits: 100, bossKills: 10, drops: 50, games: 200 },
    scores: [{ round: 77, score: 8000, date: 1 }],
  });
  const m = mergeSaves(blankLocal, rich);
  assert.equal(m.gold, 12345);
  assert.equal(m.essence, 200);
  assert.deepEqual(m.owned, ["a", "b", "c"]);
  assert.deepEqual(m.pets, ["dog", "cat", "owl"]);
  assert.equal(m.petLevels.dog, 9);
  assert.equal(m.bestRound, 77);
  assert.equal(m.tdBestScore, 4242);
  assert.equal(m.stats.kills, 1000);
  assert.equal(m.scores[0].score, 8000);
  // and the reverse direction (rich is local, blank is cloud) keeps it too
  const m2 = mergeSaves(rich, blankLocal);
  assert.equal(m2.gold, 12345);
  assert.deepEqual(m2.pets, ["dog", "cat", "owl"]);
  assert.equal(m2.bestRound, 77);
});

test("mergeSaves: monotonic fields are ORDER-INDEPENDENT (a∪b === b∪a)", () => {
  const a = fresh({ lastSeen: 1, bestRound: 30, bestWave: 5, tdBestScore: 9, lifetimeGold: 100, prestige: 2, petLevels: { dog: 5 }, stats: { kills: 10, crits: 0, bossKills: 0, drops: 0, games: 0 }, owned: ["x"], pets: ["dog"] });
  const b = fresh({ lastSeen: 2, bestRound: 12, bestWave: 40, tdBestScore: 99, lifetimeGold: 50, prestige: 9, petLevels: { dog: 2, cat: 8 }, stats: { kills: 3, crits: 7, bossKills: 0, drops: 0, games: 0 }, owned: ["y"], pets: ["cat"] });
  const ab = mergeSaves(a, b);
  const ba = mergeSaves(b, a);
  // monotonic / set-union fields must match regardless of argument order
  assert.equal(ab.bestRound, ba.bestRound);
  assert.equal(ab.bestWave, ba.bestWave);
  assert.equal(ab.tdBestScore, ba.tdBestScore);
  assert.equal(ab.lifetimeGold, ba.lifetimeGold);
  assert.equal(ab.prestige, ba.prestige);
  assert.deepEqual(ab.petLevels, ba.petLevels);
  assert.deepEqual(ab.stats, ba.stats);
  assert.deepEqual([...ab.owned].sort(), [...ba.owned].sort());
  assert.deepEqual([...ab.pets].sort(), [...ba.pets].sort());
});

test("mergeSaves: result is always a structurally valid SaveData", () => {
  const m = mergeSaves(fresh({ gold: 5 }), fresh({ essence: 9 }));
  // run through sanitizeSave again — a valid save is a fixed point
  assert.deepEqual(sanitizeSave(m), m);
  assert.deepEqual(m.skins.length >= 1, true);
});
