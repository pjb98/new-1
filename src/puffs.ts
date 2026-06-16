import * as THREE from "three";
import { glowMaterial } from "./palette";

/** Tiny pooled "poof" particles for kill feedback. Hard-capped so chaotic
 *  moments (nukes, detonate chains, gibs) can't spawn unbounded meshes. */
export class Puffs {
  private pool: { m: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  private active: { m: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  // lower-poly sphere + tighter cap on weak hardware
  private geo: THREE.SphereGeometry;
  private cap: number;
  private lowSpec: boolean;
  constructor(private scene: THREE.Scene, lowSpec = false) {
    this.lowSpec = lowSpec;
    this.cap = lowSpec ? 70 : 160;
    this.geo = new THREE.SphereGeometry(0.18, lowSpec ? 4 : 6, lowSpec ? 4 : 6);
  }
  // cheaper unlit material on mobile; lit emissive sphere on desktop
  private makeMat(color: number): THREE.Material {
    if (this.lowSpec) {
      return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    }
    return glowMaterial(color, 0.8);
  }
  burst(pos: THREE.Vector3, color: number, count = 8) {
    // thin out puff counts on weak hardware (mirrors Sparks/Explosions)
    const n = this.lowSpec ? Math.max(2, Math.round(count * 0.55)) : count;
    for (let i = 0; i < n; i++) {
      // enforce the cap: recycle the oldest live puff instead of growing
      if (this.active.length >= this.cap) {
        const old = this.active.shift();
        if (old) {
          old.m.visible = false;
          this.scene.remove(old.m);
          this.pool.push(old);
        }
      }
      let p = this.pool.pop();
      if (!p) p = { m: new THREE.Mesh(this.geo, this.makeMat(color)), vel: new THREE.Vector3(), life: 0 };
      const m = p.m;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.set(color);
      if (mat.emissive) mat.emissive.set(color);
      m.position.copy(pos);
      m.position.y = 1;
      m.scale.setScalar(1);
      m.visible = true;
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      const up = 2 + Math.random() * 3;
      p.vel.set(Math.cos(a) * 3, up, Math.sin(a) * 3);
      p.life = 0.5;
      this.active.push(p);
    }
  }
  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      p.vel.y -= 12 * dt;
      p.m.position.addScaledVector(p.vel, dt);
      p.m.scale.setScalar(Math.max(0.01, p.life * 2));
      if (p.life <= 0) {
        p.m.visible = false;
        this.scene.remove(p.m);
        this.pool.push(p);
        this.active.splice(i, 1);
      }
    }
  }
}
