import * as THREE from "three";
import { glowMaterial, voxelMaterial, VOX } from "../palette";

/**
 * TdFx — self-contained Tower-Defense effects system.
 *
 * Owns its own THREE.Group (added to the scene in the constructor) and pools
 * every mesh/sprite it spawns so a busy wave never allocates unboundedly. All
 * effects share the cozy flat-shaded voxel look but lean on emissive glow so the
 * game's bloom + ACES post-stack makes them pop.
 *
 * Public API (the integrator calls these):
 *   new TdFx(scene)
 *   muzzleFlash(pos, dir, color)        — turret fires: bright flash + sparks
 *   tracer(from, to, color, kind?)      — projectile/tracer ("bolt"|"beam"|"shell")
 *   impact(pos, color, big?)            — voxel-chip burst + flash ring at a hit
 *   floatText(pos, text, color)         — rising, fading damage/+money label
 *   ring(pos, color, radius)            — expanding shockwave ring
 *   update(dt)                          — advance + fade all live effects
 *   clear()                             — remove + dispose everything
 *
 * Everything is pooled and hard-capped; update() recycles finished effects.
 */

// ---- mobile tier ----------------------------------------------------------
// palette.ts keeps LOW_TIER private, so mirror the exact same coarse-pointer /
// no-hover probe here (matchMedia-guarded so node/test imports stay safe). On
// low tier we cut spark counts and skip the priciest extras to protect FPS.
const LOW_TIER =
  typeof matchMedia === "function"
    ? matchMedia("(pointer: coarse)").matches && matchMedia("(hover: none)").matches
    : false;

// ---- tuning ---------------------------------------------------------------
// Bump these down for weaker hardware; they only cap *live* counts, the pools
// reuse meshes so steady-state allocation is zero.
const MAX_SPARKS = LOW_TIER ? 130 : 260; // voxel chips for muzzle flashes + impacts
const MAX_FLASHES = LOW_TIER ? 40 : 72; // soft point-flash quads (muzzle + impact cores)
const MAX_TRACERS = 80; // travelling bolts / fading beams / lobbed shells
const MAX_RINGS = LOW_TIER ? 22 : 36; // expanding shockwave rings
const MAX_TEXTS = 48; // floating damage / +money labels
const MAX_TEXT_CACHE = 64; // distinct canvas textures kept before eviction

const SPARK_LIFE = 0.42; // base lifetime of a flung voxel chip (s)
const FLASH_LIFE = 0.13; // muzzle/impact core flash lifetime (s)
const BEAM_LIFE = 0.18; // instant tracer line fade (s)
const RING_LIFE = 0.5; // shockwave ring expand+fade (s)
const TEXT_LIFE = 0.95; // floating label lifetime (s)
const BOLT_SPEED = 70; // travel speed of a "bolt" tracer (world units/s)
const SHELL_SPEED = 34; // travel speed of an arcing "shell" tracer
const SHELL_ARC = 3.4; // peak lob height of a "shell" (world units)
const GRAVITY = 26; // fall rate applied to spark chips (units/s^2)

// ---- module-scope scratch (avoid per-frame allocations) -------------------
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3(); // scratch for beam-jitter perpendicular
const _q = new THREE.Quaternion();
const _white = new THREE.Color(0xffffff); // scratch for color-lightening blends
const WHITE = new THREE.Color(0xffffff); // constant pure-white target for lerps

type TracerKind = "bolt" | "beam" | "shell";

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: THREE.Vector3; // per-axis tumble rate
  base: number; // resting half-size
  drag: number; // per-second velocity damping (1 = none)
  gravity: number; // gravity scale (0 = floaty embers, 1 = chunky chips)
}

interface Flash {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  base: number;
  spin: number; // slow billboard roll for a livelier bloom
}

interface Tracer {
  mesh: THREE.Mesh; // bolt/shell = a small dart; beam = a stretched bar
  kind: TracerKind;
  from: THREE.Vector3;
  to: THREE.Vector3;
  prog: number; // 0..1 travel progress (bolt/shell)
  speed: number; // units/s for bolt/shell (converted to prog/s)
  life: number; // for beams (instant fade)
  maxLife: number;
  color: number;
  dist: number; // cached from->to distance (beam length / trail spacing)
  trailAcc: number; // accumulator that meters out trail puff sparks
  flicker: number; // running phase for the beam's electric flicker
  onArrive: ((p: THREE.Vector3, c: number) => void) | null;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  radius: number;
  thickness: number; // emphasis on the leading edge (visual only)
}

