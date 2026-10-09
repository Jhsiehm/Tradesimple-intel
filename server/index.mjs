import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { openDb } from "./lib/db.mjs";
import { router } from "./routes/index.mjs";
import { siteRegistry } from "./domain/sites.mjs";
import { startWarm } from "./jobs/warm.mjs";
import { startTasks } from "./jobs/tasks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);
const db = openDb(root);
const port = Number(process.env.PORT || 8787);
const routes = router();
siteRegistry();

const server = http.createServer((req, res) => routes.handle(req, res, { db, root }));

process.on("unhandledRejection", (err) => console.error("unhandled", err instanceof Error ? err.message : err));

server.listen(port, "127.0.0.1", () => {
  console.log(`intel api http://127.0.0.1:${port}`);
  startWarm(db);
  startTasks(db);
});
