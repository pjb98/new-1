/**
 * index.ts — Transport layer for the tiny WebSocket relay/rooms server.
 *
 * Responsibilities:
 *  - Serve a plain HTTP `GET /health` endpoint so hosting platforms' health
 *    checks pass, and attach the WebSocket server to the same http.Server.
 *  - Parse the JSON wire protocol and translate it into RoomManager calls.
 *  - Forward opaque application payloads between peers in the same room.
 *  - Maintain a ping/pong heartbeat and clean up on disconnect.
 *
 * The server is a thin relay: it never inspects or interprets `relay` payloads.
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager, HOST_ID, type Member, type Room } from './rooms.js';

const PORT = Number(process.env.PORT) || 8080;
const HEARTBEAT_INTERVAL_MS = 30_000;

const rooms = new RoomManager();

/**
 * Per-socket bookkeeping. We stash the member's identity on the socket so we
 * can clean up correctly when it closes, without scanning every room.
 */
interface SocketState {
  room?: Room;
  member?: Member;
}
const state = new WeakMap<WebSocket, SocketState>();

// ---------------------------------------------------------------------------
// HTTP server (health check) + WebSocket upgrade on the same port.
// ---------------------------------------------------------------------------

const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok conns=' + wss.clients.size);
    return;
  }
  // Anything else over plain HTTP gets a minimal 404; real traffic is WS.
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

// maxPayload caps frame size (64 KB) so a client can't send a huge frame and
// OOM the server via JSON.parse. Game messages are tiny; 64 KB is generous.
const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });

// Hard ceiling on concurrent sockets — refuse new connections past this so a
// flood can't exhaust memory/file descriptors.
const MAX_CONNECTIONS = 5000;

// ---------------------------------------------------------------------------
// Message helpers.
// ---------------------------------------------------------------------------

