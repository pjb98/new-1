// Solana Valley world: a tidy neighbourhood of 10 fenced "homesteads" laid out
// in a 5×2 grid. Each homestead is a self-contained mini-farm with FOUR areas:
// a HOUSE (cottage), a big 7×7 CROP FARM, a CHICKEN PEN (with coop) and a
// separate COW PEN (open pasture), plus a little ORCHARD for fruit trees.
// You own homestead #0 (fully playable); the other 9 are decorative neighbours
// so the neighbourhood reads as alive. Everything is flat.

export type Rect = { x0: number; y0: number; x1: number; y1: number }; // tile coords, inclusive

// ---- homestead geometry (tiles) -----------------------------------------
// Interior of one homestead (inside the fence). Sub-areas are placed relative
// to this interior's top-left corner. Big enough for a 7×7 farm plus two pens.
export const HS_IW = 19; // interior width
export const HS_IH = 16; // interior height
// Footprint incl. the 1-tile fence ring on every side.
export const HS_W = HS_IW + 2; // 21
export const HS_H = HS_IH + 2; // 18

// Grid arrangement.
export const COLS = 5;
export const ROWS = 2;
export const MARGIN_X = 8; // tiles of grass left/right of the neighbourhood (room for the pond)
export const MARGIN_TOP = 3; // tiles of grass above the first row
export const MARGIN_BOTTOM = 4; // tiles of grass below the last row
export const GAP_X = 2; // grass/path gap between homestead columns
export const GAP_Y = 4; // gap between the two rows (leaves room for the avenue)

// The land is an island: a ring of ocean (+ a sand beach just inside it) wraps
// the whole grid. Homesteads sit on the grass well within the beach.
export const SHORE = 3; // ocean tiles at the very edge
export const BEACH = 2; // sand beach tiles just inside the ocean
export const ISLAND_BORDER = SHORE + BEACH; // grass starts this many tiles in

// Sub-area layout *relative to a homestead interior's top-left (ix, iy)*.
//   HOUSE        top-left            CHICKEN PEN   top-right (coop crowns it)
//   7×7 FARM     left, under house   COW PEN       bottom-right (open pasture)
//   ORCHARD      bottom-left, under the farm
export const SUB = {
  house: { cx: 2, baseRow: 3 }, // cottage centre col + base row (offsets in interior)
  farm: { x: 1, y: 6, w: 7, h: 7 }, // 7×7 tillable bed (left)
  chickenPen: { x: 10, y: 1, w: 6, h: 6 }, // chicken pen (coop on top edge)
  cowPen: { x: 10, y: 9, w: 8, h: 7 }, // cow pasture (bottom-right)
  orchard: { x: 1, y: 14, w: 6, h: 2 }, // fruit-tree slots under the farm
  signCx: 6, // name sign column (top edge) — sits in the gap between house & coop
};

export type Homestead = {
  index: number;
  ix: number; iy: number; // interior top-left (tile)
  interior: Rect; // full interior rect (inside the fence)
  house: { cx: number; baseRow: number };
  farm: Rect; // 7×7 crop bed (inclusive tile rect)
  chickenPen: Rect; // chicken pen (inclusive tile rect)
  cowPen: Rect; // cow pasture (inclusive tile rect)
  orchard: Rect; // tree slots (inclusive tile rect)
  signCx: number; // sign column (tile)
  owner: string; // display name ('You' for the player)
  mine: boolean;
};

const NAMES = [
  'You', 'Maya', 'Leo', 'Aria', 'Finn', 'Noor', 'Kai', 'Luna', 'Milo', 'Sage',
];

function makeHomestead(index: number): Homestead {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  // Interior top-left: skip the margin + the left fence (+1), then stride by
  // footprint + gap for each preceding column/row.
  const ix = ISLAND_BORDER + MARGIN_X + 1 + col * (HS_W + GAP_X);
  const iy = ISLAND_BORDER + MARGIN_TOP + 1 + row * (HS_H + GAP_Y);
  const r = (x: number, y: number, w: number, h: number): Rect => ({
    x0: ix + x, y0: iy + y, x1: ix + x + w - 1, y1: iy + y + h - 1,
  });
  return {
    index,
    ix, iy,
    interior: { x0: ix, y0: iy, x1: ix + HS_IW - 1, y1: iy + HS_IH - 1 },
    house: { cx: ix + SUB.house.cx, baseRow: iy + SUB.house.baseRow },
    farm: r(SUB.farm.x, SUB.farm.y, SUB.farm.w, SUB.farm.h),
    chickenPen: r(SUB.chickenPen.x, SUB.chickenPen.y, SUB.chickenPen.w, SUB.chickenPen.h),
    cowPen: r(SUB.cowPen.x, SUB.cowPen.y, SUB.cowPen.w, SUB.cowPen.h),
    orchard: r(SUB.orchard.x, SUB.orchard.y, SUB.orchard.w, SUB.orchard.h),
    signCx: ix + SUB.signCx,
    owner: NAMES[index % NAMES.length],
    mine: index === 0,
  };
}

export const HOMESTEADS: Homestead[] = Array.from({ length: COLS * ROWS }, (_, i) => makeHomestead(i));

// The player owns homestead #0 (top-left).
export const PLAYER = HOMESTEADS[0];
export const NEIGHBOR_HOMESTEADS = HOMESTEADS.filter((h) => !h.mine);

// ---- the player's homestead (drives farming + producers) -----------------
// MY_PLOT = the player's 7×7 crop bed (where hoe/plant/water/harvest work).
// HOME.chickenPen / HOME.cowPen = where animals spawn/wander (routed by type).
// HOME.orchard = where fruit trees go.
export const HOME = {
  houseCx: PLAYER.house.cx,
  houseBaseRow: PLAYER.house.baseRow,
  plot: {
    px: PLAYER.farm.x0,
    py: PLAYER.farm.y0,
    pw: PLAYER.farm.x1 - PLAYER.farm.x0 + 1,
    ph: PLAYER.farm.y1 - PLAYER.farm.y0 + 1,
  },
  chickenPen: { ...PLAYER.chickenPen } as Rect, // chickens roam here
  cowPen: { ...PLAYER.cowPen } as Rect, // cows roam here
  orchard: { ...PLAYER.orchard } as Rect, // fruit trees
};

export const MY_PLOT = HOME.plot;

export function isInMyPlot(tx: number, ty: number): boolean {
  return tx >= MY_PLOT.px && tx < MY_PLOT.px + MY_PLOT.pw && ty >= MY_PLOT.py && ty < MY_PLOT.py + MY_PLOT.ph;
}

// ---- neighbours (kept for back-compat with code that scans plot interiors) -
export type Neighbor = {
  px: number; py: number; pw: number; ph: number; // crop-bed interior
  owner: string;
};

export const NEIGHBORS: Neighbor[] = NEIGHBOR_HOMESTEADS.map((h) => ({
  px: h.farm.x0, py: h.farm.y0,
  pw: h.farm.x1 - h.farm.x0 + 1,
  ph: h.farm.y1 - h.farm.y0 + 1,
  owner: h.owner,
}));

// World size needed to hold the whole grid: the homestead grid + grass margins +
// the island's ocean/beach ring on every side. (constants.ts re-exports these as
// GRID_W / GRID_H so the two never drift.)
export const WORLD_COLS = 2 * ISLAND_BORDER + 2 * MARGIN_X + COLS * HS_W + (COLS - 1) * GAP_X;
export const WORLD_ROWS = 2 * ISLAND_BORDER + MARGIN_TOP + ROWS * HS_H + (ROWS - 1) * GAP_Y + MARGIN_BOTTOM;
