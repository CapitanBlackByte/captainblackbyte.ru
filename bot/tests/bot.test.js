import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBot } from "../src/bot.js";
import { openStore } from "../src/store.js";
import { createTelegram } from "../src/telegram.js";
import { QUESTIONS, STATUS, TEXT, consentText } from "../src/texts.js";
import { startFakeTelegram } from "./fake-telegram.js";

const MANAGER_ID = 900;
const IVAN = { id: 101, first_name: "Иван", last_name: "Петров", username: "ivan_petrov" };

async function setup(t, options = {}) {
  const tg = await startFakeTelegram();
  const dir = await mkdtemp(path.join(tmpdir(), "bot-test-"));
  const file = path.join(dir, "state.json");
  const logs = [];
  const log = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (line) => logs.push(`${level}: ${line}`)]));
  const clock = { time: Date.parse("2026-11-02T10:00:00Z") };
  const manager = tg.user({ id: MANAGER_ID, first_name: "Николай" });
  let instance = null;

  const launch = (overrides = {}) => {
    const store = openStore(file, log);
    const controller = new AbortController();
    const bot = createBot({
      telegram: createTelegram({ token: tg.token, apiRoot: tg.url, retryDelayMs: 1 }),
      store,
      managerChatId: MANAGER_ID,
      log,
      backoffMs: 1,
      now: () => clock.time,
      ...options,
      ...overrides,
    });
    instance = { store, controller, done: bot.run({ signal: controller.signal }) };
  };
  const start = async (overrides) => {
    const waiter = tg.idle();
    launch(overrides);
    await waiter;
  };
  const stop = async () => {
    instance.controller.abort();
    await instance.done;
  };

  await start();
  t.after(async () => {
    await stop();
    await tg.close();
    await rm(dir, { recursive: true, force: true });
    assert.ok(!logs.join("\n").includes(tg.token), "токен попал в лог");
  });

  return {
    tg,
    file,
    logs,
    clock,
    manager,
    client: tg.user(IVAN),
    start,
    stop,
    abort: () => instance.controller.abort(),
    finished: () => instance.done,
    state: () => instance.store.state,
  };
}

async function reachReview(client, answers = {}) {
  await client.say("/new");
  await client.say(answers.task ?? "Приложение для курьеров");
  if (client.findButton(TEXT.consentYes)) await client.tap(TEXT.consentYes);
  await client.tap(client.from.first_name);
  await client.say(answers.contact ?? TEXT.contactHere);
}

async function placeOrder(client, answers) {
  await reachReview(client, answers);
  await client.tap(TEXT.submit);
}

test("анкета целиком: заявка сохранена, клиент и менеджер в курсе", async (t) => {
  const { tg, client, manager, logs, file, state } = await setup(t);

  await client.say("/start");
  assert.equal(client.lastText(), QUESTIONS.task);
  await client.say("Приложение для курьеров к весне");
  assert.equal(client.lastText(), consentText(""));
  await client.tap(TEXT.consentYes);
  assert.equal(client.lastText(), QUESTIONS.name);
  await client.tap("Иван");
  assert.equal(client.lastText(), QUESTIONS.contact);
  assert.deepEqual(tg.replyKeyboard(client.chatId).flat().map((button) => button.text), [TEXT.sharePhone, TEXT.contactHere]);
  await client.say("+7 999 123-45-67");
  assert.equal(tg.replyKeyboard(client.chatId), null, "клавиатура контакта должна исчезнуть");
  assert.match(client.lastText(), /Проверьте заявку/);
  assert.match(client.lastText(), /к весне/);
  assert.equal(manager.botMessages().length, 0, "до подтверждения менеджер ничего не получает");

  await client.tap(TEXT.submit);
  assert.equal(client.lastText(), TEXT.accepted(1001));
  assert.equal(client.findButton(TEXT.submit), null, "кнопки отправки должны исчезнуть");

  const [card, ...rest] = manager.botMessages();
  assert.equal(rest.length, 0);
  for (const part of ["Заявка №1001", STATUS.new, "Приложение для курьеров к весне", "Иван", "+7 999 123-45-67", "@ivan_petrov"]) {
    assert.ok(card.text.includes(part), `в карточке нет: ${part}`);
  }
  assert.ok(manager.findButton(TEXT.take));

  const order = state().orders[0];
  assert.equal(order.status, "new");
  assert.equal(order.answers.contact, "+7 999 123-45-67");
  assert.ok(order.consentAt);
  assert.equal(state().drafts[client.chatId], undefined);

  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.orders[0].id, 1001);
  assert.equal(saved.orders[0].cardMessageId, card.message_id);

  assert.deepEqual(logs.filter((line) => !line.startsWith("info")), [], "при обычной работе в логе нет ошибок");
  assert.ok(!logs.join("\n").match(/Иван|\+7 999|курьеров/), "персональные данные попали в лог");
  assert.deepEqual((await readdir(path.dirname(file))).sort(), ["state.json"], "временный файл должен исчезнуть");
});

