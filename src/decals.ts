import * as THREE from "three";
import { SHARED_UNIT_BOX } from "./pets";
import { DECALS } from "./config";

/**
 * Corpse / gib / scorch permanence — the kill-site juice layer.
 *
 * When a zombie dies we leave a few short-lived voxel gib cubes plus a flat
 * scorch decal under the corpse; they linger at full opacity for a beat, then
 * fade out and recycle. This is PURE COSMETIC (NON-CASHABLE) and is built to
 * the same cap/pool discipline as Puffs/Sparks/Explosions:
 *
 *   - HARD CAP (DECALS.cap): once the live set is full, the OLDEST decal is
 *     recycled instead of growing the scene — no unbounded growth.
 *   - POOLED: retired meshes go back into a free-list and are reused, so we
 *     never allocate per kill in steady state.
 *   - lowSpec (mobile): DECALS.lowSpecCap is 0, so emit() is a no-op — phones
 *     pay zero GPU cost for this layer.
 *   - DISPOSE PATH: gib cubes reuse the SHARED_UNIT_BOX singleton (NEVER
 *     disposed here — it's owned by pets.ts). The scorch plane geometry is
 *     owned by this class and disposed in dispose(). Each decal carries its OWN
 *     material (needed for independent per-decal opacity fade); those materials
 *     are disposed in dispose() across both the live set and the pool.
 */

type Kind = "gib" | "scorch";

interface Decal {
  m: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  kind: Kind;
  vel: THREE.Vector3; // gibs tumble + fall; scorch stays put
  spin: THREE.Vector3; // gib angular velocity
  life: number; // seconds remaining
  baseOpacity: number; // opacity to hold at before the fade
  baseScale: number; // gib edge length / scorch diameter
}

export class Decals {
  private pool: Decal[] = [];
  private active: Decal[] = [];
  private cap: number;
  private scorchGeo: THREE.PlaneGeometry; // owned — disposed in dispose()

  constructor(private scene: THREE.Scene, lowSpec = false) {
    this.cap = lowSpec ? DECALS.lowSpecCap : DECALS.cap;
    this.scorchGeo = new THREE.PlaneGeometry(1, 1);
  }

  /**
   * Leave a corpse decal at `pos`. `intensity` (1 = plain kill, higher on
   * crit/combo) scales the gib count up toward DECALS.maxPerKill. Cheap no-op
   * when the cap is 0 (lowSpec).
   */
  emit(pos: THREE.Vector3, color: number, intensity = 1) {
    if (this.cap <= 0) return; // lowSpec / disabled
    const gibs = Math.min(DECALS.maxPerKill, Math.max(1, Math.round(DECALS.gibsPerKill * intensity)));
    this.spawn(pos, color, "scorch");
    for (let i = 0; i < gibs; i++) this.spawn(pos, color, "gib");
  }

  private spawn(pos: THREE.Vector3, color: number, kind: Kind) {
    // enforce the cap: recycle the OLDEST live decal rather than growing
    if (this.active.length >= this.cap) {
      const old = this.active.shift();
      if (old) this.retire(old);
    }
    let d = this.pool.pop();
    if (!d) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      // gibs reuse the shared unit box (NEVER disposed here); scorch uses our plane
      const geo: THREE.BufferGeometry = kind === "gib" ? SHARED_UNIT_BOX : this.scorchGeo;
      d = {
        m: new THREE.Mesh(geo, mat),
        mat,
        kind,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        baseOpacity: 1,
        baseScale: 1,
      };
    } else if (d.kind !== kind) {
      // a pooled decal of the other kind — swap its geometry to match
      d.m.geometry = kind === "gib" ? SHARED_UNIT_BOX : this.scorchGeo;
      d.kind = kind;
    }
    const m = d.m;
    d.mat.color.set(color);
    m.position.copy(pos);
    if (kind === "gib") {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * DECALS.gibSpread;
      m.position.x += Math.cos(a) * r;
      m.position.z += Math.sin(a) * r;
      m.position.y = 0.2 + Math.random() * 0.4;
      m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      d.baseScale = DECALS.gibScale * (0.7 + Math.random() * 0.6);
      d.vel.set((Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2.5);
      d.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      d.baseOpacity = 0.95;
    } else {
      // flat scorch: lie on the ground just above z-fighting range, face up
      m.position.y = 0.04;
      m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
      d.baseScale = DECALS.scorchScale * (0.85 + Math.random() * 0.3);
      d.vel.set(0, 0, 0);
      d.spin.set(0, 0, 0);
      d.baseOpacity = DECALS.scorchOpacity;
    }
    m.scale.setScalar(d.baseScale);
    d.mat.opacity = d.baseOpacity;
    m.visible = true;
    d.life = DECALS.life;
    this.scene.add(m);
    this.active.push(d);
  }

  update(dt: number) {
    if (!this.active.length) return;
    const fadeStart = DECALS.life * DECALS.holdFrac; // hold full, then fade
    for (let i = this.active.length - 1; i >= 0; i--) {
      const d = this.active[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.retire(d);
        this.active.splice(i, 1);
        continue;
      }
      if (d.kind === "gib") {
        d.vel.y -= 9 * dt;
        d.m.position.addScaledVector(d.vel, dt);
        if (d.m.position.y < d.baseScale * 0.5) {
          d.m.position.y = d.baseScale * 0.5; // settle on the ground
          d.vel.set(0, 0, 0);
          d.spin.multiplyScalar(0.4);
        }
        d.m.rotation.x += d.spin.x * dt;
        d.m.rotation.y += d.spin.y * dt;
        d.m.rotation.z += d.spin.z * dt;
      }
      // opacity: hold at baseOpacity, then ease to 0 over the fade window
      d.mat.opacity = d.life >= fadeStart ? d.baseOpacity : d.baseOpacity * (d.life / fadeStart);
    }
  }

  /** Hide + detach a decal and return it to the pool (material kept for reuse). */
  private retire(d: Decal) {
    d.m.visible = false;
    this.scene.remove(d.m);
    this.pool.push(d);
  }

  /** Tear down: dispose every owned material (live + pooled) and the scorch
   *  geometry. SHARED_UNIT_BOX is the pets.ts singleton — never disposed here. */
  dispose() {
    for (const d of this.active) {
      this.scene.remove(d.m);
      d.mat.dispose();
    }
    for (const d of this.pool) d.mat.dispose();
    this.active.length = 0;
    this.pool.length = 0;
    this.scorchGeo.dispose();
  }
}
