// Generates the PWA icons at build time so the repository carries no binary
// blobs: a Graphite slab with the three status lights (violet/cyan/amber).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

const SLAB = hexToRgb('#0E0F12');
const KEY = hexToRgb('#1E2127');
const DOTS = ['#A78BFA', '#4CC2FF', '#FFB454'].map(hexToRgb);

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const keyInset = size * 0.14;
  const keyRadius = size * 0.09;
  const dotY = size * 0.5;
  const dotRadius = size * 0.075;
  const dotSpacing = size * 0.21;
  const glowRadius = dotRadius * 2.4;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let [r, g, b] = SLAB;

      // Rounded keycap centered on the slab.
      const kx = Math.max(keyInset + keyRadius - x, x - (size - keyInset - keyRadius), 0);
      const ky = Math.max(keyInset + keyRadius - y, y - (size - keyInset - keyRadius), 0);
      const insideKey =
        x >= keyInset &&
        x <= size - keyInset &&
        y >= keyInset &&
        y <= size - keyInset &&
        kx * kx + ky * ky <= keyRadius * keyRadius + keyRadius;
      if (insideKey) [r, g, b] = KEY;

      // Three status lights with a soft additive glow.
      for (let i = 0; i < 3; i += 1) {
        const cx = size / 2 + (i - 1) * dotSpacing;
        const distance = Math.hypot(x - cx, y - dotY);
        const [dr, dg, db] = DOTS[i];
        if (distance <= dotRadius) {
          [r, g, b] = [dr, dg, db];
        } else if (distance <= glowRadius && insideKey) {
          const t = 0.35 * (1 - (distance - dotRadius) / (glowRadius - dotRadius));
          r = Math.round(r + (dr - r) * t);
          g = Math.round(g + (dg - g) * t);
          b = Math.round(b + (db - b) * t);
        }
      }

      const offset = (y * size + x) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return encodePng(size, pixels);
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(publicDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(publicDir, `icon-${String(size)}.png`), drawIcon(size));
}
process.stdout.write('pwa icons generated\n');
