import * as THREE from "three";
import { voxelMaterial, glowMaterial, VOX } from "../palette";

/**
 * The Bed Wars arena — a square voxel battlefield floating over a void/water
 * backdrop, built in the same chunky toy-diorama style as the island/arena.
 *
 * Four team islands sit in the corners, each a raised stone+grass platform with
 * a low wall lip, a colored banner pillar, a bed pad and a generator pad. A
 * larger CENTRAL island hosts a glowing "diamond" generator monument, and four
 * mid islands bridge the corners to the center for the classic Bed Wars layout.
 *
 * This builder owns ONLY the static world + its gentle ambient animation
 * (banner shimmer, generator monument pulse/spin). The integrator wires it into
 * the game state, places/removes the destructible beds via `makeBed`, and spawns
 * players/generators at the published anchors (see `teams` and `center`).
 */

export type BwTeamId = "red" | "blue" | "green" | "yellow";

export interface BwTeamAnchor {
  id: BwTeamId;
  color: number; // team colour (red 0xff5a4a, blue 0x6ad7ff, green 0x7be08a, yellow 0xffd24a)
  base: THREE.Vector3; // centre of the team's island (player spawn-ish)
  bed: THREE.Vector3; // where the destructible bed sits
  generator: THREE.Vector3; // where the resource generator sits
}

// ---- shared layout constants (so the integrator can reason about the map) ----
const ARENA_HALF = 35; // half-extent of the square arena footprint (~70×70)
const CORNER = 22; // corner-island centre offset along X and Z
const ISLAND_TOP = 1.0; // top surface height of every team/mid/centre platform
const TEAM_HALF = 7; // half-width of a team platform (~14×14)
const CENTER_HALF = 9; // half-width of the (bigger) central island
const MID_HALF = 5; // half-width of each bridging mid island

// The four corner teams, with their signature colours. Bed + generator pads are
// nudged off-centre on the platform so the integrator has distinct spots.
const TEAM_DEFS: { id: BwTeamId; color: number; sx: number; sz: number }[] = [
  { id: "red", color: 0xff5a4a, sx: -1, sz: -1 },
  { id: "blue", color: 0x6ad7ff, sx: 1, sz: -1 },
  { id: "green", color: 0x7be08a, sx: -1, sz: 1 },
  { id: "yellow", color: 0xffd24a, sx: 1, sz: 1 },
];

// ---- animation record types (mirrors island.ts's small registries) ----
interface Banner {
  segs: THREE.Mesh[]; // cloth segments that ripple on staggered phases
  phase: number;
}
interface PulseGlow {
  mesh: THREE.Mesh; // emissive accent that breathes
  base: number; // rest emissive intensity
  amp: number; // pulse amplitude
  phase: number;
}

export class BedWarsMap {
  readonly group = new THREE.Group();
  readonly teams: BwTeamAnchor[] = [];
  readonly center = new THREE.Vector3(0, ISLAND_TOP, 0);

  private t = 0;
  private banners: Banner[] = [];
  private pulses: PulseGlow[] = [];
  private monument?: THREE.Group; // central diamond monument (spins)
  private monumentGem?: THREE.Mesh; // the floating gem on top (bobs + pulses)

  constructor(scene: THREE.Scene) {
    this.buildAnchors();
    this.buildBackdrop();
    this.buildCenterIsland();
    this.buildMidIslands();
    this.buildTeamIslands();
    this.applyShadows();
    scene.add(this.group);
    this.group.visible = false; // shown only while in the Bed Wars mode
  }

  setVisible(on: boolean) {
    this.group.visible = on;
  }

  // ========================================================================
  //  ANCHORS — published so the integrator can place beds/generators/players
  // ========================================================================

  /** Compute the four team anchors up front (base / bed / generator spots). */
  private buildAnchors() {
    for (const d of TEAM_DEFS) {
      const cx = d.sx * CORNER;
      const cz = d.sz * CORNER;
      this.teams.push({
        id: d.id,
        color: d.color,
        base: new THREE.Vector3(cx, ISLAND_TOP, cz),
        // bed sits toward the island's outer corner; generator toward the centre
        bed: new THREE.Vector3(cx + d.sx * 3.4, ISLAND_TOP, cz + d.sz * 3.4),
        generator: new THREE.Vector3(cx - d.sx * 3.4, ISLAND_TOP, cz - d.sz * 3.4),
      });
    }
  }

