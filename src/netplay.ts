import * as THREE from "three";
import { VoxelChar } from "./voxelChar";
import { ZOMBIE, ZOMBIE_TYPES } from "./config";
import { COLORS } from "./palette";
import { Player } from "./player";
import { Weapon, WEAPONS, BulletSystem } from "./weapons";
import { AssetManager } from "./assets";
import { NetClient, NetMsg, InputMsg, SnapMsg, PlayerSnap, ZombieSnap, AffixCode, AFFIX_CODE_MAX } from "./net";

/** How fast remote transforms chase their networked targets. */
const LERP = 12;

// ---- shared elite-affix aura visuals (guest side) ----
// Mirror zombie.ts's per-affix tell colors so a guest's aura reads the same as
// the host's. Index by AffixCode (1..3); 0 = none has no entry.
const AFFIX_AURA_COLOR: Record<number, number> = {
  [AffixCode.Blazing]: 0xff6a1f,
  [AffixCode.Glacial]: 0x6ad7ff,
  [AffixCode.Overloading]: 0xc792ea,
};
// One flat ring geometry + one material per affix, shared across every guest
// ZombieView (process-wide singletons, never disposed — pooled views just
// re-tint/toggle). Matches the host's _auraGeo/_auraMat approach in zombie.ts.
const _auraGeo = new THREE.RingGeometry(0.55, 0.85, 18);
_auraGeo.rotateX(-Math.PI / 2);
const _auraMat: Record<number, THREE.Material> = {
  [AffixCode.Blazing]: new THREE.MeshBasicMaterial({ color: AFFIX_AURA_COLOR[AffixCode.Blazing], transparent: true, opacity: 0.6, depthWrite: false }),
  [AffixCode.Glacial]: new THREE.MeshBasicMaterial({ color: AFFIX_AURA_COLOR[AffixCode.Glacial], transparent: true, opacity: 0.6, depthWrite: false }),
  [AffixCode.Overloading]: new THREE.MeshBasicMaterial({ color: AFFIX_AURA_COLOR[AffixCode.Overloading], transparent: true, opacity: 0.6, depthWrite: false }),
};

/** A smoothed visual stand-in for a networked player (everyone except yourself). */
class RemoteFigure {
  readonly group = new THREE.Group();
  private char: VoxelChar;
  private tx = 0;
  private tz = 0;
  private try_ = 0;
  private walking = false;

  constructor(private scene: THREE.Scene, color: number) {
    this.char = new VoxelChar({ body: color, head: COLORS.playerAccent, eye: 0x222222, hat: 0xf2c14e, gun: true });
    this.group.add(this.char.root);
    scene.add(this.group);
  }
  setTarget(x: number, z: number, ry: number, walking: boolean) {
    this.tx = x;
    this.tz = z;
    this.try_ = ry;
    this.walking = walking;
  }
  update(dt: number) {
    const k = 1 - Math.exp(-LERP * dt);
    this.group.position.x += (this.tx - this.group.position.x) * k;
    this.group.position.z += (this.tz - this.group.position.z) * k;
    // shortest-arc yaw lerp
    let d = this.try_ - this.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * k;
    this.char.play(this.walking ? "walk" : "idle");
    this.char.update(dt);
  }
  dispose() {
    this.scene.remove(this.group);
  }
}

/** Guest-side zombie visual, pooled by networked id. */
class ZombieView {
  readonly group = new THREE.Group();
  private char: VoxelChar;
  private tx = 0;
  private tz = 0;
  private try_ = 0;
  private state = 0;
  private lastType = -1;
  private scaleVal = 1;
  private color = 0x8fcf6f;
  // Elite affix tell (mirrors host): an aura ring under the zombie + a tinted
  // body emissive. Lazily created the first time an affix arrives; reused after.
  private affix = AffixCode.None;
  private aura?: THREE.Mesh;
  private auraSpin = 0;

