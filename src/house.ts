import * as THREE from "three";
import { voxelMaterial, toyMaterial, glowMaterial, VOX } from "./palette";
import { Pet, findAnyPet, SHARED_UNIT_BOX } from "./pets";

/**
 * Player housing on the island. A house is a small, server-persisted layout of
 * voxel "parts" placed on a 6x6 plot pad. Kept intentionally simple + data-
 * driven so it round-trips as JSON to the backend (and falls back to
 * localStorage when no backend is configured).
 *
 * The MODEL (HouseData) is pure data; the VIEW (HouseView) builds meshes from
 * it. main.ts owns placement input + save/load.
 */

export type PartKind =
  | "wall" | "floor" | "roof" | "door" | "window" | "fence" | "tree" | "lamp" | "flower"
  // furniture
  | "bed" | "table" | "chair" | "rug"
  // yard
  | "lamppost" | "bush" | "path"
  // show-off
  | "banner" | "statue" | "perch" | "trophy";

export interface HousePart {
  kind: PartKind;
  /** Grid cell on the plot (gx,gz in [-2..2]) + stack height (gy). */
  gx: number;
  gy: number;
  gz: number;
  color?: number;
  /** 4-way yaw, rot*90° (0..3). Optional — absent means 0. */
  rot?: 0 | 1 | 2 | 3;
  /** For a "perch": which owned pet to display (pet def id). */
  petId?: string;
  /** For a "trophy": tier 0..3 = Bronze/Silver/Gold/Diamond. */
  tier?: 0 | 1 | 2 | 3;
}

export interface HouseData {
  parts: HousePart[];
}

/** Build-bar categories (tabs). */
export type PartCat = "structure" | "furniture" | "yard" | "showoff";
export const PART_CATS: { id: PartCat; label: string }[] = [
  { id: "structure", label: "Structure" },
  { id: "furniture", label: "Furniture" },
  { id: "yard", label: "Yard" },
  { id: "showoff", label: "Show-off" },
];

/** Paint swatches offered in build mode (cozy toy palette). */
export const HOUSE_SWATCHES: number[] = [
  0xede4d0, 0xb6452f, 0x8a5a32, 0x9fe8ff, 0x5fb04a, 0xffd24a,
  0xff8fb0, 0x7a6cff, 0xff7a3a, 0x44d0c0, 0xffffff, 0x33363f,
];

/** Palette of placeable parts shown in the build bar. */
export const HOUSE_PARTS: { kind: PartKind; label: string; color: number; tall?: boolean; cat: PartCat }[] = [
  { kind: "floor", label: "Floor", color: VOX.path ?? 0xc9a96e, cat: "structure" },
  { kind: "wall", label: "Wall", color: VOX.houseWall ?? 0xede4d0, tall: true, cat: "structure" },
  { kind: "roof", label: "Roof", color: VOX.roofRed ?? 0xb6452f, cat: "structure" },
  { kind: "door", label: "Door", color: 0x8a5a32, tall: true, cat: "structure" },
  { kind: "window", label: "Window", color: 0x9fe8ff, tall: true, cat: "structure" },
  { kind: "fence", label: "Fence", color: 0xb6a273, cat: "structure" },
  { kind: "tree", label: "Tree", color: 0x5fb04a, tall: true, cat: "yard" },
  { kind: "lamp", label: "Lamp", color: 0xffd24a, tall: true, cat: "yard" },
  { kind: "flower", label: "Flower", color: 0xff8fb0, cat: "yard" },
  // furniture
  { kind: "bed", label: "Bed", color: 0x6c8cff, cat: "furniture" },
  { kind: "table", label: "Table", color: 0x9a6b3f, cat: "furniture" },
  { kind: "chair", label: "Chair", color: 0xc98a4a, cat: "furniture" },
  { kind: "rug", label: "Rug", color: 0xd14b6a, cat: "furniture" },
  // yard
  { kind: "lamppost", label: "Lamppost", color: 0xffe08a, tall: true, cat: "yard" },
  { kind: "bush", label: "Bush", color: 0x4f9a3e, cat: "yard" },
  { kind: "path", label: "Path", color: 0xc9a96e, cat: "yard" },
  // show-off
  { kind: "banner", label: "Banner", color: 0xd14b6a, tall: true, cat: "showoff" },
  { kind: "statue", label: "Statue", color: 0xcfd3da, tall: true, cat: "showoff" },
  { kind: "perch", label: "Pet Perch", color: 0xc7a86b, cat: "showoff" },
  { kind: "trophy", label: "Trophy", color: 0xffcf3f, cat: "showoff" },
];

