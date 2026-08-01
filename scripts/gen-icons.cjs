// Generates the DEVSnitcher extension icons as PNGs with zero dependencies.
// Design: dark navy rounded square + red alert triangle with a white "!".
// Usage: node scripts/gen-icons.cjs
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

// ---------- minimal PNG encoder ----------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = row + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- drawing (normalized 0..1 space, hard edges + supersampling AA) ----------

const NAVY = [22, 33, 62]; // #16213e
const RED = [255, 59, 59]; // #ff3b3b
const WHITE = [255, 255, 255];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sign(px, py, a, b) {
  return (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
}

function inTriangle(px, py, a, b, c) {
  const d1 = sign(px, py, a, b);
  const d2 = sign(px, py, b, c);
  const d3 = sign(px, py, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function inCircle(px, py, cx, cy, r) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

// Background rounded square
function sampleBg(px, py) {
  const d = sdRoundRect(px, py, 0.5, 0.5, 0.5, 0.5, 0.22);
  return d <= 0 ? NAVY : null;
}

// Upward red alert triangle + white exclamation
function sampleGlyph(px, py) {
  const apex = [0.5, 0.24];
  const bl = [0.3, 0.76];
  const br = [0.7, 0.76];
  if (!inTriangle(px, py, apex, bl, br)) return null;

  // exclamation bar
  const inBar = px >= 0.47 && px <= 0.53 && py >= 0.36 && py <= 0.58;
  if (inBar) return WHITE;

  // exclamation dot
  if (inCircle(px, py, 0.5, 0.665, 0.035)) return WHITE;

  return RED;
}

function sampleColor(px, py) {
  const glyph = sampleGlyph(px, py);
  if (glyph) return [...glyph, 1];
  const bg = sampleBg(px, py);
  if (bg) return [...bg, 1];
  return [0, 0, 0, 0];
}

function drawIcon(size) {
  const SS = 4; // supersample factor
  const rgba = new Uint8Array(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          const [cr, cg, cb, ca] = sampleColor(px, py);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const accA = a / n;
      const idx = (y * size + x) * 4;
      if (accA > 0) {
        rgba[idx] = Math.round(Math.min(255, (r / n) / accA));
        rgba[idx + 1] = Math.round(Math.min(255, (g / n) / accA));
        rgba[idx + 2] = Math.round(Math.min(255, (b / n) / accA));
        rgba[idx + 3] = Math.round(accA * 255);
      } else {
        rgba[idx + 3] = 0;
      }
    }
  }
  return rgba;
}

function verify(png, width, height) {
  const sigOk = png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!sigOk) throw new Error('bad signature');
  let off = 8;
  let idat = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IDAT') {
      const inflated = zlib.inflateSync(data);
      const expected = (width * 4 + 1) * height;
      if (inflated.length !== expected) throw new Error(`IDAT length mismatch: ${inflated.length} != ${expected}`);
      idat = inflated;
    }
    off += 12 + len;
  }
  if (!idat) throw new Error('no IDAT found');
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, size, drawIcon(size));
  verify(png, size, size);
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