test("запуск настраивает меню и описание, ни один запрос не отвергнут", async (t) => {
  const { tg, logs } = await setup(t);
  const methods = tg.calls.map((call) => call.method);
  for (const method of ["getMe", "deleteWebhook", "setMyCommands", "setMyDescription", "setMyShortDescription", "getChat", "getUpdates"]) {
    assert.ok(methods.includes(method), `не вызван ${method}`);
  }
  assert.deepEqual(logs.filter((line) => line.startsWith("warn") || line.startsWith("error")), []);
});

test("HTML в ответах не ломает сообщения и показывается как текст", async (t) => {
  const { tg, manager, state } = await setup(t);
  const anna = tg.user({ id: 102, first_name: "<Анна&>" });
  const hostile = `<script>alert("x")</script> & <b>`;

  await anna.say("/new");
  await anna.say(`Задача ${hostile}`);
  await anna.tap(TEXT.consentYes);
  await anna.say(`Имя ${hostile}`);
  await anna.say(`@anna ${hostile}`);
  assert.ok(anna.lastText().includes(`Задача ${hostile}`), "превью заявки");
  await anna.tap(TEXT.submit);

  const [card] = manager.botMessages();
  assert.ok(card, "карточка должна дойти");
  for (const part of [`Задача ${hostile}`, `Имя ${hostile}`, `@anna ${hostile}`]) {
    assert.ok(card.text.includes(part), `нет в карточке: ${part}`);
  }
  assert.match(card.html, /<a href="tg:\/\/user\?id=102">&lt;Анна&amp;&gt;<\/a>/, "у клиента без @username должна быть ссылка");

  await manager.tap(TEXT.take);
  assert.equal(state().orders[0].status, "work");
  assert.equal(manager.botMessages()[0].text.includes(hostile), true);
});

test("очень длинное описание доходит целиком, эмодзи не рвутся", async (t) => {
  const { client, manager, state } = await setup(t);
  const first = `a${"😀".repeat(2047)}`;
  const second = "б".repeat(3000);

  await client.say("/new");
  await client.say(first);
  await client.say(second);
  assert.equal(client.lastText(), consentText(""), "вопрос должен повториться");
  await client.tap(TEXT.consentYes);
  await client.tap("Иван");
  await client.say(TEXT.contactHere);
  await client.tap(TEXT.submit);

  const task = state().orders[0].answers.task;
  assert.equal(task, `${first}\n\n${second}`);

  const [card, ...parts] = manager.botMessages();
  const head = card.text.split("Задача:\n")[1].split("…")[0];
  assert.equal(head + parts.map((message) => message.text).join(""), task, "описание собирается без потерь");
  assert.ok(parts.length >= 1);
  assert.ok(parts.every((message) => message.reply_parameters.message_id === card.message_id));
  assert.ok(card.text.includes(TEXT.cardContinues));

  await manager.reply(parts[0], "Ответ на продолжение");
  assert.equal(client.lastText(), "Ответ на продолжение");
});

test("все поля максимальной длины умещаются в сообщения Telegram", async (t) => {
  const { tg, manager, state } = await setup(t);
  const max = tg.user({ id: 103, first_name: "Я".repeat(64), last_name: "Ф".repeat(64) });
  manager.from.first_name = "Н".repeat(64);

  await max.say("/new");
  await max.say("з".repeat(4096));
  await max.tap(TEXT.consentYes);
  await max.say("ш".repeat(200));
  await max.say(`@${"к".repeat(199)}`);
  assert.match(max.lastText(), /Проверьте заявку/);
  await max.tap(TEXT.submit);

  assert.equal(state().orders[0].answers.name.length, 100);
  const [card] = manager.botMessages();
  assert.ok(card, "карточка должна дойти");
  assert.ok(card.text.length <= 4096);
  await manager.tap(TEXT.take);
  assert.equal(state().orders[0].status, "work", "карточка редактируется и при максимальной длине");
});

test("старая кнопка ничего не ломает", async (t) => {
  const { client, state } = await setup(t);

  await client.say("/new");
  await client.say("Описание");
  await client.tap(TEXT.consentYes);
  const nameButton = client.findButton("Иван");
  await client.say("Анна");
  assert.equal(state().drafts[client.chatId].answers.name, "Анна");
  assert.equal(client.lastText(), QUESTIONS.contact);

  const notice = await client.tapData(nameButton.message, nameButton.button.callback_data);
  assert.equal(notice, TEXT.staleButton);
  assert.equal(state().drafts[client.chatId].answers.name, "Анна");
  assert.equal(state().drafts[client.chatId].step, "contact");
});

test("длинное сообщение после описания дополняет задачу", async (t) => {
  const { client, state } = await setup(t);
  const long = "Подробное описание. ".repeat(30).trim();

  await client.say("/new");
  await client.say("Начало");
  await client.say(long);
  assert.equal(client.lastText(), consentText(""));
  assert.equal(state().drafts[client.chatId].answers.task, `Начало\n\n${long}`);
});

test("двойное нажатие на отправку создаёт одну заявку", async (t) => {
  const { tg, client, manager, state } = await setup(t);
  await reachReview(client);

  const { message, button } = client.findButton(TEXT.submit);
  const waiter = tg.idle();
  const first = client.postTap(message, button.callback_data);
  const second = client.postTap(message, button.callback_data);
  await waiter;

  assert.ok(first && second);
  assert.equal(state().orders.length, 1);
  assert.equal(manager.botMessages().length, 1);
});

