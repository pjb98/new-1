import * as THREE from "three";
import { VoxelChar } from "./voxelChar";
import { findSkin } from "./cosmetics";
import { skinTexture } from "./skintex";

/**
 * Offscreen thumbnails of the voxel hero wearing each skin, for the Skins tab —
 * the cosmetics counterpart to petThumbnail. Renders the actual character (with
 * the skin's body/head + high-rarity glow) once to a data-URL, cached by id.
 */

const SIZE = 256;
const cache = new Map<string, string>();

let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.OrthographicCamera | undefined;

function ensure(): boolean {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2);
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 5, 4);
    const fill = new THREE.DirectionalLight(0xbfd8ff, 0.6);
    fill.position.set(-4, 2, 2);
    const rim = new THREE.DirectionalLight(0xfff2d0, 0.7);
    rim.position.set(-1, 3, -4);
    const amb = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(key, fill, rim, amb);
    // frame the ~2.4-tall hero head-to-toe with a gentle 3/4 angle
    const half = 1.45;
    camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 100);
    camera.position.set(1.4, 2.1, 3.4);
    camera.lookAt(0, 1.05, 0);
    return true;
  } catch {
    renderer = undefined;
    return false;
  }
}

function disposeGroup(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

/** A data-URL PNG of the hero in the given skin, or "" if WebGL is unavailable. */
export function skinThumbnail(skinId: string): string {
  const hit = cache.get(skinId);
  if (hit !== undefined) return hit;
  if (!ensure() || !renderer || !scene || !camera) {
    cache.set(skinId, "");
    return "";
  }
  const skin = findSkin(skinId);
  const char = new VoxelChar({
    body: skin.body, head: skin.head, eye: 0x222222, gun: true,
    cosmetic: { hat: skin.hat, hatColor: skin.hatColor, back: skin.back, backColor: skin.backColor },
  });
  const tex = skinTexture(skin.id);
  if (tex) char.applyTexture(tex, skin.glow ?? 0x000000);
  else if (skin.glow) char.setColor(skin.body, skin.head, skin.glow);
  char.root.rotation.y = -Math.PI * 0.12;
  scene.add(char.root);
  let url = "";
  try {
    renderer.render(scene, camera);
    url = renderer.domElement.toDataURL("image/png");
  } catch {
    url = "";
  }
  scene.remove(char.root);
  disposeGroup(char.root);
  cache.set(skinId, url);
  return url;
}
