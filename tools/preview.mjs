// Renders the ASCII sprites in src/spriteData.js to a PNG so the art can be
// inspected without a browser.  Usage: node tools/preview.mjs [outfile]
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const {
  PAL, PLAYER_UPPER, PLAYER_LEGS, ZOMBIE_UPPER, ZOMBIE_UPPER_ATTACK, ZOMBIE_LEGS, GUNS,
} = await import('../src/spriteData.js');

// ---------------------------------------------------------------- png ------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba, scale = 1) {
  const W = w * scale, H = h * scale;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const s = (((y / scale) | 0) * w + ((x / scale) | 0)) * 4;
      raw[p++] = rgba[s]; raw[p++] = rgba[s + 1]; raw[p++] = rgba[s + 2]; raw[p++] = rgba[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

// ------------------------------------------------------------ rasterise ----
function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
}
class Sheet {
  constructor(w, h, bg = [26, 28, 34, 255]) {
    this.w = w; this.h = h;
    this.buf = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) this.buf.set(bg, i * 4);
  }
  px(x, y, rgba) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf.set(rgba, (y * this.w + x) * 4);
  }
  sprite(rows, x, y, scale = 1) {
    for (let r = 0; r < rows.length; r++) {
      const line = rows[r];
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '.' || ch === undefined) continue;
        const col = PAL[ch];
        if (!col) { console.warn('unknown palette char', JSON.stringify(ch)); continue; }
        const rgba = hex(col);
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            this.px(x + c * scale + sx, y + r * scale + sy, rgba);
      }
    }
  }
  rect(x, y, w, h, rgba) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, rgba);
  }
}

// -------------------------------------------------------------- layout -----
const S = 6; // zoom
const CELL_W = 26, CELL_H = 30;
const cols = 8, rowsN = 4;
const sheet = new Sheet(CELL_W * S * cols, CELL_H * S * rowsN, [22, 24, 30, 255]);

// grid
for (let x = 0; x < sheet.w; x += CELL_W * S) sheet.rect(x, 0, 1, sheet.h, [40, 44, 52, 255]);
for (let y = 0; y < sheet.h; y += CELL_H * S) sheet.rect(0, y, sheet.w, 1, [40, 44, 52, 255]);

function put(col, row, spriteRows, scale = S) {
  sheet.sprite(spriteRows, col * CELL_W * S + 3 * S, row * CELL_H * S + 4 * S, scale);
}

// row 0: player walk cycle
for (let i = 0; i < 4; i++) put(i, 0, PLAYER_UPPER.concat(PLAYER_LEGS[i]));
// row 1: zombie walk cycle
for (let i = 0; i < 4; i++) put(i, 1, ZOMBIE_UPPER.concat(ZOMBIE_LEGS[i]));
// row 2: zombie attack + guns
put(0, 2, ZOMBIE_UPPER_ATTACK.concat(ZOMBIE_LEGS[0]));
{
  let c = 2;
  for (const [id, g] of Object.entries(GUNS)) {
    sheet.sprite(g.rows, c * CELL_W * S + 3 * S, 2 * CELL_H * S + 10 * S, S);
    // mark pivot + muzzle
    sheet.rect(c * CELL_W * S + 3 * S + g.pivot[0] * S, 2 * CELL_H * S + 10 * S + g.pivot[1] * S, S, S, [255, 60, 60, 255]);
    sheet.rect(c * CELL_W * S + 3 * S + g.muzzle[0] * S, 2 * CELL_H * S + 10 * S + g.muzzle[1] * S, S, S, [255, 220, 60, 255]);
    c++;
  }
}
// row 3: full figures side by side at 1x for silhouette check
for (let i = 0; i < 4; i++) put(i, 3, ZOMBIE_UPPER.concat(ZOMBIE_LEGS[i]));
for (let i = 0; i < 4; i++) put(i + 4, 3, PLAYER_UPPER.concat(PLAYER_LEGS[i]));

const out = process.argv[2] || path.join(here, '..', 'tools', 'sprites_preview.png');
writePNG(out, sheet.w, sheet.h, sheet.buf, 1);
console.log('wrote', out, sheet.w + 'x' + sheet.h);