test("заявка ждёт, пока чат менеджера недоступен, и приходит один раз", async (t) => {
  const { tg, client, manager, clock, logs, state } = await setup(t);
  tg.block(MANAGER_ID);

  await placeOrder(client);
  assert.equal(client.lastText(), TEXT.accepted(1001), "клиент получает подтверждение в любом случае");
  assert.equal(manager.botMessages().length, 0);
  assert.equal(state().orders[0].cardMessageId, null);
  assert.ok(logs.some((line) => line.includes("Заявка №1001 не доставлена")));

  tg.unblock(MANAGER_ID);
  await tg.tick();
  assert.equal(manager.botMessages().length, 0, "повтор не раньше, чем через 30 секунд");

  clock.time += 31000;
  await tg.tick();
  assert.equal(manager.botMessages().length, 1);
  clock.time += 31000;
  await tg.tick();
  assert.equal(manager.botMessages().length, 1, "дублей быть не должно");
});

test("обрыв сети при отправке карточки не теряет заявку", async (t) => {
  const { tg, client, manager, clock, state } = await setup(t);
  tg.failNext("sendMessage", { network: true, when: (params) => params.chat_id === MANAGER_ID });

  await placeOrder(client);
  assert.equal(manager.botMessages().length, 0);

  clock.time += 31000;
  await tg.tick();
  assert.equal(manager.botMessages().length, 1);
  assert.ok(state().orders[0].cardMessageId);
});

test("если Telegram не принял карточку, заявка доходит простым текстом", async (t) => {
  const { tg, client, manager, logs } = await setup(t);
  tg.failNext("sendMessage", {
    code: 400,
    description: "Bad Request: can't parse entities",
    when: (params) => params.chat_id === MANAGER_ID && params.parse_mode === "HTML",
  });

  await placeOrder(client);
  const [card] = manager.botMessages();
  for (const part of ["Заявка №1001", "Приложение для курьеров", "@ivan_petrov", "Иван"]) {
    assert.ok(card.text.includes(part), `нет в карточке: ${part}`);
  }
  assert.ok(logs.some((line) => line.includes("простым текстом")));

  await manager.reply(card, "Ответ клиенту");
  assert.equal(client.lastText(), "Ответ клиенту");
});

test("неверный ID чата менеджера: заявка ждёт, а не теряется", async (t) => {
  const { tg, client, manager, logs, clock } = await setup(t);
  tg.failNext("sendMessage", {
    code: 400,
    times: 2,
    description: "Bad Request: chat not found",
    when: (params) => params.chat_id === MANAGER_ID,
  });

  await placeOrder(client);
  assert.equal(manager.botMessages().length, 0);
  assert.ok(logs.some((line) => line.includes("Заявка №1001 не доставлена")));

  clock.time += 31000;
  await tg.tick();
  assert.equal(manager.botMessages().length, 1);
  assert.ok(manager.findButton(TEXT.take), "после починки приходит обычная карточка");
});

test("при лимите Telegram повтор ждёт указанное время", async (t) => {
  const { tg, client, manager, clock } = await setup(t);
  tg.failNext("sendMessage", { code: 429, description: "Too Many Requests", retryAfter: 40, when: (params) => params.chat_id === MANAGER_ID });

  await placeOrder(client);
  clock.time += 31000;
  await tg.tick();
  assert.equal(manager.botMessages().length, 0, "40 секунд ещё не прошло");
  clock.time += 10000;
  await tg.tick();
  assert.equal(manager.botMessages().length, 1);
});

test("заявки до настройки менеджера копятся и приходят после неё", async (t) => {
  const { client, manager, logs, stop, start, tg } = await setup(t, { managerChatId: null });
  assert.ok(logs.some((line) => line.includes("MANAGER_CHAT_ID не задан")));

  await manager.say("/id");
  assert.ok(manager.lastText().includes(String(MANAGER_ID)));
  assert.ok(manager.lastText().includes("MANAGER_CHAT_ID"));

  await placeOrder(client);
  assert.equal(client.lastText(), TEXT.accepted(1001));

  await stop();
  await start({ managerChatId: MANAGER_ID });
  await tg.tick();
  assert.ok(manager.botMessages().some((message) => message.text.includes("Заявка №1001")));
});

test("чат менеджера назначается сам по первому сообщению от нужного аккаунта", async (t) => {
  const { tg, client, stop, start, state, logs } = await setup(t, { managerChatId: null, managerUsername: "@NikolayBlackByte" });
  const owner = tg.user({ id: 777, first_name: "Николай", username: "nikolayblackbyte" });
  assert.ok(logs.some((line) => line.includes("@nikolayblackbyte")), "лог подсказывает, кто должен написать");

  await placeOrder(client);
  assert.equal(client.lastText(), TEXT.accepted(1001));
  assert.equal(state().managerChatId, undefined, "сообщение другого клиента чат не назначает");
  assert.equal(owner.botMessages().length, 0);

  await owner.say("/start");
  assert.equal(state().managerChatId, 777);
  assert.ok(owner.botMessages().some((message) => message.text === TEXT.managerAssigned));
  assert.ok(owner.botMessages().some((message) => /Заявка №1001/.test(message.text)), "накопленная заявка приходит сразу");
  assert.ok(owner.findButton(TEXT.take));

  await owner.reply(owner.botMessages().find((message) => /Заявка №1001/.test(message.text)), "Вижу заявку");
  assert.equal(client.lastText(), "Вижу заявку");

  await stop();
  await start();
  await placeOrder(client, { task: "Вторая задача" });
  assert.ok(owner.botMessages().some((message) => /Вторая задача/.test(message.text)), "после перезапуска чат помнится");
  assert.equal(owner.botMessages().filter((message) => message.text === TEXT.managerAssigned).length, 1);
});