  constructor(private scene: THREE.Scene) {
    this.char = new VoxelChar({ body: 0x8fcf6f, head: 0x5f9d4a, eye: 0x141414, zombie: true });
    this.group.add(this.char.root);
    scene.add(this.group);
  }
  apply(s: ZombieSnap) {
    // Clamp the wire affix code to the known range so a hostile/garbage host
    // value can't index a missing material or mis-render. Treat anything out of
    // [0, AFFIX_CODE_MAX] (incl. NaN/undefined) as "none".
    const affix = Number.isInteger(s.affix) && s.affix! >= 0 && s.affix! <= AFFIX_CODE_MAX ? s.affix! : AffixCode.None;
    if (s.type !== this.lastType || affix !== this.affix) {
      const t = ZOMBIE_TYPES[s.type] ?? ZOMBIE_TYPES[0];
      // Affixed zombies glow their tell color; otherwise keep the variant's look.
      const emissive = affix !== AffixCode.None ? AFFIX_AURA_COLOR[affix] : (t.blastRadius !== undefined ? t.body : 0x000000);
      this.char.setColor(t.body, t.head, emissive);
      this.group.scale.setScalar(t.scale);
      this.scaleVal = t.scale;
      this.color = t.body;
      this.lastType = s.type;
      this.applyAffix(affix);
    }
    this.tx = s.x;
    this.tz = s.z;
    this.try_ = s.ry;
    if (s.state !== this.state) {
      this.state = s.state;
      this.char.play(s.state === 1 ? "death" : "walk");
    }
  }
  /** Show/hide + tint the affix aura ring (shared geo/material, zero alloc on toggle). */
  private applyAffix(affix: number) {
    this.affix = affix;
    if (affix === AffixCode.None) {
      if (this.aura) this.aura.visible = false;
      return;
    }
    if (!this.aura) {
      this.aura = new THREE.Mesh(_auraGeo, _auraMat[affix]);
      this.aura.position.y = 0.05;
      this.group.add(this.aura);
    }
    this.aura.material = _auraMat[affix];
    this.aura.visible = true;
  }
  update(dt: number) {
    const k = 1 - Math.exp(-LERP * dt);
    this.group.position.x += (this.tx - this.group.position.x) * k;
    this.group.position.z += (this.tz - this.group.position.z) * k;
    this.group.rotation.y = this.try_;
    if (this.aura && this.aura.visible) {
      this.auraSpin += dt * 1.5;
      this.aura.rotation.y = this.auraSpin;
    }
    this.char.update(dt);
  }
  // cosmetic-hit info for guest-side bullet impacts (alive zombies only)
  get alive(): boolean {
    return this.state === 0;
  }
  get hitX(): number {
    return this.group.position.x;
  }
  get hitZ(): number {
    return this.group.position.z;
  }
  get hitR(): number {
    return ZOMBIE.radius * this.scaleVal + 0.35;
  }
  get puffColor(): number {
    return this.color;
  }
  dispose() {
    this.scene.remove(this.group);
  }
}

/** Host-side record for a connected guest: the Player we simulate for them. */
export interface GuestSlot {
  id: number;
  player: Player;
  /** Full per-guest weapon inventory so guests can buy / swap / Pack-a-Punch. */
  weapons: Weapon[];
  activeSlot: number;
  perks: Set<"tough" | "quick">;
  input: InputMsg;
  aim: THREE.Vector3;
  /** Edge events latched on message receipt so a press isn't lost to frame
   *  timing between the guest's send rate and the host's sim rate. */
  pendingSwap: boolean;
  pendingInteract: boolean;
  /** Consumed by the game layer to run the guest's queued interaction. */
  wantInteract: boolean;
}

const PLAYER_COLORS = [COLORS.player, 0xe06a4a, 0x53b36a, 0xc78ad8];

/** Map a networked player/zombie id to a palette index, never going negative.
 *  Guards `PLAYER_COLORS[(id-1) % len]` against a stray id=0 (→ index -1 →
 *  undefined → `new RemoteFigure(scene, undefined)` crash). */
function colorForId(id: number): number {
  const idx = Math.max(0, (id - 1) % PLAYER_COLORS.length);
  return PLAYER_COLORS[idx];
}

/** A host snapshot arrives over an untrusted relay; the guest must not trust it
 *  wholesale. Reject anything whose shape could crash guestRender: players /
 *  zombies must be arrays, and every entry must carry a finite id ≥ 1 (ids index
 *  palettes and pooled views). Returns true only for a safe-to-render snapshot. */
