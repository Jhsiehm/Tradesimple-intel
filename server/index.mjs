import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { openDb } from "./lib/db.mjs";
import { router } from "./routes/index.mjs";
import { siteRegistry } from "./domain/sites.mjs";
import { warmTimeline } from "./timeline.mjs";
import { warmReturns } from "./returns.mjs";
import { warmContracts } from "./contracts.mjs";
import { warmPositions } from "./positions.mjs";
import { warmMacro } from "./macro.mjs";
import { warmCorporate } from "./corporate.mjs";

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
  if (process.env.INTEL_NO_WARM) return;
  warmPositions(db);
  warmTimeline(db);
  warmReturns(db);
  setTimeout(() => warmContracts(db), 3000);
  setInterval(() => warmContracts(db), 60 * 60 * 1000).unref();
  setTimeout(() => {
    warmCorporate(db).then(() => warmMacro(db)).then((n) => console.log(`macro warm: ${n} days fetched`)).catch((err) => console.error("warm", err.message));
  }, 5000);
});