test("заданный вручную чат менеджера важнее автоматического", async (t) => {
  const { tg, manager, client, state } = await setup(t, { managerUsername: "owner" });
  const owner = tg.user({ id: 777, first_name: "Хозяин", username: "owner" });

  await owner.say("/start");
  assert.equal(state().managerChatId, undefined);
  assert.ok(!owner.botMessages().some((message) => message.text === TEXT.managerAssigned));

  await placeOrder(client);
  assert.ok(manager.botMessages().some((message) => /Заявка №1001/.test(message.text)));
  assert.ok(!owner.botMessages().some((message) => /Заявка №1001/.test(message.text)));
});

test("в группе чат менеджера сам не назначается", async (t) => {
  const { tg, state } = await setup(t, { managerChatId: null, managerUsername: "owner" });
  const inGroup = tg.user({ id: 777, first_name: "Хозяин", username: "owner" }, { chatId: -500, chatType: "supergroup" });

  await inGroup.say("/id");
  assert.equal(state().managerChatId, undefined);
  assert.match(inGroup.lastText(), /-500/);
});

test("перезапуск посреди анкеты ничего не теряет", async (t) => {
  const { client, stop, start, state } = await setup(t);

  await client.say("/new");
  await client.say("Обмен с 1С");
  await stop();
  await start();

  assert.equal(state().drafts[client.chatId].step, "consent");
  await client.say("/start");
  assert.equal(client.lastText(), consentText(""), "/start продолжает анкету, а не сбрасывает");
  await client.tap(TEXT.consentYes);
  await client.tap("Иван");
  await client.say(TEXT.contactHere);
  await client.tap(TEXT.submit);
  assert.equal(state().orders[0].answers.task, "Обмен с 1С");
});

test("повторная доставка после перезапуска не записывает ответ дважды", async (t) => {
  const { tg, client, abort, finished, start, state } = await setup(t);

  await placeOrder(client);
  await client.say("/new");
  tg.onCall((method) => {
    if (method !== "sendMessage") return false;
    abort();
    return true;
  });
  client.post({ text: "Описание задачи" });
  await finished();

  await start();
  const draft = state().drafts[client.chatId];
  assert.equal(draft.answers.task, "Описание задачи");
  assert.equal(draft.answers.name, undefined, "тот же текст не должен стать именем");
  assert.equal(draft.step, "name");
});

test("после тишины новое обновление с меньшим номером не теряется", async (t) => {
  const { tg, client } = await setup(t);

  await client.say("/help");
  await tg.tick();
  const polls = tg.calls.filter((call) => call.method === "getUpdates");
  assert.equal(polls.at(-1).params.offset, undefined, "после пустого ответа смещение не передаём");

  const waiter = tg.idle();
  tg.push({ message: { message_id: 1, from: client.from, chat: { id: client.chatId, type: "private" }, date: 0, text: "/new", entities: [{ type: "bot_command", offset: 0, length: 4 }] } }, 7);
  await waiter;
  assert.equal(client.lastText(), QUESTIONS.task);
});

test("временные ошибки Telegram не мешают ответить клиенту", async (t) => {
  const { tg, client } = await setup(t);

  tg.failNext("sendMessage", { code: 502, times: 2, description: "Bad Gateway" });
  await client.say("/help");
  assert.match(client.lastText(), /CaptainBlackByte@yandex\.ru/);

  tg.failNext("sendMessage", { network: true });
  await client.say("/privacy");
  assert.match(client.lastText(), /Шаройко/);

  tg.failNext("sendMessage", { code: 429, description: "Too Many Requests", retryAfter: 1 });
  await client.say("/orders");
  assert.equal(client.lastText(), TEXT.noOrders);
});

test("опрос переживает обрыв сети и конфликт копий", async (t) => {
  const { tg, client, logs } = await setup(t);

  tg.failNext("getUpdates", { network: true });
  await tg.tick();
  assert.ok(logs.some((line) => line.includes("Не удалось получить обновления")));

  tg.failNext("getUpdates", { code: 409, description: "Conflict: terminated by other getUpdates request" });
  await tg.tick();
  assert.ok(logs.some((line) => line.includes("ещё одна копия бота")));

  await client.say("/orders");
  assert.equal(client.lastText(), TEXT.noOrders);
});

