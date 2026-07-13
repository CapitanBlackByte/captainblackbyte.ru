import express from "express";
import acme from "acme-client";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const certDir = path.join(rootDir, ".certs", "letsencrypt");

const DOMAIN = process.env.DOMAIN || "captainblackbyte.ru";
const ALT_DOMAINS = (process.env.ALT_DOMAINS || `www.${DOMAIN}`).split(",").map((item) => item.trim());
const EMAIL = process.env.ACME_EMAIL || "nik2shar@yahoo.com";
const HTTP_PORT = Number(process.env.HTTP_PORT || 80);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);

const domains = [DOMAIN, ...ALT_DOMAINS.filter((item) => item && item !== DOMAIN)];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readOrNull(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function writeIfChanged(filePath, value) {
  const current = readOrNull(filePath);
  if (current !== value) {
    fs.writeFileSync(filePath, value, "utf8");
  }
}

function createApp() {
  const app = express();
  app.use(express.static(distDir, { extensions: ["html"] }));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
  return app;
}

async function issueCertificate(challengeApp) {
  ensureDir(certDir);

  const accountKeyPath = path.join(certDir, "account.key");
  const accountKey = readOrNull(accountKeyPath) || (await acme.crypto.createPrivateKey());
  writeIfChanged(accountKeyPath, accountKey);

  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey,
  });

  const [key, csr] = await acme.crypto.createCsr({
    altNames: domains,
    commonName: DOMAIN,
  });

  const challenges = new Map();
  challengeApp.get("/.well-known/acme-challenge/:token", (req, res) => {
    const value = challenges.get(req.params.token);
    if (!value) {
      res.status(404).type("text/plain").send("not found");
      return;
    }
    res.type("text/plain").send(value);
  });

  const challengeServer = http.createServer(challengeApp);
  await new Promise((resolve) => challengeServer.listen(HTTP_PORT, "0.0.0.0", resolve));

  try {
    const certificate = await client.auto({
      csr,
      email: EMAIL,
      termsOfServiceAgreed: true,
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        challenges.set(challenge.token, keyAuthorization);
      },
      challengeRemoveFn: async (_authz, challenge) => {
        challenges.delete(challenge.token);
      },
    });

    fs.writeFileSync(path.join(certDir, "private.key"), key);
    fs.writeFileSync(path.join(certDir, "certificate.crt"), certificate);
    console.log(`Сертификат Let's Encrypt выпущен для: ${domains.join(", ")}`);
    return {
      cert: certificate,
      key,
    };
  } finally {
    await new Promise((resolve, reject) => {
      challengeServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function loadCertificate() {
  const certPath = path.join(certDir, "certificate.crt");
  const keyPath = path.join(certDir, "private.key");

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath, "utf8"),
      key: fs.readFileSync(keyPath, "utf8"),
      cached: true,
    };
  }

  const challengeApp = express();
  return issueCertificate(challengeApp);
}

async function start() {
  if (!fs.existsSync(distDir)) {
    throw new Error("Папка dist не найдена. Сначала выполните: npm run build");
  }

  const { cert, key, cached = false } = await loadCertificate();
  const app = createApp();

  const redirectApp = express();
  redirectApp.use((req, res) => {
    res.redirect(301, `https://${req.headers.host}${req.url}`);
  });

  const httpServer = http.createServer(redirectApp);
  const httpsServer = https.createServer({ cert, key }, app);

  await new Promise((resolve) => httpServer.listen(HTTP_PORT, "0.0.0.0", resolve));
  await new Promise((resolve) => httpsServer.listen(HTTPS_PORT, "0.0.0.0", resolve));

  console.log("");
  console.log("Сервер запущен на вашем ПК:");
  console.log(`  http://${DOMAIN}:${HTTP_PORT}  -> редирект на HTTPS`);
  console.log(`  https://${DOMAIN}:${HTTPS_PORT}`);
  if (cached) {
    console.log("Используется сохранённый сертификат из .certs/letsencrypt");
  }
  console.log("");
  console.log("Проверьте:");
  console.log("  1. DNS A-запись домена указывает на ваш внешний IP");
  console.log("  2. На роутере проброшены порты 80 и 443 на этот ПК");
  console.log("  3. Windows Firewall разрешает входящие 80 и 443");
  console.log("");
}

start().catch((error) => {
  console.error("Не удалось запустить production-сервер:");
  console.error(error.message);
  process.exit(1);
});
