import { mkdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const RENAME_RETRIES = new Set(["EPERM", "EACCES", "EBUSY"]);

const emptyState = () => ({
  nextOrderId: 1001,
  seenUpdates: [],
  seenSiteOrders: [],
  consents: {},
  drafts: {},
  orders: [],
  links: {},
});

function readState(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
  try {
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch (error) {
    throw new Error(`Файл данных ${file} повреждён и не читается, бот не запущен, чтобы не затереть заявки: ${error.message}`);
  }
}

async function writeAtomically(file, text) {
  const temp = `${file}.tmp`;
  const handle = await fs.open(temp, "w", 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(temp, file);
      return;
    } catch (error) {
      if (attempt >= 5 || !RENAME_RETRIES.has(error.code)) throw error;
      await sleep(100 * attempt);
    }
  }
}

export function openStore(file, log = console) {
  mkdirSync(path.dirname(file), { recursive: true });
  const state = readState(file);

  const save = async () => {
    try {
      await writeAtomically(file, JSON.stringify(state, null, 2));
    } catch (error) {
      log.error(`Не удалось сохранить данные: ${error.message}`);
    }
  };

  return { state, save };
}
