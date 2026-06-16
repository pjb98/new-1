import * as THREE from "three";
import { VoxelChar } from "../voxelChar";
import { voxelMaterial, glowMaterial } from "../palette";
import { TD_PATH, pathLength, pointAt, headingAt, type Vec2 } from "./tdpath";

/**
 * Tower-Defense CREEP (enemy) manager.
 *
 * Creeps are voxel walkers that march along the fixed `TD_PATH` lane from the
 * spawn (off the west edge) to your base. Like the survival-mode `Zombie` and
 * the Bed Wars raiders they ride the shared `VoxelChar` rig (zombie:true for the
 * shambling, arms-forward silhouette + gait), but unlike free-roaming bots they
 * do NOT steer — each creep advances by a single scalar arc-length `dist` along
 * the lane (see tdpath.ts). `pointAt(dist)` gives its world position, and when
 * that report comes back `done` the creep has reached the base ("leaked").
 *
 * The integrator owns the scene, wave pacing, towers and the gold economy. This
 * module owns only the creeps. Towers read `enemies()` to pick targets and call
 * `damage()` / `applySlow()` / `damageNear()`; the kill bounty for every creep
 * killed surfaces EXACTLY ONCE through the next `update()` return value, so the
 * integrator can credit gold without double-counting.
 */

// ---- tuning (exposed as consts so the integrator can read the numbers) ----
/** XZ radius of a creep, used for splash / proximity hit tests. */
export const CREEP_RADIUS = 0.8;
/** Base body / head tint of a plain creep (a sickly green). */
export const BASE_BODY = 0x4caf50;
export const BASE_HEAD = 0x2e7d32;
/** Per-kind tints + scale. Unknown kinds fall back to the base green at 1x. */
export const KIND_TINTS: Record<string, { body: number; head: number; scale: number }> = {
  // fast: pale, smaller, twitchy runner
  fast: { body: 0xb2ff59, head: 0x76ff03, scale: 0.8 },
  // tank: bruised purple, chunky
  tank: { body: 0x7e57c2, head: 0x4527a0, scale: 1.35 },
  // boss: angry red, looming
  boss: { body: 0xd32f2f, head: 0x7f0000, scale: 1.9 },
  // armored: cold grey steel, sturdy
  armored: { body: 0x9aa3ad, head: 0x5c636b, scale: 1.15 },
  // camo: ghostly pale blue, faint
  camo: { body: 0xbfe9ff, head: 0x8fd0ee, scale: 0.95 },
  // regrow: sickly bright green, pulsing
  regrow: { body: 0x69f0ae, head: 0x00bfa5, scale: 1.0 },
};
/** Eye tint shared by all creeps. */
export const CREEP_EYE = 0x111111;
/** Duration (seconds) of the red hit-flash pulse on damage. */
export const FLASH_TIME = 0.12;
/** Lifetime (seconds) of the voxel-chip death-pop burst. */
export const POP_TIME = 0.45;
/** How many chips a death pop spits out (scaled up a touch for bosses). */
const POP_CHIPS = 7;

/** Pre-computed full arc length of the lane (constant for the fixed TD_PATH).
 *  Exposed so the integrator can size wave timing / progress bars off it. */
export const PATH_LEN = pathLength(TD_PATH);

/** What the integrator hands `spawn()` to define one creep. */
export interface TdSpawnSpec {
  hp: number; // starting / max HP
  speed: number; // arc-length units travelled per second (before slow)
  bounty: number; // gold awarded to the integrator when this creep is killed
  kind?: string; // visual variant: "fast"|"tank"|"boss"|"armored"|"camo"|"regrow"|(default)
  armor?: number; // 0..0.9 damage reduction vs NON-piercing towers (armored answer = cannon/sniper)
  camo?: boolean; // untargetable unless revealed by a detector pylon
  regen?: number; // HP regenerated per second if not killed (regrow answer = burst)
  leakDmg?: number; // base HP damage if it reaches the base (Duel); default 1
}

