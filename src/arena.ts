import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { WORLD } from "./config";
import { VOX, voxelMaterial, glowMaterial } from "./palette";
import { isTouchDevice } from "./touchControls";

// LOW_TIER (mobile/touch) signal — same as used elsewhere in the game. On
// mobile the horde is draw-call/fragment bound and three.js forward-renders
// EVERY dynamic PointLight into EVERY Lambert fragment with no culling, so the
// handful of decorative camp lights multiply per-pixel cost across the whole
// field. We skip those decorative point lights on mobile (keeping their
// emissive glow meshes, which self-illuminate and read fine without a real
// light), and keep the key Directional + Hemisphere lights everywhere.
const LOW_TIER = isTouchDevice();

/** Axis-aligned box footprint that the player + zombies are pushed out of. */
interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Night-mood palette local to the arena (the rest of the game keeps VOX). */
const NITE = {
  skyTop: 0x070d20,
  skyBottom: 0x25304e,
  fog: 0x141c33,
  background: 0x0d1428,
  moon: 0xf2f5e0,
  moonCrater: 0xd9dfc4,
  moonHalo: 0x9fb4e8,
  starCool: 0xcfd9ff,
  starWarm: 0xfff0d2,
  cloud: 0xaab4c8,
  canvas: 0x9a8a66,   // weathered tent canvas
  canvasDark: 0x6f6248,
  canvasRed: 0x9a4a36,
  canvasGreen: 0x6f7a64,
  ash: 0x23241f,
  asphalt: 0x34373e,
  asphaltDark: 0x282b31,
  crack: 0x1c1e23,
  paintLine: 0xb8a24e,
  deadBark: 0x4a3a2c,
  deadBarkDark: 0x352a20,
  bramble: 0x3c2f24,
  crow: 0x14151c,
  crowBeak: 0x9a6a2a,
  shroomTeal: 0x58e0c0,
  shroomBlue: 0x6fb8ff,
  shroomStem: 0x77847c,
  signBoard: 0xd9b13a,
  mist: 0xb4c2e2,
};

/** Accumulates voxel positions per color, then bakes one InstancedMesh per color. */
class VoxelBatch {
  private buckets = new Map<
    number,
    { x: number; y: number; z: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number }[]
  >();

  add(x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    let arr = this.buckets.get(color);
    if (!arr) this.buckets.set(color, (arr = []));
    arr.push({ x, y, z, sx, sy, sz, rx, ry, rz });
  }

  build(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    cast: boolean,
    receive: boolean,
    matFn: (color: number) => THREE.Material = voxelMaterial,
  ) {
    const dummy = new THREE.Object3D();
    for (const [color, arr] of this.buckets) {
      const mesh = new THREE.InstancedMesh(geo, matFn(color), arr.length);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      arr.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rx, p.ry, p.rz);
        dummy.scale.set(p.sx, p.sy, p.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      parent.add(mesh);
    }
  }
}

/**
 * The ZOMBIES survival arena at night — an **overrun campsite** diorama:
 * a moonlit voxel island under a deep-blue sky with a big low moon and a
 * dense star field. The camper van still anchors the central clearing, but
 * the camp now tells a story — ruined tents, a crashed supply truck, an
 * abandoned watchtower, sandbag arcs, cracked road fragments, dead trees
 * with restless crows, brambles, eerie glow-mushroom corners, drifting
 * ground mist, floating campfire embers and the odd distant lightning
 * flicker. All static props are baked into instanced VoxelBatch meshes;
 * collision footprints are EXACTLY the original set (zombies path the same).
 */
export class Arena {
  readonly group = new THREE.Group();
  readonly half = WORLD.half;
  readonly obstacles: Obstacle[] = [];
  readonly plaza = 6; // half-extent of the central clearing (camp pad)

