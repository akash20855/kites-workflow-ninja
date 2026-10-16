// Generates the app icons from logo-white.png. Run with: node tools/make-icons.js
// Dependency free: decodes the source PNG, composites the wordmark onto the brand
// background, and writes every size the PWA manifest, the browsers and the Mac app need.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.resolve(__dirname, '..');
const SRC = path.join(DIR, 'logo-white.png');
const ICONS = path.join(DIR, 'icons');
const ICONSET = path.join(DIR, 'build', 'icon.iconset');
const BG = [0x1d, 0x1d, 0x1f]; // brand dark, same as the app header and theme color
const MASTER = 2048;

// ---------------------------------------------------------------- PNG decode

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  let off = 8;
  let fmt = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      fmt = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!fmt) throw new Error('PNG has no IHDR');
  if (fmt.depth !== 8 || fmt.color !== 6 || fmt.interlace !== 0) {
    throw new Error('Expected an 8-bit RGBA, non-interlaced PNG (depth=' + fmt.depth + ' color=' + fmt.color + ')');
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = fmt.w * bpp;
  const out = Buffer.alloc(fmt.h * stride);
  let p = 0;
  for (let y = 0; y < fmt.h; y++) {
    const filter = raw[p++];
    const row = y * stride;
    const prev = row - stride;
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
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error('Unsupported PNG filter ' + filter);
      out[row + x] = val & 0xff;
    }
    p += stride;
  }
  return { w: fmt.w, h: fmt.h, data: out };
}

// ---------------------------------------------------------------- PNG encode

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
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // no per-row filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- compositing

// Tight box around everything that is not fully transparent, so the wordmark can be
// centred no matter how much empty canvas the designer left around it.
function alphaBBox(img) {
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
  if (maxX < 0) throw new Error('The logo is fully transparent');
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function sample(img, x, y) {
  const cx = Math.min(img.w - 1, Math.max(0, x));
  const cy = Math.min(img.h - 1, Math.max(0, y));
  const i = (cy * img.w + cx) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

// Draw the wordmark centred on the brand square. radius is a fraction of the icon
// size (0 gives a full bleed square, which is what a maskable icon wants).
function buildMaster(img, box, wordWidth, radius) {
  const size = MASTER;
  const out = Buffer.alloc(size * size * 4);
  const corner = radius * size;
  const drawW = Math.max(1, Math.round(wordWidth * size));
  const drawH = Math.max(1, Math.round((box.h / box.w) * drawW));
  const left = Math.round((size - drawW) / 2);
  const top = Math.round((size - drawH) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded square coverage.
      let inside = true;
      if (corner > 0) {
        const cx = x < corner ? corner : x > size - corner ? size - corner : x;
        const cy = y < corner ? corner : y > size - corner ? size - corner : y;
        const dx = x - cx;
        const dy = y - cy;
        inside = dx * dx + dy * dy <= corner * corner;
      }
      if (!inside) continue; // stays transparent
      out[i] = BG[0];
      out[i + 1] = BG[1];
      out[i + 2] = BG[2];
      out[i + 3] = 255;
    }
  }

  for (let y = 0; y < drawH; y++) {
    const sy = box.y + Math.floor((y * box.h) / drawH);
    for (let x = 0; x < drawW; x++) {
      const sx = box.x + Math.floor((x * box.w) / drawW);
      const [r, g, b, a] = sample(img, sx, sy);
      if (!a) continue;
      const [mr, mg, mb, ma] = [out[((top + y) * size + left + x) * 4], out[((top + y) * size + left + x) * 4 + 1],
        out[((top + y) * size + left + x) * 4 + 2], out[((top + y) * size + left + x) * 4 + 3]];
      if (ma === 0) continue; // outside the rounded corner
      const f = a / 255;
      const i = ((top + y) * size + left + x) * 4;
      out[i] = Math.round(r * f + mr * (1 - f));
      out[i + 1] = Math.round(g * f + mg * (1 - f));
      out[i + 2] = Math.round(b * f + mb * (1 - f));
      out[i + 3] = 255;
    }
  }
  return { size, data: out };
}

// Area average, which gives clean antialiased edges when shrinking the master.
function resample(master, size) {
  const out = Buffer.alloc(size * size * 4);
  const step = master.size / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * step);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * step));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * step);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * step));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < master.size; sy++) {
        for (let sx = x0; sx < x1 && sx < master.size; sx++) {
          const i = (sy * master.size + sx) * 4;
          const alpha = master.data[i + 3];
          r += master.data[i] * alpha;
          g += master.data[i + 1] * alpha;
          b += master.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ---------------------------------------------------------------- output

function write(file, size, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(size, size, data));
  console.log('wrote ' + path.relative(DIR, file) + ' (' + size + 'x' + size + ')');
}

function main() {
  const img = decodePng(fs.readFileSync(SRC));
  const box = alphaBBox(img);
  // A maskable icon is cropped to a circle, so its content has to sit well inside the square.
  const square = buildMaster(img, box, 0.7, 0.225);
  const maskable = buildMaster(img, box, 0.56, 0);

  write(path.join(ICONS, 'icon-1024.png'), 1024, resample(square, 1024));
  write(path.join(ICONS, 'icon-512.png'), 512, resample(square, 512));
  write(path.join(ICONS, 'icon-192.png'), 192, resample(square, 192));
  write(path.join(ICONS, 'apple-touch-icon.png'), 180, resample(square, 180));
  write(path.join(ICONS, 'icon-maskable-512.png'), 512, resample(maskable, 512));
  write(path.join(ICONS, 'favicon-32.png'), 32, resample(square, 32));

  // The Mac app icon, in every size macOS asks for.
  const iconset = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'], [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'], [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'], [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of iconset) {
    fs.mkdirSync(ICONSET, { recursive: true });
    fs.writeFileSync(path.join(ICONSET, name), encodePng(size, size, resample(square, size)));
  }
  console.log('wrote build/icon.iconset (' + iconset.length + ' sizes)');
}

main();
