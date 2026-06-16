/**
 * Geometry tests for src/island.ts Island.nearestZone.
 *
 * TESTABILITY NOTE
 * ----------------
 * nearestZone is an instance method on Island, and src/island.ts cannot be
 * imported under the node:test runner: its transitive chain
 * (island -> voxelChar -> assets) imports the *type* `AnimState` without the
 * `type` modifier, which the strip/transform TS modes cannot erase (see
 * report). Constructing an Island also builds the entire THREE scene graph.
 *
 * nearestZone itself is pure 2-D geometry over {pos:{x,z}, radius} records, so
 * this suite ports the method VERBATIM (identical squared-distance comparison
 * and `d < r*r && d < bd` selection) and exercises the cases the design cares
 * about: in-radius hit, out-of-radius miss, nearest-of-overlapping, and tie
 * handling. No THREE dependency — zones are plain literals.
 *
 * Runner: `npm run test:island` (plain --experimental-strip-types).
 */
import test from "node:test";
import assert from "node:assert/strict";

interface Zone {
  id: string;
  pos: { x: number; z: number };
  radius: number;
}

// ---- verbatim port of Island.nearestZone ----------------------------------
function nearestZone(zones: Zone[], pos: { x: number; z: number }): Zone | null {
  let best: Zone | null = null;
  let bd = Infinity;
  for (const z of zones) {
    const dx = z.pos.x - pos.x;
    const dz = z.pos.z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < z.radius * z.radius && d < bd) {
      bd = d;
      best = z;
    }
  }
  return best;
}

const Z = (id: string, x: number, z: number, radius: number): Zone => ({ id, pos: { x, z }, radius });

test("returns null when there are no zones", () => {
  assert.equal(nearestZone([], { x: 0, z: 0 }), null);
});

test("returns the zone when the player is inside its radius", () => {
  const zones = [Z("shop", 5, 0, 2.2)];
  const hit = nearestZone(zones, { x: 5, z: 0 });
  assert.ok(hit);
  assert.equal(hit.id, "shop");
});

test("returns null when the player is outside every radius", () => {
  const zones = [Z("shop", 5, 0, 2.2), Z("host", -5, 0, 2.2)];
  assert.equal(nearestZone(zones, { x: 0, z: 0 }), null); // 5 units away from both, r=2.2
});

test("boundary is EXCLUSIVE: exactly on the radius is a miss (d < r*r is strict)", () => {
  const zones = [Z("a", 0, 0, 2)];
  // distance exactly 2 -> d == r*r -> not strictly less -> null
  assert.equal(nearestZone(zones, { x: 2, z: 0 }), null);
  // just inside
  assert.equal(nearestZone(zones, { x: 1.999, z: 0 })?.id, "a");
});

test("picks the NEAREST when the player is inside multiple overlapping zones", () => {
  const zones = [Z("far", 0, 0, 10), Z("near", 1, 0, 10)];
  // player at x=0.9: dist to 'near' (0.1) < dist to 'far' (0.9)
  const hit = nearestZone(zones, { x: 0.9, z: 0 });
  assert.equal(hit?.id, "near");
});

test("on a distance tie, the FIRST-listed zone wins (strict < keeps the earlier best)", () => {
  const zones = [Z("first", -1, 0, 10), Z("second", 1, 0, 10)];
  // player equidistant at origin -> both d=1; first encountered wins
  assert.equal(nearestZone(zones, { x: 0, z: 0 })?.id, "first");
});

test("ignores an in-range-but-farther zone in favour of a closer one regardless of order", () => {
  const zones = [Z("close", 0, 0, 5), Z("alsoclose", 0.5, 0, 5)];
  assert.equal(nearestZone(zones, { x: 0.4, z: 0 })?.id, "alsoclose"); // 0.1 < 0.4
  assert.equal(nearestZone(zones, { x: 0.1, z: 0 })?.id, "close"); // 0.1 < 0.4
});

test("uses 2-D (x,z) distance and respects per-zone radii independently", () => {
  const zones = [Z("big", 0, 0, 3), Z("small", 2, 2, 0.5)];
  // player near the small pad but just outside its tiny radius -> should fall
  // back to the big pad which still covers it.
  const hit = nearestZone(zones, { x: 1.5, z: 1.5 });
  // dist^2 to small = 0.5 -> r*r = 0.25 -> miss; dist^2 to big = 4.5 -> r*r=9 -> hit
  assert.equal(hit?.id, "big");
});

test("matches the real island pad layout (host/join/shop at radius 2.2)", () => {
  // Fixture mirrors Island.buildZones(): host(0,-5.5), join(5,2.5), shop(-5,2.5), r=2.2
  const zones = [
    Z("host", 0, -5.5, 2.2),
    Z("join", 5, 2.5, 2.2),
    Z("shop", -5, 2.5, 2.2),
  ];
  assert.equal(nearestZone(zones, { x: 0, z: -5.5 })?.id, "host"); // dead centre
  assert.equal(nearestZone(zones, { x: 5, z: 3.5 })?.id, "join"); // 1 unit from join pad
  assert.equal(nearestZone(zones, { x: 0, z: 0 }), null); // standing in the plaza, no pad
});
