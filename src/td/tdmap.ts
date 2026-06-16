import * as THREE from "three";
import { voxelMaterial, glowMaterial, toyMaterial, auraMaterial, VOX } from "../palette";
import { TD_PATH, TD_PADS, TD_GOAL, TD_SPAWN, pathLength, pointAt, headingAt, type Vec2 } from "./tdpath";

/**
 * The Tower-Defense MAP — a flat square voxel battlefield (~70×70) floating over
 * a soft void, in the same chunky toy-diorama style as the rest of the game.
 *
 * It draws the static world only + gentle ambient animation:
 *   • a checkerboarded grass tile field (top surface at y = 0, the gameplay plane)
 *   • a darker dirt/stone LANE ribbon following TD_PATH waypoint-to-waypoint, so
 *     the road you see is exactly the lane creeps walk
 *   • a glowing SPAWN portal/arch at TD_SPAWN (off the west edge)
 *   • a chunky crystal-core BASE at TD_GOAL you defend (emissive, flashable)
 *   • a low stone BUILD PAD with a glowing rim at every TD_PADS position
 *
 * The integrator reads TD_PADS / TD_GOAL / TD_SPAWN directly for gameplay; this
 * class owns the visuals. Pulsing/animation is purely cosmetic. `flashBase()`
 * lets gameplay flash the core when the base takes damage.
 */

// ---- mobile tier flag -----------------------------------------------------
// Mirror palette.ts's LOW_TIER detection (it isn't exported, and we may only
// edit this file). On coarse-pointer / no-hover devices (phones) we cut the
// most expensive ambient effects — fewer particles, fewer point lights, less
// scenery, no extra dust layer — to protect the hard-won mobile FPS budget.
const LOW_TIER =
  typeof matchMedia === "function"
    ? matchMedia("(pointer: coarse)").matches && matchMedia("(hover: none)").matches
    : false;

// ---- layout constants -----------------------------------------------------
const ARENA_HALF = 35; // half-extent of the square battlefield footprint (~70×70)
const GROUND_TOP = 0; // top surface of the ground — the gameplay plane (y = 0)
const TILE = 2; // voxel tile pitch

// The lane is built from boxes covering the union of TD_PATH segments. We keep
// the visible road ~3 units to either side of the centre-line of the polyline.
const LANE_W = 3; // half-width of the walkable road (so road ≈ 6 wide)

// Soft, low-contrast pastel turf + dusky water — a calm lofi palette instead of
// the bright midday lime (the warm dusk mood lighting does the rest).
const TD_GRASS = 0x8fc174;
const TD_GRASS_DARK = 0x80b266;
const TD_GRASS_LIGHT = 0xaedc92;
const TD_WATER = 0x9db9d2;

// calm dusk vs ominous boss-wave palette (lerped by bossMood in update)
const _FOG_CALM = new THREE.Color(0xd9c3c9);
const _FOG_BOSS = new THREE.Color(0xc06450);
const _BG_CALM = new THREE.Color(0xe6cfca);
const _BG_BOSS = new THREE.Color(0xcf7a66);

interface PulseGlow {
  mesh: THREE.Mesh;
  base: number; // rest emissive intensity
  amp: number; // pulse amplitude
  phase: number;
}

export class TdMap {
  readonly group = new THREE.Group();
  /** The build-pad plinth markers, parallel to TD_PADS (handy for highlighting). */
  readonly padMarkers: THREE.Object3D[] = [];
  /** The defendable base group (positioned at TD_GOAL). */
  readonly base = new THREE.Group();

  private t = 0;
  private pulses: PulseGlow[] = [];
  private clouds: { group: THREE.Group; speed: number; x0: number }[] = [];
  private portalRings: THREE.Mesh[] = [];
  private laneFlow: { mesh: THREE.Mesh; arc: number }[] = []; // glowing chevrons flowing to the base
  private shield?: THREE.Mesh;   // base shield dome (drains + flares with HP)
  private shieldFrac = 1;        // current base health fraction (0..1)
  private bossMoodTarget = 0;    // 0 calm dusk → 1 ominous boss-wave red
  private bossMoodCur = 0;
  private spawnPulse = 0;        // portal flare on a wave start
  private coreGem?: THREE.Mesh; // the base crystal core (pulses / flashes)
  private coreBaseEmissive = 1.2;
  private flashTimer = 0; // seconds of damage-flash remaining

  // ---- ambient motion (updated each frame; preallocated, no per-frame alloc) --
  private fireflies?: THREE.Points; // tiny glowing motes that bob + drift
  private fireflyData: { x: number; z: number; y: number; phase: number; speed: number; rad: number }[] = [];
  private petals?: THREE.Points; // slow falling cherry petals
  private petalData: { x: number; z: number; y: number; vy: number; sway: number; phase: number }[] = [];
  private windmillSails?: THREE.Group; // a lazily-turning landmark
  private bannerFlags: { mesh: THREE.Mesh; phase: number; baseRot: number }[] = [];
  private water?: THREE.Mesh; // the surrounding sheet (shimmer in update)
  private laneLanterns: PulseGlow[] = []; // (also pushed into pulses; kept for clarity)
  private padSpinners: { group: THREE.Group; speed: number }[] = []; // pad rune rings
  private coreShards?: THREE.Group; // crystal shards orbiting the base core
  private baseGlyph?: THREE.Mesh; // rotating ground glyph under the base
  private dust?: THREE.Points; // drifting atmospheric motes (skipped on mobile)
  private dustData: { x: number; z: number; y: number; phase: number; speed: number; rad: number }[] = [];

