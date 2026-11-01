import { BOLT, createLoop, demoBar, nowLabel, reducedMotion, seeded, whenVisible } from "./shared.js";

const NS = "http://www.w3.org/2000/svg";

const TARGETS = {
  crm: { name: "CRM", path: "ex-crm", weight: 0.5 },
  site: { name: "Сайт", path: "ex-site", weight: 0.3 },
  bank: { name: "Сервис", path: "ex-bank", weight: 0.2 },
};

const node = (x, y, w, h, lines, extra = "") => `
  <g class="pipe-node ${extra}" ${extra.includes("pipe-target") ? `data-target="${lines.target}"` : ""}>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
    ${lines.items.map(([text, ty, cls, attr = ""]) => `<text x="${x + w / 2}" y="${y + ty}" class="${cls}" ${attr}>${text}</text>`).join("")}
  </g>`;

const LAYOUTS = {
  wide: {
    viewBox: "0 0 820 330",
    paths: {
      "p-1c-q": "M128 150H262",
      "p-q-ex": "M432 150H516",
      "ex-crm": "M636 132C672 132 668 62 700 62",
      "ex-site": "M636 150H700",
      "ex-bank": "M636 168C672 168 668 238 700 238",
      "ex-dlq": "M576 192V262",
    },
    nodes: () =>
      node(18, 108, 110, 84, { items: [["1С", 36, "n-title"], ["заказы, клиенты", 58, "n-sub"]] }) +
      node(262, 96, 170, 108, { items: [["Очередь", 24, "n-title"], ["RabbitMQ", 94, "n-sub"]] }, "pipe-queue") +
      node(516, 108, 120, 84, { items: [["Обмен", 32, "n-title"], ["журнал попыток", 52, "n-sub"], ["контроль дублей", 68, "n-sub"]] }) +
      targetNodes([[700, 30], [700, 118], [700, 206]], 104, 64) +
      node(508, 262, 136, 50, { items: [["Ручной разбор", 22, "n-title n-small"], ["пусто", 39, "n-sub", "data-dlq-note"]] }, "pipe-dlq") +
      `<text x="18" y="284" class="n-sub n-left">Прямой обмен без очереди</text>
       <text x="18" y="307" class="n-naive n-left" data-naive>уже потерял бы 0</text>`,
    flash: { crm: [700, 62], site: [700, 150], bank: [700, 238], exchange: [576, 150], dlq: [576, 287] },
    slots: { x: 276, y: 136, dx: 12, dy: 16, cols: 12 },
  },
  tall: {
    viewBox: "0 0 360 416",
    paths: {
      "p-1c-q": "M110 62V96",
      "p-q-ex": "M110 176V212",
      "ex-crm": "M70 284C70 314 60 312 60 340",
      "ex-site": "M110 284C110 316 180 310 180 340",
      "ex-bank": "M150 284C150 318 300 306 300 340",
      "ex-dlq": "M200 248H232",
    },
    nodes: () =>
      node(20, 6, 180, 56, { items: [["1С", 25, "n-title"], ["заказы, клиенты", 44, "n-sub"]] }) +
      node(20, 96, 320, 80, { items: [["Очередь, RabbitMQ", 20, "n-title"]] }, "pipe-queue") +
      node(20, 212, 180, 72, { items: [["Обмен", 25, "n-title"], ["журнал попыток", 44, "n-sub"], ["контроль дублей", 60, "n-sub"]] }) +
      targetNodes([[8, 340], [128, 340], [248, 340]], 104, 64) +
      node(232, 222, 108, 52, { items: [["Разбор", 22, "n-title n-small"], ["пусто", 40, "n-sub", "data-dlq-note"]] }, "pipe-dlq") +
      `<text x="222" y="24" class="n-sub n-left">Без очереди</text>
       <text x="222" y="48" class="n-naive n-naive-small n-left" data-naive>уже потерял бы 0</text>`,
    flash: { crm: [60, 340], site: [180, 340], bank: [300, 340], exchange: [110, 248], dlq: [286, 248] },
    slots: { x: 36, y: 128, dx: 13, dy: 16, cols: 22 },
  },
};

