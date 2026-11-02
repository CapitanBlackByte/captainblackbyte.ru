import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBot } from "./bot.js";
import { openStore } from "./store.js";
import { createTelegram, isFatal, describeError } from "./telegram.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (typeof process.loadEnvFile !== "function") {
  fail("Нужен Node.js 20.12 или новее.");
}

try {
  process.loadEnvFile(path.join(rootDir, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") fail(`Не удалось прочитать .env: ${error.message}`);
}

const { BOT_TOKEN, MANAGER_CHAT_ID, MANAGER_USERNAME, PRIVACY_URL, TELEGRAM_API_ROOT, DATA_FILE, INBOX_URL, INBOX_TOKEN } = process.env;

if (!BOT_TOKEN) {
  fail("Не задан BOT_TOKEN. Скопируйте .env.example в .env и впишите токен от @BotFather.");
}

const managerChatId = MANAGER_CHAT_ID ? Number(MANAGER_CHAT_ID) : null;
if (MANAGER_CHAT_ID && !Number.isSafeInteger(managerChatId)) {
  fail("MANAGER_CHAT_ID должен быть числом. Узнать его можно командой /id в чате с ботом.");
}

const dataFile = path.resolve(rootDir, DATA_FILE || "data/state.json");

// Две копии перезаписывали бы файл заявок друг у друга. Порт занят, пока жив процесс,
// и освобождается при любом падении, поэтому забытого замка не бывает.
function holdInstanceLock() {
  const port = 20000 + [...dataFile.toLowerCase()].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 20000, 0);
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.unref();
      resolve();
    });
  });
}

await holdInstanceLock().catch((error) => {
  if (error.code === "EADDRINUSE") fail("Бот с этим файлом заявок уже запущен на этом компьютере, вторая копия не нужна.");
});

let store;
try {
  store = openStore(dataFile);
} catch (error) {
  fail(error.message);
}

const shutdown = new AbortController();
for (const name of ["SIGINT", "SIGTERM"]) {
  process.on(name, () => shutdown.abort());
}

const bot = createBot({
  telegram: createTelegram({ token: BOT_TOKEN, apiRoot: TELEGRAM_API_ROOT || undefined }),
  store,
  managerChatId,
  managerUsername: MANAGER_USERNAME,
  privacyUrl: PRIVACY_URL,
  inbox: INBOX_URL && INBOX_TOKEN ? { url: INBOX_URL, token: INBOX_TOKEN } : null,
  pollTimeout: INBOX_URL ? 10 : 30,
});

bot
  .run({ signal: shutdown.signal })
  .then(() => console.log("Бот остановлен."))
  .catch((error) => {
    fail(isFatal(error) ? "Telegram не принял токен: проверьте BOT_TOKEN в .env." : `Бот остановлен из-за ошибки: ${describeError(error)}`);
  });
