const REGION = { rigging: 0, sails: 1, hull: 2, hold: 3, boat: 4, flag: 5 };
const KIND = { line: 0, fill: 1, ghost: 2, xray: 3 };

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

// Камера и подсветка для каждого блока страницы, к которому привязан скролл.
const KEYS = {
  hero: { yaw: -0.34, pitch: 0.02, dist: 29, look: [0.2, 3.5, 0], shift: [0.38, -0.17], nShift: [0, 0.46], nDist: 0.66 },
  intro: { yaw: -0.05, pitch: 0.02, dist: 38, look: [0, 4, 0], shift: [0, -0.46], nShift: [0, -0.36], nDist: 0.56 },
  sails: { yaw: -0.22, pitch: -0.03, dist: 15.5, look: [0.6, 5.1, 0], shift: [0.3, -0.04], nShift: [0, 0.38], nDist: 0.72, hi: REGION.sails },
  rigging: { yaw: 0.42, pitch: 0.05, dist: 13.5, look: [2.2, 4.8, 0], shift: [-0.3, 0], nShift: [0, 0.38], nDist: 0.8, hi: REGION.rigging },
  hull: { yaw: -0.5, pitch: 0.12, dist: 13, look: [0.2, 1.5, 0], shift: [0.28, 0.02], nShift: [0, 0.42], nDist: 0.72, hi: REGION.hull },
  hold: { yaw: 0.16, pitch: 0.16, dist: 10.5, look: [0.8, 0.7, 0], shift: [-0.28, 0.08], nShift: [0, 0.46], nDist: 0.72, hi: REGION.hold, xray: 1 },
  boat: { yaw: -0.82, pitch: 0.1, dist: 12, look: [-6.2, 1.2, 3.8], shift: [0.28, 0.05], nShift: [0, 0.44], nDist: 0.5, hi: REGION.boat, boat: 1 },
  storm: { yaw: -0.2, pitch: -0.012, dist: 40, look: [0.2, 3.2, 0], shift: [0, -0.56], nShift: [0, -0.5], nDist: 0.55, storm: 1 },
};

const MOON_DIR = normalize([0.3, 0.155, -0.94]);
const FOV = (30 * Math.PI) / 180;

function normalize([x, y, z]) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function lookAt(eye, center) {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize([z[2], 0, -z[0]]);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
    }
  }
  return out;
}

function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ];
}

function shipMatrix(heave, pitch, roll, pivotX) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return [
    cp, sp, 0, 0,
    -sp * cr, cp * cr, sr, 0,
    sp * sr, -cp * sr, cr, 0,
    pivotX - cp * pivotX, heave - sp * pivotX, 0, 1,
  ];
}

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

