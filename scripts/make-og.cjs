#!/usr/bin/env node
/*
 * Generates public/og.png (1200x630) for Open Graph / Twitter cards using only
 * Node built-ins (zlib) — no image libraries available in this environment.
 * Draws a dark warm gradient background with a centered gold "voxel skull" motif
 * and a teal accent bar, matching the game's UI language. Run: node scripts/make-og.cjs
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const W = 1200, H = 630;
const buf = Buffer.alloc(W * H * 4);

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}
function rect(x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, r, g, b, a);
}

// background: warm dark vertical gradient (top #20160e -> bottom #0d0a07)
for (let y = 0; y < H; y++) {
  const t = y / H;
  const r = Math.round(0x20 * (1 - t) + 0x0d * t);
  const g = Math.round(0x16 * (1 - t) + 0x0a * t);
  const b = Math.round(0x0e * (1 - t) + 0x07 * t);
  for (let x = 0; x < W; x++) set(x, y, r, g, b);
}

// voxel skull built from a small bitmap, drawn with chunky "voxel" cells in gold
const S = [
  "..######..",
  ".########.",
  "##########",
  "##........##".slice(0, 10),
  "##.OO..OO.##".slice(0, 10),
  "##.OO..OO.##".slice(0, 10),
  "##........##".slice(0, 10),
  ".##.####.##".slice(0, 10),
  "..##.##.##".slice(0, 10),
  "..#.#.#.#.",
];
const CELL = 34;
const skullW = 10 * CELL, skullH = S.length * CELL;
const ox = Math.round((W - skullW) / 2);
const oy = Math.round((H - skullH) / 2) - 40;
for (let row = 0; row < S.length; row++) {
  for (let col = 0; col < S[row].length; col++) {
    const c = S[row][col];
    if (c === ".") continue;
    const gx = ox + col * CELL, gy = oy + row * CELL;
    if (c === "O") {
      rect(gx + 2, gy + 2, CELL - 4, CELL - 4, 0x16, 0x0e, 0x08); // eye/socket void
    } else {
      // gold cell with a subtle voxel bevel
      rect(gx, gy, CELL, CELL, 0xc99a2e);
      rect(gx, gy, CELL - 3, CELL - 3, 0xffd24a);
      rect(gx + 4, gy + 4, CELL - 12, CELL - 12, 0xffe9a8);
    }
  }
}

// teal accent bar under the skull
rect(Math.round(W / 2 - 220), oy + skullH + 36, 440, 10, 0x7f, 0xd4, 0xff);

// PNG encode (truecolor + alpha)
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, crc]);
}
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter: none
  buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = path.join(__dirname, "..", "public", "og.png");
fs.writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
