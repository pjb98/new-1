import * as THREE from "three";
import { glowMaterial } from "../palette";

/**
 * Runtime loader for the baked MagicaVoxel turret models (public/turrets/*.json).
 *
 * Each JSON is { d:[dx,dy,dz], v:[x,y,z,r,g,b, ...] } — a voxel list with the
 * artist's exact palette colors (baked from the .vox sources). We build a single
 * face-culled, vertex-colored mesh per model and swivel the whole thing to aim
 * (wrapped in a group named "barrel", which the TD aim code rotates).
 *
 * Anything that fails to load falls back to the procedural turret in tdmode, so
 * the mode always works offline / if an asset is missing.
 */

// ---- tuning knobs (calibrated visually) ----
const VOX_SCALE = 0.2; // world units per voxel at tier 1
const ORIENT_X = 0; // extra X rotation if the source is Z-up (set -Math.PI/2 to stand it up)
const FACING_Y = 0; // extra Y so the barrel's forward axis points at the aim target

interface VoxData { d: [number, number, number]; v: number[]; }

const data = new Map<string, VoxData>();
const geomCache = new Map<string, THREE.BufferGeometry>();

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) ?? "/";

/** Preload baked turret models by tower id (best-effort; missing → procedural). */
export async function loadVoxTurrets(ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      if (data.has(id)) return;
      try {
        const res = await fetch(`${BASE}turrets/${id}.json`);
        if (!res.ok) return;
        data.set(id, (await res.json()) as VoxData);
      } catch {
        /* offline / not baked — caller falls back to the procedural turret */
      }
    }),
  );
}

export function hasVoxTurret(id: string): boolean {
  return data.has(id);
}

// 6 cube faces: outward normal, neighbor delta, and the 4 corner offsets (CCW).
const FACES = [
  { n: [1, 0, 0], dl: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], dl: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], dl: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], dl: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], dl: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], dl: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as const;

/** Merge a voxel list into one BufferGeometry, dropping faces hidden between
 *  adjacent voxels. The whole pack shares one red/grey palette, so we RECOLOR the
 *  red "body" voxels to the tower's signature color (keeping their shading + the
 *  neutral grey structure) — that's what makes each tower visually distinct. */
function buildGeometry(id: string, d: VoxData, accent: number): THREE.BufferGeometry {
  const cached = geomCache.get(id);
  if (cached) return cached;
  const v = d.v;
  const n = v.length / 6;
  const filled = new Set<number>();
  const key = (x: number, y: number, z: number) => (x * 1024 + y) * 1024 + z;
  for (let i = 0; i < n; i++) filled.add(key(v[i * 6], v[i * 6 + 1], v[i * 6 + 2]));

  // tower accent (0..1) + the pack's main-red luminance for shade-preserving recolor
  const aR = ((accent >> 16) & 255) / 255, aG = ((accent >> 8) & 255) / 255, aB = (accent & 255) / 255;
  const MAIN_RED_LUM = 0.299 * 213 + 0.587 * 76 + 0.114 * 58; // the pack's primary red

  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = v[i * 6], y = v[i * 6 + 1], z = v[i * 6 + 2];
    const r = v[i * 6 + 3], g = v[i * 6 + 4], b = v[i * 6 + 5];
    // "body" = the red family (R dominant). Recolor to the tower accent, scaled
    // by this voxel's brightness so darker/lighter reds keep their shading.
    if (r > 80 && r > g * 1.45 && r > b * 1.45) {
      const k = Math.min(1.35, (0.299 * r + 0.587 * g + 0.114 * b) / MAIN_RED_LUM);
      tmp.setRGB(Math.min(1, aR * k), Math.min(1, aG * k), Math.min(1, aB * k), THREE.SRGBColorSpace);
    } else {
      tmp.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    }
    for (const f of FACES) {
      if (filled.has(key(x + f.dl[0], y + f.dl[1], z + f.dl[2]))) continue; // interior face — skip
      const [a, b, c2, e] = f.c;
      for (const corner of [a, b, c2, a, c2, e]) {
        pos.push(x + corner[0], y + corner[1], z + corner[2]);
        nor.push(f.n[0], f.n[1], f.n[2]);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geomCache.set(id, g);
  return g;
}

/**
 * Build a TD turret group from a baked voxel model. The whole model lives under a
 * "barrel" group so the existing aim code swivels it to face targets. Returns null
 * if the model isn't loaded (caller uses the procedural turret).
 */
export function buildVoxTurret(id: string, turretScaleBase: number, accent: number): THREE.Group | null {
  const d = data.get(id);
  if (!d) return null;
  const geo = buildGeometry(id, d, accent);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  // center on X/Z, sit the model's base at y=0
  const [dx, dy, dz] = d.d;
  mesh.position.set(-dx / 2, 0, -dz / 2);

  // inner group carries the static orientation/facing offsets; the "barrel" group
  // above it is what the TD aim code spins (so it must stay free for rotation.y).
  const inner = new THREE.Group();
  inner.rotation.x = ORIENT_X;
  inner.rotation.y = FACING_Y;
  inner.add(mesh);

  // Animation anchors the TD animator drives (tinted with the tower color):
  //  • "muzzle" — barrel-tip glow that brightens as the shot charges + flashes on
  //    fire (animator scales it + pulses emissive — no fixed position assumed).
  //  • "core"   — a slow-spinning energy core in the body that pulses with charge.
  // (spin/scan hooks are skipped: they hard-set positions tuned to the old turret
  //  scale and would sit wrong on these models.)
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), glowMaterial(accent, 1.0));
  muzzle.name = "muzzle";
  muzzle.position.set(0, dy * 0.55, dz * 0.5); // front-top tip, along the barrel's +Z
  inner.add(muzzle);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), glowMaterial(accent, 0.8));
  core.name = "core";
  core.position.set(0, dy * 0.5, 0); // body center
  inner.add(core);

  // Barrel intrinsic scale is expressed relative to TURRET_SCALE so that the
  // caller can scale the whole group by turretScale(tier) — matching the
  // procedural turrets' deploy/upgrade scaling — and land at VOX_SCALE at tier 1.
  const barrel = new THREE.Group();
  barrel.name = "barrel";
  barrel.scale.setScalar(VOX_SCALE / turretScaleBase);
  barrel.add(inner);

  const group = new THREE.Group();
  group.add(barrel);
  return group;
}
