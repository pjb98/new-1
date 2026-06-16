import * as THREE from "three";
import { EventBus, EV } from "../EventBus";
import { GameState, PotState } from "../save";
import { getStrain } from "../strains";
import { COLORS } from "../constants";

// ----- helpers -----
function mat(color: number, emissive = 0, emissiveIntensity = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, emissive, emissiveIntensity });
}

function box(w: number, h: number, d: number, color: number, emissive = 0, ei = 0) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, emissive, ei));
}

const STAGE_COLORS: Record<string, number> = {
  planted: 0x8d5524,
  seedling: 0x66bb6a,
  vegetative: 0x2e7d32,
  flowering: 0xab47bc,
  ready: 0xffd700,
  empty: 0x4a3728,
};

const PLANT_HEIGHTS: Record<string, number> = {
  planted: 0.05,
  seedling: 0.15,
  vegetative: 0.3,
  flowering: 0.42,
  ready: 0.5,
  empty: 0,
};

// ----- Pot visual -----
class PotMesh {
  readonly group = new THREE.Group();
  private potMesh!: THREE.Mesh;
  private plantGroup = new THREE.Group();
  private barWBg!: THREE.Mesh;
  private barWFg!: THREE.Mesh;
  private barNBg!: THREE.Mesh;
  private barNFg!: THREE.Mesh;
  private glowLight?: THREE.PointLight;

  constructor(public readonly index: number) {
    // Pot body
    this.potMesh = box(0.65, 0.5, 0.65, COLORS.pot);
    this.potMesh.position.y = 0.25;
    this.group.add(this.potMesh);

    // Soil top
    const soil = box(0.62, 0.05, 0.62, COLORS.soil);
    soil.position.y = 0.52;
    this.group.add(soil);

    // Plant group
    this.plantGroup.position.y = 0.54;
    this.group.add(this.plantGroup);

    // Water bar (blue)
    this.barWBg = box(0.62, 0.04, 0.05, 0x333333);
    this.barWBg.position.set(0, 0.08, 0.35);
    this.group.add(this.barWBg);
    this.barWFg = box(0.62, 0.04, 0.05, 0x4fc3f7);
    this.barWFg.position.set(0, 0.08, 0.35);
    this.group.add(this.barWFg);

    // Nutrient bar (green)
    this.barNBg = box(0.62, 0.04, 0.05, 0x333333);
    this.barNBg.position.set(0, 0.02, 0.35);
    this.group.add(this.barNBg);
    this.barNFg = box(0.62, 0.04, 0.05, 0x66bb6a);
    this.barNFg.position.set(0, 0.02, 0.35);
    this.group.add(this.barNFg);

    // Make pot clickable
    this.potMesh.userData.potIndex = index;
  }

  get clickTarget() { return this.potMesh; }

  update(pot: PotState) {
    // Update plant
    this.plantGroup.clear();
    if (pot.stage !== "empty" && pot.strainId) {
      const h = PLANT_HEIGHTS[pot.stage] ?? 0.1;
      const stalkH = h * 0.7;
      const stalk = box(0.05, stalkH, 0.05, 0x4e342e);
      stalk.position.y = stalkH / 2;
      this.plantGroup.add(stalk);

      const budColor = STAGE_COLORS[pot.stage] ?? 0x4caf50;
      if (pot.stage !== "planted") {
        for (let i = 0; i < 3; i++) {
          const bud = box(0.12 + i * 0.04, 0.12, 0.12 + i * 0.04, budColor);
          const angle = (i / 3) * Math.PI * 2;
          bud.position.set(Math.cos(angle) * 0.1, stalkH + 0.06, Math.sin(angle) * 0.1);
          this.plantGroup.add(bud);
        }
      }

      // Ready glow
      if (pot.stage === "ready") {
        if (!this.glowLight) {
          this.glowLight = new THREE.PointLight(0xffd700, 1.5, 1.2);
          this.glowLight.position.y = 0.8;
          this.group.add(this.glowLight);
        }
      } else {
        if (this.glowLight) {
          this.group.remove(this.glowLight);
          this.glowLight = undefined;
        }
      }
    } else {
      if (this.glowLight) {
        this.group.remove(this.glowLight);
        this.glowLight = undefined;
      }
    }

    // Update bars
    const wPct = Math.max(0, Math.min(1, pot.waterLevel / 100));
    const nPct = Math.max(0, Math.min(1, pot.nutrientLevel / 100));
    const wColor = wPct < 0.3 ? 0xff5252 : 0x4fc3f7;
    const nColor = nPct < 0.3 ? 0xff5252 : 0x66bb6a;
    (this.barWFg.material as THREE.MeshStandardMaterial).color.setHex(wColor);
    (this.barNFg.material as THREE.MeshStandardMaterial).color.setHex(nColor);
    this.barWFg.scale.x = wPct;
    this.barWFg.position.x = (wPct - 1) * 0.31;
    this.barNFg.scale.x = nPct;
    this.barNFg.position.x = (nPct - 1) * 0.31;

    // Pot color based on type
    const potColors: Record<string, number> = {
      basic_pot: COLORS.pot,
      big_pot: 0x5d4037,
      smart_pot: 0x37474f,
      diamond_pot: 0x1565c0,
    };
    (this.potMesh.material as THREE.MeshStandardMaterial).color.setHex(potColors[pot.potType] ?? COLORS.pot);
  }

