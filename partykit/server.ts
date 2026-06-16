import type * as Party from "partykit/server";

/**
 * PartyKit relay for Tiny Dead co-op.
 *
 * Speaks the SAME wire protocol as the original Node `ws` relay (server/), so
 * the game client connects unchanged. Every player connects to one shared
 * PartyKit room ("tinydead"); this single always-on instance multiplexes many
 * game rooms in memory by a 4-letter share code. Nothing is persisted — rooms
 * are ephemeral and vanish when their players leave (no storage used).
 *
 * Deploy: `cd partykit && npx partykit@latest deploy`
 * URL:    wss://tiny-dead.<your-username>.partykit.dev
 */

// Shared protocol constants — keep these in lockstep with server/src/rooms.ts.
const HOST_ID = 1;
/** Capacity of a co-op run room (host + up to 3 guests). */
const MAX_MEMBERS = 4;
/** Capacity of a social island instance (Roblox-style shared lobby). */
const ISLAND_CAP = 24;
/** Fixed code prefix for island instances; numbered instances spill over. */
const ISLAND_PREFIX = "ISLE";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

interface Member {
  id: number;
  conn: Party.Connection;
}
interface Room {
  code: string;
  members: Map<number, Member>;
  nextId: number;
  /** Member capacity (co-op runs are small; island instances are larger). */
  cap: number;
  /** True for social island instances (no single authoritative host). */
  isIsland: boolean;
}

function send(conn: Party.Connection, msg: unknown): void {
  try {
    conn.send(JSON.stringify(msg));
  } catch {
    /* socket already gone */
  }
}

export default class Relay implements Party.Server {
  // Stay resident (no hibernation) so these in-memory maps live as long as the
  // connections do. We store nothing to disk.
  static options = { hibernate: false };

  private rooms = new Map<string, Room>();
  /** connection.id -> where that socket lives, for O(1) cleanup on disconnect */
  private where = new Map<string, { code: string; id: number }>();

  constructor(readonly room: Party.Room) {}

  /** Health check for the client's warm-up ping. */
  onRequest(_req: Party.Request): Response {
    return new Response("ok");
  }

  onMessage(raw: string | ArrayBuffer, sender: Party.Connection): void {
    if (typeof raw !== "string") return;
    let msg: { t?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // never crash on bad input
    }
    if (!msg || typeof msg.t !== "string") return;
    switch (msg.t) {
      case "host":
        return this.onHost(sender);
      case "join":
        return this.onJoin(sender, msg);
      case "island":
        return this.onIsland(sender);
      case "relay":
        return this.onRelay(sender, msg);
    }
  }

  onClose(conn: Party.Connection): void {
    this.cleanup(conn);
  }
  onError(conn: Party.Connection): void {
    this.cleanup(conn);
  }

  // ---- protocol ----
  private onHost(sender: Party.Connection): void {
    if (this.where.has(sender.id)) return send(sender, { t: "error", msg: "already in a room" });
    const code = this.freshCode();
    const room: Room = { code, members: new Map(), nextId: HOST_ID + 1, cap: MAX_MEMBERS, isIsland: false };
    room.members.set(HOST_ID, { id: HOST_ID, conn: sender });
    this.rooms.set(code, room);
    this.where.set(sender.id, { code, id: HOST_ID });
    send(sender, { t: "hosted", room: code, id: HOST_ID });
  }

  private onJoin(sender: Party.Connection, msg: { [k: string]: unknown }): void {
    if (this.where.has(sender.id)) return send(sender, { t: "error", msg: "already in a room" });
    const code = String(msg.room ?? "").trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return send(sender, { t: "error", msg: "room not found" });
    if (room.members.size >= room.cap) return send(sender, { t: "error", msg: "room is full" });

    const id = room.nextId++;
    room.members.set(id, { id, conn: sender });
    this.where.set(sender.id, { code, id });
    send(sender, { t: "joined", room: code, id, host: false });
    for (const m of room.members.values()) {
      if (m.id !== id) send(m.conn, { t: "peer-join", id });
    }
  }

  /**
   * Handle `{ t: "island" }` — join (or auto-open) a shared social island
   * instance. Mirrors server/src/index.ts onIsland + rooms.ts joinIsland:
   * instances fill in order, and once one reaches ISLAND_CAP a new numbered
   * instance opens so strangers always land somewhere with room. The joiner is
   * told the instance code, its id, and who's already present (peers) so it can
   * spawn existing peers immediately — not just future joiners.
   */
  private onIsland(sender: Party.Connection): void {
    if (this.where.has(sender.id)) return send(sender, { t: "error", msg: "already in a room" });

    // find an existing island instance with space
    let room: Room | undefined;
    for (const r of this.rooms.values()) {
      if (r.isIsland && r.members.size < r.cap) {
        room = r;
        break;
      }
    }
    if (!room) {
      // none with space: open the next numbered instance
      let n = 1;
      while (this.rooms.has(`${ISLAND_PREFIX}${n}`)) n++;
      const code = `${ISLAND_PREFIX}${n}`;
      room = { code, members: new Map(), nextId: HOST_ID + 1, cap: ISLAND_CAP, isIsland: true };
      this.rooms.set(code, room);
    }

    const id = room.nextId++;
    room.members.set(id, { id, conn: sender });
    this.where.set(sender.id, { code: room.code, id });
    const peers = [...room.members.values()].filter((m) => m.id !== id).map((m) => m.id);
    send(sender, { t: "island-joined", room: room.code, id, peers });
    for (const m of room.members.values()) {
      if (m.id !== id) send(m.conn, { t: "peer-join", id });
    }
  }

  private onRelay(sender: Party.Connection, msg: { [k: string]: unknown }): void {
    const loc = this.where.get(sender.id);
    if (!loc) return send(sender, { t: "error", msg: "not in a room" });
    const room = this.rooms.get(loc.code);
    if (!room) return;

    const payload = { t: "relay", from: loc.id, data: msg.data };
    if (typeof msg.to === "number") {
      const target = room.members.get(msg.to);
      if (target && target.id !== loc.id) send(target.conn, payload);
      return;
    }
    for (const m of room.members.values()) {
      if (m.id !== loc.id) send(m.conn, payload);
    }
  }

  // ---- disconnect handling (host leaving tears the room down) ----
  private cleanup(conn: Party.Connection): void {
    const loc = this.where.get(conn.id);
    if (!loc) return;
    this.where.delete(conn.id);
    const room = this.rooms.get(loc.code);
    if (!room) return;
    room.members.delete(loc.id);

    // Co-op host left → tear the room down (host is authoritative). ISLANDS are
    // hostless (first joiner just gets id 1), so we must NOT nuke the instance —
    // fall through to the normal member-left notify.
    if (loc.id === HOST_ID && !room.isIsland) {
      for (const m of room.members.values()) {
        send(m.conn, { t: "peer-leave", id: HOST_ID });
        send(m.conn, { t: "error", msg: "host left" });
        this.where.delete(m.conn.id);
        try {
          m.conn.close();
        } catch {
          /* ignore */
        }
      }
      this.rooms.delete(loc.code);
      return;
    }

    for (const m of room.members.values()) send(m.conn, { t: "peer-leave", id: loc.id });
    if (room.members.size === 0) this.rooms.delete(loc.code);
  }

  private freshCode(): string {
    for (let tries = 0; tries < 50; tries++) {
      let c = "";
      for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    return "R" + Math.floor(Math.random() * 10000);
  }
}
