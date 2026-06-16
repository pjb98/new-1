/**
 * Characterization tests for src/build.ts — the PURE build-mode logic extracted
 * from main.ts (grid projection + place/paint/remove/stack). These pin the exact
 * behaviour of the original in-place editing code so the main.ts BuildController
 * refactor is provably non-regressing.
 *
 * build.ts transitively imports THREE/pets via house.ts, so this runs with the
 * same resolve-hook + transform-types flags as test:house (see package.json).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { aimCell, isTallPart, applyBuild, CELL, MAX_PARTS } from "../src/build.ts";
import type { BuildOpts } from "../src/build.ts";
import type { HouseData, HousePart } from "../src/house.ts";

const opts = (o: Partial<BuildOpts> = {}): BuildOpts => ({
  paint: false, part: "floor", color: null, rot: 0, petId: "", trophyTier: 0, ...o,
});
const house = (...parts: HousePart[]): HouseData => ({ parts });

// ── aimCell ──────────────────────────────────────────────────────────────
test("aimCell maps world position to plot-local grid cell", () => {
  // plot anchored at (10, -4); a click exactly on the anchor → cell (0,0)
  assert.deepEqual(aimCell(10, -4, 10, -4), { gx: 0, gz: 0 });
  // one CELL east + one CELL north
  assert.deepEqual(aimCell(10 + CELL, -4 - CELL, 10, -4), { gx: 1, gz: -1 });
});

test("aimCell rounds to the nearest cell", () => {
  assert.deepEqual(aimCell(CELL * 0.49, CELL * 0.51, 0, 0), { gx: 0, gz: 1 });
});

test("aimCell returns null off the 5x5 plot pad", () => {
  assert.equal(aimCell(CELL * 3, 0, 0, 0), null); // gx = 3 > 2
  assert.equal(aimCell(0, -CELL * 3, 0, 0), null); // gz = -3 < -2
  assert.notEqual(aimCell(CELL * 2, CELL * 2, 0, 0), null); // corner is in-bounds
});

// ── isTallPart ───────────────────────────────────────────────────────────
test("isTallPart reflects the HOUSE_PARTS catalog", () => {
  assert.equal(isTallPart("wall"), true);
  assert.equal(isTallPart("door"), true);
  assert.equal(isTallPart("floor"), false);
  assert.equal(isTallPart("rug"), false);
});

// ── applyBuild: placing ──────────────────────────────────────────────────
test("placing a flat part sits at gy 0", () => {
  const r = applyBuild(house(), 1, 2, opts({ part: "floor" }));
  assert.equal(r.result, "placed");
  if (r.result !== "placed") return;
  assert.deepEqual(r.data.parts, [{ kind: "floor", gx: 1, gz: 2, gy: 0 }]);
});

test("placing a tall part on an empty cell starts at gy 1", () => {
  const r = applyBuild(house(), 0, 0, opts({ part: "wall" }));
  assert.equal(r.result, "placed");
  if (r.result !== "placed") return;
  assert.equal(r.data.parts[0].gy, 1);
});

test("placing a tall part stacks above the existing top part", () => {
  const start = house({ kind: "wall", gx: 0, gy: 1, gz: 0 });
  const r = applyBuild(start, 0, 0, opts({ part: "door" }));
  assert.equal(r.result, "placed");
  if (r.result !== "placed") return;
  assert.equal(r.data.parts.at(-1)!.gy, 2);
});

test("placing carries color/rot/petId/tier per part kind", () => {
  const perch = applyBuild(house(), 0, 0, opts({ part: "perch", color: 0xff0000, rot: 2, petId: "beebot" }));
  assert.equal(perch.result, "placed");
  if (perch.result !== "placed") return;
  const p = perch.data.parts[0];
  assert.equal(p.color, 0xff0000);
  assert.equal(p.rot, 2);
  assert.equal(p.petId, "beebot");

  const trophy = applyBuild(house(), 0, 0, opts({ part: "trophy", trophyTier: 3 }));
  if (trophy.result !== "placed") return assert.fail("trophy not placed");
  assert.equal(trophy.data.parts[0].tier, 3);
  assert.equal(trophy.data.parts[0].petId, undefined); // petId only for perch
});

test("rot 0 / default color are omitted (matches sanitize shape)", () => {
  const r = applyBuild(house(), 0, 0, opts({ part: "floor", rot: 0, color: null }));
  if (r.result !== "placed") return assert.fail();
  assert.equal("rot" in r.data.parts[0], false);
  assert.equal("color" in r.data.parts[0], false);
});

// ── applyBuild: toggle-remove ──────────────────────────────────────────────
test("clicking the same part on top removes it (toggle)", () => {
  const start = house({ kind: "wall", gx: 0, gy: 1, gz: 0 });
  const r = applyBuild(start, 0, 0, opts({ part: "wall" }));
  assert.equal(r.result, "removed");
  if (r.result !== "removed") return;
  assert.equal(r.data.parts.length, 0);
});

test("removing only takes the TOP part, leaving lower ones", () => {
  const start = house(
    { kind: "floor", gx: 0, gy: 0, gz: 0 },
    { kind: "wall", gx: 0, gy: 1, gz: 0 },
  );
  // selecting "wall" and clicking removes the top wall, not the floor
  const r = applyBuild(start, 0, 0, opts({ part: "wall" }));
  if (r.result !== "removed") return assert.fail();
  assert.deepEqual(r.data.parts, [{ kind: "floor", gx: 0, gy: 0, gz: 0 }]);
});

test("a different part on top stacks rather than removing", () => {
  const start = house({ kind: "wall", gx: 0, gy: 1, gz: 0 });
  const r = applyBuild(start, 0, 0, opts({ part: "window" }));
  assert.equal(r.result, "placed");
});

// ── applyBuild: paint ──────────────────────────────────────────────────────
test("paint recolours the topmost part at the cell", () => {
  const start = house({ kind: "wall", gx: 0, gy: 1, gz: 0 });
  const r = applyBuild(start, 0, 0, opts({ paint: true, color: 0x00ff00 }));
  assert.equal(r.result, "painted");
  if (r.result !== "painted") return;
  assert.equal(r.data.parts[0].color, 0x00ff00);
});

test("paint with null color clears the override", () => {
  const start = house({ kind: "wall", gx: 0, gy: 1, gz: 0, color: 0x123456 });
  const r = applyBuild(start, 0, 0, opts({ paint: true, color: null }));
  if (r.result !== "painted") return assert.fail();
  assert.equal("color" in r.data.parts[0], false);
});

test("paint on an empty cell is denied", () => {
  const r = applyBuild(house(), 0, 0, opts({ paint: true, color: 0x00ff00 }));
  assert.equal(r.result, "denied-empty");
});

// ── applyBuild: 400-part cap ───────────────────────────────────────────────
test("placing past MAX_PARTS is denied", () => {
  const parts: HousePart[] = [];
  for (let i = 0; i < MAX_PARTS; i++) parts.push({ kind: "floor", gx: (i % 5) - 2, gy: i, gz: 0 });
  const r = applyBuild({ parts }, 2, 2, opts({ part: "floor" }));
  assert.equal(r.result, "denied-full");
});

test("a toggle-remove still works at the cap (doesn't grow)", () => {
  const parts: HousePart[] = [];
  for (let i = 0; i < MAX_PARTS - 1; i++) parts.push({ kind: "floor", gx: -2, gy: i, gz: -2 });
  parts.push({ kind: "wall", gx: 0, gy: 1, gz: 0 }); // exactly MAX_PARTS now
  const r = applyBuild({ parts }, 0, 0, opts({ part: "wall" })); // remove the wall
  assert.equal(r.result, "removed");
});

// ── purity: inputs are not mutated ─────────────────────────────────────────
test("applyBuild never mutates the input HouseData", () => {
  const start = house({ kind: "wall", gx: 0, gy: 1, gz: 0 });
  const snapshot = JSON.stringify(start);
  applyBuild(start, 0, 0, opts({ part: "door" }));
  applyBuild(start, 0, 0, opts({ part: "wall" }));
  applyBuild(start, 0, 0, opts({ paint: true, color: 0xff0000 }));
  assert.equal(JSON.stringify(start), snapshot);
});