test("менеджер ведёт заявку: в работу, завершение, клиент в курсе", async (t) => {
  const { client, manager, state } = await setup(t);
  await placeOrder(client);

  await manager.tap(TEXT.take);
  assert.equal(state().orders[0].status, "work");
  assert.equal(state().orders[0].manager, "Николай");
  assert.equal(client.lastText(), TEXT.statusNotice.work(1001));
  assert.ok(manager.botMessages()[0].text.includes(STATUS.work));
  assert.ok(manager.botMessages()[0].text.includes("Николай"));
  assert.equal(manager.findButton(TEXT.take), null);

  await manager.tap(TEXT.finish);
  assert.equal(state().orders[0].status, "work", "сначала подтверждение");
  await manager.tap(TEXT.back);
  assert.equal(state().orders[0].status, "work");
  assert.ok(manager.findButton(TEXT.finish));

  await manager.tap(TEXT.finish);
  await manager.tap(TEXT.confirmDone);
  assert.equal(state().orders[0].status, "done");
  assert.equal(client.lastText(), TEXT.statusNotice.done(1001));
  assert.ok(manager.botMessages()[0].text.includes(STATUS.done));
  assert.equal(manager.botMessages()[0].reply_markup, undefined, "у закрытой заявки нет кнопок");
});

test("менеджер отклоняет заявку только после подтверждения", async (t) => {
  const { client, manager, state } = await setup(t);
  await placeOrder(client);

  await manager.tap(TEXT.reject);
  assert.equal(state().orders[0].status, "new");
  assert.equal(client.lastText(), TEXT.accepted(1001), "клиент ещё ничего не получил");

  await manager.tap(TEXT.confirmReject);
  assert.equal(state().orders[0].status, "rejected");
  assert.equal(client.lastText(), TEXT.statusNotice.rejected(1001));
});

test("устаревшая кнопка менеджера не меняет статус повторно", async (t) => {
  const { client, manager, state } = await setup(t);
  await placeOrder(client);

  const { message, button } = manager.findButton(TEXT.take);
  const stale = { ...message };
  await manager.tap(TEXT.take);
  const before = client.botMessages().length;

  const notice = await manager.tapData(stale, button.callback_data);
  assert.equal(notice, TEXT.alreadyChanged);
  assert.equal(client.botMessages().length, before, "клиент не получает повторное уведомление");
  assert.equal(state().orders[0].status, "work");
});

test("клиент не может нажимать кнопки менеджера", async (t) => {
  const { client, state } = await setup(t);
  await placeOrder(client);

  const notice = await client.tapData(client.botMessages().at(-1), "o:1001:take");
  assert.equal(notice, TEXT.notAllowed);
  assert.equal(state().orders[0].status, "new");
});

test("клиент заблокировал бота: статус меняется, менеджер предупреждён", async (t) => {
  const { tg, client, manager, state } = await setup(t);
  await placeOrder(client);
  tg.block(client.chatId);

  const notice = await manager.tap(TEXT.take);
  assert.equal(state().orders[0].status, "work");
  assert.equal(notice, TEXT.clientNotNotified);
});

test("переписка: сообщения клиента и ответы менеджера ходят в обе стороны", async (t) => {
  const { tg, client, manager } = await setup(t);
  await placeOrder(client);
  const [card] = manager.botMessages();

  const question = await client.say("Забыл добавить: нужен iOS?");
  assert.equal(question.reaction, "👍");
  const copy = manager.botMessages().at(-1);
  assert.equal(copy.text, "Забыл добавить: нужен iOS?");
  assert.equal(copy.reply_parameters.message_id, card.message_id, "сообщение привязано к карточке");

  const answer = await manager.reply(copy, "Пока только Android");
  assert.equal(client.lastText(), "Пока только Android");
  assert.equal(answer.reaction, "👍");

  await manager.reply(card, "И ещё вопрос по срокам");
  assert.equal(client.lastText(), "И ещё вопрос по срокам");

  tg.block(client.chatId);
  await manager.reply(card, "Вы здесь?");
  assert.equal(manager.lastText(), TEXT.clientBlocked);
});

test("без открытых заявок сообщения клиента не уходят менеджеру", async (t) => {
  const { client, manager, state } = await setup(t);

  await client.say("Здравствуйте");
  assert.equal(client.lastText(), TEXT.idle);
  assert.equal(manager.botMessages().length, 0);

  await placeOrder(client);
  await manager.tap(TEXT.reject);
  await manager.tap(TEXT.confirmReject);
  const before = manager.botMessages().length;
  await client.say("А почему?");
  assert.equal(client.lastText(), TEXT.idle);
  assert.equal(manager.botMessages().length, before);
  assert.equal(state().orders[0].outbox.length, 0);
});

test("вложения: файл вместо описания, альбом и удалённое сообщение", async (t) => {
  const { tg, client, manager, state } = await setup(t);

  await client.say("/new");
  await client.send({ document: { file_id: "brief" }, caption: "Техзадание в файле" });
  assert.equal(client.lastText(), consentText(""));
  assert.equal(state().drafts[client.chatId].answers.task, "Техзадание в файле");
  await client.tap(TEXT.consentYes);

  const before = client.botMessages().length;
  const album = [
    await client.send({ photo: [{ file_id: "p1" }], media_group_id: "g1" }),
    await client.send({ photo: [{ file_id: "p2" }], media_group_id: "g1" }),
    await client.send({ photo: [{ file_id: "p3" }], media_group_id: "g1" }),
  ];
  assert.equal(client.botMessages().length, before + 2, "на альбом одно подтверждение и повтор вопроса");
  assert.equal(client.lastText(), QUESTIONS.name);

  await client.tap("Иван");
  await client.say(TEXT.contactHere);
  assert.match(client.lastText(), /Вложения: 4/);

  tg.forgetMessage(client.chatId, album[1].message_id);
  await client.tap(TEXT.submit);

  const [card, ...rest] = manager.botMessages();
  assert.match(card.text, /Вложения: 4/);
  assert.deepEqual(rest.map((message) => message.document?.file_id ?? message.photo?.[0].file_id ?? "note"), ["brief", "p1", "note", "p3"]);
  assert.equal(rest[2].text, TEXT.copyFailed(1001));
  assert.ok(rest.every((message) => message.reply_parameters.message_id === card.message_id));
});

