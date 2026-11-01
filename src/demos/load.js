import { BOLT, createLoop, demoBar, reducedMotion, whenVisible } from "./shared.js";

const INSTANCE_CAPACITY = 320;
const DB_CAPACITY = 900;
const MAX_INSTANCES = 12;
const MIN_INSTANCES = 2;
const THRESHOLD = 200;
const SAMPLES = 120;
const CHART_MAX = 600;

const int = new Intl.NumberFormat("ru-RU");

export function initLoad(mount) {
  mount.innerHTML = `
    ${demoBar({
      hint: "Запустите шторм и посмотрите, как система добирает мощность. Потом отключите кеш или масштабирование и повторите: разница видна на графике.",
      buttons: `<button class="storm-btn" type="button" data-storm aria-pressed="false">${BOLT}<span>Шторм: 2 500 RPS</span></button>`,
    })}
    <div class="load" role="group" aria-label="Интерактивная модель высоконагруженного API">
      <div class="win-bar win-bar-dark">
        <span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="win-url">api / мониторинг</span>
        <span class="win-tag">демо-данные</span>
      </div>
      <div class="load-controls">
        <label class="load-slider">
          <span>Нагрузка, запросов в секунду <b data-rps-label></b></span>
          <input type="range" min="100" max="3000" step="50" value="600" data-rps />
          <i class="load-mark" style="left: calc(${((1500 - 100) / 2900) * 100}% + ${8 - ((1500 - 100) / 2900) * 16}px)">1 500, как в проекте</i>
        </label>
        <label class="switch"><input type="checkbox" data-cache checked /><i></i><span>Кеш Redis</span></label>
        <label class="switch"><input type="checkbox" data-scale checked /><i></i><span>Автомасштабирование</span></label>
      </div>
      <canvas class="load-canvas" aria-hidden="true"></canvas>
      <dl class="load-stats">
        <div class="load-status" data-status-box><dt>Состояние</dt><dd data-status></dd></div>
        <div><dt>p95</dt><dd data-p95></dd></div>
        <div><dt>Ошибки</dt><dd data-errors></dd></div>
        <div><dt>Инстансы</dt><dd data-instances></dd></div>
        <div><dt>Попадания в кеш</dt><dd data-hit></dd></div>
      </dl>
      <div class="load-chart" data-chart>
        <p class="load-chart-title">Время ответа p95, мс, за последние 30 секунд</p>
        <svg role="img" aria-label="График времени ответа за последние 30 секунд" tabindex="0"></svg>
        <div class="load-tip" hidden></div>
      </div>
    </div>`;

  const q = (selector) => mount.querySelector(selector);
  const rpsInput = q("[data-rps]");
  const rpsLabel = q("[data-rps-label]");
  const cacheInput = q("[data-cache]");
  const scaleInput = q("[data-scale]");
  const stormButton = q("[data-storm]");
  const stormLabel = stormButton.querySelector("span");
  const canvas = q(".load-canvas");
  const ctx = canvas.getContext("2d");
  const chart = q("[data-chart]");
  const svg = chart.querySelector("svg");
  const tip = chart.querySelector(".load-tip");
  const out = {
    status: q("[data-status]"),
    statusBox: q("[data-status-box]"),
    p95: q("[data-p95]"),
    errors: q("[data-errors]"),
    instances: q("[data-instances]"),
    hit: q("[data-hit]"),
  };

  const sim = {
    target: 600,
    rps: 600,
    instances: 3,
    hit: 0.82,
    p95: 40,
    errors: 0,
    utilization: 0.6,
    dbLoad: 0.1,
    scaleTimer: 0,
    stormLeft: 0,
    stormReturn: 600,
  };
  const history = [];
  for (let i = 0; i < SAMPLES; i += 1) history.push({ p95: 38 + Math.sin(i * 0.3) * 3, rps: 600, instances: 3 });
  let hover = -1;
  let chartDirty = true;

  const step = (dt) => {
    sim.rps += (sim.target - sim.rps) * (1 - Math.exp(-dt * 0.85));
    const noisy = sim.rps * (1 + Math.sin(performance.now() / 640) * 0.015);

    const wantHit = cacheInput.checked ? 0.82 : 0;
    sim.hit += (wantHit - sim.hit) * (1 - Math.exp(-dt * (cacheInput.checked ? 0.45 : 3)));

    const appUtil = noisy / (sim.instances * INSTANCE_CAPACITY);
    const dbRps = noisy * (1 - sim.hit);
    sim.dbLoad = dbRps / DB_CAPACITY;
    const util = Math.max(appUtil, sim.dbLoad);
    sim.utilization = util;

    const base = 16 + (1 - sim.hit) * 46;
    const clamped = Math.min(util, 0.985);
    let latency = base * (1 + ((clamped * clamped) / (1.03 - clamped)) * 1.45);
    if (util > 1) latency += (util - 1) * 900;
    sim.p95 += (latency - sim.p95) * (1 - Math.exp(-dt * 2.6));
    const wantErrors = util > 1 ? 1 - 1 / util : 0;
    sim.errors += (wantErrors - sim.errors) * (1 - Math.exp(-dt * 3));

    sim.scaleTimer -= dt;
    if (scaleInput.checked && sim.scaleTimer <= 0) {
      if (appUtil > 0.68 && sim.instances < MAX_INSTANCES) {
        sim.instances = Math.min(MAX_INSTANCES, sim.instances + (appUtil > 0.95 ? 2 : 1));
        sim.scaleTimer = 0.7;
      } else if (appUtil < 0.34 && sim.instances > MIN_INSTANCES) {
        sim.instances -= 1;
        sim.scaleTimer = 3.2;
      }
    }

    if (sim.stormLeft > 0) {
      sim.stormLeft -= dt;
      if (sim.stormLeft <= 0) endStorm();
      else {
        const left = Math.ceil(sim.stormLeft);
        const text = `Шторм идёт: ${left} с`;
        if (stormLabel.textContent !== text) stormLabel.textContent = text;
      }
    }
  };

  const renderStats = () => {
    rpsLabel.textContent = int.format(Math.round(sim.target));
    out.p95.textContent = `${int.format(Math.round(sim.p95))} мс`;
    out.errors.textContent = `${(sim.errors * 100).toFixed(sim.errors > 0.0005 ? 1 : 0).replace(".", ",")}%`;
    out.instances.textContent = `${sim.instances} из ${scaleInput.checked ? MAX_INSTANCES : sim.instances}`;
    out.hit.textContent = `${Math.round(sim.hit * 100)}%`;
    const state = sim.errors > 0.01 ? "fail" : sim.p95 > THRESHOLD ? "warn" : "ok";
    out.statusBox.dataset.state = state;
    out.status.textContent = { ok: "Держит", warn: "На пределе", fail: "Отказы" }[state];
  };

  const renderChart = () => {
    const width = Math.max(260, chart.clientWidth);
    const height = 150;
    const m = { l: 40, r: 10, t: 8, b: 8 };
    const plotW = width - m.l - m.r;
    const plotH = height - m.t - m.b;
    const x = (i) => m.l + (i / (SAMPLES - 1)) * plotW;
    const y = (v) => m.t + plotH - (Math.min(v, CHART_MAX) / CHART_MAX) * plotH;
    const line = history.map((sample, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(sample.p95).toFixed(1)}`).join("");
    let body = "";
    [0, 200, 400, 600].forEach((tick) => {
      const py = Math.round(y(tick)) + 0.5;
      body += `<line class="${tick === THRESHOLD ? "load-threshold" : "load-grid"}" x1="${m.l}" x2="${width - m.r}" y1="${py}" y2="${py}"/>`;
      body += `<text class="load-axis" x="${m.l - 8}" y="${py + 4}" text-anchor="end">${tick}</text>`;
    });
    body += `<text class="load-axis" x="${width - m.r}" y="${y(THRESHOLD) - 5}" text-anchor="end">порог ${THRESHOLD} мс</text>`;
    body += `<path class="load-area" d="${line}L${x(SAMPLES - 1)} ${y(0)}L${x(0)} ${y(0)}Z"/>`;
    body += `<path class="load-line" d="${line}"/>`;
    const last = history[SAMPLES - 1];
    body += `<circle class="load-end" cx="${x(SAMPLES - 1)}" cy="${y(last.p95)}" r="4"/>`;
    if (hover >= 0) {
      const sample = history[hover];
      body += `<line class="load-cross" x1="${x(hover)}" x2="${x(hover)}" y1="${m.t}" y2="${m.t + plotH}"/>`;
      body += `<circle class="load-end" cx="${x(hover)}" cy="${y(sample.p95)}" r="4"/>`;
      tip.hidden = false;
      tip.innerHTML = `<strong>${int.format(Math.round(sample.p95))} мс</strong><span>${int.format(Math.round(sample.rps))} RPS</span><span>инстансов: ${sample.instances}</span>`;
      const left = x(hover) + 12 + tip.offsetWidth > width ? x(hover) - tip.offsetWidth - 12 : x(hover) + 12;
      tip.style.transform = `translate(${Math.max(0, left)}px, 30px)`;
    } else {
      tip.hidden = true;
    }
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.innerHTML = body;
  };

  svg.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const index = Math.round(((event.clientX - rect.left - 40) / (rect.width - 50)) * (SAMPLES - 1));
    hover = index >= 0 && index < SAMPLES ? index : -1;
    chartDirty = true;
  });
  svg.addEventListener("pointerleave", () => {
    hover = -1;
    chartDirty = true;
  });
  svg.addEventListener("focus", () => {
    hover = SAMPLES - 1;
    chartDirty = true;
  });
  svg.addEventListener("blur", () => {
    hover = -1;
    chartDirty = true;
  });
  svg.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") hover = Math.max(0, hover - 4);
    else if (event.key === "ArrowRight") hover = Math.min(SAMPLES - 1, hover + 4);
    else return;
    event.preventDefault();
    chartDirty = true;
  });

  const dots = [];
  let spawnAcc = 0;
  let width = 0;
  let height = 0;

  const fitCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const layout = () => {
    const narrow = width < 560;
    const pad = narrow ? 8 : 14;
    const lbX = width * (narrow ? 0.14 : 0.17);
    const gridX = width * (narrow ? 0.3 : 0.34);
    const gridW = width * (narrow ? 0.36 : 0.32);
    const storeX = width * (narrow ? 0.76 : 0.76);
    const boxW = width * (narrow ? 0.22 : 0.2);
    return { pad, lbX, gridX, gridW, storeX, boxW, narrow };
  };

  const instanceRect = (index, geometry) => {
    const columns = 4;
    const rows = 3;
    const gap = 5;
    const top = 30;
    const cellW = (geometry.gridW - gap * (columns - 1)) / columns;
    const cellH = (height - top - 14 - gap * (rows - 1)) / rows;
    const col = index % columns;
    const row = Math.floor(index / columns);
    return { x: geometry.gridX + col * (cellW + gap), y: top + row * (cellH + gap), w: cellW, h: cellH };
  };

  const label = (text, x, y, align = "center", color = "rgba(167,176,194,.95)") => {
    ctx.font = '500 11px "JetBrains Mono Variable", Consolas, monospace';
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };

  const box = (x, y, w, h, fill, stroke) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 3);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const statusColor = (level) => (level > 1 ? "#ff5a45" : level > 0.8 ? "#f2b84b" : "#8be04e");

  const drawScene = (dt) => {
    ctx.clearRect(0, 0, width, height);
    const g = layout();
    const midY = height / 2 + 6;

    if (g.narrow) {
      label("балансировщик", g.pad, 18, "left");
    } else {
      label("клиенты", g.pad, 18, "left");
      label("балансировщик", g.lbX, 18);
    }
    label(g.narrow ? `× ${sim.instances}` : `инстансы: ${sim.instances}`, g.gridX + g.gridW / 2, 18);

    box(g.lbX - 8, midY - 34, 16, 68, "rgba(242,184,75,.14)", "rgba(242,184,75,.55)");

    const appUtil = sim.rps / (sim.instances * INSTANCE_CAPACITY);
    for (let i = 0; i < MAX_INSTANCES; i += 1) {
      const rect = instanceRect(i, g);
      const active = i < sim.instances;
      box(rect.x, rect.y, rect.w, rect.h, active ? "rgba(255,255,255,.04)" : "rgba(255,255,255,.012)", active ? "rgba(220,230,255,.26)" : "rgba(220,230,255,.07)");
      if (active) {
        const level = Math.min(1, appUtil);
        const fillH = (rect.h - 4) * level;
        ctx.fillStyle = statusColor(appUtil);
        ctx.globalAlpha = 0.72;
        ctx.fillRect(rect.x + 2, rect.y + rect.h - 2 - fillH, rect.w - 4, fillH);
        ctx.globalAlpha = 1;
      }
    }

    const cacheY = 30;
    const storeH = (height - 30 - 14 - 10) / 2;
    const dbY = cacheY + storeH + 10;
    label("Redis", g.storeX + g.boxW / 2, 18);
    box(g.storeX, cacheY, g.boxW, storeH, cacheInput.checked ? "rgba(139,224,78,.08)" : "rgba(255,255,255,.015)", cacheInput.checked ? "rgba(139,224,78,.5)" : "rgba(220,230,255,.1)");
    label(cacheInput.checked ? `${Math.round(sim.hit * 100)}%${g.narrow ? "" : " из кеша"}` : g.narrow ? "выкл." : "выключен", g.storeX + g.boxW / 2, cacheY + storeH / 2 + 4, "center", cacheInput.checked ? "#cfe9bb" : "rgba(118,129,154,1)");

    box(g.storeX, dbY, g.boxW, storeH, "rgba(255,255,255,.03)", "rgba(220,230,255,.22)");
    const dbFill = Math.min(1, sim.dbLoad);
    ctx.fillStyle = statusColor(sim.dbLoad);
    ctx.globalAlpha = 0.34;
    ctx.fillRect(g.storeX + 2, dbY + 2, (g.boxW - 4) * dbFill, storeH - 4);
    ctx.globalAlpha = 1;
    label("PostgreSQL", g.storeX + g.boxW / 2, dbY + storeH / 2 + 0, "center", "rgba(244,237,221,.95)");
    label(`${Math.round(sim.dbLoad * 100)}%`, g.storeX + g.boxW / 2, dbY + storeH / 2 + 14);

    if (reducedMotion) return;

    spawnAcc += dt * Math.min(90, sim.rps / 22);
    while (spawnAcc >= 1) {
      spawnAcc -= 1;
      const failed = Math.random() < sim.errors;
      const index = Math.floor(Math.random() * sim.instances);
      const rect = instanceRect(index, g);
      const cached = Math.random() < sim.hit;
      dots.push({
        t: Math.random() * 0.02,
        y0: midY + (Math.random() - 0.5) * 80,
        failed,
        cached,
        ix: rect.x + rect.w / 2,
        iy: rect.y + rect.h / 2,
        sy: cached ? cacheY + storeH / 2 : dbY + storeH / 2,
        speed: 0.72 + Math.random() * 0.25,
      });
    }

    for (let i = dots.length - 1; i >= 0; i -= 1) {
      const dot = dots[i];
      dot.t += dt * dot.speed;
      if (dot.t >= 1 || (dot.failed && dot.t > 0.26)) {
        dots.splice(i, 1);
        continue;
      }
      let x;
      let y;
      if (dot.t < 0.24) {
        const p = dot.t / 0.24;
        x = g.pad + (g.lbX - g.pad) * p;
        y = dot.y0 + (midY - dot.y0) * p;
      } else if (dot.t < 0.55) {
        const p = (dot.t - 0.24) / 0.31;
        x = g.lbX + (dot.ix - g.lbX) * p;
        y = midY + (dot.iy - midY) * p;
      } else {
        const p = (dot.t - 0.55) / 0.45;
        x = dot.ix + (g.storeX + 3 - dot.ix) * p;
        y = dot.iy + (dot.sy - dot.iy) * p;
      }
      ctx.beginPath();
      ctx.arc(x, y, dot.failed ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = dot.failed ? "#ff5a45" : dot.t >= 0.55 && dot.cached ? "#8be04e" : "#f2b84b";
      ctx.fill();
    }
  };

  function endStorm() {
    sim.stormLeft = 0;
    sim.target = sim.stormReturn;
    rpsInput.value = String(sim.target);
    stormButton.classList.remove("is-active");
    stormButton.setAttribute("aria-pressed", "false");
    stormLabel.textContent = "Шторм: 2 500 RPS";
  }

  stormButton.addEventListener("click", () => {
    if (sim.stormLeft > 0) {
      endStorm();
      return;
    }
    sim.stormReturn = sim.target;
    sim.stormLeft = 12;
    sim.target = 2500;
    rpsInput.value = "2500";
    stormButton.classList.add("is-active");
    stormButton.setAttribute("aria-pressed", "true");
  });

  rpsInput.addEventListener("input", () => {
    sim.target = Number(rpsInput.value);
    if (sim.stormLeft > 0) {
      sim.stormReturn = sim.target;
      endStorm();
    }
    renderStats();
  });

  [cacheInput, scaleInput].forEach((input) => input.addEventListener("change", renderStats));

  let sampleAcc = 0;
  let statsAcc = 0;
  const loop = createLoop((dt) => {
    step(dt);
    sampleAcc += dt;
    if (sampleAcc >= 0.25) {
      sampleAcc -= 0.25;
      history.push({ p95: sim.p95, rps: sim.rps, instances: sim.instances });
      history.shift();
      chartDirty = true;
    }
    statsAcc += dt;
    if (statsAcc >= 0.2) {
      statsAcc = 0;
      renderStats();
    }
    drawScene(dt);
    if (chartDirty) {
      chartDirty = false;
      renderChart();
    }
  });

  new ResizeObserver(() => {
    fitCanvas();
    chartDirty = true;
  }).observe(canvas);
  fitCanvas();
  renderStats();
  renderChart();
  drawScene(0);

  whenVisible(mount, (visible) => {
    if (visible) loop.start();
    else loop.stop();
  });
}
