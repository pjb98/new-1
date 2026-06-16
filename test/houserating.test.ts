/**
 * Tiny standalone test for the pure house rater. No test-runner dependency:
 * run with `npm run test:rating` (Node's built-in type-stripping + node:test).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rateHouse } from "../src/houserating.ts";
import type { HouseData } from "../src/house.ts";

test("empty house grades D with score 0", () => {
  const r = rateHouse({ parts: [] });
  assert.equal(r.score, 0);
  assert.equal(r.grade, "D");
  assert.equal(r.breakdown.length, 6);
});

test("score is clamped 0..100 and breakdown sums sanely", () => {
  const parts: HouseData["parts"] = [];
  for (let i = 0; i < 60; i++) parts.push({ kind: "wall", gx: 0, gy: 0, gz: 0, color: i % 8 });
  const r = rateHouse({ parts });
  assert.ok(r.score >= 0 && r.score <= 100);
});

test("a cozy, varied, decorated house grades higher than a wall blob", () => {
  const blob: HouseData = { parts: Array.from({ length: 20 }, () => ({ kind: "wall" as const, gx: 0, gy: 0, gz: 0 })) };
  const cozy: HouseData = {
    parts: [
      ...Array.from({ length: 9 }, (_, i) => ({ kind: "floor" as const, gx: (i % 3) - 1, gy: 0, gz: Math.floor(i / 3) - 1 })),
      { kind: "wall" as const, gx: -1, gy: 1, gz: -1, color: 0xede4d0 },
      { kind: "wall" as const, gx: 0, gy: 1, gz: -1, color: 0xede4d0 },
      { kind: "wall" as const, gx: 1, gy: 1, gz: -1, color: 0xede4d0 },
      { kind: "wall" as const, gx: -1, gy: 1, gz: 0, color: 0xede4d0 },
      { kind: "door" as const, gx: 0, gy: 1, gz: 1, color: 0x8a5a32 },
      { kind: "roof" as const, gx: 0, gy: 2, gz: 0, color: 0xb6452f },
      { kind: "bed" as const, gx: -1, gy: 0, gz: 0, color: 0x6c8cff },
      { kind: "table" as const, gx: 1, gy: 0, gz: 0, color: 0x9a6b3f },
      { kind: "tree" as const, gx: 2, gy: 0, gz: 2, color: 0x5fb04a },
      { kind: "trophy" as const, gx: -2, gy: 0, gz: -2, tier: 2 as const },
    ],
  };
  const a = rateHouse(blob);
  const b = rateHouse(cozy);
  assert.ok(b.score > a.score, `cozy ${b.score} should beat blob ${a.score}`);
  assert.ok(["B", "A", "S"].includes(b.grade), `cozy grade was ${b.grade}`);
});