test("голосовое без подписи становится описанием, а файл не затирает текст при правке", async (t) => {
  const { client, manager, state } = await setup(t);

  await client.say("/new");
  await client.send({ voice: { file_id: "voice" } });
  assert.equal(state().drafts[client.chatId].answers.task, TEXT.taskInAttachment);
  await client.tap(TEXT.consentYes);
  await client.tap("Иван");
  await client.say(TEXT.contactHere);

  await client.tap(TEXT.edit);
  await client.tap("Задача");
  await client.say("Теперь текстом");
  await client.tap(TEXT.edit);
  await client.tap("Задача");
  await client.send({ document: { file_id: "extra" } });
  assert.equal(state().drafts[client.chatId].answers.task, "Теперь текстом");
  assert.equal(state().drafts[client.chatId].step, "review");

  await client.tap(TEXT.submit);
  assert.equal(manager.botMessages().filter((message) => message.voice || message.document).length, 2);
});

test("больше 10 вложений не принимаем и говорим об этом", async (t) => {
  const { client, state } = await setup(t);

  await client.say("/new");
  for (let index = 0; index < 11; index += 1) await client.send({ document: { file_id: `f${index}` } });
  assert.equal(state().drafts[client.chatId].attachments.length, 10);
  assert.ok(client.botMessages().some((message) => message.text === TEXT.attachmentLimit));
});

test("стикер в анкете не принимается, стикер после заявки передаётся", async (t) => {
  const { client, manager, state } = await setup(t);

  await client.say("/new");
  await client.send({ sticker: { file_id: "cat" } });
  assert.equal(client.lastText(), QUESTIONS.task);
  assert.ok(client.botMessages().some((message) => message.text === TEXT.unsupported));
  assert.equal(state().drafts[client.chatId].step, "task");

  await client.say("/cancel");
  await placeOrder(client);
  await client.send({ sticker: { file_id: "cat" } });
  assert.equal(manager.botMessages().at(-1).sticker.file_id, "cat");
});

test("служебные сообщения клиента игнорируются", async (t) => {
  const { client, manager } = await setup(t);
  await placeOrder(client);
  const before = [client.botMessages().length, manager.botMessages().length];
  await client.send({ write_access_allowed: {} });
  assert.deepEqual([client.botMessages().length, manager.botMessages().length], before);
});

test("лимит заявок за сутки", async (t) => {
  const { client, clock, state } = await setup(t);

  for (let index = 0; index < 5; index += 1) await placeOrder(client);
  assert.equal(state().orders.length, 5);

  await client.say("/new");
  assert.equal(client.lastText(), TEXT.tooManyOrders);
  assert.equal(state().drafts[client.chatId], undefined);

  clock.time += 24 * 60 * 60 * 1000 + 1000;
  await client.say("/new");
  assert.equal(client.lastText(), QUESTIONS.task);
});

test("поток сообщений клиента ограничен, менеджера не заваливает", async (t) => {
  const { client, manager, clock } = await setup(t);
  await placeOrder(client);
  const start = manager.botMessages().length;

  for (let index = 0; index < 30; index += 1) await client.say(`Сообщение ${index}`);
  assert.equal(manager.botMessages().length, start + 30);

  await client.say("Лишнее 1");
  assert.equal(client.lastText(), TEXT.relayLimit);
  const replies = client.botMessages().length;
  await client.say("Лишнее 2");
  assert.equal(client.botMessages().length, replies, "предупреждаем один раз");
  assert.equal(manager.botMessages().length, start + 30);

  clock.time += 11 * 60 * 1000;
  await client.say("Снова можно");
  assert.equal(manager.botMessages().at(-1).text, "Снова можно");
});

test("согласие спрашиваем один раз, отказ удаляет анкету", async (t) => {
  const { client, state } = await setup(t, { privacyUrl: "https://captainblackbyte.ru/privacy?a=1&b=2" });

  await client.say("/new");
  await client.say("Задача");
  assert.match(client.botMessages().at(-1).html, /href="https:\/\/captainblackbyte\.ru\/privacy\?a=1&amp;b=2"/);
  await client.say("да");
  assert.equal(client.lastText().includes("Даёте согласие"), true, "текст согласием не считается");
  assert.equal(state().consents[client.chatId], undefined);
  await client.tap(TEXT.consentNo);
  assert.equal(client.lastText(), TEXT.consentDeclined);
  assert.equal(state().drafts[client.chatId], undefined);
  assert.equal(state().orders.length, 0);
  assert.equal(state().consents[client.chatId], undefined);

  await placeOrder(client);
  assert.ok(state().consents[client.chatId]);
  const asked = () => client.botMessages().filter((message) => message.text.includes("Даёте согласие")).length;
  const before = asked();
  await placeOrder(client);
  assert.equal(asked(), before, "второй раз не спрашиваем");
  assert.equal(state().orders[1].consentAt, state().orders[0].consentAt);
});

