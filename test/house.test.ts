/**
 * Tests for src/house.ts sanitizeHouse — validates/clamps HouseData that
 * arrives from storage or the network (a forgery surface, like save.ts).
 *
 * house.ts transitively imports THREE (via ./palette) and ./pets, and uses
 * extensionless relative imports + TS parameter properties (in pets.ts). The
 * stock `--experimental-strip-types` runner cannot load that chain, so this
 * suite runs via `npm run test:house`, which adds:
 *   --import ./test/resolve-hook.mjs   (resolves extensionless ./x -> ./x.ts)
 *   --experimental-transform-types     (handles parameter properties/enums)
 * No new npm dependency — both are built-in Node 22 features.
 *
 * sanitizeHouse never constructs THREE objects, so importing the module just
 * needs the chain to *load*; the function under test is pure data validation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeHouse, HOUSE_PARTS } from "../src/house.ts";
import { findAnyPet } from "../src/pets.ts";

const part = (over: Record<string, unknown> = {}) => ({ kind: "wall", gx: 0, gy: 0, gz: 0, ...over });

test("non-object / garbage input -> { parts: [] }", () => {
  assert.deepEqual(sanitizeHouse(null), { parts: [] });
  assert.deepEqual(sanitizeHouse(undefined), { parts: [] });
  assert.deepEqual(sanitizeHouse(42), { parts: [] });
  assert.deepEqual(sanitizeHouse("nope"), { parts: [] });
  assert.deepEqual(sanitizeHouse({}), { parts: [] }); // no parts field
  assert.deepEqual(sanitizeHouse({ parts: "x" }), { parts: [] }); // parts not array
  assert.deepEqual(sanitizeHouse({ parts: {} }), { parts: [] });
});

test("non-object array members are skipped", () => {
  const r = sanitizeHouse({ parts: [null, 5, "x", true, part()] });
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].kind, "wall");
});

test("invalid kind is dropped; every catalogued kind is accepted", () => {
  assert.deepEqual(sanitizeHouse({ parts: [part({ kind: "nuke" })] }), { parts: [] });
  assert.deepEqual(sanitizeHouse({ parts: [part({ kind: 123 })] }), { parts: [] });
  for (const def of HOUSE_PARTS) {
    const r = sanitizeHouse({ parts: [part({ kind: def.kind })] });
    assert.equal(r.parts.length, 1, `kind ${def.kind} should be accepted`);
    assert.equal(r.parts[0].kind, def.kind);
  }
});

test("grid clamp: gx/gz must be within [-2..2], gy within [0..4]", () => {
  const ok = (gx: number, gy: number, gz: number) =>
    sanitizeHouse({ parts: [part({ gx, gy, gz })] }).parts.length === 1;
  // valid corners + bounds
  assert.ok(ok(-2, 0, -2));
  assert.ok(ok(2, 4, 2));
  assert.ok(ok(0, 0, 0));
  // out of range on each axis
  assert.ok(!ok(3, 0, 0), "gx 3");
  assert.ok(!ok(-3, 0, 0), "gx -3");
  assert.ok(!ok(0, 0, 3), "gz 3");
  assert.ok(!ok(0, 0, -3), "gz -3");
  assert.ok(!ok(0, -1, 0), "gy -1");
  assert.ok(!ok(0, 5, 0), "gy 5");
});

test("non-finite grid coords are rejected (NaN-producing string / Infinity)", () => {
  // Number("a") -> NaN -> not finite -> dropped
  assert.equal(sanitizeHouse({ parts: [part({ gx: "a" })] }).parts.length, 0);
  // Number(Infinity) -> Infinity -> not finite -> dropped
  assert.equal(sanitizeHouse({ parts: [part({ gy: Infinity })] }).parts.length, 0);
  assert.equal(sanitizeHouse({ parts: [part({ gz: -Infinity })] }).parts.length, 0);
});

test("null/undefined/missing grid coords coerce to 0 and are kept (Number(null)===0)", () => {
  // Documents real behaviour: a null/absent coord is treated as 0 (in range),
  // mirroring save.ts's num() coercion. Live (non-JSON) objects can carry null.
  assert.equal(sanitizeHouse({ parts: [part({ gz: null })] }).parts.length, 1);
  assert.equal(sanitizeHouse({ parts: [part({ gz: null })] }).parts[0].gz, 0);
  // ...but a fully-absent coord is Number(undefined) === NaN -> dropped.
  assert.equal(sanitizeHouse({ parts: [{ kind: "wall" }] }).parts.length, 0);
});

test("numeric-string grid coords are coerced and kept", () => {
  const r = sanitizeHouse({ parts: [part({ gx: "1", gy: "2", gz: "-1" })] });
  assert.equal(r.parts.length, 1);
  assert.deepEqual([r.parts[0].gx, r.parts[0].gy, r.parts[0].gz], [1, 2, -1]);
});

test("rot is normalised into 0..3 (mod 4, wrapping negatives); absent stays absent", () => {
  const rot = (v: unknown) => sanitizeHouse({ parts: [part({ rot: v })] }).parts[0]?.rot;
  assert.equal(rot(0), undefined); // rot 0 is falsy -> not emitted (stays default 0)
  assert.equal(rot(1), 1);
  assert.equal(rot(3), 3);
  assert.equal(rot(4), undefined); // 4 % 4 === 0 -> falsy -> omitted
  assert.equal(rot(5), 1);
  assert.equal(rot(-1), 3); // ((-1 % 4)+4)%4 === 3
  assert.equal(rot(7), 3);
  assert.equal(rot("nope"), undefined); // non-finite -> undefined
});

test("color: only a number passes through; anything else dropped", () => {
  assert.equal(sanitizeHouse({ parts: [part({ color: 0xff00ff })] }).parts[0].color, 0xff00ff);
  assert.equal(sanitizeHouse({ parts: [part({ color: "#fff" })] }).parts[0].color, undefined);
  assert.equal(sanitizeHouse({ parts: [part({ color: null })] }).parts[0].color, undefined);
});

test("petId kept only on a perch and only when it names a real pet", () => {
  // find a real pet id to use as a valid case
  // (probe a few common ids; fall back to scanning is not exported, so rely on findAnyPet)
  let realId: string | undefined;
  for (const cand of ["dog", "cat", "bird", "wolf", "fox", "owl", "ghost", "slime", "drake"]) {
    if (findAnyPet(cand)) { realId = cand; break; }
  }
  assert.ok(realId, "expected at least one known pet id to exist for the test");

  // valid pet on a perch -> kept
  const onPerch = sanitizeHouse({ parts: [part({ kind: "perch", petId: realId })] });
  assert.equal(onPerch.parts[0].petId, realId);

  // valid pet on a NON-perch -> dropped
  const onWall = sanitizeHouse({ parts: [part({ kind: "wall", petId: realId })] });
  assert.equal(onWall.parts[0].petId, undefined);

  // unknown pet on a perch -> dropped
  const bogus = sanitizeHouse({ parts: [part({ kind: "perch", petId: "definitely-not-a-pet" })] });
  assert.equal(bogus.parts[0].petId, undefined);

  // non-string petId on a perch -> dropped
  const nonStr = sanitizeHouse({ parts: [part({ kind: "perch", petId: 5 })] });
  assert.equal(nonStr.parts[0].petId, undefined);
});

test("tier kept only on a trophy and clamped/floored into 0..3", () => {
  const tier = (kind: string, v: unknown) =>
    sanitizeHouse({ parts: [part({ kind, tier: v })] }).parts[0]?.tier;
  assert.equal(tier("trophy", 0), 0);
  assert.equal(tier("trophy", 2), 2);
  assert.equal(tier("trophy", 3), 3);
  assert.equal(tier("trophy", 9), 3); // clamp high
  assert.equal(tier("trophy", -4), 0); // clamp low
  assert.equal(tier("trophy", 1.9), 1); // floor
  assert.equal(tier("trophy", "2"), 2); // numeric string coerced
  assert.equal(tier("trophy", "x"), undefined); // non-finite -> omitted
  // tier on a non-trophy is ignored
  assert.equal(tier("wall", 2), undefined);
});

test("400-part hard cap is enforced", () => {
  const parts = Array.from({ length: 500 }, () => part());
  const r = sanitizeHouse({ parts });
  assert.equal(r.parts.length, 400);
});

test("a mixed valid/invalid blob is cleaned member-by-member", () => {
  const r = sanitizeHouse({
    parts: [
      part({ kind: "floor", gx: 0, gy: 0, gz: 0 }), // keep
      part({ kind: "bogus" }), // drop (kind)
      part({ gx: 9 }), // drop (range)
      part({ kind: "trophy", gx: -2, gy: 0, gz: -2, tier: 99 }), // keep, tier->3
      "garbage", // drop
    ],
  });
  assert.equal(r.parts.length, 2);
  assert.equal(r.parts[0].kind, "floor");
  assert.equal(r.parts[1].kind, "trophy");
  assert.equal(r.parts[1].tier, 3);
});
