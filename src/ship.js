import { REGION, buildBoat, buildShipCloud, clamp, lerp, smooth } from "./ship-cloud.js";

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
const MOON_X = normalize([MOON_DIR[2], 0, -MOON_DIR[0]]);
const MOON_Y = [
  MOON_DIR[1] * MOON_X[2] - MOON_DIR[2] * MOON_X[1],
  MOON_DIR[2] * MOON_X[0] - MOON_DIR[0] * MOON_X[2],
  MOON_DIR[0] * MOON_X[1] - MOON_DIR[1] * MOON_X[0],
];
const MOON_AZ = (() => {
  const [x, , z] = normalize([MOON_DIR[0], 0, MOON_DIR[2]]);
  return [x, z];
})();
const FOV = (30 * Math.PI) / 180;

// Яркость линии складывается из её точек. На телефоне линии прорежены, поэтому каждая точка светит
// сильнее (thin), а изображение остаётся таким же светлым, как на компьютере.
const DESKTOP_PROFILE = {
  density: { line: 0.92, fill: 0.13, ghost: 0.34, deck: 1 },
  thin: 1,
  oceanGain: 1,
  dim: 0.17,
  lineSize: 1,
  knee: 0.3,
  halfSky: false,
  bloomFirst: 1,
  bloomLevels: 4,
};
const PHONE_PROFILE = {
  density: { line: 0.62, fill: 0.11, ghost: 0.34, deck: 0.39 },
  thin: 3,
  oceanGain: 1,
  dim: 0.17,
  lineSize: 1,
  knee: 0.3,
  // Небо мягкое, поэтому считаем его в половинном разрешении и растягиваем на весь кадр.
  halfSky: true,
  // Свечение считаем сразу с четверти экрана: радиус тот же, работы втрое меньше.
  bloomFirst: 2,
  bloomLevels: 3,
};

// Ступени качества сверху вниз. scale ограничен плотностью экрана, reflect — доля точек в отражении,
// gap — минимальная пауза между кадрами в мс: 28 даёт 30 кадров в секунду.
const DESKTOP_LEVELS = [
  { scale: 1.75, lod: 1, bloom: true, clouds: true, reflect: 0.6, gap: 0 },
  { scale: 1.4, lod: 1, bloom: true, clouds: true, reflect: 0.6, gap: 0 },
  { scale: 1.12, lod: 1, bloom: true, clouds: true, reflect: 0.6, gap: 0 },
  { scale: 0.9, lod: 1, bloom: true, clouds: true, reflect: 0.6, gap: 0 },
  { scale: 0.9, lod: 1, bloom: false, clouds: false, reflect: 0.6, gap: 0 },
  { scale: 0.9, lod: 0.7, bloom: false, clouds: false, reflect: 0.3, gap: 28 },
];
const PHONE_LEVELS = [
  { scale: 1.5, lod: 1, bloom: true, clouds: true, reflect: 0.35, gap: 15 },
  { scale: 1.25, lod: 1, bloom: true, clouds: true, reflect: 0.35, gap: 15 },
  { scale: 1.25, lod: 0.85, bloom: true, clouds: true, reflect: 0.25, gap: 28 },
  { scale: 1, lod: 0.85, bloom: true, clouds: false, reflect: 0.25, gap: 28 },
  { scale: 0.85, lod: 0.65, bloom: false, clouds: false, reflect: 0, gap: 28 },
];

function normalize([x, y, z]) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
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
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