function targetNodes(positions, w, h) {
  return ["crm", "site", "bank"]
    .map((target, index) => {
      const [x, y] = positions[index];
      const state = target === "crm" ? 'data-target-state' : "";
      return node(x, y, w, h, { target, items: [[TARGETS[target].name, 28, "n-title"], ["работает", 48, "n-sub", state]] }, "pipe-target");
    })
    .join("");
}

const PRODUCE_EVERY = 0.72;
const DISPATCH_EVERY = 0.2;
const MAX_IN_FLIGHT = 7;
const backoff = (attempt) => Math.min(8, Math.pow(2, attempt - 1));

export function initPipeline(mount) {
  mount.innerHTML = `
    ${demoBar({
      hint: "Уроните CRM: сообщения для неё встанут в повтор, а остальные пойдут дальше. Потом поднимите CRM и посмотрите на счётчик потерь. Можно отправить дубль или битое сообщение.",
      buttons: `
        <button class="storm-btn" type="button" data-crash aria-pressed="false">${BOLT}<span>Уронить CRM</span></button>
        <button class="ghost-btn" type="button" data-dup>Отправить дубль</button>
        <button class="ghost-btn" type="button" data-bad>Битое сообщение</button>`,
    })}
    <div class="pipe" role="group" aria-label="Интерактивная модель обмена между 1С, очередью, CRM, сайтом и внешним сервисом">
      <div class="win-bar win-bar-dark">
        <span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="win-url">обмен / мониторинг</span>
        <span class="win-tag">демо-данные</span>
      </div>
      <dl class="pipe-stats">
        <div class="pipe-stat-lost"><dt>Потеряно</dt><dd>0</dd></div>
        <div><dt>Доставлено</dt><dd data-stat="done">0</dd></div>
        <div><dt>В очереди</dt><dd data-stat="queued">0</dd></div>
        <div><dt>Повторов</dt><dd data-stat="retries">0</dd></div>
        <div><dt>Дублей отброшено</dt><dd data-stat="dups">0</dd></div>
        <div><dt>На разборе</dt><dd data-stat="dlq">0</dd></div>
      </dl>
      <div class="pipe-map">
        <svg aria-hidden="true">
          <g data-static></g>
          <g data-slots></g>
          <g data-packets></g>
        </svg>
      </div>
      <ol class="pipe-log" data-log aria-label="Журнал обмена"></ol>
    </div>`;

  const svg = mount.querySelector(".pipe-map svg");
  const staticGroup = svg.querySelector("[data-static]");
  const packetsGroup = svg.querySelector("[data-packets]");
  const slotsGroup = svg.querySelector("[data-slots]");
  const crashButton = mount.querySelector("[data-crash]");
  const crashLabel = crashButton.querySelector("span");
  const logBox = mount.querySelector("[data-log]");
  const stats = {};
  mount.querySelectorAll("[data-stat]").forEach((item) => { stats[item.dataset.stat] = item; });

  const random = seeded(19);
  const counts = { done: 0, retries: 0, dups: 0, dlq: 0, naive: 0 };
  const delivered = [];
  const seen = new Set();
  const queue = [];
  const moving = new Set();
  const paths = {};
  let layout = null;
  let sequence = 1041;
  let crmDown = false;
  let produceAcc = PRODUCE_EVERY;
  let dispatchAcc = 0;
  let inFlight = 0;

  const renderStats = () => {
    stats.done.textContent = counts.done;
    stats.queued.textContent = queue.length;
    stats.retries.textContent = counts.retries;
    stats.dups.textContent = counts.dups;
    stats.dlq.textContent = counts.dlq;
    const naive = staticGroup.querySelector("[data-naive]");
    if (naive) naive.textContent = `уже потерял бы ${counts.naive}`;
    const dlqNote = staticGroup.querySelector("[data-dlq-note]");
    if (dlqNote) dlqNote.textContent = counts.dlq ? `сообщений: ${counts.dlq}` : "пусто";
  };

  const syncCrm = () => {
    const crmNode = staticGroup.querySelector('[data-target="crm"]');
    crmNode?.classList.toggle("is-down", crmDown);
    const state = staticGroup.querySelector("[data-target-state]");
    if (state) state.textContent = crmDown ? "не отвечает" : "работает";
  };

  const renderSlots = () => {
    const { x, y, dx, dy, cols } = layout.slots;
    const now = performance.now();
    slotsGroup.innerHTML = queue
      .slice(0, cols * 2)
      .map((item, index) => {
        const waiting = item.readyAt > now;
        return `<rect x="${x + (index % cols) * dx}" y="${y + Math.floor(index / cols) * dy}" width="9" height="12" rx="1.5" class="${waiting ? "slot slot-wait" : "slot"}"/>`;
      })
      .join("");
  };

  const applyLayout = () => {
    const next = mount.clientWidth < 560 ? LAYOUTS.tall : LAYOUTS.wide;
    if (next === layout) return;
    layout = next;
    svg.setAttribute("viewBox", layout.viewBox);
    staticGroup.innerHTML = `
      <g class="pipe-paths">${Object.entries(layout.paths).map(([id, d]) => `<path data-path="${id}" d="${d}"/>`).join("")}</g>
      <g class="pipe-nodes">${layout.nodes()}</g>`;
    staticGroup.querySelectorAll("[data-path]").forEach((path) => {
      paths[path.dataset.path] = { node: path, length: path.getTotalLength() };
    });
    syncCrm();
    renderStats();
    renderSlots();
  };

  const addLog = (kind, text) => {
    const row = document.createElement("li");
    row.className = `is-${kind}`;
    const labels = { ok: "OK", retry: "ПОВТОР", dup: "ДУБЛЬ", bad: "РАЗБОР", info: "ИНФО" };
    row.innerHTML = `<time>${nowLabel()}</time><b>${labels[kind]}</b><span>${text}</span>`;
    logBox.prepend(row);
    while (logBox.children.length > 7) logBox.lastElementChild.remove();
  };

  const spawnDot = (kind) => {
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("r", "5");
    dot.setAttribute("class", `pkt pkt-${kind}`);
    dot.setAttribute("cx", "-20");
    packetsGroup.append(dot);
    return dot;
  };

  const move = (packet, pathId, duration, reverse, kind, onDone) => {
    if (reducedMotion) {
      onDone();
      return;
    }
    if (!packet.dot) packet.dot = spawnDot(kind);
    packet.dot.setAttribute("class", `pkt pkt-${kind}`);
    packet.motion = { pathId, t: 0, duration, reverse, onDone };
    moving.add(packet);
  };

  const dropDot = (packet) => {
    packet.dot?.remove();
    packet.dot = null;
  };

  const flash = ([x, y], kind) => {
    if (reducedMotion) return;
    const ring = document.createElementNS(NS, "circle");
    ring.setAttribute("cx", x);
    ring.setAttribute("cy", y);
    ring.setAttribute("r", "6");
    ring.setAttribute("class", `pkt-ring pkt-ring-${kind}`);
    packetsGroup.append(ring);
    ring.addEventListener("animationend", () => ring.remove(), { once: true });
  };

  const enqueue = (packet, delay = 0) => {
    packet.readyAt = performance.now() + delay * 1000;
    queue.push(packet);
    renderStats();
    renderSlots();
  };

  const toQueue = (packet) => {
    move(packet, "p-1c-q", 0.55, false, packet.bad ? "bad" : packet.dup ? "dup" : "ok", () => {
      dropDot(packet);
      enqueue(packet);
    });
  };

  const produce = () => {
    sequence += 1;
    const roll = random();
    const target = roll < TARGETS.crm.weight ? "crm" : roll < TARGETS.crm.weight + TARGETS.site.weight ? "site" : "bank";
    toQueue({ key: `ORD-${sequence}`, target, attempt: 1 });
  };

  const arriveAtTarget = (packet) => {
    const target = TARGETS[packet.target];
    if (packet.target === "crm" && crmDown) {
      flash(layout.flash.crm, "bad");
      if (packet.attempt === 1) counts.naive += 1;
      counts.retries += 1;
      const wait = backoff(packet.attempt);
      addLog("retry", `${packet.key} → ${target.name}: 503, попытка ${packet.attempt}, следующая через ${wait} с`);
      packet.attempt += 1;
      move(packet, target.path, 0.42, true, "retry", () => {
        dropDot(packet);
        inFlight -= 1;
        enqueue(packet, wait);
      });
      renderStats();
      return;
    }
    dropDot(packet);
    inFlight -= 1;
    seen.add(packet.key);
    delivered.push(packet.key);
    if (delivered.length > 40) delivered.shift();
    counts.done += 1;
    flash(layout.flash[packet.target], "ok");
    if (packet.attempt > 1) addLog("ok", `${packet.key} → ${target.name}: доставлено с попытки ${packet.attempt}`);
    else if (counts.done % 3 === 0) addLog("ok", `${packet.key} → ${target.name}: доставлено`);
    renderStats();
  };

  const arriveAtExchange = (packet) => {
    if (packet.bad) {
      move(packet, "ex-dlq", 0.5, false, "bad", () => {
        dropDot(packet);
        inFlight -= 1;
        counts.dlq += 1;
        flash(layout.flash.dlq, "bad");
        addLog("bad", `${packet.key}: неверный формат, ушло на ручной разбор, остальным не мешает`);
        renderStats();
      });
      return;
    }
    if (seen.has(packet.key)) {
      dropDot(packet);
      inFlight -= 1;
      counts.dups += 1;
      flash(layout.flash.exchange, "dup");
      addLog("dup", `${packet.key}: уже обработано, второго заказа не будет`);
      renderStats();
      return;
    }
    const target = TARGETS[packet.target];
    move(packet, target.path, 0.5, false, packet.attempt > 1 ? "retry" : "ok", () => arriveAtTarget(packet));
  };

  const dispatch = () => {
    if (inFlight >= MAX_IN_FLIGHT) return;
    const now = performance.now();
    const index = queue.findIndex((item) => item.readyAt <= now);
    if (index < 0) return;
    const [packet] = queue.splice(index, 1);
    inFlight += 1;
    renderStats();
    renderSlots();
    move(packet, "p-q-ex", 0.34, false, packet.bad ? "bad" : packet.dup ? "dup" : packet.attempt > 1 ? "retry" : "ok", () => arriveAtExchange(packet));
  };

  const loop = createLoop((dt, now) => {
    produceAcc += dt;
    while (produceAcc >= PRODUCE_EVERY) {
      produceAcc -= PRODUCE_EVERY;
      produce();
    }
    dispatchAcc += dt;
    while (dispatchAcc >= DISPATCH_EVERY) {
      dispatchAcc -= DISPATCH_EVERY;
      dispatch();
    }
    moving.forEach((packet) => {
      const motion = packet.motion;
      motion.t += dt / motion.duration;
      const t = Math.min(1, motion.t);
      const path = paths[motion.pathId];
      const point = path.node.getPointAtLength(path.length * (motion.reverse ? 1 - t : t));
      packet.dot.setAttribute("cx", point.x);
      packet.dot.setAttribute("cy", point.y);
      if (motion.t >= 1) {
        moving.delete(packet);
        motion.onDone();
      }
    });
    if (Math.floor(now / 400) !== Math.floor((now - dt * 1000) / 400)) renderSlots();
  });

  crashButton.addEventListener("click", () => {
    crmDown = !crmDown;
    syncCrm();
    crashButton.classList.toggle("is-active", crmDown);
    crashButton.setAttribute("aria-pressed", String(crmDown));
    crashLabel.textContent = crmDown ? "Поднять CRM" : "Уронить CRM";
    addLog("info", crmDown ? "CRM перестала отвечать" : "CRM снова в строю, очередь разбирается");
  });

  mount.querySelector("[data-dup]").addEventListener("click", () => {
    const key = delivered[delivered.length - 1];
    if (!key) {
      addLog("info", "Пока нечего дублировать: подождите первую доставку");
      return;
    }
    addLog("info", `1С повторно отправляет ${key}`);
    toQueue({ key, target: "crm", attempt: 1, dup: true });
  });

  mount.querySelector("[data-bad]").addEventListener("click", () => {
    sequence += 1;
    toQueue({ key: `ORD-${sequence}`, target: "crm", attempt: 1, bad: true });
  });

  applyLayout();
  new ResizeObserver(applyLayout).observe(mount);
  addLog("info", "Обмен запущен");

  whenVisible(mount, (visible) => {
    if (visible) loop.start();
    else loop.stop();
  });
}
