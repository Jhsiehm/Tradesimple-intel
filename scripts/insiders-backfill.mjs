// Backfills Form 4 insider history into data/cache.sqlite from the SEC Insider Transactions Data Sets (2020Q1 on),
// then the EDGAR daily index for days after the newest quarter. Resumable: done quarters and days are skipped.
// Usage: npm run insiders:backfill [-- --since 2020q1 --no-daily --no-quarters --status]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../server/lib/env.mjs";
import { openDb } from "../server/lib/db.mjs";
import { updateInsiderHistory } from "../server/jobs/insidersBackfill.mjs";
import { storeStatus } from "../server/domain/positions/insiderStore.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

loadEnv(root);
const db = openDb(root);
const show = () => {
  const s = storeStatus(db, Date.now() + 120_000);
  console.log(`insiders: store ${s.rows} rows, ${s.forms} forms, ${s.tickers} tickers; filed ${s.filed.from || "—"} to ${s.filed.to || "—"}; quarters ${s.quarters.count} (${s.quarters.first || "—"}..${s.quarters.last || "—"}), daily days ${s.days.count}; covered ${s.coveredFrom || "—"} to ${s.coveredThrough || "—"}; last update ${s.lastUpdate || "—"}${s.lastError ? `; last error: ${s.lastError}` : ""}`);
};

if (!args.includes("--status")) {
  const since = String(flag("since", "2020q1")).toLowerCase();
  if (!/^\d{4}q[1-4]$/.test(since)) {
    console.error("--since takes a quarter like 2020q1");
    process.exit(2);
  }
  const out = await updateInsiderHistory(db, { since, quarters: !args.includes("--no-quarters"), daily: !args.includes("--no-daily"), log: (s) => console.log(s) });
  if (out.skipped) console.log(`insiders: skipped (${out.skipped})`);
  for (const e of out.errors || []) console.error(`insiders: error: ${e}`);
  if (out.ms != null) console.log(`insiders: pass took ${(out.ms / 1000).toFixed(0)} s`);
}
show();
