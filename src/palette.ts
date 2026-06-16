import * as THREE from "three";

// The cozy toy-diorama palette + shared material helpers.
export const COLORS = {
  player: 0x4a78d6,
  playerAccent: 0xfff4d6,
  zombie: 0x8fcf6f,
  zombieDark: 0x5f9d4a,
  bullet: 0xffe28a,
  wall: 0xc8b48c,
  wallTop: 0xb39e74,
  prop: 0xb98a64,
  boxGold: 0xffcf52,
  perkTough: 0xff6f91,
  perkQuick: 0x6ad7ff,
  wallBuy: 0xc9ff7a,
  damageNumber: 0xfff1c1,
};

/**
 * Voxel block palette, matching the "Tiny World Builder" toolbar:
 * Grass · Path · Dirt · Water · House · Tree · Fence · Crop · Tuft.
 */
export const VOX = {
  grass: 0x9ed94f,
  grassDark: 0x86c63c,
  path: 0xc9a96e,
  dirt: 0x8a5a32,
  dirtDark: 0x6f4626,
  tilled: 0x6e4a2c,
  stone: 0x9b9b90,
  stoneDark: 0x7c7c71,
  cobble: 0xc2c2b6,
  cobbleDark: 0x9ea093,
  water: 0x3f9fe0,
  house: 0x4a90d9,
  houseAlt: 0xb6452f,
  houseWall: 0xede4d0,
  roofBlue: 0x3f6fd1,
  roofRed: 0xb6452f,
  roofPurple: 0x6e4a9e,
  roofDark: 0x3b3b42,
  trunk: 0x7a5230,
  leaf: 0x6fbf3b,
  leafDark: 0x57a52c,
  leafPink: 0xeaa6c6,
  fence: 0x8a6a3a,
  crop: 0x8fd24a,
  cropRipe: 0xe7c04a,
  // building details
  plasterWarm: 0xe8c9a0,
  plasterSage: 0xbfcb9f,
  brick: 0xb05a40,
  foundation: 0x8b8b80,
  doorWood: 0x5a3a22,
  woodTrim: 0x8a6a3a,
  windowGlow: 0xffe2a0,
  lantern: 0xffb24a,
  smoke: 0xd8d8e0,
  cloud: 0xffffff,
  skyTop: 0x73b4ec,
  skyBottom: 0xd9eeff,
  // ---- survival-camp props (the reference diorama) ----
  rvBody: 0xeef1f3,      // creamy white camper shell
  rvBodyShade: 0xd9dee2,
  rvStripe: 0x2f74b0,    // blue accent stripe
  rvStripeDark: 0x215277,
  rvTrim: 0x3a4650,      // bumpers / dark trim
  rvWindow: 0xbfe2f0,    // glass (caught by bloom)
  rvDoor: 0xdfe6ea,
  tire: 0x26282d,        // wheels / rubber
  rim: 0x9aa3ad,         // hubcaps / steel
  steel: 0x9aa3ad,
  steelDark: 0x6f7882,
  jerryCan: 0xe7be33,    // yellow fuel can
  jerryCanDark: 0xc79a1f,
  propane: 0x4f9fd0,     // blue gas bottle
  toolbox: 0xd23b3b,     // red toolbox
  toolboxDark: 0xa52a2a,
  crate: 0xb6884f,       // crate wood
  crateDark: 0x8a6238,
  barrel: 0x4a7a4a,      // military-green barrel
  barrelRust: 0xb05a40,
  sandbag: 0xcdb98a,
  sandbagDark: 0xb6a273,
  rock: 0x9a9a90,
  rockDark: 0x7c7c71,
  ember: 0xff7a2a,       // campfire flame (glow)
  emberHot: 0xffd24a,
  // ---- ground & foliage detail (studio-voxel dressing) ----
  grassLight: 0xb6e85f,  // sun-kissed grass tufts / highlights
  leafLight: 0x8fd44f,   // lit top of tree canopies
  bark: 0x6b4a2a,
  barkDark: 0x523822,
  flowerPink: 0xff9ec7,
  flowerYellow: 0xffd45a,
  flowerWhite: 0xfff3e0,
  flowerRed: 0xff6f7a,
  flowerStem: 0x57a52c,
  mushroomCap: 0xd0593f,
  mushroomStem: 0xf0e6d2,
  pebble: 0xb8b8ad,
  pebbleDark: 0x97978c,
};

// ── MATERIAL TIER ───────────────────────────────────────────────────────────
// Mobile GPUs have been the FPS bottleneck since day one: every voxel in the
// game ran a full PBR (MeshStandardMaterial + IBL env map) fragment shader.
// On coarse-pointer/no-hover devices we swap the whole palette to Lambert —
// on flat-shaded boxes the look is essentially identical (per-face normals
// drive the same diffuse term) at a fraction of the per-pixel cost, and it
// skips env-map sampling entirely (main.ts adds a warm AmbientLight to stand
// in for the lost IBL fill). matchMedia-guarded so node (test) imports work.
// Lambert shares the color/emissive/map/flatShading surface callers use, so
// it's returned under the Standard type (duck-type compatible at runtime).
const LOW_TIER =
  typeof matchMedia === "function"
    ? matchMedia("(pointer: coarse)").matches && matchMedia("(hover: none)").matches
    : false;

/** Matte, flat-shaded material for voxel blocks (crisp per-face shading). */
export function voxelMaterial(color: number) {
  if (LOW_TIER) {
    return new THREE.MeshLambertMaterial({ color, flatShading: true }) as unknown as THREE.MeshStandardMaterial;
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: true,
  });
}

/** Soft, slightly matte material — the toy-plastic look. */
export function toyMaterial(color: number, opts: { emissive?: number; emissiveIntensity?: number } = {}) {
  if (LOW_TIER) {
    return new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    }) as unknown as THREE.MeshStandardMaterial;
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    flatShading: false,
  });
}

/** Glowy accent material for interactables (picked up by bloom). */
export function glowMaterial(color: number, intensity = 0.9) {
  if (LOW_TIER) {
    return new THREE.MeshLambertMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
    }) as unknown as THREE.MeshStandardMaterial;
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.0,
    emissive: color,
    emissiveIntensity: intensity,
  });
}

/** Translucent additive halo — for pet "aura" shells that must NOT hide the
 *  face/body they surround (a soft glow you can see straight through). */
export function auraMaterial(color: number, intensity = 0.5) {
  if (LOW_TIER) {
    return new THREE.MeshLambertMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }) as unknown as THREE.MeshStandardMaterial;
  }
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    transparent: true,
    opacity: 0.28,
    depthWrite: false, // don't occlude the face/eyes behind it
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}
