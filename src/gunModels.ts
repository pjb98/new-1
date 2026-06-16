import * as THREE from "three";
import { voxelMaterial, glowMaterial } from "./palette";

/**
 * Distinct little voxel gun models, one per weapon "style". Used both as the
 * weapon the player holds and as the prizes that tumble out of the Mystery
 * Chest. Local frame: grip near the origin, barrel pointing toward +Z.
 *
 * Every model is a static, data-driven stack of chunky flat-shaded boxes and
 * low-poly (8-seg) cylinders. Glow parts use emissive materials so accents
 * pop under the bloom stack — nothing animates, so consumers can attach the
 * group once and forget it.
 */
export type GunStyle =
  | "pistol" | "smg" | "shotgun" | "cannon" | "rifle"
  | "arc" | "singularity" | "pyroclasm"
  | "confetti" | "potato" | "fish" | "chicken" | "beejar" | "bfg"
  | "rail" | "boomerang" | "tesla";

interface Part {
  s: [number, number, number]; // scale (box size, or [diam, diam, length] for cyl)
  p: [number, number, number]; // position
  c: number; // color
  r?: [number, number, number]; // rotation (rad). Rotated 45° cubes read as gems.
  cyl?: boolean; // low-poly cylinder (length along +Z) instead of a box
  glow?: boolean; // emissive (caught by bloom)
  gi?: number; // glow intensity override (default 1.1)
}

const UNIT = new THREE.BoxGeometry(1, 1, 1);
// Faceted 8-sided tube, length baked along +Z so [s] = [diam, diam, length].
const TUBE = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
TUBE.rotateX(Math.PI / 2);

// Shared material story: dark gunmetal + wood or polymer two-tone per gun,
// with one small color-coded accent (sight dot / mag base) per weapon.
const GUNMETAL = 0x2b2e33;
const STEEL = 0x3c4047;
const STEEL_LT = 0x565b63;
const POLY = 0x26282c;
const IRON = 0x1d1f23;
const WOOD = 0x6b4527;
const WOOD_DK = 0x46301a;
const BRASS = 0xc9963f;
const AMBER = 0xffd24a;
const QUARTER = Math.PI / 4;

