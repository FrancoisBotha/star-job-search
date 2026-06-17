// One-off icon generator for Star Job Search.
// Renders the brand mark (terracotta ★ on a warm rounded tile) to the PNG
// sizes Electron/Quasar need, plus a Windows .ico packed from PNG entries.
// Run with the sharp that ships in .ombutocode:
//   node app/src-electron/icons/gen-icons.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const sharp = require('C:/dev/build/star-job-search/.ombutocode/src/node_modules/sharp');

const OUT = path.dirname(fileURLToPath(import.meta.url));

// --- build the star path (5-point, centred) -------------------------------
function starPath(cx, cy, outer, innerRatio) {
  const inner = outer * innerRatio;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (-90 + i * 36) * (Math.PI / 180);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return 'M' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z';
}

const SIZE = 1024;
const star = starPath(SIZE / 2, SIZE / 2 + 8, 312, 0.4);
const svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#cf7140"/>
      <stop offset="1" stop-color="#a8552d"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="184" ry="184" fill="url(#bg)"/>
  <path d="${star}" fill="#fbf7ef"/>
</svg>`;
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const pngBuf = {};
for (const s of sizes) {
  const buf = await sharp(Buffer.from(svg)).resize(s, s).png().toBuffer();
  pngBuf[s] = buf;
}
// Window / Linux / dev taskbar icon.
fs.writeFileSync(path.join(OUT, 'icon.png'), pngBuf[512]);

// --- pack a Windows .ico from PNG-compressed entries ----------------------
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const count = icoSizes.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(count, 4);
const entries = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
const blobs = [];
icoSizes.forEach((s, i) => {
  const data = pngBuf[s];
  const e = i * 16;
  entries.writeUInt8(s >= 256 ? 0 : s, e + 0); // width (0 == 256)
  entries.writeUInt8(s >= 256 ? 0 : s, e + 1); // height
  entries.writeUInt8(0, e + 2); // palette
  entries.writeUInt8(0, e + 3); // reserved
  entries.writeUInt16LE(1, e + 4); // colour planes
  entries.writeUInt16LE(32, e + 6); // bits per pixel
  entries.writeUInt32LE(data.length, e + 8); // size of image data
  entries.writeUInt32LE(offset, e + 12); // offset of image data
  offset += data.length;
  blobs.push(data);
});
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([header, entries, ...blobs]));

// a 256 preview for eyeballing
fs.writeFileSync(path.join(OUT, 'preview-256.png'), pngBuf[256]);
console.log('wrote: icon.svg, icon.png (512), icon.ico (' + icoSizes.join(',') + '), preview-256.png');
