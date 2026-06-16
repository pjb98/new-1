import * as THREE from "three";
import { voxelMaterial, glowMaterial, auraMaterial, VOX, COLORS } from "./palette";
import { VoxelChar } from "./voxelChar";
import { makeBubble, makeLabel } from "./islandnet";
import { SATELLITES, clampToHub } from "./hublayout";

/**
 * The Island — a persistent social hub / lobby the player spawns into (think a
 * cozy Roblox-style starting world). You walk around your voxel character here,
 * see other people (multiplayer presence is layered on top via NetPlay), hatch
 * pets at the egg shrines ringing the central fountain, and step into one of the
 * Solo / Duo / Squad portal gates to start a run.
 *
 * This module owns the static world + the interactive "zones" (proximity pads)
 * AND all of the hub's ambient animation (fountain, floating eggs, shimmering
 * portals, torches, banners, drifting motes & clouds). It is deliberately rich:
 * the lobby is the first thing players see, so it earns the polish. Movement,
 * camera and presence are still driven by main.ts so the island can reuse the
 * existing Player / NetClient / camera systems.
 */

export const ISLAND = {
  half: 48, // half-extent of the island ground — a big village square for ~50 players
  shore: 42, // grass radius; beyond this is sand, then water
};

// Shared hub layout (so every builder agrees on where things go as it scales).
const PLAZA_R = 13; // stone town-square radius
const EGG_R = 7.2; // egg-shrine ring radius around the fountain
// The three zombie modes live on the ZOMBIES satellite island, lined up across
// it (perpendicular to the bridge that arrives from the main island).
const _ZS = SATELLITES.find((s) => s.id === "sat_zombies")!.center;
const _zd = Math.hypot(_ZS.x, _ZS.z) || 1;
const _zperp = { x: -_ZS.z / _zd, z: _ZS.x / _zd }; // left perpendicular to the bridge axis
function _zgate(off: number): THREE.Vector3 {
  return new THREE.Vector3(_ZS.x + _zperp.x * off, 0, _ZS.z + _zperp.z * off);
}
const GATES = [
  { id: "mode_solo", players: 1 as const, pos: _zgate(-6), color: 0x7be08a, label: "SOLO — 1 player", grand: 0 },
  { id: "mode_duo", players: 2 as const, pos: _zgate(0), color: 0x6ad7ff, label: "DUO — 2 players (2× harder)", grand: 1 },
  { id: "mode_quad", players: 4 as const, pos: _zgate(6), color: 0xff5a3a, label: "SQUAD — 4 players (4× harder)", grand: 2 },
];
const PADS = [
  { id: "join" as const, pos: new THREE.Vector3(12, 0, 8), color: 0x6ad7ff, label: "Join a Friend's Run" },
  { id: "shop" as const, pos: new THREE.Vector3(-12, 0, 8), color: 0xffd24a, label: "Open Shop" },
];
// The village ring — cottages framing the square. `big`/`story` drive size +
// a second storey so the rooftops vary like a real town. xz in world space.
const HOUSES = [
  { x: -15.5, z: 11.5, wall: VOX.plasterWarm, roof: VOX.roofRed, trim: VOX.bark, big: 1, story: 1 }, // Shop
  { x: 15.5, z: 11.5, wall: VOX.houseWall, roof: VOX.roofBlue, trim: VOX.bark, big: 1, story: 1 }, // Inn
  { x: -23, z: 2.5, wall: VOX.plasterSage, roof: VOX.roofDark, trim: VOX.barkDark, big: 0, story: 0 },
  { x: 23, z: 2.5, wall: VOX.plasterWarm, roof: VOX.roofPurple, trim: VOX.barkDark, big: 1, story: 0 },
  { x: -21, z: -7, wall: VOX.houseWall, roof: VOX.roofRed, trim: VOX.bark, big: 0, story: 0 },
  { x: 21, z: -7, wall: VOX.plasterSage, roof: VOX.roofBlue, trim: VOX.barkDark, big: 0, story: 1 },
  { x: -10, z: 18.5, wall: VOX.plasterWarm, roof: VOX.roofPurple, trim: VOX.bark, big: 1, story: 0 },
  { x: 10, z: 18.5, wall: VOX.houseWall, roof: VOX.roofDark, trim: VOX.barkDark, big: 0, story: 1 },
];
const STALLS = [
  { x: -5.5, z: 17, color: VOX.toolbox },
  { x: 0, z: 18.5, color: VOX.barrel },
  { x: 5.5, z: 17, color: VOX.rvStripe },
];
// The Pet Sanctuary — a pavilion where you equip + flex your squad.
const SANCTUARY = new THREE.Vector3(7.5, 0, 9.8);
// every structure footprint foliage must avoid
const CLEAR_PTS = [...GATES, ...PADS].map((d) => d.pos).concat(
  HOUSES.map((h) => new THREE.Vector3(h.x, 0, h.z)),
  STALLS.map((s) => new THREE.Vector3(s.x, 0, s.z)),
  [SANCTUARY],
);

/** True near the spoke that runs from the plaza out to a satellite bridge — we
 *  keep these lanes clear of trees/rocks and pave them so the path reads. */
function inHubCorridor(x: number, z: number): boolean {
  for (const s of SATELLITES) {
    const d = Math.hypot(s.center.x, s.center.z) || 1;
    const dx = s.center.x / d, dz = s.center.z / d;
    const t = x * dx + z * dz;          // distance along the spoke
    const perp = x * -dz + z * dx;      // distance across it
    if (t > 8 && t < d && Math.abs(perp) < 4.8) return true;
  }
  return false;
}

/** An interactive spot on the island the player can walk up to. */
export interface IslandZone {
  id: string;
  kind: "mode" | "join" | "shop" | "egg" | "pets" | "daily" | "index" | "wheel" | "wardrobe" | "bedwars" | "td" | "soon";
  pos: THREE.Vector3;
  radius: number; // proximity radius that triggers the prompt
  label: string; // shown in the proximity prompt
  /** game-mode portals (kind === "mode"): how many players the structure hosts. */
  modePlayers?: 1 | 2 | 4;
  /** egg zones (kind === "egg"): which gacha egg this pedestal hatches. */
  eggId?: string;
}

// ---- animation record types ------------------------------------------------

interface Flame {
  mesh: THREE.Mesh;
  phase: number;
  base: number; // rest scale
}
interface Banner {
  segs: THREE.Mesh[];
  phase: number;
}
interface EggShrine {
  id: string;
  group: THREE.Group; // whole shrine (for proximity scale)
  egg: THREE.Mesh; // the faceted gem-egg (bobs + wobbles)
  aura: THREE.Mesh; // translucent breathing halo
  orbit: THREE.Group; // sparkles revolving around the egg
  beam: THREE.Mesh; // light shaft rising from the egg
  ringGlow: THREE.Mesh; // glowing disc on the pedestal top
  pos: THREE.Vector3;
  phase: number;
  color: number;
  lit: number; // eased proximity highlight 0..1
}
interface CoopRoom {
  group: THREE.Group;
  floor: THREE.Mesh; // glowing floor rune you stand on (pulses)
  rune: THREE.Mesh; // rotating rune ring on the floor
  figures: THREE.Object3D[]; // bobbing party-size figures inside
  pos: THREE.Vector3;
  color: number;
  lit: number;
}
interface Mote {
  mesh: THREE.Mesh;
  baseY: number;
  phase: number;
  speed: number;
  span: number; // vertical travel before looping
}
/** An animated swirling portal surface set inside a gateway / arch. */
interface Portal {
  surf: THREE.Mesh; // bright spinning spiral disc
  haze: THREE.Mesh; // larger, fainter counter-spinning halo behind it
  ring: THREE.Mesh; // glowing rim torus
  motes: THREE.Group; // sparks drifting up across the surface
  color: number;
  phase: number;
}

