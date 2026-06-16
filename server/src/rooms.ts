/**
 * rooms.ts — Room and membership management.
 *
 * This module is intentionally free of any WebSocket wire-format / protocol
 * concerns. It only models rooms, members and the rules around them (codes,
 * ids, capacity). The transport layer (index.ts) owns the actual sockets and
 * translates between rooms state and JSON messages.
 */

import type { WebSocket } from 'ws';

/** Maximum number of members allowed in a co-op run room (host + up to 3 guests). */
export const MAX_MEMBERS = 4;

/** Capacity of a social island instance (Roblox-style shared lobby). */
export const ISLAND_CAP = 24;

/** Fixed code prefix for island instances; numbered instances spill over. */
export const ISLAND_PREFIX = 'ISLE';

/** The host is always assigned this id within a room. */
export const HOST_ID = 1;

/**
 * Characters used to build share codes. Deliberately omits visually ambiguous
 * glyphs (0/O, 1/I) so codes read aloud or typed by hand are unambiguous.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

/** A single connected participant in a room. */
export interface Member {
  /** Unique id within the room. Host is always {@link HOST_ID} (1). */
  id: number;
  /** The underlying socket. The transport layer attaches/uses this. */
  socket: WebSocket;
  /** Liveness flag toggled by the ping/pong heartbeat. */
  isAlive: boolean;
}

/** A game room identified by a short share code. */
export interface Room {
  /** 4-character uppercase share code, unique across live rooms. */
  code: string;
  /** Members keyed by id. */
  members: Map<number, Member>;
  /** Monotonic id counter; ids are assigned and never reused within a room. */
  nextId: number;
  /** Member capacity (co-op runs are small; island instances are larger). */
  cap: number;
  /** True for social island instances (no single authoritative host). */
  isIsland: boolean;
}

/**
 * Owns all live rooms and the operations over them. One instance per server.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();

  /** Generate a unique, unambiguous share code not currently in use. */
  private generateCode(): string {
    // In the extremely unlikely event of repeated collisions we just keep
    // trying; the keyspace (32^4 = ~1M) is far larger than plausible concurrent
    // room counts for this game.
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  /**
   * Create a new room with the given socket as the host (id 1).
   * Returns the created room and the host member.
   */
  createRoom(socket: WebSocket): { room: Room; member: Member } {
    const code = this.generateCode();
    const host: Member = { id: HOST_ID, socket, isAlive: true };
    const room: Room = {
      code,
      members: new Map([[HOST_ID, host]]),
      nextId: HOST_ID + 1,
      cap: MAX_MEMBERS,
      isIsland: false,
    };
    this.rooms.set(code, room);
    return { room, member: host };
  }

  /**
   * Join (or auto-create) a social island instance. Instances are filled in
   * order; once one reaches {@link ISLAND_CAP} a new numbered instance opens, so
   * strangers always land somewhere with room — Roblox-style server hopping.
   */
  joinIsland(socket: WebSocket): { room: Room; member: Member } {
    // find an existing island instance with space
    for (const room of this.rooms.values()) {
      if (room.isIsland && room.members.size < room.cap) {
        const member: Member = { id: room.nextId++, socket, isAlive: true };
        room.members.set(member.id, member);
        return { room, member };
      }
    }
    // none with space: open the next numbered instance
    let n = 1;
    while (this.rooms.has(`${ISLAND_PREFIX}${n}`)) n++;
    const code = `${ISLAND_PREFIX}${n}`;
    const member: Member = { id: HOST_ID, socket, isAlive: true };
    const room: Room = {
      code,
      members: new Map([[HOST_ID, member]]),
      nextId: HOST_ID + 1,
      cap: ISLAND_CAP,
      isIsland: true,
    };
    this.rooms.set(code, room);
    return { room, member };
  }

  /** Look up a room by code. Codes are normalized to uppercase. */
  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /**
   * Add a new guest member to an existing room.
   *
   * Returns either the new member (and its room) or an error reason:
   * - 'not-found' if no room has that code
   * - 'full' if the room already holds {@link MAX_MEMBERS} members
   */
  joinRoom(
    code: string,
    socket: WebSocket,
  ): { ok: true; room: Room; member: Member } | { ok: false; reason: 'not-found' | 'full' } {
    const room = this.getRoom(code);
    if (!room) return { ok: false, reason: 'not-found' };
    if (room.members.size >= room.cap) return { ok: false, reason: 'full' };

    const member: Member = { id: room.nextId++, socket, isAlive: true };
    room.members.set(member.id, member);
    return { ok: true, room, member };
  }

  /**
   * Remove a member from a room. If the room becomes empty it is deleted.
   * Returns the list of remaining members (so the caller can notify them).
   */
  removeMember(room: Room, memberId: number): Member[] {
    room.members.delete(memberId);
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return [];
    }
    return [...room.members.values()];
  }

  /** Delete a room entirely (used when the host leaves and the room closes). */
  deleteRoom(room: Room): void {
    this.rooms.delete(room.code);
  }

  /** All members of a room except the one with the given id. */
  others(room: Room, exceptId: number): Member[] {
    return [...room.members.values()].filter((m) => m.id !== exceptId);
  }

  /** Number of live rooms (used for diagnostics/health). */
  get roomCount(): number {
    return this.rooms.size;
  }
}