/** A live-creep snapshot row for tower targeting (see `enemies()`). */
export interface TdEnemyView {
  id: number;
  pos: THREE.Vector3; // live position vector (the creep's own, not a copy)
  hp: number;
  maxHp: number; // for health-bar rendering / overkill checks
  dist: number; // arc-length travelled — target the largest to defend the base
  alive: boolean;
  armor: number; // 0..0.9 reduction vs non-piercing damage
  camo: boolean; // untargetable unless revealed this frame
  revealed: boolean; // a detector pylon has it lit this frame
}

/** One live creep: its rig, lane progress, HP and transient timers. */
interface Creep {
  id: number;
  char: VoxelChar;
  kind: string; // visual archetype (drives the per-frame decor animation)
  pos: THREE.Vector3; // live world position (kept in sync with char.root)
  dist: number; // arc-length travelled along TD_PATH
  hp: number;
  maxHp: number;
  speed: number;
  bounty: number;
  flash: number; // remaining hit-flash time
  slowFactor: number; // active speed multiplier (1 = none)
  slowTime: number; // seconds remaining on the active slow
  armor: number; // 0..0.9 reduction vs non-piercing damage
  camo: boolean; // untargetable unless revealed
  regen: number; // HP/sec self-heal (regrow)
  revealed: boolean; // lit by a detector this frame (reset each update)
  leakDmg: number; // base-HP damage on leak (Duel)
  phase: number; // per-creep anim phase so shimmer/throb desync across the wave
  scale: number; // base rig scale (so decor can pulse around it)
  pop: number; // 0→1 spawn scale-in progress
  decor: THREE.Group; // archetype add-on boxes (eyes/plates/spikes/streak…)
  ghostMats: THREE.Material[]; // camo body mats toggled solid/translucent on reveal
  throbMats: THREE.MeshStandardMaterial[]; // regrow mats whose emissive pulses
  pip?: THREE.Sprite; // floating HP pip (damaged / boss creeps)
  pipMat?: THREE.SpriteMaterial;
  pipTex?: THREE.CanvasTexture;
}

/** A short-lived voxel-chip burst spawned where a creep dies. Scene-owned via the
 *  manager's `group`; ticked + disposed in `update()` once its life elapses. */
interface DeathPop {
  group: THREE.Group;
  chips: THREE.Mesh[];
  vels: THREE.Vector3[]; // per-chip velocity (XYZ), gravity applied each frame
  spins: THREE.Vector3[]; // per-chip angular velocity
  mat: THREE.MeshStandardMaterial; // one shared material for the whole burst
  geo: THREE.BoxGeometry; // one shared geometry for the whole burst
  life: number; // seconds elapsed
}

/**
 * Manager for every creep currently on the lane. Add `.group` to the scene,
 * `spawn()` per wave, `update(dt)` each frame (reading its return for leaks +
 * kill bounties), and route tower hits through `damage` / `damageNear` /
 * `applySlow`. Everything is removed + disposed on `clear()` (mode leave).
 */
