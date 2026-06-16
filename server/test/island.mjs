/**
 * island.mjs — headless validation for the social island-instance path.
 *
 * Verifies: two clients sending { t: 'island' } land in the SAME instance,
 * each learns of the other (via island-joined.peers and/or peer-join), and a
 * presence relay broadcast reaches the other peer. Plain Node, no framework.
 *
 * Requires `npm run build` (dist/index.js) and the `ws` dependency.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, '..', 'dist', 'index.js');

let failures = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (!ok) failures++; };

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

class Client {
  constructor(url, name) {
    this.name = name; this.messages = []; this.waiters = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (raw) => { try { this.messages.push(JSON.parse(raw.toString())); this._drain(); } catch {} });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  _drain() {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      const idx = this.messages.findIndex(w.pred);
      if (idx !== -1) { const [m] = this.messages.splice(idx, 1); this.waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(m); }
    }
  }
  waitFor(pred, timeout = 2000, label = 'message') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new Error(`${this.name}: timed out waiting for ${label}`));
      }, timeout);
      this.waiters.push({ pred, resolve, timer });
      this._drain();
    });
  }
  close() { this.ws.close(); }
}

async function main() {
  const port = await getFreePort();
  const url = `ws://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverEntry], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 5000);
    child.stdout.on('data', (d) => { if (d.toString().includes('listening')) { clearTimeout(to); resolve(); } });
    child.on('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
  });

  try {
    const a = new Client(url, 'A');
    await a.ready;
    a.send({ t: 'island' });
    const aJoin = await a.waitFor((m) => m.t === 'island-joined', 2000, 'A island-joined');
    check('A gets island-joined with id', typeof aJoin.id === 'number');
    check('A instance code starts with ISLE', typeof aJoin.room === 'string' && aJoin.room.startsWith('ISLE'));
    check('A peers list is empty (alone)', Array.isArray(aJoin.peers) && aJoin.peers.length === 0);

    const b = new Client(url, 'B');
    await b.ready;
    b.send({ t: 'island' });
    const bJoin = await b.waitFor((m) => m.t === 'island-joined', 2000, 'B island-joined');
    check('B joins the SAME instance as A', bJoin.room === aJoin.room);
    check('B sees A already present in peers', bJoin.peers.includes(aJoin.id));

    const aPeerB = await a.waitFor((m) => m.t === 'peer-join' && m.id === bJoin.id, 2000, 'A peer-join B');
    check('A is notified B joined', aPeerB.id === bJoin.id);

    // B broadcasts a presence pose; A should receive it.
    b.send({ t: 'relay', data: { t: 'presence', x: 3, z: -2, ry: 1.5, moving: true, skin: 0x4a78d6 } });
    const aPres = await a.waitFor((m) => m.t === 'relay' && m.data && m.data.t === 'presence', 2000, 'A presence');
    check('A receives B presence pose', aPres.from === bJoin.id && aPres.data.x === 3 && aPres.data.z === -2);

    a.close(); b.close();
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    failures++;
  } finally {
    child.kill('SIGTERM');
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  setTimeout(() => process.exit(failures > 0 ? 1 : 0), 200);
}
main().catch((err) => { console.error(err); process.exit(1); });
