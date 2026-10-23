// Generates resources/icon.png (256px) and resources/tray.png (32px) without any image library:
// a dark rounded square with a green "F" glyph, matching the app's palette.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function draw(size) {
  const r = size * 0.22;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // "F" glyph: vertical stem + two bars, in result-green
  const s = size;
  const stem = { x0: s * 0.3, x1: s * 0.42, y0: s * 0.24, y1: s * 0.78 };
  const top = { x0: s * 0.3, x1: s * 0.72, y0: s * 0.24, y1: s * 0.35 };
  const mid = { x0: s * 0.3, x1: s * 0.62, y0: s * 0.46, y1: s * 0.56 };
  const inRect = (b, x, y) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (!inRounded(px, py)) return [0, 0, 0, 0];
    if (inRect(stem, px, py) || inRect(top, px, py) || inRect(mid, px, py)) return [0x86, 0xd9, 0x4b, 255];
    return [0x1c, 0x1c, 0x1c, 255];
  };
}

mkdirSync('resources', { recursive: true });
writeFileSync('resources/icon.png', png(256, draw(256)));
writeFileSync('resources/tray.png', png(32, draw(32)));
console.log('icons written');
