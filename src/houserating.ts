/**
 * "Tiny Home Academy" — a pure, deterministic house rater (à la Animal Crossing
 * HHA / Sims build-mode score). Takes HouseData and returns a 0..100 score, a
 * letter grade, and a per-criterion breakdown so the results panel can explain
 * it. No Three.js / DOM here — keep it pure so it's unit-testable.
 */
import type { HouseData, PartCat, PartKind } from "./house";

// Category lookup kept local (type-only import above) so this module stays a
// pure, dependency-free, unit-testable rater — no Three.js pulled in.
const KIND_CAT: Partial<Record<PartKind, PartCat>> = {
  floor: "structure", wall: "structure", roof: "structure", door: "structure", window: "structure", fence: "structure",
  bed: "furniture", table: "furniture", chair: "furniture", rug: "furniture",
  tree: "yard", lamp: "yard", flower: "yard", lamppost: "yard", bush: "yard", path: "yard",
  banner: "showoff", statue: "showoff", perch: "showoff", trophy: "showoff",
};

export interface RatingLine {
  label: string;
  score: number; // points awarded for this criterion
  max: number; // points possible
  note: string; // short human hint
}
export interface HouseRating {
  score: number; // 0..100
  grade: "D" | "C" | "B" | "A" | "S";
  breakdown: RatingLine[];
}

const catOf = (kind: PartKind): PartCat | undefined => KIND_CAT[kind];

/** Rate a house. Pure + deterministic. */
export function rateHouse(data: HouseData): HouseRating {
  const parts = data.parts ?? [];
  const n = parts.length;

  // 1) Size / effort — rewards building, saturates so a wall-spam can't max it.
  const sizeScore = Math.round(Math.min(20, (n / 40) * 20));

  // 2) Variety — distinct part kinds used.
  const kinds = new Set(parts.map((p) => p.kind));
  const varietyScore = Math.round(Math.min(20, kinds.size * 2.5));

  // 3) Theme / colour coherence — fewer distinct colours reads as "designed",
  //    but an all-default house (1 colour) shouldn't max it either.
  const colors = new Set(parts.map((p) => p.color ?? -1));
  let coherence = 0;
  if (n > 0) {
    const c = colors.size;
    coherence = c <= 1 ? 8 : c <= 4 ? 15 : c <= 7 ? 12 : Math.max(4, 12 - (c - 7));
  }
  const coherenceScore = Math.round(coherence);

  // 4) Pets displayed — perches with a pet attached.
  const petsShown = parts.filter((p) => p.kind === "perch" && p.petId).length;
  const petScore = Math.min(15, petsShown * 8);

  // 5) Trophies — show-off achievement, weighted by tier.
  const trophyScore = Math.min(15, parts
    .filter((p) => p.kind === "trophy")
    .reduce((s, p) => s + 3 + (p.tier ?? 0) * 2, 0));

  // 6) Enclosure — has a real footprint (floors) AND walls + a door.
  const floors = parts.filter((p) => p.kind === "floor").length;
  const walls = parts.filter((p) => p.kind === "wall").length;
  const hasDoor = parts.some((p) => p.kind === "door");
  const hasRoof = parts.some((p) => p.kind === "roof");
  let enclosure = 0;
  if (floors >= 4) enclosure += 4;
  if (walls >= 4) enclosure += 4;
  if (hasDoor) enclosure += 4;
  if (hasRoof) enclosure += 3;
  const enclosureScore = enclosure;

  // Bonus flavour: comfy interior (furniture) + lively yard.
  const hasFurniture = parts.some((p) => catOf(p.kind) === "furniture");
  const hasYard = parts.some((p) => catOf(p.kind) === "yard");

  const breakdown: RatingLine[] = [
    { label: "Size & effort", score: sizeScore, max: 20, note: `${n} parts placed` },
    { label: "Variety", score: varietyScore, max: 20, note: `${kinds.size} part types` },
    { label: "Colour theme", score: coherenceScore, max: 15, note: `${colors.size} colours used` },
    { label: "Pets on show", score: petScore, max: 15, note: petsShown ? `${petsShown} displayed` : "no perches" },
    { label: "Trophies", score: trophyScore, max: 15, note: trophyScore ? "achievements shown" : "none yet" },
    { label: "Cozy & complete", score: enclosureScore, max: 15, note: hasDoor && hasRoof ? "fully built" : "needs walls/roof/door" },
  ];

  let score = breakdown.reduce((s, b) => s + b.score, 0);
  if (hasFurniture) score += 3; // small comfort bonus
  if (hasYard) score += 2; // small curb-appeal bonus
  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade: HouseRating["grade"] =
    score >= 90 ? "S" : score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D";

  return { score, grade, breakdown };
}