  // ========================================================================
  //  WORLD BUILDING
  // ========================================================================

  /** A dark void floor + a translucent water sheet far below, so the islands
   *  read as floating platforms (the signature Bed Wars "fall into the void"). */
  private buildBackdrop() {
    // deep void plate well below the play surface
    const voidPlate = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF * 2 + 30, 1, ARENA_HALF * 2 + 30),
      voxelMaterial(0x222634),
    );
    voidPlate.position.y = -12;
    voidPlate.userData.noCast = true;
    this.group.add(voidPlate);

    // a glassy water sheet catching the bloom, drifting just above the void
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF * 2 + 24, 0.4, ARENA_HALF * 2 + 24),
      new THREE.MeshStandardMaterial({
        color: VOX.water,
        emissive: VOX.water,
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
  }

  /**
   * A raised voxel platform: a stone underbelly, a grass cap of jittered tiles,
   * and a low cobble wall "lip" ringing the edge (the classic island silhouette).
   * Centred at (cx, cz) with half-width `half`. Returns the platform group so the
   * caller can decorate the top surface.
   */
  private buildPlatform(cx: number, cz: number, half: number, seed: number): THREE.Group {
    const plat = new THREE.Group();
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const span = half * 2;
    // chunky stone underbelly (two tapering tiers for a floating-rock look)
    const belly = new THREE.Mesh(new THREE.BoxGeometry(span, 2.0, span), voxelMaterial(VOX.stone));
    belly.position.y = ISLAND_TOP - 1.0;
    plat.add(belly);
    const root = new THREE.Mesh(new THREE.BoxGeometry(span - 2.4, 2.2, span - 2.4), voxelMaterial(VOX.stoneDark));
    root.position.y = ISLAND_TOP - 2.8;
    plat.add(root);

    // grass cap — jittered tiles in two tones for a hand-laid lawn
    const step = 2.0;
    const n = Math.ceil(half / step);
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const x = ix * step;
        const z = iz * step;
        if (Math.abs(x) > half - 0.2 || Math.abs(z) > half - 0.2) continue;
        const h = 0.5 + rnd() * 0.06;
        const mat = rnd() < 0.12 ? voxelMaterial(VOX.grassLight) : (ix + iz) % 2 === 0 ? voxelMaterial(VOX.grass) : voxelMaterial(VOX.grassDark);
        const tile = new THREE.Mesh(new THREE.BoxGeometry(step * 0.98, h, step * 0.98), mat);
        tile.position.set(x, ISLAND_TOP - h / 2, z);
        tile.userData.noCast = true; // receives shadow, kept out of the shadow map
        plat.add(tile);
      }
    }

    // low wall lip ringing the platform (alternating cobble tones, gaps the corners)
    const lipH = 0.7;
    const lipY = ISLAND_TOP + lipH / 2;
    const stepN = Math.floor(span / step);
    for (let k = 0; k <= stepN; k++) {
      const p = -half + k * step;
      const tone = () => (k % 2 === 0 ? voxelMaterial(VOX.cobble) : voxelMaterial(VOX.cobbleDark));
      // four edges
      const e1 = new THREE.Mesh(new THREE.BoxGeometry(step, lipH, 0.6), tone());
      e1.position.set(p, lipY, -half);
      const e2 = new THREE.Mesh(new THREE.BoxGeometry(step, lipH, 0.6), tone());
      e2.position.set(p, lipY, half);
      const e3 = new THREE.Mesh(new THREE.BoxGeometry(0.6, lipH, step), tone());
      e3.position.set(-half, lipY, p);
      const e4 = new THREE.Mesh(new THREE.BoxGeometry(0.6, lipH, step), tone());
      e4.position.set(half, lipY, p);
      plat.add(e1, e2, e3, e4);
    }

    plat.position.set(cx, 0, cz);
    this.group.add(plat);
    return plat;
  }

  /** The bigger central island + a glowing "diamond" generator monument. */
  private buildCenterIsland() {
    this.buildPlatform(0, 0, CENTER_HALF, 1001);

    // monument: a stepped stone plinth crowned by a slowly spinning, pulsing gem
    const mon = new THREE.Group();
    const plinth0 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 3.2), voxelMaterial(VOX.cobble));
    plinth0.position.y = ISLAND_TOP + 0.4;
    const plinth1 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 2.2), voxelMaterial(VOX.cobbleDark));
    plinth1.position.y = ISLAND_TOP + 1.05;
    const plinth2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1.3), voxelMaterial(VOX.stone));
    plinth2.position.y = ISLAND_TOP + 1.65;
    mon.add(plinth0, plinth1, plinth2);

    // a faceted glowing diamond (octahedron) floating above the plinth
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), glowMaterial(0x9fe8ff, 1.3));
    (gem.geometry as THREE.BufferGeometry).scale(1, 1.4, 1);
    gem.position.y = ISLAND_TOP + 3.0;
    mon.add(gem);
    this.monumentGem = gem;

    // four little orbiting accent cubes (also breathe via the pulse registry)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const orb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), glowMaterial(0xbff3ff, 1.0));
      orb.position.set(Math.cos(a) * 1.4, ISLAND_TOP + 2.0, Math.sin(a) * 1.4);
      mon.add(orb);
      this.pulses.push({ mesh: orb, base: 0.8, amp: 0.8, phase: i * 1.2 });
    }

    this.group.add(mon);
    this.monument = mon;
  }

  /** Four mid islands bridging each corner toward the centre (classic layout). */
  private buildMidIslands() {
    const mids: [number, number][] = [
      [CORNER, 0],
      [-CORNER, 0],
      [0, CORNER],
      [0, -CORNER],
    ];
    mids.forEach(([cx, cz], i) => {
      this.buildPlatform(cx, cz, MID_HALF, 2000 + i * 17);
      // a small neutral resource pad accent in the middle of each
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.2, 18), glowMaterial(VOX.emberHot, 0.6));
      pad.position.set(cx, ISLAND_TOP + 0.12, cz);
      pad.userData.noCast = true;
      this.group.add(pad);
      this.pulses.push({ mesh: pad, base: 0.5, amp: 0.5, phase: i * 0.8 });
    });
  }

  /** The four corner team islands, each with banner, bed pad + generator pad. */
  private buildTeamIslands() {
    this.teams.forEach((team, i) => {
      this.buildPlatform(team.base.x, team.base.z, TEAM_HALF, 3000 + i * 31);
      this.decorateTeam(team);
    });
  }

  /**
   * Team-coloured dressing for one corner island: a glowing trim ring on the
   * platform top, a banner pillar with rippling cloth, a bed pad (where the
   * integrator drops `makeBed`) and a generator pad.
   */
  private decorateTeam(team: BwTeamAnchor) {
    const cx = team.base.x;
    const cz = team.base.z;
    const trimMat = glowMaterial(team.color, 0.7);

    // a glowing trim square ringing the platform top (team accent)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(TEAM_HALF - 0.8, 0.16, 5, 4), trimMat);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 4; // square-ish ring framing the platform
    ring.position.set(cx, ISLAND_TOP + 0.3, cz);
    this.group.add(ring);
    this.pulses.push({ mesh: ring, base: 0.6, amp: 0.6, phase: cx + cz });

    // ---- banner pillar: a wood post topped by a team-colour cloth banner ----
    const banner = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 0.5), voxelMaterial(VOX.woodTrim));
    post.position.y = ISLAND_TOP + 2.25;
    banner.add(post);
    // a glowing finial cube crowning the post
    const finial = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), glowMaterial(team.color, 1.1));
    finial.position.y = ISLAND_TOP + 4.7;
    banner.add(finial);
    this.pulses.push({ mesh: finial, base: 0.9, amp: 0.5, phase: cx });
    // hanging cloth: stacked segments that ripple on staggered phases
    const segs: THREE.Mesh[] = [];
    const clothMat = glowMaterial(team.color, 0.45);
    for (let k = 0; k < 4; k++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.18), clothMat);
      seg.position.set(0.95, ISLAND_TOP + 4.0 - k * 0.72, 0);
      banner.add(seg);
      segs.push(seg);
    }
    this.banners.push({ segs, phase: cx * 0.7 + cz * 0.3 });
    // place the banner pillar to the inner side of the island, off the pads
    banner.position.set(cx, 0, cz);
    this.group.add(banner);

    // ---- bed pad: a raised stone platform the destructible bed sits on ----
    const bedPad = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 2.4), voxelMaterial(VOX.cobble));
    bedPad.position.set(team.bed.x, ISLAND_TOP + 0.2, team.bed.z);
    this.group.add(bedPad);
    const bedGlow = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 2.6), glowMaterial(team.color, 0.5));
    bedGlow.position.set(team.bed.x, ISLAND_TOP + 0.42, team.bed.z);
    bedGlow.userData.noCast = true;
    this.group.add(bedGlow);
    this.pulses.push({ mesh: bedGlow, base: 0.4, amp: 0.45, phase: cz });

    // ---- generator pad: a small cobble dais with a glowing core ring ----
    const genPad = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.4, 20), voxelMaterial(VOX.cobbleDark));
    genPad.position.set(team.generator.x, ISLAND_TOP + 0.2, team.generator.z);
    this.group.add(genPad);
    const genRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 6, 20), glowMaterial(team.color, 0.8));
    genRing.rotation.x = Math.PI / 2;
    genRing.position.set(team.generator.x, ISLAND_TOP + 0.45, team.generator.z);
    this.group.add(genRing);
    this.pulses.push({ mesh: genRing, base: 0.7, amp: 0.7, phase: team.generator.x });
  }

  /**
   * A cute voxel bed for a team — a wooden frame, four corner posts, a team-
   * coloured mattress, a white pillow, and a soft glowing under-glow. Returned
   * as a Group the integrator positions at the team's `bed` anchor (its origin
   * sits on the bed pad surface) and removes when the bed is destroyed.
   */
  makeBed(color: number): THREE.Group {
    const bed = new THREE.Group();
    const wood = voxelMaterial(VOX.doorWood);

    // frame base (a low wooden plank platform)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.32, 1.5), wood);
    frame.position.y = 0.22;
    bed.add(frame);

    // four corner posts
    for (const px of [-1.15, 1.15]) {
      for (const pz of [-0.6, 0.6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.3), wood);
        post.position.set(px, 0.35, pz);
        bed.add(post);
      }
    }

    // mattress (team colour, slightly inset on top of the frame)
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.36, 1.25), glowMaterial(color, 0.4));
    mattress.position.y = 0.56;
    bed.add(mattress);

    // pillow (white, at the head end)
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.26, 1.05), voxelMaterial(0xfff3e0));
    pillow.position.set(-0.75, 0.78, 0);
    bed.add(pillow);

    // a folded blanket band across the foot, a touch darker than the mattress
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 1.3), voxelMaterial(0xf2f2f2));
    blanket.position.set(0.6, 0.82, 0);
    bed.add(blanket);

    // soft glowing under-glow disc (caught by bloom — marks the bed clearly)
    const underGlow = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.1, 18), glowMaterial(color, 0.6));
    underGlow.position.y = 0.06;
    underGlow.userData.noCast = true;
    bed.add(underGlow);

    return bed;
  }

  // ========================================================================
  //  SHADOWS
  // ========================================================================

  /** Opaque structures cast + receive contact shadows; glow/transparent bits
   *  (water, glow discs, trim rings) don't. Ground tiles only receive (tagged
   *  noCast) so the big tile field stays out of the shadow map. */
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
  //  ANIMATION — subtle ambient life (mirrors island.ts)
  // ========================================================================

  update(dt: number) {
    if (!this.group.visible) return;
    this.t += dt;
    const t = this.t;

    // central monument: gem spins + bobs, whole monument slowly rotates
    if (this.monument) this.monument.rotation.y += dt * 0.25;
    if (this.monumentGem) {
      this.monumentGem.rotation.y += dt * 1.4;
      this.monumentGem.position.y = ISLAND_TOP + 3.0 + Math.sin(t * 1.6) * 0.18;
      (this.monumentGem.material as THREE.MeshStandardMaterial).emissiveIntensity =
        1.1 + (Math.sin(t * 2.2) + 1) * 0.4;
    }

    // banner cloth ripple (lower segments lag for a soft wave)
    for (const b of this.banners) {
      b.segs.forEach((seg, i) => {
        seg.rotation.y = Math.sin(t * 2.2 + b.phase + i * 0.6) * (0.12 + i * 0.05);
        seg.position.x = 0.95 + Math.sin(t * 2.2 + b.phase + i * 0.6) * (0.02 + i * 0.02);
      });
    }

    // generic emissive pulses (trim rings, finials, generator rings, pads)
    for (const p of this.pulses) {
      (p.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
        p.base + (Math.sin(t * 2.4 + p.phase) + 1) * 0.5 * p.amp;
    }
  }
}
