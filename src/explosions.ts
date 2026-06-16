import * as THREE from "three";

/**
 * Pooled, layered detonation effects for explosions, impacts and pet abilities.
 *
 * Every visual is a flat additive quad/ring/beam built from a few shared
 * geometries and recycled through one pool. A single `burst()` stacks several
 * layers (core flash + shockwave ring + secondary ring + scorch) for a juicy,
 * punchy read. Standalone `flash()`, `beam()` and `shockwave()` expose the
 * individual layers for muzzle pops, vertical smites and novas.
 *
 * Hard-capped + pooled so chaotic chains can't spawn unbounded meshes; oldest
 * live element is recycled when at cap. Mobile-friendly via `lowSpec`.
 */

// kinds of pooled element — each maps to a shared geometry + animation curve
type Kind = "ring" | "flash" | "scorch" | "beam";

interface FX {
  mesh: THREE.Mesh;
  kind: Kind;
  life: number;
  maxLife: number;
  fromScale: number; // scale at birth
  toScale: number; // scale at death
  baseOpacity: number;
  spin: number; // per-second rotation about the local Z (flat-plane visuals)
  height: number; // beam: world height it shoots to
}

export class Explosions {
  private pool: FX[] = [];
  private active: FX[] = [];
  private cap: number;

  // shared geometries (unit-sized; scaled per-effect)
  // Unit ring (inner 0.6, outer 1.0) for the chunky main shockwave.
  private ringGeo = new THREE.RingGeometry(0.62, 1.0, 36);
  // Thinner ring for the fast secondary pop.
  private thinGeo = new THREE.RingGeometry(0.86, 1.0, 36);
  // Soft additive disc for the core flash + scorch.
  private discGeo = new THREE.CircleGeometry(1.0, 28);
  // Vertical pillar for beams — a 1x1 unit box, pivoted at its base.
  private beamGeo: THREE.BoxGeometry;

  constructor(private scene: THREE.Scene, lowSpec = false) {
    this.cap = lowSpec ? 26 : 56;
    this.beamGeo = new THREE.BoxGeometry(1, 1, 1);
    // pivot the beam at the ground so scaling Y shoots it upward
    this.beamGeo.translate(0, 0.5, 0);
  }

  // ---- public API -------------------------------------------------------

  /** Spawn a full layered detonation at (pos) expanding to ~`radius`, tinted `color`. */
  burst(pos: THREE.Vector3, radius: number, color: number) {
    const white = lighten(color, 0.6);
    // 1) instant core flash — pops to full, fades in ~0.12s
    this.spawn("flash", pos, white, {
      from: radius * 0.35,
      to: radius * 0.95,
      life: 0.12,
      opacity: 1.0,
      y: 0.16,
    });
    // 2) main expanding ground shockwave (the old chunky ring, improved)
    this.spawn("ring", pos, color, {
      from: 0.3,
      to: radius,
      life: 0.36,
      opacity: 0.95,
      y: 0.12,
      spin: 0.8,
    });
    // 3) faster, thinner secondary ring for the double-pop read
    this.spawn("ring", pos, white, {
      from: 0.25,
      to: radius * 1.25,
      life: 0.24,
      opacity: 0.8,
      y: 0.13,
      thin: true,
    });
    // 4) lingering scorch disc that quickly fades (grounds the blast)
    this.spawn("scorch", pos, darken(color, 0.45), {
      from: radius * 0.7,
      to: radius * 0.85,
      life: 0.5,
      opacity: 0.55,
      y: 0.05,
    });
  }

  /** Quick additive light pop (no ring) — for muzzle-class hits. */
  flash(pos: THREE.Vector3, radius: number, color: number) {
    this.spawn("flash", pos, lighten(color, 0.5), {
      from: radius * 0.4,
      to: radius * 1.0,
      life: 0.14,
      opacity: 1.0,
      y: 0.16,
    });
  }

  /** Vertical light PILLAR that shoots up and fades — for smite/obliterate verticals. */
  beam(pos: THREE.Vector3, height: number, color: number) {
    this.spawn("beam", pos, lighten(color, 0.35), {
      from: 0.0,
      to: 1.0,
      life: 0.3,
      opacity: 0.95,
      y: 0.0,
      height,
    });
  }

