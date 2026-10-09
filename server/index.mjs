import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { openDb } from "./lib/db.mjs";
import { router } from "./routes/index.mjs";
import { createFront } from "./front.mjs";
import { siteRegistry } from "./domain/sites.mjs";
import { startWarm } from "./jobs/warm.mjs";
import { startTasks } from "./jobs/tasks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);
const db = openDb(root);
const port = Number(process.env.PORT || 8787);
const routes = router();
siteRegistry();

let front;
try {
  front = createFront({ handle: (req, res) => routes.handle(req, res, { db, root }), root });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const server = http.createServer(front);
// Behind Caddy: outlive its idle upstream connections so a reused socket is never closed mid-request.
if (front.production) server.keepAliveTimeout = 75_000;

process.on("unhandledRejection", (err) => console.error("unhandled", err instanceof Error ? err.message : err));

server.listen(port, "127.0.0.1", () => {
  console.log(`intel api http://127.0.0.1:${port}`);
  startWarm(db);
  startTasks(db);
});
