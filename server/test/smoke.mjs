/**
 * smoke.mjs — headless validation for the relay/rooms server.
 *
 * Plain Node, no test framework. It:
 *   1. Spawns the built server (dist/index.js) on a random free port.
 *   2. Opens 3 WebSocket clients: A hosts, B and C join with the returned code.
 *   3. Verifies A receives two peer-join events and B/C receive `joined`.
 *   4. A broadcasts a relay; verifies B and C receive it with from:1.
 *   5. Disconnects B; verifies A and C receive peer-leave for B.
 *
 * Prints PASS/FAIL per check and exits non-zero on any failure.
 *
 * Requires `npm run build` to have produced dist/index.js, and the `ws`
 * dependency to be installed (it is, as a server dependency).
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, '..', 'dist', 'index.js');

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failures++;
}

/** Find a free TCP port. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** A small WebSocket client wrapper that queues parsed messages. */
class Client {
  constructor(url, name) {
    this.name = name;
    this.messages = [];
    this.waiters = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.messages.push(msg);
      this._drain();
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  _drain() {
    // Resolve any waiter whose predicate now matches a queued message.
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      const idx = this.messages.findIndex(w.pred);
      if (idx !== -1) {
        const [m] = this.messages.splice(idx, 1);
        this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(m);
      }
    }
  }

  /** Wait for a message matching `pred`, or reject after `timeout` ms. */
  waitFor(pred, timeout = 2000, label = 'message') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new Error(`${this.name}: timed out waiting for ${label}`));
      }, timeout);
      this.waiters.push({ pred, resolve, reject, timer });
      this._drain();
    });
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const port = await getFreePort();
  const url = `ws://127.0.0.1:${port}`;

  // Spawn the server with the chosen PORT.
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  // Wait until the server announces it is listening.
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start in time')), 5000);
    child.stdout.on('data', (d) => {
      if (d.toString().includes('listening')) {
        clearTimeout(to);
        resolve();
      }
    });
    child.on('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
  });

  let exitCode = 0;
  try {
    // --- 1. A hosts ---
    const a = new Client(url, 'A');
    await a.ready;
    a.send({ t: 'host' });
    const hosted = await a.waitFor((m) => m.t === 'hosted', 2000, 'hosted');
    check('A receives hosted with id 1', hosted.id === 1);
    check('hosted includes a 4-char room code', typeof hosted.room === 'string' && hosted.room.length === 4);
    const code = hosted.room;

    // --- 2. B and C join ---
    const b = new Client(url, 'B');
    const c = new Client(url, 'C');
    await Promise.all([b.ready, c.ready]);

    b.send({ t: 'join', room: code });
    const bJoined = await b.waitFor((m) => m.t === 'joined', 2000, 'B joined');
    check('B receives joined with host:false', bJoined.t === 'joined' && bJoined.host === false);
    check('B joined room matches code', bJoined.room === code);
    const bId = bJoined.id;

    // A should see a peer-join for B.
    const aPeerJoinB = await a.waitFor((m) => m.t === 'peer-join' && m.id === bId, 2000, 'A peer-join B');
    check('A receives peer-join for B', aPeerJoinB.id === bId);

    c.send({ t: 'join', room: code });
    const cJoined = await c.waitFor((m) => m.t === 'joined', 2000, 'C joined');
    check('C receives joined with host:false', cJoined.t === 'joined' && cJoined.host === false);
    const cId = cJoined.id;

    // A should see a peer-join for C (so A has now seen two peer-joins total).
    const aPeerJoinC = await a.waitFor((m) => m.t === 'peer-join' && m.id === cId, 2000, 'A peer-join C');
    check('A receives peer-join for C (two peer-joins total)', aPeerJoinC.id === cId);

    // B should also have seen a peer-join for C.
    const bPeerJoinC = await b.waitFor((m) => m.t === 'peer-join' && m.id === cId, 2000, 'B peer-join C');
    check('B receives peer-join for C', bPeerJoinC.id === cId);

    // --- 3. A broadcasts a relay ---
    const payload = { hello: 'world', n: 42 };
    a.send({ t: 'relay', data: payload });

    const bRelay = await b.waitFor((m) => m.t === 'relay', 2000, 'B relay');
    check('B receives relay from:1 with data', bRelay.from === 1 && bRelay.data && bRelay.data.n === 42);

    const cRelay = await c.waitFor((m) => m.t === 'relay', 2000, 'C relay');
    check('C receives relay from:1 with data', cRelay.from === 1 && cRelay.data && cRelay.data.n === 42);

    // --- 4. Disconnect B; A and C get peer-leave for B ---
    b.close();

    const aLeaveB = await a.waitFor((m) => m.t === 'peer-leave' && m.id === bId, 2000, 'A peer-leave B');
    check('A receives peer-leave for B', aLeaveB.id === bId);

    const cLeaveB = await c.waitFor((m) => m.t === 'peer-leave' && m.id === bId, 2000, 'C peer-leave B');
    check('C receives peer-leave for B', cLeaveB.id === bId);

    a.close();
    c.close();
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    failures++;
  } finally {
    child.kill('SIGTERM');
    exitCode = failures > 0 ? 1 : 0;
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  // Give the kill a moment, then exit.
  setTimeout(() => process.exit(exitCode), 200);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
