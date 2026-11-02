import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIMITS = {
  body: 32 * 1024,
  name: 100,
  contact: 200,
  message: 8000,
  perIp: 5,
  perIpWindowMs: 60 * 60 * 1000,
  queue: 500,
};
const ROOT_PATH = "/api/orders";

const looksLikeContact = (text) => /@|\.\w{2,}/.test(text) || text.replace(/\D/g, "").length >= 6;
const digest = (text) => createHash("sha256").update(text).digest();

class BadRequest extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function readQueue(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Файл ${file} повреждён и не читается, приём заявок не запущен, чтобы не затереть заявки: ${error.message}`);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > LIMITS.body) {
        reject(new BadRequest(413, "too-large"));
        req.resume();
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

function parseOrder(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new BadRequest(400, "bad-json");
  }
  const text = (name) => (typeof data?.[name] === "string" ? data[name].trim() : "");
  const [name, contact, message] = [text("name"), text("contact"), text("message")];
  if (!name || !contact || !message) throw new BadRequest(400, "missing");
  if (data.consent !== true) throw new BadRequest(400, "consent");
  if (!looksLikeContact(contact)) throw new BadRequest(400, "contact");
  if (name.length > LIMITS.name || contact.length > LIMITS.contact || message.length > LIMITS.message) {
    throw new BadRequest(400, "too-long");
  }
  return { name, contact, message };
}

export function createInbox({ token, file, allowedOrigins, now = Date.now, log = console }) {
  if (!token) throw new Error("Не задан INBOX_TOKEN.");
  mkdirSync(path.dirname(file), { recursive: true });
  const queue = readQueue(file);
  const expected = digest(token);
  const hits = new Map();
  let writing = Promise.resolve();

  const save = () => {
    writing = writing.then(async () => {
      const temp = `${file}.tmp`;
      await fs.writeFile(temp, JSON.stringify(queue, null, 2), { mode: 0o600 });
      await fs.rename(temp, file);
    });
    return writing;
  };

  const authorized = (req) => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") && timingSafeEqual(digest(header.slice(7)), expected);
  };

  function allowIp(ip) {
    const since = now() - LIMITS.perIpWindowMs;
    const times = (hits.get(ip) ?? []).filter((time) => time > since);
    if (times.length >= LIMITS.perIp) {
      hits.set(ip, times);
      return false;
    }
    hits.set(ip, [...times, now()]);
    return true;
  }

  async function acceptOrder(req) {
    const { origin } = req.headers;
    if (origin && !allowedOrigins.includes(origin)) throw new BadRequest(403, "origin");
    const order = parseOrder(await readBody(req));
    if (!allowIp(req.headers["x-real-ip"] ?? req.socket.remoteAddress)) throw new BadRequest(429, "too-many");
    if (queue.length >= LIMITS.queue) throw new BadRequest(503, "queue-full");
    const at = new Date(now()).toISOString();
    queue.push({ id: randomUUID(), createdAt: at, consentAt: at, ...order });
    await save();
    log.info(`Заявка с сайта принята, в очереди: ${queue.length}.`);
    return { status: 201, body: { ok: true } };
  }

  async function acknowledge(req) {
    let ids;
    try {
      ({ ids } = JSON.parse(await readBody(req)));
    } catch {
      throw new BadRequest(400, "bad-json");
    }
    if (!Array.isArray(ids)) throw new BadRequest(400, "bad-ids");
    const done = new Set(ids);
    const left = queue.filter((item) => !done.has(item.id));
    queue.splice(0, queue.length, ...left);
    await save();
    return { status: 200, body: { ok: true } };
  }

  async function route(req) {
    const { pathname } = new URL(req.url, "http://inbox.local");
    if (req.method === "POST" && pathname === ROOT_PATH) return acceptOrder(req);
    if (pathname === `${ROOT_PATH}/pending` || pathname === `${ROOT_PATH}/ack`) {
      if (!authorized(req)) throw new BadRequest(401, "unauthorized");
      if (req.method === "GET" && pathname.endsWith("/pending")) return { status: 200, body: { orders: queue } };
      if (req.method === "POST" && pathname.endsWith("/ack")) return acknowledge(req);
    }
    throw new BadRequest(404, "not-found");
  }

  const server = http.createServer(async (req, res) => {
    let reply;
    try {
      reply = await route(req);
    } catch (error) {
      if (!(error instanceof BadRequest)) log.error(`Сбой приёма заявок: ${error.message}`);
      reply = error instanceof BadRequest
        ? { status: error.status, body: { ok: false, error: error.message } }
        : { status: 500, body: { ok: false, error: "server" } };
    }
    res.writeHead(reply.status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(reply.body));
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  try {
    process.loadEnvFile(path.join(rootDir, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { INBOX_TOKEN, INBOX_PORT, INBOX_FILE, ALLOWED_ORIGIN } = process.env;
  const port = Number(INBOX_PORT || 8790);
  const server = createInbox({
    token: INBOX_TOKEN,
    file: path.resolve(rootDir, INBOX_FILE || "data/inbox.json"),
    allowedOrigins: (ALLOWED_ORIGIN || "https://captainblackbyte.ru,https://www.captainblackbyte.ru").split(","),
  });
  server.listen(port, "127.0.0.1", () => console.log(`Приём заявок запущен на 127.0.0.1:${port}.`));
  for (const name of ["SIGINT", "SIGTERM"]) {
    process.on(name, () => server.close(() => process.exit(0)));
  }
}