function isValidSnap(msg: SnapMsg): boolean {
  if (!Array.isArray(msg.players) || !Array.isArray(msg.zombies)) return false;
  for (const p of msg.players) {
    if (!p || typeof p !== "object") return false;
    if (!Number.isFinite(p.id) || p.id < 1) return false;
  }
  for (const z of msg.zombies) {
    if (!z || typeof z !== "object") return false;
    if (!Number.isFinite(z.id) || z.id < 1) return false;
    // Clamp the elite-affix code to the known range at ingress so a hostile or
    // garbage host value can't reach the render path (which indexes per-affix
    // materials). Anything outside [0, AFFIX_CODE_MAX] — incl. NaN/undefined —
    // is normalized to "none" rather than dropping the whole (otherwise valid)
    // frame. The ZombieView keeps its own clamp as defense-in-depth.
    if (!Number.isInteger(z.affix) || (z.affix as number) < 0 || (z.affix as number) > AFFIX_CODE_MAX) {
      z.affix = AffixCode.None;
    }
  }
  return true;
}

/**
 * Owns all multiplayer state for a session. Two roles:
 *  - HOST: simulates a Player for every connected guest and broadcasts the
 *    authoritative world snapshot each network tick.
 *  - GUEST: sends local input every frame and renders the world from snapshots.
 */
export class NetPlay {
  readonly net: NetClient;
  private snapAccum = 0;
  private snapRate = 1 / 30; // 30 Hz — smoother remote players + zombies

  // host state
  private guests = new Map<number, GuestSlot>();
  // guest state
  private latest?: SnapMsg;
  private remote = new Map<number, RemoteFigure>();
  private zviews = new Map<number, ZombieView>();
  netRound = 1;
  netPoints = 0;
  myHp = 100;
  myMaxHp = 100;
  // authoritative position of THIS guest's player (for client-side reconciliation)
  myX = 0;
  myZ = 9;
  myAlive = true;
  myHasAuth = false;
  // local guest's own weapon display (driven by the snapshot)
  myWeapon = "Peashooter";
  myAmmo = 0;
  myReserve = "∞";
  myReloading = false;
  /** Set by main: show a toast pushed from the host. */
  onToast?: (msg: string) => void;
  /** Host-only: fired when the guest roster changes (join/leave) so main can
   *  re-announce the co-op difficulty. Arg is the new TOTAL player count. */
  onRosterChange?: (players: number) => void;

  constructor(
    net: NetClient,
    private scene: THREE.Scene,
    private assets: AssetManager,
    private tracers: BulletSystem,
  ) {
    this.net = net;
    net.onPeerJoin = (id) => this.addGuest(id);
    net.onPeerLeave = (id) => this.removePeer(id);
    net.onMessage = (from, msg) => this.onMessage(from, msg);
  }

  get isHost(): boolean {
    return this.net.isHost;
  }

  // ================= HOST =================
  private addGuest(id: number) {
    if (!this.isHost || this.guests.has(id)) return;
    const player = new Player(this.scene, this.assets);
    player.setSkin(colorForId(id), COLORS.playerAccent);
    player.pos.set((Math.random() - 0.5) * 4, 0, 9);
    this.guests.set(id, {
      id,
      player,
      weapons: [new Weapon(WEAPONS.peashooter)],
      activeSlot: 0,
      perks: new Set(),
      input: { t: "input", mx: 0, mz: 0, ax: 0, az: -1, fire: false, reload: false, swap: false, interact: false },
      aim: new THREE.Vector3(),
      pendingSwap: false,
      pendingInteract: false,
      wantInteract: false,
    });
    this.onRosterChange?.(1 + this.guests.size);
  }