test("контакт: номер кнопкой, email текстом, ерунда не проходит", async (t) => {
  const { tg, client, state } = await setup(t);
  await client.say("/new");
  await client.say("Задача");
  await client.tap(TEXT.consentYes);
  await client.say("Анна");
  assert.equal(state().drafts[client.chatId].answers.name, "Анна");

  await client.say("завтра");
  assert.equal(client.lastText(), TEXT.contactInvalid);
  assert.ok(tg.replyKeyboard(client.chatId), "клавиатура остаётся");

  await client.send({ contact: { phone_number: "79991234567", first_name: "Иван", user_id: client.chatId } });
  assert.equal(state().drafts[client.chatId].answers.contact, "+79991234567");
  assert.equal(tg.replyKeyboard(client.chatId), null);

  await client.tap(TEXT.edit);
  await client.tap("Контакт");
  await client.say("anna@example.com");
  assert.equal(state().drafts[client.chatId].answers.contact, "anna@example.com");
  assert.match(client.lastText(), /anna@example\.com/);
});

test("правка из проверки возвращает к проверке и сохраняет остальные ответы", async (t) => {
  const { client, manager, state } = await setup(t);
  await reachReview(client);

  await client.tap(TEXT.edit);
  await client.tap(TEXT.back);
  assert.ok(client.findButton(TEXT.submit));

  await client.tap(TEXT.edit);
  await client.tap("Имя");
  assert.equal(client.lastText(), QUESTIONS.name);
  await client.say("Анна");
  assert.match(client.lastText(), /Проверьте заявку/);
  assert.ok(client.lastText().includes("Анна"));

  await client.tap(TEXT.submit);
  assert.equal(state().orders[0].answers.name, "Анна");
  assert.equal(state().orders[0].answers.task, "Приложение для курьеров");
  assert.ok(manager.botMessages()[0].text.includes("Анна"));
});

test("отмена удаляет анкету и убирает клавиатуру", async (t) => {
  const { tg, client, state } = await setup(t);

  await client.say("/cancel");
  assert.equal(client.lastText(), TEXT.nothingToCancel);

  await client.say("/new");
  await client.say("Задача");
  await client.tap(TEXT.consentYes);
  await client.tap("Иван");
  assert.ok(tg.replyKeyboard(client.chatId));

  await client.say("/cancel");
  assert.equal(client.lastText(), TEXT.cancelled);
  assert.equal(tg.replyKeyboard(client.chatId), null);
  assert.equal(state().drafts[client.chatId], undefined);

  await reachReview(client);
  await client.tap(TEXT.cancel);
  assert.equal(client.lastText(), TEXT.cancelled);
  assert.equal(state().orders.length, 0);
});

test("/new заново убирает клавиатуру контакта", async (t) => {
  const { tg, client } = await setup(t);
  await client.say("/new");
  await client.say("Задача");
  await client.tap(TEXT.consentYes);
  await client.say("Иван");
  assert.ok(tg.replyKeyboard(client.chatId));
  await client.say("/new");
  assert.equal(tg.replyKeyboard(client.chatId), null);
  assert.equal(client.lastText(), QUESTIONS.task);
});

test("/start после заявки показывает её статус, /orders показывает список", async (t) => {
  const { client, manager } = await setup(t);
  await placeOrder(client, { task: "Приложение\nдля\nкурьеров" });

  await client.say("/start");
  assert.equal(client.lastText(), TEXT.hasOpenOrder({ id: 1001, status: "new" }));

  await client.say("/orders");
  assert.match(client.lastText(), /№1001/);
  assert.ok(client.lastText().includes("Приложение для курьеров"), "описание в одну строку");

  await manager.tap(TEXT.reject);
  await manager.tap(TEXT.confirmReject);
  await client.say("/start");
  assert.equal(client.lastText(), QUESTIONS.task, "закрытая заявка не мешает начать новую");
});

test("неизвестная команда и забытая анкета", async (t) => {
  const { client, clock, tg, state, logs } = await setup(t);

  await client.say("/unknown");
  assert.equal(client.lastText(), TEXT.unknownCommand);

  await client.say("/new");
  clock.time += 6 * 24 * 60 * 60 * 1000;
  await tg.tick();
  assert.ok(state().drafts[client.chatId], "неделя ещё не прошла");
  clock.time += 2 * 24 * 60 * 60 * 1000;
  await tg.tick();
  assert.equal(state().drafts[client.chatId], undefined, "старая анкета удаляется");
  assert.deepEqual(logs.filter((line) => line.startsWith("error")), []);
});

test("заявка удаляется через 3 года после последнего обращения", async (t) => {
  const { client, clock, tg, state } = await setup(t);
  const year = 365 * 24 * 60 * 60 * 1000;

  await placeOrder(client);
  clock.time += 2 * year;
  await client.say("Ещё один вопрос");
  assert.equal(state().orders.length, 1);

  clock.time += 2 * year;
  await tg.tick();
  assert.equal(state().orders.length, 1, "3 года считаются с последнего сообщения, а не с заявки");

  clock.time += year + 1000;
  await tg.tick();
  assert.equal(state().orders.length, 0);
  assert.deepEqual(state().links, {});
  assert.equal(state().consents[client.chatId], undefined);
  assert.equal(state().nextOrderId, 1002, "номера удалённых заявок не повторяются");

  await client.say("Здравствуйте");
  assert.equal(client.lastText(), TEXT.idle);
});