interface FloatLabel {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseX: number;
  baseY: number;
}

export class TdFx {
  readonly group = new THREE.Group();

  // pools + live lists
  private sparkPool: Spark[] = [];
  private sparkLive: Spark[] = [];
  private flashPool: Flash[] = [];
  private flashLive: Flash[] = [];
  private tracerPool: Tracer[] = [];
  private tracerLive: Tracer[] = [];
  private ringPool: Ring[] = [];
  private ringLive: Ring[] = [];
  private textPool: FloatLabel[] = [];
  private textLive: FloatLabel[] = [];
  private texCache = new Map<string, THREE.Texture>();
  private cam: THREE.Camera | null = null; // cached so update() doesn't traverse

  // shared geometry (disposed in clear())
  private chipGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16); // chunky voxel chip
  private flashGeo = new THREE.PlaneGeometry(1, 1); // billboarded soft flash
  private dartGeo = new THREE.BoxGeometry(0.18, 0.18, 0.6); // bolt/shell projectile
  private beamGeo = new THREE.BoxGeometry(0.12, 0.12, 1); // unit-length beam bar (z-scaled)
  private ringGeo = new THREE.RingGeometry(0.72, 1.0, 40); // thin shockwave ring

  constructor(private scene: THREE.Scene) {
    this.group.name = "TdFx";
    this.scene.add(this.group);
  }

  // =========================================================================
  // muzzle flash — quick bright bloom + a punchy directional spark spray.
  // =========================================================================
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, color: number): void {
    _dir.copy(dir);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
    else _dir.normalize();

    // Three stacked flashes give the bloom a hot near-white core inside a
    // saturated color halo, with a wide soft outer puff — far punchier than a
    // single quad for nearly free (all share the pooled additive plane).
    _v0.copy(pos).addScaledVector(_dir, 0.22);
    if (!LOW_TIER) this.spawnFlash(_v0, color, 2.1, 0.55); // wide soft outer puff
    this.spawnFlash(_v0, color, 1.45, 1.0); // colored halo
    _white.copy(WHITE).lerp(_tmpColor(color), 0.25); // hot, washed-out core
    this.spawnFlash(_v0, _white.getHex(), 0.78, 1.0); // bright near-white core

    // a directional spark spray fanned tightly around the firing direction
    const n = LOW_TIER ? 5 : 9;
    for (let i = 0; i < n; i++) {
      const s = this.acquireSpark();
      if (!s) break;
      this.tintGlow(s.mesh, color, 1.8);
      // start a touch ahead of the muzzle so they read as ejected, not spawned
      s.mesh.position.copy(pos).addScaledVector(_dir, 0.18);
      // velocity = forward + small random cone, biased forward for a "spit"
      const spread = 0.55;
      _v1.set(
        _dir.x + (Math.random() - 0.5) * spread,
        _dir.y + (Math.random() - 0.5) * spread + 0.16,
        _dir.z + (Math.random() - 0.5) * spread,
      ).normalize();
      const sp = 13 + Math.random() * 11;
      s.vel.copy(_v1).multiplyScalar(sp);
      s.spin.set(rand(12), rand(12), rand(12));
      s.base = 0.4 + Math.random() * 0.5;
      s.drag = 0.86; // air-brake so the spray snaps to a halt near the muzzle
      s.gravity = 0.5; // light gravity — they're hot gas, not heavy chips
      // short-lived so the spray stays tight to the muzzle, not littering
      s.life = s.maxLife = SPARK_LIFE * (0.38 + Math.random() * 0.32);
    }
  }

  // =========================================================================
  // tracer — projectile from turret to target. Travels over several frames.
  //   "bolt"  = fast small glowing dart that flies from→to (default)
  //   "beam"  = instant glowing line that fades out (tesla/sniper/pylon)
  //   "shell" = arcing lobbed projectile (parabolic), slower (cannon)
  // `onArrive` fires at the destination (tdmode triggers impact + audio there).
  // =========================================================================
  tracer(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number,
    kind: TracerKind = "bolt",
    onArrive?: (p: THREE.Vector3, c: number) => void,
  ): void {
    const t = this.acquireTracer();
    if (!t) {
      // pool exhausted — still honour the impact contract so gameplay (damage +
      // audio) never silently drops when the screen is saturated with tracers.
      if (onArrive) onArrive(to, color);
      return;
    }
    t.kind = kind;
    t.from.copy(from);
    t.to.copy(to);
    t.prog = 0;
    t.color = color;
    t.onArrive = onArrive ?? null;
    const dist = _v0.copy(to).sub(from).length() || 0.001;
    t.dist = dist;
    t.trailAcc = 0;
    t.flicker = Math.random() * 6.28;

    if (kind === "beam") {
      // instant glowing lance from→to that fades fast. A bright core flash at
      // each end "anchors" the bolt and reads great for tesla chain arcs.
      t.mesh.geometry = this.beamGeo;
      this.tintGlow(t.mesh, color, 2.4);
      this.orientBeam(t.mesh, from, to, dist);
      t.life = t.maxLife = BEAM_LIFE;
      t.speed = 0;
      _white.copy(WHITE).lerp(_tmpColor(color), 0.35);
      this.spawnFlash(from, _white.getHex(), 0.85, 1.0);
      this.spawnFlash(to, _white.getHex(), 1.05, 1.0);
      // a couple of electric sparks crackling off the strike point
      if (!LOW_TIER) {
        const n = 3;
        for (let i = 0; i < n; i++) {
          const s = this.acquireSpark();
          if (!s) break;
          this.tintGlow(s.mesh, _white.getHex(), 2.0);
          s.mesh.position.copy(to);
          s.vel.set(rand(7), 3 + Math.random() * 5, rand(7));
          s.spin.set(rand(14), rand(14), rand(14));
          s.base = 0.35 + Math.random() * 0.4;
          s.drag = 0.9;
          s.gravity = 0.3;
          s.life = s.maxLife = SPARK_LIFE * 0.45;
        }
      }
    } else {
      // bolt / shell: a small dart that actually travels
      t.mesh.geometry = this.dartGeo;
      this.tintGlow(t.mesh, color, kind === "shell" ? 1.3 : 1.9);
      const speed = kind === "shell" ? SHELL_SPEED : BOLT_SPEED;
      t.speed = speed / dist; // progress per second
      t.mesh.position.copy(from);
      t.life = t.maxLife = 0; // unused for travellers
      // initial orient toward target
      this.orientToward(t.mesh, from, to);
      // stretch the dart into a hot streak (shells are chunkier, less stretched)
      t.mesh.scale.set(1, 1, kind === "shell" ? 1.5 : 2.6);
      // a tiny muzzle spark at the launch point so the bolt feels "thrown"
      if (kind === "bolt" && !LOW_TIER) {
        _white.copy(WHITE).lerp(_tmpColor(color), 0.4);
        this.spawnFlash(from, _white.getHex(), 0.6, 0.85);
      }
    }
    t.mesh.visible = true;
  }

  // =========================================================================
  // impact — voxel-chip burst at the hit point: a fan of small shards that fly
  // out + fall + fade, plus a bright core flash and a quick flash ring.
  // `big` (boss/splash/crit) scales count, size, speed and ring noticeably.
  // =========================================================================
  impact(pos: THREE.Vector3, color: number, big = false): void {
    let n = big ? 20 : 9;
    if (LOW_TIER) n = big ? 12 : 6;
    const speed = big ? 13.5 : 8;
    for (let i = 0; i < n; i++) {
      const s = this.acquireSpark();
      if (!s) break;
      this.tintGlow(s.mesh, color, big ? 1.7 : 1.25);
      s.mesh.position.copy(pos);
      // burst out radially with a healthy upward kick so chips arc + tumble
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.45 + Math.random() * 0.95);
      const up = 2.5 + Math.random() * (big ? 8 : 4.5);
      s.vel.set(Math.cos(a) * sp, up, Math.sin(a) * sp);
      s.spin.set(rand(12), rand(12), rand(12));
      s.base = (big ? 1.05 : 0.62) + Math.random() * 0.7;
      s.drag = 1; // full ballistic chips (chunky voxel debris)
      s.gravity = 1;
      s.life = s.maxLife = SPARK_LIFE * (0.7 + Math.random() * 0.6);
    }
    // hot white core punch nested inside a colored bloom for a crisp "pop"
    _white.copy(WHITE).lerp(_tmpColor(color), big ? 0.3 : 0.45);
    this.spawnFlash(pos, color, big ? 2.4 : 1.4, 1); // colored bloom
    this.spawnFlash(pos, _white.getHex(), big ? 1.3 : 0.72, 1); // bright core
    // expanding shockwave ring kicked off at the hit
    this.spawnRing(pos, color, big ? 3.0 : 1.5, big ? 0.6 : 0.34, big ? 0.55 : 0.4);
    // big hits (crit / splash) get a second, faster inner ring for extra heft
    if (big && !LOW_TIER) this.spawnRing(pos, _white.getHex(), 1.6, 0.42, 0.6);
  }

  // =========================================================================
  // floatText — rising, fading canvas-sprite label (damage / +money / "CRIT").
  // Textures are cached by text+color; cache is capped, sprites are pooled.
  // =========================================================================
  floatText(pos: THREE.Vector3, text: string, color: number): void {
    if (this.textLive.length >= MAX_TEXTS) {
      const oldest = this.textLive.shift();
      if (oldest) this.retireText(oldest);
    }
    let ft = this.textPool.pop();
    if (!ft) {
      const mat = new THREE.SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      ft = {
        sprite: new THREE.Sprite(mat),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        baseX: 0,
        baseY: 0,
      };
    }
    const mat = ft.sprite.material as THREE.SpriteMaterial;
    const tex = this.labelTexture(text, color);
    mat.map = tex;
    mat.opacity = 1;
    // size the sprite to the texture's aspect so long words ("COMBO ×2.4")
    // stay legible and un-squashed; height is constant, width tracks the canvas.
    const img = tex.image as HTMLCanvasElement;
    const aspect = img && img.width ? img.width / img.height : 2;
    ft.baseY = 0.82;
    ft.baseX = ft.baseY * aspect;
    // start punched-out a touch; update() eases back to resting size
    ft.sprite.scale.set(ft.baseX * 1.55, ft.baseY * 1.55, 1);
    ft.sprite.position.copy(pos);
    ft.sprite.position.y += 1.4;
    ft.vel.set((Math.random() - 0.5) * 1.0, 3.4 + Math.random(), (Math.random() - 0.5) * 1.0);
    ft.life = ft.maxLife = TEXT_LIFE;
    ft.sprite.visible = true;
    this.group.add(ft.sprite);
    this.textLive.push(ft);
  }

  // =========================================================================
  // ring — expanding flat shockwave ring. Used for target-acquire telegraphs
  // AND repeated small poison/burn puffs, so it must read at small radius too.
  // =========================================================================
  ring(pos: THREE.Vector3, color: number, radius: number): void {
    // smaller rings get a slightly tighter/longer-lived puff so DoT pulses read
    const life = radius < 0.9 ? RING_LIFE * 0.7 : RING_LIFE;
    this.spawnRing(pos, color, radius, life, radius < 0.9 ? 0.55 : 0.4);
  }

  // =========================================================================
  // update — advance + fade everything; recycle finished effects.
  // =========================================================================
  update(dt: number): void {
    // refresh the cached camera once per frame (cheap; avoids per-flash traverse)
    if (!this.cam || (this.cam as THREE.Object3D).parent == null) {
      this.cam = this.findCamera();
    }
    this.updateSparks(dt);
    this.updateFlashes(dt);
    this.updateTracers(dt);
    this.updateRings(dt);
    this.updateTexts(dt);
  }

  // =========================================================================
  // clear — remove + dispose everything (mode leave).
  // =========================================================================
  clear(): void {
    // retire all live effects back to scene-detached state
    for (const s of this.sparkLive) s.mesh.visible = false;
    for (const f of this.flashLive) f.mesh.visible = false;
    for (const t of this.tracerLive) t.mesh.visible = false;
    for (const r of this.ringLive) r.mesh.visible = false;
    for (const ft of this.textLive) ft.sprite.visible = false;

    // dispose every pooled + live mesh/material (shared geos disposed once)
    const allSparks = this.sparkLive.concat(this.sparkPool);
    for (const s of allSparks) disposeMesh(s.mesh, false);
    const allFlashes = this.flashLive.concat(this.flashPool);
    for (const f of allFlashes) disposeMesh(f.mesh, false);
    const allTracers = this.tracerLive.concat(this.tracerPool);
    for (const t of allTracers) disposeMesh(t.mesh, false);
    const allRings = this.ringLive.concat(this.ringPool);
    for (const r of allRings) disposeMesh(r.mesh, false);
    const allTexts = this.textLive.concat(this.textPool);
    for (const ft of allTexts) (ft.sprite.material as THREE.SpriteMaterial).dispose();

    for (const tex of this.texCache.values()) tex.dispose();
    this.texCache.clear();

    // shared geometry
    this.chipGeo.dispose();
    this.flashGeo.dispose();
    this.dartGeo.dispose();
    this.beamGeo.dispose();
    this.ringGeo.dispose();

    this.sparkLive.length = this.sparkPool.length = 0;
    this.flashLive.length = this.flashPool.length = 0;
    this.tracerLive.length = this.tracerPool.length = 0;
    this.ringLive.length = this.ringPool.length = 0;
    this.textLive.length = this.textPool.length = 0;
    this.cam = null;

    this.scene.remove(this.group);
    this.group.clear();
  }

  // ===================== internals: spark =================================
  private acquireSpark(): Spark | null {
    if (this.sparkLive.length >= MAX_SPARKS) {
      const old = this.sparkLive.shift();
      if (old) this.retireSpark(old);
    }
    let s = this.sparkPool.pop();
    if (!s) {
      const mesh = new THREE.Mesh(this.chipGeo, glowMaterial(0xffffff, 1.0));
      s = {
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        spin: new THREE.Vector3(),
        base: 1,
        drag: 1,
        gravity: 1,
      };
    }
    s.drag = 1;
    s.gravity = 1;
    s.mesh.visible = true;
    s.mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, 0);
    s.mesh.scale.setScalar(s.base);
    this.group.add(s.mesh);
    this.sparkLive.push(s);
    return s;
  }

  private updateSparks(dt: number): void {
    for (let i = this.sparkLive.length - 1; i >= 0; i--) {
      const s = this.sparkLive[i];
      s.life -= dt;
      s.vel.y -= GRAVITY * s.gravity * dt;
      if (s.drag < 1) {
        // frame-rate-independent exponential damping
        const f = Math.pow(s.drag, dt * 60);
        s.vel.x *= f;
        s.vel.z *= f;
      }
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.mesh.position.y < 0.06) {
        s.mesh.position.y = 0.06;
        s.vel.y *= -0.32;
        s.vel.x *= 0.6;
        s.vel.z *= 0.6;
      }
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      const k = Math.max(0, s.life) / s.maxLife;
      // a little pop on spawn (overshoot) then taper toward a glowing nub
      const pop = k > 0.85 ? 1 + (k - 0.85) * 2.0 : 1;
      s.mesh.scale.setScalar(s.base * (0.22 + k * 0.78) * pop);
      const mat = s.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.4 + k * 1.2;
      if (s.life <= 0) {
        this.retireSpark(s);
        this.sparkLive.splice(i, 1);
      }
    }
  }

  private retireSpark(s: Spark): void {
    s.mesh.visible = false;
    this.group.remove(s.mesh);
    this.sparkPool.push(s);
  }

  // ===================== internals: flash =================================
  private spawnFlash(pos: THREE.Vector3, color: number, base: number, intensity: number): void {
    if (this.flashLive.length >= MAX_FLASHES) {
      const old = this.flashLive.shift();
      if (old) this.retireFlash(old);
    }
    let f = this.flashPool.pop();
    if (!f) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      f = { mesh: new THREE.Mesh(this.flashGeo, mat), life: 0, maxLife: 0, base, spin: 0 };
    }
    const mat = f.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    mat.opacity = intensity;
    f.base = base;
    f.spin = rand(3); // gentle roll so stacked flashes don't look static
    f.mesh.position.copy(pos);
    f.mesh.rotation.z = Math.random() * 6.28;
    f.mesh.scale.setScalar(base * 0.55);
    f.mesh.visible = true;
    f.life = f.maxLife = FLASH_LIFE;
    this.group.add(f.mesh);
    this.flashLive.push(f);
  }

  private updateFlashes(dt: number): void {
    const cam = this.cam;
    for (let i = this.flashLive.length - 1; i >= 0; i--) {
      const f = this.flashLive[i];
      f.life -= dt;
      const k = Math.max(0, f.life) / f.maxLife;
      // pop out fast then fade — snappy bloom
      f.mesh.scale.setScalar(f.base * (0.55 + (1 - k) * 1.7));
      // ease-out fade (sharper falloff reads punchier than linear)
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = k * k;
      // billboard toward the camera, keeping a slow roll for life
      if (cam) f.mesh.quaternion.copy(cam.quaternion);
      f.mesh.rotateZ(f.spin * dt);
      if (f.life <= 0) {
        this.retireFlash(f);
        this.flashLive.splice(i, 1);
      }
    }
  }

  private retireFlash(f: Flash): void {
    f.mesh.visible = false;
    this.group.remove(f.mesh);
    this.flashPool.push(f);
  }

  // ===================== internals: tracer ================================
  private acquireTracer(): Tracer | null {
    if (this.tracerLive.length >= MAX_TRACERS) {
      // don't steal an in-flight tracer (that would drop its onArrive impact);
      // signal exhaustion so the caller can fire onArrive immediately instead.
      return null;
    }
    let t = this.tracerPool.pop();
    if (!t) {
      const mesh = new THREE.Mesh(this.dartGeo, glowMaterial(0xffffff, 1.4));
      t = {
        mesh,
        kind: "bolt",
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        prog: 0,
        speed: 0,
        life: 0,
        maxLife: 0,
        color: 0xffffff,
        dist: 1,
        trailAcc: 0,
        flicker: 0,
        onArrive: null,
      };
    }
    t.mesh.scale.set(1, 1, 1);
    this.group.add(t.mesh);
    this.tracerLive.push(t);
    return t;
  }

  private updateTracers(dt: number): void {
    for (let i = this.tracerLive.length - 1; i >= 0; i--) {
      const t = this.tracerLive[i];
      let done = false;
      if (t.kind === "beam") {
        t.life -= dt;
        t.flicker += dt * 60;
        const k = Math.max(0, t.life) / t.maxLife;
        const mat = t.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.5 + k * 2.0;
        mat.opacity = k;
        mat.transparent = true;
        // cheap "electric" feel: jitter thickness + nudge the lance laterally so
        // it shimmers like a live arc (no extra geometry, just scale/position).
        const jig = 0.7 + Math.abs(Math.sin(t.flicker)) * 0.6;
        t.mesh.scale.x = jig;
        t.mesh.scale.y = jig;
        if (!LOW_TIER) {
          // sideways shiver along the beam's perpendicular
          _dir.copy(t.to).sub(t.from);
          if (_dir.lengthSq() > 1e-6) {
            _dir.normalize();
            _perp.set(-_dir.z, 0, _dir.x); // horizontal perpendicular
            _v2.copy(t.from).add(t.to).multiplyScalar(0.5);
            _v2.addScaledVector(_perp, Math.sin(t.flicker * 1.7) * 0.12);
            t.mesh.position.copy(_v2);
          }
        }
        if (t.life <= 0) done = true;
      } else {
        t.prog += t.speed * dt;
        const p = Math.min(1, t.prog);
        // straight lerp; shells add a parabolic vertical arc on top
        _v0.copy(t.from).lerp(t.to, p);
        if (t.kind === "shell") {
          _v0.y += SHELL_ARC * 4 * p * (1 - p); // 0 at ends, peak mid-flight
        }
        // orient toward the next point along the path for a believable streak
        const pNext = Math.min(1, p + 0.04);
        _v1.copy(t.from).lerp(t.to, pNext);
        if (t.kind === "shell") _v1.y += SHELL_ARC * 4 * pNext * (1 - pNext);
        t.mesh.position.copy(_v0);
        if (_v1.distanceToSquared(_v0) > 1e-6) this.orientToward(t.mesh, _v0, _v1);
        // bolts shed a faint trail puff so the dart leaves a hot streak behind
        if (!LOW_TIER && t.kind === "bolt") {
          t.trailAcc += dt;
          if (t.trailAcc >= 0.018) {
            t.trailAcc = 0;
            const s = this.acquireSpark();
            if (s) {
              this.tintGlow(s.mesh, t.color, 1.6);
              s.mesh.position.copy(_v0);
              s.vel.set(rand(1.2), rand(1.2), rand(1.2));
              s.spin.set(rand(6), rand(6), rand(6));
              s.base = 0.3 + Math.random() * 0.25;
              s.drag = 0.8;
              s.gravity = 0.15; // hangs in the air briefly as a glowing wisp
              s.life = s.maxLife = SPARK_LIFE * 0.3;
            }
          }
        }
        if (t.prog >= 1) {
          done = true;
          if (t.onArrive) t.onArrive(t.to, t.color);
        }
      }
      if (done) {
        this.retireTracer(t);
        this.tracerLive.splice(i, 1);
      }
    }
  }

  private retireTracer(t: Tracer): void {
    t.mesh.visible = false;
    t.onArrive = null;
    const mat = t.mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = 1;
    mat.transparent = false;
    t.mesh.scale.set(1, 1, 1); // reset beam jitter so reuse starts clean
    this.group.remove(t.mesh);
    this.tracerPool.push(t);
  }

  // ===================== internals: ring ==================================
  private spawnRing(
    pos: THREE.Vector3,
    color: number,
    radius: number,
    life: number,
    startScale = 0.4,
  ): void {
    if (this.ringLive.length >= MAX_RINGS) {
      const old = this.ringLive.shift();
      if (old) this.retireRing(old);
    }
    let r = this.ringPool.pop();
    if (!r) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2; // lay flat on the ground plane
      r = { mesh, life: 0, maxLife: 0, radius, thickness: 0.4 };
    }
    (r.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    r.mesh.position.copy(pos);
    r.mesh.position.y += 0.06; // hover just above ground to avoid z-fight
    r.radius = radius;
    r.thickness = startScale;
    // a tiny random spin so repeated poison/acquire rings don't look identical
    r.mesh.rotation.z = Math.random() * 6.28;
    r.mesh.scale.setScalar(Math.max(0.18, radius * startScale * 0.4));
    r.mesh.visible = true;
    r.life = r.maxLife = life;
    this.group.add(r.mesh);
    this.ringLive.push(r);
  }

  private updateRings(dt: number): void {
    for (let i = this.ringLive.length - 1; i >= 0; i--) {
      const r = this.ringLive[i];
      r.life -= dt;
      const k = Math.max(0, r.life) / r.maxLife; // 1..0
      // ease-out growth: fast snap outward then settle (punchy shockwave)
      const grow = 1 - k * k;
      r.mesh.scale.setScalar(0.18 + grow * r.radius);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = k * k; // fade quicker late
      if (r.life <= 0) {
        this.retireRing(r);
        this.ringLive.splice(i, 1);
      }
    }
  }

  private retireRing(r: Ring): void {
    r.mesh.visible = false;
    this.group.remove(r.mesh);
    this.ringPool.push(r);
  }

  // ===================== internals: float text ============================
  private updateTexts(dt: number): void {
    for (let i = this.textLive.length - 1; i >= 0; i--) {
      const ft = this.textLive[i];
      ft.life -= dt;
      ft.vel.y -= 3.5 * dt; // gentle gravity so it arcs as it rises
      ft.sprite.position.addScaledVector(ft.vel, dt);
      const k = ft.life / ft.maxLife;
      (ft.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, k * 1.8));
      // punch-out ease back to resting size over the first ~0.14s (overshoot)
      const age = ft.maxLife - ft.life;
      if (age < 0.14) {
        const t = age / 0.14; // 0..1
        const p = 1 + 0.55 * (1 - t) * (1 - t); // springy overshoot decay
        ft.sprite.scale.set(ft.baseX * p, ft.baseY * p, 1);
      } else if (ft.sprite.scale.x !== ft.baseX) {
        ft.sprite.scale.set(ft.baseX, ft.baseY, 1);
      }
      if (ft.life <= 0) {
        this.retireText(ft);
        this.textLive.splice(i, 1);
      }
    }
  }

  private retireText(ft: FloatLabel): void {
    ft.sprite.visible = false;
    this.group.remove(ft.sprite);
    this.textPool.push(ft);
  }

  private labelTexture(text: string, color: number): THREE.Texture {
    const css = "#" + (color & 0xffffff).toString(16).padStart(6, "0");
    const key = `${text}|${css}`;
    const hit = this.texCache.get(key);
    if (hit) return hit;
    // cap distinct textures: evict the oldest entry (Map preserves insert order)
    if (this.texCache.size >= MAX_TEXT_CACHE) {
      const firstKey = this.texCache.keys().next().value as string | undefined;
      if (firstKey !== undefined) {
        const old = this.texCache.get(firstKey);
        if (old) old.dispose();
        this.texCache.delete(firstKey);
      }
    }
    const FONT = "900 46px system-ui, sans-serif";
    const PAD = 30; // room for the outline + glow on both sides
    const H = 76;
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    // measure first so the canvas (and thus sprite aspect) fits the whole string
    g.font = FONT;
    const w = Math.ceil(g.measureText(text).width);
    c.width = Math.max(72, w + PAD * 2);
    c.height = H;
    // context resets on resize — re-apply all draw state
    g.font = FONT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const cx = c.width / 2;
    const cy = H / 2;
    // colored glow halo (drawn via shadow on the outline pass) for "pop"
    g.shadowColor = css;
    g.shadowBlur = 14;
    g.shadowOffsetX = 0;
    g.shadowOffsetY = 0;
    g.lineJoin = "round";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(0,0,0,0.92)"; // chunky dark outline for legibility
    g.strokeText(text, cx, cy);
    // second glow pass with the colored shadow to intensify the halo
    g.shadowBlur = 8;
    g.strokeText(text, cx, cy);
    g.shadowBlur = 0;
    // soft inner drop so the fill sits above the outline with depth
    g.shadowColor = "rgba(0,0,0,0.5)";
    g.shadowBlur = 2;
    g.shadowOffsetY = 1.5;
    // crisp bright fill, brightened a touch so it reads as hot
    _white.set(color).lerp(WHITE, 0.22);
    g.fillStyle = "#" + (_white.getHex() & 0xffffff).toString(16).padStart(6, "0");
    g.fillText(text, cx, cy);
    g.shadowOffsetY = 0;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false; // avoid per-spawn GPU upload stalls
    tex.minFilter = THREE.LinearFilter;
    this.texCache.set(key, tex);
    return tex;
  }

  // ===================== shared helpers ===================================
  // Tint a pooled mesh's emissive glow material to `color` at `intensity`.
  private tintGlow(mesh: THREE.Mesh, color: number, intensity: number): void {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(color);
    mat.emissive.set(color);
    mat.emissiveIntensity = intensity;
  }

  // Orient a dart so its long (+Z) axis points from `a` toward `b`.
  private orientToward(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    _dir.copy(b).sub(a);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    _q.setFromUnitVectors(FWD, _dir);
    mesh.quaternion.copy(_q);
  }

  // Stretch + position a unit beam bar to span from `a` to `b`.
  private orientBeam(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, dist: number): void {
    _v2.copy(a).add(b).multiplyScalar(0.5); // midpoint
    mesh.position.copy(_v2);
    this.orientToward(mesh, a, b);
    mesh.scale.set(1, 1, dist); // beamGeo is unit-length on Z
  }

  // Locate the scene's active PerspectiveCamera so flashes can billboard.
  private findCamera(): THREE.Camera | null {
    let cam: THREE.Camera | null = null;
    this.scene.traverse((o) => {
      if (!cam && (o as THREE.Camera).isCamera) cam = o as THREE.Camera;
    });
    return cam;
  }
}

// box geometries are built along +Z; this is the axis we rotate to face travel
const FWD = new THREE.Vector3(0, 0, 1);

// a second scratch Color so blend helpers can read `color` without clobbering
// the `_white` accumulator mid-expression.
const _scratchColor = new THREE.Color();
function _tmpColor(hex: number): THREE.Color {
  return _scratchColor.set(hex);
}

// small symmetric random in [-m, m]
function rand(m: number): number {
  return (Math.random() - 0.5) * 2 * m;
}

// dispose a mesh's material (+ optionally geometry — shared geos handled once)
function disposeMesh(mesh: THREE.Mesh, disposeGeo: boolean): void {
  const mat = mesh.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else (mat as THREE.Material).dispose();
  if (disposeGeo) mesh.geometry.dispose();
}

// reference voxelMaterial/VOX so the chunky-voxel palette is part of this module's
// contract (chips can be swapped to a matte voxel look by callers if desired).
export const VOX_CHIP = { material: voxelMaterial, tones: VOX };