  /** Simulate every guest's Player from their last input. Call inside host sim. */
  hostSimulateGuests(
    dt: number,
    arena: { clamp: Function; resolveObstacles: Function },
    bullets: BulletSystem,
    onShot: (x: number, z: number, dx: number, dz: number, color: number, scale: number) => void,
  ) {
    if (!this.isHost) return;
    for (const slot of this.guests.values()) {
      const inp = slot.input;
      slot.aim.set(inp.ax, 0, inp.az);
      slot.player.update(dt, inp.mx, inp.mz, slot.aim);
      arena.clamp(slot.player.pos, 0.55);
      arena.resolveObstacles(slot.player.pos, 0.55);
      slot.player.group.position.copy(slot.player.pos);

      // weapon swap (latched edge)
      if (slot.pendingSwap) {
        slot.pendingSwap = false;
        if (slot.weapons.length > 1) slot.activeSlot = (slot.activeSlot + 1) % slot.weapons.length;
      }
      // interact (latched edge) — handled by the game layer (needs interactables)
      if (slot.pendingInteract) {
        slot.pendingInteract = false;
        slot.wantInteract = true;
      }

      const w = slot.weapons[slot.activeSlot];
      w.update(dt, slot.player.reloadMul);
      if (inp.fire && slot.player.alive) {
        const before = w.ammo;
        if (w.tryFire(slot.player.muzzle, slot.player.aimDir, bullets) && w.ammo < before) {
          onShot(
            slot.player.muzzle.x, slot.player.muzzle.z, slot.player.aimDir.x, slot.player.aimDir.z,
            w.def.bulletColor ?? COLORS.bullet, w.def.bulletScale ?? 1,
          );
        }
      }
      if (inp.reload) w.reload();
    }
  }

  /** All player positions the host should consider (for zombie targeting). */
  hostPlayerPositions(localPlayer: Player): THREE.Vector3[] {
    const out = [localPlayer.pos];
    for (const s of this.guests.values()) if (s.player.alive) out.push(s.player.pos);
    return out;
  }

  /** Damage the nearest guest at a position (host applies zombie touches here). */
  hostGuestSlots(): GuestSlot[] {
    return [...this.guests.values()];
  }

  /** Build + broadcast the world snapshot (rate-limited). */
  hostBroadcast(
    dt: number,
    localPlayer: Player,
    hostWeapon: Weapon,
    zombies: ZombieSnap[],
    round: number,
    points: number,
    phase: string,
  ) {
    if (!this.isHost) return;
    this.snapAccum += dt;
    if (this.snapAccum < this.snapRate) return;
    this.snapAccum = 0;

    const players: PlayerSnap[] = [this.snapOf(1, localPlayer, hostWeapon)];
    for (const [id, s] of this.guests) players.push(this.snapOf(id, s.player, s.weapons[s.activeSlot]));

    const msg: SnapMsg = { t: "snap", players, zombies, round, points, phase };
    this.net.send(msg);
  }

  private snapOf(id: number, p: Player, w?: Weapon): PlayerSnap {
    return {
      id,
      x: p.pos.x,
      z: p.pos.z,
      ry: p.group.rotation.y,
      hp: p.health,
      maxHp: p.maxHealth,
      alive: p.alive,
      walking: p.moving,
      wn: w?.def.name,
      am: w?.ammo,
      rs: w?.reserveLabel,
      rl: w?.reloading,
    };
  }

  /** Host: broadcast a tracer event so guests can draw the shot. */
  hostShot(x: number, z: number, dx: number, dz: number, color: number, scale: number) {
    if (!this.isHost) return;
    this.net.send({ t: "shot", x, z, dx, dz, color, scale });
  }

  /** Host → one guest: a feedback toast (buy confirmations, "not enough", …). */
  hostToast(id: number, msg: string) {
    if (!this.isHost) return;
    this.net.send({ t: "toast", msg }, id);
  }

  /** Host → all guests: a broadcast toast (e.g. run over / new round). */
  hostNotify(msg: string) {
    if (!this.isHost) return;
    this.net.send({ t: "toast", msg });
  }

  // ================= GUEST =================
  /** Guest: push this frame's local input to the host. */
  guestSendInput(inp: InputMsg) {
    if (this.isHost) return;
    this.net.send(inp);
  }

  /** Guest: live (alive) zombie views, for cosmetic bullet-impact checks. */
  guestZombieViews(out: { x: number; z: number; r: number; color: number }[]): void {
    out.length = 0;
    for (const v of this.zviews.values()) {
      if (v.alive) out.push({ x: v.hitX, z: v.hitZ, r: v.hitR, color: v.puffColor });
    }
  }

