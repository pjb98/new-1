import * as THREE from "three";

function mat(color: number) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
}

function box(w: number, h: number, d: number, color: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  return new THREE.Mesh(g, mat(color));
}

export class VoxelChar {
  readonly root = new THREE.Group();
  private upper = new THREE.Group();
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private t = 0;
  private walking = false;

  constructor(bodyColor: number, skinColor = 0xf4c2a1) {
    const torso = box(0.5, 0.6, 0.3, bodyColor);
    torso.position.y = 0;
    this.upper.add(torso);

    const head = box(0.4, 0.4, 0.35, skinColor);
    head.position.y = 0.5;
    this.upper.add(head);

    // Eyes
    for (const sx of [-0.1, 0.1]) {
      const eye = box(0.07, 0.07, 0.05, 0x222222);
      eye.position.set(sx, 0.52, 0.175);
      this.upper.add(eye);
    }

    // Arms
    this.armL = new THREE.Group();
    const armLMesh = box(0.15, 0.5, 0.15, bodyColor);
    armLMesh.position.y = -0.25;
    this.armL.add(armLMesh);
    this.armL.position.set(-0.325, 0.05, 0);
    this.upper.add(this.armL);

    this.armR = new THREE.Group();
    const armRMesh = box(0.15, 0.5, 0.15, bodyColor);
    armRMesh.position.y = -0.25;
    this.armR.add(armRMesh);
    this.armR.position.set(0.325, 0.05, 0);
    this.upper.add(this.armR);

    this.upper.position.y = 0.6;
    this.root.add(this.upper);

    // Legs
    this.legL = new THREE.Group();
    const legLMesh = box(0.2, 0.55, 0.2, 0x2244aa);
    legLMesh.position.y = -0.275;
    this.legL.add(legLMesh);
    this.legL.position.set(-0.15, 0.35, 0);
    this.root.add(this.legL);

    this.legR = new THREE.Group();
    const legRMesh = box(0.2, 0.55, 0.2, 0x2244aa);
    legRMesh.position.y = -0.275;
    this.legR.add(legRMesh);
    this.legR.position.set(0.15, 0.35, 0);
    this.root.add(this.legR);
  }

  setWalking(w: boolean) { this.walking = w; }

  update(dt: number) {
    this.t += dt;
    if (this.walking) {
      const swing = Math.sin(this.t * 8) * 0.5;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing * 0.6;
      this.armR.rotation.x = swing * 0.6;
      this.upper.position.y = 0.6 + Math.abs(Math.sin(this.t * 8)) * 0.03;
    } else {
      this.legL.rotation.x *= 0.85;
      this.legR.rotation.x *= 0.85;
      this.armL.rotation.x *= 0.85;
      this.armR.rotation.x *= 0.85;
      this.upper.position.y = 0.6 + Math.sin(this.t * 1.5) * 0.015;
    }
  }
}