function buildShipCloud(image, density) {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const source = document.createElement("canvas");
  source.width = W;
  source.height = H;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, W, H).data;

  const line = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) if (pixels[i * 4 + 3] > 40) line[i] = 1;

  const wall = new Uint8Array(W * H);
  const reach = 3;
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

  for (let py = 0; py < H; py += 1) {
    for (let px = 0; px < W; px += 1) {
      const i = py * W + px;
      const isLine = line[i] === 1;
      const isInside = !isLine && !outside[i] && !wall[i];
      if (!isLine && !isInside) continue;
      if (isLine ? Math.random() > density.line : Math.random() > density.fill) continue;

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
    for (let s = -1; s <= 1; s += 0.05) push(x, y, s * beam, REGION.hull, KIND.ghost, 0);
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
  const flag = document.createElement("canvas");
  flag.width = 240;
  flag.height = 130;
  const g = flag.getContext("2d", { willReadFrequently: true });
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

  return shuffled(points, 7);
}

function buildBoat() {
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

function buildOcean(nx, nz) {
  const data = new Float32Array(nx * nz * 3);
  let k = 0;
  for (let iz = 0; iz < nz; iz += 1) {
    const s = iz / (nz - 1);
    const z = 14 - Math.pow(s, 1.75) * 128;
    const half = 34 + s * 120;
    for (let ix = 0; ix < nx; ix += 1) {
      const spacing = (2 * half) / nx;
      data[k] = (ix / (nx - 1) - 0.5) * 2 * half + (Math.random() - 0.5) * spacing * 0.7;
      data[k + 1] = z + (Math.random() - 0.5) * (0.12 + s * 2.2);
      data[k + 2] = Math.random();
      k += 3;
    }
  }
  return data;
}

function buildStars(count) {
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const dir = normalize([Math.random() * 2 - 1, Math.pow(Math.random(), 1.6) * 0.92 + 0.012, -Math.random() * 1.1 - 0.05]);
    data[i * 4] = dir[0];
    data[i * 4 + 1] = dir[1];
    data[i * 4 + 2] = dir[2];
    data[i * 4 + 3] = Math.random();
  }
  return data;
}

const WAVE_GLSL = `
float wave(vec2 p, float t) {
  return .30 * sin(.31 * p.x + .52 * p.y + .62 * t)
       + .19 * sin(.63 * p.x - .41 * p.y + .97 * t + 1.3)
       + .10 * sin(1.21 * p.x + .93 * p.y + 1.43 * t + 2.1)
       + .05 * sin(2.33 * p.x - 1.71 * p.y + 2.07 * t + .4);
}`;

const wave = (x, z, t) =>
  0.3 * Math.sin(0.31 * x + 0.52 * z + 0.62 * t) +
  0.19 * Math.sin(0.63 * x - 0.41 * z + 0.97 * t + 1.3) +
  0.1 * Math.sin(1.21 * x + 0.93 * z + 1.43 * t + 2.1) +
  0.05 * Math.sin(2.33 * x - 1.71 * z + 2.07 * t + 0.4);

const FULLSCREEN_VS = `#version 300 es
out vec2 vNdc;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vNdc = p * 2. - 1.;
  vUv = p;
  gl_Position = vec4(vNdc, 0., 1.);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
out vec4 o;
uniform mat4 uInvVP;
uniform vec2 uShift;
uniform vec3 uCam, uMoon;
uniform float uTime, uStorm, uFlash, uDetail;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = .5, s = 0.;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(11.3, 7.1); a *= .5; }
  return s;
}

void main() {
  vec4 far = uInvVP * vec4(vNdc - uShift, 1., 1.);
  vec3 dir = normalize(far.xyz / far.w - uCam);
  float h = dir.y;
  float up = max(h, 0.);

  vec3 col = mix(vec3(.058, .105, .165), vec3(.020, .040, .082), smoothstep(0., .15, up));
  col = mix(col, vec3(.006, .012, .030), smoothstep(.1, .6, up));
  if (h < 0.) col = mix(vec3(.042, .08, .125), vec3(.005, .011, .022), smoothstep(0., .2, -h));

  float md = acos(clamp(dot(dir, uMoon), -1., 1.));
  float az = pow(max(dot(normalize(dir.xz + 1e-4), normalize(uMoon.xz)), 0.), 22.);
  col += vec3(.34, .22, .10) * az * exp(-abs(h) * 13.) * .7;
  col += vec3(.95, .74, .42) * (exp(-md * 5.2) * .075 + exp(-md * 15.) * .16);

  const float R = .098;
  vec3 mx = normalize(cross(vec3(0, 1, 0), uMoon));
  vec3 my = cross(uMoon, mx);
  vec2 q = vec2(dot(dir, mx), dot(dir, my)) / R;
  float rr = dot(q, q);
  float storm = smoothstep(.0, .8, uStorm);
  if (rr < 1. && dot(dir, uMoon) > 0.) {
    float z = sqrt(1. - rr);
    float maria = fbm(q * 2.2 + 4.) * .75 + fbm(q * 7. + 9.) * .25;
    vec3 surface = mix(vec3(.46, .36, .23), vec3(.92, .80, .58), smoothstep(.28, .72, maria));
    surface *= .42 + .58 * pow(z, .55);
    float edge = smoothstep(1., .985, sqrt(rr));
    col = mix(col, surface * .62, edge * (1. - storm * .75));
  }

  if (h > -.02 && uDetail > .5) {
    vec2 cp = dir.xz / (up + .22);
    float cover = mix(.56, .36, storm);
    float c = smoothstep(cover, cover + .3, fbm(cp * vec2(.75, 1.9) + vec2(uTime * .012, 0.)));
    float lit = exp(-md * 3.2);
    vec3 cloud = mix(vec3(.018, .03, .055), vec3(.34, .26, .16), lit);
    col = mix(col, cloud, c * mix(.55, .92, storm) * smoothstep(-.02, .05, h));
    col += vec3(.5, .58, .85) * uFlash * (.14 + c * 1.5);
  } else {
    col += vec3(.5, .58, .85) * uFlash * .3;
  }

  col *= mix(1., .42, storm);
  o = vec4(col, 1.);
}`;

const STARS_VS = `#version 300 es
layout(location = 0) in vec4 aStar;
uniform mat4 uVP;
uniform vec2 uShift;
uniform vec3 uCam;
uniform float uTime, uPx, uStorm;
out vec4 vCol;
void main() {
  vec4 clip = uVP * vec4(uCam + aStar.xyz * 400., 1.);
  clip.xy += uShift * clip.w;
  gl_Position = clip;
  float tw = .55 + .45 * sin(uTime * (.4 + aStar.w * 1.7) + aStar.w * 60.);
  float big = step(.965, aStar.w);
  gl_PointSize = (uPx / 1100.) * (1.1 + big * 1.5);
  float haze = smoothstep(.01, .16, aStar.y);
  vec3 tint = mix(vec3(.75, .84, 1.), vec3(1., .85, .6), step(.8, fract(aStar.w * 13.)));
  vCol = vec4(tint * tw * haze * (.5 + big * 1.1) * (1. - uStorm * .9), 1.);
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec4 vCol;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - .5);
  o = vCol * smoothstep(.5, .1, d);
}`;

const OCEAN_VS = `#version 300 es
layout(location = 0) in vec3 aPoint;
uniform mat4 uVP;
uniform vec2 uShift;
uniform vec3 uCam, uMoon;
uniform float uTime, uTravel, uAmp, uPx, uStorm, uFlash, uAssemble;
out vec4 vCol;
${WAVE_GLSL}
void main() {
  vec2 p = aPoint.xy;
  float seed = aPoint.z;
  float raw = wave(vec2(p.x - uTravel, p.y), uTime);
  float chop = sin(p.x * 3.1 + p.y * 2.3 + uTime * 2.6 + seed * 6.28) * .05 * uStorm;
  float h = raw * uAmp + chop;
  vec3 wp = vec3(p.x, h, p.y);
  vec4 clip = uVP * vec4(wp, 1.);
  clip.xy += uShift * clip.w;
  gl_Position = clip;

  float dist = clip.w;
  float crest = smoothstep(-.42, .5, raw);

  float u = (wp.x - .6) / 5.8;
  float beam = 1.62 * sqrt(clamp(1. - u * u, 0., 1.));
  float inHull = smoothstep(beam + .04, beam - .2, abs(wp.z)) * step(.01, beam);
  float ring = exp(-pow((abs(wp.z) - beam) / .42, 2.)) * smoothstep(0., .4, beam);
  float wx = wp.x - 6.1;
  float wake = wx > 0.
    ? exp(-wx * .055) * exp(-pow((abs(wp.z) - wx * .17 - .4) / (.35 + wx * .07), 2.))
    : 0.;
  float flick = .55 + .45 * sin(uTime * 2.4 + seed * 40.);

  float t = (wp.z - uCam.z) / uMoon.z;
  float side = (wp.x - uCam.x) - uMoon.x * t;
  float width = .35 + dist * .1;
  float glitter = exp(-side * side / (width * width));
  float spark = smoothstep(.35, 1., sin(uTime * 1.7 + seed * 80.) * .5 + .5);

  vec3 col = mix(vec3(.034, .105, .175), vec3(.120, .335, .440), crest);
  col *= 1. + uStorm * .5;
  col += vec3(1., .70, .34) * glitter * (.10 + crest * .35 + spark * .85) * (1. - uStorm * .85);
  col += vec3(.80, .92, .90) * (ring * .32 + wake * .5) * flick * smoothstep(.3, 1., uAssemble);
  float foam = smoothstep(.34, .62, raw) * uStorm;
  col += vec3(.75, .88, .92) * foam * (.4 + flick * .6);
  col += vec3(.55, .62, .85) * uFlash * (.25 + crest * .5);

  float fade = smoothstep(165., 60., dist) * smoothstep(1.5, 6., dist);
  float size = (.04 + crest * .02 + foam * .03 + wake * .025);
  gl_PointSize = clamp(uPx * size / dist, 1., 6.5);
  vCol = vec4(col * fade * (1. - inHull * smoothstep(.2, .9, uAssemble)), 1.);
}`;

const SHIP_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aInfo;
uniform mat4 uVP, uModel;
uniform vec2 uShift;
uniform vec3 uMouse;
uniform float uTime, uAssemble, uPx, uStorm, uFlash, uMouseForce, uPass, uXray, uHiAny, uAlpha;
uniform float uRegions[6];
out vec4 vCol;

vec3 hash3(float s) {
  return fract(vec3(s * 127.1, s * 269.5, s * 419.2) * 43.7585) * 2. - 1.;
}

void main() {
  int region = int(aInfo.x + .5);
  float seed = aInfo.y;
  int kind = int(aInfo.z + .5);
  float sway = aInfo.w;
  vec3 p = aPos;
  float wind = 1. + uStorm * 1.7;

  if (region == 5) {
    float fx = clamp((.95 - p.x) / 1.75, 0., 1.);
    p.z += sin(fx * 7.5 - uTime * 4.6) * fx * .24 * wind;
    p.y += sin(fx * 5. - uTime * 3.6) * fx * .10 * wind;
  } else {
    p.z += sway * .7 * (sin(p.y * .85 + uTime * 1.15 + p.x * .35) * .10
                      + sin(p.x * 1.4 - uTime * .8 + p.y * .6) * .05) * wind;
  }

  vec3 h = hash3(seed);
  vec3 scatter = vec3(p.x + h.x * 8., -.5 + h.y * .4, p.z + h.z * 8.);
  float k = clamp((uAssemble - seed * .62) / .38, 0., 1.);
  k = k * k * (3. - 2. * k);
  p = mix(scatter, p, k);

  vec3 d = p - uMouse;
  d.z *= .3;
  float m = exp(-dot(d, d) / 1.15) * uMouseForce;
  p += normalize(d + 1e-4) * m * (.14 + seed * .5);
  p.z += h.z * m * .45;

  vec4 wp = uModel * vec4(p, 1.);

  float reflectFade = 1.;
  if (uPass > 1.5) {
    float y = wp.y;
    wp.y = -y * .82;
    wp.x += sin(y * 2.3 + uTime * 1.6 + seed * 2.) * .05 * (1. + y * .6);
    wp.z += sin(y * 1.7 + uTime * 1.2) * .06;
    reflectFade = exp(-max(y, 0.) * .3);
  }

  vec4 clip = uVP * wp;
  clip.xy += uShift * clip.w;
  gl_Position = clip;

  float w = uRegions[region];
  float dist = clip.w;
  float shimmer = .82 + .18 * sin(uTime * 1.3 + seed * 30.);

  vec3 gold = vec3(1., .69, .27);
  vec3 cream = vec3(1., .85, .6);
  vec3 hot = vec3(.60, 1., .36);
  vec3 base = kind == 1 ? cream : gold;
  float alpha = kind == 0 ? 1. : kind == 1 ? .016 : kind == 2 ? .26 : 0.;
  float size = kind == 1 ? .1 : .019;
  if (kind == 1 && region == 1) alpha = .01 + max(sway - 1., 0.) * .03;

  if (kind == 3) {
    float pulse = .55 + .45 * sin(uTime * 1.6 + floor(p.x * 1.02) * 1.9 + floor(p.y * 1.7) * 2.3);
    alpha = uXray * (.5 + pulse);
    base = hot;
  }
  if (region == 5) {
    base = vec3(1., .13, .07);
    alpha = .42;
    size = .03;
  }

  if (uPass > .5 && uPass < 1.5) {
    bool solid = kind == 1 || region == 5;
    gl_PointSize = solid ? clamp(uPx * (region == 5 ? .05 : .13) / dist, 2., 30.) : 0.;
    if (!solid) gl_Position = vec4(2., 2., 2., 1.);
    float a = region == 1 ? .22 : region == 5 ? .9 : .5;
    a *= mix(1., .32, uHiAny * (1. - uRegions[region]));
    vCol = vec4(0., 0., 0., a * smoothstep(.55, 1., k) * uAlpha);
    return;
  }

  float focus = mix(mix(1., .17, uHiAny), kind == 1 ? .42 : 1.55, w);
  if (region == 5) focus = max(focus, .7);
  vec3 c = mix(base, hot, w * .92) * alpha * focus * shimmer;
  c *= 1. + uFlash * 1.7;
  c *= mix(.32, 1., smoothstep(.0, .55, k));
  c += vec3(1., .85, .55) * m * .35 * alpha;
  if (uPass > 1.5) c *= .2 * reflectFade;
  gl_PointSize = clamp(uPx * size * (1. + w * .25) / dist, 1., kind == 1 ? 22. : 7.);
  vCol = vec4(c * uAlpha, 1.);
}`;

const RAIN_VS = `#version 300 es
layout(location = 0) in vec3 aSeed;
uniform mat4 uVP;
uniform vec2 uShift;
uniform vec3 uCam;
uniform float uTime, uStorm;
out float vA;
void main() {
  vec3 box = vec3(74., 38., 46.);
  float speed = 30. + aSeed.z * 16.;
  vec3 s = aSeed * box;
  s.y = mod(s.y - uTime * speed, box.y);
  s.x = mod(s.x - uTime * speed * .42, box.x);
  vec3 wp = uCam + vec3(s.x - box.x * .5, s.y - box.y * .5 + 3., -s.z - 6.);
  if (gl_VertexID == 1) wp += vec3(.42, 1., 0.) * (.5 + aSeed.y * .5);
  vec4 clip = uVP * vec4(wp, 1.);
  clip.xy += uShift * clip.w;
  gl_Position = clip;
  vA = (.10 + aSeed.x * .22) * uStorm;
}`;

const RAIN_FS = `#version 300 es
precision mediump float;
in float vA;
out vec4 o;
void main() { o = vec4(vec3(.62, .74, .92) * vA, 1.); }`;

const BOLT_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
uniform vec2 uShift;
void main() {
  vec4 clip = uVP * vec4(aPos, 1.);
  clip.xy += uShift * clip.w;
  gl_Position = clip;
}`;

const BOLT_FS = `#version 300 es
precision mediump float;
uniform float uFlash;
out vec4 o;
void main() { o = vec4(vec3(2.4, 2.7, 3.6) * uFlash, 1.); }`;

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uPixel;
uniform float uKnee;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 4.;
  c += texture(uTex, vUv + uPixel * vec2(-1, -1)).rgb;
  c += texture(uTex, vUv + uPixel * vec2(1, -1)).rgb;
  c += texture(uTex, vUv + uPixel * vec2(-1, 1)).rgb;
  c += texture(uTex, vUv + uPixel * vec2(1, 1)).rgb;
  c /= 8.;
  if (uKnee > 0.) c *= smoothstep(uKnee, uKnee + .45, max(c.r, max(c.g, c.b)));
  o = vec4(c, 1.);
}`;

const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uPixel;
void main() {
  vec3 c = texture(uTex, vUv + uPixel * vec2(-2, 0)).rgb;
  c += texture(uTex, vUv + uPixel * vec2(2, 0)).rgb;
  c += texture(uTex, vUv + uPixel * vec2(0, -2)).rgb;
  c += texture(uTex, vUv + uPixel * vec2(0, 2)).rgb;
  c += texture(uTex, vUv + uPixel * vec2(-1, 1)).rgb * 2.;
  c += texture(uTex, vUv + uPixel * vec2(1, 1)).rgb * 2.;
  c += texture(uTex, vUv + uPixel * vec2(-1, -1)).rgb * 2.;
  c += texture(uTex, vUv + uPixel * vec2(1, -1)).rgb * 2.;
  o = vec4(c / 12., 1.);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene, uBloom;
uniform float uBloomAmt, uFade;
void main() {
  vec3 c = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomAmt;
  c = 1. - exp(-c * 1.3);
  vec2 v = vUv - .5;
  c *= 1. - dot(v, v) * .55;
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
  c += (n - .5) / 200.;
  o = vec4(c * uFade, 1.);
}`;

