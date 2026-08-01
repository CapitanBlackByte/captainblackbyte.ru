import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = path.resolve(root, process.argv[2] || "assets/ship-line.png");
const out = path.join(root, "public", "hero-ship.png");
const tmp = path.join(root, "public", "hero-ship.tmp.png");

if (!fs.existsSync(source)) {
  throw new Error(`Source image not found: ${source}`);
}

fs.copyFileSync(source, out);

const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const w = info.width;
const h = info.height;

const reds = [];

for (let y = 0; y < Math.floor(h * 0.35); y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const isGold = lum > 55 && r > 90 && g > 55 && r > b + 10 && g > b;
    const isRed = r > 140 && g < 70 && b < 70 && r > g + 60 && r > b + 60;

    if (isRed) {
      data[i + 3] = 255;
      reds.push([x, y]);
    } else if (isGold) {
      data[i + 3] = 255;
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
}

for (let y = Math.floor(h * 0.35); y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const isGold = lum > 55 && r > 90 && g > 55 && r > b + 10 && g > b;
    if (isGold) data[i + 3] = 255;
    else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
}

if (reds.length < 10) throw new Error(`Flag not found (${reds.length} reds)`);

const bin = 24;
const counts = new Map();
for (const [x, y] of reds) {
  const key = `${Math.floor(x / bin)},${Math.floor(y / bin)}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}
let bestKey = null;
let bestCount = 0;
for (const [k, c] of counts) {
  if (c > bestCount) {
    bestCount = c;
    bestKey = k;
  }
}
const [bx, by] = bestKey.split(",").map(Number);
const cx0 = bx * bin;
const cy0 = by * bin;

const cluster = reds.filter(([x, y]) => Math.hypot(x - (cx0 + bin / 2), y - (cy0 + bin / 2)) < bin * 2.2);
let minX = w,
  minY = h,
  maxX = 0,
  maxY = 0;
for (const [x, y] of cluster) {
  if (x < minX) minX = x;
  if (y < minY) minY = y;
  if (x > maxX) maxX = x;
  if (y > maxY) maxY = y;
}

const fw = Math.max(12, maxX - minX);
const fh = Math.max(10, maxY - minY);
console.log("flag cluster", { minX, minY, maxX, maxY, fw, fh, reds: reds.length, cluster: cluster.length, bestCount });

await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(tmp);

const emblemSize = Math.max(14, Math.round(Math.min(fw * 0.72, fh * 0.9)));
const left = Math.round(minX + fw * 0.12);
const top = Math.round(minY + (fh - emblemSize) / 2);

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${emblemSize}" height="${emblemSize}" viewBox="0 0 64 64">
  <g fill="#7CFF2A" stroke="#07110e" stroke-width="1.1" stroke-linecap="round">
    <path d="M12 44 L52 20" stroke-width="5.2" fill="none"/>
    <path d="M12 20 L52 44" stroke-width="5.2" fill="none"/>
    <circle cx="11" cy="45" r="4.4"/>
    <circle cx="53" cy="19" r="4.4"/>
    <circle cx="11" cy="19" r="4.4"/>
    <circle cx="53" cy="45" r="4.4"/>
  </g>
  <path d="M19 27 C19 15, 45 15, 45 27 L45 39 C45 46, 39 50, 32 50 C25 50, 19 46, 19 39 Z" fill="#7CFF2A" stroke="#07110e" stroke-width="1.3"/>
  <path d="M25 19 L18 9" stroke="#7CFF2A" stroke-width="3.1" stroke-linecap="round" fill="none"/>
  <path d="M39 19 L46 9" stroke="#7CFF2A" stroke-width="3.1" stroke-linecap="round" fill="none"/>
  <circle cx="18" cy="8" r="2.5" fill="#7CFF2A"/>
  <circle cx="46" cy="8" r="2.5" fill="#7CFF2A"/>
  <circle cx="26.5" cy="33.5" r="3.3" fill="#07110e"/>
  <circle cx="37.5" cy="33.5" r="3.3" fill="#07110e"/>
</svg>`);

await sharp(tmp)
  .composite([{ input: svg, left: Math.max(0, left), top: Math.max(0, top) }])
  .png()
  .toFile(out);

fs.unlinkSync(tmp);
console.log("emblem placed", { left, top, emblemSize });
