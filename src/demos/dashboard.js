import { BOLT, createLoop, demoBar, reducedMotion, seeded, whenVisible } from "./shared.js";

const CHANNELS = [
  { name: "Сайт", color: "#2a78d6", weight: 0.38, ticket: 7400 },
  { name: "Маркетплейс", color: "#eb6834", weight: 0.31, ticket: 4300 },
  { name: "Опт", color: "#1baf7a", weight: 0.21, ticket: 41000 },
  { name: "Розница", color: "#eda100", weight: 0.1, ticket: 3100 },
];

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const PERIODS = {
  day: {
    label: "День",
    previous: "ко вчера",
    count: 24,
    base: 96000,
    seed: 41,
    every: 4,
    name: (i) => `${String(i).padStart(2, "0")}:00`,
    shape: (i) => 0.16 + Math.exp(-Math.pow((i - 12.5) / 5.2, 2)) * 1.05 + Math.exp(-Math.pow((i - 20) / 2.4, 2)) * 0.55,
  },
  week: {
    label: "Неделя",
    previous: "к прошлой неделе",
    count: 7,
    base: 1500000,
    seed: 97,
    every: 1,
    name: (i) => WEEKDAYS[i],
    shape: (i) => [0.92, 1, 1.04, 1.1, 1.28, 0.84, 0.72][i],
  },
  month: {
    label: "Месяц",
    previous: "к прошлому месяцу",
    count: 30,
    base: 1420000,
    seed: 211,
    every: 5,
    name: (i) => `${i + 1}.11`,
    shape: (i) => (0.86 + (i / 30) * 0.3) * (i % 7 >= 5 ? 0.78 : 1),
  },
};

const int = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimal = (value) => value.toFixed(1).replace(".", ",").replace(",0", "");

const money = (value) => {
  if (value >= 1e6) return `${decimal(value / 1e6)} млн ₽`;
  if (value >= 1e3) return `${int.format(Math.round(value / 1e3))} тыс. ₽`;
  return `${int.format(Math.round(value))} ₽`;
};

const axisMoney = (value) => {
  if (value === 0) return "0";
  if (value >= 1e6) return `${decimal(value / 1e6)} млн`;
  return `${int.format(value / 1e3)} тыс.`;
};

const niceStep = (max, ticks) => {
  const rough = max / ticks;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const unit = rough / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
};

function buildPeriod(key) {
  const config = PERIODS[key];
  const random = seeded(config.seed);
  const buckets = [];
  for (let i = 0; i < config.count; i += 1) {
    const shape = config.shape(i);
    const values = CHANNELS.map((channel) => channel.weight * config.base * shape * (0.84 + random() * 0.32));
    const orders = values.map((value, c) => Math.max(1, Math.round(value / CHANNELS[c].ticket)));
    const totalOrders = orders.reduce((sum, value) => sum + value, 0);
    buckets.push({ name: config.name(i), values, orders, visits: totalOrders / (0.031 + random() * 0.008) });
  }
  const previous = CHANNELS.map(() => 0.83 + random() * 0.14);
  return { buckets, previous, previousConversion: 0.03 + random() * 0.004 };
}