const CELL = 1.2; // world size of a plot grid cell

/** Trophy tiers, gated by best round. Index = tier. */
export const TROPHY_TIERS: { label: string; color: number; minRound: number }[] = [
  { label: "Bronze", color: 0xcd7f32, minRound: 1 },
  { label: "Silver", color: 0xc7ccd6, minRound: 6 },
  { label: "Gold", color: 0xffcf3f, minRound: 11 },
  { label: "Diamond", color: 0x7fe3ff, minRound: 16 },
];

/** Highest trophy tier (0..3) earned for a given best round. */
export function trophyTierForRound(bestRound: number): 0 | 1 | 2 | 3 {
  let t: 0 | 1 | 2 | 3 = 0;
  for (let i = 0; i < TROPHY_TIERS.length; i++) if (bestRound >= TROPHY_TIERS[i].minRound) t = i as 0 | 1 | 2 | 3;
  return t;
}

/** A simple starter house so a fresh plot isn't empty when claimed. */
export function starterHouse(): HouseData {
  const parts: HousePart[] = [];
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) parts.push({ kind: "floor", gx: x, gy: 0, gz: z });
  // walls around the back + sides
  for (let x = -1; x <= 1; x++) parts.push({ kind: "wall", gx: x, gy: 1, gz: -1 });
  parts.push({ kind: "wall", gx: -1, gy: 1, gz: 0 }, { kind: "wall", gx: 1, gy: 1, gz: 0 });
  parts.push({ kind: "door", gx: 0, gy: 1, gz: 1 });
  parts.push({ kind: "window", gx: -1, gy: 1, gz: 1 }, { kind: "window", gx: 1, gy: 1, gz: 1 });
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) parts.push({ kind: "roof", gx: x, gy: 2, gz: z });
  parts.push({ kind: "lamp", gx: 2, gy: 1, gz: 2 }, { kind: "flower", gx: -2, gy: 0, gz: 2 });
  return { parts };
}

/**
 * Shared, cached materials for house parts. Many parts/pieces reuse the same
 * (factory, color, intensity) combo across an entire neighbourhood of plots,
 * so we cache + share one material per key instead of allocating per piece.
 *
 * LIFETIME: process-wide singletons — never disposed (disposeObject skips any
 * material flagged `userData.shared`). Paint never mutates a shared material's
 * color (that would recolour every part sharing it); it re-points the mesh at
 * the cached material for the new color instead.
 */
