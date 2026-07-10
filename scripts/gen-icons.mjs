// One-shot generator: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pixel(x, y, s) {
  const px = x + 0.5;
  const py = y + 0.5;
  const r = s * 0.22;
  const cx = Math.min(Math.max(px, r), s - r);
  const cy = Math.min(Math.max(py, r), s - r);
  if (Math.hypot(px - cx, py - cy) > r) return [0, 0, 0, 0]; // outside rounded corner
  const barCenters = [0.34, 0.5, 0.66];
  const inBarY = barCenters.some((c) => Math.abs(py / s - c) < 0.05);
  const inBarX = px / s > 0.27 && px / s < 0.73;
  if (inBarY && inBarX) return [255, 255, 255, 255]; // white bar
  return [79, 70, 229, 255]; // indigo #4f46e5
}

function makePng(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw.set(pixel(x, y, size), y * stride + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`icons/icon${size}.png`, makePng(size));
  console.log(`icons/icon${size}.png`);
}
