export const REGION = { rigging: 0, sails: 1, hull: 2, hold: 3, boat: 4, flag: 5 };
export const KIND = { line: 0, fill: 1, ghost: 2, xray: 3 };

// Контуры частей корабля в пикселях исходного рисунка hero-ship.png.
const SAILS = [
  { mast: 530, poly: [[462, 292], [598, 262], [640, 398], [548, 362], [452, 412], [444, 360]] },
  { mast: 530, poly: [[418, 436], [640, 398], [664, 640], [545, 585], [420, 652], [402, 540]] },
  { mast: 530, poly: [[412, 656], [664, 640], [640, 782], [530, 722], [440, 730], [420, 690]] },
  { mast: 855, poly: [[780, 165], [932, 130], [975, 300], [850, 250], [768, 322], [752, 250]] },
  { mast: 855, poly: [[722, 350], [990, 302], [1022, 590], [850, 552], [735, 612], [698, 480]] },
  { mast: 855, poly: [[720, 625], [1022, 590], [990, 760], [850, 712], [752, 738], [726, 680]] },
  { mast: 1180, poly: [[1042, 606], [1334, 246], [1290, 440], [1342, 612], [1180, 568], [1095, 578]] },
  { mast: 240, poly: [[178, 672], [316, 655], [272, 700], [292, 726], [195, 726]] },
  { mast: 300, poly: [[150, 594], [445, 385], [368, 640], [215, 604]] },
].map((sail) => {
  const xs = sail.poly.map(([x]) => x);
  const ys = sail.poly.map(([, y]) => y);
  return {
    ...sail,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
});
const HULL = [
  [288, 728], [345, 735], [480, 772], [660, 792], [850, 802], [1000, 790], [1108, 742], [1180, 698],
  [1240, 640], [1412, 618], [1412, 800], [1335, 812], [1312, 942], [476, 942], [420, 845], [335, 795],
];
const DECK = HULL.slice(0, 10);
const HOLD_LINE = 868;
const MASTS = [530, 855, 1180];

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (t) => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;

const inPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const sailAt = (px, py) => {
  for (let i = 0; i < SAILS.length; i += 1) {
    const s = SAILS[i];
    if (px >= s.minX && px <= s.maxX && py >= s.minY && py <= s.maxY && inPoly(s.poly, px, py)) return s;
  }
  return null;
};

const toWorld = (px, py) => [(px - 760) / 100, (925 - py) / 100];

const hullBeam = (x) => {
  const t = clamp((x + 4.75) / 11.3);
  const bow = Math.pow(Math.sin((Math.min(t / 0.6, 1) * Math.PI) / 2), 0.72);
  const stern = 1 - 0.3 * smooth(clamp((t - 0.6) / 0.4));
  return 1.6 * bow * stern;
};

const hullZ = (x, y) => hullBeam(x) * (0.66 + 0.34 * clamp(y / 2.2));

const sailBelly = (sail, px, py) => {
  const u = clamp((px - sail.minX) / (sail.maxX - sail.minX));
  const v = clamp((py - sail.minY) / (sail.maxY - sail.minY));
  return Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
};

const sailZ = (sail, belly, x) => (x - (sail.mast - 760) / 100) * 0.42 + belly * 0.5;

const riggingZ = (y) => 1.05 * Math.exp(-Math.max(0, y - 2.1) * 0.62);

function deckY(x) {
  const px = x * 100 + 760;
  for (let i = 1; i < DECK.length; i += 1) {
    if (px <= DECK[i][0]) {
      const [x0, y0] = DECK[i - 1];
      const [x1, y1] = DECK[i];
      return (925 - lerp(y0, y1, (px - x0) / (x1 - x0))) / 100;
    }
  }
  return (925 - DECK[DECK.length - 1][1]) / 100;
}

const makeCanvas = (width, height) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

// Порядок точек важен: заливку и флаг рисует ещё и проход с тенью, а ящики трюма нужны только на своём блоке.
function arrange({ data, count }) {
  const group = (i) => {
    const kind = data[i * 7 + 5];
    if (kind === KIND.xray) return 2;
    return kind === KIND.fill || data[i * 7 + 3] === REGION.flag ? 0 : 1;
  };
  const sizes = [0, 0, 0];
  for (let i = 0; i < count; i += 1) sizes[group(i)] += 1;
  const next = [0, sizes[0], sizes[0] + sizes[1]];
  const sorted = new Float32Array(data.length);
  for (let i = 0; i < count; i += 1) {
    const g = group(i);
    sorted.set(data.subarray(i * 7, i * 7 + 7), next[g] * 7);
    next[g] += 1;
  }
  return { data: sorted, count, solids: sizes[0], xray: sizes[2] };
}

// Контуры заданы для рисунка шириной 1536 px, картинка может быть меньше.
const ART_WIDTH = 1536;

export function buildShipCloud(image, density) {
  const W = image.naturalWidth || image.width;
  const H = image.naturalHeight || image.height;
  const ctx = makeCanvas(W, H).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, W, H).data;
  const toArt = ART_WIDTH / W;

  const line = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) if (pixels[i * 4 + 3] > 40) line[i] = 1;

  const wall = new Uint8Array(W * H);
  const reach = Math.max(2, Math.round(3 / toArt));
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!line[y * W + x]) continue;
      const top = Math.max(0, y - reach);
      const bottom = Math.min(H - 1, y + reach);
      const left = Math.max(0, x - reach);
      const right = Math.min(W - 1, x + reach);
      for (let ny = top; ny <= bottom; ny += 1) wall.fill(1, ny * W + left, ny * W + right + 1);
    }
  }

  const outside = new Uint8Array(W * H);
  const stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = (p / W) | 0;
    if (x > 0 && !outside[p - 1] && !wall[p - 1]) { outside[p - 1] = 1; stack.push(p - 1); }
    if (x < W - 1 && !outside[p + 1] && !wall[p + 1]) { outside[p + 1] = 1; stack.push(p + 1); }
    if (y > 0 && !outside[p - W] && !wall[p - W]) { outside[p - W] = 1; stack.push(p - W); }
    if (y < H - 1 && !outside[p + W] && !wall[p + W]) { outside[p + W] = 1; stack.push(p + W); }
  }

  const points = [];
  const push = (x, y, z, region, kind, sway) => {
    points.push(x, y, z, region, Math.random(), kind, sway);
  };

  for (let row = 0; row < H; row += 1) {
    for (let col = 0; col < W; col += 1) {
      const i = row * W + col;
      const isLine = line[i] === 1;
      const isInside = !isLine && !outside[i] && !wall[i];
      if (!isLine && !isInside) continue;
      if (isLine ? Math.random() > density.line : Math.random() > density.fill) continue;

      const px = col * toArt;
      const py = row * toArt;
      const [x, y] = toWorld(px, py);
      const sail = sailAt(px, py);
      const hull = !sail && inPoly(HULL, px, py);

      if (isLine) {
        if (sail) {
          const belly = sailBelly(sail, px, py);
          push(x, y, sailZ(sail, belly, x), REGION.sails, KIND.line, 1 + belly);
        } else if (hull) {
          const z = hullZ(x, y);
          const region = py > HOLD_LINE ? REGION.hold : REGION.hull;
          push(x, y, z, region, KIND.line, 0);
          if (Math.random() < density.ghost) push(x, y, -z, region, KIND.ghost, 0);
        } else {
          const onMast = MASTS.some((mast) => Math.abs(px - mast) < 9);
          const z = onMast ? 0 : riggingZ(y) * Math.min(1, hullBeam(x) / 1.2);
          push(x, y, z, REGION.rigging, KIND.line, 0.14);
        }
      } else if (sail) {
        const belly = sailBelly(sail, px, py);
        push(x, y, sailZ(sail, belly, x), REGION.sails, KIND.fill, 1 + belly);
      } else if (hull) {
        push(x, y, hullZ(x, y), py > HOLD_LINE ? REGION.hold : REGION.hull, KIND.fill, 0);
      }
    }
  }

  // Палуба: поперечные балки между бортами.
  for (let x = -3.9; x <= 6.2; x += 0.42) {
    const y = deckY(x);
    const beam = hullZ(x, y);
    for (let s = -1; s <= 1; s += 0.05) {
      if (Math.random() < density.deck) push(x, y, s * beam, REGION.hull, KIND.ghost, 0);
    }
  }

  // Ящики в трюме: видны только при «просвечивании» на блоке про 1С.
  const edges = [
    [0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (let cx = -2.3; cx <= 3.6; cx += 0.98) {
    for (let tier = 0; tier < 2; tier += 1) {
      for (const side of [-0.42, 0.42]) {
        const size = 0.78;
        const corners = [];
        for (let c = 0; c < 8; c += 1) {
          corners.push([
            cx + (c & 1 ? size : -size) / 2,
            0.05 + tier * 0.6 + (c & 2 ? 0.52 : 0),
            side + (c & 4 ? 0.34 : -0.34),
          ]);
        }
        for (const [a, b] of edges) {
          for (let t = 0; t <= 1; t += 0.06) {
            push(
              lerp(corners[a][0], corners[b][0], t),
              lerp(corners[a][1], corners[b][1], t),
              lerp(corners[a][2], corners[b][2], t),
              REGION.hold,
              KIND.xray,
              0
            );
          }
        }
      }
    }
  }

  // Флаг с </> вместо черепа.
  const g = makeCanvas(240, 130).getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(240, 0);
  g.lineTo(0, 12);
  g.lineTo(38, 65);
  g.lineTo(0, 118);
  g.lineTo(240, 130);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = "destination-out";
  g.font = "700 76px Consolas, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("</>", 138, 66);
  const flagData = g.getImageData(0, 0, 240, 130).data;
  for (let fy = 0; fy < 130; fy += 2) {
    for (let fx = 0; fx < 240; fx += 2) {
      if (flagData[(fy * 240 + fx) * 4 + 3] < 128) continue;
      push(0.95 - (1 - fx / 240) * 1.75, 8.85 - (fy / 130) * 0.95, 0, REGION.flag, KIND.line, 0);
    }
  }

  return arrange(shuffled(points, 7));
}

export function buildBoat() {
  const points = [];
  const push = (x, y, z, kind = KIND.line) => points.push(x, y, z, REGION.boat, Math.random(), kind, 0);
  const L = 2.5;
  const B = 0.62;
  const H = 0.42;
  const halfBeam = (s) => B * Math.pow(Math.sin(Math.PI * s), 0.62);
  for (let s = 0; s <= 1; s += 0.004) {
    const x = (s - 0.5) * L;
    const rise = 0.12 * Math.pow(Math.abs(s - 0.5) * 2, 2.4);
    for (const side of [-1, 1]) {
      push(x, H + rise, side * halfBeam(s));
      push(x, H * 0.72 + rise, side * halfBeam(s) * 0.96);
      push(x, H * 0.36, side * halfBeam(s) * 0.68);
    }
    push(x, 0, 0);
  }
  for (let s = 0.08; s < 0.95; s += 0.056) {
    const x = (s - 0.5) * L;
    const b = halfBeam(s);
    for (let a = -1; a <= 1; a += 0.03) push(x, H * Math.pow(Math.abs(a), 1.7), a * b);
  }
  for (let t = 0; t <= 1; t += 0.004) {
    push(-0.25, 0.1 + t * 2.1, 0);
    const yard = (t - 0.5) * 1.5;
    push(-0.25 + yard, 1.52 + yard * 0.46, 0);
  }
  for (let i = 0; i < 2600; i += 1) {
    const a = Math.random();
    const b = Math.random();
    const sa = Math.sqrt(a);
    const u = 1 - sa;
    const v = sa * (1 - b);
    const w = sa * b;
    const x = u * -1.0 + v * 0.5 + w * -0.14;
    const y = u * 1.18 + v * 1.88 + w * 0.42;
    const belly = Math.sin(Math.min(v + w, 1) * Math.PI) * Math.sin(Math.min(u + v, 1) * Math.PI) * 0.22;
    push(x, y, belly, i % 5 === 0 ? KIND.line : KIND.fill);
  }
  for (const side of [-1, 1]) {
    for (let t = 0; t <= 1; t += 0.01) {
      push(0.22 + t * 0.34, H + 0.04 - t * 0.5, side * (0.34 + t * 0.95));
    }
  }
  return shuffled(points, 7);
}

function shuffled(flat, stride) {
  const count = flat.length / stride;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  const data = new Float32Array(flat.length);
  for (let i = 0; i < count; i += 1) {
    const from = order[i] * stride;
    for (let k = 0; k < stride; k += 1) data[i * stride + k] = flat[from + k];
  }
  return { data, count };
}

