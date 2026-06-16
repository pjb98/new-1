import { HOUSE_PARTS } from "./house";
import type { HouseData, HousePart, PartKind } from "./house";

/**
 * Pure build-mode logic for house editing — no THREE, no DOM, no IO. The Game
 * class (main.ts) owns the scene/audio/render side-effects and the mutable edit
 * state; THIS module owns the deterministic data transforms so they can be unit
 * tested. Keeping these pure is what makes the build feature safe to refactor.
 */

/** Plot grid cell size (must match house.ts CELL). */
export const CELL = 1.2;

/**
 * Project a world (x,z) onto a plot-local grid cell, or null if it lands off the
 * 5x5 plot pad. `plotX/plotZ` are the plot anchor's world position.
 */
export function aimCell(worldX: number, worldZ: number, plotX: number, plotZ: number): { gx: number; gz: number } | null {
  const gx = Math.round((worldX - plotX) / CELL);
  const gz = Math.round((worldZ - plotZ) / CELL);
  if (Math.abs(gx) > 2 || Math.abs(gz) > 2) return null; // outside the plot pad
  return { gx, gz };
}

/** True if a part kind stacks vertically (walls/doors/trees…) vs. lies flat. */
export function isTallPart(kind: PartKind): boolean {
  return !!HOUSE_PARTS.find((d) => d.kind === kind)?.tall;
}

/** Options describing a single place/paint click. */
export interface BuildOpts {
  paint: boolean; // paint mode: recolour the top part instead of placing
  part: PartKind; // currently-selected part to place
  color: number | null; // selected swatch (null = the part's default colour)
  rot: 0 | 1 | 2 | 3; // placement yaw
  petId: string; // pet to attach to a placed "perch"
  trophyTier: 0 | 1 | 2 | 3; // tier stamped onto a placed "trophy"
}

/** Max parts a single house may hold (matches sanitizeHouse's cap). */
export const MAX_PARTS = 400;

export type BuildOutcome =
  | { result: "painted"; data: HouseData }
  | { result: "removed"; data: HouseData }
  | { result: "placed"; data: HouseData }
  | { result: "denied-empty" } // paint with nothing under the cursor
  | { result: "denied-full" }; // hit the 400-part cap

/**
 * Resolve one click at grid cell (gx,gz) against `data`, returning a NEW
 * HouseData plus what happened (so the caller can play the matching sfx / push
 * an undo snapshot only on a real change). Behaviour mirrors the original
 * in-place logic exactly: paint recolours the topmost part; placing the
 * currently-selected part on top of an identical part removes it (toggle);
 * otherwise it stacks (tall) or sits at gy 0 (flat).
 */
export function applyBuild(data: HouseData, gx: number, gz: number, o: BuildOpts): BuildOutcome {
  const atCell = data.parts.filter((p) => p.gx === gx && p.gz === gz);

  // Paint mode — recolour the topmost part at this cell.
  if (o.paint) {
    const target = atCell[atCell.length - 1];
    if (!target) return { result: "denied-empty" };
    const parts = data.parts.map((p) => {
      if (p !== target) return p;
      const np: HousePart = { ...p };
      if (o.color === null) delete np.color;
      else np.color = o.color;
      return np;
    });
    return { result: "painted", data: { parts } };
  }

  // Toggle: clicking the existing identical top part removes it.
  const top = atCell.reduce<HousePart | null>((hi, p) => (!hi || p.gy > hi.gy ? p : hi), null);
  if (top && top.kind === o.part) {
    return { result: "removed", data: { parts: data.parts.filter((p) => p !== top) } };
  }

  if (data.parts.length >= MAX_PARTS) return { result: "denied-full" };

  const gy = isTallPart(o.part) ? (top ? top.gy + 1 : 1) : 0;
  const part: HousePart = { kind: o.part, gx, gy, gz };
  if (o.color !== null) part.color = o.color;
  if (o.rot) part.rot = o.rot;
  if (o.part === "perch" && o.petId) part.petId = o.petId;
  if (o.part === "trophy") part.tier = o.trophyTier;
  return { result: "placed", data: { parts: [...data.parts, part] } };
}
