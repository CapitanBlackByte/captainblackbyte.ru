import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TEXT, consentText } from "../src/texts.js";
import { startFakeTelegram } from "./fake-telegram.js";

const BOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANAGER_ID = 900;
const CHILD_LIMIT_MS = 30000;

const limitLifetime = (child) => setTimeout(() => child.kill("SIGKILL"), CHILD_LIMIT_MS).unref();

function launch(env, args = ["src/index.js"]) {
  const child = spawn(process.execPath, args, {
    cwd: BOT_DIR,
    env: { ...process.env, BOT_TOKEN: "", MANAGER_CHAT_ID: "", MANAGER_USERNAME: "", PRIVACY_URL: "", TELEGRAM_API_ROOT: "", DATA_FILE: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  limitLifetime(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  return { child, exited: once(child, "exit"), output: () => output };
}

async function tempFile(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-process-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return path.join(dir, "state.json");
}

test("без токена бот объясняет, что делать", async () => {
  const { exited, output } = launch({});
  const [code] = await exited;
  assert.equal(code, 1);
  assert.match(output(), /BOT_TOKEN/);
});

test("неверный ID менеджера останавливает запуск", async () => {
  const { exited, output } = launch({ BOT_TOKEN: "x", MANAGER_CHAT_ID: "abc" });
  const [code] = await exited;
  assert.equal(code, 1);
  assert.match(output(), /MANAGER_CHAT_ID/);
});

test("повреждённый файл данных останавливает запуск без затирания", async (t) => {
  const file = await tempFile(t);
  await writeFile(file, "{broken");
  const { exited, output } = launch({ BOT_TOKEN: "x", DATA_FILE: file });
  const [code] = await exited;
  assert.equal(code, 1);
  assert.match(output(), /повреждён/);
  assert.equal(await readFile(file, "utf8"), "{broken");
});

test("токен, который Telegram не принял, не попадает в вывод", async (t) => {
  const tg = await startFakeTelegram();
  t.after(() => tg.close());
  const file = await tempFile(t);
  const secret = "999999:SECRET-WRONG-TOKEN";
  const { exited, output } = launch({ BOT_TOKEN: secret, TELEGRAM_API_ROOT: tg.url, DATA_FILE: file });
  const [code] = await exited;
  assert.equal(code, 1);
  assert.match(output(), /не принял токен/);
  assert.ok(!output().includes(secret));
});

test("недоступный Telegram: бот ждёт, а токен не попадает в лог", async (t) => {
  const file = await tempFile(t);
  const secret = "999999:SECRET-TOKEN";
  const { child, exited, output } = launch({ BOT_TOKEN: secret, TELEGRAM_API_ROOT: "http://127.0.0.1:9", DATA_FILE: file });
  t.after(() => child.kill("SIGKILL"));
  const deadline = Date.now() + 10000;
  while (!output().includes("Telegram недоступен")) {
    assert.ok(Date.now() < deadline, "бот не сообщил о недоступном Telegram");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(child.exitCode, null, "бот продолжает работать");
  assert.ok(output().includes("TELEGRAM_API_ROOT"), "лог подсказывает про релей");
  assert.ok(!output().includes(secret));
  child.kill("SIGKILL");
  await exited;
});

test("настройки читаются из .env рядом с ботом, данные ложатся в data/", async (t) => {
  const tg = await startFakeTelegram();
  t.after(() => tg.close());
  const dir = path.dirname(await tempFile(t));
  await cp(path.join(BOT_DIR, "src"), path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(dir, ".env"),
    [`# комментарий`, `BOT_TOKEN=${tg.token}`, `MANAGER_CHAT_ID=${MANAGER_ID}`, "PRIVACY_URL=", `TELEGRAM_API_ROOT=${tg.url}`, "DATA_FILE=", ""].join("\n"),
  );
  const manager = tg.user({ id: MANAGER_ID, first_name: "Николай" });

  const env = { ...process.env };
  for (const name of ["BOT_TOKEN", "MANAGER_CHAT_ID", "MANAGER_USERNAME", "PRIVACY_URL", "TELEGRAM_API_ROOT", "DATA_FILE"]) delete env[name];
  const ready = tg.idle();
  const child = spawn(process.execPath, ["src/index.js"], { cwd: dir, env, stdio: "ignore" });
  limitLifetime(child);
  const exited = once(child, "exit");
  try {
    await ready;
    await manager.say("/orders");
    assert.equal(manager.lastText(), TEXT.noOpenOrders, "ID менеджера взят из .env");
    assert.ok(JSON.parse(await readFile(path.join(dir, "data", "state.json"), "utf8")).orders);
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
});

test("сигнал остановки: бот сохраняет данные и завершается сам", async (t) => {
  const tg = await startFakeTelegram();
  t.after(() => tg.close());
  const file = await tempFile(t);
  const ready = tg.idle();
  const script = 'await import("./src/index.js"); process.on("message", () => { process.disconnect(); process.emit("SIGTERM"); });';
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: BOT_DIR,
    env: { ...process.env, BOT_TOKEN: tg.token, TELEGRAM_API_ROOT: tg.url, MANAGER_CHAT_ID: "", MANAGER_USERNAME: "", PRIVACY_URL: "", DATA_FILE: file },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  limitLifetime(child);
  t.after(() => child.kill("SIGKILL"));
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  await ready;
  const exited = once(child, "exit");
  child.send("stop");
  const [code] = await exited;
  assert.equal(code, 0);
  assert.match(output, /Бот остановлен/);
  assert.ok(JSON.parse(await readFile(file, "utf8")).orders);
});

test("вторая копия с тем же файлом заявок не запускается, а после первой запускается", async (t) => {
  const tg = await startFakeTelegram();
  t.after(() => tg.close());
  const file = await tempFile(t);
  const env = { BOT_TOKEN: tg.token, TELEGRAM_API_ROOT: tg.url, DATA_FILE: file };

  let ready = tg.idle();
  const first = launch(env);
  t.after(() => first.child.kill("SIGKILL"));
  await ready;

  const second = launch(env);
  const [code] = await second.exited;
  assert.equal(code, 1);
  assert.match(second.output(), /уже запущен/);
  assert.equal(first.child.exitCode, null, "первая копия продолжает работать");

  first.child.kill("SIGKILL");
  await first.exited;

  ready = tg.idle();
  const third = launch(env);
  t.after(() => third.child.kill("SIGKILL"));
  await ready;
  assert.equal(third.child.exitCode, null);
});

test("аварийное завершение посреди работы не теряет заявку", async (t) => {
  const tg = await startFakeTelegram();
  t.after(() => tg.close());
  const file = await tempFile(t);
  const env = { BOT_TOKEN: tg.token, TELEGRAM_API_ROOT: tg.url, MANAGER_CHAT_ID: String(MANAGER_ID), DATA_FILE: file };
  const manager = tg.user({ id: MANAGER_ID, first_name: "Николай" });
  const client = tg.user({ id: 101, first_name: "Иван", username: "ivan" });

  let ready = tg.idle();
  let bot = launch(env);
  t.after(() => bot.child.kill("SIGKILL"));
  await ready;

  await client.say("/new");

  // Падение в момент ответа клиенту: ответ на сервере уже есть, а на диск шаг не записан
  tg.onCall((method) => {
    if (method !== "sendMessage") return false;
    bot.child.kill("SIGKILL");
    return true;
  });
  client.post({ text: "Описание задачи" });
  await bot.exited;

  ready = tg.idle();
  bot = launch(env);
  await ready;
  assert.equal(client.lastText(), consentText(""));
  await client.tap(TEXT.consentYes);
  await client.tap("Иван");
  await client.say(TEXT.contactHere);

  // Падение в момент отправки карточки менеджеру: заявка уже на диске
  tg.onCall((method, params) => {
    if (method !== "sendMessage" || params.chat_id !== MANAGER_ID) return false;
    bot.child.kill("SIGKILL");
    return true;
  });
  const { message, button } = client.findButton(TEXT.submit);
  client.postTap(message, button.callback_data);
  await bot.exited;
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.orders.length, 1, "заявка записана до отправки менеджеру");
  assert.equal(saved.orders[0].answers.task, "Описание задачи");
  assert.equal(saved.drafts[client.chatId], undefined);

  ready = tg.idle();
  bot = launch(env);
  await ready;
  await tg.tick();
  assert.ok(manager.botMessages().some((item) => item.text.includes("Заявка №1001")), "карточка дошла после перезапуска");
  const after = JSON.parse(await readFile(file, "utf8"));
  assert.equal(after.orders.length, 1, "повторная доставка нажатия не создала вторую заявку");
  assert.ok(after.orders[0].cardMessageId);
});
