/**
 * Client-side networking transport for online co-op.
 *
 * The backend (see `server/`) is a thin relay: it manages rooms by share-code
 * and forwards opaque application messages between peers. One peer per room is
 * the authoritative HOST (id 1); the others are guests. Everything above the
 * transport — snapshots, inputs — is defined by `NetMsg` and is opaque to the
 * server.
 */

/**
 * Where the relay server lives. Defaults to the deployed Render instance;
 * override with VITE_SERVER_URL at build time (e.g. ws://localhost:8080 for
 * local server testing).
 */
const DEFAULT_SERVER = "wss://zombie-kwhm.onrender.com";
const LS_KEY = "tinydead.server";

/**
 * Resolve the relay URL at RUNTIME (not baked into the build) so a freshly
 * deployed server can be used without rebuilding the client. Priority:
 *   1. `?server=wss://…` query param (also persisted for next time)
 *   2. a previously-saved URL in localStorage
 *   3. the VITE_SERVER_URL build var
 *   4. the default
 */
function resolveServerUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get("server");
    if (q) {
      const u = normalizeWs(q);
      localStorage.setItem(LS_KEY, u);
      return u;
    }
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return saved;
  } catch {
    /* ignore storage/URL issues */
  }
  return ((import.meta as any).env?.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER;
}

/** PartyKit room path the relay server lives at (see partykit/server.ts). */
const PARTYKIT_PATH = "/parties/main/tinydead";