export function initDashboard(mount) {
  const data = Object.fromEntries(Object.keys(PERIODS).map((key) => [key, buildPeriod(key)]));
  let period = "week";
  const enabled = CHANNELS.map(() => true);
  let storm = 0;
  let orderNumber = 10482;
  let hover = -1;
  let dirty = true;
  let reveal = reducedMotion ? 1 : 0;
  let yMax = 0;
  let acc = 0;
  let showTable = false;
  const random = seeded(7);

  mount.innerHTML = `
    ${demoBar({
      hint: "Включите «Чёрную пятницу»: заказы хлынут потоком, а кабинет продолжит считать всё на лету. Каналы и период тоже переключаются, отчёт скачивается в CSV.",
      buttons: `<button class="storm-btn" type="button" data-storm aria-pressed="false">${BOLT}<span>Чёрная пятница</span></button>`,
    })}
    <div class="dash" role="group" aria-label="Интерактивная модель кабинета продаж">
      <div class="win-bar">
        <span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="win-url">cabinet.demo / продажи</span>
        <span class="win-tag">демо-данные</span>
      </div>
      <div class="dash-body">
        <div class="dash-filters">
          <div class="dash-seg" role="group" aria-label="Период">
            ${Object.entries(PERIODS)
              .map(([key, item]) => `<button type="button" data-period="${key}" aria-pressed="${key === period}">${item.label}</button>`)
              .join("")}
          </div>
          <div class="dash-legend" role="group" aria-label="Каналы продаж">
            ${CHANNELS.map(
              (channel, index) =>
                `<button type="button" data-channel="${index}" aria-pressed="true"><i style="background:${channel.color}"></i>${channel.name}</button>`
            ).join("")}
          </div>
          <div class="dash-tools">
            <button type="button" data-view aria-pressed="false">Таблица</button>
            <button type="button" data-csv>Скачать CSV</button>
          </div>
        </div>
        <div class="dash-tiles">
          <div class="dash-tile dash-tile-hero"><span>Выручка</span><strong data-tile="revenue"></strong><em data-delta="revenue"></em></div>
          <div class="dash-tile"><span>Заказы</span><strong data-tile="orders"></strong><em data-delta="orders"></em></div>
          <div class="dash-tile"><span>Средний чек</span><strong data-tile="ticket"></strong><em data-delta="ticket"></em></div>
          <div class="dash-tile"><span>Конверсия</span><strong data-tile="conversion"></strong><em data-delta="conversion"></em></div>
        </div>
        <div class="dash-chart" data-chart>
          <svg role="img" aria-label="Выручка по каналам продаж, столбчатая диаграмма с накоплением" tabindex="0"></svg>
          <div class="dash-tip" hidden></div>
        </div>
        <div class="dash-table" hidden tabindex="0"></div>
        <ul class="dash-feed" aria-label="Последние заказы"></ul>
      </div>
    </div>`;

  const chart = mount.querySelector("[data-chart]");
  const svg = chart.querySelector("svg");
  const tip = chart.querySelector(".dash-tip");
  const stormButton = mount.querySelector("[data-storm]");
  const stormLabel = stormButton.querySelector("span");
  const tableBox = mount.querySelector(".dash-table");
  const feed = mount.querySelector(".dash-feed");
  const tiles = {};
  mount.querySelectorAll("[data-tile]").forEach((node) => { tiles[node.dataset.tile] = node; });
  const deltas = {};
  mount.querySelectorAll("[data-delta]").forEach((node) => { deltas[node.dataset.delta] = node; });

  const current = () => data[period];

  const totals = () => {
    const { buckets, previous, previousConversion } = current();
    let revenue = 0;
    let orders = 0;
    let visits = 0;
    let previousRevenue = 0;
    let previousOrders = 0;
    buckets.forEach((bucket) => {
      let share = 0;
      bucket.values.forEach((value, c) => {
        if (!enabled[c]) return;
        revenue += value;
        orders += bucket.orders[c];
        share += bucket.values[c];
        previousRevenue += value * previous[c];
        previousOrders += bucket.orders[c] * previous[c];
      });
      const whole = bucket.values.reduce((sum, value) => sum + value, 0);
      visits += bucket.visits * (whole ? share / whole : 0);
    });
    return {
      revenue,
      orders,
      ticket: orders ? revenue / orders : 0,
      conversion: visits ? orders / visits : 0,
      previousRevenue,
      previousOrders,
      previousTicket: previousOrders ? previousRevenue / previousOrders : 0,
      previousConversion,
    };
  };

  const setDelta = (node, value, previous) => {
    const label = PERIODS[period].previous;
    if (!previous) {
      node.textContent = label;
      node.className = "";
      return;
    }
    const change = value / previous - 1;
    const up = change >= 0;
    node.textContent = `${up ? "▲" : "▼"} ${decimal(Math.abs(change) * 100)}% ${label}`;
    node.className = up ? "is-up" : "is-down";
  };

  const renderTiles = () => {
    const t = totals();
    tiles.revenue.textContent = money(t.revenue);
    tiles.orders.textContent = int.format(Math.round(t.orders));
    tiles.ticket.textContent = money(t.ticket);
    tiles.conversion.textContent = `${decimal(t.conversion * 100)}%`;
    setDelta(deltas.revenue, t.revenue, t.previousRevenue);
    setDelta(deltas.orders, t.orders, t.previousOrders);
    setDelta(deltas.ticket, t.ticket, t.previousTicket);
    setDelta(deltas.conversion, t.conversion, t.previousConversion);
  };

  const bucketTotal = (bucket) =>
    bucket.values.reduce((sum, value, c) => sum + (enabled[c] ? value : 0), 0);

  const targetMax = () => Math.max(1, ...current().buckets.map(bucketTotal));

  const renderChart = () => {
    const width = Math.max(280, chart.clientWidth);
    const height = 268;
    const m = { l: 56, r: 6, t: 10, b: 26 };
    const plotW = width - m.l - m.r;
    const plotH = height - m.t - m.b;
    const { buckets } = current();
    const n = buckets.length;
    const band = plotW / n;
    const barW = Math.min(24, Math.max(3, band * 0.7));
    const step = niceStep(yMax || 1, 4);
    const top = Math.ceil((yMax || 1) / step) * step;
    const y = (value) => m.t + plotH - (value / top) * plotH;
    let out = "";

    for (let v = 0; v <= top + 1e-6; v += step) {
      const py = Math.round(y(v)) + 0.5;
      out += `<line class="dash-grid" x1="${m.l}" x2="${width - m.r}" y1="${py}" y2="${py}"/>`;
      out += `<text class="dash-axis" x="${m.l - 8}" y="${py + 4}" text-anchor="end">${axisMoney(v)}</text>`;
    }

    if (hover >= 0) {
      const cx = m.l + band * (hover + 0.5);
      out += `<line class="dash-cross" x1="${cx}" x2="${cx}" y1="${m.t}" y2="${m.t + plotH}"/>`;
    }

    buckets.forEach((bucket, i) => {
      const local = reducedMotion ? 1 : Math.min(1, Math.max(0, (reveal - (i / n) * 0.45) / 0.55));
      const eased = 1 - Math.pow(1 - local, 3);
      const cx = m.l + band * (i + 0.5);
      const x0 = cx - barW / 2;
      let base = 0;
      let lastIndex = -1;
      bucket.values.forEach((value, c) => {
        if (enabled[c] && value > 0) lastIndex = c;
      });
      bucket.values.forEach((value, c) => {
        if (!enabled[c] || value <= 0) return;
        const yBottom = y(base * eased);
        const yTop = y((base + value) * eased);
        base += value;
        const isTop = c === lastIndex;
        const h = Math.max(0, yBottom - yTop - (isTop ? 0 : 2));
        const yy = yBottom - h;
        if (h <= 0) return;
        const r = isTop ? Math.min(4, h, barW / 2) : 0;
        const d = `M${x0} ${yBottom}V${yy + r}${r ? `Q${x0} ${yy} ${x0 + r} ${yy}` : ""}H${x0 + barW - r}${r ? `Q${x0 + barW} ${yy} ${x0 + barW} ${yy + r}` : ""}V${yBottom}Z`;
        const dim = hover >= 0 && hover !== i ? ' opacity=".42"' : "";
        out += `<path d="${d}" fill="${CHANNELS[c].color}"${dim}/>`;
      });
      if (i % PERIODS[period].every === 0) {
        out += `<text class="dash-axis" x="${cx}" y="${height - 8}" text-anchor="middle">${bucket.name}</text>`;
      }
    });

    out += `<line class="dash-base" x1="${m.l}" x2="${width - m.r}" y1="${m.t + plotH + 0.5}" y2="${m.t + plotH + 0.5}"/>`;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.innerHTML = out;

    if (hover >= 0 && buckets[hover]) {
      const bucket = buckets[hover];
      tip.hidden = false;
      tip.innerHTML = `
        <b>${bucket.name}</b>
        <span class="dash-tip-total"><strong>${money(bucketTotal(bucket))}</strong>всего</span>
        ${CHANNELS.map((channel, c) =>
          enabled[c]
            ? `<span><i style="background:${channel.color}"></i><strong>${money(bucket.values[c])}</strong>${channel.name}</span>`
            : ""
        ).join("")}`;
      const cx = m.l + band * (hover + 0.5);
      const tipW = tip.offsetWidth;
      const left = cx + 14 + tipW > width ? cx - tipW - 14 : cx + 14;
      tip.style.transform = `translate(${Math.max(0, left)}px, 8px)`;
    } else {
      tip.hidden = true;
    }
  };

  const renderTable = () => {
    if (!showTable) return;
    const { buckets } = current();
    const active = CHANNELS.map((channel, c) => ({ channel, c })).filter(({ c }) => enabled[c]);
    tableBox.innerHTML = `
      <table>
        <thead><tr><th scope="col">Период</th>${active.map(({ channel }) => `<th scope="col">${channel.name}</th>`).join("")}<th scope="col">Всего</th></tr></thead>
        <tbody>
          ${buckets
            .map(
              (bucket) =>
                `<tr><th scope="row">${bucket.name}</th>${active
                  .map(({ c }) => `<td>${int.format(Math.round(bucket.values[c]))}</td>`)
                  .join("")}<td>${int.format(Math.round(bucketTotal(bucket)))}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  };

  const pushFeed = (c, amount) => {
    const row = document.createElement("li");
    row.innerHTML = `<i style="background:${CHANNELS[c].color}"></i><b>№${orderNumber}</b><span>${CHANNELS[c].name}</span><strong>${int.format(amount)} ₽</strong>`;
    feed.prepend(row);
    while (feed.children.length > 3) feed.lastElementChild.remove();
  };

  const addOrder = () => {
    let roll = random();
    let c = 0;
    for (; c < CHANNELS.length - 1; c += 1) {
      roll -= CHANNELS[c].weight;
      if (roll <= 0) break;
    }
    const amount = Math.round(CHANNELS[c].ticket * (0.5 + random() * 1.2) * (storm ? 1.6 : 1));
    Object.entries(data).forEach(([key, { buckets }]) => {
      const target = buckets[key === "day" ? 14 : key === "week" ? 4 : buckets.length - 1];
      // Масштаб модели: одно событие в ленте равно пачке заказов, пропорционально периоду.
      const multiplier = (PERIODS[key].base / 1500000) * (storm ? 3.6 : 1);
      target.values[c] += amount * multiplier;
      target.orders[c] += multiplier;
      target.visits += multiplier * (storm ? 16 : 30);
    });
    orderNumber += 1;
    pushFeed(c, amount);
    dirty = true;
  };

  const setPeriod = (key) => {
    period = key;
    mount.querySelectorAll("[data-period]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.period === key));
    });
    reveal = reducedMotion ? 1 : 0;
    hover = -1;
    yMax = targetMax();
    renderTiles();
    renderTable();
    dirty = true;
  };

  const setStorm = (seconds) => {
    storm = seconds;
    stormButton.classList.toggle("is-active", storm > 0);
    stormButton.setAttribute("aria-pressed", String(storm > 0));
    stormLabel.textContent = storm > 0 ? `Идёт распродажа: ${Math.ceil(storm)} с` : "Чёрная пятница";
  };

  stormButton.addEventListener("click", () => setStorm(storm > 0 ? 0 : 14));

  mount.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button === stormButton) return;
    if (button.dataset.period) setPeriod(button.dataset.period);
    if (button.dataset.channel) {
      const c = Number(button.dataset.channel);
      if (enabled.filter(Boolean).length === 1 && enabled[c]) return;
      enabled[c] = !enabled[c];
      button.setAttribute("aria-pressed", String(enabled[c]));
      renderTiles();
      renderTable();
      dirty = true;
    }
    if ("view" in button.dataset) {
      showTable = !showTable;
      button.setAttribute("aria-pressed", String(showTable));
      chart.hidden = showTable;
      tableBox.hidden = !showTable;
      renderTable();
      dirty = true;
    }
    if ("csv" in button.dataset) {
      const active = CHANNELS.map((channel, c) => ({ channel, c })).filter(({ c }) => enabled[c]);
      const rows = [
        ["Период", ...active.map(({ channel }) => channel.name), "Всего"],
        ...current().buckets.map((bucket) => [
          bucket.name,
          ...active.map(({ c }) => Math.round(bucket.values[c])),
          Math.round(bucketTotal(bucket)),
        ]),
      ];
      const blob = new Blob([`﻿${rows.map((row) => row.join(";")).join("\n")}`], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `prodazhi-demo-${period}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  });

  const indexFromEvent = (event) => {
    const rect = svg.getBoundingClientRect();
    const band = (rect.width - 62) / current().buckets.length;
    const index = Math.floor((event.clientX - rect.left - 56) / band);
    return index >= 0 && index < current().buckets.length ? index : -1;
  };

  svg.addEventListener("pointermove", (event) => {
    const next = indexFromEvent(event);
    if (next !== hover) {
      hover = next;
      dirty = true;
    }
  });
  svg.addEventListener("pointerleave", () => {
    hover = -1;
    dirty = true;
  });
  svg.addEventListener("keydown", (event) => {
    const count = current().buckets.length;
    if (event.key === "ArrowRight") hover = Math.min(count - 1, hover + 1);
    else if (event.key === "ArrowLeft") hover = Math.max(0, hover < 0 ? 0 : hover - 1);
    else return;
    event.preventDefault();
    dirty = true;
  });
  svg.addEventListener("focus", () => {
    if (hover < 0) hover = 0;
    dirty = true;
  });
  svg.addEventListener("blur", () => {
    hover = -1;
    dirty = true;
  });

  new ResizeObserver(() => {
    dirty = true;
  }).observe(chart);

  let tileTimer = 0;
  const loop = createLoop((dt) => {
    acc += dt;
    const interval = storm > 0 ? 0.1 : 1.1;
    while (acc >= interval) {
      acc -= interval;
      addOrder();
    }
    if (storm > 0) {
      const before = Math.ceil(storm);
      const next = Math.max(0, storm - dt);
      if (next === 0) setStorm(0);
      else {
        storm = next;
        if (Math.ceil(next) !== before) stormLabel.textContent = `Идёт распродажа: ${Math.ceil(next)} с`;
      }
    }
    tileTimer += dt;
    if (tileTimer > (storm > 0 ? 0.2 : 0.5)) {
      tileTimer = 0;
      renderTiles();
    }
    if (reveal < 1) {
      reveal = Math.min(1, reveal + dt * 1.5);
      dirty = true;
    }
    const target = targetMax();
    if (Math.abs(target - yMax) > target * 0.002) {
      yMax += (target - yMax) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      if (!showTable) renderChart();
    }
  });

  yMax = targetMax();
  renderTiles();
  renderChart();
  addOrder();
  addOrder();
  addOrder();

  whenVisible(mount, (visible) => {
    if (visible) {
      if (reveal === 0) dirty = true;
      loop.start();
    } else {
      loop.stop();
    }
  });
}
