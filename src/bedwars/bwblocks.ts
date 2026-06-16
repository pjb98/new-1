import * as THREE from "three";
import { voxelMaterial } from "../palette";

/**
 * Bed Wars-lite PLACEABLE BLOCKS — the signature bed-defense layer.
 *
 * Players buy block tiers (wool → planks → stone → obsidian) at the item shop;
 * each purchase lays/upgrades a protective ring of voxel cubes around their bed.
 * Raiders can't path through a block — they stop and chew through it first (the
 * integrator wires `obstacle()` into BwBots), so stacking sturdier walls buys
 * real defensive time. Bullets/TNT chip blocks via `damageNear`.
 *
 * Self-contained: owns its `.group`, the block registry, and disposal. Modeled
 * on the bwbots.ts conventions (tuning consts up top, traverse-and-dispose).
 */

export type BwBlockMat = "wool" | "planks" | "stone" | "obsidian";

/** Grid spacing between ring cells (and the cube footprint). */
export const BLOCK_CELL = 1.25;
/** Cube edge length (slightly under the cell so seams read). */
const BLOCK_SIZE = 1.15;
/** Block tops sit here above the island floor (island top y = 1.0). */
const BLOCK_Y = 1.0 + BLOCK_SIZE / 2;

/** Upgrade rank — a purchase only ever upgrades a weaker cell, never downgrades. */
const RANK: Record<BwBlockMat, number> = { wool: 1, planks: 2, stone: 3, obsidian: 4 };
/** Flat-shaded toy colours per material. */
const MAT_COLOR: Record<BwBlockMat, number> = {
  wool: 0xf2e9dc,
  planks: 0xb5803f,
  stone: 0x8b9097,
  obsidian: 0x2b2540,
};

interface Block { cell: string; pos: THREE.Vector3; mat: BwBlockMat; hp: number; max: number; mesh: THREE.Mesh; flash: number }

const _tmp = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class BwBlocks {
  readonly group = new THREE.Group();
  private blocks = new Map<string, Block>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  get count(): number { return this.blocks.size; }

  /** Cell key for a world position, snapped to the block grid. */
  private key(x: number, z: number): string {
    return `${Math.round(x / BLOCK_CELL)},${Math.round(z / BLOCK_CELL)}`;
  }

  /**
   * Lay (or upgrade) a one-block-tall ring of `mat` around `center`. Empty ring
   * cells get a fresh block at `hp`; cells already holding a WEAKER material are
   * upgraded in place (mesh recoloured, hp refreshed). Returns how many cells
   * were placed or upgraded.
   */
  placeRing(center: THREE.Vector3, mat: BwBlockMat, hp: number): number {
    let changed = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue; // leave the bed cell open
        const x = center.x + dx * BLOCK_CELL;
        const z = center.z + dz * BLOCK_CELL;
        if (this.placeOne(x, z, mat, hp)) changed++;
      }
    }
    return changed;
  }

  /** Place/upgrade a single cell. Returns true if something changed. */
  private placeOne(x: number, z: number, mat: BwBlockMat, hp: number): boolean {
    const cell = this.key(x, z);
    const existing = this.blocks.get(cell);
    if (existing) {
      if (RANK[mat] <= RANK[existing.mat]) { existing.hp = existing.max; return false; } // refill same/weaker
      existing.mat = mat; existing.max = hp; existing.hp = hp;
      (existing.mesh.material as THREE.MeshStandardMaterial).color.setHex(MAT_COLOR[mat]);
      return true;
    }
    const geo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const mesh = new THREE.Mesh(geo, voxelMaterial(MAT_COLOR[mat]));
    mesh.position.set(Math.round(x / BLOCK_CELL) * BLOCK_CELL, BLOCK_Y, Math.round(z / BLOCK_CELL) * BLOCK_CELL);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this.blocks.set(cell, { cell, pos: mesh.position.clone(), mat, hp, max: hp, mesh, flash: 0 });
    return true;
  }

  /**
   * The block a raider at `from` (heading toward `toward`) must break first: the
   * nearest block within `reach` that lies on the approach side (between the
   * raider and its goal). Returns its position + an onHit that damages it, or
   * null when the path is clear. Shaped to slot straight into BwBots.
   */
  obstacle(from: THREE.Vector3, toward: THREE.Vector3, reach: number): { pos: THREE.Vector3; onHit: (dmg: number) => void } | null {
    _dir.copy(toward).sub(from); _dir.y = 0;
    if (_dir.lengthSq() > 1e-6) _dir.normalize();
    let best: Block | null = null;
    let bestD = reach * reach;
    for (const b of this.blocks.values()) {
      _tmp.copy(b.pos).sub(from); _tmp.y = 0;
      const d2 = _tmp.lengthSq();
      if (d2 > bestD) continue;
      if (_tmp.dot(_dir) < -0.1) continue; // ignore blocks behind the raider
      best = b; bestD = d2;
    }
    if (!best) return null;
    const block = best;
    return { pos: block.pos, onHit: (dmg: number) => this.damageBlock(block, dmg) };
  }

  /** Damage one block; remove + dispose it when its hp runs out. */
  private damageBlock(b: Block, dmg: number): void {
    if (!this.blocks.has(b.cell)) return;
    b.hp -= dmg;
    b.flash = 0.1;
    (b.mesh.material as THREE.MeshStandardMaterial).emissive?.setHex(0x331a0a);
    if (b.hp <= 0) this.removeBlock(b);
  }

  /** Area damage (TNT/fireball/stray bullets). Returns blocks destroyed. */
  damageNear(pos: THREE.Vector3, radius: number, dmg: number): number {
    const r2 = radius * radius;
    let destroyed = 0;
    for (const b of [...this.blocks.values()]) {
      _tmp.copy(b.pos).sub(pos); _tmp.y = 0;
      if (_tmp.lengthSq() > r2) continue;
      b.hp -= dmg; b.flash = 0.1;
      if (b.hp <= 0) { this.removeBlock(b); destroyed++; }
    }
    return destroyed;
  }

  update(dt: number): void {
    for (const b of this.blocks.values()) {
      if (b.flash > 0) {
        b.flash -= dt;
        const mat = b.mesh.material as THREE.MeshStandardMaterial;
        if (b.flash <= 0 && mat.emissive) mat.emissive.setHex(0x000000);
      }
      // a thin damage tell: squash slightly as hp drops
      const frac = Math.max(0.55, b.hp / b.max);
      b.mesh.scale.y = frac;
      b.mesh.position.y = BLOCK_Y - (BLOCK_SIZE * (1 - frac)) / 2;
    }
  }

  private removeBlock(b: Block): void {
    this.blocks.delete(b.cell);
    this.group.remove(b.mesh);
    b.mesh.geometry.dispose();
    (b.mesh.material as THREE.Material).dispose();
  }

  clear(): void {
    for (const b of this.blocks.values()) {
      this.group.remove(b.mesh);
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
    this.blocks.clear();
  }
}

/** Map a shop block tier (1..4) to its material. */
export function bwBlockMat(tier: number): BwBlockMat {
  return tier >= 4 ? "obsidian" : tier === 3 ? "stone" : tier === 2 ? "planks" : "wool";
}