test("команды менеджера: список и повторная карточка", async (t) => {
  const { client, manager, state } = await setup(t);

  await manager.say("/orders");
  assert.equal(manager.lastText(), TEXT.noOpenOrders);

  await placeOrder(client);
  await manager.say("/orders");
  assert.match(manager.lastText(), /\/order_1001/);
  assert.ok(manager.lastText().includes("Приложение для курьеров"));

  await manager.say("/order_1001", {});
  const card = manager.lastText();
  assert.match(card, /Заявка №1001/);
  assert.equal(manager.findButton(TEXT.take).message.text, card);

  await manager.say("/order_9999");
  assert.equal(manager.lastText(), TEXT.orderMissing);

  await client.say("Новый вопрос");
  const copy = manager.botMessages().at(-1);
  assert.equal(copy.reply_parameters.message_id, state().orders[0].cardMessageId, "сообщения идут к свежей карточке");
});

test("удаление заявки по просьбе клиента стирает его данные", async (t) => {
  const { client, manager, state } = await setup(t);
  await placeOrder(client);
  const [card] = manager.botMessages();

  await client.say("/delete_1001");
  assert.equal(client.lastText(), TEXT.unknownCommand, "клиенту команда недоступна");
  assert.equal(state().orders.length, 1);

  await manager.say("/delete_9999");
  assert.equal(manager.lastText(), TEXT.orderMissing);

  await manager.say("/delete_1001");
  assert.equal(manager.lastText(), TEXT.orderDeleted);
  assert.equal(state().orders.length, 0);
  assert.deepEqual(state().links, {});
  assert.equal(state().consents[client.chatId], undefined);

  const before = manager.botMessages().length;
  await client.say("Вы здесь?");
  assert.equal(client.lastText(), TEXT.idle);
  assert.equal(manager.botMessages().length, before);

  const answers = client.botMessages().length;
  await manager.reply(card, "Ответ на удалённую заявку");
  assert.equal(client.botMessages().length, answers, "ответ на удалённую заявку клиенту не уходит");

  await placeOrder(client);
  assert.equal(state().orders[0].id, 1002, "номера заявок не повторяются");
});

test("менеджер в группе: команды, ответы и чужие чаты", async (t) => {
  const { tg, client, state } = await setup(t, { managerChatId: -100500 });
  const boss = tg.user({ id: 900, first_name: "Николай" }, { chatId: -100500, chatType: "supergroup" });
  const stranger = tg.user({ id: 555, first_name: "Чужой" }, { chatId: -777, chatType: "group" });
  await tg.tick();

  await placeOrder(client);
  const [card] = boss.botMessages();
  assert.match(card.text, /Заявка №1001/);

  await boss.say("/orders@test_bot");
  assert.match(boss.lastText(), /\/order_1001/);
  const list = boss.botMessages().at(-1);
  const count = boss.botMessages().length;

  await boss.say("/orders@other_bot");
  await boss.say("обсуждаем между собой");
  assert.equal(boss.botMessages().length, count, "в группе бот не отвечает на обычные сообщения");

  await boss.reply(list, "ответ не туда");
  assert.equal(boss.lastText(), TEXT.replyNotLinked);

  await boss.reply(card, "Ответ клиенту");
  assert.equal(client.lastText(), "Ответ клиенту");

  await boss.tap(TEXT.take);
  assert.equal(state().orders[0].status, "work");

  await stranger.say("/new");
  await stranger.say("текст");
  assert.equal(stranger.botMessages().length, 0, "в чужих группах бот молчит");
  assert.equal(state().drafts[-777], undefined);
  await stranger.say("/id");
  assert.match(stranger.lastText(), /-777/);
});

test("менеджер в личном чате может сам проверить анкету", async (t) => {
  const { manager, state } = await setup(t);

  await placeOrder(manager);
  const order = state().orders[0];
  assert.equal(order.client.chatId, MANAGER_ID);

  const card = manager.botMessages().find((message) => message.text.includes("Заявка №1001 ·") || message.reply_markup);
  assert.ok(card);
  await manager.reply(card, "Ответ самому себе");
  await manager.tap(TEXT.take);
  assert.equal(state().orders[0].status, "work");
  assert.equal(manager.lastText(), TEXT.statusNotice.work(1001));
});

test("повреждённый файл данных не затирается", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-test-"));
  const file = path.join(dir, "state.json");
  await writeFile(file, "{broken");
  assert.throws(() => openStore(file), /повреждён/);
  assert.equal(await readFile(file, "utf8"), "{broken");
  await rm(dir, { recursive: true, force: true });
});

test("сбой записи на диск логируется и не роняет бота", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-test-"));
  const logs = [];
  const store = openStore(path.join(dir, "state.json"), { error: (line) => logs.push(line) });
  await rm(dir, { recursive: true, force: true });
  await store.save();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Не удалось сохранить/);
});