function compile(gl, vs, fs) {
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < total; i += 1) {
    const name = gl.getActiveUniform(program, i).name.replace("[0]", "");
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

function pointBuffer(gl, data, layout) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = layout.reduce((sum, size) => sum + size, 0) * 4;
  let offset = 0;
  layout.forEach((size, index) => {
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, size, gl.FLOAT, false, stride, offset);
    offset += size * 4;
  });
  gl.bindVertexArray(null);
  return vao;
}

function createTarget(gl, width, height, internal, format, type) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

function destroyTarget(gl, target) {
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

export function initShip(canvas, options = {}) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const zone = options.zone || canvas;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const weak = coarse && (navigator.hardwareConcurrency || 4) <= 4;

  const hdrExtension = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const hdrFormat = [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT];
  let hdrReady = false;
  if (hdrExtension) {
    const probe = createTarget(gl, 4, 4, ...hdrFormat);
    gl.bindFramebuffer(gl.FRAMEBUFFER, probe.framebuffer);
    hdrReady = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    destroyTarget(gl, probe);
  }
  const targetFormat = hdrReady ? hdrFormat : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];

  const programs = {
    sky: compile(gl, FULLSCREEN_VS, SKY_FS),
    stars: compile(gl, STARS_VS, POINT_FS),
    ocean: compile(gl, OCEAN_VS, POINT_FS),
    ship: compile(gl, SHIP_VS, POINT_FS),
    rain: compile(gl, RAIN_VS, RAIN_FS),
    bolt: compile(gl, BOLT_VS, BOLT_FS),
    down: compile(gl, FULLSCREEN_VS, DOWN_FS),
    up: compile(gl, FULLSCREEN_VS, UP_FS),
    composite: compile(gl, FULLSCREEN_VS, COMPOSITE_FS),
  };

  const emptyVao = gl.createVertexArray();
  const oceanSize = coarse ? [190, 110] : [330, 170];
  const oceanCount = oceanSize[0] * oceanSize[1];
  const oceanVao = pointBuffer(gl, buildOcean(...oceanSize), [3]);
  const starCount = coarse ? 700 : 1500;
  const starVao = pointBuffer(gl, buildStars(starCount), [4]);

  const rainCount = coarse ? 600 : 1500;
  const rainData = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainData.length; i += 1) rainData[i] = Math.random();
  const rainVao = gl.createVertexArray();
  gl.bindVertexArray(rainVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, rainData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.bindVertexArray(null);

  const boltBuffer = gl.createBuffer();
  const boltVao = gl.createVertexArray();
  gl.bindVertexArray(boltVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, boltBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3 * 800), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let boltVertices = 0;

  const boat = buildBoat();
  const boatVao = pointBuffer(gl, boat.data, [3, 4]);

  let shipVao = null;
  let shipCount = 0;
  let assemble = reduced ? 1 : 0;
  let assembleStart = 0;

  const image = new Image();
  image.src = options.image || "/hero-ship.webp";
  image
    .decode()
    .then(() => {
      const cloud = buildShipCloud(
        image,
        coarse
          ? { line: 0.5, fill: 0.07, ghost: 0.2 }
          : { line: 0.92, fill: 0.13, ghost: 0.34 }
      );
      shipVao = pointBuffer(gl, cloud.data, [3, 4]);
      shipCount = cloud.count;
      assembleStart = performance.now();
      if (reduced) requestRender();
    })
    .catch(() => {
      options.onError?.();
    });

  let width = 1;
  let height = 1;
  let renderScale = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75);
  let bloomOn = !weak;
  let detail = !weak;
  let lod = 1;
  let scene = null;
  let chain = [];

  const allocate = () => {
    if (scene) destroyTarget(gl, scene);
    chain.forEach((target) => destroyTarget(gl, target));
    scene = createTarget(gl, width, height, ...targetFormat);
    chain = [];
    let w = width;
    let h = height;
    for (let i = 0; i < 4; i += 1) {
      w = Math.max(2, w >> 1);
      h = Math.max(2, h >> 1);
      chain.push(createTarget(gl, w, h, ...targetFormat));
    }
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const nextW = Math.max(2, Math.round(rect.width * renderScale));
    const nextH = Math.max(2, Math.round(rect.height * renderScale));
    if (nextW === width && nextH === height) return;
    width = nextW;
    height = nextH;
    canvas.width = width;
    canvas.height = height;
    allocate();
    measure();
    requestRender();
  };

  let anchors = [];
  const measure = () => {
    const vh = window.innerHeight;
    anchors = [...document.querySelectorAll("[data-scene-key]")]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const y = el.dataset.sceneKey === "hero" ? 0 : top + rect.height / 2 - vh / 2;
        return { y, key: KEYS[el.dataset.sceneKey] };
      })
      .sort((a, b) => a.y - b.y);
  };

  const emptyRegions = () => [0, 0, 0, 0, 0, 0];
  const keyState = (key, narrow, fit) => {
    const regions = emptyRegions();
    if (key.hi !== undefined) regions[key.hi] = 1;
    if (key.hi === REGION.hold) regions[REGION.hull] = 0.16;
    const shift = narrow ? key.nShift : key.shift;
    return {
      yaw: key.yaw,
      pitch: key.pitch,
      dist: key.dist * (narrow ? key.nDist : 1) * fit,
      lx: key.look[0],
      ly: key.look[1],
      lz: key.look[2],
      sx: shift[0],
      sy: shift[1],
      storm: key.storm || 0,
      xray: key.xray || 0,
      boat: key.boat || 0,
      hiAny: key.hi !== undefined ? 1 : 0,
      r0: regions[0],
      r1: regions[1],
      r2: regions[2],
      r3: regions[3],
      r4: regions[4],
    };
  };

  const scrollTarget = () => {
    const aspect = width / height;
    const narrow = aspect < 1.05;
    const fit = narrow ? clamp(1.5 / aspect, 1, 3.4) : clamp(1.5 / aspect, 0.9, 1.25);
    const y = window.scrollY;
    if (!anchors.length) return keyState(KEYS.hero, narrow, fit);
    let a = anchors[0];
    let b = anchors[0];
    for (let i = 0; i < anchors.length; i += 1) {
      a = anchors[i];
      b = anchors[Math.min(i + 1, anchors.length - 1)];
      if (y < b.y || i === anchors.length - 1) break;
    }
    const raw = b.y > a.y ? clamp((y - a.y) / (b.y - a.y)) : 0;
    const t = smooth(clamp((raw - 0.18) / 0.64));
    const from = keyState(a.key, narrow, fit);
    const to = keyState(b.key, narrow, fit);
    const out = {};
    for (const name of Object.keys(from)) out[name] = lerp(from[name], to[name], t);
    return out;
  };

  let state = null;
  let pointerX = 0;
  let pointerY = 0;
  let pointerSeen = false;
  let parallaxX = 0;
  let parallaxY = 0;
  let mouseForce = 0;
  let mouseWorld = [0, 100, 0];

  if (!coarse && !reduced) {
    window.addEventListener(
      "pointermove",
      (event) => {
        pointerX = (event.clientX / window.innerWidth) * 2 - 1;
        pointerY = 1 - (event.clientY / window.innerHeight) * 2;
        pointerSeen = true;
      },
      { passive: true }
    );
    document.documentElement.addEventListener("pointerleave", () => {
      pointerSeen = false;
    });
  }

  let heave = 0;
  let pitch = 0;
  let roll = 0;
  let flash = 0;
  let nextBolt = 2;
  let stormWanted = 0;
  let stormExtra = 0;
  const started = performance.now();
  let last = started;
  let fade = reduced ? 1 : 0;

  const stats = { fps: 0, points: 0, ready: false };
  let frames = 0;
  let framesStart = started;
  let slowWindows = 0;

  const spawnBolt = (shipX) => {
    const verts = [];
    const segment = (x, y, z, steps, spread, branchChance) => {
      let px = x;
      let py = y;
      for (let i = 0; i < steps && verts.length < 2300; i += 1) {
        const nx = px + (Math.random() - 0.5) * spread + spread * 0.08;
        const ny = py - (1.1 + Math.random() * 1.5);
        verts.push(px, py, z, nx, ny, z);
        if (Math.random() < branchChance) segment(nx, ny, z, Math.ceil(steps * 0.3), spread * 0.75, 0);
        px = nx;
        py = ny;
        if (py < 0) break;
      }
    };
    segment(shipX + (Math.random() - 0.5) * 34, 24, -46, 22, 3.4, 0.2);
    boltVertices = verts.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, boltBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(verts));
  };

  const use = (entry) => {
    gl.useProgram(entry.program);
    return entry.uniforms;
  };

  const pass = (source, target, program, extra) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    const u = use(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uPixel, 0.5 / source.width, 0.5 / source.height);
    extra?.(u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const render = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const time = reduced ? 8 : (now - started) / 1000;

    const target = scrollTarget();
    if (!state || reduced) state = target;
    else {
      const k = 1 - Math.exp(-dt * 4.2);
      for (const name of Object.keys(state)) state[name] += (target[name] - state[name]) * k;
    }
    if (shipCount && !reduced) {
      assemble = clamp((now - assembleStart) / 3400);
    }
    if (!reduced) fade = clamp((now - started) / 1000);

    stormExtra += (stormWanted - stormExtra) * (1 - Math.exp(-dt * 1.8));
    const storm = Math.max(state.storm, stormExtra);
    const amp = 1 + storm * 4.2;
    const travel = time * 1.25;

    const w = (x, z) => wave(x - travel, z, time);
    const nextHeave = ((w(-3, 0) + w(3, 0) + w(0, 1.3) + w(0, -1.3)) / 4) * amp * 0.82;
    const nextPitch = (w(4.6, 0) - w(-4.6, 0)) * amp * 0.05 + Math.sin(time * 0.9) * storm * 0.035;
    const nextRoll = (w(0, 1.5) - w(0, -1.5)) * amp * 0.1 + Math.sin(time * 0.74) * (0.012 + storm * 0.07);
    const settle = reduced ? 1 : 1 - Math.exp(-dt * 2.4);
    heave += (nextHeave - heave) * settle;
    pitch += (nextPitch - pitch) * settle;
    roll += (nextRoll - roll) * settle;

    parallaxX += ((pointerSeen ? pointerX : 0) - parallaxX) * (1 - Math.exp(-dt * 2.2));
    parallaxY += ((pointerSeen ? pointerY : 0) - parallaxY) * (1 - Math.exp(-dt * 2.2));

    const yaw = state.yaw + parallaxX * 0.075;
    const elev = state.pitch + parallaxY * 0.02;
    const look = [state.lx, state.ly, state.lz];
    const eye = [
      look[0] + Math.sin(yaw) * Math.cos(elev) * state.dist,
      Math.max(look[1] + Math.sin(elev) * state.dist, 1.1 + storm * 2.2),
      look[2] + Math.cos(yaw) * Math.cos(elev) * state.dist,
    ];
    const aspect = width / height;
    const proj = perspective(FOV, aspect, 0.5, 900);
    const view = lookAt(eye, look);
    const vp = multiply(proj, view);
    const inv = invert(vp);
    const shift = [state.sx, state.sy];
    const px = height / (2 * Math.tan(FOV / 2));

    const model = shipMatrix(heave, pitch, roll, 0.6);

    if (pointerSeen) {
      const unproject = (z) => {
        const x = inv[0] * (pointerX - shift[0]) + inv[4] * (pointerY - shift[1]) + inv[8] * z + inv[12];
        const y = inv[1] * (pointerX - shift[0]) + inv[5] * (pointerY - shift[1]) + inv[9] * z + inv[13];
        const zz = inv[2] * (pointerX - shift[0]) + inv[6] * (pointerY - shift[1]) + inv[10] * z + inv[14];
        const ww = inv[3] * (pointerX - shift[0]) + inv[7] * (pointerY - shift[1]) + inv[11] * z + inv[15];
        return [x / ww, y / ww, zz / ww];
      };
      const a = unproject(-1);
      const b = unproject(1);
      const t = a[2] / (a[2] - b[2]);
      mouseWorld = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), 0];
    }
    mouseForce += ((pointerSeen ? 1 : 0) - mouseForce) * (1 - Math.exp(-dt * 3));

    if (!reduced) {
      flash *= Math.exp(-dt * 7);
      nextBolt -= dt;
      if (storm > 0.5 && nextBolt <= 0) {
        flash = 1;
        spawnBolt(look[0]);
        nextBolt = 1.8 + Math.random() * 3.6;
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    let u = use(programs.sky);
    gl.bindVertexArray(emptyVao);
    gl.uniformMatrix4fv(u.uInvVP, false, inv);
    gl.uniform2fv(u.uShift, shift);
    gl.uniform3fv(u.uCam, eye);
    gl.uniform3fv(u.uMoon, MOON_DIR);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uStorm, storm);
    gl.uniform1f(u.uFlash, flash);
    gl.uniform1f(u.uDetail, detail ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    u = use(programs.stars);
    gl.bindVertexArray(starVao);
    gl.uniformMatrix4fv(u.uVP, false, vp);
    gl.uniform2fv(u.uShift, shift);
    gl.uniform3fv(u.uCam, eye);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uPx, px);
    gl.uniform1f(u.uStorm, storm);
    gl.drawArrays(gl.POINTS, 0, starCount);

    u = use(programs.ocean);
    gl.bindVertexArray(oceanVao);
    gl.uniformMatrix4fv(u.uVP, false, vp);
    gl.uniform2fv(u.uShift, shift);
    gl.uniform3fv(u.uCam, eye);
    gl.uniform3fv(u.uMoon, MOON_DIR);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uTravel, travel);
    gl.uniform1f(u.uAmp, amp);
    gl.uniform1f(u.uPx, px);
    gl.uniform1f(u.uStorm, storm);
    gl.uniform1f(u.uFlash, flash);
    gl.uniform1f(u.uAssemble, assemble);
    const oceanDraw = Math.floor(oceanCount * lod);
    gl.drawArrays(gl.POINTS, 0, oceanDraw);

    let visiblePoints = oceanDraw + starCount;

    if (boltVertices && flash > 0.12) {
      u = use(programs.bolt);
      gl.bindVertexArray(boltVao);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform2fv(u.uShift, shift);
      gl.uniform1f(u.uFlash, flash);
      gl.drawArrays(gl.LINES, 0, boltVertices);
    }

    const shipUniforms = (uniforms, passId, alpha, matrix) => {
      gl.uniformMatrix4fv(uniforms.uVP, false, vp);
      gl.uniformMatrix4fv(uniforms.uModel, false, matrix);
      gl.uniform2fv(uniforms.uShift, shift);
      gl.uniform3fv(uniforms.uMouse, mouseWorld);
      gl.uniform1f(uniforms.uTime, time);
      gl.uniform1f(uniforms.uAssemble, assemble);
      gl.uniform1f(uniforms.uPx, px);
      gl.uniform1f(uniforms.uStorm, storm);
      gl.uniform1f(uniforms.uFlash, flash);
      gl.uniform1f(uniforms.uMouseForce, mouseForce);
      gl.uniform1f(uniforms.uPass, passId);
      gl.uniform1f(uniforms.uXray, state.xray);
      gl.uniform1f(uniforms.uHiAny, state.hiAny);
      gl.uniform1f(uniforms.uAlpha, alpha);
      gl.uniform1fv(uniforms.uRegions, [state.r0, state.r1, state.r2, state.r3, state.r4, 0]);
    };

    if (shipVao) {
      u = use(programs.ship);
      gl.bindVertexArray(shipVao);
      const shipDraw = Math.floor(shipCount * lod);

      shipUniforms(u, 2, 1, model);
      gl.drawArrays(gl.POINTS, 0, Math.floor(shipDraw * 0.6));

      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      shipUniforms(u, 1, 1, model);
      gl.drawArrays(gl.POINTS, 0, shipDraw);

      gl.blendFunc(gl.ONE, gl.ONE);
      shipUniforms(u, 0, 1, model);
      gl.drawArrays(gl.POINTS, 0, shipDraw);
      visiblePoints += shipDraw;
    }

    if (state.boat > 0.01) {
      u = use(programs.ship);
      gl.bindVertexArray(boatVao);
      const out = smooth(clamp(state.boat));
      const bx = lerp(-3.4, -6.4, out);
      const bz = lerp(1.6, 4.1, out);
      const bh = wave(bx - travel, bz, time) * amp * 0.95;
      const bp = (wave(bx + 1 - travel, bz, time) - wave(bx - 1 - travel, bz, time)) * 0.22;
      const br = (wave(bx - travel, bz + 0.6, time) - wave(bx - travel, bz - 0.6, time)) * 0.3;
      const bm = shipMatrix(bh, bp, br, 0);
      bm[12] += bx;
      bm[14] += bz;
      shipUniforms(u, 0, state.boat, bm);
      gl.uniform1f(u.uAssemble, 1);
      gl.drawArrays(gl.POINTS, 0, boat.count);
      visiblePoints += boat.count;
    }

    if (storm > 0.02) {
      u = use(programs.rain);
      gl.bindVertexArray(rainVao);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform2fv(u.uShift, shift);
      gl.uniform3fv(u.uCam, eye);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uStorm, storm);
      gl.drawArraysInstanced(gl.LINES, 0, 2, rainCount);
    }

    gl.disable(gl.BLEND);
    gl.bindVertexArray(emptyVao);

    if (bloomOn) {
      let source = scene;
      chain.forEach((level, index) => {
        pass(source, level, programs.down, (uniforms) => gl.uniform1f(uniforms.uKnee, index === 0 ? 0.3 : 0));
        source = level;
      });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = chain.length - 1; i > 0; i -= 1) pass(chain[i], chain[i - 1], programs.up);
      gl.disable(gl.BLEND);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    u = use(programs.composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.texture);
    gl.uniform1i(u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, chain[0].texture);
    gl.uniform1i(u.uBloom, 1);
    gl.uniform1f(u.uBloomAmt, bloomOn ? 0.42 : 0);
    gl.uniform1f(u.uFade, fade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    frames += 1;
    if (now - framesStart >= 1000) {
      const fps = Math.round((frames * 1000) / (now - framesStart));
      const throttled = fps < 4;
      if (!throttled) stats.fps = fps;
      stats.points = visiblePoints;
      stats.ready = !!shipVao;
      options.onStats?.(stats);
      // Слабая видеокарта: сначала снижаем разрешение, потом выключаем свечение и частицы.
      if (!throttled && fps < 38 && now - started > 6000 && shipVao) {
        slowWindows += 1;
        if (slowWindows >= 3) {
          slowWindows = 0;
          if (renderScale > 0.95) {
            renderScale *= 0.8;
            resize();
          } else if (bloomOn) {
            bloomOn = false;
            detail = false;
          } else if (lod > 0.45) {
            lod *= 0.75;
          }
        }
      } else {
        slowWindows = 0;
      }
      frames = 0;
      framesStart = now;
    }
  };

  let raf = 0;
  let active = false;
  let visible = true;

  // На телефонах с экраном 120 Гц незачем тратить батарею: сцене хватает 60 кадров.
  const frameGap = coarse ? 15 : 0;
  let lastFrame = 0;
  const loop = (now) => {
    raf = 0;
    if (!active) return;
    if (now - lastFrame >= frameGap) {
      lastFrame = now;
      render(now);
    }
    raf = requestAnimationFrame(loop);
  };

  const setActive = (next) => {
    if (reduced) {
      active = false;
      return;
    }
    if (next === active) return;
    active = next;
    if (active) {
      last = performance.now();
      framesStart = last;
      frames = 0;
      if (!raf) raf = requestAnimationFrame(loop);
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  let pending = false;
  function requestRender() {
    if (!reduced || pending || !scene) return;
    pending = true;
    requestAnimationFrame((now) => {
      pending = false;
      render(now);
    });
  }

  resize();
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener("load", measure);
  document.fonts?.ready.then(measure);
  window.addEventListener("resize", measure, { passive: true });
  window.addEventListener("scroll", requestRender, { passive: true });

  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      setActive(visible && !document.hidden);
    },
    { rootMargin: "120px" }
  ).observe(zone);

  document.addEventListener("visibilitychange", () => setActive(visible && !document.hidden));

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    setActive(false);
    options.onError?.();
  });

  setActive(!document.hidden);
  requestRender();
  return {
    stats,
    refresh: measure,
    setStorm(value) {
      stormWanted = reduced ? 0 : value;
    },
  };
}
