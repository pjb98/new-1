import * as THREE from "three";
import { EventBus, EV } from "../EventBus";
import { GameState, CUSTOMERS } from "../save";
import { VoxelChar } from "../VoxelChar";
import { Audio } from "../audio";

const MOVE_SPEED = 4;
const STREET_LENGTH = 28;
const STREET_WIDTH = 10;

const NPC_COLORS = [0x4fc3f7, 0xff8a65, 0xce93d8, 0xa5d6a7, 0xffd54f, 0xef9a9a, 0x80deea, 0xffcc80];

function mat(color: number) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
}

function box(w: number, h: number, d: number, color: number) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
}

class NpcChar {
  readonly char: VoxelChar;
  private baseX: number;
  private dir = 1;
  private t = 0;

  constructor(color: number, x: number, z: number) {
    this.char = new VoxelChar(color, 0xf4c2a1);
    this.char.root.position.set(x, 0, z);
    this.baseX = x;
    this.char.setWalking(true);
  }

  update(dt: number) {
    this.t += dt;
    this.char.update(dt);
    const speed = 1.2;
    this.char.root.position.x += this.dir * speed * dt;
    if (Math.abs(this.char.root.position.x - this.baseX) > 3) {
      this.dir *= -1;
      this.char.root.rotation.y = this.dir > 0 ? 0 : Math.PI;
    }
  }
}

export class StreetView {
  readonly scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private player!: VoxelChar;
  private npcs: NpcChar[] = [];
  private keys: Record<string, boolean> = {};
  private t = 0;
  private keyDown!: (e: KeyboardEvent) => void;
  private keyUp!: (e: KeyboardEvent) => void;

  init(renderer: THREE.WebGLRenderer, state: GameState) {
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 18, 30);

    this.camera = new THREE.PerspectiveCamera(60, renderer.domElement.width / renderer.domElement.height, 0.1, 100);

    // Lighting
    const ambient = new THREE.AmbientLight(0x334466, 0.5);
    this.scene.add(ambient);

    const moon = new THREE.DirectionalLight(0x8899cc, 0.6);
    moon.position.set(5, 10, 5);
    this.scene.add(moon);

    // Street lamps
    for (let i = -STREET_LENGTH / 2 + 4; i < STREET_LENGTH / 2; i += 6) {
      const pole = box(0.1, 4, 0.1, 0x555555);
      pole.position.set(STREET_WIDTH / 2 - 0.5, 2, i);
      this.scene.add(pole);
      const lampHead = box(0.4, 0.15, 0.4, 0x888888);
      lampHead.position.set(STREET_WIDTH / 2 - 0.5, 4.1, i);
      this.scene.add(lampHead);
      const ptl = new THREE.PointLight(0xffee88, 1.2, 8);
      ptl.position.set(STREET_WIDTH / 2 - 0.5, 3.9, i);
      this.scene.add(ptl);
    }

    // Road
    const road = new THREE.Mesh(new THREE.PlaneGeometry(STREET_WIDTH, STREET_LENGTH), mat(0x222233));
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    this.scene.add(road);