  pulseReady(t: number) {
    if (this.glowLight) {
      this.glowLight.intensity = 1 + Math.sin(t * 4) * 0.5;
    }
  }
}

// ----- FarmView -----
export class FarmView {
  readonly scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private potMeshes: PotMesh[] = [];
  private raycaster = new THREE.Raycaster();
  private t = 0;
  private grow_light?: THREE.SpotLight;

  init(renderer: THREE.WebGLRenderer, state: GameState) {
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.Fog(0x0d1117, 12, 22);

    this.camera = new THREE.PerspectiveCamera(55, renderer.domElement.width / renderer.domElement.height, 0.1, 100);
    this.camera.position.set(0, 6, 8);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0x223344, 0.6);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x334455, 0x221100, 0.4);
    this.scene.add(hemi);

    // Grow light
    this.grow_light = new THREE.SpotLight(0xff44aa, 3, 14, Math.PI / 4, 0.3, 1.5);
    this.grow_light.position.set(0, 6, 0);
    this.grow_light.castShadow = true;
    this.scene.add(this.grow_light);
    this.scene.add(this.grow_light.target);

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), mat(COLORS.floor));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Walls
    const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), mat(COLORS.wall));
    wallBack.position.set(0, 2.5, -6);
    this.scene.add(wallBack);

    const wallLeft = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), mat(COLORS.wall));
    wallLeft.position.set(-7, 2.5, 0);
    wallLeft.rotation.y = Math.PI / 2;
    this.scene.add(wallLeft);

    const wallRight = wallLeft.clone();
    wallRight.position.set(7, 2.5, 0);
    wallRight.rotation.y = -Math.PI / 2;
    this.scene.add(wallRight);

    // Ceiling light bars
    for (let i = -2; i <= 2; i++) {
      const bar = box(0.2, 0.08, 3.5, 0xffffff, 0xffffff, 2);
      bar.position.set(i * 1.5, 4.9, -1.5);
      this.scene.add(bar);
      const ptl = new THREE.PointLight(0xffa0e0, 0.6, 4);
      ptl.position.set(i * 1.5, 4.5, -1.5);
      this.scene.add(ptl);
    }

    // Build pot grid
    const cols = 4;
    const rowCount = Math.ceil(state.pots.length / cols);
    const spacingX = 2.0;
    const spacingZ = 2.2;
    const startX = -((cols - 1) / 2) * spacingX;
    const startZ = -((rowCount - 1) / 2) * spacingZ - 0.5;

    state.pots.forEach((pot, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const pm = new PotMesh(i);
      pm.group.position.set(startX + col * spacingX, 0, startZ + row * spacingZ);
      pm.update(pot);
      this.scene.add(pm.group);
      this.potMeshes.push(pm);
    });

    // Click handler
    renderer.domElement.addEventListener("click", (e) => this.onClick(e, renderer, state));
  }

  private onClick(e: MouseEvent, renderer: THREE.WebGLRenderer, state: GameState) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = this.potMeshes.map(pm => pm.clickTarget);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      const idx = hits[0].object.userData.potIndex as number;
      EventBus.emit(EV.POT_CLICKED, { potIndex: idx, pot: state.pots[idx] });
    }
  }

  updatePot(pot: PotState) {
    this.potMeshes[pot.id]?.update(pot);
  }

  update(dt: number, state: GameState) {
    this.t += dt;
    // Pulse grow light
    if (this.grow_light) {
      this.grow_light.intensity = 2.5 + Math.sin(this.t * 0.8) * 0.5;
    }
    // Pulse ready pots
    this.potMeshes.forEach((pm, i) => {
      if (state.pots[i]?.stage === "ready") pm.pulseReady(this.t);
    });
  }

  onResize(renderer: THREE.WebGLRenderer) {
    this.camera.aspect = renderer.domElement.width / renderer.domElement.height;
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, this.camera);
  }

  dispose(renderer: THREE.WebGLRenderer) {
    renderer.domElement.replaceWith(renderer.domElement.cloneNode() as HTMLCanvasElement);
  }
}
