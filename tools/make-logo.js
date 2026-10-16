// Turns assets/logo-lockup.png (the blackkite mark plus wordmark used on the studio's
// own documents) into logo-black.png, trimmed to the ink so page layout is predictable.
// Run with: node tools/make-logo.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.resolve(__dirname, '..');
const SRC = path.join(DIR, 'assets', 'logo-lockup.png');
const OUT = path.join(DIR, 'logo-black.png');

function decodePng(buf) {
  let off = 8;
  let fmt = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') fmt = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (fmt.depth !== 8 || fmt.color !== 6 || fmt.interlace !== 0) throw new Error('Expected an 8-bit RGBA PNG');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = fmt.w * bpp;
  const out = Buffer.alloc(fmt.h * stride);
  let p = 0;
  for (let y = 0; y < fmt.h; y++) {
    const filter = raw[p++];
    const row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[p + x];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let val;
      if (filter === 0) val = v;
      else if (filter === 1) val = v + a;
      else if (filter === 2) val = v + b;
      else if (filter === 3) val = v + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[row + x] = val & 0xff;
    }
    p += stride;
  }
  return { w: fmt.w, h: fmt.h, data: out };
}

const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); };
function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const img = decodePng(fs.readFileSync(SRC));
let minX = img.w, minY = img.h, maxX = -1, maxY = -1;
for (let y = 0; y < img.h; y++) {
  for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] > 8) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) throw new Error('assets/logo-lockup.png is fully transparent');
const w = maxX - minX + 1;
const h = maxY - minY + 1;
const out = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const s = ((y + minY) * img.w + (x + minX)) * 4;
    const d = (y * w + x) * 4;
    // Force the ink to pure black, keeping the coverage in the alpha channel.
    out[d] = 0; out[d + 1] = 0; out[d + 2] = 0;
    out[d + 3] = img.data[s + 3];
  }
}
fs.writeFileSync(OUT, encodePng(w, h, out));
console.log('wrote logo-black.png (' + w + 'x' + h + ', ratio ' + (w / h).toFixed(2) + ')');
