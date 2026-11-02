import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createInbox } from "../inbox/inbox.mjs";
import { createBot } from "../src/bot.js";
import { openStore } from "../src/store.js";
import { createTelegram } from "../src/telegram.js";
import { STATUS, TEXT } from "../src/texts.js";
import { startFakeTelegram } from "./fake-telegram.js";

const TOKEN = "test-inbox-token";
const ORIGIN = "https://captainblackbyte.ru";
const MANAGER_ID = 900;
const quiet = { info() {}, warn() {}, error() {} };
const valid = { name: "Иван", contact: "ivan@example.com", message: "Нужен кабинет продаж", consent: true };

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-inbox-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

async function startInbox(t, { dir, file, log = quiet, now } = {}) {
  const target = file ?? path.join(dir ?? (await tempDir(t)), "inbox.json");
  const server = createInbox({ token: TOKEN, file: target, allowedOrigins: [ORIGIN], log, now });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/orders`;
  const stop = () => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
  t.after(stop);
  return { url, file: target, stop };
}

const send = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const pending = (url, token = TOKEN) => fetch(`${url}/pending`, { headers: { authorization: `Bearer ${token}` } });

test("заявка с формы ждёт бота, переживает перезапуск и удаляется после подтверждения", async (t) => {
  const dir = await tempDir(t);
  const first = await startInbox(t, { dir });

  const response = await send(first.url, valid, { origin: ORIGIN });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  await first.stop();

  const second = await startInbox(t, { dir });
  const { orders } = await (await pending(second.url)).json();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].name, "Иван");
  assert.equal(orders[0].contact, "ivan@example.com");
  assert.equal(orders[0].message, "Нужен кабинет продаж");
  assert.ok(orders[0].id);
  assert.ok(orders[0].consentAt);
  assert.equal(orders[0].consent, undefined);

  const ack = await send(`${second.url}/ack`, { ids: [orders[0].id] }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(ack.status, 200);
  assert.deepEqual((await (await pending(second.url)).json()).orders, []);
  assert.deepEqual(JSON.parse(await readFile(second.file, "utf8")), [], "с сервера заявка удаляется");
});

test("форма не принимает неполные и странные заявки", async (t) => {
  const { url } = await startInbox(t);
  const expectError = async (body, status, error) => {
    const response = await send(url, body);
    assert.equal(response.status, status, JSON.stringify(body).slice(0, 80));
    assert.equal((await response.json()).error, error);
  };

  await expectError({ ...valid, name: "  " }, 400, "missing");
  await expectError({ ...valid, contact: undefined }, 400, "missing");
  await expectError({ ...valid, message: 5 }, 400, "missing");
  await expectError({ ...valid, consent: false }, 400, "consent");
  await expectError({ ...valid, consent: "on" }, 400, "consent");
  await expectError({ ...valid, contact: "завтра" }, 400, "contact");
  await expectError({ ...valid, name: "я".repeat(101) }, 400, "too-long");
  await expectError({ ...valid, message: "я".repeat(8001) }, 400, "too-long");
  await expectError("{not json", 400, "bad-json");
  await expectError("null", 400, "missing");
  await expectError({ ...valid, message: "я".repeat(40000) }, 413, "too-large");

  assert.deepEqual((await (await pending(url)).json()).orders, []);
});

test("заявки принимаются только со своего сайта, а забрать их можно только с ключом", async (t) => {
  const { url } = await startInbox(t);

  const foreign = await send(url, valid, { origin: "https://evil.example" });
  assert.equal(foreign.status, 403);

  assert.equal((await fetch(`${url}/pending`)).status, 401);
  assert.equal((await pending(url, "wrong")).status, 401);
  assert.equal((await send(`${url}/ack`, { ids: [] })).status, 401);
  assert.equal((await send(`${url}/ack`, { ids: [] }, { authorization: "Bearer wrong" })).status, 401);

  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(`${url}/other`)).status, 404);
  assert.equal((await fetch(`${url}/pending`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } })).status, 404);
  assert.equal((await send(`${url}/ack`, { ids: "x" }, { authorization: `Bearer ${TOKEN}` })).status, 400);
});

test("поток заявок с одного адреса ограничен", async (t) => {
  const clock = { time: Date.parse("2026-11-02T10:00:00Z") };
  const { url } = await startInbox(t, { now: () => clock.time });
  const from = (ip) => ({ "x-real-ip": ip });

  for (let index = 0; index < 5; index += 1) assert.equal((await send(url, valid, from("1.1.1.1"))).status, 201);
  const blocked = await send(url, valid, from("1.1.1.1"));
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, "too-many");
  assert.equal((await send(url, valid, from("2.2.2.2"))).status, 201, "другой адрес не блокируется");

  clock.time += 60 * 60 * 1000 + 1000;
  assert.equal((await send(url, valid, from("1.1.1.1"))).status, 201);
});

test("одновременные заявки не теряются, очередь ограничена", async (t) => {
  const { url, file } = await startInbox(t);

  const statuses = await Promise.all(
    Array.from({ length: 20 }, (_, index) => send(url, { ...valid, name: `Клиент ${index}` }, { "x-real-ip": `10.0.0.${index}` }).then((response) => response.status)),
  );
  assert.ok(statuses.every((status) => status === 201));
  assert.equal(JSON.parse(await readFile(file, "utf8")).length, 20);

  for (let index = 20; index < 500; index += 1) await send(url, valid, { "x-real-ip": `10.0.1.${index}` });
  const full = await send(url, valid, { "x-real-ip": "10.0.2.1" });
  assert.equal(full.status, 503);
});

test("повреждённая очередь не затирается, без ключа приём не запускается", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "inbox.json");
  await writeFile(file, "{broken");
  assert.throws(() => createInbox({ token: TOKEN, file, allowedOrigins: [ORIGIN] }), /повреждён/);
  assert.equal(await readFile(file, "utf8"), "{broken");
  assert.throws(() => createInbox({ token: "", file: path.join(dir, "other.json"), allowedOrigins: [ORIGIN] }), /INBOX_TOKEN/);
});

async function startBot(t, { inboxUrl, logs = [] }) {
  const tg = await startFakeTelegram();
  const dir = await tempDir(t);
  const manager = tg.user({ id: MANAGER_ID, first_name: "Николай" });
  const clock = { time: Date.parse("2026-11-02T10:00:00Z") };
  const log = { info() {}, warn: (line) => logs.push(line), error: (line) => logs.push(line) };
  const store = openStore(path.join(dir, "state.json"), log);
  const controller = new AbortController();
  const bot = createBot({
    telegram: createTelegram({ token: tg.token, apiRoot: tg.url, retryDelayMs: 1 }),
    store,
    managerChatId: MANAGER_ID,
    inbox: { url: inboxUrl, token: TOKEN },
    log,
    backoffMs: 1,
    now: () => clock.time,
  });
  const ready = tg.idle();
  const done = bot.run({ signal: controller.signal });
  await ready;
  t.after(async () => {
    controller.abort();
    await done;
    await tg.close();
    assert.ok(!logs.join("\n").includes(TOKEN), "ключ попал в лог");
  });
  const nextPull = async () => {
    clock.time += 6000;
    await tg.tick();
  };
  return { tg, manager, state: () => store.state, nextPull, clock, logs };
}

test("заявка с формы доходит до чата менеджера карточкой", async (t) => {
  const inbox = await startInbox(t);
  const { manager, state, nextPull } = await startBot(t, { inboxUrl: inbox.url });

  await send(inbox.url, { ...valid, name: "<Анна&>", message: "Задача <script>" });
  await nextPull();

  const [card] = manager.botMessages();
  assert.ok(card, "карточка должна прийти");
  for (const part of ["Заявка №1001", STATUS.new, "<Анна&>", "ivan@example.com", "Задача <script>", TEXT.sourceSite, TEXT.cardHintSite]) {
    assert.ok(card.text.includes(part), `нет в карточке: ${part}`);
  }
  assert.ok(!card.text.includes("Telegram:"));

  assert.equal(state().orders[0].client.chatId, null);
  assert.ok(state().orders[0].consentAt);
  assert.deepEqual((await (await pending(inbox.url)).json()).orders, [], "с сервера заявка удалена после записи в базу");
});

test("менеджер работает с заявкой с сайта: статусы и ответ без чата клиента", async (t) => {
  const inbox = await startInbox(t);
  const { tg, manager, state, nextPull } = await startBot(t, { inboxUrl: inbox.url });

  await send(inbox.url, valid);
  await nextPull();
  const [card] = manager.botMessages();

  const before = tg.calls.filter((call) => call.method === "copyMessage").length;
  await manager.reply(card, "Здравствуйте");
  assert.equal(manager.lastText(), TEXT.siteOrderReply);
  assert.equal(tg.calls.filter((call) => call.method === "copyMessage").length, before);

  assert.equal(await manager.tap(TEXT.take), STATUS.work);
  assert.equal(state().orders[0].status, "work");
  await manager.tap(TEXT.finish);
  assert.equal(await manager.tap(TEXT.confirmDone), STATUS.done);
  assert.equal(state().orders[0].status, "done");

  await manager.say("/delete_1001");
  assert.equal(manager.lastText(), TEXT.orderDeleted);
  assert.equal(state().orders.length, 0);
});

test("длинное описание с формы доходит целиком", async (t) => {
  const inbox = await startInbox(t);
  const { manager, state, nextPull } = await startBot(t, { inboxUrl: inbox.url });
  const message = "ф".repeat(7999);

  await send(inbox.url, { ...valid, message });
  await nextPull();

  const [card, ...parts] = manager.botMessages();
  const head = card.text.split("Задача:\n")[1].split("…")[0];
  assert.equal(head + parts.map((item) => item.text).join(""), message);
  assert.equal(state().orders[0].answers.task, message);
});

test("сбой подтверждения не создаёт вторую заявку", async (t) => {
  const inbox = await startInbox(t);
  const { manager, state, nextPull, logs } = await startBot(t, { inboxUrl: inbox.url });

  await send(inbox.url, valid);
  const { orders } = await (await pending(inbox.url)).json();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => (String(url).endsWith("/ack") ? Promise.reject(new Error("сеть пропала")) : realFetch(url, init));
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  await nextPull();
  assert.equal(state().orders.length, 1);
  assert.ok(logs.some((line) => line.includes("сеть пропала")));
  assert.equal((await (await realFetch(`${inbox.url}/pending`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()).orders[0].id, orders[0].id);

  globalThis.fetch = realFetch;
  await nextPull();
  await nextPull();
  await nextPull();
  await nextPull();
  await nextPull();
  await nextPull();
  assert.equal(state().orders.length, 1, "повторная доставка не считается новой заявкой");
  assert.equal(manager.botMessages().filter((item) => /Заявка №/.test(item.text)).length, 1);
  assert.deepEqual((await (await pending(inbox.url)).json()).orders, []);
});

test("недоступный приём заявок не мешает боту, заявки приходят после восстановления", async (t) => {
  const dir = await tempDir(t);
  const inbox = await startInbox(t, { dir });
  await send(inbox.url, valid);
  const port = new URL(inbox.url).port;
  await inbox.stop();

  const { tg, manager, state, nextPull, clock, logs } = await startBot(t, { inboxUrl: inbox.url });
  await nextPull();
  assert.equal(state().orders.length, 0);
  assert.ok(logs.some((line) => line.includes("Не удалось забрать заявки")));

  const client = tg.user({ id: 101, first_name: "Иван" });
  await client.say("/help");
  assert.match(client.lastText(), /CaptainBlackByte/, "бот отвечает как обычно");

  const server = createInbox({ token: TOKEN, file: path.join(dir, "inbox.json"), allowedOrigins: [ORIGIN], log: quiet });
  await new Promise((resolve) => server.listen(Number(port), "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  await nextPull();
  assert.equal(state().orders.length, 0, "повтор не раньше, чем через 30 секунд");
  clock.time += 31000;
  await tg.tick();
  assert.equal(state().orders.length, 1);
  assert.ok(manager.botMessages().some((item) => /Заявка №1001/.test(item.text)));
});

test("неверный ключ бот сообщает в журнал и не падает", async (t) => {
  const inbox = await startInbox(t);
  const server = createInbox({ token: "other-key", file: `${inbox.file}.other`, allowedOrigins: [ORIGIN], log: quiet });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const { state, nextPull, logs } = await startBot(t, { inboxUrl: `http://127.0.0.1:${server.address().port}/api/orders` });
  await nextPull();
  assert.ok(logs.some((line) => line.includes("401")));
  assert.equal(state().orders.length, 0);
});