const STYLES: Record<GunStyle, Part[]> = {
  // Compact sidearm: serrated slide + hammer, exposed barrel, amber sights,
  // raked walnut grip with a glowing mag base.
  pistol: [
    { s: [0.16, 0.11, 0.38], p: [0, 0.06, 0.21], c: 0x2b2b30 }, // slide
    { s: [0.165, 0.07, 0.09], p: [0, 0.06, 0.045], c: 0x4a4f57 }, // rear serrations
    { s: [0.14, 0.09, 0.34], p: [0, -0.02, 0.19], c: STEEL }, // frame
    { s: [0.09, 0.09, 0.14], p: [0, 0.06, 0.43], c: STEEL_LT, cyl: true }, // barrel
    { s: [0.045, 0.08, 0.05], p: [0, 0.1, 0], c: IRON }, // hammer
    { s: [0.09, 0.03, 0.03], p: [0, 0.13, 0.05], c: IRON }, // rear sight
    { s: [0.03, 0.045, 0.03], p: [0, 0.135, 0.36], c: AMBER, glow: true }, // front sight
    { s: [0.035, 0.025, 0.13], p: [0, -0.09, 0.14], c: GUNMETAL }, // trigger guard
    { s: [0.035, 0.05, 0.025], p: [0, -0.08, 0.2], c: GUNMETAL }, // guard post
    { s: [0.02, 0.04, 0.02], p: [0, -0.07, 0.12], c: BRASS }, // trigger
    { s: [0.13, 0.22, 0.12], p: [0, -0.16, 0.04], r: [0.18, 0, 0], c: WOOD }, // grip
    { s: [0.135, 0.035, 0.125], p: [0, -0.27, 0.06], r: [0.18, 0, 0], c: AMBER, glow: true }, // mag base
  ],
  // Stamped-steel room broom: suppressor + vented shroud, folded wire stock,
  // long forward-raked stick mag with an amber baseplate.
  smg: [
    { s: [0.16, 0.17, 0.5], p: [0, 0.01, 0.25], c: 0x303036 }, // receiver
    { s: [0.13, 0.05, 0.52], p: [0, 0.12, 0.26], c: 0x4a4f57 }, // dust cover
    { s: [0.07, 0.07, 0.2], p: [0, 0.04, 0.62], c: STEEL_LT, cyl: true }, // barrel
    { s: [0.12, 0.12, 0.18], p: [0, 0.04, 0.52], c: STEEL, cyl: true }, // shroud
    { s: [0.1, 0.1, 0.16], p: [0, 0.04, 0.74], c: POLY, cyl: true }, // suppressor
    { s: [0.03, 0.07, 0.03], p: [0, 0.18, 0.48], c: IRON }, // front post
    { s: [0.025, 0.025, 0.025], p: [0, 0.225, 0.48], c: AMBER, glow: true }, // sight dot
    { s: [0.09, 0.04, 0.03], p: [0, 0.165, 0.06], c: IRON }, // rear sight
    { s: [0.09, 0.36, 0.12], p: [0, -0.23, 0.27], r: [-0.14, 0, 0], c: 0x33363c }, // stick mag
    { s: [0.095, 0.04, 0.125], p: [0, -0.41, 0.295], r: [-0.14, 0, 0], c: AMBER, glow: true }, // baseplate
    { s: [0.11, 0.18, 0.11], p: [0, -0.12, 0.05], r: [0.2, 0, 0], c: POLY }, // pistol grip
    { s: [0.03, 0.025, 0.14], p: [0, -0.095, 0.15], c: POLY }, // trigger guard
    { s: [0.03, 0.03, 0.28], p: [-0.06, 0.05, -0.1], c: STEEL_LT }, // wire stock L
    { s: [0.03, 0.03, 0.28], p: [0.06, 0.05, -0.1], c: STEEL_LT }, // wire stock R
    { s: [0.15, 0.13, 0.035], p: [0, 0.02, -0.24], c: POLY }, // butt plate
  ],
  // Double-barrel coach gun: twin tubes over a mag tube, wood pump + stock,
  // glowing red shells saddled on the receiver, brass bead up front.
  shotgun: [
    { s: [0.085, 0.085, 0.6], p: [-0.05, 0.06, 0.38], c: STEEL, cyl: true }, // barrel L
    { s: [0.085, 0.085, 0.6], p: [0.05, 0.06, 0.38], c: STEEL, cyl: true }, // barrel R
    { s: [0.2, 0.1, 0.05], p: [0, 0.06, 0.655], c: GUNMETAL }, // muzzle band
    { s: [0.028, 0.028, 0.028], p: [0, 0.125, 0.66], c: AMBER, glow: true }, // bead sight
    { s: [0.07, 0.07, 0.46], p: [0, -0.045, 0.33], c: STEEL_LT, cyl: true }, // mag tube
    { s: [0.17, 0.13, 0.2], p: [0, -0.05, 0.42], c: WOOD }, // pump
    { s: [0.17, 0.18, 0.22], p: [0, 0.02, 0.11], c: GUNMETAL }, // receiver
    { s: [0.055, 0.055, 0.1], p: [-0.105, 0.05, 0.03], r: [0, Math.PI / 2, 0], c: 0xd84a3a, cyl: true, glow: true, gi: 0.7 }, // shell
    { s: [0.055, 0.055, 0.1], p: [-0.105, 0.05, 0.11], r: [0, Math.PI / 2, 0], c: 0xd84a3a, cyl: true, glow: true, gi: 0.7 }, // shell
    { s: [0.055, 0.055, 0.1], p: [-0.105, 0.05, 0.19], r: [0, Math.PI / 2, 0], c: 0xd84a3a, cyl: true, glow: true, gi: 0.7 }, // shell
    { s: [0.13, 0.15, 0.24], p: [0, -0.01, -0.12], r: [0.12, 0, 0], c: WOOD }, // stock
    { s: [0.135, 0.155, 0.04], p: [0, -0.025, -0.245], r: [0.12, 0, 0], c: POLY }, // butt pad
    { s: [0.1, 0.14, 0.1], p: [0, -0.12, 0.06], r: [0.35, 0, 0], c: WOOD_DK }, // grip wrist
    { s: [0.03, 0.025, 0.12], p: [0, -0.1, 0.13], c: GUNMETAL }, // trigger guard
  ],
  // Boomstick hand-cannon: fat faceted tube with a gold muzzle ring, glowing
  // warhead bore, banded barrel, top sight rail + twin wood grips.
  cannon: [
    { s: [0.3, 0.3, 0.48], p: [0, 0.05, 0.3], c: 0x44444a, cyl: true }, // main tube
    { s: [0.36, 0.36, 0.09], p: [0, 0.05, 0.555], c: 0xffcf52, cyl: true }, // gold muzzle ring
    { s: [0.24, 0.24, 0.05], p: [0, 0.05, 0.595], c: 0xff9a3a, cyl: true, glow: true }, // warhead bore
    { s: [0.33, 0.33, 0.05], p: [0, 0.05, 0.32], c: GUNMETAL, cyl: true }, // mid band
    { s: [0.32, 0.32, 0.1], p: [0, 0.05, 0.05], c: 0x33363c, cyl: true }, // breech cap
    { s: [0.07, 0.05, 0.3], p: [0, 0.245, 0.28], c: GUNMETAL }, // top rail
    { s: [0.035, 0.06, 0.035], p: [0, 0.3, 0.4], c: IRON }, // sight post
    { s: [0.03, 0.03, 0.03], p: [0, 0.34, 0.4], c: AMBER, glow: true }, // sight dot
    { s: [0.1, 0.16, 0.1], p: [0, -0.16, 0.38], r: [0.25, 0, 0], c: WOOD }, // foregrip
    { s: [0.13, 0.2, 0.13], p: [0, -0.15, 0.07], r: [0.2, 0, 0], c: WOOD }, // grip
    { s: [0.035, 0.025, 0.13], p: [0, -0.12, 0.16], c: GUNMETAL }, // trigger guard
    { s: [0.02, 0.045, 0.02], p: [0, -0.1, 0.13], c: BRASS }, // trigger
  ],
  // Marksman bolt rifle: long fluted barrel + brake, big scope with a glinting
  // cyan objective lens, cheek-riser stock, box mag and splayed bipod.
  rifle: [
    { s: [0.065, 0.065, 0.66], p: [0, 0.05, 0.6], c: STEEL, cyl: true }, // barrel
    { s: [0.085, 0.085, 0.22], p: [0, 0.05, 0.42], c: 0x33372f, cyl: true }, // flute sleeve
    { s: [0.095, 0.095, 0.1], p: [0, 0.05, 0.95], c: POLY, cyl: true }, // muzzle brake
    { s: [0.14, 0.15, 0.4], p: [0, 0.01, 0.2], c: 0x3a3e36 }, // receiver
    { s: [0.12, 0.13, 0.26], p: [0, -0.02, -0.11], r: [0.1, 0, 0], c: WOOD }, // stock
    { s: [0.1, 0.05, 0.16], p: [0, 0.075, -0.12], c: WOOD_DK }, // cheek riser
    { s: [0.125, 0.14, 0.035], p: [0, -0.035, -0.24], r: [0.1, 0, 0], c: POLY }, // butt pad
    { s: [0.045, 0.06, 0.05], p: [0, 0.12, 0.28], c: IRON }, // scope mount F
    { s: [0.045, 0.06, 0.05], p: [0, 0.12, 0.14], c: IRON }, // scope mount R
    { s: [0.09, 0.09, 0.26], p: [0, 0.19, 0.21], c: POLY, cyl: true }, // scope tube
    { s: [0.13, 0.13, 0.09], p: [0, 0.19, 0.375], c: POLY, cyl: true }, // objective bell
    { s: [0.115, 0.115, 0.02], p: [0, 0.19, 0.425], c: 0x9fe8ff, cyl: true, glow: true }, // lens glint
    { s: [0.11, 0.11, 0.06], p: [0, 0.19, 0.06], c: POLY, cyl: true }, // eyepiece
    { s: [0.05, 0.05, 0.05], p: [0.1, 0.05, 0.12], c: STEEL_LT }, // bolt knob
    { s: [0.1, 0.1, 0.16], p: [0, -0.105, 0.27], c: GUNMETAL }, // box mag
    { s: [0.105, 0.03, 0.165], p: [0, -0.165, 0.27], c: 0x9fe8ff, glow: true }, // mag base
    { s: [0.025, 0.2, 0.025], p: [-0.07, -0.1, 0.72], r: [0, 0, 0.45], c: STEEL_LT }, // bipod L
    { s: [0.025, 0.2, 0.025], p: [0.07, -0.1, 0.72], r: [0, 0, -0.45], c: STEEL_LT }, // bipod R
    { s: [0.11, 0.15, 0.11], p: [0, -0.11, 0.05], r: [0.25, 0, 0], c: WOOD }, // grip
  ],
  // ---- wonder weapons ----
  // Arc Cannon: teal coil-gun. Triple glowing accelerator rings taper toward a
  // crystal emitter; a charge crystal rides the spine, coolant tank below.
  arc: [
    { s: [0.18, 0.2, 0.46], p: [0, 0.01, 0.25], c: 0x26323a }, // body
    { s: [0.05, 0.09, 0.3], p: [0, 0.155, 0.22], c: 0x1f2a30 }, // spine fin
    { s: [0.11, 0.11, 0.11], p: [0, 0.21, 0.22], r: [QUARTER, 0, QUARTER], c: 0x6ad7ff, glow: true }, // charge crystal
    { s: [0.085, 0.085, 0.34], p: [0, 0.04, 0.6], c: 0x2a3a44, cyl: true }, // rail barrel
    { s: [0.26, 0.26, 0.04], p: [0, 0.04, 0.46], c: 0x6ad7ff, cyl: true, glow: true }, // coil ring
    { s: [0.22, 0.22, 0.04], p: [0, 0.04, 0.58], c: 0x6ad7ff, cyl: true, glow: true }, // coil ring
    { s: [0.18, 0.18, 0.04], p: [0, 0.04, 0.7], c: 0x6ad7ff, cyl: true, glow: true }, // coil ring
    { s: [0.09, 0.09, 0.09], p: [0, 0.04, 0.8], r: [QUARTER, 0, QUARTER], c: 0xeafcff, glow: true }, // emitter gem
    { s: [0.11, 0.11, 0.26], p: [0, -0.08, 0.33], c: 0x2f4450, cyl: true }, // coolant tank
    { s: [0.09, 0.09, 0.03], p: [0, -0.08, 0.47], c: 0x6ad7ff, cyl: true, glow: true, gi: 0.8 }, // tank cap
    { s: [0.11, 0.18, 0.12], p: [0, -0.14, 0.06], r: [0.2, 0, 0], c: 0x1f2a30 }, // grip
    { s: [0.03, 0.025, 0.12], p: [0, -0.105, 0.15], c: 0x1f2a30 }, // trigger guard
  ],
  // Singularity: a caged violet star. Four containment claws grip a big
  // rotated-crystal core, mini gems orbit, rune strips burn along the body.
  singularity: [
    { s: [0.18, 0.2, 0.44], p: [0, 0, 0.23], c: 0x2a2436 }, // body
    { s: [0.05, 0.1, 0.22], p: [0, 0.14, 0.18], c: 0x3a3050 }, // top fin
    { s: [0.015, 0.07, 0.26], p: [-0.092, 0.02, 0.22], c: 0xc792ea, glow: true, gi: 0.8 }, // rune strip L
    { s: [0.015, 0.07, 0.26], p: [0.092, 0.02, 0.22], c: 0xc792ea, glow: true, gi: 0.8 }, // rune strip R
    { s: [0.05, 0.05, 0.28], p: [0, 0.16, 0.5], r: [0.35, 0, 0], c: 0x3a3050 }, // claw top
    { s: [0.05, 0.05, 0.28], p: [0, -0.07, 0.5], r: [-0.35, 0, 0], c: 0x3a3050 }, // claw bottom
    { s: [0.05, 0.05, 0.28], p: [-0.13, 0.04, 0.5], r: [0, 0.35, 0], c: 0x3a3050 }, // claw L
    { s: [0.05, 0.05, 0.28], p: [0.13, 0.04, 0.5], r: [0, -0.35, 0], c: 0x3a3050 }, // claw R
    { s: [0.2, 0.2, 0.2], p: [0, 0.04, 0.6], r: [QUARTER, 0, QUARTER], c: 0xc792ea, glow: true }, // crystal core
    { s: [0.06, 0.06, 0.06], p: [-0.17, 0.13, 0.5], r: [QUARTER, 0, QUARTER], c: 0xe6c1ff, glow: true }, // mini gem
    { s: [0.06, 0.06, 0.06], p: [0.17, -0.04, 0.52], r: [QUARTER, 0, QUARTER], c: 0xe6c1ff, glow: true }, // mini gem
    { s: [0.11, 0.18, 0.12], p: [0, -0.14, 0.05], r: [0.2, 0, 0], c: 0x221d2e }, // grip
    { s: [0.03, 0.025, 0.12], p: [0, -0.115, 0.14], c: 0x221d2e }, // trigger guard
  ],
  // Pyroclasm: scorched flamethrower. Blunderbuss flare with a burning pilot
  // light, glowing heat vents, brass-capped fuel tank with a gauge.
  pyroclasm: [
    { s: [0.18, 0.22, 0.52], p: [0, 0, 0.27], c: 0x33271f }, // body
    { s: [0.07, 0.06, 0.42], p: [0, 0.14, 0.26], c: 0x261c16 }, // top ridge
    { s: [0.11, 0.11, 0.28], p: [0, 0.04, 0.62], c: 0x442f22, cyl: true }, // barrel
    { s: [0.17, 0.17, 0.09], p: [0, 0.04, 0.77], c: 0x2b1f18, cyl: true }, // muzzle flare
    { s: [0.13, 0.13, 0.03], p: [0, 0.04, 0.825], c: 0xffb03a, cyl: true, glow: true }, // pilot light
    { s: [0.05, 0.12, 0.3], p: [-0.115, 0.04, 0.3], c: 0xff7a3a, glow: true }, // heat vent L
    { s: [0.05, 0.12, 0.3], p: [0.115, 0.04, 0.3], c: 0xff7a3a, glow: true }, // heat vent R
    { s: [0.13, 0.13, 0.28], p: [0, -0.12, 0.32], c: 0x7a3322, cyl: true }, // fuel tank
    { s: [0.1, 0.1, 0.04], p: [0, -0.12, 0.475], c: BRASS, cyl: true }, // tank cap
    { s: [0.05, 0.05, 0.02], p: [0, -0.12, 0.5], c: AMBER, cyl: true, glow: true, gi: 0.8 }, // fuel gauge
    { s: [0.11, 0.18, 0.12], p: [0, -0.15, 0.07], r: [0.2, 0, 0], c: 0x2a201a }, // grip
    { s: [0.03, 0.025, 0.12], p: [0, -0.125, 0.16], c: 0x2a201a }, // trigger guard
  ],

  // ---- wacky guns ----
  // Confetti Cannon: striped party tube with a double-flared gold muzzle and
  // frozen mid-burst confetti squares.
  confetti: [
    { s: [0.22, 0.22, 0.34], p: [0, 0.01, 0.19], c: 0x6e4a9e, cyl: true }, // party tube
    { s: [0.23, 0.23, 0.05], p: [0, 0.01, 0.1], c: 0xff5d8f, cyl: true }, // pink stripe
    { s: [0.23, 0.23, 0.05], p: [0, 0.01, 0.24], c: 0x6ad7ff, cyl: true }, // blue stripe
    { s: [0.3, 0.3, 0.09], p: [0, 0.01, 0.4], c: AMBER, cyl: true, glow: true }, // flare 1
    { s: [0.38, 0.38, 0.09], p: [0, 0.01, 0.48], c: 0xffb03a, cyl: true, glow: true }, // flare 2
    { s: [0.24, 0.24, 0.06], p: [0, 0.01, 0.01], c: 0x4a2f6e, cyl: true }, // back cap
    { s: [0.07, 0.07, 0.07], p: [0.1, 0.1, 0.56], r: [0.5, 0.3, 0.2], c: 0x6ad7ff, glow: true }, // confetti
    { s: [0.06, 0.06, 0.06], p: [-0.09, 0, 0.58], r: [0.2, 0.6, 0.4], c: 0xff5d8f, glow: true }, // confetti
    { s: [0.06, 0.06, 0.06], p: [0.02, 0.15, 0.6], r: [0.7, 0.2, 0.5], c: 0x8fcf6f, glow: true }, // confetti
    { s: [0.12, 0.2, 0.13], p: [0, -0.16, 0.05], r: [0.2, 0, 0], c: WOOD }, // grip
    { s: [0.03, 0.025, 0.12], p: [0, -0.115, 0.13], c: 0x4a2f6e }, // trigger guard
  ],
  // Spud-o-Matic: banded wooden pipe with a lumpy loaded potato, pressure tank
  // with brass valve + green gauge underneath.
  potato: [
    { s: [0.16, 0.16, 0.54], p: [0, 0.03, 0.33], c: 0x5a3a22, cyl: true }, // wood pipe
    { s: [0.175, 0.175, 0.05], p: [0, 0.03, 0.14], c: STEEL_LT, cyl: true }, // band
    { s: [0.175, 0.175, 0.05], p: [0, 0.03, 0.5], c: STEEL_LT, cyl: true }, // band
    { s: [0.21, 0.18, 0.2], p: [0, 0.04, 0.64], r: [0.4, 0.3, 0.2], c: 0xc9a05a }, // loaded spud
    { s: [0.1, 0.09, 0.1], p: [0.06, 0.1, 0.68], r: [0.2, 0.5, 0.1], c: 0xb88e4e }, // spud lump
    { s: [0.13, 0.13, 0.26], p: [0, -0.12, 0.3], c: 0x6a6e75, cyl: true }, // air tank
    { s: [0.05, 0.05, 0.06], p: [0, -0.12, 0.45], c: BRASS, cyl: true }, // valve
    { s: [0.04, 0.04, 0.04], p: [0.085, -0.12, 0.38], c: 0x8fcf6f, glow: true }, // gauge
    { s: [0.15, 0.16, 0.18], p: [0, -0.02, 0.05], c: 0x4a3019 }, // stock block
    { s: [0.11, 0.18, 0.12], p: [0, -0.16, 0.04], r: [0.2, 0, 0], c: 0x3a2614 }, // grip
    { s: [0.03, 0.025, 0.11], p: [0, -0.12, 0.12], c: 0x2a2018 }, // trigger guard
  ],
  // Fish Slapper: a whole trout on a handle — pale belly, V tail, fins,
  // googly glow eyes and a brass pommel on the wooden hilt.
  fish: [
    { s: [0.22, 0.34, 0.46], p: [0, 0.07, 0.3], c: 0x6aa0c0 }, // body
    { s: [0.2, 0.16, 0.4], p: [0, -0.05, 0.28], c: 0xbfdce8 }, // belly
    { s: [0.05, 0.16, 0.26], p: [0, 0.3, 0.28], r: [0.3, 0, 0], c: 0x4a80a0 }, // dorsal fin
    { s: [0.05, 0.22, 0.18], p: [0, 0.18, 0.58], r: [-0.55, 0, 0], c: 0x4a80a0 }, // tail upper
    { s: [0.05, 0.22, 0.18], p: [0, -0.02, 0.58], r: [0.55, 0, 0], c: 0x4a80a0 }, // tail lower
    { s: [0.14, 0.05, 0.16], p: [-0.15, -0.02, 0.18], r: [0, 0.3, 0.25], c: 0x5a90b0 }, // pectoral L
    { s: [0.14, 0.05, 0.16], p: [0.15, -0.02, 0.18], r: [0, -0.3, -0.25], c: 0x5a90b0 }, // pectoral R
    { s: [0.18, 0.07, 0.05], p: [0, 0, 0.065], c: 0x27404f }, // open mouth
    { s: [0.06, 0.06, 0.03], p: [-0.115, 0.16, 0.14], c: 0xffffff, glow: true, gi: 0.7 }, // eye L
    { s: [0.06, 0.06, 0.03], p: [0.115, 0.16, 0.14], c: 0xffffff, glow: true, gi: 0.7 }, // eye R
    { s: [0.025, 0.025, 0.02], p: [-0.15, 0.16, 0.14], c: IRON }, // pupil L
    { s: [0.025, 0.025, 0.02], p: [0.15, 0.16, 0.14], c: IRON }, // pupil R
    { s: [0.1, 0.2, 0.11], p: [0, -0.18, 0.04], r: [0.15, 0, 0], c: WOOD }, // hilt
    { s: [0.11, 0.04, 0.12], p: [0, -0.285, 0.02], r: [0.15, 0, 0], c: BRASS }, // pommel
  ],
  // Rubber Chicken: full bird — wings, ruffled tail, neck + head with glowing
  // beak and comb, beady eyes, all mounted on a wooden handle.
  chicken: [
    { s: [0.24, 0.26, 0.4], p: [0, 0.05, 0.26], c: 0xffe14a }, // body
    { s: [0.05, 0.16, 0.28], p: [-0.14, 0.06, 0.24], r: [0, 0, 0.15], c: 0xf0c93a }, // wing L
    { s: [0.05, 0.16, 0.28], p: [0.14, 0.06, 0.24], r: [0, 0, -0.15], c: 0xf0c93a }, // wing R
    { s: [0.07, 0.2, 0.12], p: [0, 0.18, 0.05], r: [-0.6, 0, 0], c: 0xf0c93a }, // tail feathers
    { s: [0.13, 0.1, 0.13], p: [0, 0.18, 0.42], c: 0xffe14a }, // neck
    { s: [0.16, 0.18, 0.16], p: [0, 0.28, 0.46], c: 0xffe14a }, // head
    { s: [0.07, 0.045, 0.09], p: [0, 0.28, 0.57], c: 0xff8a3a, glow: true }, // beak
    { s: [0.035, 0.08, 0.035], p: [0, 0.2, 0.55], c: 0xe04a4a }, // wattle
    { s: [0.045, 0.08, 0.06], p: [0, 0.4, 0.46], c: 0xff5d6c, glow: true }, // comb
    { s: [0.045, 0.06, 0.05], p: [0, 0.39, 0.52], c: 0xff5d6c, glow: true }, // comb
    { s: [0.025, 0.025, 0.02], p: [-0.085, 0.31, 0.51], c: IRON }, // eye L
    { s: [0.025, 0.025, 0.02], p: [0.085, 0.31, 0.51], c: IRON }, // eye R
    { s: [0.1, 0.18, 0.11], p: [0, -0.14, 0.04], r: [0.18, 0, 0], c: WOOD }, // handle
    { s: [0.03, 0.025, 0.11], p: [0, -0.095, 0.12], c: 0x3a2f25 }, // trigger guard
  ],
  // Bee Swarm Jar: glass jar of glowing honey, brass-knobbed lid, a spout the
  // bees escape from — each bee gets tiny white wings — plus a honey drip.
  beejar: [
    { s: [0.28, 0.34, 0.3], p: [0, 0.06, 0.26], c: 0xbfe0e8 }, // glass jar
    { s: [0.24, 0.14, 0.26], p: [0, -0.04, 0.26], c: 0xe8a82e, glow: true, gi: 0.5 }, // honey
    { s: [0.3, 0.07, 0.32], p: [0, 0.265, 0.26], c: 0x8a6a3a }, // lid
    { s: [0.08, 0.045, 0.08], p: [0, 0.32, 0.26], c: 0x6e5430 }, // lid knob
    { s: [0.09, 0.09, 0.08], p: [0, 0.06, 0.44], c: 0x8a6a3a, cyl: true }, // spout
    { s: [0.065, 0.065, 0.065], p: [0.08, 0.1, 0.3], c: AMBER, glow: true }, // bee
    { s: [0.08, 0.015, 0.04], p: [0.08, 0.145, 0.3], c: 0xeef6ff }, // wings
    { s: [0.06, 0.06, 0.06], p: [-0.07, 0.16, 0.22], c: AMBER, glow: true }, // bee
    { s: [0.075, 0.015, 0.04], p: [-0.07, 0.2, 0.22], c: 0xeef6ff }, // wings
    { s: [0.06, 0.06, 0.06], p: [0.02, 0.08, 0.53], c: AMBER, glow: true }, // escaping bee
    { s: [0.075, 0.015, 0.04], p: [0.02, 0.12, 0.53], c: 0xeef6ff }, // wings
    { s: [0.04, 0.09, 0.04], p: [0.06, -0.15, 0.3], c: 0xe8a82e, glow: true, gi: 0.8 }, // honey drip
    { s: [0.11, 0.18, 0.12], p: [0, -0.15, 0.06], r: [0.18, 0, 0], c: 0x2a2a2e }, // grip
  ],
  // The Quacker: green BFG with a huge bore + glowing core, emissive cooling
  // fins, carry handle, foregrip — and its mascot rubber duck riding on top.
  bfg: [
    { s: [0.3, 0.3, 0.46], p: [0, 0.01, 0.26], c: 0x2a3a2e }, // body
    { s: [0.4, 0.4, 0.26], p: [0, 0.02, 0.57], c: 0x3a4a3e, cyl: true }, // big barrel
    { s: [0.27, 0.27, 0.18], p: [0, 0.02, 0.68], c: 0x8fcf6f, cyl: true, glow: true }, // plasma core
    { s: [0.06, 0.26, 0.3], p: [-0.21, 0.02, 0.3], c: 0x4ec98f, glow: true }, // fin L
    { s: [0.06, 0.26, 0.3], p: [0.21, 0.02, 0.3], c: 0x4ec98f, glow: true }, // fin R
    { s: [0.2, 0.03, 0.1], p: [0, 0.17, 0.08], c: 0x8fcf6f, glow: true, gi: 0.7 }, // vent slit
    { s: [0.04, 0.06, 0.04], p: [0, 0.19, 0.14], c: POLY }, // handle post
    { s: [0.04, 0.06, 0.04], p: [0, 0.19, 0.36], c: POLY }, // handle post
    { s: [0.05, 0.04, 0.3], p: [0, 0.24, 0.25], c: POLY }, // carry handle
    { s: [0.11, 0.09, 0.13], p: [0, 0.27, 0.55], c: 0xffe14a }, // rubber duck
    { s: [0.07, 0.07, 0.07], p: [0, 0.345, 0.59], c: 0xffe14a }, // duck head
    { s: [0.05, 0.025, 0.05], p: [0, 0.34, 0.64], c: 0xff8a3a, glow: true }, // duck beak
    { s: [0.13, 0.22, 0.13], p: [0, -0.17, 0.06], r: [0.18, 0, 0], c: 0x1f2a22 }, // grip
    { s: [0.1, 0.15, 0.1], p: [0, -0.2, 0.42], c: 0x1f2a22 }, // foregrip
    { s: [0.035, 0.025, 0.13], p: [0, -0.15, 0.15], c: 0x1f2a22 }, // trigger guard
  ],

  // ---- new wonder/variety guns ----
  // Railspike: braced twin accelerator rails feed a white-hot muzzle node and
  // floating spike gem; rear capacitor drum with a glowing charge ring.
  rail: [
    { s: [0.1, 0.12, 0.88], p: [0, 0.02, 0.5], c: 0x2a2e34 }, // spine
    { s: [0.04, 0.05, 0.84], p: [-0.095, 0.07, 0.5], c: 0x7fe6ff, glow: true }, // charge rail L
    { s: [0.04, 0.05, 0.84], p: [0.095, 0.07, 0.5], c: 0x7fe6ff, glow: true }, // charge rail R
    { s: [0.26, 0.07, 0.05], p: [0, 0.05, 0.3], c: 0x33373d }, // cross brace
    { s: [0.26, 0.07, 0.05], p: [0, 0.05, 0.66], c: 0x33373d }, // cross brace
    { s: [0.16, 0.14, 0.08], p: [0, 0.04, 0.94], c: 0x33373d }, // muzzle housing
    { s: [0.06, 0.06, 0.1], p: [0, 0.05, 1], c: 0xeafcff, glow: true }, // muzzle node
    { s: [0.05, 0.05, 0.05], p: [0, 0.05, 1.07], r: [QUARTER, 0, QUARTER], c: 0xeafcff, glow: true }, // spike gem
    { s: [0.2, 0.2, 0.28], p: [0, -0.01, 0.16], c: 0x33373d }, // receiver
    { s: [0.15, 0.15, 0.18], p: [0, 0.03, -0.04], c: 0x2a2e34, cyl: true }, // capacitor drum
    { s: [0.16, 0.16, 0.035], p: [0, 0.03, -0.11], c: 0x7fe6ff, cyl: true, glow: true }, // charge ring
    { s: [0.12, 0.12, 0.05], p: [0, 0.03, -0.16], c: 0x20242a, cyl: true }, // drum cap
    { s: [0.09, 0.14, 0.12], p: [0, -0.14, 0.28], c: 0x20242a }, // power cell
    { s: [0.095, 0.03, 0.125], p: [0, -0.21, 0.28], c: 0x7fe6ff, glow: true }, // cell base
    { s: [0.11, 0.18, 0.12], p: [0, -0.15, 0.08], r: [0.2, 0, 0], c: 0x20242a }, // grip
    { s: [0.03, 0.025, 0.12], p: [0, -0.115, 0.17], c: 0x20242a }, // trigger guard
  ],
  // Boomeranger: carved wooden launcher with a real V-blade boomerang docked
  // on the rail — painted tips, glowing hub gem, brass winder disc.
  boomerang: [
    { s: [0.15, 0.15, 0.4], p: [0, -0.02, 0.2], c: 0x3a2e1e }, // launcher body
    { s: [0.06, 0.045, 0.34], p: [0, 0.065, 0.26], c: 0x2a2018 }, // launch rail
    { s: [0.08, 0.08, 0.08], p: [0, 0.13, 0.52], r: [QUARTER, 0, QUARTER], c: 0xfff0b0, glow: true }, // hub gem
    { s: [0.3, 0.05, 0.09], p: [0.115, 0.13, 0.44], r: [0, 0.6, 0], c: 0xd9a23a }, // blade arm A
    { s: [0.3, 0.05, 0.09], p: [0.115, 0.13, 0.6], r: [0, -0.6, 0], c: 0xd9a23a }, // blade arm B
    { s: [0.06, 0.055, 0.095], p: [0.23, 0.13, 0.36], r: [0, 0.6, 0], c: 0xb33a2e }, // painted tip A
    { s: [0.06, 0.055, 0.095], p: [0.23, 0.13, 0.68], r: [0, -0.6, 0], c: 0xb33a2e }, // painted tip B
    { s: [0.06, 0.06, 0.04], p: [-0.085, 0, 0.2], r: [0, Math.PI / 2, 0], c: BRASS, cyl: true }, // winder disc
    { s: [0.11, 0.18, 0.12], p: [0, -0.16, 0.05], r: [0.2, 0, 0], c: 0x4a3019 }, // grip
    { s: [0.03, 0.025, 0.11], p: [0, -0.105, 0.13], c: 0x2a2018 }, // trigger guard
  ],
  // Tesla Coil: copper coil tower wrapped in glowing rings under a crackling
  // orb; twin arc prongs flank a floating emitter gem, battery cell below.
  tesla: [
    { s: [0.2, 0.22, 0.42], p: [0, 0, 0.24], c: 0x2a2a3a }, // housing
    { s: [0.045, 0.045, 0.24], p: [-0.09, 0.05, 0.52], c: 0xbfeaff, glow: true }, // arc prong L
    { s: [0.045, 0.045, 0.24], p: [0.09, 0.05, 0.52], c: 0xbfeaff, glow: true }, // arc prong R
    { s: [0.11, 0.11, 0.11], p: [0, 0.05, 0.62], r: [QUARTER, 0, QUARTER], c: 0xeaf6ff, glow: true }, // emitter gem
    { s: [0.07, 0.07, 0.16], p: [0, 0.17, 0.14], r: [Math.PI / 2, 0, 0], c: 0xc08a4a, cyl: true }, // copper coil
    { s: [0.15, 0.15, 0.03], p: [0, 0.12, 0.14], r: [Math.PI / 2, 0, 0], c: 0x6ad7ff, cyl: true, glow: true }, // coil ring
    { s: [0.14, 0.14, 0.03], p: [0, 0.17, 0.14], r: [Math.PI / 2, 0, 0], c: 0x6ad7ff, cyl: true, glow: true }, // coil ring
    { s: [0.13, 0.13, 0.03], p: [0, 0.22, 0.14], r: [Math.PI / 2, 0, 0], c: 0x6ad7ff, cyl: true, glow: true }, // coil ring
    { s: [0.13, 0.13, 0.13], p: [0, 0.3, 0.14], r: [QUARTER, 0, QUARTER], c: 0x6ad7ff, glow: true }, // tesla orb
    { s: [0.12, 0.1, 0.16], p: [0, -0.14, 0.34], c: 0x1d1d2a }, // battery cell
    { s: [0.125, 0.025, 0.165], p: [0, -0.185, 0.34], c: 0x6ad7ff, glow: true }, // cell base
    { s: [0.11, 0.18, 0.12], p: [0, -0.15, 0.06], r: [0.2, 0, 0], c: 0x202030 }, // grip
    { s: [0.03, 0.025, 0.11], p: [0, -0.12, 0.14], c: 0x202030 }, // trigger guard
  ],
};

/** Build a fresh gun model group for a style (defaults to a pistol). */
export function buildGun(style: GunStyle): THREE.Group {
  const g = new THREE.Group();
  for (const part of STYLES[style] ?? STYLES.pistol) {
    const mat = part.glow ? glowMaterial(part.c, part.gi ?? 1.1) : voxelMaterial(part.c);
    const m = new THREE.Mesh(part.cyl ? TUBE : UNIT, mat);
    m.scale.set(part.s[0], part.s[1], part.s[2]);
    m.position.set(part.p[0], part.p[1], part.p[2]);
    if (part.r) m.rotation.set(part.r[0], part.r[1], part.r[2]);
    m.castShadow = !part.glow;
    g.add(m);
  }
  return g;
}