export class Island {
  readonly group = new THREE.Group();
  readonly zones: IslandZone[] = [];
  private water?: THREE.Mesh;
  private beacons: THREE.Mesh[] = [];
  private t = 0;
  // interactive pads (join/shop), tracked so they bounce-scale when stood on
  private pads: { id: string; group: THREE.Group; ring: THREE.Mesh; pos: THREE.Vector3; lit: number }[] = [];
  private greeter?: VoxelChar;
  private arrow?: THREE.Mesh;
  // animation registries
  private eggs: EggShrine[] = [];
  private rooms: CoopRoom[] = [];
  private portals: Portal[] = []; // swirling gateway surfaces (zombie / TD / bedwars)
  private flames: Flame[] = [];
  private banners: Banner[] = [];
  private motes: Mote[] = [];
  private clouds: { mesh: THREE.Mesh; speed: number; reset: number }[] = [];
  private fountainDiscs: THREE.Mesh[] = [];
  private fountainJets: THREE.Mesh[] = [];
  private fountainSpire?: THREE.Mesh;
  private lilies: THREE.Mesh[] = [];
  private sanctuaryOrb?: THREE.Mesh; // spinning centerpiece of the Pet Sanctuary
  private sanctuaryHearts?: THREE.Group; // little hearts orbiting it
  private lbCanvas?: HTMLCanvasElement; // leaderboard board face
  private lbTex?: THREE.CanvasTexture;
  private wheelMesh?: THREE.Mesh; // fortune wheel face (idle-spins)
  private chestGlow?: THREE.Mesh; // daily chest glow (pulses while claimable)
  private wardrobeMannequin?: THREE.Mesh; // rotating wardrobe dummy
  private smokes: Mote[] = []; // chimney smoke puffs (reuse the Mote drift record)
  // ---- village & shore life (new dressing; every record updated allocation-free) ----
  private koiGroup?: THREE.Group; // orange koi circling the fountain pool
  private coinMat?: THREE.MeshStandardMaterial; // wishing-coins glint (shared)
  private poolMat?: THREE.MeshStandardMaterial; // warm lamp-pool glow (shared)
  private fireflyMat?: THREE.MeshStandardMaterial; // firefly flicker (shared)
  private veils: { mesh: THREE.Mesh; phase: number }[] = []; // cascading water sheets
  private gulls: { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh; phase: number; speed: number; r: number; h: number; cx: number; cz: number }[] = [];
  private fishes: { root: THREE.Group; body: THREE.Mesh; splash: THREE.Mesh; phase: number; baseX: number; baseZ: number; dirX: number; dirZ: number }[] = [];
  private boats: { group: THREE.Group; phase: number }[] = [];
  private drifts: { mesh: THREE.Mesh; phase: number; baseX: number; baseZ: number }[] = [];
  private buntings: { flags: THREE.Mesh[]; phase: number }[] = []; // bunting + washing lines
  private butterflies: { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh; phase: number; baseX: number; baseY: number; baseZ: number }[] = [];
  private eggHalos: { mesh: THREE.Mesh; phase: number }[] = []; // tilted shimmer rings
  private sanctuarySparkles?: THREE.Group; // counter-orbiting sparkle ring
  private fireflies?: THREE.InstancedMesh;
  private fireflyBase: Float32Array = new Float32Array(0); // [x, y, z, phase] per firefly
  private fallingLeaves?: THREE.InstancedMesh;
  private leafBase: Float32Array = new Float32Array(0); // [x, z, phase, speed] per leaf
  private readonly _dummy = new THREE.Object3D(); // scratch transform for instancing
  // warm golden-hour mood — applied to the shared scene only while the hub shows
  private scene: THREE.Scene;
  private savedFog: THREE.Scene["fog"] = null;
  private savedBg: THREE.Color | THREE.Texture | null = null;
  private savedEnv = 0.5;
  private moodSaved = false;
  // original intensity/color of the shared scene lights, so the hub can dim +
  // warm them for golden hour and restore them exactly on the way out
  private lightOrig = new Map<THREE.Light, { intensity: number; color: number }>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.buildGround();
    this.buildWater();
    this.buildDecor();
    this.buildBackdrop();
    this.buildPlaza();
    this.buildFountain();
    this.buildZones();
    this.buildSatellites(); // floating game-mode islands + bridges (hub-and-spoke)
    this.buildHubPaths();   // paved spokes from the plaza out to each bridge
    this.buildModes();
    this.buildEggs();
    this.buildSanctuary();
    this.buildLeaderboard();
    this.buildAttractions();
    this.buildHouses();
    this.buildLighting();
    this.buildGreeter();
    this.buildAtmosphere();
    this.buildSigns();
    // ---- the polish pass: village life, shore life, shrine glow layering ----
    this.buildPlazaRings();
    this.buildFountainExtras();
    this.buildShoreLife();
    this.buildVillageDress();
    this.buildSatelliteDress();
    this.buildShrinePolish();
    this.buildAmbientLife();
    this.buildMoodLights();
    this.applyShadows();
    scene.add(this.group);
    this.group.visible = false; // shown only while in the island state
  }

  setVisible(on: boolean) {
    this.group.visible = on;
    if (on) this.enterMood();
    else this.exitMood();
  }

  // ---- warm golden-hour mood (island-only; restores the arena's look on exit) ----

  private buildMoodLights() {
    // these live under this.group, so they only light the scene while the hub is
    // visible (the renderer skips lights under an invisible parent).
    const hemi = new THREE.HemisphereLight(0xffe2b0, 0x6a5236, 0.45); // warm sky / earthy ground
    const sun = new THREE.DirectionalLight(0xffb066, 0.7); // low amber sunset key
    sun.position.set(-26, 12, 20);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.25); // soft warm fill
    rim.position.set(14, 8, -18);
    this.group.add(hemi, sun, rim);
  }

  private enterMood() {
    if (!this.moodSaved) {
      this.savedFog = this.scene.fog;
      this.savedBg = this.scene.background as THREE.Color | THREE.Texture | null;
      this.savedEnv = this.scene.environmentIntensity ?? 0.5;
      // snapshot the shared scene lights once (arena's sun/hemi/fill)
      for (const c of this.scene.children) {
        const l = c as THREE.Light;
        if (l.isLight) this.lightOrig.set(l, { intensity: l.intensity, color: l.color.getHex() });
      }
      this.moodSaved = true;
    }
    // warm haze hugging the island + a soft peach sky, dimmed IBL so the warm
    // lights & lantern bloom carry the cozy golden-hour mood.
    this.scene.fog = new THREE.Fog(0xf0bb7a, 26, 82);
    this.scene.background = new THREE.Color(0xf6cf94);
    this.scene.environmentIntensity = 0.32;
    // dim + warm the shared daylight so the scene actually reads golden-hour
    // rather than washing out under the bright neutral arena sun.
    for (const [l, o] of this.lightOrig) {
      const isKey = o.intensity > 1; // the strong directional key
      l.intensity = o.intensity * (isKey ? 0.42 : 0.55);
      l.color.setHex(isKey ? 0xffc486 : 0xffd9ad);
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

  /** Opaque structures cast + receive contact shadows; glassy/glow/transparent
   *  bits (auras, beams, water, clouds, motes) don't. The ground only receives
   *  (tagged noCast) so the big tile field stays out of the shadow map. */
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

  /** Keep the player on the walkable hub: main island ∪ bridges ∪ satellites. */
  clamp(pos: THREE.Vector3) {
    const c = clampToHub(pos.x, pos.z);
    pos.x = c.x;
    pos.z = c.z;
  }

  /** Nearest zone within its trigger radius (for the walk-up prompt), or null. */
  nearestZone(pos: THREE.Vector3): IslandZone | null {
    let best: IslandZone | null = null;
    let bd = Infinity;
    for (const z of this.zones) {
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

  update(dt: number) {
    if (!this.group.visible) return;
    this.t += dt;
    const t = this.t;

    if (this.water) this.water.position.y = -0.35 + Math.sin(t * 0.8) * 0.05;
    for (const b of this.beacons) {
      const m = b.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.8 + (Math.sin(t * 2.4) + 1) * 0.5;
      b.rotation.y += dt * 1.2;
    }
    if (this.greeter) {
      if (!this.greeter.emoting) this.greeter.emote("wave");
      this.greeter.update(dt);
    }
    if (this.arrow) {
      this.arrow.position.y = 3.6 + Math.sin(t * 2.2) * 0.2;
      this.arrow.rotation.y += dt * 1.5;
    }

    if (this.sanctuaryOrb) {
      this.sanctuaryOrb.rotation.y += dt * 1.1;
      this.sanctuaryOrb.position.y = 2.0 + Math.sin(t * 1.8) * 0.12;
      (this.sanctuaryOrb.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.1 + (Math.sin(t * 2.5) + 1) * 0.3;
    }
    if (this.sanctuaryHearts) {
      this.sanctuaryHearts.rotation.y += dt * 1.6;
      this.sanctuaryHearts.children.forEach((h, i) => { h.position.y = (i % 2 ? 0.15 : -0.1) + Math.sin(t * 3 + i) * 0.08; });
    }

    this.animateFountain(dt);
    this.animateEggs(dt);
    this.animateRooms(dt);
    this.animatePortals(dt);
    if (this.wheelMesh) this.wheelMesh.rotation.z -= dt * 0.5; // idle wheel spin
    if (this.chestGlow) {
      this.chestGlow.rotation.y += dt * 1.5;
      this.chestGlow.position.y = 1.7 + Math.sin(t * 3) * 0.1;
    }
    if (this.wardrobeMannequin) this.wardrobeMannequin.rotation.y += dt * 0.6;
    this.animateFlames();
    this.animateBanners();
    this.animateAtmosphere(dt);
    this.animateLife(dt);
  }

  // ========================================================================
  //  ANIMATION
  // ========================================================================

  private animateFountain(dt: number) {
    const t = this.t;
    if (this.fountainSpire) {
      this.fountainSpire.rotation.y += dt * 0.6;
      this.fountainSpire.position.y = this.fountainSpireBaseY + Math.sin(t * 1.4) * 0.14;
      const m = this.fountainSpire.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 1.1 + (Math.sin(t * 2) + 1) * 0.35;
    }
    this.fountainDiscs.forEach((d, i) => {
      const s = 1 + Math.sin(t * 2.2 + i * 1.3) * 0.04;
      d.scale.set(s, 1, s);
    });
    // jets rise + fall on staggered phases, fading as they peak
    this.fountainJets.forEach((j, i) => {
      const ph = (t * 1.3 + i * 0.5) % 1;
      j.position.y = (j.userData.baseY as number) + ph * 2.0;
      j.scale.y = 0.4 + (1 - ph) * 1.2;
      const m = j.material as THREE.MeshStandardMaterial;
      m.opacity = 0.55 * (1 - ph);
    });
  }

  private animateEggs(dt: number) {
    const t = this.t;
    for (const e of this.eggs) {
      e.group.scale.setScalar(1 + e.lit * 0.08);
      const bob = Math.sin(t * 2 + e.phase) * 0.12;
      e.egg.position.y = 2.05 + bob + e.lit * 0.14;
      // gentle wobble + a faster, livelier spin when a player is close
      e.egg.rotation.y += dt * (0.7 + e.lit * 1.8);
      e.egg.rotation.z = Math.sin(t * 1.7 + e.phase) * 0.12;
      // sparkles orbit; spin up near the player
      e.orbit.position.copy(e.egg.position);
      e.orbit.rotation.y += dt * (1.4 + e.lit * 2.5);
      // aura breathes
      const aS = 1 + Math.sin(t * 2.4 + e.phase) * 0.06 + e.lit * 0.18;
      e.aura.scale.setScalar(aS);
      e.aura.position.y = e.egg.position.y;
      (e.aura.material as THREE.MeshStandardMaterial).opacity = 0.18 + e.lit * 0.22;
      // light shaft shimmer
      const bm = e.beam.material as THREE.MeshStandardMaterial;
      bm.opacity = 0.1 + (Math.sin(t * 3 + e.phase) + 1) * 0.06 + e.lit * 0.2;
      e.beam.rotation.y -= dt * 0.8;
      // pedestal glow disc pulse
      (e.ringGlow.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.8 + (Math.sin(t * 2.6 + e.phase) + 1) * 0.5 + e.lit * 1.4;
    }
  }

  private animateRooms(dt: number) {
    const t = this.t;
    for (const g of this.rooms) {
      g.group.scale.setScalar(1 + g.lit * 0.02);
      // glowing floor rune pulses (brighter when a player is standing in)
      (g.floor.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.5 + (Math.sin(t * 2 + g.pos.x) + 1) * 0.2 + g.lit * 0.9;
      // rune ring slowly rotates + pulses
      g.rune.rotation.y += dt * 0.4;
      (g.rune.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.7 + (Math.sin(t * 2.3 + g.pos.x) + 1) * 0.4 + g.lit * 1.2;
      // figures bob in a little wave
      g.figures.forEach((f, i) => {
        f.position.y = 0.5 + Math.abs(Math.sin(t * 3 + i * 0.9)) * 0.18 + g.lit * 0.1;
      });
    }
  }

  private animatePortals(dt: number) {
    const t = this.t;
    for (const p of this.portals) {
      // the vortex spins, the halo drifts back the other way
      p.surf.rotation.z -= dt * 0.7;
      p.haze.rotation.z += dt * 0.35;
      (p.surf.material as THREE.MeshBasicMaterial).opacity = 0.82 + Math.sin(t * 2.4 + p.phase) * 0.12;
      (p.haze.material as THREE.MeshBasicMaterial).opacity = 0.28 + Math.sin(t * 1.7 + p.phase) * 0.08;
      const s = 1 + Math.sin(t * 2.2 + p.phase) * 0.04;
      p.surf.scale.set(s, s, 1);
      (p.ring.material as THREE.MeshStandardMaterial).emissiveIntensity =
        1.0 + (Math.sin(t * 2.6 + p.phase) + 1) * 0.4;
      // sparks rise across the surface, looping back to the bottom
      p.motes.children.forEach((m) => {
        m.position.y += dt * 0.6;
        const span = m.userData.span as number;
        const base = m.userData.baseY as number;
        if (m.position.y > base + span * 0.5) m.position.y = base - span * 0.5;
      });
    }
  }

  private animateFlames() {
    const t = this.t;
    for (const fl of this.flames) {
      // pseudo-random flicker from layered sines
      const n = Math.sin(t * 13 + fl.phase) * 0.5 + Math.sin(t * 29 + fl.phase * 2) * 0.3;
      const s = fl.base * (1 + n * 0.18);
      fl.mesh.scale.set(s, fl.base * (1.2 + n * 0.35), s);
      (fl.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 + n * 0.8;
    }
  }

  private animateBanners() {
    const t = this.t;
    for (const b of this.banners) {
      b.segs.forEach((seg, i) => {
        // lower cloth segments lag, giving a soft ripple down the banner
        seg.rotation.y = Math.sin(t * 2.2 + b.phase + i * 0.6) * (0.12 + i * 0.05);
        seg.position.x = Math.sin(t * 2.2 + b.phase + i * 0.6) * (0.02 + i * 0.015);
      });
    }
  }

  private animateAtmosphere(dt: number) {
    const t = this.t;
    for (const m of this.motes) {
      m.mesh.position.y += dt * m.speed;
      if (m.mesh.position.y > m.baseY + m.span) m.mesh.position.y = m.baseY;
      // gentle horizontal drift as it rises
      m.mesh.position.x += Math.cos(t * 0.5 + m.phase) * dt * 0.25;
      m.mesh.position.z += Math.sin(t * 0.6 + m.phase) * dt * 0.25;
      const f = (m.mesh.position.y - m.baseY) / m.span;
      (m.mesh.material as THREE.MeshStandardMaterial).opacity = Math.sin(f * Math.PI) * 0.9;
    }
    for (const c of this.clouds) {
      c.mesh.position.x += dt * c.speed;
      if (c.mesh.position.x > c.reset) c.mesh.position.x = -c.reset;
    }
    for (const lp of this.lilies) {
      lp.position.y = -0.28 + Math.sin(t * 0.8 + lp.position.x) * 0.05;
      lp.rotation.y += dt * 0.05;
    }
    // chimney smoke drifts up, fattening + fading, then loops back to the stack
    for (const s of this.smokes) {
      s.mesh.position.y += dt * s.speed;
      const f = (s.mesh.position.y - s.baseY) / s.span;
      if (f >= 1) s.mesh.position.y = s.baseY;
      const sc = 1 + f * 1.4;
      s.mesh.scale.setScalar(sc);
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - Math.max(0, f));
    }
  }

  /** All the NEW ambient life — koi, gulls, fish jumps, the rowboat, bunting,
   *  butterflies, fireflies & falling leaves (instanced), and the shrine halos.
   *  Pure math over prebuilt registries: zero allocation per frame. */
  private animateLife(dt: number) {
    const t = this.t;
    if (this.koiGroup) this.koiGroup.rotation.y -= dt * 0.45; // koi lap the pool
    if (this.coinMat) this.coinMat.emissiveIntensity = 0.7 + (Math.sin(t * 2.1) + 1) * 0.45;
    if (this.poolMat) this.poolMat.opacity = 0.15 + (Math.sin(t * 1.6) + 1) * 0.035;
    // cascading water sheets shimmer between the fountain tiers
    for (const v of this.veils) {
      (v.mesh.material as THREE.MeshStandardMaterial).opacity = 0.14 + (Math.sin(t * 2.6 + v.phase) + 1) * 0.07;
      v.mesh.rotation.y += dt * 0.5;
    }
    // gulls wheel over the bay on big lazy circles, banking into the turn
    for (const g of this.gulls) {
      const a = t * g.speed + g.phase;
      g.group.position.set(g.cx + Math.cos(a) * g.r, g.h + Math.sin(t * 0.9 + g.phase) * 0.8, g.cz + Math.sin(a) * g.r);
      g.group.rotation.y = Math.atan2(-Math.sin(a) * g.speed, Math.cos(a) * g.speed); // face the tangent
      const flap = Math.sin(t * 7 + g.phase) * 0.55;
      g.wingL.rotation.z = flap;
      g.wingR.rotation.z = -flap;
    }
    // an occasional fish arcs out of the bay with a splash ring
    for (const f of this.fishes) {
      const u = (t * 0.13 + f.phase) % 1; // ~7.7 s cycle, mostly underwater
      const jumping = u < 0.16;
      f.root.visible = jumping;
      f.splash.visible = jumping;
      if (jumping) {
        const k = u / 0.16;
        f.root.position.set(f.baseX + f.dirX * (k - 0.5) * 2.6, -0.55 + Math.sin(k * Math.PI) * 2.0, f.baseZ + f.dirZ * (k - 0.5) * 2.6);
        f.body.rotation.x = (0.5 - k) * 1.7; // nose up on the way out, down diving in
        const arc = Math.sin(k * Math.PI);
        f.splash.scale.setScalar(0.5 + (1 - arc) * 1.3);
        (f.splash.material as THREE.MeshStandardMaterial).opacity = (1 - arc) * 0.55;
      }
    }
    // the moored rowboat rocks on the swell; driftwood wanders the shallows
    for (const b of this.boats) {
      b.group.position.y = -0.3 + Math.sin(t * 0.9 + b.phase) * 0.06;
      b.group.rotation.z = Math.sin(t * 0.7 + b.phase) * 0.045;
      b.group.rotation.x = Math.sin(t * 0.55 + b.phase * 1.7) * 0.03;
    }
    for (const d of this.drifts) {
      d.mesh.position.set(d.baseX + Math.cos(t * 0.12 + d.phase) * 1.4, -0.34 + Math.sin(t * 0.8 + d.phase) * 0.05, d.baseZ + Math.sin(t * 0.1 + d.phase) * 1.4);
      d.mesh.rotation.y += dt * 0.05;
    }
    // bunting flags + washing-line cloth swing on the same breeze as the banners
    for (const bl of this.buntings) {
      for (let i = 0; i < bl.flags.length; i++) {
        bl.flags[i].rotation.x = Math.sin(t * 2.4 + bl.phase + i * 0.7) * 0.2;
      }
    }
    // butterflies flutter over the flower beds
    for (const bf of this.butterflies) {
      const a = t * 0.6 + bf.phase;
      bf.group.position.set(bf.baseX + Math.cos(a) * 1.1, bf.baseY + Math.sin(t * 1.7 + bf.phase) * 0.25, bf.baseZ + Math.sin(a * 1.3) * 1.1);
      bf.group.rotation.y = -a;
      const flap = 0.25 + Math.abs(Math.sin(t * 11 + bf.phase)) * 0.95;
      bf.wingL.rotation.z = flap;
      bf.wingR.rotation.z = -flap;
    }
    // shimmer halos around the gem-eggs; counter-orbiting sanctuary sparkles
    for (const h of this.eggHalos) {
      h.mesh.rotation.y += dt * 0.9;
      (h.mesh.material as THREE.MeshStandardMaterial).opacity = 0.16 + (Math.sin(t * 2.2 + h.phase) + 1) * 0.08;
    }
    if (this.sanctuarySparkles) this.sanctuarySparkles.rotation.y -= dt * 2.1;
    // fireflies (instanced): slow wander + a shared warm flicker
    if (this.fireflies) {
      const n = this.fireflyBase.length / 4;
      for (let i = 0; i < n; i++) {
        const bx = this.fireflyBase[i * 4], by = this.fireflyBase[i * 4 + 1], bz = this.fireflyBase[i * 4 + 2], ph = this.fireflyBase[i * 4 + 3];
        this._dummy.position.set(bx + Math.cos(t * 0.7 + ph) * 0.9, by + Math.sin(t * 1.1 + ph * 1.3) * 0.5, bz + Math.sin(t * 0.8 + ph) * 0.9);
        this._dummy.rotation.set(0, 0, 0);
        this._dummy.scale.setScalar(0.7 + (Math.sin(t * 4 + ph) + 1) * 0.4);
        this._dummy.updateMatrix();
        this.fireflies.setMatrixAt(i, this._dummy.matrix);
      }
      this.fireflies.instanceMatrix.needsUpdate = true;
      if (this.fireflyMat) this.fireflyMat.emissiveIntensity = 1.1 + (Math.sin(t * 3.1) + 1) * 0.4;
    }
    // falling autumn leaves (instanced): tumble down near the tree band, then loop
    if (this.fallingLeaves) {
      const n = this.leafBase.length / 4;
      for (let i = 0; i < n; i++) {
        const bx = this.leafBase[i * 4], bz = this.leafBase[i * 4 + 1], ph = this.leafBase[i * 4 + 2], sp = this.leafBase[i * 4 + 3];
        const f = (t * sp + ph) % 1;
        this._dummy.position.set(bx + Math.sin(t * 0.9 + ph * 7) * 0.9, 0.7 + (1 - f) * 5.5, bz + Math.cos(t * 0.7 + ph * 5) * 0.9);
        this._dummy.rotation.set(f * 9 + ph, ph * 3 + t * 2, f * 7);
        this._dummy.scale.setScalar(Math.max(0.001, Math.min(1, Math.sin(f * Math.PI) * 1.6)));
        this._dummy.updateMatrix();
        this.fallingLeaves.setMatrixAt(i, this._dummy.matrix);
      }
      this.fallingLeaves.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Reactive proximity highlights — pads bounce, and the nearest egg / gate
   * brightens & energizes when the player walks up. Called from main with the
   * live player position each island frame.
   */
  reactPads(playerPos: THREE.Vector3, dt: number) {
    const ease = Math.min(1, dt * 8);
    for (const p of this.pads) {
      const dx = p.pos.x - playerPos.x;
      const dz = p.pos.z - playerPos.z;
      const on = dx * dx + dz * dz < 2.2 * 2.2;
      p.lit += ((on ? 1 : 0) - p.lit) * ease;
      const s = 1 + p.lit * 0.18 + (on ? Math.sin(this.t * 8) * 0.04 : 0);
      p.group.scale.set(s, 1 + p.lit * 0.12, s);
      (p.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + p.lit * 1.6;
    }
    for (const e of this.eggs) {
      const on = e.pos.distanceToSquared(playerPos) < 1.9 * 1.9;
      e.lit += ((on ? 1 : 0) - e.lit) * ease;
    }
    for (const g of this.rooms) {
      const on = g.pos.distanceToSquared(playerPos) < 3.2 * 3.2;
      g.lit += ((on ? 1 : 0) - g.lit) * ease;
    }
  }

  // ========================================================================
  //  WORLD BUILDING
  // ========================================================================

  private buildGround() {
    const g = new THREE.Group();
    const grass = voxelMaterial(VOX.grass);
    const grassDark = voxelMaterial(VOX.grassDark);
    const grassLight = voxelMaterial(VOX.grassLight);
    const sand = voxelMaterial(0xe6d9a8);
    const TILE = 2.5; // slightly chunkier tiles keep the count sane on the bigger island
    const n = Math.ceil(ISLAND.half / TILE);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const x = ix * TILE;
        const z = iz * TILE;
        const r = Math.hypot(x, z);
        if (r > ISLAND.half) continue;
        const onSand = r > ISLAND.shore;
        // occasional sun-kissed highlight tile for a hand-placed, lively lawn
        let mat: THREE.Material;
        if (onSand) mat = sand;
        else if (rnd() < 0.1) mat = grassLight;
        else mat = (ix + iz) % 2 === 0 ? grass : grassDark;
        const h = onSand ? 0.6 : 1.0;
        const tile = new THREE.Mesh(new THREE.BoxGeometry(TILE, h, TILE), mat);
        tile.position.set(x, h / 2 - 0.5, z);
        tile.userData.noCast = true; // receives shadow, but kept out of the shadow map
        g.add(tile);
      }
    }
    this.group.add(g);
  }

  private buildWater() {
    const geo = new THREE.CircleGeometry(120, 48);
    const mat = new THREE.MeshStandardMaterial({
      color: VOX.water, transparent: true, opacity: 0.86, roughness: 0.3, metalness: 0.0,
    });
    const w = new THREE.Mesh(geo, mat);
    w.rotation.x = -Math.PI / 2;
    w.position.y = -0.35;
    this.water = w;
    this.group.add(w);

    // a handful of lily pads bobbing in the shallows
    const padMat = voxelMaterial(0x4f9e4a);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2;
      const r = ISLAND.shore + 1.5 + rnd() * 6;
      const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.7 + rnd() * 0.4, 0.7, 0.12, 7), padMat);
      lp.position.set(Math.cos(a) * r, -0.28, Math.sin(a) * r);
      this.lilies.push(lp);
      this.group.add(lp);
    }
  }

  private buildDecor() {
    const trunk = voxelMaterial(VOX.bark);
    const trunkDark = voxelMaterial(VOX.barkDark);
    const rock = voxelMaterial(VOX.rock);
    const tuft = voxelMaterial(VOX.grassLight);
    const flowers = [VOX.flowerPink, VOX.flowerYellow, VOX.flowerWhite, VOX.flowerRed];
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const tooClose = (x: number, z: number, pad: number) =>
      CLEAR_PTS.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < pad * pad);

    // autumn-mixed canopies (green / gold / amber / russet) like the reference —
    // each [main, lit-top, dark-underside] for shaded, sun-kissed crowns.
    const canopies: [number, number, number][] = [
      [VOX.leaf, VOX.leafLight, VOX.leafDark],
      [VOX.leaf, VOX.leafLight, VOX.leafDark],
      [0xe8a23c, 0xffc861, 0xb87a1f], // gold
      [0xd9762e, 0xf0a24a, 0xa9551c], // amber
      [0xc24a35, 0xe0734f, 0x923122], // russet
    ];
    const pines: [number, number][] = [[0x4f8a3a, 0x6fae4a], [0x3f7a4a, 0x5a9a5e]];

    const makeTree = (x: number, z: number) => {
      const tree = new THREE.Group();
      const conifer = rnd() < 0.3;
      const trunkMat = rnd() < 0.5 ? trunk : trunkDark;
      if (conifer) {
        // a stacked-tier pine: tapering green skirts up a slim trunk
        const [pMain, pTop] = pines[Math.floor(rnd() * pines.length)];
        const th = 1.2 + rnd() * 1.0;
        const tk = new THREE.Mesh(new THREE.BoxGeometry(0.4, th, 0.4), trunkMat);
        tk.position.y = th / 2;
        tree.add(tk);
        const tiers = 4 + Math.floor(rnd() * 2);
        for (let k = 0; k < tiers; k++) {
          const w = 2.3 - k * (1.8 / tiers);
          const tier = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, w), voxelMaterial(k === tiers - 1 ? pTop : pMain));
          tier.position.y = th + 0.2 + k * 0.62;
          tree.add(tier);
        }
      } else {
        // a leafy broadleaf: tapered trunk with root flares, an irregular bushy
        // crown (offset chunks, not a neat stack), a branch stub, + maybe blossoms
        const [cMain, cTop, cDark] = canopies[Math.floor(rnd() * canopies.length)];
        const main = voxelMaterial(cMain);
        const th = 2.2 + rnd() * 2.4;
        const tk = new THREE.Mesh(new THREE.BoxGeometry(0.65, th, 0.65), trunkMat);
        tk.position.y = th / 2;
        const tkTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), trunkMat);
        tkTop.position.y = th + 0.2;
        tree.add(tk, tkTop);
        // root flares at the base
        for (let r = 0; r < 4; r++) {
          const a = (r / 4) * Math.PI * 2;
          const root = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), trunkMat);
          root.position.set(Math.cos(a) * 0.4, 0.18, Math.sin(a) * 0.4);
          tree.add(root);
        }
        // a low branch stub
        if (rnd() < 0.6) {
          const br = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.24), trunkMat);
          const ba = rnd() * Math.PI * 2;
          br.position.set(Math.cos(ba) * 0.5, th * 0.62, Math.sin(ba) * 0.5);
          br.rotation.y = ba;
          tree.add(br);
        }
        // bushy crown: a darker base, offset mid clumps, and a lit top knob
        const cBase = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 2.6), voxelMaterial(cDark));
        cBase.position.y = th + 0.5;
        tree.add(cBase);
        for (let c = 0; c < 3; c++) {
          const s = 1.3 + rnd() * 0.9;
          const clump = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.85, s), main);
          clump.position.set((rnd() - 0.5) * 1.7, th + 1.2 + rnd() * 0.8, (rnd() - 0.5) * 1.7);
          tree.add(clump);
        }
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.0), voxelMaterial(cTop));
        top.position.y = th + 2.5;
        tree.add(top);
        // spring blossoms / berries dotted on the crown
        if (rnd() < 0.4) {
          const bcol = rnd() < 0.5 ? VOX.flowerPink : VOX.flowerWhite;
          for (let b = 0; b < 5; b++) {
            const bl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), glowMaterial(bcol, 0.35));
            bl.position.set((rnd() - 0.5) * 2.4, th + 1.0 + rnd() * 1.6, (rnd() - 0.5) * 2.4);
            tree.add(bl);
          }
        }
      }
      tree.position.set(x, 0, z);
      tree.rotation.y = rnd() * Math.PI;
      this.group.add(tree);
    };

    // OUTER RING — big trees + rock clusters ringing the village, well clear of
    // the play area. Sparser than before (bigger gaps) so it frames, not crowds.
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 26 + rnd() * (ISLAND.shore - 28);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (tooClose(x, z, 4) || inHubCorridor(x, z)) continue;
      if (rnd() < 0.8) {
        makeTree(x, z);
      } else {
        const cl = new THREE.Group();
        const cnt = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < cnt; k++) {
          const s = 0.6 + rnd() * 0.9;
          const rk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s), rock);
          rk.position.set((rnd() - 0.5) * 1.2, s * 0.35, (rnd() - 0.5) * 1.2);
          rk.rotation.y = rnd() * Math.PI;
          cl.add(rk);
        }
        cl.position.set(x, 0, z);
        this.group.add(cl);
      }
    }

    // INNER BAND — only LOW dressing (flowers, tufts, mushrooms, pebbles) in the
    // ring around the plaza + among the houses, skipping near any structure.
    for (let i = 0; i < 120; i++) {
      const a = rnd() * Math.PI * 2;
      const r = PLAZA_R + 1 + rnd() * 12; // 14 .. 26
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (tooClose(x, z, 4.2) || inHubCorridor(x, z)) continue;
      const roll = rnd();
      if (roll < 0.45) {
        const patch = new THREE.Group();
        const col = flowers[Math.floor(rnd() * flowers.length)];
        for (let k = 0; k < 3; k++) {
          const stem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), voxelMaterial(VOX.flowerStem));
          stem.position.set((rnd() - 0.5) * 0.8, 0.25, (rnd() - 0.5) * 0.8);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), glowMaterial(col, 0.4));
          head.position.set(stem.position.x, 0.58, stem.position.z);
          patch.add(stem, head);
        }
        patch.position.set(x, 0, z);
        this.group.add(patch);
      } else if (roll < 0.7) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), tuft);
        t.position.set(x, 0.2, z);
        t.scale.y = 0.6 + rnd();
        this.group.add(t);
      } else if (roll < 0.85) {
        const m = new THREE.Group();
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), voxelMaterial(VOX.mushroomStem));
        stem.position.y = 0.15;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.34), voxelMaterial(VOX.mushroomCap));
        cap.position.y = 0.36;
        m.add(stem, cap);
        m.position.set(x, 0, z);
        this.group.add(m);
      } else {
        const s = 0.3 + rnd() * 0.3;
        const peb = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), voxelMaterial(VOX.pebble));
        peb.position.set(x, s * 0.3, z);
        this.group.add(peb);
      }
    }
  }

  /** Big layered rock outcrops near the shore — a craggy skyline that frames the
   *  village like the cliffs in the reference (placed behind the tree band). */
  private buildBackdrop() {
    // A big inward-facing GRADIENT SKY DOME so the lobby reads as a warm dusk
    // bowl instead of a flat fill — peach at the horizon melting up to soft
    // lavender, dusky plum below. Vertex-colour gradient (no shader), unlit,
    // fog-exempt, drawn first behind everything.
    {
      const geo = new THREE.SphereGeometry(220, 24, 16);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      const cZen = new THREE.Color(0xcdb6e6), cHor = new THREE.Color(0xfbcd9a), cGnd = new THREE.Color(0xb89ab2);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const h = pos.getY(i) / 220; // -1 ground .. +1 zenith
        if (h >= 0) c.copy(cHor).lerp(cZen, Math.pow(h, 0.7));
        else c.copy(cHor).lerp(cGnd, Math.min(1, -h * 1.4));
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false }));
      dome.renderOrder = -10;
      dome.userData.noCast = true;
      this.group.add(dome);
    }

    const tones = [VOX.rock, VOX.rockDark, VOX.stone, VOX.stoneDark, 0x8a8d86];
    let seed = 24680;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const tone = () => voxelMaterial(tones[Math.floor(rnd() * tones.length)]);

    // One craggy peak: a stepped, jittered stack of stone blocks with mossy
    // ledges, a shadowed back face, scree at the foot, and a snow/grass cap.
    const makePeak = (cx: number, cz: number, scale: number, snowy: boolean) => {
      const peak = new THREE.Group();
      const layers = 4 + Math.floor(rnd() * 3);
      let w = (4 + rnd() * 4) * scale;
      let y = 0;
      for (let k = 0; k < layers; k++) {
        const h = (1.4 + rnd() * 2.0) * scale;
        const dep = w * (0.7 + rnd() * 0.5);
        const blk = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), tone());
        blk.position.set((rnd() - 0.5) * 1.6 * scale, y + h / 2, (rnd() - 0.5) * 1.6 * scale);
        blk.rotation.y = rnd() * 0.5;
        peak.add(blk);
        // a darker shadow slab tucked on the back/side for craggy depth
        if (rnd() < 0.7) {
          const sh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.8, dep * 0.5), voxelMaterial(VOX.rockDark));
          sh.position.set(blk.position.x - w * 0.3, y + h * 0.4, blk.position.z - dep * 0.3);
          peak.add(sh);
        }
        // a mossy/grass ledge on lower steps
        if (k < layers - 1 && rnd() < 0.55) {
          const moss = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.3 * scale, dep * 0.7), voxelMaterial(rnd() < 0.5 ? VOX.grass : VOX.grassDark));
          moss.position.set(blk.position.x + (rnd() - 0.5) * w * 0.3, y + h - 0.1, blk.position.z + (rnd() - 0.5) * dep * 0.3);
          peak.add(moss);
        }
        y += h * (0.66 + rnd() * 0.2);
        w *= 0.66 + rnd() * 0.13;
      }
      // stepped snow (or grass) cap — 2 decreasing blocks for a real summit
      const capCol = snowy ? 0xeef2f6 : VOX.grass;
      for (let c = 0; c < 2; c++) {
        const cw = (w + 0.6) * (1 - c * 0.4);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.6 * scale, cw), voxelMaterial(c === 0 ? capCol : (snowy ? 0xffffff : VOX.grassLight)));
        cap.position.y = y + 0.2 + c * 0.5 * scale;
        peak.add(cap);
      }
      // scree boulders scattered at the foot
      for (let b = 0; b < 3 + Math.floor(rnd() * 3); b++) {
        const s = (0.6 + rnd() * 1.1) * scale;
        const rk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s), tone());
        const ba = rnd() * Math.PI * 2;
        rk.position.set(Math.cos(ba) * (w + 2) * scale * 0.6, s * 0.35, Math.sin(ba) * (w + 2) * scale * 0.6);
        rk.rotation.y = rnd() * Math.PI;
        peak.add(rk);
      }
      peak.position.set(cx, 0, cz);
      return peak;
    };

    const count = 9;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const r = ISLAND.shore - 3 - rnd() * 4;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      // a main peak flanked by a smaller sister peak → a craggy multi-summit massif
      const big = rnd() < 0.5;
      const main = makePeak(cx, cz, big ? 1.25 : 1.0, big);
      this.group.add(main);
      if (rnd() < 0.6) {
        const off = 4 + rnd() * 3;
        const sa = a + (rnd() - 0.5) * 0.6;
        this.group.add(makePeak(cx + Math.cos(sa) * off, cz + Math.sin(sa) * off, 0.6, false));
      }
    }
  }

  private buildPlaza() {
    // A hand-laid stone town square: irregular multi-tone flagstones with tiny
    // height jitter (so it reads as real masonry, not a flat disc), set slightly
    // below the grass like inset paving — the cozy Hypixel courtyard.
    const tones = [VOX.cobble, VOX.cobbleDark, VOX.stone, VOX.stoneDark, 0x9bae84];
    const wts = [0.3, 0.26, 0.22, 0.14, 0.08]; // mossy (last) is rare
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pickTone = () => {
      let r = rnd();
      for (let i = 0; i < tones.length; i++) { r -= wts[i]; if (r < 0) return tones[i]; }
      return tones[0];
    };
    const R = PLAZA_R;
    const step = 1.5;
    const n = Math.ceil(R / step);
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const x = ix * step + (rnd() - 0.5) * 0.12;
        const z = iz * step + (rnd() - 0.5) * 0.12;
        if (Math.hypot(x, z) > R) continue;
        const h = 0.38 + rnd() * 0.08;
        const tile = new THREE.Mesh(new THREE.BoxGeometry(step * 0.96, h, step * 0.96), voxelMaterial(pickTone()));
        tile.position.set(x, h / 2 - 0.32, z);
        tile.rotation.y = (rnd() - 0.5) * 0.05;
        tile.userData.noCast = true; // paving receives shadow, doesn't cast
        this.group.add(tile);
      }
    }
    // a low stepped kerb ringing the square
    const kerb = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.18, 5, 44), voxelMaterial(VOX.stoneDark));
    kerb.rotation.x = Math.PI / 2;
    kerb.position.y = 0.16;
    this.group.add(kerb);
  }

  /**
   * The centerpiece: a grand three-tier fountain with cascading glowing basins,
   * arcing water jets, and a slowly-rotating crystal spire crowning the top.
   */
  private buildFountain() {
    const stone = voxelMaterial(VOX.stone);
    const stoneDark = voxelMaterial(VOX.stoneDark);

    // a wide base pool with a low carved rim, then stacked basins narrowing up
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.28, 6, 32), stoneDark);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.55;
    this.group.add(rim);
    // little kerb posts around the pool
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.4), stone);
      post.position.set(Math.cos(a) * 3.9, 0.35, Math.sin(a) * 3.9);
      this.group.add(post);
    }
    const tiers = [
      { r: 3.7, y: 0.35, h: 0.6 },
      { r: 2.4, y: 1.1, h: 0.7 },
      { r: 1.55, y: 1.9, h: 0.6 },
      { r: 0.95, y: 2.6, h: 0.5 },
    ];
    tiers.forEach((tr, i) => {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(tr.r, tr.r + 0.22, tr.h, 18), i % 2 ? stoneDark : stone);
      basin.position.y = tr.y;
      this.group.add(basin);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(tr.r - 0.2, tr.r - 0.2, 0.12, 18), this.fountainWaterMat());
      water.position.y = tr.y + tr.h / 2 + 0.02;
      this.fountainDiscs.push(water);
      this.group.add(water);
    });

    // crystal spire on top — a faceted glowing octahedron
    const spire = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), glowMaterial(0x9fe8ff, 1.2));
    (spire.geometry as THREE.BufferGeometry).scale(1, 1.7, 1);
    this.fountainSpireBaseY = 3.7;
    spire.position.y = this.fountainSpireBaseY;
    this.fountainSpire = spire;
    this.group.add(spire);

    // arcing water jets around the top basin (translucent rising shafts)
    const jetMat = () =>
      new THREE.MeshStandardMaterial({
        color: VOX.water, emissive: VOX.water, emissiveIntensity: 0.8,
        transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false,
      });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const jet = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.8, 0.14), jetMat());
      jet.position.set(Math.cos(a) * 1.7, 2.2, Math.sin(a) * 1.7);
      jet.userData.baseY = 2.2;
      this.fountainJets.push(jet);
      this.group.add(jet);
    }
  }
  private fountainSpireBaseY = 3.7;

  private fountainWaterMat() {
    return new THREE.MeshStandardMaterial({
      color: 0x6fd0ff, emissive: 0x3f9fe0, emissiveIntensity: 0.7,
      roughness: 0.3, transparent: true, opacity: 0.92, toneMapped: false,
    });
  }

  /** Build the utility pads (join + shop) just outside the plaza. */
  private buildZones() {
    for (const p of PADS) this.addPad(p.id, p.id, p.pos.clone(), p.color, p.label);
  }

  /**
   * Hub-and-spoke lobby: a floating platform for each game-mode satellite
   * (ZOMBIES / TOWER DEFENSE / COMING SOON), a plank bridge linking it to the
   * main island, and a big glowing title over each. The mode entries themselves
   * live on these platforms (gates → ZOMBIES, the TD podium → TOWER DEFENSE);
   * COMING SOON gets a locked monument + its own zone.
   */
  private buildSatellites() {
    for (const s of SATELLITES) {
      const cx = s.center.x, cz = s.center.z;
      // Same chunky voxel ground as the main island (checkered grass + sand rim)
      // so the satellites read as the SAME world, not flat discs.
      this.tileDisc(cx, cz, s.radius, s.color);
      this.buildBridge(s);

      // ---- big floating title over the platform ----
      const sign = makeSign(s.label, s.color);
      sign.position.set(cx, 7.4, cz);
      sign.scale.multiplyScalar(1.7);
      this.group.add(sign);

      // ---- COMING SOON: a wrapped, locked present + its own zone ----
      if (s.kind === "soon") {
        const box = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), voxelMaterial(0x6a5a8a));
        box.position.set(cx, 2.0, cz);
        const ribbonV = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.1, 3.1), glowMaterial(s.color, 0.8));
        ribbonV.position.set(cx, 2.0, cz);
        const ribbonH = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.1, 0.6), glowMaterial(s.color, 0.8));
        ribbonH.position.set(cx, 2.0, cz);
        const bow = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), glowMaterial(s.color, 1.2));
        bow.position.set(cx, 3.9, cz);
        this.group.add(box, ribbonV, ribbonH, bow);
        this.zones.push({ id: "soon", kind: "soon", pos: new THREE.Vector3(cx, 0, cz), radius: 3.0, label: "Coming Soon" });
      }
    }
  }

  /** A floating voxel island disc at (cx,cz): the SAME checkered grass + sand-rim
   *  tiles as the main island, on a tapering rock underbelly + a glow rim. */
  private tileDisc(cx: number, cz: number, R: number, rimColor: number) {
    const grass = voxelMaterial(VOX.grass);
    const grassDark = voxelMaterial(VOX.grassDark);
    const grassLight = voxelMaterial(VOX.grassLight);
    const sand = voxelMaterial(0xe6d9a8);
    const TILE = 2.5;
    const n = Math.ceil(R / TILE);
    let seed = (Math.floor(Math.abs(cx) * 7 + Math.abs(cz) * 13) % 9999) + 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const lx = ix * TILE, lz = iz * TILE;
        if (Math.hypot(lx, lz) > R) continue;
        const onSand = Math.hypot(lx, lz) > R - 3;
        let mat: THREE.Material;
        if (onSand) mat = sand;
        else if (rnd() < 0.1) mat = grassLight;
        else mat = (ix + iz) % 2 === 0 ? grass : grassDark;
        const h = onSand ? 0.6 : 1.0;
        const tile = new THREE.Mesh(new THREE.BoxGeometry(TILE, h, TILE), mat);
        tile.position.set(cx + lx, h / 2 - 0.5, cz + lz);
        tile.userData.noCast = true;
        this.group.add(tile);
      }
    }
    // tapering rock underbelly so it reads as a floating chunk of land
    const rock = voxelMaterial(VOX.stone);
    const rockDark = voxelMaterial(VOX.stoneDark);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(R, R - 1.5, 1.8, 18), rock);
    lip.position.set(cx, -1.2, cz);
    const root = new THREE.Mesh(new THREE.CylinderGeometry(R - 2, 1.4, 8, 14), rockDark);
    root.position.set(cx, -5.0, cz);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.4, 0.16, 6, 44), glowMaterial(rimColor, 0.7));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(cx, 0.55, cz);
    this.group.add(lip, root, rim);
  }

  /** A proper wooden bridge to a satellite: flat planks (you walk at y0) flanked
   *  by railings + lantern posts, support pillars dropping into the void, and a
   *  glowing gateway arch at each end. */
  private buildBridge(s: { center: { x: number; z: number }; radius: number; color: number }) {
    const cx = s.center.x, cz = s.center.z;
    const plankA = voxelMaterial(0x8a5a32);
    const plankB = voxelMaterial(0x6f4626);
    const wood = voxelMaterial(0x5c3c24);
    const d = Math.hypot(cx, cz) || 1;
    const dir = { x: cx / d, z: cz / d };
    const perp = { x: -dir.z, z: dir.x };
    const ang = Math.atan2(dir.x, dir.z);
    const PY = 0.45;                       // plank top ≈ 0.56, just above the lawn
    const start = ISLAND.half - 4;         // anchor at the island's very rim
    const end = d - s.radius + 1;          // land on the platform lip (spans the void between)
    const at = (r: number, off: number, y: number) => new THREE.Vector3(dir.x * r + perp.x * off, y, dir.z * r + perp.z * off);

    let row = 0;
    for (let r = start; r <= end; r += 1.6, row++) {
      // deck: three planks across
      for (const off of [-1.5, 0, 1.5]) {
        const tile = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 1.7), row % 2 ? plankA : plankB);
        tile.position.copy(at(r, off, PY));
        tile.rotation.y = ang;
        tile.userData.noCast = true;
        this.group.add(tile);
      }
      // continuous DOUBLE side rails each side (top + mid beam) for a fuller fence
      for (const side of [-1, 1]) {
        for (const ry of [PY + 1.1, PY + 0.55]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.7), wood);
          rail.position.copy(at(r, side * 2.2, ry));
          rail.rotation.y = ang;
          this.group.add(rail);
        }
      }
      // rail posts every other row (no lanterns here — they live on the arches)
      if (row % 2 === 0) {
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 0.2), wood);
          post.position.copy(at(r, side * 2.2, PY + 0.6));
          this.group.add(post);
        }
      }
      // support pillars dropping into the void at a couple of spans
      if (row % 4 === 2) {
        for (const side of [-1, 1]) {
          const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 0.4), wood);
          pillar.position.copy(at(r, side * 1.7, PY - 4.4));
          this.group.add(pillar);
        }
      }
    }

    // glowing gateway arch at each end (torii-style frame, high enough to walk under)
    for (const r of [start, end]) {
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, 4.2, 0.45), wood);
        leg.position.copy(at(r, side * 2.4, PY + 2.1));
        this.group.add(leg);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5.6), glowMaterial(s.color, 0.8));
      top.position.copy(at(r, 0, PY + 4.0));
      top.rotation.y = ang;
      this.group.add(top);
    }
  }

  /** A SHORT cobblestone approach leading up to each satellite bridge, riding on
   *  top of the lawn. Grey checkered cobble (not dirt) so it reads as a path. */
  private buildHubPaths() {
    const cobble = voxelMaterial(VOX.stone);
    const cobbleDark = voxelMaterial(VOX.stoneDark);
    for (const s of SATELLITES) {
      const d = Math.hypot(s.center.x, s.center.z) || 1;
      const dir = { x: s.center.x / d, z: s.center.z / d };
      const perp = { x: -dir.z, z: dir.x };
      const ang = Math.atan2(dir.x, dir.z);
      const start = ISLAND.half - 12; // a short run up to the bridge mouth
      const end = ISLAND.half - 3;
      let row = 0;
      for (let r = start; r <= end; r += 1.4, row++) {
        for (const off of [-1.4, 0, 1.4]) {
          const tile = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 1.4), (row + (off > 0 ? 1 : 0)) % 2 ? cobble : cobbleDark);
          tile.position.set(dir.x * r + perp.x * off, 0.5, dir.z * r + perp.z * off);
          tile.rotation.y = ang;
          tile.userData.noCast = true;
          this.group.add(tile);
        }
      }
    }
  }

  private addPad(id: string, kind: IslandZone["kind"], pos: THREE.Vector3, color: number, label: string) {
    const pad = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.2, 24), glowMaterial(color, 0.9));
    ring.position.y = 0.12;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.24, 24), glowMaterial(color, 0.45));
    inner.position.y = 0.13;
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), glowMaterial(color, 1.0));
    beacon.position.y = 1.4;
    // a small floating icon-cube crowning the beacon
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), glowMaterial(color, 1.2));
    cap.position.y = 2.9;
    this.beacons.push(beacon, cap);
    pad.add(ring, inner, beacon, cap);
    pad.position.copy(pos);
    this.group.add(pad);
    this.pads.push({ id, group: pad, ring, pos: pos.clone(), lit: 0 });
    this.zones.push({ id, kind, pos: pos.clone(), radius: 2.2, label });
  }

  /**
   * The three co-op ROOMS — Solo / Duo / Squad — open-top stone enclosures you
   * walk into (the iso camera sees over the walls). Each has a glowing tier-
   * coloured floor rune, a doorway facing the plaza flanked by torches + banners,
   * battlements, a sign plaque, and bobbing party-size figures inside. Standing
   * inside pools players for the gather (count shown on the HUD); walk out to
   * cancel. Bigger + grander per tier so the party size reads at a glance.
   */
  private buildModes() {
    for (const m of GATES) {
      const g = new THREE.Group();
      const interior = 3.2 + m.grand * 1.1; // floor span (solo→squad)
      const half = interior / 2;
      const h = 2.2 + m.grand * 0.35; // wall height
      const wt = 0.4; // wall thickness
      const doorGap = 1.9;
      const stone = voxelMaterial(VOX.stone);
      const stoneDark = voxelMaterial(VOX.stoneDark);
      const trim = glowMaterial(m.color, 0.5);
      const outer = interior + 0.8;

      // ---- floor: tinted slab + a glowing rune you stand on ----
      const slab = new THREE.Mesh(new THREE.BoxGeometry(outer, 0.2, outer), stoneDark);
      slab.position.y = 0.0;
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(half + 0.1, half + 0.1, 0.12, 24), glowMaterial(m.color, 0.7));
      floor.position.y = 0.12;
      const rune = new THREE.Mesh(new THREE.TorusGeometry(half - 0.3, 0.08, 6, 28), glowMaterial(m.color, 0.9));
      rune.rotation.x = Math.PI / 2;
      rune.position.y = 0.2;
      g.add(slab, floor, rune);

      // ---- walls (open top): back + sides solid, front split for a doorway ----
      const wallWithTrim = (w: number, d: number, x: number, z: number) => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone);
        wall.position.set(x, h / 2 + 0.1, z);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.18, d + 0.05), trim);
        cap.position.set(x, h + 0.1, z);
        g.add(wall, cap);
      };
      wallWithTrim(outer, wt, 0, -half - wt / 2); // back (-z)
      wallWithTrim(wt, outer, -half - wt / 2, 0); // left
      wallWithTrim(wt, outer, half + wt / 2, 0); // right
      // front (+z): two segments leaving a central doorway
      const segW = (outer - doorGap) / 2;
      for (const sx of [-1, 1]) {
        wallWithTrim(segW, wt, sx * (doorGap / 2 + segW / 2), half + wt / 2);
      }
      // doorway header + a glowing sign plaque over it
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorGap + 0.5, 0.4, wt + 0.1), stoneDark);
      lintel.position.set(0, h - 0.1, half + wt / 2);
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.12), glowMaterial(m.color, 1.0));
      plaque.position.set(0, h + 0.35, half + wt / 2 + 0.06);
      g.add(lintel, plaque);
      // corner posts + battlement merlons along the back wall
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(wt + 0.2, h + 0.3, wt + 0.2), stoneDark);
        post.position.set(sx * (half + wt / 2), (h + 0.3) / 2 + 0.1, sz * (half + wt / 2));
        g.add(post);
      }
      const merlonN = 3 + m.grand;
      for (let i = 0; i < merlonN; i++) {
        const mer = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, wt + 0.1), stone);
        mer.position.set(-half + 0.4 + (i / (merlonN - 1)) * (outer - 0.8), h + 0.35, -half - wt / 2);
        g.add(mer);
      }

      // ---- torches flanking the doorway + banners on the front wall ----
      for (const sx of [-1, 1]) {
        const { group: tg, flame } = this.makeTorch(0xffa53a);
        tg.position.set(sx * (doorGap / 2 + 0.4), 0.1, half + wt / 2 + 0.2);
        g.add(tg);
        this.flames.push(flame);
        const banner = this.makeBanner(m.color, h);
        banner.group.position.set(sx * (half - 0.3), h - 0.2, half + wt / 2 + 0.08);
        g.add(banner.group);
        this.banners.push(banner.rec);
      }
      // a warm lantern on each front corner post
      for (const sx of [-1, 1]) {
        const lan = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), glowMaterial(VOX.lantern, 1.2));
        lan.position.set(sx * (half + wt / 2), h + 0.1, half + wt / 2);
        g.add(lan);
        this.beacons.push(lan);
      }

      // ---- bobbing party-size figures standing on the floor inside ----
      const figures: THREE.Object3D[] = [];
      for (let i = 0; i < m.players; i++) {
        const a = m.players === 1 ? 0 : (i / m.players) * Math.PI * 2;
        const rr = m.players === 1 ? 0 : half * 0.42;
        const fig = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.55, 0.34), glowMaterial(m.color, 1.0));
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), glowMaterial(0xfff2d6, 0.6));
        head.position.y = 0.42;
        fig.add(body, head);
        fig.position.set(Math.cos(a) * rr, 0.5, Math.sin(a) * rr - half * 0.2);
        figures.push(fig);
        g.add(fig);
      }

      // ---- swirling portal surface set into the doorway — walk through to enter ----
      const portalH = h - 0.5;
      const portal = this.makePortalSurface(m.color, doorGap - 0.15, portalH);
      portal.position.set(0, portalH / 2 + 0.25, half + wt / 2 + 0.05);
      g.add(portal);

      g.position.copy(m.pos);
      g.rotation.y = Math.atan2(-m.pos.x, -m.pos.z); // doorway (+z) faces the plaza
      this.group.add(g);
      this.rooms.push({ group: g, floor, rune, figures, pos: m.pos.clone(), color: m.color, lit: 0 });
      this.zones.push({ id: m.id, kind: "mode", pos: m.pos.clone(), radius: half + 0.6, label: m.label, modePlayers: m.players });
    }
  }

  /** A flickering torch: post + bowl + glowing flame. Returns the flame record. */
  private makeTorch(flameColor: number): { group: THREE.Group; flame: Flame } {
    const group = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.8, 0.22), voxelMaterial(VOX.bark));
    post.position.y = 0.9;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.18, 0.3, 8), voxelMaterial(VOX.steelDark));
    bowl.position.y = 1.85;
    const flameMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), glowMaterial(flameColor, 1.5));
    flameMesh.position.y = 2.15;
    (flameMesh.geometry as THREE.BufferGeometry).scale(1, 1.5, 1);
    group.add(post, bowl, flameMesh);
    return { group, flame: { mesh: flameMesh, phase: Math.random() * 6.28, base: 1 } };
  }

  /** Procedural spiral-disc texture for portal surfaces: a bright core fading to
   *  transparent at the rim, with a few swirling arms so the disc reads as a
   *  spinning vortex when the plane rotates. Alpha-faded edges hide the square. */
  private swirlTexture(color: number): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    const cx = 64, cy = 64;
    const hex = "#" + color.toString(16).padStart(6, "0");
    const grad = x.createRadialGradient(cx, cy, 3, cx, cy, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.98)");
    grad.addColorStop(0.3, hex);
    grad.addColorStop(0.75, hex);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    x.globalCompositeOperation = "source-over";
    x.fillStyle = grad;
    x.beginPath();
    x.arc(cx, cy, 64, 0, Math.PI * 2);
    x.fill();
    // bright swirl arms spiralling out from the core
    x.strokeStyle = "rgba(255,255,255,0.55)";
    x.lineCap = "round";
    for (let a = 0; a < 3; a++) {
      x.lineWidth = 3;
      x.beginPath();
      for (let r = 5; r < 60; r += 1.5) {
        const ang = a * (Math.PI * 2 / 3) + r * 0.13;
        const px = cx + Math.cos(ang) * r;
        const py = cy + Math.sin(ang) * r;
        if (r === 5) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 2;
    return t;
  }

  /** A self-contained swirling portal surface (spiral disc + halo + rim + rising
   *  sparks), sized to fit a gateway of width `w` × height `h`. Faces +z. The
   *  caller positions/rotates the returned group into the structure. */
  private makePortalSurface(color: number, w: number, h: number): THREE.Group {
    const g = new THREE.Group();
    const tex = this.swirlTexture(color);
    const surfMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.92, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(w, h), surfMat);
    // a larger, fainter halo behind it for depth + glow spill
    const hazeMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.32, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.35, h * 1.35), hazeMat);
    haze.position.z = -0.06;
    // glowing rim torus framing the vortex (oval to match the gateway)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(Math.min(w, h) * 0.52, 0.1, 8, 32),
      glowMaterial(color, 1.2),
    );
    ring.scale.set(w / Math.min(w, h), h / Math.min(w, h), 1);
    // rising sparks drifting up across the surface
    const motes = new THREE.Group();
    const sparkMat = glowMaterial(0xffffff, 1.6);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), sparkMat);
      s.position.set((Math.random() - 0.5) * w * 0.8, (Math.random() - 0.5) * h * 0.8, 0.05);
      s.userData.phase = Math.random() * 6.28;
      s.userData.span = h * 0.9;
      s.userData.baseY = s.position.y;
      motes.add(s);
    }
    g.add(haze, surf, ring, motes);
    this.portals.push({ surf, haze, ring, motes, color, phase: Math.random() * 6.28 });
    return g;
  }

  /** A hanging cloth banner that ripples; returns the group + animation record. */
  private makeBanner(color: number, height: number): { group: THREE.Group; rec: Banner } {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), voxelMaterial(VOX.steelDark));
    pole.position.y = 0.2;
    group.add(pole);
    const segs: THREE.Mesh[] = [];
    const segN = 4;
    const clothMat = glowMaterial(color, 0.5);
    for (let i = 0; i < segN; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.06), clothMat);
      seg.position.y = -0.2 - i * 0.42;
      group.add(seg);
      segs.push(seg);
    }
    // accent emblem in the middle
    const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.08), glowMaterial(0xfff2d6, 0.8));
    emblem.position.set(0, -0.62, 0.04);
    group.add(emblem);
    void height;
    return { group, rec: { segs, phase: Math.random() * 6.28 } };
  }

  /**
   * The five egg shrines ringing the fountain. Each is a tiered pedestal topped
   * by a faceted, glowing gem-egg that bobs and wobbles inside a breathing aura,
   * crowned by a rising light shaft and orbited by sparkles. Tiers are visually
   * graded — pricier eggs glow brighter and carry more sparkles — so value reads
   * at a glance. Pure visuals; hatching is handled in main via the gacha module.
   */
  private buildEggs(eggDefs = DEFAULT_EGG_VISUALS) {
    const ringR = EGG_R;
    eggDefs.forEach((e, i) => {
      const a = (i / eggDefs.length) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * ringR;
      const z = Math.sin(a) * ringR;
      const pos = new THREE.Vector3(x, 0, z);
      const g = new THREE.Group();

      // --- tiered pedestal (chunky voxel stone with a tier-colored gem inset) ---
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 0.5, 8), voxelMaterial(VOX.stone));
      base.position.y = 0.25;
      const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.72, 0.7, 8), voxelMaterial(VOX.stoneDark));
      mid.position.y = 0.85;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.64, 0.26, 8), voxelMaterial(VOX.stone));
      top.position.y = 1.33;
      g.add(base, mid, top);
      // gem insets on the pedestal (front + back) so it glows from any angle
      for (const gz of [0.62, -0.62]) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), glowMaterial(e.color, 1.2));
        gem.position.set(0, 0.85, gz);
        g.add(gem);
      }
      // glowing disc on top the egg floats above
      const ringGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.09, 16), glowMaterial(e.color, 0.9));
      ringGlow.position.y = 1.48;
      g.add(ringGlow);

      // --- the egg: a big faceted, gem-like ovoid (flat-shaded catches light) ---
      const eggGeo = new THREE.IcosahedronGeometry(0.66, 1);
      eggGeo.scale(1, 1.34, 1);
      const egg = new THREE.Mesh(eggGeo, glowMaterial(e.color, 1.3));
      egg.position.y = 2.05;
      // speckle pattern: bright accent cubes banded around the shell
      const speckN = 6;
      for (let s = 0; s < speckN; s++) {
        const sa = (s / speckN) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), glowMaterial(0xfff6e0, 1.0));
        sp.position.set(Math.cos(sa) * 0.48, 0.06 + (s % 2) * 0.3, Math.sin(sa) * 0.48);
        egg.add(sp);
      }
      g.add(egg);

      // --- breathing aura shell ---
      const aura = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), auraMaterial(e.color, 0.6));
      (aura.geometry as THREE.BufferGeometry).scale(1, 1.32, 1);
      aura.position.y = 2.05;
      g.add(aura);

      // --- rising light shaft ---
      const beam = new THREE.Mesh(
        // narrow at the egg, flaring upward — a shaft of rising magic
        new THREE.CylinderGeometry(0.55, 0.16, 2.8, 8, 1, true),
        new THREE.MeshStandardMaterial({
          color: e.color, emissive: e.color, emissiveIntensity: 1.0,
          transparent: true, opacity: 0.12, depthWrite: false,
          side: THREE.DoubleSide, toneMapped: false,
        }),
      );
      beam.position.y = 3.3;
      g.add(beam);

      // --- orbiting sparkles (more on richer tiers) ---
      const orbit = new THREE.Group();
      const sparkN = 3 + i; // common 3 → mythic 7
      for (let s = 0; s < sparkN; s++) {
        const sa = (s / sparkN) * Math.PI * 2;
        const rr = 0.92;
        const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), glowMaterial(0xffffff, 1.3));
        spark.position.set(Math.cos(sa) * rr, (s % 2 ? 0.2 : -0.15), Math.sin(sa) * rr);
        orbit.add(spark);
      }
      orbit.position.y = 2.05;
      g.add(orbit);

      g.position.copy(pos);
      this.group.add(g);
      this.eggs.push({ id: e.id, group: g, egg, aura, orbit, beam, ringGlow, pos: pos.clone(), phase: i * 1.3, color: e.color, lit: 0 });
      this.zones.push({ id: e.id, kind: "egg", pos: pos.clone(), radius: 1.9, label: e.label, eggId: e.id });
    });
  }

  /**
   * The Pet Sanctuary — a little hexagonal pavilion where you walk up to equip
   * your squad (opens the Pets shop tab) and show them off. A stone podium under
   * six timber posts holding a canopy, crowned by a spinning glowing orb with
   * hearts orbiting it. Your equipped pets float around you in the hub already,
   * so this is the "manage + flex" spot.
   */
  private buildSanctuary() {
    const g = new THREE.Group();
    const stone = voxelMaterial(VOX.stone);
    const wood = voxelMaterial(VOX.bark);
    // raised stone podium + a step ring
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.45, 6), stone);
    podium.position.y = 0.22;
    const stepRing = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.22, 6), voxelMaterial(VOX.stoneDark));
    stepRing.position.y = 0.11;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.08, 6), glowMaterial(0xff9ec7, 0.5));
    floor.position.y = 0.46;
    g.add(stepRing, podium, floor);
    // six posts + a canopy roof + finial
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.26, 3.0, 0.26), wood);
      post.position.set(Math.cos(a) * 2.0, 1.95, Math.sin(a) * 2.0);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.4, 6), voxelMaterial(VOX.roofPurple));
    roof.position.y = 4.1;
    roof.rotation.y = Math.PI / 6;
    const roofTrim = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.2, 6), voxelMaterial(VOX.woodTrim));
    roofTrim.position.y = 3.5;
    g.add(roof, roofTrim);
    // central pedestal + spinning glowing orb (the flex centerpiece)
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.0, 8), stone);
    ped.position.y = 0.96;
    g.add(ped);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), glowMaterial(0xff7ab0, 1.2));
    orb.position.y = 2.0;
    this.sanctuaryOrb = orb;
    g.add(orb);
    // little hearts orbiting the orb
    const hearts = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const heart = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), glowMaterial(0xff9ec7, 1.2));
      heart.position.set(Math.cos(a) * 0.95, (i % 2 ? 0.15 : -0.1), Math.sin(a) * 0.95);
      hearts.add(heart);
    }
    hearts.position.y = 2.0;
    this.sanctuaryHearts = hearts;
    g.add(hearts);

    g.position.copy(SANCTUARY);
    g.rotation.y = Math.atan2(-SANCTUARY.x, -SANCTUARY.z); // face the plaza
    this.group.add(g);
    this.zones.push({ id: "pets", kind: "pets", pos: SANCTUARY.clone(), radius: 2.5, label: "Pet Sanctuary — equip & flex your pets" });
  }

  /** A giant leaderboard billboard floating in the sky behind the village. It's
   *  fog-immune (so the warm haze doesn't wash it out) and glows; the face is a
   *  canvas sprite redrawn by main via setLeaderboard(). */
  private buildLeaderboard() {
    const noFog = (m: THREE.MeshStandardMaterial) => { m.fog = false; return m; };
    const g = new THREE.Group();
    const W = 13, H = 8;
    // backing panel + dark inset + a glowing frame, all immune to the warm fog
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.5), noFog(voxelMaterial(VOX.woodTrim)));
    g.add(back);
    for (const [w, h, x, y] of [[W + 0.6, 0.5, 0, H / 2], [W + 0.6, 0.5, 0, -H / 2], [0.5, H + 0.6, -W / 2, 0], [0.5, H + 0.6, W / 2, 0]] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.7), noFog(glowMaterial(VOX.lantern, 1.1)));
      bar.position.set(x, y, 0.1);
      g.add(bar);
    }
    // a couple of glowing finials on top
    for (const fx of [-W / 2, W / 2]) {
      const fin = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), noFog(glowMaterial(0xffd24a, 1.3)));
      fin.position.set(fx, H / 2 + 0.7, 0.1);
      g.add(fin);
    }
    // canvas-sprite face (hi-res for big crisp text; fog disabled)
    this.lbCanvas = document.createElement("canvas");
    this.lbCanvas.width = 512;
    this.lbCanvas.height = 320;
    this.lbTex = new THREE.CanvasTexture(this.lbCanvas);
    this.lbTex.colorSpace = THREE.SRGBColorSpace;
    this.lbTex.generateMipmaps = false;
    this.lbTex.minFilter = THREE.LinearFilter;
    const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.lbTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    face.scale.set(W - 1.0, H - 1.0, 1);
    face.position.set(0, 0, 0.4);
    face.renderOrder = 5; // draw the face over the panel
    g.add(face);
    this.setLeaderboard([]);
    // float it high in the sky at the back of the map, facing the plaza (+z)
    g.position.set(0, 15, -32);
    this.group.add(g);
  }

  /** Show/hide the daily chest's "claim me" glow (dim once claimed today). */
  setDailyReady(ready: boolean) {
    if (this.chestGlow) this.chestGlow.visible = ready;
  }

  /** Redraw the leaderboard face with the current top survivors. */
  setLeaderboard(entries: { name: string; best: number }[]) {
    if (!this.lbCanvas || !this.lbTex) return;
    const W = this.lbCanvas.width, H = this.lbCanvas.height;
    const g = this.lbCanvas.getContext("2d")!;
    g.clearRect(0, 0, W, H);
    // self-contained dark "screen" so the face reads over the wooden panel
    g.fillStyle = "rgba(26, 18, 12, 0.92)";
    g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 44px system-ui, sans-serif";
    g.fillStyle = "#ffd24a";
    g.fillText("🏆 TOP SURVIVORS", W / 2, 38);
    g.font = "bold 32px system-ui, sans-serif";
    const top = entries.filter((e) => e.best > 0).sort((a, b) => b.best - a.best).slice(0, 5);
    if (!top.length) {
      g.fillStyle = "#e8dcc8";
      g.fillText("No runs yet — go make a mess!", W / 2, H / 2 + 10);
    } else {
      top.forEach((e, i) => {
        const y = 100 + i * 44;
        g.fillStyle = ["#ffd24a", "#cfe0ff", "#e0b070", "#ffffff", "#ffffff"][i] ?? "#fff";
        const nm = e.name.length > 14 ? e.name.slice(0, 13) + "…" : e.name;
        g.textAlign = "left";
        g.fillText(`${i + 1}. ${nm}`, 30, y);
        g.textAlign = "right";
        g.fillText(`R${e.best}`, W - 30, y);
      });
    }
    this.lbTex.needsUpdate = true;
  }

  /** Floating nameplate signs above every interactive structure so players can
   *  spot the Shop / Sanctuary / rooms / attractions at a glance. */
  private buildSigns() {
    const info: Record<string, { text: string; color: number; h: number }> = {
      daily: { text: "DAILY CHEST", color: 0xffd24a, h: 3.6 },
      index: { text: "COLLECTION", color: 0x6ad7ff, h: 5.6 },
      wheel: { text: "FORTUNE WHEEL", color: 0xff9ec7, h: 6.4 },
      wardrobe: { text: "WARDROBE", color: 0xc792ea, h: 4.6 },
      td: { text: "TOWER DEFENSE", color: 0x7fd4ff, h: 4.6 },
      pets: { text: "PET SANCTUARY", color: 0xff7ab0, h: 5.6 },
      shop: { text: "SHOP", color: 0xffd24a, h: 3.8 },
      join: { text: "JOIN FRIEND", color: 0x6ad7ff, h: 3.8 },
    };
    for (const z of this.zones) {
      let text = "", color = 0xffffff, h = 4.2;
      if (z.kind === "mode") {
        text = z.modePlayers === 4 ? "SQUAD" : z.modePlayers === 2 ? "DUO" : "SOLO";
        color = z.modePlayers === 4 ? 0xff5a3a : z.modePlayers === 2 ? 0x6ad7ff : 0x7be08a;
        h = 4.4 + (z.modePlayers === 4 ? 0.8 : z.modePlayers === 2 ? 0.4 : 0);
      } else if (info[z.kind]) {
        ({ text, color, h } = info[z.kind]);
      } else {
        continue; // eggs are self-evident glowing shrines — no sign
      }
      const sign = makeSign(text, color);
      sign.position.set(z.pos.x, h, z.pos.z);
      sign.scale.multiplyScalar(1.9); // ~2× so the zone labels are readable from the hub framing
      this.group.add(sign);
      // Duo & Squad are temporarily disabled → a small "COMING SOON" tag underneath.
      if (z.kind === "mode" && (z.modePlayers ?? 1) >= 2) {
        const soon = makeSign("COMING SOON", 0xffd24a);
        soon.position.set(z.pos.x, h - 1.3, z.pos.z);
        soon.scale.multiplyScalar(1.25);
        this.group.add(soon);
      }
    }
  }

  /** Lobby attractions: a daily reward chest, a pet-collection board, and a
   *  spinning fortune wheel — each a walk-up zone handled by main. */
  private buildAttractions() {
    // ---- daily reward chest (front-left) ----
    {
      const c = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.9), voxelMaterial(VOX.crate));
      base.position.y = 0.4;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.4, 0.94), voxelMaterial(VOX.crateDark));
      lid.position.y = 0.95;
      for (const bx of [-0.6, 0.6]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 0.96), glowMaterial(VOX.lantern, 0.7));
        band.position.set(bx, 0.55, 0);
        c.add(band);
      }
      const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.16), glowMaterial(VOX.lantern, 1.0));
      clasp.position.set(0, 0.75, 0.48);
      const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), glowMaterial(0xffe14a, 1.3));
      glow.position.y = 1.7;
      this.chestGlow = glow;
      c.add(base, lid, clasp, glow);
      c.position.set(-2.5, 0, 9.8);
      c.scale.setScalar(1.7); // bigger so it's an obvious landmark
      this.group.add(c);
      this.zones.push({ id: "daily", kind: "daily", pos: new THREE.Vector3(-2.5, 0, 9.8), radius: 2.3, label: "Daily Reward Chest" });
    }
    // ---- pet collection board (left side) ----
    {
      const b = new THREE.Group();
      for (const px of [-1.0, 1.0]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), voxelMaterial(VOX.bark));
        post.position.set(px, 1.3, 0);
        b.add(post);
      }
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.16), voxelMaterial(VOX.houseWall));
      board.position.y = 2.4;
      const icon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.12), glowMaterial(0x6ad7ff, 0.9));
      icon.position.set(0, 2.4, 0.12);
      b.add(board, icon);
      const pos = new THREE.Vector3(-9, 0, 3);
      b.position.copy(pos);
      b.rotation.y = Math.atan2(-pos.x, -pos.z);
      b.scale.setScalar(1.5);
      this.group.add(b);
      this.zones.push({ id: "index", kind: "index", pos, radius: 2.6, label: "Pet Collection" });
    }
    // ---- fortune wheel (right side, near the eggs) ----
    {
      const w = new THREE.Group();
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.2, 0.4), voxelMaterial(VOX.bark));
      stand.position.y = 1.1;
      w.add(stand);
      const wheel = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.24, 24), voxelMaterial(VOX.woodTrim));
      disc.rotation.x = Math.PI / 2;
      wheel.add(disc);
      const segCols = [0xff5a7a, 0xffd24a, 0x6ad7ff, 0x7be08a, 0xc792ea, 0xff9ec7];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.3), glowMaterial(segCols[i % segCols.length], 0.8));
        wedge.position.set(Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0.1);
        wheel.add(wedge);
      }
      const hub = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glowMaterial(0xffe14a, 1.2));
      hub.position.z = 0.16;
      wheel.add(hub);
      wheel.position.y = 2.5;
      this.wheelMesh = wheel as unknown as THREE.Mesh;
      w.add(wheel);
      // a pointer at the top
      const ptr = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 4), glowMaterial(0xffffff, 1.0));
      ptr.position.set(0, 3.95, 0.18);
      ptr.rotation.x = Math.PI;
      w.add(ptr);
      const pos = new THREE.Vector3(9, 0, 4);
      w.position.copy(pos);
      w.rotation.y = Math.atan2(-pos.x, -pos.z);
      w.scale.setScalar(1.5);
      this.group.add(w);
      this.zones.push({ id: "wheel", kind: "wheel", pos, radius: 2.6, label: "Fortune Wheel" });
    }
    // ---- wardrobe mannequin (left side) ----
    {
      const g = new THREE.Group();
      const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.4, 12), voxelMaterial(VOX.stone));
      podium.position.y = 0.2;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.1, 16), glowMaterial(0xc792ea, 0.7));
      ring.position.y = 0.42;
      g.add(podium, ring);
      // a slowly-rotating mannequin (the "hero" silhouette) to flaunt skins
      const dummy = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.5), glowMaterial(0x6e4a9e, 0.5));
      body.position.y = 1.1;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), glowMaterial(0xffd6f4, 0.4));
      head.position.y = 1.95;
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), voxelMaterial(VOX.steelDark));
      stand.position.y = 0.55;
      dummy.add(stand, body, head);
      this.wardrobeMannequin = dummy as unknown as THREE.Mesh;
      g.add(dummy);
      // two coat-rack posts with a crossbar + hanging "garments"
      for (const px of [-1.5, 1.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.14), voxelMaterial(VOX.bark));
        post.position.set(px, 1.2, -0.4);
        g.add(post);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), voxelMaterial(VOX.bark));
      bar.position.set(0, 2.35, -0.4);
      g.add(bar);
      const gcols = [0xb23a3a, 0x4aa6d6, 0x7ad14a, 0xffcf52];
      gcols.forEach((col, i) => {
        const garment = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.12), glowMaterial(col, 0.4));
        garment.position.set(-1.1 + i * 0.73, 1.75, -0.4);
        g.add(garment);
      });
      const pos = new THREE.Vector3(-12, 0, -1);
      g.position.copy(pos);
      g.rotation.y = Math.atan2(-pos.x, -pos.z);
      g.scale.setScalar(1.3);
      this.group.add(g);
      this.zones.push({ id: "wardrobe", kind: "wardrobe", pos, radius: 2.4, label: "Wardrobe" });
    }
    // ---- BED WARS: removed from the lobby for now (disabled block) ----
    if (false) {
      const g = new THREE.Group();
      const stone = voxelMaterial(VOX.stone);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.4, 8), stone);
      pad.position.y = 0.2;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 20), glowMaterial(0xff5a4a, 0.7));
      ring.position.y = 0.42;
      g.add(pad, ring);
      // a little bed on the pad (frame + mattress + pillow)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.8), voxelMaterial(VOX.bark));
      frame.position.set(0, 0.6, 0);
      const mat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.7), glowMaterial(0xff5a4a, 0.5));
      mat.position.set(0, 0.78, 0);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.6), voxelMaterial(0xfff4e0));
      pillow.position.set(-0.35, 0.82, 0);
      g.add(frame, mat, pillow);
      // two posts + a red arch beam behind, each with a base block + glowing cap
      for (const px of [-1.7, 1.7]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.4, 0.4), stone);
        post.position.set(px, 1.7, -0.6);
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), voxelMaterial(VOX.stoneDark));
        base.position.set(px, 0.25, -0.6);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.56), glowMaterial(0xff5a4a, 1.0));
        cap.position.set(px, 3.45, -0.6);
        g.add(post, base, cap);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 0.5), glowMaterial(0xff5a4a, 0.8));
      beam.position.set(0, 3.4, -0.6);
      const swords = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), glowMaterial(0xffd24a, 1.2));
      swords.position.set(0, 3.4, -0.4);
      g.add(beam, swords);
      // swirling red portal surface filling the arch
      const bwPortal = this.makePortalSurface(0xff5a4a, 2.9, 2.7);
      bwPortal.position.set(0, 1.85, -0.5);
      g.add(bwPortal);
      const pos = new THREE.Vector3(13, 0, 10);
      g.position.copy(pos);
      g.rotation.y = Math.atan2(-pos.x, -pos.z);
      this.group.add(g);
      this.zones.push({ id: "bedwars", kind: "bedwars", pos, radius: 2.4, label: "Bed Wars" });
    }
    // ---- TOWER DEFENSE portal: a podium with a little turret on a winding lane ----
    {
      const g = new THREE.Group();
      const stone = voxelMaterial(VOX.stone);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.4, 8), stone);
      pad.position.y = 0.2;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 20), glowMaterial(0x7fd4ff, 0.7));
      ring.position.y = 0.42;
      g.add(pad, ring);
      // a stubby turret on the pad (base + body + glowing barrel)
      const tbase = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 1.0), stone);
      tbase.position.set(0, 0.6, 0);
      const tbody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), voxelMaterial(0x9fe0a0));
      tbody.position.set(0, 1.0, 0);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.9), glowMaterial(0x7fd4ff, 0.8));
      barrel.position.set(0, 1.1, 0.6);
      g.add(tbase, tbody, barrel);
      // two posts + a blue arch beam behind, each with a base block + glowing cap
      for (const px of [-1.7, 1.7]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.4, 0.4), stone);
        post.position.set(px, 1.7, -0.6);
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), voxelMaterial(VOX.stoneDark));
        base.position.set(px, 0.25, -0.6);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.56), glowMaterial(0x7fd4ff, 1.0));
        cap.position.set(px, 3.45, -0.6);
        g.add(post, base, cap);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 0.5), glowMaterial(0x7fd4ff, 0.8));
      beam.position.set(0, 3.4, -0.6);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), glowMaterial(0x9fe0a0, 1.2));
      crystal.position.set(0, 3.4, -0.4);
      g.add(beam, crystal);
      // swirling blue portal surface filling the arch
      const tdPortal = this.makePortalSurface(0x7fd4ff, 2.9, 2.7);
      tdPortal.position.set(0, 1.85, -0.5);
      g.add(tdPortal);
      const tdSat = SATELLITES.find((s) => s.id === "sat_td")!.center;
      const pos = new THREE.Vector3(tdSat.x, 0, tdSat.z); // on the Tower Defense island
      g.position.copy(pos);
      g.rotation.y = Math.atan2(-pos.x, -pos.z);
      this.group.add(g);
      this.zones.push({ id: "td", kind: "td", pos, radius: 3.0, label: "Tower Defense" });
    }
  }

  /**
   * The cozy village — timber-framed cottages framing the square (the Shop & the
   * Inn are real buildings you walk up to; the rest dress the town), plus a pair
   * of market stalls flanking the entry path. This is what turns the hub from an
   * open field into a Hypixel-style courtyard.
   */
  private buildHouses() {
    for (const c of HOUSES) {
      const house = this.makeCottage(c.wall, c.roof, c.trim, c.big > 0, c.story > 0);
      house.position.set(c.x, 0, c.z);
      house.rotation.y = Math.atan2(-c.x, -c.z); // door (built on +z) faces the square
      this.group.add(house);
    }
    for (const s of STALLS) {
      const stall = this.makeStall(s.color);
      stall.position.set(s.x, 0, s.z);
      stall.rotation.y = Math.atan2(-s.x, -s.z);
      this.group.add(stall);
    }
  }

  /** A detailed timber-framed cottage: stone footing + porch step, plaster walls
   *  with Tudor framing, framed windows with shutters & flower boxes, a doorway
   *  with awning, a stepped gable roof with eaves, an optional second storey +
   *  dormer, a smoking chimney, and (for big plots) a hanging shop sign. */
  private makeCottage(wallColor: number, roofColor: number, trimColor: number, big: boolean, story: boolean): THREE.Group {
    const h = new THREE.Group();
    const w = big ? 4.6 : 3.6;
    const d = big ? 5.4 : 4.4;
    const wallH = 2.6;
    const wallTop = 0.2 + wallH;
    const trim = voxelMaterial(trimColor);
    const wallMat = voxelMaterial(wallColor);
    const roofMat = voxelMaterial(roofColor);
    const roofMat2 = voxelMaterial(darken(roofColor, 0.82));
    const winMat = glowMaterial(VOX.windowGlow, 0.95);
    const wood = voxelMaterial(VOX.woodTrim);
    const front = d / 2;

    // stone footing + a front porch step
    const foundation = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.5, d + 0.7), voxelMaterial(VOX.foundation));
    foundation.position.y = 0.05;
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.26, 0.8), voxelMaterial(VOX.stone));
    step.position.set(0, 0.18, front + 0.45);
    h.add(foundation, step);

    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    walls.position.y = 0.2 + wallH / 2;
    h.add(walls);
    // a stone base course wrapping the lower walls (classic cottage masonry)
    const baseCourse = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.7, d + 0.14), voxelMaterial(VOX.foundation));
    baseCourse.position.y = 0.2 + 0.35;
    h.add(baseCourse);

    // Tudor framing: corner posts + a mid + top horizontal band + two front studs
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, wallH, 0.3), trim);
      post.position.set((sx * w) / 2, 0.2 + wallH / 2, (sz * d) / 2);
      h.add(post);
    }
    for (const by of [wallTop - 0.05, 0.2 + wallH * 0.55]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.2, d + 0.08), trim);
      band.position.y = by;
      h.add(band);
    }
    for (const sx of [-1, 1]) {
      const stud = new THREE.Mesh(new THREE.BoxGeometry(0.18, wallH, 0.12), trim);
      stud.position.set(sx * (w / 2 - 0.95), 0.2 + wallH / 2, front + 0.01);
      h.add(stud);
      // diagonal timber brace on the upper front gable section (Tudor look)
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.5, 0.1), trim);
      brace.position.set(sx * (w / 2 - 0.5), 0.2 + wallH * 0.78, front + 0.01);
      brace.rotation.z = sx * 0.6;
      h.add(brace);
      // eave bracket under the roof overhang
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.46, 0.5), trim);
      bracket.position.set(sx * (w / 2 - 0.1), wallTop + 0.05, front - 0.1);
      bracket.rotation.x = 0.45;
      h.add(bracket);
    }

    // a framed window with optional shutters + a flower box (faces +z)
    const frontWindow = (x: number, y: number, withBox: boolean) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.94, 1.06, 0.1), trim);
      frame.position.set(x, y, front + 0.02);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.82, 0.12), winMat);
      pane.position.set(x, y, front + 0.06);
      h.add(frame, pane);
      // glazing-bar mullions (a cross over the pane)
      const mullV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.82, 0.14), trim);
      mullV.position.set(x, y, front + 0.08);
      const mullH = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.14), trim);
      mullH.position.set(x, y, front + 0.08);
      h.add(mullV, mullH);
      for (const sx of [-1, 1]) {
        const shut = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.96, 0.06), wood);
        shut.position.set(x + sx * 0.58, y, front + 0.05);
        h.add(shut);
      }
      if (withBox) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.22, 0.26), wood);
        box.position.set(x, y - 0.62, front + 0.14);
        h.add(box);
        const cols = [VOX.flowerPink, VOX.flowerYellow, VOX.flowerRed, VOX.flowerWhite];
        for (let f = 0; f < 3; f++) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.16), glowMaterial(cols[(f + x) & 3] ?? VOX.flowerPink, 0.4));
          fl.position.set(x - 0.26 + f * 0.26, y - 0.46, front + 0.16);
          h.add(fl);
        }
      }
    };
    frontWindow(-w / 2 + 0.85, 1.55, true);
    frontWindow(w / 2 - 0.85, 1.55, true);
    // simple side windows
    for (const sx of [-1, 1]) for (const sz of [-0.8, 0.9]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.92), trim);
      frame.position.set((sx * w) / 2 + sx * 0.02, 1.55, sz);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.76, 0.66), winMat);
      pane.position.set((sx * w) / 2 + sx * 0.05, 1.55, sz);
      h.add(frame, pane);
    }

    // doorway: framed door + a little pitched awning + a wall lantern
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.7, 0.14), voxelMaterial(VOX.doorWood));
    door.position.set(0, 0.2 + 0.85, front + 0.05);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.0, 0.1), trim);
    doorFrame.position.set(0, 0.2 + 1.0, front + 0.02);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), glowMaterial(VOX.lantern, 0.6));
    knob.position.set(0.35, 0.95, front + 0.12);
    h.add(doorFrame, door, knob);
    for (let k = 0; k < 2; k++) {
      const awn = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.4), roofMat);
      awn.position.set(0, 0.2 + 2.05 + k * 0.16, front + 0.2 + k * 0.18);
      awn.rotation.x = -0.5;
      h.add(awn);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.22), glowMaterial(VOX.lantern, 1.2));
    lamp.position.set(w / 2 - 0.5, 2.1, front + 0.06);
    h.add(lamp);
    this.beacons.push(lamp);

    // optional second storey (set back a touch) with its own framed windows
    let roofBase = wallTop;
    if (story) {
      const sH = 1.8;
      const upper = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, sH, d - 0.4), wallMat);
      upper.position.y = wallTop + sH / 2;
      h.add(upper);
      const uband = new THREE.Mesh(new THREE.BoxGeometry(w - 0.32, 0.18, d - 0.32), trim);
      uband.position.y = wallTop + sH - 0.04;
      h.add(uband);
      for (const sx of [-1, 1]) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.1), trim);
        frame.position.set(sx * (w / 2 - 1.0), wallTop + sH / 2, d / 2 - 0.2 + 0.02);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.12), winMat);
        pane.position.set(sx * (w / 2 - 1.0), wallTop + sH / 2, d / 2 - 0.2 + 0.05);
        h.add(frame, pane);
      }
      roofBase = wallTop + sH;
    }

    // stepped gable roof with an eaves overhang (narrows in x → street-facing gable)
    const L = 5, layerH = 0.36, inset = 0.4;
    const roofW = (story ? w - 0.4 : w) + 1.1;
    const roofD = (story ? d - 0.4 : d) + 1.0;
    for (let k = 0; k < L; k++) {
      const lw = Math.max(0.5, roofW - k * 2 * inset);
      const layer = new THREE.Mesh(new THREE.BoxGeometry(lw, layerH, roofD), k % 2 ? roofMat2 : roofMat);
      layer.position.y = roofBase + 0.1 + k * layerH + layerH / 2;
      h.add(layer);
    }
    const ridgeY = roofBase + 0.1 + L * layerH + 0.1;
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, roofD + 0.1), trim);
    ridge.position.y = ridgeY;
    h.add(ridge);
    // a roof dormer on storied houses
    if (story) {
      const dormer = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.6), wallMat);
      dormer.position.set(0, roofBase + 0.5, roofD / 2 - 0.5);
      const dWin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.1), winMat);
      dWin.position.set(0, roofBase + 0.55, roofD / 2 - 0.2);
      h.add(dormer, dWin);
    }

    // chimney (with a cap) + rising smoke
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.9, 0.55), voxelMaterial(VOX.stoneDark));
    chimney.position.set(w / 2 - 0.6, roofBase + 0.7, -d / 2 + 0.7);
    const chimCap = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.22, 0.75), voxelMaterial(VOX.stone));
    chimCap.position.set(chimney.position.x, roofBase + 1.6, chimney.position.z);
    h.add(chimney, chimCap);
    const smokeMat = () => new THREE.MeshStandardMaterial({ color: VOX.smoke, transparent: true, opacity: 0.5, depthWrite: false });
    const smokeBaseY = roofBase + 1.7;
    for (let s = 0; s < 3; s++) {
      const puff = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), smokeMat());
      puff.position.set(chimney.position.x, smokeBaseY + s * 0.6, chimney.position.z);
      h.add(puff);
      this.smokes.push({ mesh: puff, baseY: smokeBaseY, phase: Math.random() * 6.28, speed: 0.4, span: 2.2 });
    }

    // a weathervane on the ridge of storied houses
    if (story) {
      const vpost = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), trim);
      vpost.position.set(0, ridgeY + 0.5, roofD / 2 - 0.8);
      const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.08), glowMaterial(VOX.lantern, 0.7));
      arrow.position.set(0, ridgeY + 0.85, roofD / 2 - 0.8);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), trim);
      cross.position.set(0, ridgeY + 0.7, roofD / 2 - 0.8);
      h.add(vpost, arrow, cross);
    }

    // a hanging shop sign on a bracket (big plots only)
    if (big) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.12), trim);
      bracket.position.set(-w / 2 + 0.35, 2.3, front + 0.3);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.1), wood);
      sign.position.set(-w / 2 + 0.7, 1.95, front + 0.3);
      const icon = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.12), glowMaterial(VOX.lantern, 0.9));
      icon.position.set(-w / 2 + 0.7, 1.95, front + 0.37);
      h.add(bracket, sign, icon);
    }

    // ---- cottage yard dressing: a wood pile, barrels, a crate, and a bench ----
    const logMat = voxelMaterial(VOX.bark);
    // stacked wood pile beside the left wall
    for (let row = 0; row < 2; row++) for (let c = 0; c < 3; c++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 6), logMat);
      log.rotation.z = Math.PI / 2;
      log.position.set(-w / 2 - 0.9, 0.36 + row * 0.34, -d / 2 + 0.9 + c * 0.36 - (row * 0.18));
      h.add(log);
    }
    // a couple of barrels by the back-left corner
    for (let b = 0; b < 2; b++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.8, 8), voxelMaterial(VOX.barrel));
      barrel.position.set(-w / 2 - 0.7, 0.4, -d / 2 - 0.3 - b * 0.8);
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.1, 8), voxelMaterial(VOX.steelDark));
      hoop.position.set(barrel.position.x, 0.55, barrel.position.z);
      h.add(barrel, hoop);
    }
    // a crate by the door step
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), voxelMaterial(VOX.crate));
    crate.position.set(w / 2 - 0.4, 0.3, front + 0.7);
    h.add(crate);
    // a little bench against the front wall
    const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.4), wood);
    benchSeat.position.set(-w / 4, 0.5, front + 0.55);
    h.add(benchSeat);
    for (const bx of [-w / 4 - 0.55, -w / 4 + 0.55]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.32), wood);
      leg.position.set(bx, 0.25, front + 0.55);
      h.add(leg);
    }
    // big plots get a fenced garden patch with crops on the right
    if (big) {
      for (let p = 0; p < 4; p++) {
        const fp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), voxelMaterial(VOX.fence));
        fp.position.set(w / 2 + 0.6 + (p % 2) * 1.1, 0.25, -d / 2 + 0.6 + Math.floor(p / 2) * 1.1);
        h.add(fp);
      }
      const soil = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 1.3), voxelMaterial(VOX.tilled));
      soil.position.set(w / 2 + 1.15, 0.18, -d / 2 + 1.15);
      h.add(soil);
      for (let cr = 0; cr < 4; cr++) {
        const crop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.18), voxelMaterial(VOX.crop));
        crop.position.set(w / 2 + 0.8 + (cr % 2) * 0.7, 0.45, -d / 2 + 0.8 + Math.floor(cr / 2) * 0.7);
        h.add(crop);
      }
    }
    return h;
  }

  /** A little market stall: counter, posts, a striped awning, and glowing wares. */
  private makeStall(awningColor: number): THREE.Group {
    const s = new THREE.Group();
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.8), voxelMaterial(VOX.crate));
    counter.position.y = 0.45;
    s.add(counter);
    for (const px of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.7, 0.14), voxelMaterial(VOX.bark));
      post.position.set(px, 0.85, -0.3);
      s.add(post);
    }
    // striped awning (two-tone) tilted forward over the counter
    for (let i = 0; i < 4; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.42), voxelMaterial(i % 2 ? awningColor : VOX.rvBody));
      stripe.position.set(0, 1.7 - i * 0.12, 0.1 + i * 0.34);
      stripe.rotation.x = -0.5;
      s.add(stripe);
    }
    // a back board with hanging wares under the awning
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.1), voxelMaterial(VOX.woodTrim));
    board.position.set(0, 1.4, -0.34);
    s.add(board);
    const wareCols = [0xffd24a, 0x6ad7ff, 0xff6f7a, 0x7be08a];
    for (let i = 0; i < 4; i++) {
      const ware = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.12), glowMaterial(wareCols[i], 0.6));
      ware.position.set(-0.75 + i * 0.5, 1.45, -0.28);
      s.add(ware);
    }
    // crates + a barrel stacked beside the stall
    const sideCrate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), voxelMaterial(VOX.crate));
    sideCrate.position.set(-1.3, 0.3, 0.3);
    const sideBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.74, 8), voxelMaterial(VOX.barrel));
    sideBarrel.position.set(1.3, 0.37, 0.3);
    s.add(sideCrate, sideBarrel);
    // a couple of glowing goods on the counter
    for (const gx of [-0.5, 0.4]) {
      const good = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), glowMaterial(gx < 0 ? 0xffd24a : 0x6ad7ff, 0.6));
      good.position.set(gx, 1.05, 0.15);
      s.add(good);
    }
    return s;
  }

  /** Warm lanterns lining the paths + the square, and braziers at the corners —
   *  the glow (with bloom) that gives the courtyard its cozy Hypixel mood. */
  private buildLighting() {
    // NOTE: the old spoke-path lanterns were removed — the mode "gates" now live
    // on the far ZOMBIES satellite (~58u out), so that loop was marching ~90
    // lanterns across the whole lawn toward it (and the spoke paths it lit were
    // replaced by bridges, which carry their own torches). The courtyard glow is
    // the kerb ring + fountain braziers below.

    // a ring of lanterns just inside the kerb
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26;
      const lan = this.makeLantern();
      lan.position.set(Math.cos(a) * (PLAZA_R - 1), 0, Math.sin(a) * (PLAZA_R - 1));
      this.group.add(lan);
    }
    // braziers framing the fountain
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const { group, flame } = this.makeBrazier();
      group.position.set(Math.cos(a) * 4.4, 0, Math.sin(a) * 4.4);
      this.group.add(group);
      this.flames.push(flame);
    }
  }

  /** A wooden lantern post with a warm glowing head (pulses via the beacon loop). */
  private makeLantern(): THREE.Group {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 0.16), voxelMaterial(VOX.bark));
    post.position.y = 0.85;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), voxelMaterial(VOX.barkDark));
    arm.position.set(0, 1.7, 0.18);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), voxelMaterial(VOX.steelDark));
    cap.position.set(0, 1.85, 0.32);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.24), glowMaterial(VOX.lantern, 1.2));
    glow.position.set(0, 1.55, 0.32);
    g.add(post, arm, cap, glow);
    this.beacons.push(glow);
    return g;
  }

  /** A stone brazier with a flickering flame (registered to the flame loop). */
  private makeBrazier(): { group: THREE.Group; flame: Flame } {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 8), voxelMaterial(VOX.stone));
    base.position.y = 0.45;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.28, 0.32, 10), voxelMaterial(VOX.stoneDark));
    bowl.position.y = 1.0;
    const embers = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 8), glowMaterial(VOX.ember, 1.4));
    embers.position.y = 1.16;
    const flameMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), glowMaterial(VOX.emberHot, 1.6));
    flameMesh.position.y = 1.45;
    (flameMesh.geometry as THREE.BufferGeometry).scale(1, 1.5, 1);
    g.add(base, bowl, embers, flameMesh);
    return { group: g, flame: { mesh: flameMesh, phase: Math.random() * 6.28, base: 1 } };
  }

  /**
   * A friendly static greeter NPC near spawn with a welcome speech bubble + name
   * label, plus a floating arrow over the Duo gate pointing players at the action.
   */
  private buildGreeter() {
    const npc = new VoxelChar({ body: 0x6e4a9e, head: COLORS.playerAccent, eye: 0x222222, hat: 0xffd24a, gun: false });
    npc.root.position.set(3.2, 0, PLAZA_R - 2);
    npc.root.rotation.y = Math.PI;
    npc.play("idle");
    npc.emote("wave");
    this.greeter = npc;
    const label = makeLabel("Guide");
    npc.root.add(label);
    const bubble = makeBubble("Hatch pets at the egg shrines, then step into a SOLO / DUO / SQUAD room to fight together! Press T to wave 👋");
    bubble.scale.set(5.4, 1.4, 1);
    bubble.position.set(0, 3.1, 0);
    npc.root.add(bubble);
    this.group.add(npc.root);

    // a little wooden signpost beside the greeter
    const signPost = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.4, 0.16), voxelMaterial(VOX.bark));
    signPost.position.set(4.6, 0.7, PLAZA_R - 2);
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.1), voxelMaterial(VOX.woodTrim));
    signBoard.position.set(4.6, 1.4, PLAZA_R - 2);
    this.group.add(signPost, signBoard);

    const cone = new THREE.ConeGeometry(0.5, 1.0, 4);
    cone.rotateX(Math.PI);
    this.arrow = new THREE.Mesh(cone, glowMaterial(0x6ad7ff, 1.2));
    this.arrow.position.copy(GATES[1].pos).setY(3.8); // hover over the Duo gate
    this.group.add(this.arrow);
  }

  /** Ambient life: drifting glow motes over the plaza + slow clouds overhead. */
  private buildAtmosphere() {
    // floating sparkle motes rising over the plaza
    let seed = 555;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * (PLAZA_R + 2);
      const mote = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.07, 0),
        new THREE.MeshStandardMaterial({
          color: 0xfff0b8, emissive: 0xffe08a, emissiveIntensity: 1.2,
          transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false,
        }),
      );
      const baseY = 0.4 + rnd() * 1.5;
      mote.position.set(Math.cos(a) * r, baseY + rnd() * 2, Math.sin(a) * r);
      this.motes.push({ mesh: mote, baseY, phase: rnd() * 6.28, speed: 0.3 + rnd() * 0.5, span: 3 + rnd() * 2 });
      this.group.add(mote);
    }
    // chunky drifting clouds, kept high overhead + soft so they don't crowd the
    // structures (the earlier pass had them low enough to drift over the gates).
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 5; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const w = 1.8 + rnd() * 2.2;
        const blk = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 1.6), cloudMat);
        blk.position.set((rnd() - 0.5) * 4, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 2);
        cloud.add(blk);
      }
      const reset = 48;
      cloud.position.set(-reset + rnd() * reset * 2, 20 + rnd() * 5, -22 + rnd() * 44);
      this.clouds.push({ mesh: cloud as unknown as THREE.Mesh, speed: 0.4 + rnd() * 0.5, reset });
      this.group.add(cloud);
    }
  }

  // ========================================================================
  //  POLISH PASS — village life, fountain centerpiece, shore, satellites
  // ========================================================================

  /** Patterned cobble rings inlaid around the fountain (instanced — one draw
   *  call per ring) + warm light pools under the plaza's lantern ring. Stones
   *  ride on top of the lawn (top ≈ 0.5) so nothing is coplanar. */
  private buildPlazaRings() {
    const stoneGeo = new THREE.BoxGeometry(0.62, 0.18, 0.42);
    const ringDefs = [
      { r: 5.3, a: VOX.cobble, b: VOX.cobbleDark },
      { r: 9.4, a: VOX.stone, b: VOX.cobble },
    ];
    const col = new THREE.Color();
    for (const rd of ringDefs) {
      // precompute spots, skipping any that would clip a plaza attraction
      const count = Math.floor((Math.PI * 2 * rd.r) / 0.78);
      const spots: { x: number; z: number; yaw: number; i: number }[] = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const x = Math.cos(a) * rd.r;
        const z = Math.sin(a) * rd.r;
        if ((x + 2.5) ** 2 + (z - 9.8) ** 2 < 1.9 * 1.9) continue; // daily chest plot
        spots.push({ x, z, yaw: -a - Math.PI / 2, i });
      }
      const im = new THREE.InstancedMesh(stoneGeo, voxelMaterial(0xffffff), spots.length);
      spots.forEach((s, k) => {
        this._dummy.position.set(s.x, 0.55, s.z);
        this._dummy.rotation.set(0, s.yaw, 0);
        this._dummy.scale.setScalar(1);
        this._dummy.updateMatrix();
        im.setMatrixAt(k, this._dummy.matrix);
        // alternating two-tone stones with a rare mossy accent
        col.setHex(s.i % 9 === 0 ? 0x9bae84 : s.i % 2 ? rd.a : rd.b);
        im.setColorAt(k, col);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.userData.noCast = true;
      this.group.add(im);
    }
    // warm pools of lamplight under the plaza's lantern ring (shared material)
    this.poolMat = new THREE.MeshStandardMaterial({
      color: VOX.lantern, emissive: VOX.lantern, emissiveIntensity: 0.9,
      transparent: true, opacity: 0.18, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const poolGeo = new THREE.CircleGeometry(1.25, 20);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26; // matches the lantern ring in buildLighting
      const pool = new THREE.Mesh(poolGeo, this.poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(Math.cos(a) * (PLAZA_R - 1), 0.515, Math.sin(a) * (PLAZA_R - 1));
      this.group.add(pool);
    }
  }

  /** Fountain centerpiece upgrade: cascading water veils between the tiers,
   *  koi circling the base pool, wishing-coins glinting on the basin floor,
   *  and a few lily pads with blossoms riding the top of the water. */
  private buildFountainExtras() {
    // ---- koi: chunky orange glints lapping the pool (one group spins) ----
    const koi = new THREE.Group();
    const koiBodyGeo = new THREE.BoxGeometry(0.4, 0.1, 0.14);
    const koiTailGeo = new THREE.BoxGeometry(0.16, 0.08, 0.1);
    const koiA = glowMaterial(0xff7a36, 0.75);
    const koiB = glowMaterial(0xffb061, 0.65);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const r = 2.85 + (i % 2) * 0.4;
      const f = new THREE.Group();
      const body = new THREE.Mesh(koiBodyGeo, i % 2 ? koiA : koiB);
      const tail = new THREE.Mesh(koiTailGeo, i % 2 ? koiB : koiA);
      tail.position.x = -0.27;
      f.add(body, tail);
      f.position.set(Math.cos(a) * r, 0.66, Math.sin(a) * r);
      f.rotation.y = Math.PI / 2 - a; // nose along the swim direction
      koi.add(f);
    }
    this.koiGroup = koi;
    this.group.add(koi);
    // ---- wishing coins on the basin floor (instanced, shared glint pulse) ----
    this.coinMat = glowMaterial(0xffd24a, 0.9);
    const coinGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.035, 6);
    const coins = new THREE.InstancedMesh(coinGeo, this.coinMat, 16);
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 2.1 + rnd() * 1.2;
      this._dummy.position.set(Math.cos(a) * r, 0.672, Math.sin(a) * r);
      this._dummy.rotation.set(0, rnd() * Math.PI, 0);
      this._dummy.scale.setScalar(0.8 + rnd() * 0.5);
      this._dummy.updateMatrix();
      coins.setMatrixAt(i, this._dummy.matrix);
    }
    coins.instanceMatrix.needsUpdate = true;
    coins.userData.noCast = true;
    this.group.add(coins);
    // ---- lily pads + blossoms riding the pool surface ----
    const padGeo = new THREE.CylinderGeometry(0.32, 0.28, 0.06, 7);
    const padMat = voxelMaterial(0x4f9e4a);
    const blossomGeo = new THREE.BoxGeometry(0.16, 0.12, 0.16);
    for (let i = 0; i < 3; i++) {
      const a = 0.9 + i * 2.1;
      const r = 3.0 + (i % 2) * 0.35;
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(Math.cos(a) * r, 0.77, Math.sin(a) * r);
      this.group.add(pad);
      const bloom = new THREE.Mesh(blossomGeo, glowMaterial(i === 1 ? VOX.flowerWhite : VOX.flowerPink, 0.5));
      bloom.position.set(pad.position.x, 0.86, pad.position.z);
      this.group.add(bloom);
    }
    // ---- cascading translucent water veils spilling tier to tier ----
    const veilDefs = [
      { r: 2.55, yTop: 1.5, yBot: 0.78 },
      { r: 1.7, yTop: 2.25, yBot: 1.55 },
      { r: 1.06, yTop: 2.9, yBot: 2.3 },
    ];
    veilDefs.forEach((vd, i) => {
      const h = vd.yTop - vd.yBot;
      const veil = new THREE.Mesh(
        new THREE.CylinderGeometry(vd.r, vd.r + 0.1, h, 14, 1, true),
        new THREE.MeshStandardMaterial({
          color: VOX.water, emissive: 0x6fd0ff, emissiveIntensity: 0.7,
          transparent: true, opacity: 0.2, depthWrite: false,
          side: THREE.DoubleSide, toneMapped: false, flatShading: true,
        }),
      );
      veil.position.y = vd.yBot + h / 2;
      this.veils.push({ mesh: veil, phase: i * 1.7 });
      this.group.add(veil);
    });
  }

  /** Shore life: a plank dock with a moored rowboat, gulls wheeling over the
   *  bay, driftwood wandering the shallows, and the occasional fish jump. */
  private buildShoreLife() {
    const az = 1.95; // south-southwest — clear of the three northern bridges
    const dir = { x: Math.cos(az), z: Math.sin(az) };
    const perp = { x: -dir.z, z: dir.x };
    const yaw = Math.atan2(dir.x, dir.z);
    const plankA = voxelMaterial(0x8a5a32);
    const plankB = voxelMaterial(0x6f4626);
    const post = voxelMaterial(0x5c3c24);
    // ---- the dock: plank deck on piles, running off the sand into the bay ----
    let row = 0;
    for (let r = ISLAND.shore - 1; r <= 50; r += 0.95, row++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.8), row % 2 ? plankA : plankB);
      plank.position.set(dir.x * r, 0.62, dir.z * r);
      plank.rotation.y = yaw;
      plank.userData.noCast = true;
      this.group.add(plank);
    }
    for (const r of [42.5, 46.5, 50]) {
      for (const side of [-1, 1]) {
        const pile = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.3, 0.28), post);
        pile.position.set(dir.x * r + perp.x * side * 1.05, -0.45, dir.z * r + perp.z * side * 1.05);
        this.group.add(pile);
      }
    }
    // a lantern + a crate at the dock head
    const dockLan = this.makeLantern();
    dockLan.position.set(dir.x * 49.6 + perp.x * 0.8, 0.62, dir.z * 49.6 + perp.z * 0.8);
    dockLan.rotation.y = yaw + Math.PI;
    this.group.add(dockLan);
    const dockCrate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), voxelMaterial(VOX.crate));
    dockCrate.position.set(dir.x * 48.2 - perp.x * 0.75, 1.0, dir.z * 48.2 - perp.z * 0.75);
    this.group.add(dockCrate);
    // ---- the rowboat, moored alongside, rocking on the swell ----
    const boat = new THREE.Group();
    const hullBottom = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 2.0), plankB);
    hullBottom.position.y = 0.11;
    boat.add(hullBottom);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 2.2), plankA);
      wall.position.set(side * 0.48, 0.3, 0);
      boat.add(wall);
    }
    for (const end of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.36, 0.18), plankA);
      cap.position.set(0, 0.3, end * 1.05);
      boat.add(cap);
    }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.3), post);
    bench.position.set(0, 0.4, 0.25);
    boat.add(bench);
    const oar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.09), post);
    oar.position.set(0, 0.5, -0.3);
    oar.rotation.y = 0.5;
    boat.add(oar);
    boat.position.set(dir.x * 48.6 + perp.x * 2.3, -0.3, dir.z * 48.6 + perp.z * 2.3);
    boat.rotation.y = yaw + 0.25;
    this.boats.push({ group: boat, phase: 1.3 });
    this.group.add(boat);
    // ---- driftwood wandering the shallows (south arc, clear of bridges) ----
    const driftGeo = new THREE.CylinderGeometry(0.14, 0.18, 1.7, 6);
    driftGeo.rotateZ(Math.PI / 2);
    [0.55, 1.25, 2.6].forEach((a, i) => {
      const log = new THREE.Mesh(driftGeo, voxelMaterial(VOX.barkDark));
      const r = 46 + i * 2.4;
      const d = { mesh: log, phase: i * 2.4, baseX: Math.cos(a) * r, baseZ: Math.sin(a) * r };
      log.position.set(d.baseX, -0.34, d.baseZ);
      this.drifts.push(d);
      this.group.add(log);
    });
    // ---- gulls: chunky white v-birds circling the bay (wings flap in update) ----
    const gullBodyGeo = new THREE.BoxGeometry(0.18, 0.14, 0.52);
    const gullBeakGeo = new THREE.BoxGeometry(0.08, 0.06, 0.16);
    const wingLGeo = new THREE.BoxGeometry(0.6, 0.05, 0.22);
    wingLGeo.translate(0.32, 0, 0);
    const wingRGeo = new THREE.BoxGeometry(0.6, 0.05, 0.22);
    wingRGeo.translate(-0.32, 0, 0);
    const gullMat = voxelMaterial(0xf4f7f8);
    const beakMat = voxelMaterial(0xffb24a);
    const gullDefs = [
      { cx: dir.x * 47, cz: dir.z * 47, r: 7, h: 7.5, speed: 0.35, phase: 0 },
      { cx: dir.x * 44, cz: dir.z * 44, r: 10, h: 9.5, speed: -0.28, phase: 2.4 },
      { cx: dir.x * 30, cz: dir.z * 30, r: 15, h: 11, speed: 0.22, phase: 4.4 },
    ];
    for (const gd of gullDefs) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(gullBodyGeo, gullMat);
      const beak = new THREE.Mesh(gullBeakGeo, beakMat);
      beak.position.set(0, 0.02, 0.32);
      const wl = new THREE.Mesh(wingLGeo, gullMat);
      const wr = new THREE.Mesh(wingRGeo, gullMat);
      for (const m of [body, beak, wl, wr]) m.userData.noCast = true;
      g.add(body, beak, wl, wr);
      g.position.set(gd.cx + gd.r, gd.h, gd.cz);
      this.gulls.push({ group: g, wingL: wl, wingR: wr, phase: gd.phase, speed: gd.speed, r: gd.r, h: gd.h, cx: gd.cx, cz: gd.cz });
      this.group.add(g);
    }
    // ---- leaping fish + splash rings, offshore in the south bay ----
    const fishBodyGeo = new THREE.BoxGeometry(0.16, 0.16, 0.52);
    const fishTailGeo = new THREE.BoxGeometry(0.06, 0.2, 0.16);
    const splashGeo = new THREE.TorusGeometry(0.42, 0.06, 6, 14);
    [{ a: 1.55, ph: 0.1 }, { a: 2.35, ph: 0.55 }].forEach((fd, i) => {
      const bx = Math.cos(fd.a) * 46.5;
      const bz = Math.sin(fd.a) * 46.5;
      const dirX = -Math.sin(fd.a), dirZ = Math.cos(fd.a); // leap along the shore
      const root = new THREE.Group();
      const body = new THREE.Mesh(fishBodyGeo, glowMaterial(i ? 0x8fc7e8 : 0xff9a5a, 0.45));
      const tail = new THREE.Mesh(fishTailGeo, glowMaterial(i ? 0x6aa9cf : 0xe07a40, 0.4));
      tail.position.set(0, 0, -0.3);
      body.add(tail);
      root.add(body);
      root.rotation.y = Math.atan2(dirX, dirZ);
      root.visible = false;
      const splash = new THREE.Mesh(splashGeo, new THREE.MeshStandardMaterial({
        color: 0xeaf6ff, emissive: 0xbfe8ff, emissiveIntensity: 0.8,
        transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false,
      }));
      splash.rotation.x = -Math.PI / 2;
      splash.position.set(bx, -0.26, bz);
      splash.visible = false;
      this.fishes.push({ root, body, splash, phase: fd.ph, baseX: bx, baseZ: bz, dirX, dirZ });
      this.group.add(root, splash);
    });
  }

  /** Village dressing: trimmed hedges + flower beds at every cottage porch,
   *  festival bunting strung between the houses (and across the south entry),
   *  and a washing line behind a pair of cottages. */
  private buildVillageDress() {
    // ---- hedges + flower beds, placed in world space in front of each house ----
    const hedgeGeo = new THREE.BoxGeometry(1.4, 0.6, 0.5);
    const soilGeo = new THREE.BoxGeometry(1.3, 0.18, 0.42);
    const headGeo = new THREE.BoxGeometry(0.18, 0.16, 0.18);
    const hedgeMat = voxelMaterial(0x4f8a3a);
    const hedgeTop = voxelMaterial(0x6fae4a);
    const soilMat = voxelMaterial(VOX.tilled);
    const flowerMats = [VOX.flowerPink, VOX.flowerYellow, VOX.flowerRed, VOX.flowerWhite].map((c) => glowMaterial(c, 0.45));
    HOUSES.forEach((hs, hi) => {
      const yawH = Math.atan2(-hs.x, -hs.z); // houses face the plaza
      const fwdX = Math.sin(yawH), fwdZ = Math.cos(yawH);
      const sideX = Math.cos(yawH), sideZ = -Math.sin(yawH);
      const w = hs.big ? 4.6 : 3.6;
      const d = hs.big ? 5.4 : 4.4;
      for (const s of [-1, 1]) {
        const ox = hs.x + fwdX * (d / 2 + 1.0) + sideX * s * (w / 2 - 0.3);
        const oz = hs.z + fwdZ * (d / 2 + 1.0) + sideZ * s * (w / 2 - 0.3);
        // a clipped hedge block with a lit top course
        const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
        hedge.position.set(ox, 0.62, oz);
        hedge.rotation.y = yawH;
        const crown = new THREE.Mesh(soilGeo, hedgeTop);
        crown.position.set(ox, 0.96, oz);
        crown.rotation.y = yawH;
        this.group.add(hedge, crown);
        // flower bed strip in front of the hedge
        const bx = ox + fwdX * 0.65, bz = oz + fwdZ * 0.65;
        const soil = new THREE.Mesh(soilGeo, soilMat);
        soil.position.set(bx, 0.56, bz);
        soil.rotation.y = yawH;
        this.group.add(soil);
        for (let f = 0; f < 3; f++) {
          const head = new THREE.Mesh(headGeo, flowerMats[(hi + f + (s > 0 ? 1 : 0)) % flowerMats.length]);
          head.position.set(bx + sideX * (f - 1) * 0.38, 0.74, bz + sideZ * (f - 1) * 0.38);
          this.group.add(head);
        }
      }
    });
    // ---- festival bunting between the houses + over the south entrance ----
    const flagMats = [0xff6f7a, 0xffd45a, 0x6ad7ff, 0x7be08a, 0xff9ec7].map((c) => glowMaterial(c, 0.5));
    this.makeBunting(new THREE.Vector3(-10, 3.5, 18.5), new THREE.Vector3(-15.5, 3.5, 11.5), 0.55, flagMats);
    this.makeBunting(new THREE.Vector3(10, 3.5, 18.5), new THREE.Vector3(15.5, 3.5, 11.5), 0.55, flagMats);
    this.makeBunting(new THREE.Vector3(-5.5, 2.7, 17), new THREE.Vector3(5.5, 2.7, 17), 0.45, flagMats);
    this.makeBunting(new THREE.Vector3(-10, 4.4, 18.5), new THREE.Vector3(10, 4.4, 18.5), 1.1, flagMats);
    // ---- a washing line behind two of the cottages ----
    for (const hs of [HOUSES[4], HOUSES[5]]) {
      const out = Math.hypot(hs.x, hs.z) || 1;
      const dx = hs.x / out, dz = hs.z / out;
      const px = -dz, pz = dx;
      const cx = hs.x + dx * 4.4, cz = hs.z + dz * 4.4;
      const lineG = new THREE.Group();
      lineG.position.set(cx, 0, cz);
      lineG.rotation.y = Math.atan2(px, pz);
      const poleMat = voxelMaterial(VOX.bark);
      const cloths: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.0, 0.14), poleMat);
        pole.position.set(0, 1.4, s * 1.6);
        lineG.add(pole);
      }
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 3.2), voxelMaterial(0xd8d2c0));
      rope.position.y = 2.3;
      lineG.add(rope);
      const clothCols = [0xd6e8f0, 0xf0d6da, 0xe8f0d6];
      for (let i = 0; i < 3; i++) {
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.6), voxelMaterial(clothCols[i]));
        cloth.position.set(0, 1.93, -1.0 + i * 1.0);
        lineG.add(cloth);
        cloths.push(cloth);
      }
      this.buntings.push({ flags: cloths, phase: hs.x });
      this.group.add(lineG);
    }
  }

  /** String a sagging bunting line of glowing pennants between two points
   *  (rope segments + flags that sway from the same breeze as the banners). */
  private makeBunting(p1: THREE.Vector3, p2: THREE.Vector3, sag: number, flagMats: THREE.MeshStandardMaterial[]) {
    const g = new THREE.Group();
    const dx = p2.x - p1.x, dz = p2.z - p1.z;
    const L = Math.hypot(dx, dz);
    g.position.copy(p1);
    g.rotation.y = Math.atan2(-dz, dx);
    const ropeMat = voxelMaterial(0xd8d2c0);
    const n = Math.max(6, Math.round(L / 0.85));
    const flags: THREE.Mesh[] = [];
    let px = 0, py = 0;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = u * L;
      const y = (p2.y - p1.y) * u - Math.sin(u * Math.PI) * sag;
      if (i > 0) {
        const seg = new THREE.Mesh(BUNT_ROPE, ropeMat);
        seg.position.set((px + x) / 2, (py + y) / 2, 0);
        seg.scale.x = Math.hypot(x - px, y - py);
        seg.rotation.z = Math.atan2(y - py, x - px);
        g.add(seg);
      }
      if (i > 0 && i < n) {
        const flag = new THREE.Mesh(BUNT_FLAG, flagMats[i % flagMats.length]);
        flag.position.set(x, y, 0);
        flags.push(flag);
        g.add(flag);
      }
      px = x;
      py = y;
    }
    this.buntings.push({ flags, phase: p1.x + p1.z });
    this.group.add(g);
  }

  /** Dress each satellite to its theme: torch pairs at both bridge mouths,
   *  theme-coloured banners greeting arrivals, and pines + boulders on the far
   *  rim — without moving any gate / podium / monument anchor. */
  private buildSatelliteDress() {
    for (const s of SATELLITES) {
      const d = Math.hypot(s.center.x, s.center.z) || 1;
      const dir = { x: s.center.x / d, z: s.center.z / d };
      const perp = { x: -dir.z, z: dir.x };
      // torches flanking the gateway arch at each end of the bridge
      for (const r of [ISLAND.half - 4, d - s.radius + 1]) {
        for (const side of [-1, 1]) {
          const { group, flame } = this.makeTorch(0xffa53a);
          group.position.set(dir.x * r + perp.x * side * 3.0, 0.05, dir.z * r + perp.z * side * 3.0);
          this.group.add(group);
          this.flames.push(flame);
        }
      }
      // theme banners on poles flanking where the bridge lands on the platform
      const arriveA = Math.atan2(-dir.z, -dir.x); // azimuth (from the satellite) back toward the hub
      for (const off of [-0.85, 0.85]) {
        const a = arriveA + off;
        const bx = s.center.x + Math.cos(a) * (s.radius - 2.4);
        const bz = s.center.z + Math.sin(a) * (s.radius - 2.4);
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.0, 0.18), voxelMaterial(VOX.barkDark));
        pole.position.set(bx, 2.3, bz);
        const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), glowMaterial(s.color, 1.1));
        finial.position.set(bx, 4.45, bz);
        this.group.add(pole, finial);
        const banner = this.makeBanner(s.color, 4);
        banner.group.position.set(bx, 4.1, bz);
        banner.group.rotation.y = a + Math.PI / 2;
        this.group.add(banner.group);
        this.banners.push(banner.rec);
      }
      // pines + boulders dressing the far rim (opposite the bridge mouth)
      const farA = Math.atan2(dir.z, dir.x);
      for (const off of [-0.55, 0.1, 0.6]) {
        const a = farA + off;
        const px = s.center.x + Math.cos(a) * (s.radius - 3.6);
        const pz = s.center.z + Math.sin(a) * (s.radius - 3.6);
        if (off === 0.1) {
          for (let k = 0; k < 2; k++) {
            const sz = 0.7 + k * 0.45;
            const rock = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.7, sz), voxelMaterial(k ? VOX.rock : VOX.rockDark));
            rock.position.set(px + k * 0.7, 0.5 + sz * 0.3, pz - k * 0.4);
            rock.rotation.y = a + k;
            this.group.add(rock);
          }
        } else {
          const pine = this.makePine(off < 0 ? 1.15 : 0.9);
          pine.position.set(px, 0.35, pz);
          pine.rotation.y = a * 2;
          this.group.add(pine);
        }
      }
    }
  }

  /** A compact stacked-tier pine used to dress the satellite platforms. */
  private makePine(scale: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.36 * scale, 1.1 * scale, 0.36 * scale), voxelMaterial(VOX.bark));
    trunk.position.y = 0.55 * scale;
    g.add(trunk);
    for (let k = 0; k < 4; k++) {
      const w = (2.0 - k * 0.45) * scale;
      const tier = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6 * scale, w), voxelMaterial(k === 3 ? 0x6fae4a : 0x4f8a3a));
      tier.position.y = (1.3 + k * 0.55) * scale;
      g.add(tier);
    }
    return g;
  }

  /** Extra glow layering on the egg shrines, the sanctuary, and the wheel:
   *  tilted shimmer halos, a counter-orbiting sparkle ring, carnival bulbs. */
  private buildShrinePolish() {
    // a tilted, slowly-precessing halo ring around every gem-egg
    for (const e of this.eggs) {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.045, 5, 26), auraMaterial(e.color, 0.8));
      halo.position.y = 2.05;
      halo.rotation.x = 1.05;
      e.group.add(halo);
      this.eggHalos.push({ mesh: halo, phase: e.phase });
    }
    // sanctuary: a ring of white sparkles counter-orbiting the hearts
    const sparkles = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), glowMaterial(0xfff6e0, 1.3));
      sp.position.set(Math.cos(a) * 1.35, (i % 2 ? 0.3 : -0.2), Math.sin(a) * 1.35);
      sparkles.add(sp);
    }
    sparkles.position.set(SANCTUARY.x, 2.0, SANCTUARY.z);
    this.sanctuarySparkles = sparkles;
    this.group.add(sparkles);
    // fortune wheel: a ring of warm carnival bulbs spinning with the wheel
    if (this.wheelMesh) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.26;
        const bulb = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), glowMaterial(VOX.lantern, 1.2));
        bulb.position.set(Math.cos(a) * 1.18, Math.sin(a) * 1.18, 0.12);
        this.wheelMesh.add(bulb);
        this.beacons.push(bulb);
      }
    }
  }

  /** Dusk ambience: instanced fireflies around the village outskirts, falling
   *  autumn leaves under the tree band, and butterflies over the flowers. */
  private buildAmbientLife() {
    let seed = 8181;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // ---- fireflies: one InstancedMesh, matrices driven in animateLife ----
    // A FEW, dim, and kept close to the fountain — a swarm of 40 bright motes
    // ringing the lawn read as "a ton of lanterns", which we don't want.
    const FF = 10;
    this.fireflyMat = new THREE.MeshStandardMaterial({
      color: 0xfff6c0, emissive: 0xd8ff7a, emissiveIntensity: 0.7,
      transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false,
    });
    const ff = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.05, 0), this.fireflyMat, FF);
    this.fireflyBase = new Float32Array(FF * 4);
    for (let i = 0; i < FF; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 7 + rnd() * 9; // hug the fountain/plaza instead of ringing the lawn
      this.fireflyBase[i * 4] = Math.cos(a) * r;
      this.fireflyBase[i * 4 + 1] = 0.9 + rnd() * 1.3;
      this.fireflyBase[i * 4 + 2] = Math.sin(a) * r;
      this.fireflyBase[i * 4 + 3] = rnd() * 6.28;
      this._dummy.position.set(this.fireflyBase[i * 4], this.fireflyBase[i * 4 + 1], this.fireflyBase[i * 4 + 2]);
      this._dummy.rotation.set(0, 0, 0);
      this._dummy.scale.setScalar(1);
      this._dummy.updateMatrix();
      ff.setMatrixAt(i, this._dummy.matrix);
    }
    ff.instanceMatrix.needsUpdate = true;
    this.fireflies = ff;
    this.group.add(ff);
    // ---- falling leaves: instanced, tinted per-leaf via instance colors ----
    const LF = 30;
    const leafMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.03, 0.24), voxelMaterial(0xffffff), LF);
    const leafCols = [0xe8a23c, 0xd9762e, 0xc24a35, 0x8fd44f];
    const col = new THREE.Color();
    this.leafBase = new Float32Array(LF * 4);
    for (let i = 0; i < LF; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 26 + rnd() * 12; // under the outer tree band
      this.leafBase[i * 4] = Math.cos(a) * r;
      this.leafBase[i * 4 + 1] = Math.sin(a) * r;
      this.leafBase[i * 4 + 2] = rnd() * 6.28;
      this.leafBase[i * 4 + 3] = 0.05 + rnd() * 0.05; // fall-cycle speed
      this._dummy.position.set(this.leafBase[i * 4], 2 + rnd() * 4, this.leafBase[i * 4 + 1]);
      this._dummy.rotation.set(0, 0, 0);
      this._dummy.scale.setScalar(1);
      this._dummy.updateMatrix();
      leafMesh.setMatrixAt(i, this._dummy.matrix);
      col.setHex(leafCols[i % leafCols.length]);
      leafMesh.setColorAt(i, col);
    }
    leafMesh.instanceMatrix.needsUpdate = true;
    if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
    leafMesh.userData.noCast = true;
    this.fallingLeaves = leafMesh;
    this.group.add(leafMesh);
    // ---- butterflies: two flapping wing-quads over the flower belts ----
    const wingLGeo = new THREE.BoxGeometry(0.34, 0.02, 0.26);
    wingLGeo.translate(0.19, 0, 0);
    const wingRGeo = new THREE.BoxGeometry(0.34, 0.02, 0.26);
    wingRGeo.translate(-0.19, 0, 0);
    const bodyGeo = new THREE.BoxGeometry(0.06, 0.06, 0.26);
    const bodyMat = voxelMaterial(0x3a3030);
    const bDefs = [
      { x: -17.5, z: 6, c: 0xffd45a },
      { x: 18, z: -3, c: 0xff9ec7 },
      { x: -6, z: -16.5, c: 0x9fd4ff },
    ];
    for (let i = 0; i < bDefs.length; i++) {
      const bd = bDefs[i];
      const wingMat = glowMaterial(bd.c, 0.55);
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const wl = new THREE.Mesh(wingLGeo, wingMat);
      const wr = new THREE.Mesh(wingRGeo, wingMat);
      for (const m of [body, wl, wr]) m.userData.noCast = true;
      g.add(body, wl, wr);
      g.position.set(bd.x, 1.1, bd.z);
      this.butterflies.push({ group: g, wingL: wl, wingR: wr, phase: i * 2.2, baseX: bd.x, baseY: 1.1 + i * 0.15, baseZ: bd.z });
      this.group.add(g);
    }
  }
}

