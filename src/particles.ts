import * as THREE from "three";

/**
 * Pooled spark/debris system for impact & kill juice.
 *
 * Each particle is a small additive glowing shard that flies outward, falls
 * under gravity and fades. With `streak` on, the shard is stretched along its
 * velocity for a hot tracer look (oriented via a quaternion from velocity).
 *
 * Hard-capped + pooled (oldest recycled at cap) so spammy impacts stay cheap;
 * mobile-friendly via `lowSpec`.
 */

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  streak: boolean;
  size: number; // base half-size of the shard
}

const UP = new THREE.Vector3(0, 1, 0);

export class Sparks {
  private pool: Spark[] = [];
  private active: Spark[] = [];
  private cap: number;
  private lowSpec: boolean;
  // unit shard — a thin long box; stretched along velocity when streaking
  private geo = new THREE.BoxGeometry(0.08, 0.08, 0.5);
  // Persistent container: every pooled shard is parented here ONCE (at make()),
  // so activating/retiring a spark just toggles `mesh.visible` instead of
  // mutating the scene graph every burst (which is exactly during the horde,
  // when FPS matters most). Inactive shards stay visible=false → no draw cost.
  private container = new THREE.Group();
  // scratch reused every orient to avoid per-particle allocs
  private _q = new THREE.Quaternion();
  private _dir = new THREE.Vector3();

  constructor(scene: THREE.Scene, lowSpec = false) {
    this.lowSpec = lowSpec;
    this.cap = lowSpec ? 80 : 220; // modest LOW_TIER trim (was 90)
    scene.add(this.container);
  }

  /**
   * Fling `count` glowing shards out of (pos), tinted `color`.
   * opts: speed (outward), spread (vertical kick), gravity (fall rate),
   * streak (stretch along velocity for tracer look).
   */
  burst(
    pos: THREE.Vector3,
    color: number,
    count = 12,
    opts: { speed?: number; spread?: number; gravity?: number; streak?: boolean } = {},
  ) {
    const speed = opts.speed ?? 7;
    const spread = opts.spread ?? 4;
    const gravity = opts.gravity ?? 16;
    const streak = opts.streak ?? false;
    // thin out particle counts on weak hardware
    const n = this.lowSpec ? Math.max(2, Math.round(count * 0.55)) : count;

    for (let i = 0; i < n; i++) {
      if (this.active.length >= this.cap) {
        const old = this.active.shift();
        if (old) this.retire(old);
      }
      let s = this.pool.pop();
      if (!s) s = this.make();

      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(color);
      mat.opacity = 1;

      s.mesh.position.set(pos.x, pos.y, pos.z);
      // radial fan with a randomized upward kick
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.55 + Math.random() * 0.8);
      const up = Math.random() * spread + spread * 0.25;
      s.vel.set(Math.cos(a) * sp, up, Math.sin(a) * sp);
      s.gravity = gravity;
      s.streak = streak;
      s.size = 0.7 + Math.random() * 0.8;
      s.life = s.maxLife = 0.32 + Math.random() * 0.28;

      this.applyTransform(s);
      s.mesh.visible = true; // already parented to the container (see make())
      this.active.push(s);
    }
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.life -= dt;
      s.vel.y -= s.gravity * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      // bounce-ish settle at the ground so shards don't sink through
      if (s.mesh.position.y < 0.04) {
        s.mesh.position.y = 0.04;
        s.vel.y *= -0.3;
        s.vel.x *= 0.6;
        s.vel.z *= 0.6;
      }
      const k = Math.max(0, s.life) / s.maxLife; // 1..0
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = k;
      this.applyTransform(s);
      if (s.life <= 0) {
        this.retire(s);
        this.active.splice(i, 1);
      }
    }
  }

  clear() {
    for (const s of this.active) this.retire(s);
    this.active.length = 0;
  }

  // ---- internals --------------------------------------------------------

  // size + orientation: stretch along velocity when streaking, else a small cube
  private applyTransform(s: Spark) {
    const k = Math.max(0, s.life) / s.maxLife;
    if (s.streak) {
      const speed = this._dir.copy(s.vel).length();
      // longer when moving faster; shrinks as it dies
      const len = s.size * (0.6 + Math.min(2.2, speed * 0.16)) * (0.5 + k * 0.5);
      const thick = s.size * 0.5 * (0.4 + k * 0.6);
      s.mesh.scale.set(thick, thick, len);
      if (speed > 0.001) {
        this._dir.normalize();
        this._q.setFromUnitVectors(UP, this._dir);
        s.mesh.quaternion.copy(this._q);
        // box long axis is Z; nudge so the +Z face points along velocity
        s.mesh.rotateX(Math.PI / 2);
      }
    } else {
      const sc = s.size * (0.4 + k * 0.6);
      s.mesh.scale.set(sc, sc, sc);
    }
  }

  private make(): Spark {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.visible = false; // parented once, hidden until a burst activates it
    this.container.add(mesh);
    return { mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0, gravity: 16, streak: false, size: 1 };
  }

  private retire(s: Spark) {
    // Stays parented to the container — just hide it (no scene-graph churn).
    s.mesh.visible = false;
    this.pool.push(s);
  }
}
