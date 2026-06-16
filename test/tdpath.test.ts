import test from "node:test";
import assert from "node:assert/strict";
import { TD_PATH, TD_SPAWN, TD_GOAL, pathLength, pointAt, headingAt } from "../src/td/tdpath.ts";

test("pathLength sums the segments and is positive", () => {
  const len = pathLength();
  assert.ok(len > 0);
  // matches a manual sum of the default polyline
  let manual = 0;
  for (let i = 1; i < TD_PATH.length; i++) {
    manual += Math.hypot(TD_PATH[i].x - TD_PATH[i - 1].x, TD_PATH[i].z - TD_PATH[i - 1].z);
  }
  assert.equal(Math.round(len), Math.round(manual));
});

test("pointAt(0) is the spawn; before 0 clamps to spawn, not done", () => {
  const a = pointAt(0);
  assert.equal(a.x, TD_SPAWN.x);
  assert.equal(a.z, TD_SPAWN.z);
  assert.equal(a.done, false);
  const b = pointAt(-5);
  assert.equal(b.x, TD_SPAWN.x);
  assert.equal(b.done, false);
});

test("pointAt at/after full length lands on the goal and reports done", () => {
  const len = pathLength();
  const end = pointAt(len);
  assert.equal(end.x, TD_GOAL.x);
  assert.equal(end.z, TD_GOAL.z);
  assert.equal(end.done, true);
  assert.equal(pointAt(len + 100).done, true);
});

test("pointAt mid-first-segment interpolates linearly", () => {
  const seg = Math.hypot(TD_PATH[1].x - TD_PATH[0].x, TD_PATH[1].z - TD_PATH[0].z);
  const mid = pointAt(seg / 2);
  assert.ok(Math.abs(mid.x - (TD_PATH[0].x + TD_PATH[1].x) / 2) < 1e-6);
  assert.ok(Math.abs(mid.z - (TD_PATH[0].z + TD_PATH[1].z) / 2) < 1e-6);
  assert.equal(mid.done, false);
});

test("headingAt returns a unit vector along the first segment", () => {
  const h = headingAt(1);
  assert.ok(Math.abs(Math.hypot(h.dx, h.dz) - 1) < 1e-6);
  // first segment runs +x
  assert.ok(h.dx > 0.9);
});