const SKY_VS = `#version 300 es
uniform mat4 uInvVP;
uniform vec2 uShift;
out vec4 vFar;
void main() {
  vec2 ndc = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2. - 1.;
  vFar = uInvVP * vec4(ndc - uShift, 1., 1.);
  gl_Position = vec4(ndc, 0., 1.);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec4 vFar;
out vec4 o;
uniform mediump sampler2D uNoise;
uniform vec3 uCam, uMoon, uMoonX, uMoonY;
uniform vec2 uMoonAz;
uniform float uTime, uStorm, uFlash, uDetail;

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return texture(uNoise, (i + f + .5) / 256.).r;
}
float fbm(vec2 p) {
  float a = .5, s = 0.;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(11.3, 7.1); a *= .5; }
  return s;
}

void main() {
  vec3 dir = normalize(vFar.xyz / vFar.w - uCam);
  float h = dir.y;
  float up = max(h, 0.);

  vec3 col = mix(vec3(.058, .105, .165), vec3(.020, .040, .082), smoothstep(0., .15, up));
  col = mix(col, vec3(.006, .012, .030), smoothstep(.1, .6, up));
  if (h < 0.) col = mix(vec3(.042, .08, .125), vec3(.005, .011, .022), smoothstep(0., .2, -h));

  float toMoon = dot(dir, uMoon);
  float md = sqrt(max(2. - 2. * toMoon, 0.));
  if (abs(h) < .45) {
    float az = max(dot(normalize(dir.xz + 1e-4), uMoonAz), 0.);
    float az2 = az * az;
    float az4 = az2 * az2;
    float az8 = az4 * az4;
    col += vec3(.34, .22, .10) * az8 * az8 * az4 * az2 * exp(-abs(h) * 13.) * .7;
  }
  col += vec3(.95, .74, .42) * (exp(-md * 5.2) * .075 + exp(-md * 15.) * .16);

  const float R = .098;
  vec2 q = vec2(dot(dir, uMoonX), dot(dir, uMoonY)) / R;
  float rr = dot(q, q);
  float storm = smoothstep(.0, .8, uStorm);
  if (rr < 1. && toMoon > 0.) {
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
uniform float uTime, uTravel, uAmp, uPx, uStorm, uFlash, uAssemble, uGain;
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
  vCol = vec4(col * fade * uGain * (1. - inHull * smoothstep(.2, .9, uAssemble)), 1.);
}`;

const SHIP_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aInfo;
uniform mat4 uVP, uModel;
uniform vec2 uShift;
uniform vec3 uMouse;
uniform float uTime, uAssemble, uPx, uStorm, uFlash, uMouseForce, uPass, uXray, uHiAny, uAlpha, uGain, uThin, uDim, uLineSize;
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

  float m = 0.;
  if (uMouseForce > .001) {
    vec3 d = p - uMouse;
    d.z *= .3;
    m = exp(-dot(d, d) / 1.15) * uMouseForce;
    p += normalize(d + 1e-4) * m * (.14 + seed * .5);
    p.z += h.z * m * .45;
  }

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
  float size = kind == 1 ? .1 : .019 * uLineSize;
  if (kind == 1 && region == 1) alpha = .01 + max(sway - 1., 0.) * .03;

  if (kind == 3) {
    float pulse = .55 + .45 * sin(uTime * 1.6 + floor(p.x * 1.02) * 1.9 + floor(p.y * 1.7) * 2.3);
    alpha = uXray * (.5 + pulse);
    base = hot;
  }
  if (region == 5) {
    base = vec3(1., .13, .07);
    alpha = .42;
    size = .03 * uLineSize;
  }

  float gain = uGain * (region >= 4 || kind == 3 ? 1. : uThin);

  // Проход с тенью: сюда приходят только заливка и флаг.
  if (uPass > .5 && uPass < 1.5) {
    gl_PointSize = clamp(uPx * (region == 5 ? .05 : .13) / dist, 2., 30.);
    float a = region == 1 ? .22 : region == 5 ? .9 : .5;
    a *= mix(1., .32, uHiAny * (1. - uRegions[region]));
    a = 1. - pow(1. - a, gain);
    vCol = vec4(0., 0., 0., a * smoothstep(.55, 1., k) * uAlpha);
    return;
  }

  float focus = mix(mix(1., uDim, uHiAny), kind == 1 ? .42 : 1.55, w);
  if (region == 5) focus = max(focus, .7);
  vec3 c = mix(base, hot, w * .92) * alpha * focus * shimmer * gain;
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
precision mediump float;
in highp vec2 vUv;
out vec4 o;
uniform mediump sampler2D uTex;
uniform highp vec2 uPixel;
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
precision mediump float;
in highp vec2 vUv;
out vec4 o;
uniform mediump sampler2D uTex;
uniform highp vec2 uPixel;
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

const COPY_FS = `#version 300 es
precision mediump float;
in highp vec2 vUv;
out vec4 o;
uniform mediump sampler2D uTex;
void main() { o = texture(uTex, vUv); }`;

const COMPOSITE_FS = `#version 300 es
precision mediump float;
in highp vec2 vUv;
out vec4 o;
uniform mediump sampler2D uScene, uBloom;
uniform float uBloomAmt, uFade, uWhite;
void main() {
  vec3 c = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomAmt;
  c = (1. - exp(-c * 1.3)) * uWhite;
  vec2 v = vUv - .5;
  c *= 1. - dot(v, v) * .55;
  highp float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
  c += (n - .5) / 200.;
  o = vec4(c * uFade, 1.);
}`;

