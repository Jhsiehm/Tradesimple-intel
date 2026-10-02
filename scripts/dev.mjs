import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hot = process.argv.includes("--hot");
const server = spawn(process.execPath, [...(hot ? ["--watch"] : []), "server/index.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: process.env
});
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  cwd: root,
  stdio: "inherit",
  env: process.env
});

function stop() {
  server.kill("SIGTERM");
  vite.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => {
  if (code) {
    vite.kill("SIGTERM");
    process.exit(code);
  }
});