  // ---- calm dusk "lofi" mood (TD-only; snapshots + restores the scene) ----
  private scene: THREE.Scene;
  private moodSaved = false;
  private savedFog: THREE.Scene["fog"] = null;
  private savedBg: THREE.Color | THREE.Texture | null = null;
  private savedEnv = 0.5;
  private lightOrig = new Map<THREE.Light, { intensity: number; color: number }>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.buildSkyDome();
    this.buildBackdrop();
    this.buildGround();
    this.buildLane();
    this.buildLaneTrim();
    this.buildLaneFlow();
    this.buildDecor();
    this.buildLandmarks();
    this.buildPads();
    this.buildSpawn();
    this.buildBase();
    this.buildAtmosphere();
    this.buildParticles();
    this.buildMoodLights();
    this.applyShadows();
    scene.add(this.group);
    this.group.visible = false; // shown only while in the Tower-Defense mode
  }

  setVisible(on: boolean) {
    this.group.visible = on;
    if (on) this.enterMood();
    else this.exitMood();
  }

  /** Soft mood lights under the group (only active while TD is visible): a low
   *  peach key + a cool lavender fill — warm/cool dusk balance for a chill vibe. */
  private buildMoodLights() {
    const hemi = new THREE.HemisphereLight(0xffd6c0, 0x6a5a72, 0.4); // peach sky / dusky ground
    const sun = new THREE.DirectionalLight(0xffb98a, 0.6); // low amber sunset key
    sun.position.set(-24, 14, 18);
    const cool = new THREE.DirectionalLight(0xb9a6e6, 0.3); // soft lavender counter-fill
    cool.position.set(18, 9, -16);
    this.group.add(hemi, sun, cool);
  }

  private enterMood() {
    if (!this.moodSaved) {
      this.savedFog = this.scene.fog;
      this.savedBg = this.scene.background as THREE.Color | THREE.Texture | null;
      this.savedEnv = this.scene.environmentIntensity ?? 0.5;
      for (const c of this.scene.children) {
        const l = c as THREE.Light;
        if (l.isLight) this.lightOrig.set(l, { intensity: l.intensity, color: l.color.getHex() });
      }
      this.moodSaved = true;
    }
    // soft hazy dusk: a muted lavender-peach sky + gentle haze hugging the field,
    // dimmed IBL so the warm key + bloom carry the calm lofi mood.
    this.scene.fog = new THREE.Fog(0xd9c3c9, 34, 96);
    this.scene.background = new THREE.Color(0xe6cfca);
    this.scene.environmentIntensity = 0.3;
    for (const [l, o] of this.lightOrig) {
      const isKey = o.intensity > 1;
      l.intensity = o.intensity * (isKey ? 0.4 : 0.55);
      l.color.setHex(isKey ? 0xffc69a : 0xe3cdbf);
    }
  }

  private exitMood() {
    if (!this.moodSaved) return;
    this.scene.fog = this.savedFog;
    this.scene.background = this.savedBg;
    this.scene.environmentIntensity = this.savedEnv;
    for (const [l, o] of this.lightOrig) {
      l.intensity = o.intensity;
      l.color.setHex(o.color);
    }
  }

  /** Flash the base core (call when the base takes damage). */
  flashBase(seconds = 0.4) {
    this.flashTimer = Math.max(this.flashTimer, seconds);
  }

  // ========================================================================
  //  WORLD BUILDING
  // ========================================================================

  /**
   * A big inward-facing GRADIENT SKY DOME behind the flat-colour background: a
   * warm peach horizon melting up into soft lavender at the zenith and a dusky
   * plum near the ground, giving the dusk real atmospheric depth. Vertex-colour
   * gradient (no shader), unlit (BackSide + no toneMap so it stays soft), and
   * placed well outside the fog's far plane core so the field still hazes out.
   */
  private buildSkyDome() {
    const R = 240;
    const geo = new THREE.SphereGeometry(R, 24, 16);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cZenith = new THREE.Color(0xc9b6e0); // soft lavender overhead
    const cHorizon = new THREE.Color(0xf4cdb0); // warm peach at the horizon
    const cGround = new THREE.Color(0xb59ab0); // dusky plum below
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      // normalized height of this vertex on the sphere (-1 ground .. +1 zenith)
      const h = pos.getY(i) / R;
      if (h >= 0) {
        // horizon → zenith: ease so the warm band hugs the horizon
        c.copy(cHorizon).lerp(cZenith, Math.pow(h, 0.7));
      } else {
        c.copy(cHorizon).lerp(cGround, Math.min(1, -h * 1.4));
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.userData.noCast = true;
    dome.renderOrder = -10; // draw behind everything
    this.group.add(dome);
  }

  /** A dark void plate + a glassy water sheet far below, so the battlefield
   *  reads as a floating diorama (mirrors bwmap's backdrop). */
  private buildBackdrop() {
    const voidPlate = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF * 2 + 30, 1, ARENA_HALF * 2 + 30),
      voxelMaterial(0x222634),
    );
    voidPlate.position.y = -12;
    voidPlate.userData.noCast = true;
    this.group.add(voidPlate);

    const water = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF * 2 + 24, 0.4, ARENA_HALF * 2 + 24),
      new THREE.MeshStandardMaterial({
        color: TD_WATER,
        emissive: TD_WATER,
        emissiveIntensity: 0.18,
        transparent: true,
        opacity: 0.78,
        roughness: 0.3,
        metalness: 0.0,
      }),
    );
    water.position.y = -9.5;
    water.userData.noCast = true;
    this.group.add(water);
    this.water = water;
  }

  /**
   * The flat battlefield: a chunky stone underbelly + a checkerboarded grass
   * cap whose tile TOPS sit at y = 0. Lane tiles are skipped here and drawn
   * separately so the road reads as inset/darker. Built with a handful of
   * shared geometries + two InstancedMeshes for the (light/dark) grass tiles so
   * the field stays cheap (no thousands of separate meshes).
   */
  private buildGround() {
    const span = ARENA_HALF * 2;

    // chunky stone underbelly (two tapering tiers — the floating-diorama look).
    // Its TOP sits just below the grass tile bottoms (y -0.5) so it never shares
    // a plane with the grass/road tops (that coplanar overlap was z-fighting).
    const belly = new THREE.Mesh(new THREE.BoxGeometry(span, 2.4, span), voxelMaterial(VOX.stone));
    belly.position.y = GROUND_TOP - 1.7;
    this.group.add(belly);
    const root = new THREE.Mesh(new THREE.BoxGeometry(span - 6, 2.6, span - 6), voxelMaterial(VOX.stoneDark));
    root.position.y = GROUND_TOP - 3.9;
    this.group.add(root);

    // grass cap — alternating tones + occasional sun-kissed highlight via three
    // InstancedMeshes (cheap & crisp), matching the island's lawn.
    const tileH = 0.5;
    const tileGeo = new THREE.BoxGeometry(TILE * 0.98, tileH, TILE * 0.98);
    const n = Math.floor(ARENA_HALF / TILE);

    let seed = 4711;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const light: THREE.Vector3[] = [];
    const dark: THREE.Vector3[] = [];
    const lit: THREE.Vector3[] = [];
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const x = ix * TILE;
        const z = iz * TILE;
        if (Math.abs(x) > ARENA_HALF - 0.2 || Math.abs(z) > ARENA_HALF - 0.2) continue;
        if (this.nearLane(x, z, LANE_W + 0.5)) continue; // leave a gap for the road
        const pos = new THREE.Vector3(x, GROUND_TOP - tileH / 2, z);
        if (rnd() < 0.1) lit.push(pos);
        else if ((ix + iz) % 2 === 0) light.push(pos);
        else dark.push(pos);
      }
    }

    const m = new THREE.Matrix4();
    const buildField = (positions: THREE.Vector3[], color: number) => {
      if (positions.length === 0) return;
      const inst = new THREE.InstancedMesh(tileGeo, voxelMaterial(color), positions.length);
      positions.forEach((p, i) => {
        m.makeTranslation(p.x, p.y, p.z);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.userData.noCast = true; // big field receives shadow, stays out of shadow map
      this.group.add(inst);
    };
    buildField(light, TD_GRASS);
    buildField(dark, TD_GRASS_DARK);
    buildField(lit, TD_GRASS_LIGHT);

    // ---- RAISED EDGE BERM — a tiered grassy rampart hugging the diorama rim,
    // giving the battlefield real height variation + a strong "framed table"
    // silhouette. Two stacked instanced rings of grass-capped blocks placed
    // only in the outer margin (well beyond every pad/lane/base), with the rim
    // corners notched away so the field still reads open at an iso angle.
    this.buildEdgeBerm();
  }

  /** A two-tier grass berm around the outer rim (purely scenic relief). The
   *  blocks live beyond radius ~30 so they never touch lane/pads/base/spawn. */
  private buildEdgeBerm() {
    const inner = ARENA_HALF - 4.5; // first row sits just inside the rim
    const capGeo = new THREE.BoxGeometry(TILE * 0.98, 1.1, TILE * 0.98);
    const stoneGeo = new THREE.BoxGeometry(TILE * 0.98, 1.6, TILE * 0.98);
    const tier1Cap: THREE.Vector3[] = [];
    const tier1Stone: THREE.Vector3[] = [];
    const tier2Cap: THREE.Vector3[] = [];
    const tier2Stone: THREE.Vector3[] = [];
    const n = Math.floor(ARENA_HALF / TILE);
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const x = ix * TILE, z = iz * TILE;
        const edge = Math.max(Math.abs(x), Math.abs(z));
        if (edge < inner || edge > ARENA_HALF - 0.5) continue;
        // leave a gap where the spawn lane breaches the west rim
        if (this.nearLane(x, z, LANE_W + 2.5)) continue;
        // notch the four corners so the silhouette stays soft, not boxy
        if (Math.abs(x) > ARENA_HALF - 4 && Math.abs(z) > ARENA_HALF - 4) continue;
        const outer = edge > ARENA_HALF - 2.5; // outermost row = taller second tier
        if (outer) {
          tier2Cap.push(new THREE.Vector3(x, GROUND_TOP + 1.55, z));
          tier2Stone.push(new THREE.Vector3(x, GROUND_TOP + 0.6, z));
        } else {
          tier1Cap.push(new THREE.Vector3(x, GROUND_TOP + 0.85, z));
          tier1Stone.push(new THREE.Vector3(x, GROUND_TOP + 0.1, z));
        }
      }
    }
    const m = new THREE.Matrix4();
    const lay = (geo: THREE.BufferGeometry, ps: THREE.Vector3[], color: number, noCast = false) => {
      if (!ps.length) return;
      const inst = new THREE.InstancedMesh(geo, voxelMaterial(color), ps.length);
      ps.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m); });
      inst.instanceMatrix.needsUpdate = true;
      if (noCast) inst.userData.noCast = true;
      this.group.add(inst);
    };
    lay(stoneGeo, tier1Stone, VOX.stoneDark, true);
    lay(capGeo, tier1Cap, TD_GRASS_DARK);
    lay(stoneGeo, tier2Stone, VOX.stone, true);
    lay(capGeo, tier2Cap, TD_GRASS);
  }

  /**
   * The LANE — a sunken cobble road following TD_PATH. Built as NON-overlapping
   * grid tiles (two cobble tones, checkered) covering every grid cell within
   * LANE_W of the path, sitting a hair below the grass so it reads as an inset
   * road. Grid tiles never overlap, so there is no coplanar z-fighting (the old
   * per-segment slabs overlapped at every corner and flickered).
   */
  private buildLane() {
    const tileH = 0.5;
    const geo = new THREE.BoxGeometry(TILE * 0.98, tileH, TILE * 0.98);
    const n = Math.floor(ARENA_HALF / TILE);
    const top = GROUND_TOP - 0.06; // just below the grass surface
    const a: THREE.Vector3[] = [];
    const b: THREE.Vector3[] = [];
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const x = ix * TILE;
        const z = iz * TILE;
        if (Math.abs(x) > ARENA_HALF - 0.2 || Math.abs(z) > ARENA_HALF - 0.2) continue;
        if (!this.nearLane(x, z, LANE_W)) continue;
        const pos = new THREE.Vector3(x, top - tileH / 2, z);
        ((ix + iz) % 2 === 0 ? a : b).push(pos);
      }
    }
    const m = new THREE.Matrix4();
    const lay = (positions: THREE.Vector3[], color: number) => {
      if (!positions.length) return;
      const inst = new THREE.InstancedMesh(geo, voxelMaterial(color), positions.length);
      positions.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m); });
      inst.instanceMatrix.needsUpdate = true;
      inst.userData.noCast = true;
      this.group.add(inst);
    };
    lay(a, VOX.cobble);
    lay(b, VOX.cobbleDark);
  }

  /**
   * LANE POLISH — low stone curb stones lining the road edges + a handful of
   * lane-side lanterns at the path corners. The curbs are dropped at evenly
   * spaced samples just OUTSIDE the road half-width, sitting on the grass (so
   * their tops are above both grass and lane tiles — no coplanar overlap), and
   * we skip any sample that lands on a pad/base/spawn to keep gameplay clear.
   */
  private buildLaneTrim() {
    const curbGeo = new THREE.BoxGeometry(0.55, 0.5, 0.55);
    const curbMat = voxelMaterial(VOX.cobble);
    const curbMatD = voxelMaterial(VOX.cobbleDark);
    const offset = LANE_W + 0.55; // just off the road shoulder
    const blockedSpot = (x: number, z: number): boolean => {
      for (const p of TD_PADS) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 2.4 ** 2) return true;
      if ((TD_GOAL.x - x) ** 2 + (TD_GOAL.z - z) ** 2 < 6 ** 2) return true;
      if ((TD_SPAWN.x - x) ** 2 + (TD_SPAWN.z - z) ** 2 < 6 ** 2) return true;
      return Math.abs(x) > ARENA_HALF - 1 || Math.abs(z) > ARENA_HALF - 1;
    };
    // collect curb-stone positions along both shoulders of each segment
    const stones: THREE.Vector3[] = [];
    let toggle = 0;
    for (let i = 1; i < TD_PATH.length; i++) {
      const a = TD_PATH[i - 1], b = TD_PATH[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len; // along
      const nx = -uz, nz = ux; // left normal
      const step = 1.6;
      for (let s = 0; s <= len; s += step) {
        const cx = a.x + ux * s, cz = a.z + uz * s;
        for (const side of [1, -1]) {
          const x = cx + nx * offset * side;
          const z = cz + nz * offset * side;
          if (this.nearLane(x, z, LANE_W - 0.2)) continue; // not into the road
          if (blockedSpot(x, z)) continue;
          stones.push(new THREE.Vector3(x, GROUND_TOP + 0.2, z));
        }
      }
    }
    // two-tone instanced curbs (cheap)
    if (stones.length) {
      const m = new THREE.Matrix4();
      const light: THREE.Vector3[] = [], dark: THREE.Vector3[] = [];
      stones.forEach((p) => ((toggle++ % 2 === 0 ? light : dark).push(p)));
      const lay = (ps: THREE.Vector3[], mat: THREE.Material) => {
        if (!ps.length) return;
        const inst = new THREE.InstancedMesh(curbGeo, mat, ps.length);
        ps.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m); });
        inst.instanceMatrix.needsUpdate = true;
        this.group.add(inst);
      };
      lay(light, curbMat);
      lay(dark, curbMatD);
    }

    // lane-side LANTERNS at the inner path corners (skip endpoints near base/spawn)
    for (let i = 1; i < TD_PATH.length - 1; i++) {
      const c = TD_PATH[i];
      // outward-ish offset using the incoming segment's left normal
      const a = TD_PATH[i - 1];
      const dx = c.x - a.x, dz = c.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      const lx = c.x + nx * (LANE_W + 1.4), lz = c.z + nz * (LANE_W + 1.4);
      if (blockedSpot(lx, lz) || this.nearLane(lx, lz, LANE_W - 0.2)) continue;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.3), voxelMaterial(VOX.barkDark));
      post.position.set(lx, 1.1, lz);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.2), voxelMaterial(VOX.barkDark));
      arm.position.set(lx, 2.1, lz);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.4), glowMaterial(VOX.lantern, 1.3));
      lamp.position.set(lx, 1.95, lz);
      lamp.userData.noCast = true;
      this.group.add(post, arm, lamp);
      const pg: PulseGlow = { mesh: lamp, base: 1.1, amp: 0.4, phase: i * 1.3 };
      this.pulses.push(pg);
      this.laneLanterns.push(pg);
      // a soft warm point light, sparing on count (skipped on mobile — the
      // lantern bloom carries the glow without the extra dynamic light cost)
      if (!LOW_TIER && i % 2 === 1) {
        const pl = new THREE.PointLight(0xffc06a, 1.8, 9, 2);
        pl.position.set(lx, 2.2, lz);
        this.group.add(pl);
      }
    }
  }

  /**
   * Diorama LANDMARKS in the open grass corners (away from lane/pads/base/spawn):
   * a little voxel WINDMILL with turning sails, a six-post GAZEBO, and a small
   * reflective lily POND. They give the map a storybook focal-point in each quiet
   * corner without crowding the play area.
   */
  private buildLandmarks() {
    // pick safe open corners well clear of gameplay anchors
    const safe = (x: number, z: number, rad: number): boolean => {
      if (this.nearLane(x, z, LANE_W + rad + 1)) return false;
      for (const p of TD_PADS) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (rad + 3) ** 2) return false;
      if ((TD_GOAL.x - x) ** 2 + (TD_GOAL.z - z) ** 2 < (rad + 7) ** 2) return false;
      if ((TD_SPAWN.x - x) ** 2 + (TD_SPAWN.z - z) ** 2 < (rad + 7) ** 2) return false;
      return Math.abs(x) < ARENA_HALF - rad - 1 && Math.abs(z) < ARENA_HALF - rad - 1;
    };

    // ---- WINDMILL (north-east open corner) ----
    {
      const cand: Vec2[] = [{ x: 27, z: -27 }, { x: -27, z: -27 }, { x: 27, z: 27 }];
      const at = cand.find((p) => safe(p.x, p.z, 4)) ?? cand[0];
      const mill = new THREE.Group();
      // tapered stone tower
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.4, 1.0, 8), voxelMaterial(VOX.cobble));
      base.position.y = 0.5; mill.add(base);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.9, 4.2, 8), voxelMaterial(VOX.plasterWarm));
      body.position.y = 3.1; mill.add(body);
      // conical cap
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.6, 8), voxelMaterial(VOX.roofRed));
      cap.position.y = 6.0; mill.add(cap);
      // a tiny door + window glow
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.3), voxelMaterial(VOX.doorWood));
      door.position.set(0, 1.4, 1.85); mill.add(door);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), glowMaterial(VOX.windowGlow, 0.9));
      win.position.set(0, 3.6, 1.85); win.userData.noCast = true; mill.add(win);
      // sail hub + four blades (turn in update)
      const sails = new THREE.Group();
      sails.position.set(0, 4.4, 1.9);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), voxelMaterial(VOX.barkDark));
      sails.add(hub);
      for (let b = 0; b < 4; b++) {
        const blade = new THREE.Group();
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.18), voxelMaterial(VOX.bark));
        spar.position.y = 1.7; blade.add(spar);
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.6, 0.1), voxelMaterial(VOX.houseWall));
        cloth.position.set(0.5, 1.7, 0.06); blade.add(cloth);
        blade.rotation.z = (b / 4) * Math.PI * 2;
        sails.add(blade);
      }
      mill.add(sails);
      this.windmillSails = sails;
      mill.position.set(at.x, 0, at.z);
      mill.rotation.y = Math.atan2(-at.x, -at.z); // face roughly inward
      this.group.add(mill);
    }

    // ---- GAZEBO (a quiet corner) ----
    {
      const cand: Vec2[] = [{ x: -27, z: 27 }, { x: 27, z: 27 }, { x: -27, z: -27 }];
      const at = cand.find((p) => safe(p.x, p.z, 3.5)) ?? cand[0];
      const gz = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.2, 0.4, 6), voxelMaterial(VOX.woodTrim));
      deck.position.y = 0.2; gz.add(deck);
      const deck2 = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.25, 6), voxelMaterial(VOX.crate));
      deck2.position.y = 0.5; gz.add(deck2);
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        const px = Math.cos(ang) * 2.4, pz = Math.sin(ang) * 2.4;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), voxelMaterial(VOX.bark));
        post.position.set(px, 1.9, pz); gz.add(post);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.8, 6), voxelMaterial(VOX.roofPurple));
      roof.position.y = 4.1; gz.add(roof);
      const finial = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.35), glowMaterial(0xc7a6ff, 0.7));
      finial.position.y = 5.2; finial.userData.noCast = true; gz.add(finial);
      this.pulses.push({ mesh: finial, base: 0.6, amp: 0.4, phase: 2.0 });
      gz.position.set(at.x, 0, at.z);
      this.group.add(gz);
    }

    // ---- LILY POND (a quiet corner) ----
    {
      const cand: Vec2[] = [{ x: 27, z: 27 }, { x: -27, z: 27 }, { x: 27, z: -27 }];
      const at = cand.find((p) => safe(p.x, p.z, 3.5)) ?? cand[0];
      // shallow stone rim + a reflective water disc set just below the grass
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.4, 12), voxelMaterial(VOX.pebble));
      rim.position.set(at.x, GROUND_TOP + 0.05, at.z); rim.userData.noCast = true; this.group.add(rim);
      const pondMat = new THREE.MeshStandardMaterial({
        color: TD_WATER, emissive: TD_WATER, emissiveIntensity: 0.22,
        transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.0,
      });
      const pond = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.3, 12), pondMat);
      pond.position.set(at.x, GROUND_TOP + 0.02, at.z); pond.userData.noCast = true; this.group.add(pond);
      this.portalRings.push(pond); // reuse the gentle emissive shimmer driver
      // a few lily pads + a glowing bloom
      let s = (Math.abs(at.x) + 7) | 0;
      const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let k = 0; k < 5; k++) {
        const ang = rnd() * Math.PI * 2, r = rnd() * 1.8;
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.7), voxelMaterial(0x5a9a5e));
        pad.position.set(at.x + Math.cos(ang) * r, GROUND_TOP + 0.2, at.z + Math.sin(ang) * r);
        pad.rotation.y = rnd() * Math.PI; pad.userData.noCast = true; this.group.add(pad);
        if (k < 2) {
          const flower = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.28), glowMaterial(VOX.flowerPink, 0.5));
          flower.position.copy(pad.position); flower.position.y += 0.18; flower.userData.noCast = true;
          this.group.add(flower);
        }
      }
    }
  }

  /** Lush diorama dressing on the grass (away from lane/pads/base/spawn): layered
   *  broadleaf + pine trees with the odd cherry blossom, rock clusters, and a
   *  carpet of low grass tufts + wildflowers — the same density as the arena. */
  private buildDecor() {
    let seed = 90125;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const trunkMat = voxelMaterial(0x7a5230);
    const trunkDark = voxelMaterial(0x5f3f25);
    const broad: [number, number][] = [[0x6ab04a, 0x8ed16a], [0x4f8a3a, 0x6fae4a], [0xd99a3a, 0xf0bd5e], [0xc24a35, 0xe0734f]];
    const pine: [number, number][] = [[0x3f7a4a, 0x5a9a5e], [0x4f8a3a, 0x6fae4a]];
    const rockMat = voxelMaterial(VOX.stone);
    const rockMatD = voxelMaterial(VOX.stoneDark);

    const blocked = (x: number, z: number, pad = 0): boolean => {
      if (this.nearLane(x, z, LANE_W + 1.8 + pad)) return true;
      for (const p of TD_PADS) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (3.0 + pad) ** 2) return true;
      if ((TD_GOAL.x - x) ** 2 + (TD_GOAL.z - z) ** 2 < (7 + pad) ** 2) return true;
      if ((TD_SPAWN.x - x) ** 2 + (TD_SPAWN.z - z) ** 2 < (7 + pad) ** 2) return true;
      return false;
    };

    // ---- trees + rocks (taller dressing) ---- (thinned on mobile)
    const treeTarget = LOW_TIER ? 42 : 78;
    let placed = 0, tries = 0;
    const decorReach = ARENA_HALF - 6; // stay inside the raised edge berm
    while (placed < treeTarget && tries++ < 900) {
      const x = (rnd() * 2 - 1) * decorReach;
      const z = (rnd() * 2 - 1) * decorReach;
      if (blocked(x, z, 1.5)) continue;
      placed++;
      const g = new THREE.Group();
      const roll = rnd();
      if (roll < 0.5) {
        // broadleaf: tapered trunk + a bushy multi-box crown, sometimes blossom
        const th = 1.2 + rnd() * 1.2;
        const tk = new THREE.Mesh(new THREE.BoxGeometry(0.5, th, 0.5), rnd() < 0.5 ? trunkMat : trunkDark);
        tk.position.y = th / 2; g.add(tk);
        const blossom = rnd() < 0.16;
        const [cMain, cTop] = blossom ? [0xff9ec7, 0xffc2dd] : broad[Math.floor(rnd() * broad.length)];
        const crowns = 3 + Math.floor(rnd() * 2);
        for (let k = 0; k < crowns; k++) {
          const w = 2.4 - k * 0.55;
          const c = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.7, w), voxelMaterial(k === crowns - 1 ? cTop : cMain));
          c.position.set((rnd() - 0.5) * 0.7, th + 0.3 + k * 0.62, (rnd() - 0.5) * 0.7);
          g.add(c);
        }
      } else if (roll < 0.78) {
        // pine: slim trunk + tapering tiers
        const [pMain, pTop] = pine[Math.floor(rnd() * pine.length)];
        const th = 1.0 + rnd() * 0.9;
        const tk = new THREE.Mesh(new THREE.BoxGeometry(0.4, th, 0.4), trunkDark);
        tk.position.y = th / 2; g.add(tk);
        const tiers = 4 + Math.floor(rnd() * 2);
        for (let k = 0; k < tiers; k++) {
          const w = 2.3 - k * (1.8 / tiers);
          const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, w), voxelMaterial(k === tiers - 1 ? pTop : pMain));
          t.position.y = th + 0.2 + k * 0.6; g.add(t);
        }
      } else {
        // rock cluster
        const cnt = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < cnt; k++) {
          const s = 0.7 + rnd() * 1.1;
          const rk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s), rnd() < 0.5 ? rockMat : rockMatD);
          rk.position.set((rnd() - 0.5) * 1.5, s * 0.4, (rnd() - 0.5) * 1.5);
          rk.rotation.y = rnd() * Math.PI; g.add(rk);
        }
      }
      g.position.set(x, 0, z);
      g.scale.setScalar(0.85 + rnd() * 0.6);
      this.group.add(g);
    }

    // ---- low ground cover: grass tufts + wildflowers (carpet, breaks the checker) ----
    const tuftMat = voxelMaterial(TD_GRASS_LIGHT);
    const flowerCols = [0xff6f91, 0xffd24a, 0xfff4e0, 0xff5a4a, 0x9b6fff];
    const tuftTarget = LOW_TIER ? 70 : 150;
    let f = 0, ftries = 0;
    while (f < tuftTarget && ftries++ < 1400) {
      const x = (rnd() * 2 - 1) * decorReach;
      const z = (rnd() * 2 - 1) * decorReach;
      if (blocked(x, z, -0.5)) continue;
      f++;
      if (rnd() < 0.55) {
        const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.3), tuftMat);
        tuft.position.set(x, 0.22, z);
        tuft.userData.noCast = true;
        this.group.add(tuft);
      } else {
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), tuftMat);
        stem.position.set(x, 0.2, z);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), glowMaterial(flowerCols[Math.floor(rnd() * flowerCols.length)], 0.35));
        head.position.set(x, 0.5, z);
        head.userData.noCast = true; stem.userData.noCast = true;
        this.group.add(stem, head);
      }
    }
  }

  /** Atmosphere: drifting clouds overhead + warm brazier light-pools flanking the
   *  base and spawn, for the cozy golden-hour depth the arena has. */
  private buildAtmosphere() {
    let seed = 31337;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    // soft voxel clouds drifting across, high above the field
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2e0, emissiveIntensity: 0.25, roughness: 1, transparent: true, opacity: 0.92 });
    const cloudCount = LOW_TIER ? 4 : 7;
    for (let i = 0; i < cloudCount; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < puffs; k++) {
        const w = 2 + rnd() * 3;
        const puff = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.6, w * 0.8), cloudMat);
        puff.position.set((rnd() - 0.5) * 7, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 4);
        puff.userData.noCast = true;
        cloud.add(puff);
      }
      cloud.position.set((rnd() * 2 - 1) * ARENA_HALF, 16 + rnd() * 6, (rnd() * 2 - 1) * ARENA_HALF);
      this.group.add(cloud);
      this.clouds.push({ group: cloud, speed: 0.6 + rnd() * 0.9, x0: cloud.position.x });
    }

    // warm braziers (point light + ember) at the base + spawn + a couple mid-field
    const spots: Vec2[] = [
      { x: TD_GOAL.x - 4.5, z: TD_GOAL.z }, { x: TD_GOAL.x + 4.5, z: TD_GOAL.z },
      { x: clamp(TD_SPAWN.x, -ARENA_HALF + 2, ARENA_HALF - 2), z: TD_SPAWN.z - 4 },
    ];
    for (const s of spots) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.4), voxelMaterial(VOX.stoneDark));
      post.position.set(s.x, 0.8, s.z);
      const bowl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.9), voxelMaterial(VOX.cobble));
      bowl.position.set(s.x, 1.7, s.z);
      const ember = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), glowMaterial(VOX.emberHot, 1.4));
      ember.position.set(s.x, 2.0, s.z);
      ember.userData.noCast = true;
      this.group.add(post, bowl, ember);
      this.pulses.push({ mesh: ember, base: 1.1, amp: 0.7, phase: s.x * 0.3 });
      // dynamic point lights are pricey on mobile — keep only the two base
      // braziers lit there (the embers still glow via bloom regardless).
      if (!LOW_TIER || s.z === TD_GOAL.z) {
        const light = new THREE.PointLight(0xff8a3a, 3.2, 11, 2);
        light.position.set(s.x, 2.4, s.z);
        this.group.add(light);
      }
    }
  }

  /**
   * AMBIENT PARTICLES — two cheap THREE.Points clouds, animated in update():
   *   • fireflies: tiny warm glowing motes that bob + drift in lazy circles
   *   • petals:   slow-falling cherry-blossom flecks that sway and respawn
   * Both reuse a single preallocated position buffer (no per-frame allocation),
   * are additive + depthWrite:false so they read as soft light, and `noCast`.
   */
  private buildParticles() {
    let seed = 24601;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    // ---- fireflies ---- (halved on mobile to protect the FPS budget)
    const FN = LOW_TIER ? 26 : 60;
    const fpos = new Float32Array(FN * 3);
    for (let i = 0; i < FN; i++) {
      const x = (rnd() * 2 - 1) * (ARENA_HALF - 4);
      const z = (rnd() * 2 - 1) * (ARENA_HALF - 4);
      const y = 1.0 + rnd() * 4.0;
      this.fireflyData.push({ x, z, y, phase: rnd() * Math.PI * 2, speed: 0.3 + rnd() * 0.5, rad: 0.6 + rnd() * 1.4 });
      fpos[i * 3] = x; fpos[i * 3 + 1] = y; fpos[i * 3 + 2] = z;
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
    const fmat = new THREE.PointsMaterial({
      color: 0xffe6a0, size: 0.5, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const fire = new THREE.Points(fgeo, fmat);
    fire.frustumCulled = false;
    fire.userData.noCast = true;
    this.group.add(fire);
    this.fireflies = fire;

    // ---- falling petals ---- (halved on mobile)
    const PN = LOW_TIER ? 22 : 50;
    const ppos = new Float32Array(PN * 3);
    for (let i = 0; i < PN; i++) {
      const x = (rnd() * 2 - 1) * ARENA_HALF;
      const z = (rnd() * 2 - 1) * ARENA_HALF;
      const y = rnd() * 16;
      this.petalData.push({ x, z, y, vy: 0.4 + rnd() * 0.6, sway: 0.5 + rnd() * 1.2, phase: rnd() * Math.PI * 2 });
      ppos[i * 3] = x; ppos[i * 3 + 1] = y; ppos[i * 3 + 2] = z;
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
    const pmat = new THREE.PointsMaterial({
      color: 0xffc2dd, size: 0.42, sizeAttenuation: true,
      transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false,
    });
    const pet = new THREE.Points(pgeo, pmat);
    pet.frustumCulled = false;
    pet.userData.noCast = true;
    this.group.add(pet);
    this.petals = pet;

    // ---- drifting DUST MOTES ---- a fine low-lying haze of slow-circling specks
    // catching the golden-hour light for atmospheric depth. The most expensive
    // of the three layers, so it is SKIPPED ENTIRELY on mobile (LOW_TIER).
    if (!LOW_TIER) {
      const DN = 70;
      const dpos = new Float32Array(DN * 3);
      for (let i = 0; i < DN; i++) {
        const x = (rnd() * 2 - 1) * (ARENA_HALF - 2);
        const z = (rnd() * 2 - 1) * (ARENA_HALF - 2);
        const y = 0.6 + rnd() * 6.0;
        this.dustData.push({ x, z, y, phase: rnd() * Math.PI * 2, speed: 0.08 + rnd() * 0.16, rad: 0.4 + rnd() * 1.0 });
        dpos[i * 3] = x; dpos[i * 3 + 1] = y; dpos[i * 3 + 2] = z;
      }
      const dgeo = new THREE.BufferGeometry();
      dgeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
      const dmat = new THREE.PointsMaterial({
        color: 0xffe9c8, size: 0.16, sizeAttenuation: true,
        transparent: true, opacity: 0.5, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const dust = new THREE.Points(dgeo, dmat);
      dust.frustumCulled = false;
      dust.userData.noCast = true;
      this.group.add(dust);
      this.dust = dust;
    }
  }

  /** A raised stone build-pad plinth with a glowing rim at every TD_PADS spot —
   *  a tiered hex plinth, four corner studs, a softly-lit recessed "build here"
   *  inlay, a breathing rim ring and a slowly counter-rotating rune ring of
   *  glyph studs so each pad reads as an inviting, ready-to-build socket. */
  private buildPads() {
    // shared geometries so 12 pads stay cheap (each pad reuses these)
    const baseGeo = new THREE.CylinderGeometry(1.6, 1.8, 0.5, 6);
    const topGeo = new THREE.CylinderGeometry(1.3, 1.4, 0.35, 6);
    const inlayGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.12, 6);
    const studGeo = new THREE.BoxGeometry(0.34, 0.5, 0.34);
    const rimGeo = new THREE.TorusGeometry(1.5, 0.12, 6, 18);
    const glyphGeo = new THREE.BoxGeometry(0.14, 0.06, 0.34);

    TD_PADS.forEach((p, i) => {
      const pad = new THREE.Group();

      // low stone plinth (~2 units across), two stacked tiers
      const base = new THREE.Mesh(baseGeo, voxelMaterial(VOX.cobble));
      base.position.y = GROUND_TOP + 0.25;
      pad.add(base);
      const top = new THREE.Mesh(topGeo, voxelMaterial(VOX.cobbleDark));
      top.position.y = GROUND_TOP + 0.62;
      pad.add(top);

      // four chunky corner studs framing the socket (the "anchor bolts")
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const stud = new THREE.Mesh(studGeo, voxelMaterial(VOX.stone));
        stud.position.set(Math.cos(ang) * 1.18, GROUND_TOP + 0.62, Math.sin(ang) * 1.18);
        stud.rotation.y = ang;
        pad.add(stud);
      }

      // recessed, softly-lit inlay disc — the warm "build here" surface
      const inlay = new THREE.Mesh(inlayGeo, glowMaterial(0xffd98a, 0.45));
      inlay.position.y = GROUND_TOP + 0.74;
      inlay.userData.noCast = true;
      pad.add(inlay);
      this.pulses.push({ mesh: inlay, base: 0.3, amp: 0.35, phase: i * 0.9 + 0.4 });

      // gentle glowing rim ring (breathes) so the buildable spot reads clearly
      const rim = new THREE.Mesh(rimGeo, glowMaterial(VOX.emberHot, 0.7));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = GROUND_TOP + 0.5;
      rim.userData.noCast = true;
      pad.add(rim);
      this.pulses.push({ mesh: rim, base: 0.5, amp: 0.5, phase: i * 0.7 });

      // a slowly counter-rotating ring of small glyph studs hovering over the
      // inlay — gives every pad a little "summoning circle" liveliness
      const glyphs = new THREE.Group();
      glyphs.position.y = GROUND_TOP + 0.84;
      const glyphN = LOW_TIER ? 3 : 6;
      for (let k = 0; k < glyphN; k++) {
        const ang = (k / glyphN) * Math.PI * 2;
        const g = new THREE.Mesh(glyphGeo, glowMaterial(VOX.emberHot, 0.8));
        g.position.set(Math.cos(ang) * 0.82, 0, Math.sin(ang) * 0.82);
        g.rotation.y = ang;
        g.userData.noCast = true;
        glyphs.add(g);
        this.pulses.push({ mesh: g, base: 0.4, amp: 0.5, phase: i * 0.5 + k * 0.6 });
      }
      pad.add(glyphs);
      this.padSpinners.push({ group: glyphs, speed: 0.35 + (i % 3) * 0.08 });

      pad.position.set(p.x, 0, p.z);
      this.group.add(pad);
      this.padMarkers.push(pad);
    });
  }

  /** A glowing spawn arch/portal at TD_SPAWN (off the west edge) where creeps
   *  emerge — two stone pillars, a lintel, and a shimmering portal pane. */
  private buildSpawn() {
    const portal = new THREE.Group();
    const pillarMat = voxelMaterial(VOX.stoneDark);
    const half = LANE_W + 0.6; // pillars flank the lane mouth

    // a low stone footing slab so the arch reads as built, not floating
    const footing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, half * 2 + 2.2), voxelMaterial(VOX.cobbleDark));
    footing.position.set(0, GROUND_TOP + 0.25, 0);
    portal.add(footing);

    for (const sx of [-1, 1]) {
      // layered pillar: a chunky base block, the shaft, and a capital
      const pbase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.8), voxelMaterial(VOX.cobble));
      pbase.position.set(0, GROUND_TOP + 0.85, sx * half);
      portal.add(pbase);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.4, 1.4), pillarMat);
      pillar.position.set(0, GROUND_TOP + 3.0, sx * half);
      portal.add(pillar);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 1.8), voxelMaterial(VOX.cobble));
      cap.position.set(0, GROUND_TOP + 5.3, sx * half);
      portal.add(cap);
      // a glowing rune inset on each pillar (caught by bloom)
      const rune = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), glowMaterial(0xc7a6ff, 1.0));
      rune.position.set(0.5, GROUND_TOP + 3.0, sx * half);
      rune.userData.noCast = true;
      portal.add(rune);
      this.pulses.push({ mesh: rune, base: 0.8, amp: 0.5, phase: sx + 1 });
    }
    // lintel across the top + a crenellated cap row
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, half * 2 + 2.2), voxelMaterial(VOX.stone));
    lintel.position.set(0, GROUND_TOP + 5.7, 0);
    portal.add(lintel);
    for (let k = -2; k <= 2; k++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), voxelMaterial(VOX.cobbleDark));
      tooth.position.set(0, GROUND_TOP + 6.4, k * 1.7);
      portal.add(tooth);
    }
    // a small keystone glow at the apex
    const keystone = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), glowMaterial(0x9b6fff, 1.2));
    keystone.position.set(0, GROUND_TOP + 6.0, 0);
    keystone.userData.noCast = true;
    portal.add(keystone);
    this.pulses.push({ mesh: keystone, base: 0.9, amp: 0.6, phase: 0.5 });

    // a deep dark "mouth" behind the pane so the gateway reads as an opening
    // into somewhere else (creeps emerge out of the void), not a flat panel
    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2 + 0.4, 5.0),
      new THREE.MeshBasicMaterial({ color: 0x140a26, side: THREE.DoubleSide, fog: false, toneMapped: false }),
    );
    mouth.rotation.y = Math.PI / 2;
    mouth.position.set(0.25, GROUND_TOP + 2.6, 0);
    mouth.userData.noCast = true;
    portal.add(mouth);

    // shimmering portal pane (glow, caught by bloom) inside the arch
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, 4.6),
      new THREE.MeshStandardMaterial({
        color: 0x9b6fff,
        emissive: 0x9b6fff,
        emissiveIntensity: 1.1,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        roughness: 0.4,
        metalness: 0.0,
      }),
    );
    pane.rotation.y = Math.PI / 2;
    pane.position.set(0, GROUND_TOP + 2.5, 0);
    pane.userData.noCast = true;
    portal.add(pane);
    this.portalRings.push(pane);

    // a couple of glowing rim accents (breathe)
    for (let k = 0; k < 2; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8 + k * 0.5, 0.1, 6, 20), glowMaterial(0xc7a6ff, 0.9));
      ring.rotation.y = Math.PI / 2;
      ring.position.set(0, GROUND_TOP + 2.5, 0);
      ring.userData.noCast = true;
      portal.add(ring);
      this.pulses.push({ mesh: ring, base: 0.7, amp: 0.6, phase: k * 1.1 });
    }

    // sit the arch at the spawn point (clamped to the arena edge for the visual)
    portal.position.set(clamp(TD_SPAWN.x, -ARENA_HALF + 1, ARENA_HALF - 1), 0, TD_SPAWN.z);
    this.group.add(portal);
  }

  /** The BASE you defend at TD_GOAL — a chunky stone keep crowned by an emissive
   *  crystal core (pulses gently; `flashBase()` makes it flare when damaged). */
  private buildBase() {
    // wide stepped foundation (two skirts) so the keep reads as monumental
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.5, 7.2), voxelMaterial(VOX.cobbleDark));
    skirt.position.y = GROUND_TOP + 0.25;
    this.base.add(skirt);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(6, 1.0, 6), voxelMaterial(VOX.cobble));
    plinth.position.y = GROUND_TOP + 0.75;
    this.base.add(plinth);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 4.4), voxelMaterial(VOX.stone));
    keep.position.y = GROUND_TOP + 2.55;
    this.base.add(keep);
    // a contrasting masonry band around the keep
    const band = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.5, 4.7), voxelMaterial(VOX.stoneDark));
    band.position.y = GROUND_TOP + 1.7;
    this.base.add(band);
    const battle = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.6, 5.0), voxelMaterial(VOX.stoneDark));
    battle.position.y = GROUND_TOP + 4.15;
    this.base.add(battle);

    // glowing arched doorway facing the lane (toward -z, where creeps arrive)
    const doorGlow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.3), glowMaterial(0x6ad7ff, 0.8));
    doorGlow.position.set(0, GROUND_TOP + 2.1, -2.25);
    doorGlow.userData.noCast = true;
    this.base.add(doorGlow);
    this.pulses.push({ mesh: doorGlow, base: 0.5, amp: 0.4, phase: 1.4 });

    // four corner towers with merlons + brazier cups (a sturdier silhouette)
    for (const mx of [-1, 1]) {
      for (const mz of [-1, 1]) {
        const turret = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.6, 1.1), voxelMaterial(VOX.stone));
        turret.position.set(mx * 2.25, GROUND_TOP + 2.6, mz * 2.25);
        this.base.add(turret);
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.3), voxelMaterial(VOX.cobbleDark));
        merlon.position.set(mx * 2.25, GROUND_TOP + 4.6, mz * 2.25);
        this.base.add(merlon);
        const cup = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.55), glowMaterial(VOX.emberHot, 1.3));
        cup.position.set(mx * 2.25, GROUND_TOP + 5.05, mz * 2.25);
        cup.userData.noCast = true;
        this.base.add(cup);
        this.pulses.push({ mesh: cup, base: 1.0, amp: 0.6, phase: mx * 1.3 + mz });
      }
    }

    // two hanging BANNERS flanking the front, in the player's crystal-blue, with
    // a stored phase so they ripple gently in update()
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.0, 0.18), voxelMaterial(VOX.barkDark));
      pole.position.set(sx * 1.6, GROUND_TOP + 2.4, -3.4);
      this.base.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 1.2), toyMaterial(0x4a78d6, { emissive: 0x274a86, emissiveIntensity: 0.4 }));
      flag.position.set(sx * 1.6, GROUND_TOP + 3.4, -2.9);
      this.base.add(flag);
      this.bannerFlags.push({ mesh: flag, phase: sx, baseRot: 0 });
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.4), glowMaterial(0x6ad7ff, 0.7));
      crest.position.set(sx * 1.6, GROUND_TOP + 3.7, -2.9);
      crest.userData.noCast = true;
      this.base.add(crest);
      this.pulses.push({ mesh: crest, base: 0.5, amp: 0.4, phase: sx + 0.7 });
    }

    // the defended CRYSTAL CORE — a faceted glowing gem floating above the keep,
    // wrapped in a faint additive halo shell for a softer glow
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), glowMaterial(0x6ad7ff, this.coreBaseEmissive));
    (core.geometry as THREE.BufferGeometry).scale(1, 1.5, 1);
    core.position.y = GROUND_TOP + 5.9;
    this.base.add(core);
    this.coreGem = core;
    const halo = new THREE.Mesh(new THREE.OctahedronGeometry(1.7, 0), auraMaterial(0x6ad7ff, 0.5));
    (halo.geometry as THREE.BufferGeometry).scale(1, 1.4, 1);
    halo.position.y = GROUND_TOP + 5.9;
    halo.userData.noCast = true;
    this.base.add(halo);

    // a cluster of small crystal SHARDS orbiting the core (counter-rotates in
    // update) — gives the keep's heart a living, magical "powered" feel
    const shards = new THREE.Group();
    shards.position.y = GROUND_TOP + 5.7;
    const shardN = LOW_TIER ? 3 : 5;
    const shardGeo = new THREE.OctahedronGeometry(0.32, 0);
    for (let k = 0; k < shardN; k++) {
      const ang = (k / shardN) * Math.PI * 2;
      const shard = new THREE.Mesh(shardGeo, glowMaterial(0x9be3ff, 1.0));
      shard.position.set(Math.cos(ang) * 2.0, Math.sin(ang * 1.4) * 0.5, Math.sin(ang) * 2.0);
      shard.scale.set(0.8, 1.5, 0.8);
      shard.userData.noCast = true;
      shards.add(shard);
      this.pulses.push({ mesh: shard, base: 0.7, amp: 0.6, phase: k * 0.9 });
    }
    this.base.add(shards);
    this.coreShards = shards;
    // a cool point light at the core so the keep glows from within
    const coreLight = new THREE.PointLight(0x6ad7ff, 2.4, 14, 2);
    coreLight.position.set(0, GROUND_TOP + 5.9, 0);
    this.base.add(coreLight);

    // a glowing dais ring around the keep base so the goal reads clearly
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.18, 6, 24), glowMaterial(0x6ad7ff, 0.7));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = GROUND_TOP + 0.6;
    ring.userData.noCast = true;
    this.base.add(ring);
    this.pulses.push({ mesh: ring, base: 0.6, amp: 0.5, phase: 0.3 });

    // a slowly-rotating arcane GLYPH ring inlaid on the dais — radial rune ticks
    // around a thin circle, all merged into one mesh so it stays a single draw
    // call, that drifts under the keep for a "magical wellspring" feel.
    {
      const glyph = new THREE.Group();
      const tickGeo = new THREE.BoxGeometry(0.22, 0.05, 0.7);
      const tickN = LOW_TIER ? 8 : 14;
      for (let k = 0; k < tickN; k++) {
        const ang = (k / tickN) * Math.PI * 2;
        const tick = new THREE.Mesh(tickGeo, glowMaterial(0x6ad7ff, 0.7));
        tick.position.set(Math.cos(ang) * 3.0, 0, Math.sin(ang) * 3.0);
        tick.rotation.y = -ang;
        tick.userData.noCast = true;
        glyph.add(tick);
      }
      const innerRing = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.07, 5, 28), glowMaterial(0x6ad7ff, 0.6));
      innerRing.rotation.x = Math.PI / 2;
      innerRing.userData.noCast = true;
      glyph.add(innerRing);
      glyph.position.y = GROUND_TOP + 0.12;
      this.base.add(glyph);
      // reuse coreShards' field slot? no — store separately as a single mesh-ish
      this.baseGlyph = glyph as unknown as THREE.Mesh;
    }

    // a translucent SHIELD DOME over the keep that drains + reddens as base HP
    // falls and flares white on a hit (driven by setBaseHealth + flashBase)
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(4.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x7fe0ff, emissive: 0x4fb8ff, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }),
    );
    shield.position.y = GROUND_TOP + 0.3;
    shield.userData.noCast = true;
    this.base.add(shield);
    this.shield = shield;

    this.base.position.set(TD_GOAL.x, 0, TD_GOAL.z);
    this.group.add(this.base);
  }

  /** Set the base health fraction (0..1) — the shield dome shrinks + reddens. */
  setBaseHealth(frac: number) {
    this.shieldFrac = Math.max(0, Math.min(1, frac));
  }

  /** Shift the dusk mood toward an ominous red haze during boss waves. */
  setBossMood(on: boolean) {
    this.bossMoodTarget = on ? 1 : 0;
  }

  /** Flare the spawn portal (a wave is starting). */
  pulseSpawn() {
    this.spawnPulse = 0.7;
  }

  /** Glowing chevron arrows along the lane that pulse TOWARD the base, so the
   *  creep direction reads at a glance and the road feels alive. */
  private buildLaneFlow() {
    const total = pathLength(TD_PATH);
    const step = 3.4;
    for (let arc = step; arc < total - 1; arc += step) {
      const p = pointAt(arc, TD_PATH);
      if (Math.abs(p.x) > ARENA_HALF - 1 || Math.abs(p.z) > ARENA_HALF - 1) continue;
      const h = headingAt(arc, TD_PATH);
      const chevron = new THREE.Group();
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.16), glowMaterial(0x8fe0ff, 0.7));
        arm.position.set(sx * 0.28, 0, -0.18);
        arm.rotation.y = sx * 0.7;
        chevron.add(arm);
      }
      chevron.position.set(p.x, GROUND_TOP + 0.06, p.z);
      chevron.rotation.y = Math.atan2(h.dx, h.dz);
      chevron.userData.noCast = true;
      this.group.add(chevron);
      // store the mesh-pair's arc so a brightness wave can flow along the lane
      chevron.children.forEach((c) => this.laneFlow.push({ mesh: c as THREE.Mesh, arc }));
    }
  }

  // ========================================================================
  //  HELPERS
  // ========================================================================

  /** True if (x,z) lies within `pad` units of any TD_PATH segment (used to
   *  carve the road gap out of the grass field). */
  private nearLane(x: number, z: number, pad: number): boolean {
    for (let i = 1; i < TD_PATH.length; i++) {
      if (distToSeg(x, z, TD_PATH[i - 1], TD_PATH[i]) <= pad) return true;
    }
    return false;
  }

  /** Opaque structures cast + receive contact shadows; glow/transparent bits
   *  and the big tile field (tagged noCast) only receive. */
  private applyShadows() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      if (Array.isArray(mat) || mat.transparent) return;
      mesh.receiveShadow = true;
      mesh.castShadow = !mesh.userData.noCast;
    });
  }

  // ========================================================================
  //  ANIMATION — gentle ambient life only
  // ========================================================================

  update(dt: number) {
    if (!this.group.visible) return;
    this.t += dt;
    const t = this.t;

    // boss-wave mood: ease the fog + sky toward an ominous red during boss waves
    this.bossMoodCur += (this.bossMoodTarget - this.bossMoodCur) * Math.min(1, dt * 1.6);
    const bm = this.bossMoodCur;
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog && fog.color) { fog.color.lerpColors(_FOG_CALM, _FOG_BOSS, bm); fog.far = 96 - 30 * bm; }
    if (this.scene.background instanceof THREE.Color) this.scene.background.lerpColors(_BG_CALM, _BG_BOSS, bm * 0.7);
    if (this.spawnPulse > 0) this.spawnPulse = Math.max(0, this.spawnPulse - dt);

    // lane flow: a brightness wave ripples along the chevrons toward the base
    for (const f of this.laneFlow) {
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      const wave = Math.sin(t * 2.2 - f.arc * 0.5);
      mat.emissiveIntensity = 0.35 + Math.max(0, wave) * 1.1;
      mat.opacity = 1;
    }

    // base shield: ease toward the target HP fraction; reddens + shrinks as it
    // drains, flares white on a hit (flashTimer)
    if (this.shield) {
      const sm = this.shield.material as THREE.MeshStandardMaterial;
      const target = this.shieldFrac;
      this.shield.scale.setScalar(0.55 + 0.45 * target);
      const hit = this.flashTimer > 0;
      sm.opacity = (hit ? 0.5 : 0.1 + 0.16 * target) + Math.sin(t * 3) * 0.03;
      // blue when healthy → amber → red as it drains
      const g = 0.35 + 0.6 * target, b = 0.3 + 0.7 * target;
      sm.color.setRGB(hit ? 1 : Math.min(1, 1.2 - target), g, b);
      sm.emissive.copy(sm.color);
      sm.emissiveIntensity = hit ? 1.6 : 0.5 + (1 - target) * 0.6;
    }

    // spawn-portal shimmer: the pane breathes its emissive + opacity, and FLARES
    // when a wave starts (spawnPulse)
    for (const pane of this.portalRings) {
      const mat = pane.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.9 + (Math.sin(t * 2.0) + 1) * 0.4 + this.spawnPulse * 4;
      mat.opacity = Math.min(1, 0.5 + (Math.sin(t * 1.4) + 1) * 0.12 + this.spawnPulse * 0.5);
    }

    // base core: slow spin + bob + gentle pulse, with a damage-flash override
    if (this.coreGem) {
      this.coreGem.rotation.y += dt * 1.1;
      this.coreGem.position.y = GROUND_TOP + 5.6 + Math.sin(t * 1.5) * 0.16;
      const mat = this.coreGem.material as THREE.MeshStandardMaterial;
      if (this.flashTimer > 0) {
        this.flashTimer = Math.max(0, this.flashTimer - dt);
        // flare bright + tint toward red while flashing
        mat.emissiveIntensity = 3.2;
        mat.emissive.setHex(0xff5a4a);
      } else {
        mat.emissive.setHex(0x6ad7ff);
        mat.emissiveIntensity = this.coreBaseEmissive + (Math.sin(t * 2.0) + 1) * 0.35;
      }
    }

    // clouds drift slowly across and wrap around
    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > ARENA_HALF + 14) c.group.position.x = -ARENA_HALF - 14;
    }

    // windmill sails turn lazily
    if (this.windmillSails) this.windmillSails.rotation.z += dt * 0.45;

    // build-pad rune rings drift (counter to one another via per-pad speed)
    for (const s of this.padSpinners) s.group.rotation.y += dt * s.speed;

    // base crystal shards orbit + the dais glyph rotates slowly underneath
    if (this.coreShards) this.coreShards.rotation.y -= dt * 0.5;
    if (this.baseGlyph) this.baseGlyph.rotation.y += dt * 0.18;

    // base banners ripple gently (tilt + slight twist)
    for (const b of this.bannerFlags) {
      b.mesh.rotation.z = Math.sin(t * 1.6 + b.phase) * 0.12;
      b.mesh.rotation.y = b.baseRot + Math.sin(t * 1.1 + b.phase) * 0.08;
    }

    // surrounding water shimmer: a soft breathing emissive (subtle, calm)
    if (this.water) {
      (this.water.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.15 + (Math.sin(t * 0.8) + 1) * 0.06;
    }

    // fireflies: bob + drift in lazy little circles around their home point
    if (this.fireflies) {
      const attr = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.fireflyData.length; i++) {
        const f = this.fireflyData[i];
        const a = t * f.speed + f.phase;
        arr[i * 3] = f.x + Math.cos(a) * f.rad;
        arr[i * 3 + 1] = f.y + Math.sin(a * 1.7) * 0.6;
        arr[i * 3 + 2] = f.z + Math.sin(a * 0.8) * f.rad;
      }
      attr.needsUpdate = true;
      (this.fireflies.material as THREE.PointsMaterial).opacity = 0.7 + (Math.sin(t * 3) + 1) * 0.12;
    }

    // petals: drift down + sway, respawn at the top once they reach the ground
    if (this.petals) {
      const attr = this.petals.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.petalData.length; i++) {
        const p = this.petalData[i];
        p.y -= p.vy * dt;
        if (p.y < 0.3) { p.y = 15 + (i % 5); p.x = ((i * 53) % (ARENA_HALF * 2)) - ARENA_HALF; }
        arr[i * 3] = p.x + Math.sin(t * p.sway + p.phase) * 0.8;
        arr[i * 3 + 1] = p.y;
        arr[i * 3 + 2] = p.z + Math.cos(t * p.sway * 0.7 + p.phase) * 0.8;
      }
      attr.needsUpdate = true;
    }

    // dust motes: slow lazy circles + a faint vertical bob (cheap; desktop only)
    if (this.dust) {
      const attr = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.dustData.length; i++) {
        const d = this.dustData[i];
        const a = t * d.speed + d.phase;
        arr[i * 3] = d.x + Math.cos(a) * d.rad;
        arr[i * 3 + 1] = d.y + Math.sin(a * 1.3) * 0.4;
        arr[i * 3 + 2] = d.z + Math.sin(a * 0.6) * d.rad;
      }
      attr.needsUpdate = true;
    }

    // generic emissive pulses (pad rims, portal rings, base dais ring, braziers,
    // lane lanterns, banners' crests, landmark accents)
    for (const p of this.pulses) {
      (p.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
        p.base + (Math.sin(t * 2.4 + p.phase) + 1) * 0.5 * p.amp;
    }
  }
}

// ---- pure geometry helpers -------------------------------------------------
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Distance from point (px,pz) to segment a→b in the XZ plane. */
function distToSeg(px: number, pz: number, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const wx = px - a.x;
  const wz = pz - a.z;
  const len2 = vx * vx + vz * vz;
  let tt = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
  tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
  const cx = a.x + tt * vx;
  const cz = a.z + tt * vz;
  return Math.hypot(px - cx, pz - cz);
}
