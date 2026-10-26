/* Builds build/icon.ico (Windows app icon) from a small raster logo:
   the lime "F" mark on a dark rounded tile, matching the in-app brand.
   No dependencies — PNG encoding is done here, and the ICO wraps the
   PNG frames directly (supported by Windows Vista and later).

   Run: node build/make-icon.js */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = __dirname;
const SIZES = [256, 128, 64, 48, 32, 16];
const SS = 4; /* supersampling factor */

const BG_TOP = [18, 22, 27];
const BG_BOTTOM = [7, 9, 11];
const LIME = [200, 255, 61];
const EDGE = [200, 255, 61, 0.22];

/* the brand glyph, on the same 32-unit grid the favicon uses */
const GLYPH = [
  [7, 25], [7, 7], [22, 7], [19, 12], [12, 12],
  [12, 15], [18, 15], [15.5, 20], [12, 20], [12, 25]
];

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideTile(x, y, size, pad, radius) {
  const lo = pad, hi = size - pad;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const r = Math.min(radius, (hi - lo) / 2);
  const cx = Math.min(Math.max(x, lo + r), hi - r);
  const cy = Math.min(Math.max(y, lo + r), hi - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function sample(size, x, y) {
  /* returns [r,g,b,a] at a subpixel centre */
  const pad = size * 0.045;
  const radius = size * 0.235;
  const tile = insideTile(x, y, size, pad, radius);
  if (!tile) return [0, 0, 0, 0];

  const t = (y - pad) / (size - 2 * pad);
  const base = [
    Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
    Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
    Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
  ];

  /* thin brand rim just inside the tile edge */
  if (!insideTile(x, y, size, pad + size * 0.022, radius * 0.94)) {
    return [EDGE[0], EDGE[1], EDGE[2], 255];
  }

  const s = size / 32;
  /* centre the glyph on its own bounding box, not the 32-unit grid */
  const offX = size * 0.5 - ((7 + 22) / 2) * s;
  const offY = size * 0.5 - ((7 + 25) / 2) * s;
  const gx = (x - offX) / s;
  const gy = (y - offY) / s;
  if (inPoly(gx, gy, GLYPH)) return [LIME[0], LIME[1], LIME[2], 255];

  return [base[0], base[1], base[2], 255];
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(size, x + (sx + 0.5) * step, y + (sy + 0.5) * step);
          const w = c[3] / 255;
          r += c[0] * w; g += c[1] * w; b += c[2] * w; a += w;
        }
      }
      const n = SS * SS;
      const at = (y * size + x) * 4;
      const alpha = a / n;
      px[at] = alpha ? Math.round(r / a) : 0;
      px[at + 1] = alpha ? Math.round(g / a) : 0;
      px[at + 2] = alpha ? Math.round(b / a) : 0;
      px[at + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

/* ── minimal PNG writer ───────────────────────────────────────────────── */

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}

function crc32(buf) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function toPng(size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; /* filter: none */
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  /* bit depth */
  ihdr[9] = 6;  /* RGBA */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function toIco(frames) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = head.length + dir.length;
  frames.forEach(function (frame, i) {
    const at = i * 16;
    dir[at] = frame.size >= 256 ? 0 : frame.size;
    dir[at + 1] = frame.size >= 256 ? 0 : frame.size;
    dir[at + 2] = 0;
    dir[at + 3] = 0;
    dir.writeUInt16LE(1, at + 4);   /* planes */
    dir.writeUInt16LE(32, at + 6);  /* bits per pixel */
    dir.writeUInt32LE(frame.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += frame.png.length;
  });
  return Buffer.concat([head, dir].concat(frames.map(function (f) { return f.png; })));
}

/* ── write ────────────────────────────────────────────────────────────── */

const frames = SIZES.map(function (size) {
  const png = toPng(size, render(size));
  return { size: size, png: png };
});

fs.writeFileSync(path.join(OUT_DIR, "icon.ico"), toIco(frames));
fs.writeFileSync(path.join(OUT_DIR, "icon.png"), toPng(256, render(256)));

console.log("icon.ico written (" + frames.map(function (f) { return f.size; }).join(", ") + ")");
