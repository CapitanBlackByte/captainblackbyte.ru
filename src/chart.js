const NS = "http://www.w3.org/2000/svg";
const INK = "#1a2236";

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  parent?.append(node);
  return node;
}

function rhumbLines(group, cx, cy, count, length) {
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    el("line", {
      x1: cx,
      y1: cy,
      x2: cx + Math.cos(a) * length,
      y2: cy + Math.sin(a) * length,
      stroke: INK,
      "stroke-opacity": i % 4 === 0 ? 0.13 : 0.06,
      "stroke-width": 1,
    }, group);
  }
}

function compass(group, cx, cy, radius) {
  const g = el("g", { transform: `translate(${cx} ${cy})` }, group);
  el("circle", { r: radius, fill: "none", stroke: INK, "stroke-opacity": 0.55 }, g);
  el("circle", { r: radius * 0.93, fill: "none", stroke: INK, "stroke-opacity": 0.3 }, g);
  for (let i = 0; i < 72; i += 1) {
    const a = (i / 72) * Math.PI * 2;
    const inner = i % 9 === 0 ? radius * 0.86 : radius * 0.9;
    el("line", {
      x1: Math.cos(a) * inner,
      y1: Math.sin(a) * inner,
      x2: Math.cos(a) * radius * 0.93,
      y2: Math.sin(a) * radius * 0.93,
      stroke: INK,
      "stroke-opacity": 0.5,
    }, g);
  }
  const star = (points, outer, inner, offset, dark, light) => {
    for (let i = 0; i < points; i += 1) {
      const a = offset + (i / points) * Math.PI * 2;
      const step = Math.PI / points;
      const tip = [Math.cos(a) * outer, Math.sin(a) * outer];
      const left = [Math.cos(a - step) * inner, Math.sin(a - step) * inner];
      const right = [Math.cos(a + step) * inner, Math.sin(a + step) * inner];
      el("path", { d: `M0 0L${left}L${tip}Z`, fill: dark, "fill-opacity": 0.8 }, g);
      el("path", { d: `M0 0L${tip}L${right}Z`, fill: light, stroke: INK, "stroke-width": 0.6, "stroke-opacity": 0.6 }, g);
    }
  };
  star(8, radius * 0.56, radius * 0.11, Math.PI / 8, INK, "#efe6d0");
  star(4, radius * 0.84, radius * 0.15, -Math.PI / 2, INK, "#efe6d0");
  const north = el("text", {
    x: 0,
    y: -radius * 1.09,
    "text-anchor": "middle",
    "font-family": "Cormorant, Georgia, serif",
    "font-size": radius * 0.27,
    "font-weight": 600,
    fill: INK,
  }, g);
  north.textContent = "С";
}

function island(group, cx, cy, radius, seed) {
  const random = seeded(seed);
  const waves = Array.from({ length: 6 }, (_, i) => ({
    k: i + 2,
    a: (random() * 0.2) / (1 + i * 0.5),
    p: random() * Math.PI * 2,
  }));
  const levels = 6;
  for (let level = 0; level < levels; level += 1) {
    const scale = 1 - level / (levels + 0.6);
    let d = "";
    for (let i = 0; i <= 140; i += 1) {
      const a = (i / 140) * Math.PI * 2;
      let r = 1;
      waves.forEach((wave) => {
        r += Math.sin(a * wave.k + wave.p + level * 0.14) * wave.a;
      });
      const x = cx + Math.cos(a) * r * radius * scale * 1.35;
      const y = cy + Math.sin(a) * r * radius * scale * 0.82;
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    el("path", {
      d: `${d}Z`,
      fill: level === 0 ? "rgba(168, 120, 60, 0.13)" : level === levels - 1 ? "rgba(168, 120, 60, 0.26)" : "none",
      stroke: INK,
      "stroke-opacity": level === 0 ? 0.55 : 0.2,
      "stroke-width": level === 0 ? 1.2 : 0.8,
      "stroke-dasharray": level === 1 ? "3 5" : "none",
    }, group);
  }
}

function soundings(group, width, height, count) {
  const random = seeded(91);
  for (let i = 0; i < count; i += 1) {
    const text = el("text", {
      x: (random() * width).toFixed(0),
      y: (random() * height).toFixed(0),
      "font-family": "JetBrains Mono Variable, Consolas, monospace",
      "font-size": 11,
      fill: INK,
      "fill-opacity": 0.3,
    }, group);
    text.textContent = Math.floor(random() * 256).toString(16).toUpperCase().padStart(2, "0");
  }
}

export function drawChart(svg) {
  if (!svg) return;
  const W = 1600;
  const H = 1000;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  const group = el("g", {}, svg);
  rhumbLines(group, 1330, 200, 32, 1900);
  rhumbLines(group, 180, 880, 32, 1900);
  soundings(group, W, H, 70);
  island(group, 1500, 930, 150, 77);
  island(group, 90, 90, 90, 1234);
  compass(group, 1330, 200, 118);
}
