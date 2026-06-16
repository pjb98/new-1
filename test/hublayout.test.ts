import test from "node:test";
import assert from "node:assert/strict";
import { SATELLITES, MAIN_R, inHub, clampToHub } from "../src/hublayout.ts";

test("the island centre and each satellite centre are walkable", () => {
  assert.ok(inHub(0, 0));
  for (const s of SATELLITES) assert.ok(inHub(s.center.x, s.center.z), `${s.id} centre walkable`);
});

test("clampToHub leaves walkable points untouched and pulls void points back in", () => {
  const inside = clampToHub(0, 0);
  assert.deepEqual(inside, { x: 0, z: 0 });
  // far out in the void → snapped back onto some region
  const far = clampToHub(200, 200);
  assert.ok(inHub(far.x + 1e-6, far.z + 1e-6) || inHub(far.x, far.z), "snapped onto the hub");
  assert.ok(Math.hypot(far.x, far.z) < 200, "actually moved inward");
});

test("there is a continuous walkable path from the centre to every satellite", () => {
  // walk a straight line origin → satellite centre in fine steps; the bridge
  // must keep every step on the hub (this is the whole point of the bridges).
  for (const s of SATELLITES) {
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = s.center.x * t;
      const z = s.center.z * t;
      assert.ok(inHub(x, z), `${s.id}: gap on the bridge at t=${t.toFixed(2)} (${x.toFixed(1)},${z.toFixed(1)})`);
    }
  }
});

test("stepping sideways off a bridge into the void is clamped back", () => {
  const s = SATELLITES[0];
  // a point just past the main disc, along the bridge axis but shoved far sideways
  const d = Math.hypot(s.center.x, s.center.z);
  const ax = s.center.x / d, az = s.center.z / d;
  const px = -az, pz = ax;
  const baseT = MAIN_R + 4;
  const x = ax * baseT + px * 20;
  const z = az * baseT + pz * 20;
  assert.ok(!inHub(x, z), "the test point really is off the hub");
  const c = clampToHub(x, z);
  assert.ok(inHub(c.x + 1e-6, c.z) || inHub(c.x, c.z + 1e-6) || inHub(c.x, c.z), "clamped back onto the hub");
});

test("satellites are spread out (distinct directions, beyond the main island)", () => {
  for (const s of SATELLITES) {
    assert.ok(Math.hypot(s.center.x, s.center.z) > MAIN_R, `${s.id} sits beyond the main island`);
  }
  // no two satellites occupy the same spot
  for (let i = 0; i < SATELLITES.length; i++) {
    for (let j = i + 1; j < SATELLITES.length; j++) {
      const a = SATELLITES[i].center, b = SATELLITES[j].center;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > SATELLITES[i].radius, "satellites don't overlap");
    }
  }
});