  /** Pure expanding ground ring (thin, fast) — for nova/supernova. */
  shockwave(pos: THREE.Vector3, radius: number, color: number) {
    this.spawn("ring", pos, color, {
      from: 0.3,
      to: radius,
      life: 0.3,
      opacity: 0.9,
      y: 0.12,
      thin: true,
    });
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.life -= dt;
      const k = 1 - Math.max(0, f.life) / f.maxLife; // 0..1 over lifetime
      const mat = f.mesh.material as THREE.MeshBasicMaterial;

      if (f.kind === "beam") {
        // shoot up fast (ease-out), thin slightly, then fade
        const grow = 1 - (1 - k) * (1 - k);
        f.mesh.scale.set(f.fromScale + (f.toScale - f.fromScale) * (1 - k * 0.4), f.height * grow, f.fromScale + (f.toScale - f.fromScale) * (1 - k * 0.4));
        mat.opacity = f.baseOpacity * (1 - k);
      } else if (f.kind === "flash") {
        // pop then collapse opacity quickly
        const s = f.fromScale + (f.toScale - f.fromScale) * easeOut(k);
        f.mesh.scale.set(s, s, s);
        mat.opacity = f.baseOpacity * (1 - k) * (1 - k);
      } else {
        // rings + scorch: ease-out expand, linear-ish fade
        const s = f.fromScale + (f.toScale - f.fromScale) * easeOut(k);
        f.mesh.scale.set(s, s, s);
        mat.opacity = f.baseOpacity * (1 - k);
        if (f.spin) f.mesh.rotation.z += f.spin * dt;
      }

      if (f.life <= 0) {
        this.retire(f);
        this.active.splice(i, 1);
      }
    }
  }

  clear() {
    for (const f of this.active) this.retire(f);
    this.active.length = 0;
  }

  // ---- internals --------------------------------------------------------

  private spawn(
    kind: Kind,
    pos: THREE.Vector3,
    color: number,
    o: { from: number; to: number; life: number; opacity: number; y: number; spin?: number; thin?: boolean; height?: number },
  ) {
    if (this.active.length >= this.cap) {
      const old = this.active.shift();
      if (old) this.retire(old);
    }
    // pull a matching element from the pool, or make a fresh one
    const geoKind: Kind = kind === "ring" && o.thin ? "ring" : kind;
    let f = this.pop(geoKind, !!o.thin);
    if (!f) f = this.make(kind, !!o.thin);

    const mat = f.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    mat.opacity = o.opacity;

    f.kind = kind;
    f.fromScale = o.from;
    f.toScale = o.to;
    f.baseOpacity = o.opacity;
    f.spin = o.spin ?? 0;
    f.height = o.height ?? 1;
    f.life = f.maxLife = o.life;

    if (kind === "beam") {
      // upright pillar centred on the impact, base at ground
      f.mesh.rotation.set(0, Math.random() * Math.PI, 0);
      f.mesh.position.set(pos.x, o.y, pos.z);
      f.mesh.scale.set(o.from, 0.01, o.from);
    } else {
      // flat plane visual lying on the ground (XZ)
      f.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      f.mesh.position.set(pos.x, o.y, pos.z);
      f.mesh.scale.setScalar(o.from);
    }

    f.mesh.visible = true;
    this.scene.add(f.mesh);
    this.active.push(f);
  }

  // pull a pooled element whose mesh geometry matches what we need
  private pop(kind: Kind, thin: boolean): FX | undefined {
    const want = kind === "ring" ? (thin ? this.thinGeo : this.ringGeo) : kind === "beam" ? this.beamGeo : this.discGeo;
    for (let i = this.pool.length - 1; i >= 0; i--) {
      if (this.pool[i].mesh.geometry === want) return this.pool.splice(i, 1)[0];
    }
    return undefined;
  }

  private make(kind: Kind, thin: boolean): FX {
    const geo = kind === "ring" ? (thin ? this.thinGeo : this.ringGeo) : kind === "beam" ? this.beamGeo : this.discGeo;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    return { mesh, kind, life: 0, maxLife: 0, fromScale: 1, toScale: 1, baseOpacity: 1, spin: 0, height: 1 };
  }

  private retire(f: FX) {
    f.mesh.visible = false;
    this.scene.remove(f.mesh);
    this.pool.push(f);
  }
}

// ---- color helpers ------------------------------------------------------

function easeOut(k: number) {
  return 1 - (1 - k) * (1 - k) * (1 - k);
}

/** Blend `color` toward white by `t` (0..1) for hot, additive cores. */
function lighten(color: number, t: number): number {
  const r = (color >> 16) & 0xff,
    g = (color >> 8) & 0xff,
    b = color & 0xff;
  const nr = Math.round(r + (255 - r) * t);
  const ng = Math.round(g + (255 - g) * t);
  const nb = Math.round(b + (255 - b) * t);
  return (nr << 16) | (ng << 8) | nb;
}

/** Blend `color` toward black by `t` (0..1) for scorch undertones. */
function darken(color: number, t: number): number {
  const r = (color >> 16) & 0xff,
    g = (color >> 8) & 0xff,
    b = color & 0xff;
  return (Math.round(r * (1 - t)) << 16) | (Math.round(g * (1 - t)) << 8) | Math.round(b * (1 - t));
}