export class TdEnemies {
  readonly group = new THREE.Group();
  private creeps: Creep[] = [];
  private nextId = 1;
  /** Bounties of creeps killed since the last `update()` drain — surfaced once. */
  private pendingBounties: number[] = [];
  /** Live death-pop bursts; ticked + reaped in `update()`. */
  private pops: DeathPop[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Total number of creeps tracked (all are live; dead ones are removed). */
  get count(): number {
    return this.creeps.length;
  }

  /** Number of live creeps (hp > 0). Dead creeps are disposed immediately, so
   *  this currently equals `count`; kept distinct for caller intent + clarity. */
  get aliveCount(): number {
    let n = 0;
    for (const c of this.creeps) if (c.hp > 0) n++;
    return n;
  }

  /**
   * Spawn one creep at the lane start (`pointAt(0)`) with `dist = 0` and full
   * HP. The body/head are tinted (and the rig scaled) per `spec.kind`: a sickly
   * green by default, with distinct looks for "fast" / "tank" / "boss".
   */
  spawn(spec: TdSpawnSpec): void {
    const kind = spec.kind ?? "";
    const tint = (kind && KIND_TINTS[kind]) || { body: BASE_BODY, head: BASE_HEAD, scale: 1 };
    // zombie:true gives the shambling, arms-forward creep silhouette + gait.
    const char = new VoxelChar({ body: tint.body, head: tint.head, eye: CREEP_EYE, zombie: true });
    char.setColor(tint.body, tint.head); // also tints legs to match the body
    char.root.scale.setScalar(tint.scale);
    char.play("walk");

    const start = pointAt(0, TD_PATH);
    const pos = new THREE.Vector3(start.x, 0, start.z);
    char.root.position.copy(pos);
    this.group.add(char.root);

    // ---- archetype decor: a small kit of extra voxel boxes bolted to the rig so
    // each kind reads instantly at the game's zoom. Built once per creep; freed in
    // disposeCreep(). The lists feed the per-frame shimmer/throb in update().
    const ghostMats: THREE.Material[] = [];
    const throbMats: THREE.MeshStandardMaterial[] = [];
    const decor = this.buildDecor(kind, tint, ghostMats, throbMats);
    char.root.add(decor);

    // camo: push the rig's own body mats translucent so the creep is ghostly when
    // unrevealed. We collect them into ghostMats and toggle opacity in update().
    if (kind === "camo") {
      char.root.traverse((o) => {
        const mat = (o as THREE.Mesh).material;
        if (mat instanceof THREE.MeshStandardMaterial && !ghostMats.includes(mat)) {
          mat.transparent = true;
          mat.opacity = 0.32;
          ghostMats.push(mat);
        }
      });
    }

    this.creeps.push({
      id: this.nextId++,
      char,
      kind,
      pos,
      dist: 0,
      hp: spec.hp,
      maxHp: spec.hp,
      speed: spec.speed,
      bounty: spec.bounty,
      flash: 0,
      slowFactor: 1,
      slowTime: 0,
      armor: Math.max(0, Math.min(0.9, spec.armor ?? 0)),
      camo: !!spec.camo,
      regen: Math.max(0, spec.regen ?? 0),
      revealed: false,
      leakDmg: Math.max(0, spec.leakDmg ?? 1),
      phase: Math.random() * Math.PI * 2,
      scale: tint.scale,
      pop: 0, // 0→1 spawn scale-in
      decor,
      ghostMats,
      throbMats,
    });
    char.root.scale.setScalar(tint.scale * 0.15); // start tiny, pop in via update()
  }

  /**
   * Build the per-archetype voxel add-on kit. Returns a group (already positioned
   * in the rig's LOCAL space, so it scales with `char.root.scale`). Collects camo
   * "ghost" materials into `ghostMats` and regrow pulsing materials into
   * `throbMats` so `update()` can animate them without re-walking the tree.
   *
   * Each archetype gets a distinct, readable silhouette so a player knows the
   * counter at a glance:
   *  - fast   — a forward speed-fin + a faint motion streak trailing behind.
   *  - tank   — bulky shoulder pauldrons + a back hump (heavy mass).
   *  - boss   — horns, back spikes and glowing eyes (imposing).
   *  - armored— bolted steel chest/shoulder plates with a metallic sheen.
   *  - camo   — a translucent shimmer shell (solid look comes on when revealed).
   *  - regrow — pulsing green spore nodes that throb in sync with self-heal.
   *  - default— a couple of sickly antennae nubs to sell the grunt.
   */
  private buildDecor(
    kind: string,
    tint: { body: number; head: number; scale: number },
    ghostMats: THREE.Material[],
    throbMats: THREE.MeshStandardMaterial[],
  ): THREE.Group {
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, glow = false): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glow ? glowMaterial(color, 1.1) : voxelMaterial(color));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    switch (kind) {
      case "fast": {
        // sleek forward fin on the head + a swept dorsal fin → "leaning runner"
        box(0.1, 0.34, 0.5, 0, 2.0, 0.18, 0xeaffd6);
        box(0.12, 0.28, 0.36, 0, 1.5, -0.34, tint.head); // tail fin
        // faint motion streak: a stretched translucent slab trailing behind
        const streakMat = new THREE.MeshBasicMaterial({ color: 0xb2ff59, transparent: true, opacity: 0.22, depthWrite: false });
        const streak = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.1), streakMat);
        streak.position.set(0, 1.2, -0.8);
        g.add(streak);
        break;
      }
      case "tank": {
        // chunky shoulder pauldrons + a heavy back hump
        for (const sx of [-1, 1]) box(0.34, 0.34, 0.5, sx * 0.56, 1.5, 0, tint.head);
        box(0.7, 0.5, 0.42, 0, 1.45, -0.34, tint.head); // back hump
        box(0.86, 0.16, 0.56, 0, 0.66, 0, tint.head); // waist band (heft)
        break;
      }
      case "boss": {
        // horns, a jagged back-spike ridge, jaw, and big glowing eyes → menace
        for (const sx of [-1, 1]) {
          box(0.16, 0.5, 0.16, sx * 0.34, 2.36, 0, 0x3a0000);
          box(0.13, 0.26, 0.13, sx * 0.42, 2.7, 0, 0x3a0000);
        }
        for (let i = 0; i < 4; i++) box(0.16, 0.4 - i * 0.06, 0.16, 0, 1.7, -0.2 - i * 0.22, 0x4a0000);
        box(0.5, 0.12, 0.2, 0, 1.62, 0.36, 0x3a0000); // heavy jaw
        // glowing eyes overlaid on the rig's dot-eyes
        for (const sx of [-1, 1]) box(0.16, 0.16, 0.06, sx * 0.16, 1.88, 0.4, 0xff3b1f, true);
        break;
      }
      case "armored": {
        // bolted steel chest + shoulder plates with a metallic sheen
        const plate = (w: number, h: number, d: number, x: number, y: number, z: number) => {
          const mat = new THREE.MeshStandardMaterial({ color: 0xc4ccd6, roughness: 0.35, metalness: 0.85, flatShading: true });
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          m.position.set(x, y, z);
          g.add(m);
          return m;
        };
        plate(0.86, 0.66, 0.12, 0, 1.08, 0.26); // chest plate
        for (const sx of [-1, 1]) plate(0.4, 0.36, 0.5, sx * 0.54, 1.5, 0); // pauldrons
        plate(0.78, 0.5, 0.1, 0, 1.85, -0.4); // helmet backplate
        // bolts (dark studs) so "this is steel — bring piercing"
        for (const sx of [-0.28, 0.28]) for (const sy of [0.92, 1.24]) box(0.08, 0.08, 0.04, sx, sy, 0.33, 0x3a4048);
        break;
      }
      case "camo": {
        // a translucent shimmer shell — the creep is hard to see until revealed.
        // The body/head/leg mats are also pushed translucent in spawn-time toggle.
        const shellMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
        const shell = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.4, 0.8), shellMat);
        shell.position.set(0, 1.2, 0);
        g.add(shell);
        ghostMats.push(shellMat);
        break;
      }
      case "regrow": {
        // pulsing spore nodes that throb in sync with the self-heal
        const node = (x: number, y: number, z: number) => {
          const m = new THREE.MeshStandardMaterial({ color: 0x69f0ae, emissive: 0x00e676, emissiveIntensity: 0.6, roughness: 0.5 });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), m);
          mesh.position.set(x, y, z);
          g.add(mesh);
          throbMats.push(m);
        };
        node(-0.42, 1.3, 0.1); node(0.42, 1.0, 0.12); node(0.0, 1.55, -0.3); node(-0.3, 0.9, -0.2);
        box(0.16, 0.3, 0.16, 0, 2.18, 0, 0x00e676, true); // crown sprout
        break;
      }
      default: {
        // plain grunt: two limp sickly antennae so it isn't totally bare
        for (const sx of [-1, 1]) {
          box(0.05, 0.26, 0.05, sx * 0.16, 2.22, 0, BASE_HEAD);
          box(0.1, 0.1, 0.1, sx * 0.16, 2.4, 0, 0xc8e6a0);
        }
        break;
      }
    }
    return g;
  }

  /**
   * Advance every creep along the lane by `speed * slow * dt`, position + face
   * it, tick its anim + timers, and reap creeps that reached the base.
   *
   * Returns `{ leaked, bounties }`:
   *  - `leaked` — how many creeps walked into the base this frame (they are
   *    removed + disposed; the integrator should subtract base lives).
   *  - `bounties` — the bounty value of every creep KILLED since the previous
   *    `update()` (by `damage`/`damageNear`), drained here so each kill is
   *    credited EXACTLY once. Leaked creeps pay no bounty.
   */
  update(dt: number): { leaked: number; leakedDamage: number; bounties: number[] } {
    let leaked = 0;
    let leakedDamage = 0;
    // iterate back-to-front so splice-on-leak doesn't skip the next creep
    for (let i = this.creeps.length - 1; i >= 0; i--) {
      const c = this.creeps[i];

      // camo reveal is per-frame: detectors re-light it after this update tick.
      // Capture last frame's reveal state (set by detectors AFTER the previous
      // update) so the shimmer can show the "spotted" look before we clear it.
      const wasRevealed = c.revealed;
      c.revealed = false;
      // regrow: self-heal up to max if it survived the last hit. Track whether it
      // healed this frame so the throb can pulse in sync with the regen.
      const healing = c.regen > 0 && c.hp < c.maxHp;
      if (healing) c.hp = Math.min(c.maxHp, c.hp + c.regen * dt);

      // expire the active slow, then advance by the (possibly slowed) speed
      if (c.slowTime > 0) {
        c.slowTime -= dt;
        if (c.slowTime <= 0) c.slowFactor = 1;
      }
      c.dist += c.speed * c.slowFactor * dt;

      const p = pointAt(c.dist, TD_PATH);
      if (p.done) {
        // reached the base — leaked. Remove + dispose; no bounty.
        leakedDamage += c.leakDmg;
        this.disposeCreep(c);
        this.creeps.splice(i, 1);
        leaked++;
        continue;
      }

      c.pos.set(p.x, 0, p.z);
      c.char.root.position.copy(c.pos);

      // face the lane heading (atan2(dx,dz) matches the rig's forward +Z)
      const h = headingAt(c.dist, TD_PATH);
      c.char.root.rotation.y = Math.atan2(h.dx, h.dz);
      c.char.play("walk");

      // decay the hit flash (red emissive pulse on tower impact)
      if (c.flash > 0) {
        c.flash -= dt;
        c.char.setHitFlash(Math.max(0, c.flash / FLASH_TIME));
      }

      // spawn pop-in: the creep springs up to full size as it emerges
      if (c.pop < 1) {
        c.pop = Math.min(1, c.pop + dt * 4);
        const e = 1 + 2.7 * Math.pow(c.pop - 1, 3) + 1.7 * Math.pow(c.pop - 1, 2); // easeOutBack
        c.char.root.scale.setScalar(c.scale * Math.max(0.15, e));
      }

      // per-archetype juice: shimmer/throb/streak + the floating HP pip
      c.phase += dt;
      this.animateDecor(c, wasRevealed, healing);
      this.updatePip(c);

      c.char.update(dt);
    }

    // tick + reap the voxel-chip death pops (scene-owned, freed when expired)
    if (this.pops.length > 0) this.updatePops(dt);

    // drain the pending kill bounties so each surfaces exactly once
    let bounties: number[];
    if (this.pendingBounties.length > 0) {
      bounties = this.pendingBounties;
      this.pendingBounties = [];
    } else {
      bounties = [];
    }
    return { leaked, leakedDamage, bounties };
  }

  /**
   * Per-frame archetype animation: shimmer the camo shell, throb the regrow
   * nodes in sync with healing, sway the fast runner's streak, and twitch the
   * boss horns. Cheap trig only; no allocations.
   */
  private animateDecor(c: Creep, wasRevealed: boolean, healing: boolean): void {
    switch (c.kind) {
      case "camo": {
        // Unrevealed: ghostly + low opacity, gently shimmering. Spotted (revealed
        // last frame): snap solid + an outline glow so the player can react.
        const shimmer = 0.12 + (Math.sin(c.phase * 3 + c.phase) * 0.5 + 0.5) * 0.1;
        for (const m of c.ghostMats) {
          const bm = m as THREE.Material & { opacity: number };
          if (m instanceof THREE.MeshBasicMaterial) {
            // the additive shimmer shell
            bm.opacity = wasRevealed ? 0.5 : shimmer;
            m.color.set(wasRevealed ? 0xfff1a8 : 0xbfe9ff);
          } else if (m instanceof THREE.MeshStandardMaterial) {
            // the body parts: opaque + lit when spotted, translucent otherwise.
            // Don't touch emissive while the hit-flash owns it (avoids fighting it).
            bm.opacity = wasRevealed ? 1 : 0.3;
            if (c.flash <= 0) {
              m.emissive.set(wasRevealed ? 0xffd24a : 0x000000);
              m.emissiveIntensity = wasRevealed ? 0.5 : 1;
            }
          }
        }
        break;
      }
      case "regrow": {
        // throb brighter while actively healing; gentle idle pulse otherwise
        const base = healing ? 1.1 : 0.45;
        const amp = healing ? 0.9 : 0.25;
        const pulse = base + (Math.sin(c.phase * 6) * 0.5 + 0.5) * amp;
        for (const m of c.throbMats) m.emissiveIntensity = pulse;
        // a little vertical bob on the whole decor sells the "growing" feel
        c.decor.position.y = Math.sin(c.phase * 4) * 0.03;
        break;
      }
      case "fast": {
        // the trailing streak flickers with stride speed for a sense of motion
        const last = c.decor.children[c.decor.children.length - 1] as THREE.Mesh;
        const mat = last.material as THREE.MeshBasicMaterial;
        if (mat && mat.opacity !== undefined) mat.opacity = 0.14 + (Math.sin(c.phase * 18) * 0.5 + 0.5) * 0.16;
        break;
      }
      case "boss": {
        // a slow, heavy menace bob
        c.decor.position.y = Math.sin(c.phase * 2.2) * 0.04;
        break;
      }
      default:
        break;
    }
  }

  /**
   * Floating HP pip: a tiny billboard bar shown above a creep once it has taken
   * damage (or always for bosses). Built lazily, recoloured each frame by HP
   * fraction (green → amber → red). One sprite per creep; freed in disposeCreep().
   */
  private updatePip(c: Creep): void {
    const damaged = c.hp < c.maxHp;
    const show = damaged || c.kind === "boss";
    if (!show) {
      if (c.pip) c.pip.visible = false;
      return;
    }
    if (!c.pip) this.buildPip(c);
    const pip = c.pip!;
    pip.visible = true;
    const frac = Math.max(0, Math.min(1, c.hp / c.maxHp));
    this.drawPip(c, frac);
    // park the pip above the head; divide by scale since it's a child of the
    // scaled rig (keeps the pip a constant on-screen size across archetypes).
    const s = 1 / Math.max(0.001, c.scale);
    pip.position.set(0, 2.65, 0);
    pip.scale.set(1.4 * s, 0.22 * s, 1);
  }

  /** Lazily create a creep's HP-pip sprite (its own tiny canvas texture). */
  private buildPip(c: Creep): void {
    const cv = document.createElement("canvas");
    cv.width = 48;
    cv.height = 8;
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 999;
    c.char.root.add(sp);
    c.pip = sp;
    c.pipMat = mat;
    c.pipTex = tex;
  }

  /** Redraw a creep's HP pip canvas for the current HP fraction. */
  private drawPip(c: Creep, frac: number): void {
    const tex = c.pipTex;
    if (!tex) return;
    const cv = tex.image as HTMLCanvasElement;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    // dark backing
    ctx.fillStyle = "rgba(10,12,16,0.85)";
    ctx.fillRect(0, 0, cv.width, cv.height);
    // fill: green → amber → red as HP drops
    const r = frac > 0.5 ? Math.round(255 * (1 - frac) * 2) : 255;
    const gch = frac > 0.5 ? 200 : Math.round(200 * frac * 2);
    ctx.fillStyle = `rgb(${r},${gch},60)`;
    const pad = 1;
    ctx.fillRect(pad, pad, (cv.width - pad * 2) * frac, cv.height - pad * 2);
    tex.needsUpdate = true;
  }

  /**
   * Spawn a short-lived voxel-chip burst at `pos` tinted to `kind`. Self-contained:
   * the burst group is added to this manager's scene-owned `group`, animated in
   * `update()`, and fully disposed when its life elapses (or on `clear()`).
   */
  private spawnPop(pos: THREE.Vector3, kind: string, big: boolean): void {
    const tint = (kind && KIND_TINTS[kind]) || { body: BASE_BODY, head: BASE_HEAD, scale: 1 };
    const group = new THREE.Group();
    group.position.copy(pos);
    const mat = new THREE.MeshStandardMaterial({ color: tint.body, roughness: 0.85, flatShading: true });
    const geo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const n = big ? POP_CHIPS + 5 : POP_CHIPS;
    const chips: THREE.Mesh[] = [];
    const vels: THREE.Vector3[] = [];
    const spins: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      const s = 0.5 + Math.random() * 0.9;
      m.scale.setScalar(s * (big ? 1.5 : 1));
      m.position.set(0, 1.0 + Math.random() * 0.4, 0);
      const ang = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      vels.push(new THREE.Vector3(Math.cos(ang) * speed, 2.5 + Math.random() * 2.5, Math.sin(ang) * speed));
      spins.push(new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12));
      group.add(m);
      chips.push(m);
    }
    this.group.add(group);
    this.pops.push({ group, chips, vels, spins, mat, geo, life: 0 });
  }

  /** Tick every live death-pop: ballistic chips + fade, reaping expired bursts. */
  private updatePops(dt: number): void {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const pop = this.pops[i];
      pop.life += dt;
      const k = pop.life / POP_TIME;
      if (k >= 1) {
        this.group.remove(pop.group);
        pop.geo.dispose();
        pop.mat.dispose();
        this.pops.splice(i, 1);
        continue;
      }
      for (let j = 0; j < pop.chips.length; j++) {
        const v = pop.vels[j];
        v.y -= 12 * dt; // gravity
        const m = pop.chips[j];
        m.position.x += v.x * dt;
        m.position.y += v.y * dt;
        m.position.z += v.z * dt;
        if (m.position.y < 0) { m.position.y = 0; v.x *= 0.6; v.z *= 0.6; v.y = 0; }
        const sp = pop.spins[j];
        m.rotation.x += sp.x * dt;
        m.rotation.y += sp.y * dt;
        m.rotation.z += sp.z * dt;
      }
      // shrink the chips out over the burst's life (cheap fade without alpha sort)
      pop.group.scale.setScalar(1 - k * 0.6);
    }
  }

  /**
   * Snapshot of live creeps for tower targeting. `pos` is each creep's LIVE
   * position vector (not a copy) and `dist` is its arc-length, so a tower can
   * target whichever creep is furthest along (largest `dist`) to best defend
   * the base. The returned array is fresh each call; the rows are lightweight.
   */
  enemies(): TdEnemyView[] {
    const out: TdEnemyView[] = [];
    for (const c of this.creeps) {
      out.push({ id: c.id, pos: c.pos, hp: c.hp, maxHp: c.maxHp, dist: c.dist, alive: c.hp > 0, armor: c.armor, camo: c.camo, revealed: c.revealed });
    }
    return out;
  }

  /** A detector pylon lights every CAMO creep within `radius` (XZ) of `pos` for
   *  this frame, making them targetable by all towers. Call after update(),
   *  before towers pick targets. */
  revealZone(pos: THREE.Vector3, radius: number): void {
    const r2 = radius * radius;
    for (const c of this.creeps) {
      if (!c.camo || c.revealed) continue;
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
      if (dx * dx + dz * dz <= r2) c.revealed = true;
    }
  }

  /**
   * Apply `dmg` to the creep with `id` (e.g. a single-target tower shot) and
   * flash it. If this drops its HP to <= 0 the creep is removed + disposed and
   * its bounty is queued for the next `update()` return. Returns true iff this
   * hit was the killing blow; false if the creep survived or `id` is unknown.
   */
  damage(id: number, dmg: number, pierce = false): boolean {
    const idx = this.indexOf(id);
    if (idx < 0) return false;
    const c = this.creeps[idx];
    c.hp -= pierce ? dmg : dmg * (1 - c.armor); // armored creeps shrug off non-piercing hits
    c.flash = FLASH_TIME;
    c.char.setHitFlash(1);
    if (c.hp <= 0) {
      this.kill(idx);
      return true;
    }
    return false;
  }

  /**
   * Splash damage (e.g. a cannon tower): damage every live creep within
   * `radius` (XZ) of `pos`. Killed creeps are removed + disposed and their
   * bounties queued for the next `update()`. Returns the number KILLED.
   */
  damageNear(pos: THREE.Vector3, radius: number, dmg: number, pierce = false): number {
    const r2 = radius * radius;
    let kills = 0;
    // back-to-front so kill-splice doesn't skip the next creep
    for (let i = this.creeps.length - 1; i >= 0; i--) {
      const c = this.creeps[i];
      const dx = c.pos.x - pos.x;
      const dz = c.pos.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      c.hp -= pierce ? dmg : dmg * (1 - c.armor);
      c.flash = FLASH_TIME;
      c.char.setHitFlash(1);
      if (c.hp <= 0) {
        this.kill(i);
        kills++;
      }
    }
    return kills;
  }

  /**
   * Apply a slow to the creep with `id` for `seconds`: while active, the creep
   * advances at `factor` of its normal speed (e.g. 0.5 for a frost tower).
   * Slows do not stack additively — the STRONGEST (smallest factor) active slow
   * wins, and its remaining duration is refreshed to at least `seconds`.
   */
  applySlow(id: number, factor: number, seconds: number): void {
    const idx = this.indexOf(id);
    if (idx < 0) return;
    const c = this.creeps[idx];
    // take the strongest active slow; if a slow is already running, keep the
    // stronger factor and extend the timer to the longer of the two.
    if (c.slowTime > 0) {
      c.slowFactor = Math.min(c.slowFactor, factor);
      c.slowTime = Math.max(c.slowTime, seconds);
    } else {
      c.slowFactor = factor;
      c.slowTime = seconds;
    }
  }

  /** Remove + dispose every creep, death-pop and reset ids + pending bounties. */
  clear(): void {
    for (const c of this.creeps) this.disposeCreep(c);
    this.creeps.length = 0;
    for (const pop of this.pops) {
      this.group.remove(pop.group);
      pop.geo.dispose();
      pop.mat.dispose();
    }
    this.pops.length = 0;
    this.pendingBounties.length = 0;
    this.nextId = 1;
  }

  /** Index of the creep with `id`, or -1. */
  private indexOf(id: number): number {
    for (let i = 0; i < this.creeps.length; i++) {
      if (this.creeps[i].id === id) return i;
    }
    return -1;
  }

  /** Reap the creep at `idx`: queue its bounty, fire the death pop, dispose, drop
   *  from the list. Called from `damage`/`damageNear` so every kill pops once. */
  private kill(idx: number): void {
    const c = this.creeps[idx];
    this.pendingBounties.push(c.bounty);
    this.spawnPop(c.pos, c.kind, c.kind === "boss" || c.kind === "tank");
    this.disposeCreep(c);
    this.creeps.splice(idx, 1);
  }

  /** Detach a creep's rig and free its GPU resources (VoxelChar has no dispose).
   *  The decor add-ons + the HP-pip sprite are children of `char.root`, so the
   *  traverse frees their geometry/material too; the pip's canvas texture needs
   *  an explicit dispose (SpriteMaterial.dispose() doesn't free its map). */
  private disposeCreep(c: Creep): void {
    if (c.pipTex) c.pipTex.dispose();
    this.group.remove(c.char.root);
    c.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat?.dispose?.();
    });
  }
}

// `Vec2` is imported to anchor the path types to tdpath's contract.
export type { Vec2 };