    // Sidewalks
    for (const sx of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(3, STREET_LENGTH), mat(0x2a2a3a));
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(sx * (STREET_WIDTH / 2 + 1.5), 0.01, 0);
      this.scene.add(sw);
    }

    // Road markings (dashes)
    for (let i = -STREET_LENGTH / 2 + 2; i < STREET_LENGTH / 2; i += 3) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 1.5), mat(0xffd700));
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.02, i);
      this.scene.add(dash);
    }

    // Buildings
    this.buildBuildings();

    // Player
    this.player = new VoxelChar(0x4caf50, 0xf4c2a1);
    this.player.root.position.set(0, 0, 4);
    this.scene.add(this.player.root);

    // NPCs (customers)
    const unlocked = state.unlockedCustomers ?? [];
    CUSTOMERS.forEach((c, i) => {
      if (state.level >= c.unlockLevel || unlocked.includes(c.id)) {
        const color = NPC_COLORS[i % NPC_COLORS.length];
        const npc = new NpcChar(color, (i % 3 - 1) * 2.5, -4 - i * 2.5);
        this.scene.add(npc.char.root);
        this.npcs.push(npc);
      }
    });

    // Return home sign
    const signGeom = new THREE.BoxGeometry(1.8, 0.5, 0.1);
    const sign = new THREE.Mesh(signGeom, mat(0x1b5e20));
    sign.position.set(-STREET_WIDTH / 2 + 0.5, 1.5, STREET_LENGTH / 2 - 1);
    this.scene.add(sign);

    // Input
    this.keyDown = (e) => { this.keys[e.code] = true; };
    this.keyUp = (e) => { this.keys[e.code] = false; };
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);

    // Back-to-farm button click area label
    EventBus.emit(EV.SCENE_CHANGE, "street");
  }

  private buildBuildings() {
    const configs = [
      { x: -9, z: -8, w: 4, h: 6, d: 3, color: 0x1a237e },
      { x: 9, z: -4, w: 3.5, h: 8, d: 3, color: 0x880e4f },
      { x: -9, z: 4, w: 5, h: 4, d: 3, color: 0x1b5e20 },
      { x: 9, z: 8, w: 4, h: 7, d: 3, color: 0x4a148c },
      { x: -9, z: -14, w: 3, h: 5, d: 3, color: 0x0d47a1 },
      { x: 9, z: -12, w: 4, h: 6, d: 3, color: 0xb71c1c },
    ];
    configs.forEach(cfg => {
      const b = box(cfg.w, cfg.h, cfg.d, cfg.color);
      b.position.set(cfg.x, cfg.h / 2, cfg.z);
      this.scene.add(b);
      // Windows
      for (let wx = 0; wx < 2; wx++) {
        for (let wy = 0; wy < 3; wy++) {
          const win = box(0.4, 0.5, 0.05, Math.random() > 0.4 ? 0xffee88 : 0x223344);
          win.position.set(cfg.x + (wx - 0.5) * 1.2, cfg.h / 2 - 1 + wy * 1.5, cfg.z + cfg.d / 2 + 0.03);
          this.scene.add(win);
        }
      }
    });
  }

  update(dt: number, state: GameState) {
    this.t += dt;
    let dx = 0;
    let dz = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) dz -= MOVE_SPEED * dt;
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) dz += MOVE_SPEED * dt;
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) dx -= MOVE_SPEED * dt;
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) dx += MOVE_SPEED * dt;

    const isMoving = dx !== 0 || dz !== 0;
    this.player.setWalking(isMoving);
    this.player.update(dt);

    if (isMoving) {
      const nx = Math.max(-STREET_WIDTH / 2 + 0.3, Math.min(STREET_WIDTH / 2 - 0.3, this.player.root.position.x + dx));
      const nz = Math.max(-STREET_LENGTH / 2 + 0.3, Math.min(STREET_LENGTH / 2 - 0.3, this.player.root.position.z + dz));
      this.player.root.position.set(nx, 0, nz);
      if (dx !== 0) this.player.root.rotation.y = dx > 0 ? -Math.PI / 2 : Math.PI / 2;
      else this.player.root.rotation.y = dz > 0 ? Math.PI : 0;
    }

    // Camera follows player
    this.camera.position.set(
      this.player.root.position.x,
      4.5,
      this.player.root.position.z + 7
    );
    this.camera.lookAt(this.player.root.position.x, 1, this.player.root.position.z);

    // NPCs
    this.npcs.forEach(n => n.update(dt));

    // If player walks to north edge → go home
    if (this.player.root.position.z <= -STREET_LENGTH / 2 + 0.5) {
      Audio.buy();
      EventBus.emit("action:go_farm");
    }
  }

  onResize(renderer: THREE.WebGLRenderer) {
    this.camera.aspect = renderer.domElement.width / renderer.domElement.height;
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
  }
}
