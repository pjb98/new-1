# tiny-dead-server

A small, production-deployable **WebSocket relay / rooms server** for an online
co-op browser game. It is a *thin relay + room manager*: it does **not**
understand game logic. One client per room is the **host** (authoritative);
the others are **guests**. The server assigns ids, manages room membership by a
4-character share code, and forwards opaque application messages between peers
in the same room.

- Node.js 20, TypeScript, the [`ws`](https://github.com/websockets/ws) library, ES modules.
- Single dependency: `ws`. Builds with `tsc` to `dist/`.
- Listens on `process.env.PORT || 8080` and answers plain HTTP `GET /health`
  with `200 ok` (so hosting platforms' health checks pass). The WebSocket
  server is attached to the same `http.Server`, so WS and health share a port.

## Wire protocol

All messages are JSON text objects with a `t` (type) field.

### Client → Server

| Message | Meaning |
| --- | --- |
| `{ "t": "host" }` | Create a new room. Reply: `{ "t": "hosted", "room": "ABCD", "id": 1 }`. The host is always id `1`. |
| `{ "t": "join", "room": "ABCD" }` | Join an existing room (codes are case-insensitive). |
| `{ "t": "relay", "to": <id?>, "data": <any> }` | Forward `data` to peers. With `to`, only that peer; otherwise broadcast to all other members. |

### Server → Client

| Message | Meaning |
| --- | --- |
| `{ "t": "hosted", "room": "ABCD", "id": 1 }` | Reply to `host`. |
| `{ "t": "joined", "room": "ABCD", "id": <n>, "host": false }` | Reply to a successful `join`. |
| `{ "t": "peer-join", "id": <n> }` | A new member joined (sent to existing members). |
| `{ "t": "peer-leave", "id": <n> }` | A member disconnected (sent to remaining members). |
| `{ "t": "relay", "from": <senderId>, "data": <any> }` | A forwarded payload. |
| `{ "t": "error", "msg": "..." }` | An error (room not found, room full, host left, …). |

### Rules / behavior

- **Room codes**: 4 uppercase letters/digits from an unambiguous alphabet
  (no `0/O`, `1/I`), unique across live rooms. Incoming codes are uppercased so
  joins are case-insensitive.
- **Member ids**: incrementing per room starting at `1` (host = `1`). Unique
  within a room; never reused within a room; reused freely across rooms.
- **Capacity**: max **4** members per room. Further joins get
  `{ "t": "error", "msg": "room is full" }`.
- **Host disconnect**: because the host is authoritative the room cannot
  continue without it. Each remaining guest receives `{ "t": "peer-leave",
  "id": 1 }` then `{ "t": "error", "msg": "host left" }`, and the room is closed
  (sockets are closed, room deleted). See the comment on `handleDisconnect` in
  `src/index.ts`.
- **Empty rooms** are cleaned up automatically.
- **Robustness**: malformed JSON and unknown message types are ignored; the
  server never crashes on bad input.
- **Heartbeat**: every 30s the server pings all clients and terminates any that
  failed to pong since the previous sweep (ws ping/pong).

## Run locally

```bash
cd server
npm install
npm run dev      # = npm run build && npm run start
```

The server prints `tiny-dead-server listening on :8080 (ws + GET /health)`.
Health check: `curl localhost:8080/health` → `ok`.

### Smoke test

```bash
cd server
npm install
npm run build
node test/smoke.mjs
```

It spawns the built server on a random port, runs 3 clients through the
host/join/relay/leave flow, prints `PASS`/`FAIL` per check, and exits non-zero
on any failure.

## Deploy

The client must be pointed at the deployed **`wss://`** URL (secure WebSocket),
e.g. `wss://your-app.onrender.com`. All these platforms terminate TLS for you
and inject `PORT` automatically — the server already reads `process.env.PORT`.

### Render.com (blueprint included)

A [`render.yaml`](./render.yaml) blueprint is provided. In the Render
dashboard: **New → Blueprint**, point it at this repo. It uses
`rootDir: server`, `buildCommand: npm install && npm run build`,
`startCommand: node dist/index.js`, and `healthCheckPath: /health`.

### Fly.io

```bash
cd server
fly launch --no-deploy        # generates fly.toml; uses the Dockerfile here
fly deploy
```

The included `Dockerfile` (`node:20-alpine`) builds and runs the server. Set the
internal port to `8080` in `fly.toml` (`[http_service] internal_port = 8080`),
and Fly provides `wss://` automatically on the `.fly.dev` host.

### Railway

Create a new project from this repo, set the **root directory** to `server`.
Railway autodetects Node (or uses the `Dockerfile`), runs `npm run build`, then
`npm run start`. It injects `PORT` and serves over `wss://` on the generated
domain.