// Шейдеры собираются в фоне: результат проверяем, только когда сборка закончена.
function compile(gl, vs, fs) {
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram();
  const vertex = shader(gl.VERTEX_SHADER, vs);
  const fragment = shader(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return { program, vertex, fragment, uniforms: {} };
}

function finishProgram(gl, entry) {
  const { program, vertex, fragment, uniforms } = entry;
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || gl.getShaderInfoLog(vertex) || gl.getShaderInfoLog(fragment));
  }
  const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < total; i += 1) {
    const name = gl.getActiveUniform(program, i).name.replace("[0]", "");
    uniforms[name] = gl.getUniformLocation(program, name);
  }
}

function noiseTexture(gl) {
  const size = 256;
  const data = new Uint8Array(size * size);
  let seed = 48271;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 16807) % 2147483647;
    data[i] = seed & 255;
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return texture;
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
  const dpr = window.devicePixelRatio || 1;
  const profile = coarse ? PHONE_PROFILE : DESKTOP_PROFILE;
  const LEVELS = (coarse ? PHONE_LEVELS : DESKTOP_LEVELS).filter(
    (q, i, all) =>
      i === 0 ||
      Math.min(dpr, q.scale) !== Math.min(dpr, all[i - 1].scale) ||
      q.lod !== all[i - 1].lod ||
      q.bloom !== all[i - 1].bloom ||
      q.clouds !== all[i - 1].clouds ||
      q.gap !== all[i - 1].gap
  );
  const COLOR = [gl.COLOR_ATTACHMENT0];

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
    sky: compile(gl, SKY_VS, SKY_FS),
    stars: compile(gl, STARS_VS, POINT_FS),
    ocean: compile(gl, OCEAN_VS, POINT_FS),
    ship: compile(gl, SHIP_VS, POINT_FS),
    rain: compile(gl, RAIN_VS, RAIN_FS),
    bolt: compile(gl, BOLT_VS, BOLT_FS),
    down: compile(gl, FULLSCREEN_VS, DOWN_FS),
    up: compile(gl, FULLSCREEN_VS, UP_FS),
    copy: compile(gl, FULLSCREEN_VS, COPY_FS),
    composite: compile(gl, FULLSCREEN_VS, COMPOSITE_FS),
  };
  const parallelCompile = gl.getExtension("KHR_parallel_shader_compile");
  let linked = false;

  const noise = noiseTexture(gl);
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
  let shipSolids = 0;
  let shipXray = 0;
  let assemble = reduced ? 1 : 0;
  let assembleStart = 0;

  const useCloud = (cloud) => {
    shipVao = pointBuffer(gl, cloud.data, [3, 4]);
    shipCount = cloud.count;
    shipSolids = cloud.solids;
    shipXray = cloud.xray;
    if (reduced) requestRender();
  };

  const maskUrl = coarse ? "/hero-ship-mask-1024.webp" : "/hero-ship-mask.webp";
  const buildHere = () => {
    const image = new Image();
    image.src = maskUrl;
    image
      .decode()
      .then(() => useCloud(buildShipCloud(image, profile.density)))
      .catch(() => options.onError?.());
  };

  // Корабль считается в отдельном потоке, чтобы страница в это время откликалась.
  if (typeof Worker === "function" && typeof OffscreenCanvas === "function") {
    const worker = new Worker(new URL("./ship-cloud.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.failed) buildHere();
      else useCloud(data);
    };
    worker.onerror = () => {
      worker.terminate();
      buildHere();
    };
    worker.postMessage({ url: new URL(maskUrl, window.location.href).href, density: profile.density });
  } else {
    buildHere();
  }

  let width = 1;
  let height = 1;
  let level = 0;
  let renderScale = Math.min(dpr, LEVELS[0].scale);
  let scene = null;
  let sky = null;
  let chain = [];

  const allocate = () => {
    if (scene) destroyTarget(gl, scene);
    if (sky) destroyTarget(gl, sky);
    chain.forEach((target) => destroyTarget(gl, target));
    scene = createTarget(gl, width, height, ...targetFormat);
    sky = profile.halfSky ? createTarget(gl, Math.max(2, width >> 1), Math.max(2, height >> 1), ...targetFormat) : null;
    chain = [];
    let w = width;
    let h = height;
    for (let i = 0; i < profile.bloomLevels; i += 1) {
      const shift = i === 0 ? profile.bloomFirst : 1;
      w = Math.max(2, w >> shift);
      h = Math.max(2, h >> shift);
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
  let started = performance.now();
  let last = started;
  let fade = reduced ? 1 : 0;

  const stats = { fps: 0, points: 0, ready: false };
  let frames = 0;
  let framesStart = started;

  // Сколько проходит от начала кадра до момента, когда видеокарта его дорисовала.
  // Замер не останавливает страницу: результат забираем, когда он готов.
  const gpuTimes = [];
  let fence = null;
  const measureGpu = (frameStart) => {
    if (fence) return;
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    let unfinished = performance.now();
    const poll = () => {
      if (!fence) return;
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) {
        unfinished = performance.now();
        window.setTimeout(poll, 2);
        return;
      }
      gl.deleteSync(fence);
      fence = null;
      // Таймер мог опоздать сам по себе, поэтому считаем только время, когда кадр точно ещё рисовался.
      if (status !== gl.WAIT_FAILED) gpuTimes.push(unfinished - frameStart);
    };
    window.setTimeout(poll, 1);
  };

  const setLevel = (next) => {
    level = next;
    const scale = Math.min(dpr, LEVELS[level].scale);
    if (scale !== renderScale) {
      renderScale = scale;
      resize();
    }
  };

  // Снижаем качество, только если кадров мало и упираемся именно в видеокарту:
  // браузер в режиме экономии сам ограничивает частоту кадров, и картинку это портить не должно.
  // Когда нагрузка спадает, качество возвращается. Если устройство снова не справилось,
  // выше этой ступени сцена больше не поднимается.
  let calmWindows = 0;
  let climbed = false;
  let ceiling = 0;
  const adjustQuality = (fps) => {
    const wanted = LEVELS[level].gap >= 28 ? 30 : 60;
    const sorted = gpuTimes.splice(0).sort((a, b) => a - b);
    const gpu = sorted.length ? sorted[sorted.length >> 1] : Infinity;
    const budget = (1000 / wanted) * 0.62;
    const enoughFrames = fps >= wanted * 0.88;
    if (!enoughFrames && gpu >= budget && level < LEVELS.length - 1) {
      const over = gpu / budget;
      if (climbed) ceiling = Math.max(ceiling, level + 1);
      setLevel(Math.min(level + (over > 4 ? 3 : over > 2 ? 2 : 1), LEVELS.length - 1));
      calmWindows = 0;
      return;
    }
    calmWindows = enoughFrames && gpu < budget * 0.45 ? calmWindows + 1 : 0;
    if (calmWindows >= 4 && level > ceiling) {
      setLevel(level - 1);
      climbed = true;
      calmWindows = 0;
    }
  };

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
    const frameStart = performance.now();
    const quality = LEVELS[level];
    const lod = quality.lod;
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
      if (!assembleStart) assembleStart = now;
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

    const skyTarget = sky || scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, skyTarget.framebuffer);
    gl.invalidateFramebuffer(gl.FRAMEBUFFER, COLOR);
    gl.viewport(0, 0, skyTarget.width, skyTarget.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    let u = use(programs.sky);
    gl.bindVertexArray(emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, noise);
    gl.uniform1i(u.uNoise, 0);
    gl.uniformMatrix4fv(u.uInvVP, false, inv);
    gl.uniform2fv(u.uShift, shift);
    gl.uniform3fv(u.uCam, eye);
    gl.uniform3fv(u.uMoon, MOON_DIR);
    gl.uniform3fv(u.uMoonX, MOON_X);
    gl.uniform3fv(u.uMoonY, MOON_Y);
    gl.uniform2fv(u.uMoonAz, MOON_AZ);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uStorm, storm);
    gl.uniform1f(u.uFlash, flash);
    gl.uniform1f(u.uDetail, quality.clouds ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (sky) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.framebuffer);
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, COLOR);
      gl.viewport(0, 0, width, height);
      u = use(programs.copy);
      gl.bindTexture(gl.TEXTURE_2D, sky.texture);
      gl.uniform1i(u.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

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
    gl.uniform1f(u.uGain, profile.oceanGain / lod);
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

    const shipGain = quality.bloom ? 1 : 1.2;
    const shipUniforms = (uniforms, passId, alpha, matrix, gain) => {
      gl.uniform1f(uniforms.uGain, gain);
      gl.uniform1f(uniforms.uThin, profile.thin);
      gl.uniform1f(uniforms.uDim, profile.dim);
      gl.uniform1f(uniforms.uLineSize, profile.lineSize);
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
      const shipLines = shipCount - shipSolids - shipXray;
      const crates = state.xray > 0.01;
      const drawShip = (share) => {
        gl.drawArrays(gl.POINTS, 0, Math.floor(shipSolids * share));
        gl.drawArrays(gl.POINTS, shipSolids, Math.floor(shipLines * share));
        if (crates) gl.drawArrays(gl.POINTS, shipSolids + shipLines, Math.floor(shipXray * share));
      };

      if (quality.reflect) {
        shipUniforms(u, 2, 1, model, ((shipGain / lod) * 0.6) / quality.reflect);
        drawShip(lod * quality.reflect);
      }

      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      shipUniforms(u, 1, 1, model, shipGain / lod);
      gl.drawArrays(gl.POINTS, 0, Math.floor(shipSolids * lod));

      gl.blendFunc(gl.ONE, gl.ONE);
      shipUniforms(u, 0, 1, model, shipGain / lod);
      drawShip(lod);
      visiblePoints += Math.floor((shipSolids + shipLines + (crates ? shipXray : 0)) * lod);
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
      shipUniforms(u, 0, state.boat, bm, shipGain);
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

    if (quality.bloom) {
      let source = scene;
      chain.forEach((mip, index) => {
        const wide = index === 0 && profile.bloomFirst > 1;
        pass(source, mip, programs.down, (uniforms) => {
          gl.invalidateFramebuffer(gl.FRAMEBUFFER, COLOR);
          gl.uniform1f(uniforms.uKnee, index === 0 ? profile.knee : 0);
          if (wide) gl.uniform2f(uniforms.uPixel, 1 / source.width, 1 / source.height);
        });
        source = mip;
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
    gl.uniform1f(u.uBloomAmt, quality.bloom ? 0.42 : 0);
    gl.uniform1f(u.uFade, fade);
    gl.uniform1f(u.uWhite, hdrReady ? 1 : 1.35);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!reduced) measureGpu(frameStart);

    frames += 1;
    if (now - framesStart >= 1000) {
      const fps = Math.round((frames * 1000) / (now - framesStart));
      if (fps >= 4) stats.fps = fps;
      stats.points = visiblePoints;
      stats.ready = !!shipVao;
      options.onStats?.(stats);
      adjustQuality(fps);
      frames = 0;
      framesStart = now;
    }
  };

  let raf = 0;
  let active = false;
  let visible = true;

  // Экраны 120 Гц не гоняем впустую, а слабым устройствам оставляем 30 кадров: прокрутке нужнее свободная видеокарта.
  let lastFrame = 0;
  const loop = (now) => {
    raf = 0;
    if (!active) return;
    if (now - lastFrame >= LEVELS[level].gap) {
      lastFrame = now;
      render(now);
    }
    raf = requestAnimationFrame(loop);
  };

  const setActive = (next) => {
    if (reduced || !linked) {
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
    if (!reduced || !linked || pending || !scene) return;
    pending = true;
    requestAnimationFrame((now) => {
      pending = false;
      render(now);
    });
  }

  resize();
  new ResizeObserver(resize).observe(canvas);
  new ResizeObserver(measure).observe(zone);
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

  document.addEventListener("visibilitychange", () => {
    gpuTimes.length = 0;
    setActive(visible && !document.hidden);
  });

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    setActive(false);
    options.onError?.();
  });

  const whenLinked = () => {
    const list = Object.values(programs);
    if (parallelCompile && !list.every((entry) => gl.getProgramParameter(entry.program, parallelCompile.COMPLETION_STATUS_KHR))) {
      requestAnimationFrame(whenLinked);
      return;
    }
    try {
      list.forEach((entry) => finishProgram(gl, entry));
    } catch (error) {
      console.error(error);
      options.onError?.();
      return;
    }
    linked = true;
    started = performance.now();
    setActive(visible && !document.hidden);
    requestRender();
  };
  whenLinked();

  return {
    stats,
    refresh: measure,
    setStorm(value) {
      stormWanted = reduced ? 0 : value;
    },
  };
}