/** Safely send a JSON object to a socket if it is open. */
function send(socket: WebSocket, msg: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

/** Send an error message to a socket. */
function sendError(socket: WebSocket, message: string): void {
  send(socket, { t: 'error', msg: message });
}

// ---------------------------------------------------------------------------
// Connection handling.
// ---------------------------------------------------------------------------

wss.on('connection', (socket: WebSocket) => {
  // Refuse connections beyond the ceiling (flood / FD exhaustion guard).
  if (wss.clients.size > MAX_CONNECTIONS) {
    try {
      socket.close(1013, 'server full');
    } catch {
      /* ignore */
    }
    return;
  }
  state.set(socket, {});

  // Heartbeat: a pong marks the socket alive again. The interval below sweeps
  // every HEARTBEAT_INTERVAL_MS and terminates anything that didn't respond.
  (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
  socket.on('pong', () => {
    (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
  });

  // Per-socket token-bucket rate limiter: refill ~40 msg/s, burst 80. Beyond
  // that, drop messages (and disconnect a sustained flooder) so one client
  // can't relay-flood the room.
  const rate = { tokens: 80, last: Date.now() };

  socket.on('message', (raw) => {
    // refill tokens
    const now = Date.now();
    rate.tokens = Math.min(80, rate.tokens + ((now - rate.last) / 1000) * 40);
    rate.last = now;
    if (rate.tokens < 1) {
      // sustained flood — terminate
      try {
        socket.close(1008, 'rate limit');
      } catch {
        /* ignore */
      }
      return;
    }
    rate.tokens -= 1;

    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      // Malformed JSON: ignore silently. Never crash on bad input.
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof (msg as { t?: unknown }).t !== 'string') {
      return;
    }
    handleMessage(socket, msg as { t: string; [k: string]: unknown });
  });

  socket.on('close', () => handleDisconnect(socket));

  // 'error' fires for transport issues; treat like a close to ensure cleanup.
  socket.on('error', () => {
    try {
      socket.terminate();
    } catch {
      /* ignore */
    }
  });
});

/** Route a parsed, well-formed protocol message. */
function handleMessage(socket: WebSocket, msg: { t: string; [k: string]: unknown }): void {
  switch (msg.t) {
    case 'host':
      return onHost(socket);
    case 'join':
      return onJoin(socket, msg);
    case 'island':
      return onIsland(socket);
    case 'relay':
      return onRelay(socket, msg);
    default:
      // Unknown type: ignore. The relay does not need to understand game logic.
      return;
  }
}

/** Handle `{ t: 'host' }` — create a room and reply with code + id. */
function onHost(socket: WebSocket): void {
  const s = state.get(socket);
  if (!s) return;
  if (s.room) {
    // A socket may only belong to one room at a time.
    sendError(socket, 'already in a room');
    return;
  }
  const { room, member } = rooms.createRoom(socket);
  s.room = room;
  s.member = member;
  send(socket, { t: 'hosted', room: room.code, id: member.id });
}

/** Handle `{ t: 'join', room }` — join an existing room. */
function onJoin(socket: WebSocket, msg: { [k: string]: unknown }): void {
  const s = state.get(socket);
  if (!s) return;
  if (s.room) {
    sendError(socket, 'already in a room');
    return;
  }
  const code = typeof msg.room === 'string' ? msg.room : '';
  if (!code) {
    sendError(socket, 'missing room code');
    return;
  }

  const result = rooms.joinRoom(code, socket);
  if (!result.ok) {
    sendError(socket, result.reason === 'full' ? 'room is full' : 'room not found');
    return;
  }

  const { room, member } = result;
  s.room = room;
  s.member = member;

  // Reply to the joiner.
  send(socket, { t: 'joined', room: room.code, id: member.id, host: false });

  // Notify every existing member (everyone except the joiner) of the new peer.
  for (const other of rooms.others(room, member.id)) {
    send(other.socket, { t: 'peer-join', id: member.id });
  }
}

/** Handle `{ t: 'island' }` — join (or open) a shared social island instance. */
function onIsland(socket: WebSocket): void {
  const s = state.get(socket);
  if (!s) return;
  if (s.room) {
    sendError(socket, 'already in a room');
    return;
  }
  const { room, member } = rooms.joinIsland(socket);
  s.room = room;
  s.member = member;
  // Reply with the instance code + the joiner's id + who's already here, so the
  // client can spawn existing peers immediately (not just future joiners).
  const peers = rooms.others(room, member.id).map((m) => m.id);
  send(socket, { t: 'island-joined', room: room.code, id: member.id, peers });
  for (const other of rooms.others(room, member.id)) {
    send(other.socket, { t: 'peer-join', id: member.id });
  }
}

/**
 * Handle `{ t: 'relay', to?, data }` — forward `data` to peers.
 * If `to` is present, send only to that peer; otherwise broadcast to all other
 * members of the room. Payload is opaque and never inspected.
 */
function onRelay(socket: WebSocket, msg: { [k: string]: unknown }): void {
  const s = state.get(socket);
  if (!s || !s.room || !s.member) {
    sendError(socket, 'not in a room');
    return;
  }
  const room = s.room;
  const fromId = s.member.id;
  const payload = { t: 'relay', from: fromId, data: msg.data };

  if (typeof msg.to === 'number') {
    const target = room.members.get(msg.to);
    // Don't echo back to the sender even if it targets itself.
    if (target && target.id !== fromId) {
      send(target.socket, payload);
    }
    return;
  }

  // Broadcast to all other members.
  for (const other of rooms.others(room, fromId)) {
    send(other.socket, payload);
  }
}

/**
 * Handle a socket closing. Cleans up room membership and notifies peers.
 *
 * Host-leaves policy: when the host (id 1) disconnects the room can no longer
 * function (the host is authoritative), so we CLOSE the entire room. Each
 * remaining guest is told `peer-leave` for id 1 followed by an `error`
 * ("host left"), then its socket is closed. This is simpler and safer than
 * trying to migrate authority to a guest, and matches the game's host-
 * authoritative model.
 */
function handleDisconnect(socket: WebSocket): void {
  const s = state.get(socket);
  state.delete(socket);
  if (!s || !s.room || !s.member) return;

  const room = s.room;
  const leavingId = s.member.id;

  if (leavingId === HOST_ID && !room.isIsland) {
    // Co-op host left → tear the room down (host is authoritative). ISLANDS are
    // hostless: the first joiner just happens to get id 1, so we must NOT nuke
    // the instance when they leave — fall through to the normal member-left path.
    const remaining = rooms.others(room, HOST_ID);
    rooms.deleteRoom(room);
    for (const guest of remaining) {
      send(guest.socket, { t: 'peer-leave', id: HOST_ID });
      send(guest.socket, { t: 'error', msg: 'host left' });
      // Clear their state so a later close is a no-op, then close the socket.
      const gs = state.get(guest.socket);
      if (gs) {
        gs.room = undefined;
        gs.member = undefined;
      }
      try {
        guest.socket.close(1000, 'host left');
      } catch {
        /* ignore */
      }
    }
    return;
  }

  // A member left (a co-op guest, OR anyone in a hostless island incl. id 1) →
  // notify remaining members; RoomManager deletes the room once it's empty.
  const remaining = rooms.removeMember(room, leavingId);
  for (const other of remaining) {
    send(other.socket, { t: 'peer-leave', id: leavingId });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat sweep: ping everyone; terminate sockets that missed the last pong.
// ---------------------------------------------------------------------------

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    const s = socket as WebSocket & { isAlive?: boolean };
    if (s.isAlive === false) {
      // Missed the previous round-trip; consider it dead. terminate() triggers
      // 'close', which runs the normal cleanup/notification path.
      socket.terminate();
      continue;
    }
    s.isAlive = false;
    try {
      socket.ping();
    } catch {
      /* ignore */
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// Don't let the heartbeat timer keep the process alive on its own.
heartbeat.unref?.();

wss.on('close', () => clearInterval(heartbeat));

// ---------------------------------------------------------------------------
// Start listening.
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`tiny-dead-server listening on :${PORT} (ws + GET /health)`);
});

// Graceful shutdown on common signals.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(heartbeat);
    wss.close();
    httpServer.close(() => process.exit(0));
  });
}