// shared bunting geometry (one pennant + one unit rope segment, reused by all lines)
const BUNT_FLAG = (() => {
  const g = new THREE.ConeGeometry(0.15, 0.32, 4);
  g.rotateZ(Math.PI); // apex down
  g.translate(0, -0.17, 0); // hinge at the rope
  return g;
})();
const BUNT_ROPE = new THREE.BoxGeometry(1, 0.035, 0.035);

/** A floating pill-shaped nameplate sign (canvas sprite, fog-immune) used to
 *  label the hub's interactive structures so they're easy to find. */
function makeSign(text: string, color: number): THREE.Sprite {
  // 2× canvas (512×128, 60px font) so the label stays crisp at the larger
  // in-world size and under lobby supersampling.
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "bold 60px system-ui, sans-serif";
  const tw = g.measureText(text).width;
  const w = Math.min(504, tw + 80);
  const x = (512 - w) / 2;
  g.beginPath();
  (g as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(x, 16, w, 96, 32);
  g.fillStyle = "rgba(28,20,12,0.85)";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  g.stroke();
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  sprite.scale.set(3.4, 0.85, 1);
  return sprite;
}

/** Multiply an 0xRRGGBB color toward black (f in 0..1). */
function darken(color: number, f: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * f);
  const g = Math.floor(((color >> 8) & 0xff) * f);
  const b = Math.floor((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** Default visual set for the 5 egg shrines (id + tier color + walk-up label). */
const DEFAULT_EGG_VISUALS: { id: string; color: number; label: string }[] = [
  { id: "egg_common", color: 0x8fcf5a, label: "Mossy Egg" },
  { id: "egg_uncommon", color: 0x6ad7ff, label: "River Egg" },
  { id: "egg_rare", color: 0x5aa9ff, label: "Storm Egg" },
  { id: "egg_epic", color: 0xc792ea, label: "Astral Egg" },
  { id: "egg_legendary", color: 0xffb84a, label: "Mythic Egg" },
];

/** Re-exported so main can tint prompts consistently with the hub. */
export const ISLAND_COLORS = COLORS;