  // Cheap, clean voxel edges — kept to 2 bevel segments so the thousands of
  // instanced voxels stay light (SMAA handles edge smoothing in post).
  private geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.07);
  private clouds: { group: THREE.Group; speed: number }[] = [];
  // Campfire flames that flicker (emissive + scale), plus rising smoke puffs.
  private flames: { mesh: THREE.Mesh; baseY: number; phase: number }[] = [];
  private smoke: { mesh: THREE.Mesh; baseX: number; baseY: number; baseZ: number; phase: number; speed: number; rise: number }[] = [];
  // Night-atmosphere registries (all pre-allocated; update() never allocates).
  private mist: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; bx: number; bz: number; phase: number; speed: number; base: number }[] = [];
  private embers: { mesh: THREE.Mesh; bx: number; by: number; bz: number; phase: number; speed: number; rise: number }[] = [];
  private crows: { pivL: THREE.Object3D; pivR: THREE.Object3D; body: THREE.Object3D; baseY: number; next: number; until: number; phase: number }[] = [];
  private flickers: { mat?: THREE.MeshStandardMaterial; light?: THREE.PointLight; base: number; speed: number; phase: number }[] = [];
  private bolt!: THREE.HemisphereLight; // distant-lightning pulse
  private boltAt = 0;     // when the current strike began
  private boltNext = 0;   // when the next strike fires
  private moonHalo: THREE.MeshBasicMaterial[] = [];
  private starTwinkle!: THREE.PointsMaterial;
  // Claimed decorative spots so random scatters don't pile onto set pieces.
  private deco: { x: number; z: number; r: number }[] = [];
  private t = 0;

  constructor(scene: THREE.Scene) {
    // Same fog structure, retuned to a deep night blue.
    scene.fog = new THREE.Fog(NITE.fog, WORLD.fogNear, WORLD.fogFar);

    this.buildSky(scene);
    this.buildLights(scene);

    const terrain = new VoxelBatch();
    const props = new VoxelBatch();
    const glow = new VoxelBatch(); // emissive panes/lanterns/shrooms (caught by bloom)
    this.generateGround(terrain, props);
    this.buildCamp(props, glow);
    this.buildTrees(props);
    terrain.build(this.group, this.geo, false, true);
    props.build(this.group, this.geo, true, true);
    glow.build(this.group, this.geo, false, false, (c) => glowMaterial(c, 0.9));

    this.buildRV();
    this.buildClouds(scene);
    this.buildMist();

    // Distant storm on the horizon: a hemisphere light that pulses on a long
    // random timer (see update()) — a brief cold flash over the whole field.
    this.bolt = new THREE.HemisphereLight(0xaec3ff, 0x39466e, 0);
    this.group.add(this.bolt);
    this.boltAt = -10;
    this.boltNext = 6 + Math.random() * 12;

    scene.add(this.group);
  }

  // ---- environment ----
  private buildSky(scene: THREE.Scene) {
    scene.background = new THREE.Color(NITE.background);
    const moonDir = new THREE.Vector3(-0.45, 0.24, -0.86).normalize();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(NITE.skyTop) },
          bottom: { value: new THREE.Color(NITE.skyBottom) },
          sun: { value: moonDir.clone() }, // repurposed as the moon-glow axis
          sunColor: { value: new THREE.Color(0x96aede) },
        },
        vertexShader: `
          varying vec3 vPos;
          void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: `
          uniform vec3 top; uniform vec3 bottom; uniform vec3 sun; uniform vec3 sunColor;
          varying vec3 vPos;
          void main() {
            float h = clamp(vPos.y / 300.0 * 0.5 + 0.5, 0.0, 1.0);
            vec3 col = mix(bottom, top, pow(h, 0.7));
            // A cold moon-glow bleeding into the night sky around the disc.
            float s = max(dot(normalize(vPos), sun), 0.0);
            col = mix(col, sunColor, pow(s, 5.0) * 0.45);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    scene.add(sky);

    this.buildStars(scene);
    this.buildMoon(scene, moonDir);
  }

  /** A dense, dirt-cheap star field: two Points layers (dim carpet + bright twinklers). */
  private buildStars(scene: THREE.Scene) {
    const starLayer = (count: number, size: number, opacity: number) => {
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const y = 0.07 + Math.random() * 0.9; // upper dome only
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        pos[i * 3] = Math.cos(a) * r * 272;
        pos[i * 3 + 1] = y * 272;
        pos[i * 3 + 2] = Math.sin(a) * r * 272;
        c.setHex(Math.random() < 0.18 ? NITE.starWarm : NITE.starCool);
        c.multiplyScalar(0.55 + Math.random() * 0.45);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size, sizeAttenuation: false, vertexColors: true, transparent: true,
        opacity, depthWrite: false, fog: false, toneMapped: false,
      });
      const pts = new THREE.Points(geo, mat);
      scene.add(pts);
      return mat;
    };
    starLayer(420, 1.7, 0.85);
    this.starTwinkle = starLayer(60, 3.2, 0.9); // the bright ones twinkle (see update)
  }

  /** A big low moon: glowing disc + soft additive halos + a few flat craters. */
  private buildMoon(scene: THREE.Scene, dir: THREE.Vector3) {
    const g = new THREE.Group();
    const flat = (r: number, color: number, opts: { add?: boolean; opacity?: number } = {}) =>
      new THREE.Mesh(
        new THREE.CircleGeometry(r, 40),
        new THREE.MeshBasicMaterial({
          color, fog: false, toneMapped: false,
          transparent: !!opts.add, opacity: opts.opacity ?? 1, depthWrite: !opts.add,
          blending: opts.add ? THREE.AdditiveBlending : THREE.NormalBlending,
        }),
      );
    const disc = flat(17, NITE.moon);
    g.add(disc);
    // craters: flat darker circles floated just in front of the disc (no z-fight)
    const craters: [number, number, number][] = [[-5, 4, 3.4], [6, -2, 2.4], [-1, -6.5, 1.8], [4.5, 7, 1.5]];
    for (const [cx, cy, cr] of craters) {
      const c = flat(cr, NITE.moonCrater);
      c.position.set(cx, cy, 0.6);
      g.add(c);
    }
    // halos: additive, drawn behind the disc, pulsing very gently in update()
    const halo1 = flat(27, NITE.moonHalo, { add: true, opacity: 0.2 });
    halo1.position.z = -0.6;
    const halo2 = flat(44, NITE.moonHalo, { add: true, opacity: 0.08 });
    halo2.position.z = -1.2;
    g.add(halo1, halo2);
    this.moonHalo.push(halo1.material as THREE.MeshBasicMaterial, halo2.material as THREE.MeshBasicMaterial);
    g.position.copy(dir).multiplyScalar(238);
    g.lookAt(0, 0, 0);
    scene.add(g);
  }

  private buildLights(scene: THREE.Scene) {
    // Cool night-dome fill — moonlit blue from above, faint earthy bounce below,
    // bright enough that the toy shapes still read (cozy night, not a cave).
    scene.add(new THREE.HemisphereLight(0x6a80b0, 0x2c3226, 0.55));
    // The key light IS the moon — cold, steep enough for readable shadows.
    const key = new THREE.DirectionalLight(0xbcd0f2, 1.15);
    key.position.set(-18, 27, -31); // matches the moon's azimuth
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); // 4× less shadow fill than 2048; barely visible at this art scale
    const d = this.half + 8;
    const cam = key.shadow.camera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 1; cam.far = 100;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    // Soft contact-AO shadows — defined enough to read as crisp, not hard black.
    key.shadow.intensity = 0.88;
    scene.add(key);

    // A faint warm counter-fill from the camp side — the campfire's glow caught
    // on shadowed faces, so the dark side of props never goes dead.
    const fill = new THREE.DirectionalLight(0xff9a5a, 0.12);
    fill.position.set(16, 11, 13);
    scene.add(fill);
  }

  // ---- ground generation ----
  private inArena(i: number, j: number): boolean {
    const H = this.half;
    if (Math.max(Math.abs(i), Math.abs(j)) > H) return false;
    const ci = Math.abs(i) - (H - 3);
    const cj = Math.abs(j) - (H - 3);
    if (ci > 0 && cj > 0 && ci + cj > 3) return false; // round the corners
    return true;
  }

  private generateGround(terrain: VoxelBatch, props: VoxelBatch) {
    const H = this.half;
    const P = this.plaza;

    for (let i = -H; i <= H; i++) {
      for (let j = -H; j <= H; j++) {
        if (!this.inArena(i, j)) continue;

        const cheb = Math.max(Math.abs(i), Math.abs(j));
        const onPlaza = cheb <= P;
        const onPath = !onPlaza && (Math.abs(i) <= 1 || Math.abs(j) <= 1);

        if (onPlaza) {
          // calm gravel pad (mostly one tone, a few darker flecks) — no harsh
          // checkerboard under the van.
          terrain.add(i, -0.5, j, (i * 5 + j * 3) % 7 === 0 ? VOX.cobbleDark : VOX.cobble);
        } else if (onPath) {
          terrain.add(i, -0.5, j, VOX.path);
        } else {
          terrain.add(i, -0.5, j, (i * 7 + j * 13) % 5 === 0 ? VOX.grassDark : VOX.grass);
          // night litter: dead leaves blown across the grass
          if (Math.random() < 0.04) {
            props.add(i + (Math.random() - 0.5) * 0.4, 0.15, j + (Math.random() - 0.5) * 0.4,
              Math.random() < 0.5 ? VOX.leafDark : VOX.dirt, 0.32, 0.3, 0.32, 0, Math.random() * Math.PI, 0);
          }
        }
      }
    }

    // Flat slab underside (dirt over stone), with a slightly inset bottom rim.
    for (let d = 1; d <= 4; d++) {
      const color = d <= 2 ? (d === 1 ? VOX.dirt : VOX.dirtDark) : d === 3 ? VOX.stone : VOX.stoneDark;
      for (let i = -H; i <= H; i++) {
        for (let j = -H; j <= H; j++) {
          if (!this.inArena(i, j)) continue;
          if (d === 4 && Math.max(Math.abs(i), Math.abs(j)) >= H - 1) continue; // inset rim
          terrain.add(i, -0.5 - d, j, color);
        }
      }
    }
  }

  // ---- camper van (clearing centerpiece) ----
  /** A scaled, beveled emissive voxel box added to the scene (fire, signs). */
  private glowBox(w: number, h: number, d: number, x: number, y: number, z: number, color: number, intensity = 0.9) {
    const m = new THREE.Mesh(this.geo, glowMaterial(color, intensity));
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  /** Place a box in a yaw-rotated local frame: world = Ry(yaw) · local. The
   *  optional `tilt` is a rotation about the local Z axis (applied BEFORE the
   *  yaw — Euler XYZ composes Ry·Rz), so slopes/leans follow the yaw frame. */
  private rp(
    b: VoxelBatch, cx: number, cz: number, yaw: number, lx: number, y: number, lz: number,
    color: number, sx: number, sy: number, sz: number, tilt = 0,
  ) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    b.add(cx + lx * c + lz * s, y, cz - lx * s + lz * c, color, sx, sy, sz, 0, yaw, tilt);
  }

  /**
   * The camper van as a genuinely high-density voxel model. The trick that makes
   * dense voxels look *premium* instead of a quilt: voxels are placed on a fine
   * grid but scaled to slightly **overlap** (so surfaces read solid — no
   * see-through gaps), with small even bevels; ambient occlusion then settles
   * into the grooves. Baked into instanced batches (a few draw calls).
   */
  private buildRV() {
    const solid = new VoxelBatch();
    const glow = new VoxelBatch();
    const geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
    const s = 0.34;        // grid spacing — fine enough to read as detailed
    const v = s * 1.16;    // voxel size > spacing => overlap => no holes
    const eps = s * 0.25;

    const region = (
      x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
      colorFn: (x: number, y: number, z: number) => number | null, shell = true,
    ) => {
      for (let x = x0 + s / 2; x < x1 - eps; x += s)
        for (let y = y0 + s / 2; y < y1 - eps; y += s)
          for (let z = z0 + s / 2; z < z1 - eps; z += s) {
            if (shell && x > x0 + s && x < x1 - s && y > y0 + s && y < y1 - s && z > z0 + s && z < z1 - s) continue;
            const col = colorFn(x, y, z);
            if (col !== null) solid.add(x, y, z, col, v, v, v);
          }
    };
    const fill = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number) =>
      region(x0, x1, y0, y1, z0, z1, () => color, false);
    const win = (x0: number, x1: number, y0: number, y1: number, z: number, color: number) => {
      for (let x = x0 + s / 2; x < x1 - eps; x += s)
        for (let y = y0 + s / 2; y < y1 - eps; y += s) glow.add(x, y, z, color, v, v, s * 0.7);
    };
    // body: white shell with a blue stripe band wrapping the walls
    const body = (_x: number, y: number) => (y > 1.5 && y < 1.95 ? VOX.rvStripe : VOX.rvBody);

    // shells: rear living box, lower cab, cab-over bunk
    region(-1.7, 3.3, 1.2, 3.3, -1.4, 1.4, body);
    region(-3.85, -1.7, 1.0, 2.45, -1.3, 1.3, body);
    region(-3.85, -1.7, 2.45, 3.3, -1.4, 1.4, () => VOX.rvBody);
    // chassis skirt + lighter two-tone roof caps
    fill(-3.7, 3.5, 0.82, 1.18, -1.25, 1.25, VOX.rvTrim);
    fill(-1.7, 3.3, 3.3, 3.6, -1.45, 1.45, VOX.rvBodyShade);
    fill(-3.85, -1.7, 3.3, 3.6, -1.42, 1.42, VOX.rvBodyShade);
    // windows (warm survivor-glow = the only lit shelter for miles), door, windshield
    win(-0.65, 0.65, 2.2, 2.95, 1.42, VOX.windowGlow);
    win(1.35, 2.65, 2.2, 2.95, 1.42, VOX.windowGlow);
    win(-3.5, -2.1, 1.55, 2.25, 1.32, VOX.rvWindow);   // cab side glass
    for (let z = -1.0; z <= 1.0; z += s) glow.add(-3.88, 1.95, z, VOX.rvWindow, 0.12, 0.7, v);
    fill(-1.5, -0.7, 1.2, 2.45, 1.38, 1.5, VOX.rvDoor);
    win(-1.4, -0.8, 2.45, 2.85, 1.5, VOX.windowGlow);  // door porthole
    // wheels: fat tire blocks, steel hubs, dark arches
    for (const wx of [-2.4, 2.6]) for (const wz of [-1.12, 1.12]) {
      fill(wx - 0.5, wx + 0.5, 0.2, 1.0, wz - 0.36, wz + 0.36, VOX.tire);
      solid.add(wx, 0.55, wz, VOX.rim, 0.42, 0.42, 0.8);
      fill(wx - 0.66, wx + 0.66, 1.0, 1.22, wz - 0.42, wz + 0.42, VOX.rvTrim);
    }
    // bumpers, grille, head/taillights
    fill(-4.05, -3.8, 1.05, 1.45, -1.2, 1.2, VOX.rvTrim);
    fill(3.35, 3.6, 1.05, 1.45, -1.2, 1.2, VOX.rvTrim);
    fill(-3.9, -3.78, 1.2, 1.55, -0.7, 0.7, VOX.steelDark);
    for (const hz of [-0.85, 0.85]) glow.add(-3.9, 1.45, hz, VOX.windowGlow, 0.14, 0.32, 0.36);
    for (const tz of [-1.05, 1.05]) glow.add(3.42, 1.7, tz, VOX.toolbox, 0.14, 0.36, 0.36);
    // wing mirrors
    for (const mz of [-1.5, 1.5]) {
      solid.add(-3.45, 2.05, mz, VOX.steelDark, 0.34, 0.12, 0.12);
      solid.add(-3.62, 1.95, mz, VOX.steelDark, 0.16, 0.34, 0.18);
    }
    // back ladder, roof rails, AC unit, deck chair
    for (const lz of [-0.7, 0.7]) for (let y = 1.4; y < 3.25; y += s) solid.add(3.45, y, lz, VOX.steelDark, 0.14, v, 0.14);
    for (let r = 0; r < 4; r++) solid.add(3.45, 1.65 + r * 0.45, 0, VOX.steelDark, 0.14, 0.12, 1.4);
    for (const rz of [-1.08, 1.08]) for (let x = -1.5; x < 3.2; x += s) solid.add(x, 3.6, rz, VOX.steelDark, v, 0.12, 0.14);
    fill(-0.9, 0.1, 3.6, 3.95, -0.25, 0.75, VOX.rvTrim);
    fill(1.2, 2.0, 3.6, 3.72, -0.7, 0.1, VOX.woodTrim);
    fill(1.9, 2.05, 3.72, 4.25, -0.7, 0.1, VOX.woodTrim);

    solid.build(this.group, geo, true, true);
    // Window glow reads warmer + stronger at night — the heart of the camp.
    glow.build(this.group, geo, false, false, (col) => glowMaterial(col, 0.55));

    // central obstacle so the horde funnels around the van
    this.obstacles.push({ minX: -4.1, maxX: 3.8, minZ: -1.6, maxZ: 1.6 });
  }

  // ---- survival camp dressing ----
  private buildCamp(props: VoxelBatch, glow: VoxelBatch) {
    // Claim the interactable pads first so scatters keep their aprons clear.
    const H = this.half;
    const pads: [number, number, number][] = [
      [0, -H + 1.5, 1.7], [H - 6, H - 6, 2.0], [-H + 6, H - 6, 2.0], [5, 9, 1.5],
      [-H + 6, -H + 6, 2.0], [H - 6, -H + 6, 2.0], [-H + 3, 0, 1.7], [H - 3, 0, 1.7],
      [0, H - 7, 2.2], [0, -H + 8, 2.2],
    ];
    for (const [x, z, r] of pads) this.claim(x, z, r);

    this.buildFences(props);
    this.buildCovers(props, glow);
    this.buildTents(props);
    this.buildRoads(props);
    this.buildSandbagArcs(props);
    this.buildLanterns(props);
    this.buildDeadTrees(props);
    this.buildBrambles(props);
    this.buildGlowShrooms(props, glow);
    this.buildEdgeSigns(props, glow);
    this.buildClutter(props);
    this.buildFoliage(props);
    this.buildCampfire(props, 4.5, 4.5);
    this.buildEmbers(4.5, 4.5);
  }

  private claim(x: number, z: number, r: number) {
    this.deco.push({ x, z, r });
  }

  private nearDeco(x: number, z: number, pad = 0): boolean {
    for (const d of this.deco) {
      const dx = x - d.x, dz = z - d.z;
      const rr = d.r + pad;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  /**
   * The camp's perimeter fence — but BROKEN now: leaning and snapped posts,
   * missing rails, planks knocked flat in the grass. Same ring + same gate
   * openings at the paths (purely decorative, exactly as before).
   */
  private buildFences(props: VoxelBatch) {
    const lim = this.half - 2;
    // axis: 0 = fence runs along X (north/south edges), 1 = along Z.
    const post = (x: number, z: number, axis: 0 | 1) => {
      const r = Math.random();
      if (r < 0.12) {
        // snapped stub + the broken top lying beside it
        props.add(x, 0.3, z, VOX.fence, 0.24, 0.62, 0.24, 0, 0, 0.12);
        props.add(x + (axis ? 0.1 : 0.55), 0.14, z + (axis ? 0.55 : 0.1), VOX.fence,
          axis ? 0.2 : 0.7, 0.18, axis ? 0.7 : 0.2, axis ? 0.25 : 0, Math.random() * 0.6, axis ? 0 : 0.25);
      } else if (r < 0.34) {
        // leaning post
        const lean = (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.14);
        props.add(x, 0.53, z, VOX.fence, 0.24, 1.15, 0.24, axis ? lean : 0, 0, axis ? 0 : lean);
      } else {
        props.add(x, 0.55, z, VOX.fence, 0.24, 1.15, 0.24);
      }
    };
    const rails = (x: number, z: number, axis: 0 | 1) => {
      const q = Math.random();
      const railAt = (y: number) =>
        props.add(x, y, z, VOX.woodTrim, axis ? 0.14 : 2.0, 0.14, axis ? 2.0 : 0.14);
      if (q < 0.52) {
        railAt(0.5); railAt(0.86); // intact pair
      } else if (q < 0.78) {
        railAt(Math.random() < 0.5 ? 0.5 : 0.86); // one rail gone
      } else if (q < 0.94) {
        // one rail hanging — snapped off a post, one end in the dirt
        railAt(0.86);
        const tip = (Math.random() < 0.5 ? -1 : 1) * 0.35;
        props.add(x, 0.34, z, VOX.woodTrim, axis ? 0.14 : 1.9, 0.14, axis ? 1.9 : 0.14, axis ? tip : 0, 0, axis ? 0 : tip);
      } else {
        // both gone — a plank rotting flat in the grass
        props.add(x + 0.2, 0.1, z + 0.15, VOX.woodTrim, axis ? 0.16 : 1.7, 0.12, axis ? 1.7 : 0.16, 0, Math.random() * 0.5 - 0.25, 0);
      }
    };
    for (let p = -lim; p <= lim; p += 2) {
      if (Math.abs(p) > 1) {
        // posts (leave the path crossings open as gates)
        if (this.inArena(p, -lim)) post(p, -lim, 0);
        if (this.inArena(p, lim)) post(p, lim, 0);
        if (this.inArena(-lim, p)) post(-lim, p, 1);
        if (this.inArena(lim, p)) post(lim, p, 1);
      }
      const mid = p + 1;
      if (p < lim && Math.abs(mid) > 1) {
        if (this.inArena(mid, -lim)) rails(mid, -lim, 0);
        if (this.inArena(mid, lim)) rails(mid, lim, 0);
        if (this.inArena(-lim, mid)) rails(-lim, mid, 1);
        if (this.inArena(lim, mid)) rails(lim, mid, 1);
      }
    }
  }

  /**
   * Fixed cover clusters that block the horde. SAME footprints + obstacle
   * pushes as ever — but two spots are re-dressed into set pieces: the NW
   * crates are now the legs of an abandoned WATCHTOWER, and the NE barrels
   * are a CRASHED SUPPLY TRUCK with its cargo spilled. Collision identical.
   */
  private buildCovers(props: VoxelBatch, glow: VoxelBatch) {
    const spots: [number, number, "crates" | "barrels" | "sandbags"][] = [
      [-10, -9, "crates"], [10, -8, "barrels"], [-9, 10, "sandbags"], [10, 10, "crates"],
      [-13, 2, "barrels"], [13, 1, "sandbags"], [2, 13, "crates"], [1, -13, "barrels"],
    ];
    for (const [x, z, kind] of spots) {
      if (kind === "crates") {
        if (x === -10 && z === -9) this.propWatchtower(props, glow); // re-dressed visuals
        else {
          this.propCrate(props, x, z, true);
          this.propCrate(props, x + 1.1, z + 0.3, false);
        }
        this.obstacles.push({ minX: x - 0.6, maxX: x + 1.7, minZ: z - 0.6, maxZ: z + 0.9 });
      } else if (kind === "barrels") {
        if (x === 10 && z === -8) this.propCrashedTruck(props); // re-dressed visuals
        else {
          this.propBarrel(props, x, z, VOX.barrel);
          this.propBarrel(props, x + 0.9, z + 0.2, VOX.barrelRust);
          this.propBarrel(props, x + 0.4, z - 0.9, VOX.barrel);
        }
        this.obstacles.push({ minX: x - 0.6, maxX: x + 1.5, minZ: z - 1.5, maxZ: z + 0.8 });
      } else {
        this.propSandbags(props, x, z);
        this.obstacles.push({ minX: x - 1.5, maxX: x + 1.5, minZ: z - 0.6, maxZ: z + 0.6 });
      }
      this.propRocks(props, x - 1.0, z + 1.0);
    }
  }

  /**
   * The abandoned watchtower, built on the original NW crates footprint
   * (legs sit strictly inside it, so the collision story matches the eye).
   * Broken railing, half-collapsed tattered roof, a cold dead lamp — nobody's
   * been on watch for a while.
   */
  private propWatchtower(props: VoxelBatch, glow: VoxelBatch) {
    const cx = -9.45, cz = -8.85;
    // legs (inside the crate-spot obstacle: x -10.6..-8.3, z -9.6..-8.1)
    for (const lx of [-0.95, 0.95]) for (const lz of [-0.58, 0.58])
      props.add(cx + lx, 1.62, cz + lz, VOX.fence, 0.2, 3.3, 0.2);
    // cross braces (X) on the long faces
    for (const lz of [-0.58, 0.58]) {
      props.add(cx, 1.2, cz + lz, VOX.woodTrim, 2.05, 0.1, 0.12, 0, 0, 0.55);
      props.add(cx, 1.2, cz + lz, VOX.woodTrim, 2.05, 0.1, 0.12, 0, 0, -0.55);
    }
    for (const lx of [-0.95, 0.95]) {
      props.add(cx + lx, 2.2, cz, VOX.woodTrim, 0.12, 0.1, 1.3, 0.6, 0, 0);
      props.add(cx + lx, 2.2, cz, VOX.woodTrim, 0.12, 0.1, 1.3, -0.6, 0, 0);
    }
    // platform (overhead — players walk beneath the slight overhang)
    props.add(cx, 3.32, cz, VOX.crateDark, 2.3, 0.16, 1.8);
    props.add(cx, 3.45, cz, VOX.crate, 2.1, 0.12, 1.6);
    // railing: posts at the corners, rails mostly gone, one dangling
    for (const lx of [-1.0, 1.0]) for (const lz of [-0.75, 0.75])
      props.add(cx + lx, 3.78, cz + lz, VOX.fence, 0.12, 0.55, 0.12);
    props.add(cx, 3.98, cz - 0.75, VOX.woodTrim, 2.0, 0.1, 0.1);            // back rail intact
    props.add(cx - 1.0, 3.98, cz, VOX.woodTrim, 0.1, 0.1, 1.5);             // left rail intact
    props.add(cx + 0.55, 3.6, cz + 0.78, VOX.woodTrim, 1.1, 0.1, 0.1, 0, 0, 0.5); // front rail dangling
    // tattered lean-to roof: one intact slope, one snapped panel
    for (const lx of [-0.7, 0.7]) props.add(cx + lx, 4.5, cz - 0.6, VOX.fence, 0.12, 1.0, 0.12);
    props.add(cx, 4.95, cz - 0.1, NITE.canvasDark, 2.2, 0.09, 1.5, -0.45, 0, 0);
    props.add(cx + 0.7, 4.45, cz + 0.75, NITE.canvas, 0.9, 0.08, 0.8, -1.1, 0.3, 0);
    // ladder up the east face
    for (const lz of [-0.3, 0.3]) props.add(cx + 1.12, 1.7, cz + lz, VOX.fence, 0.1, 3.4, 0.1);
    for (let y = 0.5; y < 3.2; y += 0.45) props.add(cx + 1.12, y, cz, VOX.woodTrim, 0.09, 0.09, 0.7);
    // a dead signal lamp + one supply crate tucked between the legs
    props.add(cx - 0.8, 4.0, cz + 0.6, VOX.steelDark, 0.18, 0.3, 0.18);
    glow.add(cx - 0.8, 4.12, cz + 0.6, VOX.toolbox, 0.12, 0.12, 0.12); // faint warning red
    this.crateBody(props, cx - 0.2, 0.45, cz + 0.1, 0.9);
    this.propSack(props, cx + 0.7, cz - 0.4);
    // a crow keeps watch instead
    this.addCrow(cx - 1.0, 4.1, cz - 0.75, 0.8);
  }

  /**
   * The crashed supply truck — jack-knifed across the old NE barrel spot
   * (same obstacle push), nose down, one wheel thrown, cargo doors burst and
   * the camp's barrels + crates spilled out the back. A flickering headlight
   * still has some battery left.
   */
  private propCrashedTruck(props: VoxelBatch) {
    const cx = 10.45, cz = -8.35, yaw = 0.83, pitch = -0.07;
    // chassis + cab + cargo box (slight nose-down pitch = crashed stance)
    this.rp(props, cx, cz, yaw, 0, 0.5, 0, VOX.rvTrim, 3.2, 0.24, 1.3, pitch);
    this.rp(props, cx, cz, yaw, 1.15, 1.0, 0, VOX.propane, 0.95, 1.0, 1.45, pitch);   // faded blue cab
    this.rp(props, cx, cz, yaw, 1.66, 0.78, 0, VOX.steelDark, 0.3, 0.5, 1.3, pitch);  // crumpled grille
    this.rp(props, cx, cz, yaw, 1.42, 1.28, 0, 0x1a2026, 0.18, 0.5, 1.2, pitch);      // dark windshield
    this.rp(props, cx, cz, yaw, -0.55, 1.28, 0, VOX.rvBodyShade, 2.05, 1.5, 1.55, pitch); // cargo box
    this.rp(props, cx, cz, yaw, -0.55, 1.32, 0, VOX.rvStripe, 2.07, 0.34, 1.59, pitch);   // freight stripe
    this.rp(props, cx, cz, yaw, -0.55, 2.1, 0, VOX.rvBody, 2.0, 0.14, 1.5, pitch);        // roof cap
    // wheels: three still on, the front-left torn off (axle stub)
    this.rp(props, cx, cz, yaw, 1.05, 0.42, 0.72, VOX.tire, 0.56, 0.56, 0.3);
    this.rp(props, cx, cz, yaw, -1.05, 0.46, 0.72, VOX.tire, 0.56, 0.56, 0.3);
    this.rp(props, cx, cz, yaw, -1.05, 0.46, -0.72, VOX.tire, 0.56, 0.56, 0.3);
    this.rp(props, cx, cz, yaw, 1.05, 0.42, -0.66, VOX.steelDark, 0.3, 0.18, 0.2);
    // the thrown wheel, rolled clear of the wreck
    props.add(12.4, 0.16, -6.4, VOX.tire, 0.8, 0.3, 0.8, 0, 0.5, 0);
    props.add(12.4, 0.16, -6.4, VOX.steelDark, 0.3, 0.32, 0.3, 0, 0.5, 0);
    // burst rear doors: one flat in the mud, one hanging open
    this.rp(props, cx, cz, yaw, -2.1, 0.07, 0.3, VOX.rvBodyShade, 1.1, 0.08, 1.0, 0.04);
    this.rp(props, cx, cz, yaw, -1.62, 1.1, -0.85, VOX.rvBodyShade, 0.08, 1.4, 0.75, 0.18);
    // spilled cargo behind the truck (decorative, walkable)
    this.propBarrel(props, 8.9, -6.9, VOX.barrel);
    this.lyingBarrel(props, 8.1, -7.6, VOX.barrelRust, 1.1);
    this.crateBody(props, 9.2, 0.32, -10.15, 0.7);
    this.crateBody(props, 8.55, 0.3, -9.7, 0.62);
    this.propSack(props, 9.9, -10.4);
    // scorched skid under the wreck + a flickering headlight that won't die
    this.rp(props, cx, cz, yaw, -0.2, 0.04, 0.1, NITE.ash, 3.6, 0.1, 1.7);
    this.rp(props, cx, cz, yaw, 1.0, 0.03, 1.3, NITE.ash, 1.6, 0.09, 0.5, 0);
    const head = this.glowBox(0.16, 0.2, 0.26, cx + 1.78 * Math.cos(yaw) - 0.45 * Math.sin(yaw) * -1, 0.85,
      cz - 1.78 * Math.sin(yaw) + 0.45 * Math.cos(yaw) * -1, VOX.windowGlow, 1.0);
    this.flickers.push({ mat: head.material as THREE.MeshStandardMaterial, base: 1.0, speed: 11, phase: 1.7 });
    this.claim(9.0, -10.0, 1.2);
    this.claim(12.4, -6.4, 0.9);
  }

  /** A barrel lying on its side (simple banded boxes — cheap, reads instantly). */
  private lyingBarrel(props: VoxelBatch, x: number, z: number, color: number, yaw: number) {
    this.rp(props, x, z, yaw, 0, 0.3, 0, color, 1.05, 0.58, 0.58);
    for (const lx of [-0.34, 0.02, 0.36]) this.rp(props, x, z, yaw, lx, 0.3, 0, VOX.steelDark, 0.1, 0.62, 0.62);
  }

  /** Ruined tents — the camp the horde already went through. */
  private buildTents(props: VoxelBatch) {
    this.buildTent(props, -8.5, -13.5, 0.5, NITE.canvas, NITE.canvasDark, 1);
    this.buildTent(props, 12.5, 6.5, -1.0, NITE.canvasRed, 0x6e3527, 0);
    this.buildTent(props, -13.5, 7.5, 2.2, NITE.canvasGreen, 0x4e574a, 1);
    this.buildCollapsedTent(props, 7.0, -13.5, 2.6);
  }

  /**
   * An A-frame tent (ridge along local Z) built from canvas plank strips so
   * we can tear holes in it: missing strips, sagging panels, a snapped pole.
   * `ruin` 1 = the rear half has caved in.
   */
  private buildTent(props: VoxelBatch, x: number, z: number, yaw: number, canvas: number, dark: number, ruin: 0 | 1) {
    this.claim(x, z, 2.0);
    // trampled dark groundsheet
    this.rp(props, x, z, yaw, 0, 0.03, 0, NITE.ash, 1.9, 0.1, 2.3);
    // ridge beam + crossed front poles
    this.rp(props, x, z, yaw, 0, 1.34, 0.1, VOX.fence, 0.13, 0.13, 2.5);
    this.rp(props, x, z, yaw, 0.2, 0.7, 1.25, VOX.fence, 0.09, 1.5, 0.09, 0.32);
    this.rp(props, x, z, yaw, -0.2, 0.7, 1.25, VOX.fence, 0.09, 1.5, 0.09, -0.32);
    // canvas strips per side; tear a few out, sag the ruined rear
    for (const side of [-1, 1]) {
      for (let k = -1; k <= 1; k++) {
        const rear = k === -1;
        if (Math.random() < 0.18 && !(rear && ruin)) continue; // torn-out strip
        const sag = rear && ruin ? 1 : 0;
        const col = (k + side) % 2 === 0 ? canvas : dark;
        this.rp(props, x, z, yaw,
          side * (0.55 + sag * 0.3), 0.78 - sag * 0.42, k * 0.74,
          col, 1.35, 0.08, 0.76, -side * (1.0 + sag * 0.35));
      }
    }
    // torn flap lying at the mouth + abandoned bedroll inside
    this.rp(props, x, z, yaw, 0.5, 0.06, 1.55, dark, 0.6, 0.07, 0.7, 0.05);
    this.rp(props, x, z, yaw, -0.25, 0.14, -0.2, ruin ? VOX.toolbox : VOX.propane, 0.45, 0.17, 1.1);
    // a dropped supply crate by the entrance
    this.crateBody(props, x + Math.sin(yaw) * 1.7, 0.28, z + Math.cos(yaw) * 1.7, 0.58);
  }

  /** A fully collapsed pup tent — canvas heap over a snapped ridge pole. */
  private buildCollapsedTent(props: VoxelBatch, x: number, z: number, yaw: number) {
    this.claim(x, z, 1.4);
    this.rp(props, x, z, yaw, 0, 0.03, 0, NITE.ash, 1.5, 0.09, 1.9);
    this.rp(props, x, z, yaw, 0, 0.22, 0.5, NITE.canvas, 1.5, 0.12, 1.0, 0.1);
    this.rp(props, x, z, yaw, 0.15, 0.34, -0.35, NITE.canvasDark, 1.3, 0.12, 1.0, -0.14);
    this.rp(props, x, z, yaw, -0.3, 0.5, 0.05, NITE.canvas, 0.9, 0.12, 0.8, 0.3);
    // snapped ridge pole poking out of the heap
    this.rp(props, x, z, yaw, 0.1, 0.62, 0.85, VOX.fence, 0.09, 1.1, 0.09, 0.9);
    this.propSack(props, x - 1.0, z + 0.8);
  }

  /** Cracked fragments of the old asphalt road the dirt paths grew over. */
  private buildRoads(props: VoxelBatch) {
    const slabs: [number, number, number, number, number][] = [
      // x, z, w, d, yaw — along the four path arms, clear of trap/gate pads
      [9.6, 0.25, 2.2, 1.5, 0.12], [12.4, -0.35, 1.7, 1.3, -0.2], [14.8, 0.3, 1.9, 1.4, 0.08],
      [-9.7, -0.3, 2.0, 1.4, -0.1], [-12.6, 0.35, 1.6, 1.2, 0.22], [-15.3, -0.2, 1.8, 1.3, -0.06],
      [0.3, 9.6, 1.5, 2.1, 0.15], [-0.35, 10.9, 1.2, 1.4, -0.18], [0.25, 15.7, 1.4, 1.9, 0.1],
      [-0.3, -9.8, 1.4, 1.9, -0.12], [0.35, -15.1, 1.5, 2.0, 0.2],
    ];
    let n = 0;
    for (const [x, z, w, d, yaw] of slabs) {
      const col = n % 2 === 0 ? NITE.asphalt : NITE.asphaltDark;
      props.add(x, 0.035, z, col, w, 0.13, d, 0, yaw, 0);
      // cracks: thin dark seams sitting just proud of the slab (no coplanar faces)
      const cracks = 1 + (n % 2);
      for (let c = 0; c <= cracks; c++) {
        const along = d > w; // crack runs roughly across the long axis
        props.add(
          x + (Math.random() - 0.5) * w * 0.5, 0.095, z + (Math.random() - 0.5) * d * 0.5,
          NITE.crack, along ? w * 0.55 : 0.07, 0.05, along ? 0.07 : d * 0.55,
          0, yaw + (Math.random() - 0.5) * 0.7, 0,
        );
      }
      // the odd faded lane-paint dash
      if (n % 3 === 0) props.add(x, 0.1, z, NITE.paintLine, d > w ? 0.14 : 0.7, 0.045, d > w ? 0.7 : 0.14, 0, yaw, 0);
      n++;
    }
  }

  /** Defensive sandbag arcs ringing the camp pad — last-stand earthworks just
   *  outside the plaza clearing (low, decorative, stepped-over freely). */
  private buildSandbagArcs(props: VoxelBatch) {
    for (const [cx, cz] of [[-6.6, 6.6], [6.6, -6.6], [-6.6, -6.6]] as [number, number][]) {
      const out = Math.atan2(cz, cx); // arc faces outward, away from the van
      for (let k = -2; k <= 2; k++) {
        const a = out + k * 0.3;
        const x = cx + Math.cos(a) * 2.1;
        const z = cz + Math.sin(a) * 2.1;
        const yaw = -a + Math.PI / 2; // bags lie tangent to the arc
        props.add(x, 0.2, z, k % 2 ? VOX.sandbag : VOX.sandbagDark, 0.95, 0.42, 0.6, 0, yaw, 0);
        if (Math.abs(k) < 2) {
          const a2 = a + 0.15;
          props.add(cx + Math.cos(a2) * 2.08, 0.56, cz + Math.sin(a2) * 2.08,
            k % 2 ? VOX.sandbagDark : VOX.sandbag, 0.9, 0.4, 0.58, 0, -a2 + Math.PI / 2, 0);
        }
        this.claim(x, z, 0.7);
      }
      // dropped helmet / spent supplies behind the line
      this.propSack(props, cx * 0.82, cz * 0.82);
    }
  }

  /** Two camp lanterns on posts — warm pools of firelight against the blue. */
  private buildLanterns(props: VoxelBatch) {
    for (const [x, z] of [[7.4, -6.2], [-7.0, 6.6]] as [number, number][]) {
      this.claim(x, z, 0.8);
      props.add(x, 0.85, z, VOX.fence, 0.16, 1.7, 0.16, 0, 0, 0.06);
      props.add(x + 0.22, 1.72, z, VOX.fence, 0.55, 0.1, 0.1);
      props.add(x + 0.45, 1.6, z, VOX.steelDark, 0.07, 0.18, 0.07);
      const pane = this.glowBox(0.26, 0.3, 0.26, x + 0.45, 1.4, z, VOX.lantern, 1.2);
      props.add(x + 0.45, 1.58, z, VOX.steelDark, 0.32, 0.07, 0.32);
      // The emissive lantern pane always flickers (self-lit, cheap). The real
      // PointLight is decorative and skipped on mobile (LOW_TIER).
      this.flickers.push({ mat: pane.material as THREE.MeshStandardMaterial, base: 1.2, speed: 7, phase: x });
      if (!LOW_TIER) {
        const light = new THREE.PointLight(0xffa258, 2.4, 7.5, 2);
        light.position.set(x + 0.45, 1.5, z);
        this.group.add(light);
        this.flickers.push({ light, base: 2.4, speed: 9, phase: z });
      }
    }
  }

  /** Dead trees — gnarled black silhouettes with crows hunched on the snags. */
  private buildDeadTrees(props: VoxelBatch) {
    const trees: [number, number, number, number, boolean][] = [
      // x, z, height, yaw, hasCrow
      [-16, -10, 3.6, 0.7, true],
      [16, 9, 4.0, 2.1, true],
      [-7, 16, 3.2, 4.0, false],
      [9.5, -16.5, 3.4, 5.2, true],
      [4.2, 16.5, 2.7, 1.2, false],
    ];
    for (const [x, z, h, yaw, crow] of trees) {
      this.claim(x, z, 1.6);
      // tapered, slightly crooked trunk
      const steps = Math.ceil(h / 0.55);
      for (let i = 0; i < steps; i++) {
        const yy = 0.35 + i * 0.55;
        const w = 0.46 - (i / steps) * 0.26;
        props.add(x + Math.sin(i * 1.7 + yaw) * 0.07, yy, z + Math.cos(i * 2.1) * 0.06,
          i % 2 ? NITE.deadBark : NITE.deadBarkDark, w, 0.6, w, 0, yaw + i * 0.2, (i / steps) * 0.14);
      }
      // bare branches clawing out at angles
      const branches = 3 + ((x + z) & 1);
      for (let b = 0; b < branches; b++) {
        const ba = yaw + b * (Math.PI * 2 / branches) + 0.4;
        const by = h * (0.55 + 0.13 * b);
        const len = 1.0 + (b % 2) * 0.45;
        this.rp(props, x, z, ba, len * 0.45, by, 0, NITE.deadBark, len, 0.11, 0.11, 0.45 + (b % 2) * 0.2);
        // twig at the tip
        this.rp(props, x, z, ba, len * 0.95, by + len * 0.42, 0, NITE.deadBarkDark, 0.45, 0.08, 0.08, 0.9);
      }
      // exposed roots
      for (let r = 0; r < 3; r++) {
        const ra = yaw + r * 2.1;
        props.add(x + Math.cos(ra) * 0.4, 0.12, z + Math.sin(ra) * 0.4, NITE.deadBarkDark, 0.5, 0.2, 0.18, 0, ra, 0.1);
      }
      if (crow) this.addCrow(x + Math.cos(yaw + 0.4) * 0.15, h + 0.28, z + Math.sin(yaw + 0.4) * 0.15, yaw + 1.2);
    }
  }

  /** A perched crow: black voxel bird whose wings flap in occasional bursts. */
  private addCrow(x: number, y: number, z: number, yaw: number) {
    const black = voxelMaterial(NITE.crow);
    const beakMat = voxelMaterial(NITE.crowBeak);
    const grp = new THREE.Group();
    const box = (mat: THREE.Material, sx: number, sy: number, sz: number, px: number, py: number, pz: number, parent: THREE.Object3D = grp) => {
      const m = new THREE.Mesh(this.geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(px, py, pz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    box(black, 0.34, 0.26, 0.22, 0, 0, 0);          // body
    box(black, 0.18, 0.18, 0.16, 0.2, 0.13, 0);     // head
    box(beakMat, 0.1, 0.06, 0.06, 0.33, 0.12, 0);   // beak
    box(black, 0.2, 0.06, 0.12, -0.24, 0.04, 0);    // tail
    const pivL = new THREE.Group(); pivL.position.set(0, 0.1, -0.1);
    const pivR = new THREE.Group(); pivR.position.set(0, 0.1, 0.1);
    box(black, 0.2, 0.04, 0.26, 0, 0, -0.13, pivL); // wings hinge at the shoulder
    box(black, 0.2, 0.04, 0.26, 0, 0, 0.13, pivR);
    grp.add(pivL, pivR);
    grp.position.set(x, y, z);
    grp.rotation.y = yaw;
    this.group.add(grp);
    this.crows.push({ pivL, pivR, body: grp, baseY: y, next: 2 + Math.random() * 6, until: 0, phase: Math.random() * 10 });
  }

  /** Bramble tangles creeping in from the boundary — the wild reclaiming camp. */
  private buildBrambles(props: VoxelBatch) {
    let placed = 0, attempts = 0;
    while (placed < 11 && attempts++ < 250) {
      const a = Math.random() * Math.PI * 2;
      const r = 14.2 + Math.random() * 2.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!this.inArena(Math.round(x), Math.round(z))) continue;
      if (Math.abs(x) <= 1.6 || Math.abs(z) <= 1.6) continue; // keep paths clear
      if (this.insideObstacle(x, z, 0.8) || this.nearDeco(x, z, 0.9)) continue;
      const sticks = 5 + Math.floor(Math.random() * 4);
      for (let s = 0; s < sticks; s++) {
        const len = 0.7 + Math.random() * 0.6;
        props.add(
          x + (Math.random() - 0.5) * 0.9, 0.16 + Math.random() * 0.22, z + (Math.random() - 0.5) * 0.9,
          Math.random() < 0.4 ? NITE.deadBarkDark : NITE.bramble, len, 0.07, 0.07,
          0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.9,
        );
      }
      for (let th = 0; th < 4; th++)
        props.add(x + (Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.25, z + (Math.random() - 0.5) * 0.8,
          NITE.deadBarkDark, 0.06, 0.12, 0.06, 0, 0, Math.random() - 0.5);
      this.claim(x, z, 0.8);
      placed++;
    }
  }

  /** Glowing mushroom clusters in the dark corners — eerie teal accent light. */
  private buildGlowShrooms(props: VoxelBatch, glow: VoxelBatch) {
    const clusters: [number, number, boolean][] = [
      // x, z, hasLight — two corners get a real point light, the rest just glow
      [16.6, 16.1, true], [-16.2, -16.4, true], [-16.4, 16.5, false], [16.3, -16.5, false],
      [-16.6, -3.6, false], [16.5, 4.2, false],
    ];
    for (const [x, z, lit] of clusters) {
      if (!this.inArena(Math.round(x), Math.round(z))) continue;
      this.claim(x, z, 1.0);
      const n = 4 + Math.floor(Math.random() * 3);
      for (let m = 0; m < n; m++) {
        const mx = x + (Math.random() - 0.5) * 1.3;
        const mz = z + (Math.random() - 0.5) * 1.3;
        const h = 0.2 + Math.random() * 0.3;
        const cap = Math.random() < 0.65 ? NITE.shroomTeal : NITE.shroomBlue;
        props.add(mx, h / 2 + 0.04, mz, NITE.shroomStem, 0.1, h, 0.1);
        glow.add(mx, h + 0.1, mz, cap, 0.2 + Math.random() * 0.12, 0.13, 0.2 + Math.random() * 0.12);
      }
      // mossy stones the shrooms feed on
      props.add(x + 0.5, 0.14, z - 0.3, VOX.rockDark, 0.4, 0.24, 0.4, 0, Math.random(), 0);
      // The shroom caps are emissive glow meshes (added above), so the cluster
      // still reads as eerie teal without a real light. The decorative
      // PointLight is skipped on mobile (LOW_TIER).
      if (lit && !LOW_TIER) {
        const l = new THREE.PointLight(0x59e0c0, 1.5, 6, 2);
        l.position.set(x, 0.8, z);
        this.group.add(l);
      }
    }
  }

  /** Hazard signs at the gates + leaning extras: the playfield edge reads. */
  private buildEdgeSigns(props: VoxelBatch, glow: VoxelBatch) {
    const signs: [number, number, number, boolean][] = [
      // x, z, yaw (board faces the path), lamp on top?
      [2.4, 17.5, Math.PI, true], [-2.4, -17.4, 0, true],
      [17.5, -2.4, Math.PI / 2, false], [-17.5, 2.4, -Math.PI / 2, true],
      [10.5, 17.2, Math.PI + 0.35, false], [-17.2, -10.5, -Math.PI / 2 - 0.3, false],
    ];
    for (const [x, z, yaw, lamp] of signs) {
      if (!this.inArena(Math.round(x), Math.round(z))) continue;
      this.claim(x, z, 0.9);
      const lean = (Math.random() - 0.5) * 0.16;
      props.add(x, 0.78, z, VOX.fence, 0.13, 1.6, 0.13, 0, yaw, lean);
      // board with dark hazard chevrons sitting proud of the face
      this.rp(props, x, z, yaw, 0, 1.32, 0.02, NITE.signBoard, 1.0, 0.6, 0.1, lean);
      for (const sx of [-0.3, 0, 0.3])
        this.rp(props, x, z, yaw, sx, 1.32, 0.09, VOX.roofDark, 0.13, 0.62, 0.04, lean + 0.5);
      this.rp(props, x, z, yaw, 0, 0.95, 0.08, VOX.roofDark, 0.8, 0.16, 0.04, lean); // KEEP OUT strip
      if (lamp) glow.add(x, 1.72, z, VOX.toolbox, 0.12, 0.12, 0.12); // dim red warning lamp
    }
  }

  /** Scatter light, decorative camp clutter across the grass (no collision). */
  private buildClutter(props: VoxelBatch) {
    const kinds = ["jerry", "propane", "toolbox", "tire", "rocks", "crate", "sack", "medkit"] as const;
    let placed = 0;
    let attempts = 0;
    while (placed < 18 && attempts++ < 450) {
      const x = (Math.random() * 2 - 1) * (this.half - 3);
      const z = (Math.random() * 2 - 1) * (this.half - 3);
      if (!this.inArena(Math.round(x), Math.round(z))) continue;
      if (Math.max(Math.abs(x), Math.abs(z)) <= this.plaza + 1) continue; // keep the clearing open
      if (Math.abs(x) <= 1.2 || Math.abs(z) <= 1.2) continue; // keep paths clear
      if (this.insideObstacle(x, z, 1) || this.nearDeco(x, z, 0.6)) continue;
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      if (kind === "jerry") this.propJerryCan(props, x, z);
      else if (kind === "propane") this.propPropane(props, x, z);
      else if (kind === "toolbox") this.propToolbox(props, x, z);
      else if (kind === "tire") this.propTire(props, x, z);
      else if (kind === "crate") this.crateBody(props, x, 0.32, z, 0.66);
      else if (kind === "sack") this.propSack(props, x, z);
      else if (kind === "medkit") this.propMedkit(props, x, z);
      else this.propRocks(props, x, z);
      placed++;
    }
  }

  // ---- individual voxel props ----
  /** A crate with a darker plank frame + diagonal brace for a built look. */
  private propCrate(props: VoxelBatch, x: number, z: number, stacked: boolean) {
    this.crateBody(props, x, 0.5, z, 1.0);
    if (stacked) this.crateBody(props, x + 0.1, 1.45, z - 0.05, 0.9);
  }
  /**
   * A shell of overlapping fine voxels (scale > spacing so it reads solid, not
   * a quilt) — the same premium-voxel technique as the RV, for detailed props.
   */
  private denseShell(
    b: VoxelBatch, cx: number, cy: number, cz: number, w: number, h: number, d: number, step: number,
    colorFn: (vx: number, vy: number, vz: number) => number | null,
  ) {
    const v = step * 1.18;
    const eps = step * 0.25;
    for (let x = -w / 2 + step / 2; x < w / 2 - eps; x += step)
      for (let y = -h / 2 + step / 2; y < h / 2 - eps; y += step)
        for (let z = -d / 2 + step / 2; z < d / 2 - eps; z += step) {
          if (Math.abs(x) < w / 2 - step && Math.abs(y) < h / 2 - step && Math.abs(z) < d / 2 - step) continue;
          const col = colorFn(x, y, z);
          if (col !== null) b.add(cx + x, cy + y, cz + z, col, v, v, v);
        }
  }

  /** A planked wooden crate built from fine voxels (slats + dark frame). */
  private crateBody(props: VoxelBatch, x: number, y: number, z: number, s: number) {
    const step = s * 0.26; // ~4 voxels per edge
    this.denseShell(props, x, y, z, s, s, s, step, (vx, vy, vz) => {
      const frame =
        Math.abs(vy) > s / 2 - step * 1.2 || Math.abs(vx) > s / 2 - step * 1.2 || Math.abs(vz) > s / 2 - step * 1.2;
      if (frame) return VOX.crateDark; // plank frame around the edges
      return Math.round(vx / step) % 2 === 0 ? VOX.crate : VOX.crateDark; // vertical slats
    });
  }

  /** A barrel built from fine voxels with three steel hoop bands + a lid. */
  private propBarrel(props: VoxelBatch, x: number, z: number, color: number) {
    const w = 0.8, h = 1.2, step = w * 0.27; // ~3 voxels across, ~4 tall
    this.denseShell(props, x, 0.6, z, w, h, w, step, (_vx, vy, _vz) => {
      // hoops at local heights ≈ +0.35, 0, -0.35
      if (Math.abs(vy - 0.35) < step * 0.65 || Math.abs(vy) < step * 0.55 || Math.abs(vy + 0.35) < step * 0.65)
        return VOX.steelDark;
      return color;
    });
    props.add(x, 1.22, z, VOX.steel, 0.52, 0.12, 0.52); // lid
  }

  private propSandbags(props: VoxelBatch, x: number, z: number) {
    for (let k = -1; k <= 1; k++) {
      props.add(x + k * 0.9, 0.22, z, VOX.sandbag, 0.86, 0.42, 0.7);
      props.add(x + k * 0.9, 0.62, z, VOX.sandbagDark, 0.86, 0.42, 0.7);
    }
    props.add(x - 0.45, 1.0, z, VOX.sandbag, 0.86, 0.42, 0.7);
    props.add(x + 0.45, 1.0, z, VOX.sandbag, 0.86, 0.42, 0.7);
  }

  private propJerryCan(props: VoxelBatch, x: number, z: number) {
    this.denseShell(props, x, 0.5, z, 0.56, 0.86, 0.44, 0.2, (vx, vy, _vz) => {
      if (Math.abs(vx) < 0.2 && Math.abs(vy) < 0.26) return VOX.jerryCanDark; // recessed X panel
      return VOX.jerryCan;
    });
    props.add(x, 0.86, z, VOX.jerryCanDark, 0.48, 0.12, 0.46);   // rim
    props.add(x - 0.18, 0.99, z, VOX.jerryCanDark, 0.18, 0.16, 0.34); // handle
    props.add(x + 0.16, 0.99, z, VOX.steelDark, 0.16, 0.16, 0.16);    // spout cap
  }

  private propPropane(props: VoxelBatch, x: number, z: number) {
    this.denseShell(props, x, 0.55, z, 0.52, 1.0, 0.52, 0.2, (_vx, vy, _vz) =>
      Math.abs(vy - 0.2) < 0.12 || Math.abs(vy + 0.35) < 0.12 ? VOX.steelDark : VOX.propane);
    props.add(x, 1.1, z, VOX.steel, 0.28, 0.18, 0.28);   // valve
    props.add(x, 1.22, z, VOX.steelDark, 0.16, 0.1, 0.16); // knob
  }

  private propToolbox(props: VoxelBatch, x: number, z: number) {
    this.denseShell(props, x, 0.32, z, 0.92, 0.5, 0.56, 0.2, (_vx, vy, _vz) =>
      vy > 0.12 ? VOX.toolboxDark : VOX.toolbox);   // darker lid
    props.add(x, 0.58, z, VOX.toolboxDark, 0.94, 0.08, 0.58); // lid lip
    props.add(x, 0.72, z, VOX.steel, 0.36, 0.1, 0.14);        // handle
  }

  private propTire(props: VoxelBatch, x: number, z: number) {
    props.add(x, 0.2, z, VOX.tire, 0.85, 0.32, 0.85);
    props.add(x + 0.06, 0.5, z + 0.04, VOX.tire, 0.8, 0.3, 0.8);
    props.add(x + 0.06, 0.5, z + 0.04, VOX.steelDark, 0.3, 0.32, 0.3);
  }

  private propRocks(props: VoxelBatch, x: number, z: number) {
    props.add(x, 0.18, z, VOX.rock, 0.5, 0.38, 0.5);
    props.add(x + 0.4, 0.12, z + 0.25, VOX.rockDark, 0.32, 0.26, 0.32);
  }

  /** A slumped supply sack (grain/flour) — soft rounded forms, quick to read. */
  private propSack(props: VoxelBatch, x: number, z: number) {
    const yaw = Math.random() * Math.PI;
    props.add(x, 0.2, z, VOX.sandbag, 0.62, 0.4, 0.5, 0, yaw, 0);
    props.add(x + 0.18, 0.46, z - 0.08, VOX.sandbagDark, 0.42, 0.26, 0.36, 0, yaw + 0.4, 0);
    props.add(x, 0.42, z + 0.1, VOX.sandbagDark, 0.16, 0.14, 0.16, 0, yaw, 0); // tied neck
  }

  /** A dropped first-aid kit — white box, red cross sitting proud of the lid. */
  private propMedkit(props: VoxelBatch, x: number, z: number) {
    const yaw = Math.random() * Math.PI;
    props.add(x, 0.21, z, VOX.rvBody, 0.62, 0.36, 0.46, 0, yaw, 0);
    this.rp(props, x, z, yaw, 0, 0.42, 0, VOX.toolbox, 0.34, 0.05, 0.1);
    this.rp(props, x, z, yaw, 0, 0.42, 0, VOX.toolbox, 0.1, 0.05, 0.3);
  }

  /** A stone-ringed campfire with charred logs, flickering flame + smoke. */
  private buildCampfire(props: VoxelBatch, x: number, z: number) {
    for (let a = 0; a < 8; a++) {
      const an = (a / 8) * Math.PI * 2;
      props.add(x + Math.cos(an) * 0.75, 0.18, z + Math.sin(an) * 0.75, a % 2 ? VOX.rock : VOX.rockDark, 0.4, 0.34, 0.4);
    }
    props.add(x, 0.32, z, VOX.doorWood, 1.0, 0.22, 0.26); // crossed logs
    props.add(x, 0.44, z, VOX.trunk, 0.26, 0.22, 1.0);
    for (let f = 0; f < 3; f++) {
      const m = this.glowBox(0.3, 0.5, 0.3, x + (f - 1) * 0.16, 0.75 + f * 0.12, z, f === 1 ? VOX.emberHot : VOX.ember, 1.3);
      this.flames.push({ mesh: m, baseY: 0.75 + f * 0.12, phase: f * 1.3 });
    }
    // The warm heart of the night map — a wider, richer pool of firelight.
    // The emissive flame glow boxes (added above) keep the fire visibly lit;
    // the decorative PointLight is skipped on mobile (LOW_TIER).
    if (!LOW_TIER) {
      const light = new THREE.PointLight(0xff8a3a, 5.5, 11, 2);
      light.position.set(x, 1.3, z);
      this.group.add(light);
      this.flickers.push({ light, base: 5.5, speed: 13, phase: 0.7 });
    }
    this.registerSmoke(x, 1.5, z);
    this.obstacles.push({ minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.9, maxZ: z + 0.9 });
  }

  /** Glowing sparks that spiral up out of the fire and wink out. */
  private buildEmbers(x: number, z: number) {
    const mat = glowMaterial(0xff9a4a, 1.4);
    for (let e = 0; e < 9; e++) {
      const m = new THREE.Mesh(this.geo, mat);
      m.scale.setScalar(0.07);
      m.position.set(x, 1.0, z);
      this.group.add(m);
      this.embers.push({
        mesh: m, bx: x, by: 0.9, bz: z,
        phase: e / 9, speed: 0.32 + Math.random() * 0.3, rise: 2.6 + Math.random() * 1.6,
      });
    }
  }

  private registerSmoke(x: number, y: number, z: number) {
    const mat = new THREE.MeshStandardMaterial({
      color: VOX.smoke, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false,
    });
    for (let p = 0; p < 3; p++) {
      const m = new THREE.Mesh(this.geo, mat.clone());
      m.position.set(x, y, z);
      m.scale.setScalar(0.4);
      this.group.add(m);
      this.smoke.push({ mesh: m, baseX: x, baseY: y, baseZ: z, phase: p / 3, speed: 0.5 + Math.random() * 0.3, rise: 3 + Math.random() });
    }
  }

  private buildTrees(props: VoxelBatch) {
    const placed: [number, number][] = [];
    let attempts = 0;
    while (placed.length < 6 && attempts++ < 300) {
      const i = Math.floor((Math.random() * 2 - 1) * (this.half - 3));
      const j = Math.floor((Math.random() * 2 - 1) * (this.half - 3));
      if (!this.inArena(i, j)) continue;
      if (Math.max(Math.abs(i), Math.abs(j)) <= this.plaza + 1) continue; // keep plaza clear
      if (Math.abs(i) <= 1 || Math.abs(j) <= 1) continue; // keep paths clear
      if (this.insideObstacle(i, j, 2) || this.nearDeco(i, j, 2)) continue;
      // wider spacing so trees feel placed, not cluttered
      if (placed.some(([pi, pj]) => Math.abs(pi - i) < 5 && Math.abs(pj - j) < 5)) continue;
      placed.push([i, j]);
      this.buildTree(props, i, j);
    }
  }

  /**
   * A detailed voxel tree: a tapered bark trunk and a rounded, multi-tone
   * canopy (moonlit on top, near-black below) built from fine overlapping
   * voxels. The rare cherry holds a few pale night blossoms.
   */
  private buildTree(props: VoxelBatch, ox: number, oz: number) {
    const cherry = Math.random() < 0.12;
    const leaf = cherry ? VOX.leafPink : VOX.leaf;
    const leafLit = cherry ? VOX.flowerPink : VOX.leafLight;
    const leafDark = cherry ? 0xd98fb4 : VOX.leafDark;
    const fleck = cherry ? VOX.flowerWhite : VOX.flowerYellow;

    // tapered bark trunk
    const th = 1.5 + Math.random() * 0.8;
    for (let y = 0; y < th; y += 0.4) {
      const w = 0.5 - (y / th) * 0.12;
      props.add(ox, 0.5 + y, oz, Math.random() < 0.3 ? VOX.barkDark : VOX.bark, w, 0.46, w);
    }

    // rounded canopy: an ellipsoid shell of fine overlapping voxels
    const cy = 0.5 + th + 0.7;
    const rx = 1.25 + Math.random() * 0.35;
    const ry = 1.05 + Math.random() * 0.3;
    const s = 0.42, v = s * 1.2;
    for (let x = -rx; x <= rx; x += s)
      for (let y = -ry; y <= ry; y += s)
        for (let z = -rx; z <= rx; z += s) {
          const dd = (x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rx * rx);
          if (dd > 1) continue;
          if (dd < 0.32) continue; // hollow core (saves voxels, same look)
          let col = y > ry * 0.18 ? leafLit : y < -ry * 0.25 ? leafDark : leaf;
          if (Math.random() < 0.04) col = fleck; // blossom / fruit fleck
          props.add(ox + x, cy + y, oz + z, col, v, v, v);
        }
  }

  /**
   * Ground dressing scattered across the grass — tufts, a few hardy night
   * flowers, clover, pebbles and toadstools — so the field still feels alive
   * under the moon. All baked into the instanced props batch (cheap).
   */
  private buildFoliage(props: VoxelBatch) {
    const ok = (x: number, z: number) =>
      this.inArena(Math.round(x), Math.round(z)) &&
      Math.max(Math.abs(x), Math.abs(z)) > this.plaza + 0.5 &&
      Math.abs(x) > 1.2 && Math.abs(z) > 1.2 &&
      !this.insideObstacle(x, z, 0.4) && !this.nearDeco(x, z, 0.3);

    const scatter = (count: number, place: (x: number, z: number) => void) => {
      let n = 0, tries = 0;
      while (n < count && tries++ < count * 8) {
        const x = (Math.random() * 2 - 1) * (this.half - 2);
        const z = (Math.random() * 2 - 1) * (this.half - 2);
        if (!ok(x, z)) continue;
        place(x, z);
        n++;
      }
    };

    // grass tufts — deeper greens for the night field
    scatter(190, (x, z) => {
      const c = Math.random() < 0.45 ? VOX.leafDark : VOX.leaf;
      for (let b = 0; b < 3; b++)
        props.add(x + (Math.random() - 0.5) * 0.45, 0.18 + Math.random() * 0.12, z + (Math.random() - 0.5) * 0.45,
          c, 0.12, 0.32 + Math.random() * 0.2, 0.12);
    });
    // a few pale night-bloomers — mostly whites that catch the moonlight
    const blooms = [VOX.flowerWhite, VOX.flowerWhite, VOX.flowerPink, VOX.flowerYellow];
    scatter(36, (x, z) => {
      props.add(x, 0.28, z, VOX.flowerStem, 0.08, 0.4, 0.08);
      props.add(x, 0.52, z, blooms[(Math.random() * blooms.length) | 0], 0.22, 0.18, 0.22);
    });
    // clover/leaf patches — low ground cover
    scatter(60, (x, z) => {
      for (let b = 0; b < 4; b++)
        props.add(x + (Math.random() - 0.5) * 0.6, 0.14, z + (Math.random() - 0.5) * 0.6,
          Math.random() < 0.5 ? VOX.leaf : VOX.leafDark, 0.2, 0.16, 0.2);
    });
    // pebbles
    scatter(55, (x, z) => {
      props.add(x, 0.14, z, Math.random() < 0.5 ? VOX.pebble : VOX.pebbleDark, 0.26, 0.2, 0.26);
      if (Math.random() < 0.5) props.add(x + 0.28, 0.1, z + 0.12, VOX.pebbleDark, 0.16, 0.14, 0.16);
    });
    // ordinary toadstools (the glowing ones live in the corners)
    scatter(14, (x, z) => {
      props.add(x, 0.22, z, VOX.mushroomStem, 0.12, 0.26, 0.12);
      props.add(x, 0.4, z, VOX.mushroomCap, 0.28, 0.16, 0.28);
    });
  }

  private insideObstacle(x: number, z: number, pad = 0): boolean {
    return this.obstacles.some(
      (o) => x > o.minX - pad && x < o.maxX + pad && z > o.minZ - pad && z < o.maxZ + pad,
    );
  }

  // ---- clouds ----
  private buildClouds(scene: THREE.Scene) {
    const mat = voxelMaterial(NITE.cloud); // moonlit grey-blue, not daytime white
    for (let n = 0; n < 11; n++) {
      const g = new THREE.Group();
      const puffs = 4 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const s = 2 + Math.random() * 3;
        const m = new THREE.Mesh(this.geo, mat);
        m.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6);
        m.scale.set(s, s * 0.7, s);
        g.add(m);
      }
      // Keep clouds well above the camera (y≈24) so they stay a sky backdrop and
      // never drift between the lens and the player on the ground.
      g.position.set((Math.random() - 0.5) * 170, 44 + Math.random() * 24, (Math.random() - 0.5) * 170);
      scene.add(g);
      this.clouds.push({ group: g, speed: 1 + Math.random() * 1.6 });
    }
  }

  /** Low translucent mist patches that drift slowly between the props. */
  private buildMist() {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random();
      const r = 8 + Math.random() * 8.5;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      const base = 0.1 + Math.random() * 0.07;
      const mat = new THREE.MeshBasicMaterial({
        color: NITE.mist, transparent: true, opacity: base, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(bx, 0.42 + i * 0.06, bz); // staggered heights — no coplanar quads
      const s = 5 + Math.random() * 4;
      m.scale.set(s, s * (0.6 + Math.random() * 0.5), 1);
      m.renderOrder = 1;
      this.group.add(m);
      this.mist.push({ mesh: m, mat, bx, bz, phase: Math.random() * 10, speed: 0.1 + Math.random() * 0.1, base });
    }
  }

  // ---- per-frame ----
  update(dt: number) {
    this.t += dt;
    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > 95) c.group.position.x = -95;
    }
    // campfire flames: flicker their height + glow so the fire dances
    for (const f of this.flames) {
      const flick = 0.5 + 0.5 * Math.sin(this.t * 12 + f.phase) * Math.sin(this.t * 7 + f.phase * 2);
      f.mesh.scale.set(0.28 + flick * 0.1, 0.45 + flick * 0.35, 0.28 + flick * 0.1);
      f.mesh.position.y = f.baseY + flick * 0.12;
      (f.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.1 + flick * 0.8;
    }
    // campfire smoke: each puff rises, drifts, swells + fades, then loops
    for (const s of this.smoke) {
      const k = (this.t * s.speed + s.phase) % 1; // 0→1 life cycle
      s.mesh.position.set(
        s.baseX + Math.sin(this.t * 0.8 + s.phase * 6) * k * 0.8,
        s.baseY + k * s.rise,
        s.baseZ + Math.cos(this.t * 0.6 + s.phase * 6) * k * 0.4,
      );
      s.mesh.scale.setScalar(0.3 + k * 0.9);
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - k);
    }
    // embers: sparks spiral up out of the fire, shrinking to nothing
    for (const e of this.embers) {
      const k = (this.t * e.speed + e.phase) % 1;
      e.mesh.position.set(
        e.bx + Math.sin(this.t * 1.4 + e.phase * 9) * k * 0.55,
        e.by + k * e.rise,
        e.bz + Math.cos(this.t * 1.1 + e.phase * 7) * k * 0.4,
      );
      e.mesh.scale.setScalar(Math.max(0.012, 0.085 * (1 - k)));
    }
    // ground mist: slow drift + a breathing fade
    for (const m of this.mist) {
      m.mesh.position.x = m.bx + Math.sin(this.t * m.speed + m.phase) * 1.7;
      m.mesh.position.z = m.bz + Math.cos(this.t * m.speed * 0.8 + m.phase) * 1.3;
      m.mesh.rotation.z = m.phase + this.t * 0.02;
      m.mat.opacity = m.base * (0.65 + 0.35 * Math.sin(this.t * 0.5 + m.phase));
    }
    // lantern panes / firelight / the dying headlight: organic flicker
    for (const fl of this.flickers) {
      const v = fl.base * (0.78 + 0.22 * Math.sin(this.t * fl.speed + fl.phase) * Math.sin(this.t * fl.speed * 0.37 + fl.phase * 2));
      if (fl.light) fl.light.intensity = v;
      if (fl.mat) fl.mat.emissiveIntensity = v;
    }
    // crows: hunched and still, then a sudden burst of wing-flapping
    for (const c of this.crows) {
      if (this.t >= c.next) {
        c.until = this.t + 0.55 + Math.random() * 0.35;
        c.next = this.t + 4 + Math.random() * 9;
      }
      const flapping = this.t < c.until;
      const f = flapping ? Math.abs(Math.sin(this.t * 26 + c.phase)) * 1.1 : 0.14;
      c.pivL.rotation.x = f;
      c.pivR.rotation.x = -f;
      c.body.position.y = c.baseY + (flapping ? Math.abs(Math.sin(this.t * 26 + c.phase)) * 0.05 : 0);
    }
    // distant lightning: a brief cold double-flash on a long random timer
    if (this.t >= this.boltNext) {
      this.boltAt = this.t;
      this.boltNext = this.t + 14 + Math.random() * 22;
    }
    const u = this.t - this.boltAt;
    if (u < 0.6) {
      const f1 = Math.max(0, 1 - Math.abs(u - 0.06) * 22);
      const f2 = Math.max(0, 1 - Math.abs(u - 0.28) * 14);
      this.bolt.intensity = f1 * 1.5 + f2 * 0.9;
    } else if (this.bolt.intensity !== 0) {
      this.bolt.intensity = 0;
    }
    // the bright stars twinkle; the moon halo breathes, barely
    this.starTwinkle.opacity = 0.72 + 0.2 * Math.sin(this.t * 1.7) * Math.sin(this.t * 0.9 + 2);
    this.moonHalo[0].opacity = 0.2 + 0.025 * Math.sin(this.t * 0.4);
    this.moonHalo[1].opacity = 0.08 + 0.015 * Math.sin(this.t * 0.3 + 1);
  }

  // ---- gameplay helpers ----
  clamp(pos: THREE.Vector3, radius: number) {
    const lim = this.half - 1 - radius;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));
  }

  /** Push a circle (radius r) out of any obstacle footprint. */
  resolveObstacles(pos: THREE.Vector3, r: number) {
    for (const o of this.obstacles) {
      const minX = o.minX - r, maxX = o.maxX + r, minZ = o.minZ - r, maxZ = o.maxZ + r;
      if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
        const dl = pos.x - minX, dr = maxX - pos.x, du = pos.z - minZ, dd = maxZ - pos.z;
        const m = Math.min(dl, dr, du, dd);
        if (m === dl) pos.x = minX;
        else if (m === dr) pos.x = maxX;
        else if (m === du) pos.z = minZ;
        else pos.z = maxZ;
      }
    }
  }

  randomEdgePoint(out: THREE.Vector3): THREE.Vector3 {
    const lim = this.half - 1.5;
    const t = Math.random() * 2 - 1;
    switch (Math.floor(Math.random() * 4)) {
      case 0: out.set(t * lim, 0, -lim); break;
      case 1: out.set(t * lim, 0, lim); break;
      case 2: out.set(-lim, 0, t * lim); break;
      default: out.set(lim, 0, t * lim); break;
    }
    return out;
  }
}