/** Accept bare hosts / http(s) and coerce to a ws(s):// URL. */
function normalizeWs(input: string): string {
  let s = input.trim().replace(/\/+$/, "");
  if (s.startsWith("http://")) s = "ws://" + s.slice(7);
  else if (s.startsWith("https://")) s = "wss://" + s.slice(8);
  else if (!/^wss?:\/\//.test(s)) s = "wss://" + s;
  // A bare PartyKit project host needs the relay room path appended.
  try {
    const u = new URL(s);
    if (/\.partykit\.dev$/i.test(u.hostname) && (u.pathname === "" || u.pathname === "/")) {
      u.pathname = PARTYKIT_PATH;
      s = u.toString().replace(/\/$/, "");
    }
  } catch {
    /* leave as-is */
  }
  return s;
}

let serverUrl = resolveServerUrl();

/** The relay URL in use (resolved at runtime). */
export function getServerUrl(): string {
  return serverUrl;
}

/** Point the client at a different relay (persisted). Returns the normalized URL. */
export function setServerUrl(input: string): string {
  serverUrl = normalizeWs(input);
  try {
    localStorage.setItem(LS_KEY, serverUrl);
  } catch {
    /* ignore */
  }
  return serverUrl;
}

/** @deprecated use getServerUrl(); kept for any external reference. */
export const SERVER_URL: string = serverUrl;

/**
 * Free hosting tiers (Render) spin the server down when idle, so the first
 * connection can take 30–60s to cold-start. Poke the HTTP health endpoint to
 * wake the dyno before we open the WebSocket, which makes the WS connect fast.
 */
export function warmServer(): void {
  try {
    // wss:// -> https://, ws:// -> http:// (NOT a blind /^ws/ replace, which
    // would turn "wss" into "httpss").
    const httpUrl = getServerUrl().replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://").replace(/\/$/, "") + "/health";
    fetch(httpUrl, { mode: "no-cors" }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

// ---- application-level messages (carried inside relay `data`) ----

export interface PlayerSnap {
  id: number;
  x: number;
  z: number;
  ry: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  walking: boolean;
  /** Active weapon display (so a guest can show its own ammo HUD). */
  wn?: string;
  am?: number;
  rs?: string;
  rl?: boolean;
}

/**
 * Elite affix code carried in a ZombieSnap so guests can render the matching
 * aura/tell. Host-side affix *gameplay* lives in zombie.ts; the wire only needs
 * a tiny enum. Keep in sync with zombie.ts `Affix` (blazing/glacial/overloading).
 *   0 = none, 1 = blazing, 2 = glacial, 3 = overloading.
 */
export const enum AffixCode {
  None = 0,
  Blazing = 1,
  Glacial = 2,
  Overloading = 3,
}
/** Highest valid AffixCode — guests clamp received values to this range. */
export const AFFIX_CODE_MAX = 3;

export interface ZombieSnap {
  id: number;
  x: number;
  z: number;
  ry: number;
  /** Index into ZOMBIE_TYPES for color/scale. */
  type: number;
  /** 0 = alive, 1 = dying. */
  state: number;
  /** Elite affix code (AffixCode); 0/absent = plain zombie. Optional so old
   *  snapshots (pre-affix hosts) decode as "none" instead of breaking. */
  affix?: number;
}

/** Host → guests, broadcast every network tick. */
export interface SnapMsg {
  t: "snap";
  players: PlayerSnap[];
  zombies: ZombieSnap[];
  round: number;
  points: number;
  phase: string;
}

/** A fired-shot event so guests can render a tracer locally. */
export interface ShotMsg {
  t: "shot";
  x: number;
  z: number;
  dx: number;
  dz: number;
  color: number;
  scale: number;
}

/** Host → a specific guest: a short feedback message (buy confirmations, etc.). */
export interface ToastMsg {
  t: "toast";
  msg: string;
}

/** Guest → host, sent each frame: that player's intent. */
export interface InputMsg {
  t: "input";
  mx: number;
  mz: number;
  /** Aim point on the ground plane. */
  ax: number;
  az: number;
  fire: boolean;
  reload: boolean;
  swap: boolean;
  interact: boolean;
}

/** Island presence — broadcast each tick so peers can render this player. */
export interface PresenceMsg {
  t: "presence";
  x: number;
  z: number;
  ry: number; // facing (yaw)
  moving: boolean;
  skin: number; // body color so peers look right
  /** Optional short display name shown above the head. */
  name?: string;
  /** Head color (cosmetic skin) so peers render the right head, not a default. */
  head?: number;
  /** True while this player has the emote wheel / quick-chat menu open (shows a
   *  "…" thinking bubble to peers, like a typing indicator). */
  menuOpen?: boolean;
  /** Mode-portal the player is currently standing in (e.g. "mode_quad"), for the
   *  co-op gather/matchmaking count. Omitted/empty when not in a portal. */
  portal?: string;
  // ---- lobby "flex" cosmetics (all optional; peers render what they get) ----
  /** Equipped pet ids so peers see your squad follow you. */
  pets?: string[];
  /** Earned display title shown under the name (e.g. "Round 50 Survivor"). */
  title?: string;
  /** Prestige (ascension) level — shown as stars on the nameplate. */
  prestige?: number;
  /** Best round reached — shown as a badge on the nameplate. */
  best?: number;
  /** Cosmetic aura tier (0 none .. 3) earned from prestige/best round. */
  aura?: number;
  /** Equipped skin id, so peers render its hat/cape/glow cosmetic kit. */
  skinId?: string;
}

/** Island social — a played emote (wave/dance/sit/cheer). Broadcast once on
 *  selection; peers play the matching VoxelChar emote on the sender's figure. */
export interface EmoteMsg {
  t: "emote";
  /** Emote id (see emotes.ts EMOTES) — e.g. "wave" | "dance" | "sit" | "cheer". */
  id: string;
}

/** Island social — a preset safe-phrase quick-chat. Broadcast once; peers show
 *  it as a speech bubble above the sender's head for a few seconds. NO free text. */
export interface ChatMsg {
  t: "chat";
  /** Preset phrase text (chosen from a fixed list — never user-typed). */
  text: string;
}

/** Co-op gather — the elected leader (lowest id in a full portal) broadcasts the
 *  freshly-hosted room code to the other occupants so they all join together. */
export interface PortalStartMsg {
  t: "portal-start";
  portal: string; // which mode portal this start is for
  code: string; // the co-op room share-code to join
}

/** Island social — broadcast when a player hatches an egg, so everyone in the
 *  lobby sees the celebration (burst + confetti for high grades) over the sender. */
export interface HatchMsg {
  t: "hatch";
  /** Pet id rolled (validated against the real roster on receive). */
  pet: string;
  /** Rarity index 0..6 (common..celestial) — drives the celebration grade. */
  rarity: number;
  /** 1 = shiny pull (extra sparkle). */
  shiny?: number;
}

export type NetMsg = SnapMsg | ShotMsg | InputMsg | ToastMsg | PresenceMsg | EmoteMsg | ChatMsg | HatchMsg | PortalStartMsg;

// ---- transport envelopes (to/from the relay server) ----

interface SrvHosted { t: "hosted"; room: string; id: number; }
interface SrvJoined { t: "joined"; room: string; id: number; host: boolean; }
interface SrvPeerJoin { t: "peer-join"; id: number; }
interface SrvPeerLeave { t: "peer-leave"; id: number; }
interface SrvRelay { t: "relay"; from: number; data: NetMsg; }
interface SrvError { t: "error"; msg: string; }
interface SrvIslandJoined { t: "island-joined"; room: string; id: number; peers: number[]; }
type SrvMsg = SrvHosted | SrvJoined | SrvPeerJoin | SrvPeerLeave | SrvRelay | SrvError | SrvIslandJoined;

export type NetRole = "host" | "guest";

/**
 * Thin wrapper over the WebSocket relay: connect, host/join a room, track
 * peers, and send/receive `NetMsg`s. Higher layers decide what to do with them.
 */
export class NetClient {
  private ws?: WebSocket;
  id = 0;
  role: NetRole = "host";
  room = "";
  readonly peers = new Set<number>();
  connected = false;
  /** True when connected to a shared social island instance (no single host). */
  isIsland = false;

  // callbacks (assigned by the game layer)
  onPeerJoin?: (id: number) => void;
  onPeerLeave?: (id: number) => void;
  onMessage?: (from: number, msg: NetMsg) => void;
  onClose?: (reason: string) => void;

  get isHost(): boolean {
    return this.role === "host";
  }

  /** Open a room as host. Resolves with the share-code others will type. */
  host(): Promise<{ code: string }> {
    return this.open((ws, resolve, reject) => {
      ws.onmessage = (ev) => {
        const m = this.parse(ev.data);
        if (!m) return;
        if (m.t === "hosted") {
          this.id = m.id;
          this.role = "host";
          this.room = m.room;
          this.connected = true;
          this.ws!.onmessage = (e) => this.handle(e);
          resolve({ code: m.room });
        } else if (m.t === "error") {
          reject(new Error(m.msg));
        }
      };
      ws.send(JSON.stringify({ t: "host" }));
    });
  }

  /** Join an existing room by its share-code. */
  join(code: string): Promise<{ id: number }> {
    const room = code.trim().toUpperCase();
    return this.open((ws, resolve, reject) => {
      ws.onmessage = (ev) => {
        const m = this.parse(ev.data);
        if (!m) return;
        if (m.t === "joined") {
          this.id = m.id;
          this.role = "guest";
          this.room = m.room;
          this.connected = true;
          this.ws!.onmessage = (e) => this.handle(e);
          resolve({ id: m.id });
        } else if (m.t === "error") {
          reject(new Error(m.msg));
        }
      };
      ws.send(JSON.stringify({ t: "join", room }));
    });
  }

  /** Join (or auto-open) a shared social island instance. Resolves with my id +
   *  the ids of peers already present, so we can spawn them immediately. */
  island(): Promise<{ id: number; peers: number[] }> {
    return this.open((ws, resolve, reject) => {
      ws.onmessage = (ev) => {
        const m = this.parse(ev.data);
        if (!m) return;
        if (m.t === "island-joined") {
          this.id = m.id;
          this.role = "guest";
          this.room = m.room;
          this.isIsland = true;
          this.connected = true;
          for (const p of m.peers) this.peers.add(p);
          this.ws!.onmessage = (e) => this.handle(e);
          resolve({ id: m.id, peers: m.peers });
        } else if (m.t === "error") {
          reject(new Error(m.msg));
        }
      };
      ws.send(JSON.stringify({ t: "island" }));
    });
  }

  /** Send an app message: to a specific peer, or broadcast to the rest of the room. */
  send(msg: NetMsg, to?: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: "relay", to, data: msg }));
  }

  close() {
    this.connected = false;
    this.ws?.close();
    this.ws = undefined;
  }

  // ---- internals ----
  private open(
    handshake: (ws: WebSocket, resolve: (v: any) => void, reject: (e: Error) => void) => void,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(getServerUrl());
      } catch (e) {
        reject(e as Error);
        return;
      }
      this.ws = ws;
      // Per-attempt timeout; the game layer retries while the dyno cold-starts.
      const to = setTimeout(() => reject(new Error("timed out")), 12000);
      ws.onerror = () => reject(new Error("Could not reach the server"));
      ws.onclose = () => {
        if (this.connected) {
          this.connected = false;
          this.onClose?.("Disconnected");
        }
      };
      ws.onopen = () => {
        clearTimeout(to);
        handshake(ws, resolve as any, reject);
      };
    });
  }

  private parse(data: unknown): SrvMsg | null {
    if (typeof data !== "string") return null;
    try {
      return JSON.parse(data) as SrvMsg;
    } catch {
      return null;
    }
  }

  private handle(ev: MessageEvent) {
    const m = this.parse(ev.data);
    if (!m) return;
    if (m.t !== "relay") console.log("[net] recv", m.t, (m as { id?: number; from?: number }).id ?? "");
    switch (m.t) {
      case "peer-join":
        this.peers.add(m.id);
        this.onPeerJoin?.(m.id);
        break;
      case "peer-leave":
        this.peers.delete(m.id);
        this.onPeerLeave?.(m.id);
        if (m.id === 1 && this.role === "guest" && !this.isIsland) {
          // host left → co-op room is gone (island instances have no host)
          this.connected = false;
          this.onClose?.("Host left");
        }
        break;
      case "relay":
        this.onMessage?.(m.from, m.data);
        break;
      case "error":
        this.onClose?.(m.msg);
        break;
    }
  }
}
