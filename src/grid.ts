import { Zombie } from "./zombie";

/**
 * Uniform spatial bucket grid over the arena, rebuilt once per frame. Lets the
 * combat systems (zombie separation, bullet collision, homing, splash, chain)
 * query only nearby zombies instead of scanning the whole list — turning the
 * per-frame O(n²)/O(bullets×zombies) cost into roughly O(n).
 *
 * Cell size matches ZOMBIE.separation (2u) so separation only needs the 3×3
 * neighbourhood. A flat preallocated array (no per-frame Map/array allocation).
 */
const CELL = 2;
const DIM = 48; // covers roughly [-48..48] world units at 2u cells (arena half=20 + margin)
const HALF = DIM / 2; // grid origin offset so negative coords map into [0,DIM)

function cellIndex(x: number, z: number): number {
  let gx = Math.floor(x / CELL) + HALF;
  let gz = Math.floor(z / CELL) + HALF;
  if (gx < 0) gx = 0;
  else if (gx >= DIM) gx = DIM - 1;
  if (gz < 0) gz = 0;
  else if (gz >= DIM) gz = DIM - 1;
  return gx + gz * DIM;
}

export class SpatialGrid {
  private cells: Zombie[][] = Array.from({ length: DIM * DIM }, () => []);

  /** Empty every bucket (reuses the arrays — no allocation). */
  clear() {
    for (const c of this.cells) c.length = 0;
  }

  insert(z: Zombie) {
    this.cells[cellIndex(z.pos.x, z.pos.z)].push(z);
  }

  /** Rebuild from a zombie list, inserting only the alive ones. */
  rebuild(zombies: Zombie[]) {
    this.clear();
    for (const z of zombies) if (z.alive) this.insert(z);
  }

  /**
   * Visit every zombie within `radius` of (x,z). The callback may return false
   * to stop early (e.g. a non-piercing bullet that hit something).
   */
  forNear(x: number, z: number, radius: number, cb: (z: Zombie) => boolean | void): void {
    const r = Math.ceil(radius / CELL);
    const cgx = Math.floor(x / CELL) + HALF;
    const cgz = Math.floor(z / CELL) + HALF;
    for (let gz = cgz - r; gz <= cgz + r; gz++) {
      if (gz < 0 || gz >= DIM) continue;
      for (let gx = cgx - r; gx <= cgx + r; gx++) {
        if (gx < 0 || gx >= DIM) continue;
        const bucket = this.cells[gx + gz * DIM];
        for (let i = 0; i < bucket.length; i++) {
          if (cb(bucket[i]) === false) return;
        }
      }
    }
  }

  /** Nearest alive zombie to (x,z) within `range`, skipping ids in `skip`. */
  nearest(x: number, z: number, range: number, skip?: Set<number>): Zombie | null {
    let best: Zombie | null = null;
    let bestD = range * range;
    this.forNear(x, z, range, (q) => {
      if (!q.alive || skip?.has(q.id)) return;
      const dx = q.pos.x - x;
      const dz = q.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    });
    return best;
  }
}