type MatKind = "voxel" | "toy" | "glow";
const matCache = new Map<string, THREE.Material>();
function sharedMat(kind: MatKind, color: number, intensity = 0.9): THREE.Material {
  const key = `${kind}:${color}:${kind === "glow" ? intensity : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = kind === "voxel" ? voxelMaterial(color) : kind === "toy" ? toyMaterial(color) : glowMaterial(color, intensity);
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

/** Renders a HouseData onto a plot anchor incrementally (per-part diffing). */
export class HouseView {
  readonly group = new THREE.Group();
  // partKey -> the placed Object3D + its current tint color, so render() can
  // add only new parts, remove only deleted ones, and repaint in place.
  private placed = new Map<string, { obj: THREE.Object3D; color: number }>();

  constructor(scene: THREE.Scene, anchor: THREE.Vector3) {
    this.group.position.copy(anchor);
    this.group.position.y = 0.2; // sit on the plot pad
    scene.add(this.group);
  }

  /**
   * Reconcile the rendered meshes to `data` (called on load + after each edit).
   * Incremental: unchanged parts are left untouched, added parts are built,
   * removed parts are disposed, and a part whose only change is color is
   * repainted in place — so an edit no longer tears down the whole tree.
   */
  render(data: HouseData) {
    // build the desired key -> part map (key excludes color; color is mutable)
    const desired = new Map<string, HousePart>();
    const seen = new Set<string>(); // disambiguate accidental dup keys
    for (const p of data.parts) {
      let key = partKey(p);
      while (seen.has(key)) key += "#"; // unique-ify exact duplicates
      seen.add(key);
      desired.set(key, p);
    }
    // remove parts that are gone
    for (const [key, entry] of this.placed) {
      if (!desired.has(key)) {
        this.group.remove(entry.obj);
        disposeObject(entry.obj);
        this.placed.delete(key);
      }
    }
    // add new parts; repaint existing ones whose color changed
    for (const [key, p] of desired) {
      const def = HOUSE_PARTS.find((d) => d.kind === p.kind);
      const color = p.color ?? def?.color ?? 0xcccccc;
      const existing = this.placed.get(key);
      if (!existing) {
        const obj = this.buildPart(p, color);
        this.group.add(obj);
        this.placed.set(key, { obj, color });
      } else if (existing.color !== color) {
        repaint(existing.obj, color);
        existing.color = color;
      }
    }
  }

  /** Build one part's Object3D (shared unit geometry, cached materials). */
  private buildPart(p: HousePart, color: number): THREE.Object3D {
    const x = p.gx * CELL;
    const z = p.gz * CELL;
    const yBase = p.gy * CELL;
    let mesh: THREE.Object3D;
    switch (p.kind) {
      case "floor":
        mesh = tintBox(CELL, 0.2, CELL, "voxel", color);
        mesh.position.set(x, yBase + 0.1, z);
        break;
      case "wall":
        mesh = tintBox(CELL, CELL, 0.2, "toy", color);
        mesh.position.set(x, yBase + CELL / 2, z);
        break;
      case "roof": {
        mesh = tintBox(CELL * 1.05, 0.3, CELL * 1.05, "voxel", color);
        mesh.position.set(x, yBase + 0.15, z);
        break;
      }
      case "door":
        mesh = tintBox(CELL * 0.7, CELL, 0.22, "toy", color);
        mesh.position.set(x, yBase + CELL / 2, z);
        break;
      case "window":
        mesh = tintBox(CELL * 0.7, CELL * 0.6, 0.22, "glow", color, 0.5);
        mesh.position.set(x, yBase + CELL / 2, z);
        break;
      case "fence":
        mesh = tintBox(CELL, 0.5, 0.12, "voxel", color);
        mesh.position.set(x, yBase + 0.35, z);
        break;
      case "tree": {
        const g = new THREE.Group();
        const tk = plainBox(0.3, 1.0, 0.3, "voxel", 0x8a5a32);
        tk.position.y = 0.5;
        const top = tintBox(1.0, 0.9, 1.0, "voxel", color);
        top.position.y = 1.3;
        g.add(tk, top);
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
      case "lamp": {
        const g = new THREE.Group();
        const post = plainBox(0.16, 1.1, 0.16, "voxel", 0x444448);
        post.position.y = 0.55;
        const bulb = tintBox(0.34, 0.34, 0.34, "glow", color, 1.2);
        bulb.position.y = 1.2;
        g.add(post, bulb);
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
      case "bed": {
        const g = new THREE.Group();
        const frame = plainBox(CELL * 0.9, 0.3, CELL * 0.7, "voxel", 0x8a5a32);
        frame.position.y = 0.15;
        const quilt = tintBox(CELL * 0.86, 0.18, CELL * 0.5, "toy", color);
        quilt.position.set(0, 0.34, 0.08);
        const pillow = plainBox(CELL * 0.7, 0.16, 0.26, "toy", 0xffffff);
        pillow.position.set(0, 0.36, -CELL * 0.28);
        g.add(frame, quilt, pillow);
        g.position.set(x, yBase + 0.2, z);
        mesh = g;
        break;
      }
      case "table": {
        const g = new THREE.Group();
        const top = tintBox(CELL * 0.7, 0.12, CELL * 0.7, "voxel", color);
        top.position.y = 0.55;
        for (const [lx, lz] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]] as const) {
          const leg = plainBox(0.1, 0.5, 0.1, "voxel", 0x6b4a2a);
          leg.position.set(lx * CELL, 0.25, lz * CELL);
          g.add(leg);
        }
        g.add(top);
        g.position.set(x, yBase + 0.2, z);
        mesh = g;
        break;
      }
      case "chair": {
        const g = new THREE.Group();
        const seat = tintBox(CELL * 0.4, 0.1, CELL * 0.4, "voxel", color);
        seat.position.y = 0.4;
        const back = tintBox(CELL * 0.4, 0.5, 0.1, "voxel", color);
        back.position.set(0, 0.65, -CELL * 0.18);
        g.add(seat, back);
        g.position.set(x, yBase + 0.2, z);
        mesh = g;
        break;
      }
      case "rug":
        mesh = tintBox(CELL * 0.95, 0.06, CELL * 0.95, "toy", color);
        mesh.position.set(x, yBase + 0.23, z);
        break;
      case "path":
        mesh = tintBox(CELL * 0.95, 0.1, CELL * 0.95, "voxel", color);
        mesh.position.set(x, yBase + 0.05, z);
        break;
      case "bush": {
        const g = new THREE.Group();
        const a = tintBox(0.7, 0.5, 0.7, "voxel", color);
        a.position.y = 0.25;
        const b = tintBox(0.4, 0.4, 0.4, "voxel", color);
        b.position.set(0.25, 0.45, 0.1);
        g.add(a, b);
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
      case "lamppost": {
        const g = new THREE.Group();
        const post = plainBox(0.14, 1.8, 0.14, "voxel", 0x33363f);
        post.position.y = 0.9;
        const arm = plainBox(0.5, 0.12, 0.12, "voxel", 0x33363f);
        arm.position.set(0.2, 1.7, 0);
        const lant = tintBox(0.26, 0.34, 0.26, "glow", color, 1.4);
        lant.position.set(0.4, 1.55, 0);
        g.add(post, arm, lant);
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
      case "banner": {
        const g = new THREE.Group();
        const pole = plainBox(0.1, CELL * 1.4, 0.1, "voxel", 0x6b4a2a);
        pole.position.y = CELL * 0.7;
        const cloth = tintBox(0.7, CELL * 0.9, 0.06, "toy", color);
        cloth.position.set(0.4, CELL * 0.85, 0);
        g.add(pole, cloth);
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
      case "statue": {
        const g = new THREE.Group();
        const base = plainBox(CELL * 0.6, 0.3, CELL * 0.6, "voxel", 0x9aa0ac);
        base.position.y = 0.15;
        const body = tintBox(0.4, 0.8, 0.3, "voxel", color);
        body.position.y = 0.7;
        const head = tintBox(0.34, 0.34, 0.34, "voxel", color);
        head.position.y = 1.27;
        g.add(base, body, head);
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
      case "perch": {
        const g = new THREE.Group();
        // a little plinth…
        const base = tintBox(CELL * 0.7, 0.3, CELL * 0.7, "voxel", color);
        base.position.y = 0.15;
        const top = plainBox(CELL * 0.55, 0.12, CELL * 0.55, "voxel", 0xffffff);
        top.position.y = 0.36;
        g.add(base, top);
        // …showing the owned pet's actual voxel model (reuse pets.ts Pet).
        const def = p.petId ? findAnyPet(p.petId) : undefined;
        if (def) {
          const pet = new Pet(def, 0, 1);
          pet.group.scale.setScalar(0.7);
          pet.group.position.y = 0.42;
          g.add(pet.group);
        }
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
      case "trophy": {
        const g = new THREE.Group();
        const tier = TROPHY_TIERS[p.tier ?? 0] ?? TROPHY_TIERS[0];
        const metal = p.color ?? tier.color;
        const plinth = plainBox(CELL * 0.5, 0.3, CELL * 0.5, "voxel", 0x3a3d46);
        plinth.position.y = 0.15;
        const stem = plainBox(0.12, 0.35, 0.12, "glow", metal, 0.6);
        stem.position.y = 0.47;
        const cup = plainBox(0.5, 0.4, 0.34, "glow", metal, 0.9);
        cup.position.y = 0.82;
        // little handles
        for (const hx of [-0.32, 0.32]) {
          const h = plainBox(0.1, 0.26, 0.1, "glow", metal, 0.9);
          h.position.set(hx, 0.82, 0);
          g.add(h);
        }
        g.add(plinth, stem, cup);
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
      case "flower":
      default: {
        const g = new THREE.Group();
        const stem = plainBox(0.1, 0.4, 0.1, "voxel", 0x5fb04a);
        stem.position.y = 0.2;
        const bloom = tintBox(0.3, 0.3, 0.3, "glow", color, 0.6);
        bloom.position.y = 0.5;
        g.add(stem, bloom);
        g.position.set(x, yBase, z);
        mesh = g;
        break;
      }
    }
    // 4-way yaw: rotate the finished mesh in place about its own cell centre.
    if (p.rot) mesh.rotation.y = (p.rot * Math.PI) / 2;
    return mesh;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    for (let i = this.group.children.length - 1; i >= 0; i--) disposeObject(this.group.children[i]);
    this.group.clear();
    this.placed.clear();
  }
}

/**
 * Stable identity for a placed part, EXCLUDING color (color is mutated in
 * place by paint). Two parts that differ only in color share this key so a
 * recolour is detected as a paint, not an add+remove.
 */
function partKey(p: HousePart): string {
  return `${p.kind}|${p.gx}|${p.gy}|${p.gz}|${p.rot ?? 0}|${p.petId ?? ""}|${p.tier ?? ""}`;
}

/** A color-driven mesh (shared unit box scaled to size, cached material). The
 *  mesh remembers its material factory so paint can swap to the cached material
 *  for the new color. */
function tintBox(w: number, h: number, d: number, kind: MatKind, color: number, intensity = 0.9): THREE.Mesh {
  const m = new THREE.Mesh(SHARED_UNIT_BOX, sharedMat(kind, color, intensity));
  m.scale.set(w, h, d);
  m.userData.tint = kind; // marks a paintable mesh + records its factory
  m.userData.tintI = intensity;
  return m;
}

/** A fixed-color piece (trunk, leg, pillow…) — never repainted. */
function plainBox(w: number, h: number, d: number, kind: MatKind, color: number, intensity = 0.9): THREE.Mesh {
  const m = new THREE.Mesh(SHARED_UNIT_BOX, sharedMat(kind, color, intensity));
  m.scale.set(w, h, d);
  return m;
}

/** Repaint a part in place: re-point its tint meshes at the cached material
 *  for the new color (no shared-material mutation). */
function repaint(obj: THREE.Object3D, color: number) {
  obj.traverse((o) => {
    const kind = o.userData.tint as MatKind | undefined;
    if (kind) (o as THREE.Mesh).material = sharedMat(kind, color, o.userData.tintI ?? 0.9);
  });
}

/** Recursively free a scene object's geometry/materials, but NEVER the shared
 *  singletons (unit box + cached materials, flagged userData.shared). */
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => { if (!m.userData.shared) m.dispose(); });
    else if (mat && !mat.userData.shared) mat.dispose();
  });
}

/** Validate/sanitize HouseData coming from storage or the network. */
export function sanitizeHouse(raw: unknown): HouseData {
  const parts: HousePart[] = [];
  const arr = (raw as { parts?: unknown })?.parts;
  if (Array.isArray(arr)) {
    for (const p of arr) {
      if (!p || typeof p !== "object") continue;
      const o = p as Partial<HousePart>;
      if (typeof o.kind !== "string" || !HOUSE_PARTS.some((d) => d.kind === o.kind)) continue;
      const gx = Number(o.gx), gy = Number(o.gy), gz = Number(o.gz);
      if (![gx, gy, gz].every(Number.isFinite)) continue;
      if (Math.abs(gx) > 2 || Math.abs(gz) > 2 || gy < 0 || gy > 4) continue; // clamp to plot
      const rotN = Number(o.rot);
      const rot = Number.isFinite(rotN) ? ((((rotN % 4) + 4) % 4) as 0 | 1 | 2 | 3) : undefined;
      // petId only meaningful on a perch + must name a real pet def
      const petId =
        o.kind === "perch" && typeof o.petId === "string" && findAnyPet(o.petId) ? o.petId : undefined;
      const tierN = Number(o.tier);
      const tier =
        o.kind === "trophy" && Number.isFinite(tierN)
          ? (Math.min(3, Math.max(0, Math.floor(tierN))) as 0 | 1 | 2 | 3)
          : undefined;
      parts.push({
        kind: o.kind as PartKind,
        gx, gy, gz,
        color: typeof o.color === "number" ? o.color : undefined,
        ...(rot ? { rot } : {}),
        ...(petId ? { petId } : {}),
        ...(tier !== undefined ? { tier } : {}),
      });
    }
  }
  if (parts.length > 400) parts.length = 400; // hard cap so a forged blob can't bloat
  return { parts };
}
