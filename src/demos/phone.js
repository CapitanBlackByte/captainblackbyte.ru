import { BOLT, demoBar, nowLabel, reducedMotion, whenVisible } from "./shared.js";

const ICONS = {
  tasks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  docs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7zM14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15zM10 21h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  pin: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 7 8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const NEW_TASKS = [
  "Обновить график смен",
  "Отправить отчёт за неделю",
  "Заказать расходники",
  "Сверить накладные",
  "Провести инструктаж",
  "Проверить пломбы на складе",
];

const DOCS = [
  { name: "Договор поставки №118.pdf", size: "1,2 МБ", saved: true },
  { name: "Инструкция по приёмке.pdf", size: "640 КБ", saved: true },
  { name: "Смета, ревизия 3.xlsx", size: "220 КБ", saved: false },
  { name: "График смен, ноябрь.xlsx", size: "180 КБ", saved: false },
];

const tasksWord = (count) => {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return "задач";
  if (units === 1) return "задача";
  if (units >= 2 && units <= 4) return "задачи";
  return "задач";
};

export function initPhone(mount) {
  let online = true;
  let tab = "tasks";
  let nextId = 5;
  let newIndex = 0;
  let syncing = false;
  let wasOffline = false;
  let snackTimer = 0;
  let serverCount = 4;
  const tasks = [
    { id: 1, title: "Подписать акт приёмки", due: "Сегодня, 14:00", done: false, pending: false },
    { id: 2, title: "Проверить остатки на складе №3", due: "Сегодня, 16:30", done: false, pending: false },
    { id: 3, title: "Загрузить фото с объекта", due: "Завтра", done: true, pending: false },
    { id: 4, title: "Согласовать смету с подрядчиком", due: "Завтра", done: false, pending: false },
  ];
  const notifications = [
    { title: "Документ подписан", text: "Договор поставки №118 подписан контрагентом", time: "09:12", fresh: false },
    { title: "Смена подтверждена", text: "График на завтра утверждён", time: "08:40", fresh: false },
  ];
  const queue = [];
  const log = [];

  mount.innerHTML = `
    ${demoBar({
      hint: "Отключите сеть, отметьте задачи или добавьте новую кнопкой «+», затем верните связь. Ничего не потеряется.",
      buttons: `<button class="storm-btn" type="button" data-net aria-pressed="false">${BOLT}<span>Отключить сеть</span></button>`,
    })}
    <div class="phone-stage" role="group" aria-label="Интерактивная модель Android-приложения">
      <div class="phone" data-state="online">
        <div class="phone-screen">
          <div class="phone-status">
            <time data-clock></time>
            <span class="phone-signal" data-signal aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          </div>
          <div class="phone-offline" data-banner hidden>Нет сети. Работаем локально</div>
          <div class="phone-push" data-push hidden></div>
          <header class="phone-top"><h4 data-title>Задачи</h4><span data-subtitle></span></header>
          <div class="phone-list" data-list></div>
          <button class="phone-fab" type="button" data-add aria-label="Добавить задачу">+</button>
          <div class="phone-snack" data-snack hidden></div>
          <nav class="phone-nav" aria-label="Разделы приложения">
            <button type="button" data-tab="tasks" aria-pressed="true">${ICONS.tasks}<span>Задачи</span></button>
            <button type="button" data-tab="docs" aria-pressed="false">${ICONS.docs}<span>Документы</span></button>
            <button type="button" data-tab="bell" aria-pressed="false">${ICONS.bell}<span>Уведомления</span><b data-badge hidden></b></button>
          </nav>
        </div>
      </div>
      <aside class="hood-panel" aria-label="Что происходит внутри приложения">
        <p class="hood-panel-title">Под капотом</p>
        <div class="sync-map">
          <div class="sync-node"><span>Телефон, Room</span><strong data-local></strong></div>
          <div class="sync-link" data-link><i></i><i></i><i></i><em data-link-label></em></div>
          <div class="sync-node"><span>Сервер, REST API</span><strong data-server></strong></div>
        </div>
        <p class="hood-sub">Очередь синхронизации</p>
        <ol class="sync-queue" data-queue></ol>
        <p class="hood-sub">Журнал</p>
        <ol class="sync-log" data-log></ol>
      </aside>
    </div>`;

  const phone = mount.querySelector(".phone");
  const netButton = mount.querySelector("[data-net]");
  const netLabel = netButton.querySelector("span");
  const list = mount.querySelector("[data-list]");
  const snack = mount.querySelector("[data-snack]");
  const banner = mount.querySelector("[data-banner]");
  const push = mount.querySelector("[data-push]");
  const fab = mount.querySelector("[data-add]");
  const badge = mount.querySelector("[data-badge]");
  const title = mount.querySelector("[data-title]");
  const subtitle = mount.querySelector("[data-subtitle]");
  const clock = mount.querySelector("[data-clock]");
  const queueBox = mount.querySelector("[data-queue]");
  const logBox = mount.querySelector("[data-log]");
  const local = mount.querySelector("[data-local]");
  const server = mount.querySelector("[data-server]");
  const link = mount.querySelector("[data-link]");
  const linkLabel = mount.querySelector("[data-link-label]");

  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };
  tick();
  window.setInterval(tick, 20000);

  const addLog = (text, kind = "") => {
    log.unshift({ time: nowLabel(), text, kind });
    log.length = Math.min(log.length, 6);
    logBox.innerHTML = log
      .map((item) => `<li class="${item.kind}"><time>${item.time}</time><span>${item.text}</span></li>`)
      .join("");
  };

  const showSnack = (text) => {
    snack.textContent = text;
    snack.hidden = false;
    window.clearTimeout(snackTimer);
    snackTimer = window.setTimeout(() => {
      snack.hidden = true;
    }, 2400);
  };

  const renderList = () => {
    if (tab === "tasks") {
      list.innerHTML = tasks
        .map(
          (task) => `
          <button class="task ${task.done ? "is-done" : ""} ${task.fresh ? "is-fresh" : ""}" type="button" data-task="${task.id}" aria-pressed="${task.done}">
            <span class="task-box">${task.done ? ICONS.check : ""}</span>
            <span class="task-text"><b>${task.title}</b><small>${task.due}</small></span>
            <span class="task-sync ${task.pending ? "is-pending" : ""}" aria-label="${task.pending ? "Ждёт отправки" : "Сохранено на сервере"}">${task.pending ? ICONS.clock : ICONS.check}</span>
          </button>`
        )
        .join("");
    } else if (tab === "docs") {
      list.innerHTML = DOCS.map((doc, index) => {
        const blocked = !online && !doc.saved;
        return `
          <button class="doc ${blocked ? "is-blocked" : ""}" type="button" data-doc="${index}">
            <span class="doc-icon">${ICONS.docs}</span>
            <span class="task-text"><b>${doc.name}</b><small>${doc.size}${doc.saved ? ", на телефоне" : ""}</small></span>
            ${doc.saved ? `<span class="task-sync" aria-label="Доступен без сети">${ICONS.pin}</span>` : ""}
          </button>`;
      }).join("");
    } else {
      list.innerHTML = notifications
        .map(
          (item) => `
          <div class="note ${item.fresh ? "is-fresh" : ""}">
            <span class="task-text"><b>${item.title}</b><small>${item.text}</small></span>
            <time>${item.time}</time>
          </div>`
        )
        .join("");
    }
    tasks.forEach((task) => { task.fresh = false; });
  };

  const renderHood = () => {
    const pending = queue.length;
    local.textContent = `${tasks.length} ${tasksWord(tasks.length)}`;
    server.textContent = `${serverCount} ${tasksWord(serverCount)}`;
    subtitle.textContent =
      tab === "tasks"
        ? `Открыто: ${tasks.filter((task) => !task.done).length}${pending ? `, в очереди: ${pending}` : ""}`
        : tab === "docs"
          ? `${DOCS.filter((doc) => doc.saved).length} из ${DOCS.length} доступны без сети`
          : notifications.some((item) => item.fresh) ? "Есть новые" : "Новых нет";
    linkLabel.textContent = online ? (syncing ? "идёт обмен" : "связь есть") : "нет связи";
    link.dataset.state = online ? (syncing ? "syncing" : "online") : "offline";
    queueBox.innerHTML = pending
      ? queue.map((op) => `<li><code>${op.method}</code><span>${op.label}</span></li>`).join("")
      : `<li class="is-empty">Пусто: всё уже на сервере</li>`;
  };

  const render = () => {
    renderList();
    renderHood();
  };

  const finishSync = () => {
    syncing = false;
    renderHood();
    addLog("Данные на телефоне и сервере совпадают", "ok");
    if (wasOffline) {
      wasOffline = false;
      window.setTimeout(() => {
        const id = nextId;
        nextId += 1;
        tasks.unshift({ id, title: "Принять поставку на складе №1", due: "Сегодня, 18:00", done: false, pending: false, fresh: true });
        serverCount += 1;
        notifications.unshift({ title: "Новая задача", text: "Руководитель поручил принять поставку на складе №1", time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), fresh: true });
        badge.textContent = "1";
        badge.hidden = false;
        push.innerHTML = `<b>Новая задача</b><span>Принять поставку на складе №1</span>`;
        push.hidden = false;
        window.setTimeout(() => {
          push.hidden = true;
        }, 3200);
        addLog("Push: сервер прислал новую задачу", "ok");
        render();
      }, 700);
    }
  };

  const drain = () => {
    if (!online) {
      syncing = false;
      renderHood();
      return;
    }
    const op = queue.shift();
    if (!op) {
      finishSync();
      return;
    }
    syncing = true;
    renderHood();
    window.setTimeout(
      () => {
        if (!online) {
          queue.unshift(op);
          syncing = false;
          addLog(`Обрыв связи: ${op.method} ${op.short} остаётся в очереди`, "warn");
          renderHood();
          return;
        }
        const task = tasks.find((item) => item.id === op.taskId);
        if (op.conflict) {
          addLog(`${op.method} ${op.short}: 409, задачу меняли на сервере, объединили правки`, "warn");
        } else {
          addLog(`${op.method} ${op.short}: ${op.method === "POST" ? 201 : 200}`, "ok");
        }
        if (op.method === "POST") serverCount += 1;
        if (task && !queue.some((item) => item.taskId === task.id)) task.pending = false;
        render();
        drain();
      },
      reducedMotion ? 60 : 620
    );
  };

  const enqueue = (op) => {
    queue.push(op);
    if (online && !syncing) drain();
    else renderHood();
  };

  const setOnline = (next) => {
    online = next;
    phone.dataset.state = online ? "online" : "offline";
    banner.hidden = online;
    netButton.classList.toggle("is-active", !online);
    netButton.setAttribute("aria-pressed", String(!online));
    netLabel.textContent = online ? "Отключить сеть" : "Вернуть сеть";
    addLog(online ? "Связь появилась, запускаем обмен" : "Связь пропала, пишем только в локальную базу", online ? "ok" : "warn");
    if (online) {
      if (queue.length) drain();
      else if (wasOffline) finishSync();
    } else {
      wasOffline = true;
    }
    render();
  };

  netButton.addEventListener("click", () => setOnline(!online));

  fab.addEventListener("click", () => {
    const id = nextId;
    nextId += 1;
    const name = NEW_TASKS[newIndex % NEW_TASKS.length];
    newIndex += 1;
    tasks.unshift({ id, title: name, due: "Новая задача", done: false, pending: true, fresh: true });
    if (tab !== "tasks") setTab("tasks");
    enqueue({ method: "POST", taskId: id, short: `/tasks/${id}`, label: `/tasks/${id} ${name}` });
    showSnack(online ? "Задача сохранена и отправляется" : "Сохранено на телефоне. Отправим, когда появится сеть");
    render();
  });

  const setTab = (next) => {
    tab = next;
    mount.querySelectorAll("[data-tab]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.tab === tab));
    });
    title.textContent = { tasks: "Задачи", docs: "Документы", bell: "Уведомления" }[tab];
    fab.hidden = tab !== "tasks";
    if (tab === "bell") {
      badge.hidden = true;
      window.setTimeout(() => {
        notifications.forEach((item) => { item.fresh = false; });
      }, 1200);
    }
    render();
  };

  mount.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) setTab(tabButton.dataset.tab);

    const taskButton = event.target.closest("[data-task]");
    if (taskButton) {
      const task = tasks.find((item) => item.id === Number(taskButton.dataset.task));
      if (!task) return;
      task.done = !task.done;
      task.pending = true;
      // Задачу №4 на сервере параллельно правит руководитель: так видно разбор конфликта.
      const conflict = !online && task.id === 4;
      enqueue({
        method: "PATCH",
        taskId: task.id,
        short: `/tasks/${task.id}`,
        label: `/tasks/${task.id} done=${task.done}`,
        conflict,
      });
      if (!online) showSnack("Сохранено на телефоне");
      render();
    }

    const docButton = event.target.closest("[data-doc]");
    if (docButton) {
      const doc = DOCS[Number(docButton.dataset.doc)];
      if (doc.saved) showSnack(online ? "Открыт документ" : "Открыт из копии на телефоне");
      else if (online) showSnack("Документ загружен и открыт");
      else showSnack("Этот документ не скачан: нужна сеть");
    }
  });

  addLog("Приложение запущено, данные актуальны", "ok");
  render();

  let idleTimer = 0;
  whenVisible(mount, (visible) => {
    window.clearTimeout(idleTimer);
    if (!visible && !online) {
      idleTimer = window.setTimeout(() => {
        if (!online) setOnline(true);
      }, 60000);
    }
  });
}