  /**
   * Guest: advance interpolation of remote players + zombies, and capture this
   * guest's own authoritative state. The local player itself is moved by the
   * game with client-side prediction + reconciliation (not snapped here), so it
   * feels responsive at 60fps instead of stepping at the snapshot rate.
   */
  guestRender(dt: number, myId: number) {
    if (this.isHost || !this.latest) return;

    for (const ps of this.latest.players) {
      if (ps.id === myId) {
        this.myX = ps.x;
        this.myZ = ps.z;
        this.myAlive = ps.alive;
        this.myHasAuth = true;
        this.myHp = ps.hp;
        this.myMaxHp = ps.maxHp;
        if (ps.wn !== undefined) this.myWeapon = ps.wn;
        if (ps.am !== undefined) this.myAmmo = ps.am;
        if (ps.rs !== undefined) this.myReserve = ps.rs;
        this.myReloading = !!ps.rl;
      } else {
        let fig = this.remote.get(ps.id);
        if (!fig) {
          fig = new RemoteFigure(this.scene, colorForId(ps.id));
          this.remote.set(ps.id, fig);
        }
        fig.setTarget(ps.x, ps.z, ps.ry, ps.walking);
      }
    }
    for (const fig of this.remote.values()) fig.update(dt);

    // zombies
    const seen = new Set<number>();
    for (const zs of this.latest.zombies) {
      seen.add(zs.id);
      let v = this.zviews.get(zs.id);
      if (!v) {
        v = new ZombieView(this.scene);
        this.zviews.set(zs.id, v);
      }
      v.apply(zs);
    }
    for (const [id, v] of this.zviews) {
      if (!seen.has(id)) {
        v.dispose();
        this.zviews.delete(id);
      } else {
        v.update(dt);
      }
    }

    this.netRound = this.latest.round;
    this.netPoints = this.latest.points;
  }

  // ================= shared =================
  private onMessage(from: number, msg: NetMsg) {
    if (msg.t === "input" && this.isHost) {
      const slot = this.guests.get(from);
      if (slot) {
        // Sanitize untrusted guest input: reject NaN/Infinity (would poison the
        // authoritative sim + everyone's view) and clamp movement to a unit
        // vector + aim to the arena, so a guest can't teleport/speedhack/grief.
        const fin = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
        let mx = fin(msg.mx);
        let mz = fin(msg.mz);
        const mlen = Math.hypot(mx, mz);
        if (mlen > 1) { mx /= mlen; mz /= mlen; }
        const LIM = 60;
        msg.mx = mx;
        msg.mz = mz;
        msg.ax = Math.max(-LIM, Math.min(LIM, fin(msg.ax)));
        msg.az = Math.max(-LIM, Math.min(LIM, fin(msg.az, -1)));
        msg.fire = !!msg.fire;
        slot.input = msg;
        // latch discrete presses so they survive send/sim rate mismatch
        if (msg.swap) slot.pendingSwap = true;
        if (msg.interact) slot.pendingInteract = true;
      }
    } else if (msg.t === "snap" && !this.isHost) {
      // The host snapshot is untrusted relay traffic — validate its shape before
      // storing so guestRender's for-of loops + palette indexing can't crash on a
      // non-array players/zombies or a stray id (0/negative/NaN). Drop bad frames;
      // the next valid snapshot recovers (we keep the last good `latest`).
      if (isValidSnap(msg)) this.latest = msg;
    } else if (msg.t === "shot" && !this.isHost) {
      // render a non-colliding tracer locally
      const origin = new THREE.Vector3(msg.x, 1.0, msg.z);
      const dir = new THREE.Vector3(msg.dx, 0, msg.dz);
      this.tracers.spawn(origin, dir, {
        speed: 64, damage: 0, pierce: 0, splashRadius: 0, splashDamage: 0, color: msg.color, scale: msg.scale,
      });
    } else if (msg.t === "toast" && !this.isHost) {
      this.onToast?.(msg.msg);
    }
  }

  private removePeer(id: number) {
    const slot = this.guests.get(id);
    if (slot) {
      this.scene.remove(slot.player.group);
      this.guests.delete(id);
      this.onRosterChange?.(1 + this.guests.size);
    }
    this.remote.get(id)?.dispose();
    this.remote.delete(id);
  }

  dispose() {
    for (const s of this.guests.values()) this.scene.remove(s.player.group);
    this.guests.clear();
    for (const f of this.remote.values()) f.dispose();
    this.remote.clear();
    for (const v of this.zviews.values()) v.dispose();
    this.zviews.clear();
  }
}
