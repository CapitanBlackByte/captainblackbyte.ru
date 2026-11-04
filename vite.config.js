import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const certPath = path.join(rootDir, ".certs", "cert.pem");
const keyPath = path.join(rootDir, ".certs", "key.pem");

const https =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      }
    : undefined;

const proxy = { "/api": "http://127.0.0.1:8790" };

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: path.join(rootDir, "index.html"),
        flow: path.join(rootDir, "flow.html"),
        privacy: path.join(rootDir, "privacy.html"),
        consent: path.join(rootDir, "consent.html"),
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    https,
    proxy,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    https,
    proxy,
  },
});
