import * as THREE from "three";
import { Pet, findAnyPet, petStage } from "./pets";
import { PET_STAGES } from "./config";

/**
 * Offscreen pet-model thumbnails for the shop. Renders each pet's actual voxel
 * model once to a small data-URL (cached by id), so the Pets tab can show a real
 * preview of what you're buying instead of a flat colour dot.
 *
 * One tiny shared WebGL renderer + scene, used lazily and synchronously. Each
 * model is built, snapshotted, then disposed — nothing lingers on the GPU.
 */

const SIZE = 256; // px (square) — high-res hero shot, displayed big in the card
const cache = new Map<string, string>();

let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.OrthographicCamera | undefined;

function ensure(): boolean {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2); // crisp on hi-dpi; SIZE×2 internal
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0); // transparent — card supplies the plinth
    scene = new THREE.Scene();
    // 3-point studio lighting so the voxel facets + cute faces pop
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 5, 4);
    const fill = new THREE.DirectionalLight(0xbfd8ff, 0.6); // cool fill from the left
    fill.position.set(-4, 2, 2);
    const rim = new THREE.DirectionalLight(0xfff2d0, 0.7); // warm rim from behind
    rim.position.set(-1, 3, -4);
    const amb = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(key, fill, rim, amb);
    // tight orthographic framing of the ~1.2-unit-tall pet — fills the canvas.
    // Pets build their FACE on +Z, so the camera looks down the -Z axis (from
    // in front) with a gentle high angle for a cute 3/4 portrait — every pet
    // faces the lens instead of showing its back/side.
    const half = 0.82;
    camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 100);
    camera.position.set(0.55, 1.25, 2.7); // mostly head-on +Z, slightly up & right
    camera.lookAt(0, 0.12, 0);
    return true;
  } catch {
    renderer = undefined; // headless/no-WebGL — fall back to no thumbnail
    return false;
  }
}

function disposeGroup(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !(m.geometry as { userData?: { shared?: boolean } }).userData?.shared) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

/**
 * A data-URL PNG of the pet's voxel model, or "" if WebGL is unavailable.
 * Cached per pet id + evolution stage — the card shows the pet's CURRENT form
 * (base / Evolved / Ascended), so an evolved pet's thumbnail grows wings &
 * crown to match what's in the field. Re-rendered once per stage, not per level.
 */
export function petThumbnail(petId: string, level = 1): string {
  const stage = petStage(level);
  const key = `${petId}:${stage}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const def = findAnyPet(petId);
  if (!def || !ensure() || !renderer || !scene || !camera) {
    cache.set(key, "");
    return "";
  }
  // Build at a representative level for the stage (stable framing per stage).
  const pet = new Pet(def, 0, PET_STAGES.levels[stage] ?? 1, false);
  // Evolved kits (wings/crown/aura) are wider + taller, so pull the model into
  // frame; the big Celestials (Chronos/Oracle) need it even at base.
  const big = def.shape === "chronos" || def.shape === "oracle";
  let frame = big ? 0.62 : 0; // 0 = keep the model's own scale
  if (stage >= 1) frame = big ? (stage >= 2 ? 0.42 : 0.5) : (stage >= 2 ? 0.52 : 0.6);
  if (frame) pet.group.scale.setScalar(frame);
  pet.group.position.set(0, -0.15, 0);
  pet.group.rotation.y = -Math.PI * 0.1; // tiny turn toward the camera (face stays to lens)
  scene.add(pet.group);
  let url = "";
  try {
    renderer.render(scene, camera);
    url = renderer.domElement.toDataURL("image/png");
  } catch {
    url = "";
  }
  scene.remove(pet.group);
  disposeGroup(pet.group);
  cache.set(key, url);
  return url;
}
