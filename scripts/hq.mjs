// Geocode every joined ticker's SEC business address into data/hq.json (SEC EDGAR → Census / Nominatim → 119th district).
// Paced by the gates in server/hq.mjs; results also land in the sqlite cache the API reads.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../server/env.mjs";
import { listTickers, openDb } from "../server/db.mjs";
import { HQ_SOURCE, lookupHq } from "../server/hq.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);
const db = openDb(root);
const file = path.join(root, "data", "hq.json");
const retry = process.argv.includes("--retry");
const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).items : [];
const misses = new Set(prior.filter((r) => !r.district && !r.foreign).map((r) => r.symbol));
const only = process.argv.slice(2).filter((s) => !s.startsWith("--")).map((s) => s.toUpperCase());
const tickers = listTickers(db).filter((t) => t.cik && (retry ? misses.has(t.symbol) : !only.length || only.includes(t.symbol)));

const items = [];
let done = 0;
const queue = [...tickers];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    items.push(await lookupHq(db, t, { force: retry || only.length > 0 }));
    done += 1;
    if (done % 25 === 0) console.log(`${done}/${tickers.length}`);
  }
}));

const merged = new Map(prior.map((r) => [r.symbol, r]));
for (const r of items) merged.set(r.symbol, r);
const all = [...merged.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
fs.writeFileSync(file, `${JSON.stringify({ source: HQ_SOURCE, asOf: new Date().toISOString(), items: all }, null, 1)}\n`);

const placed = all.filter((r) => r.district).length;
const foreign = all.filter((r) => r.foreign).length;
const byGeocoder = all.reduce((m, r) => ({ ...m, [r.geocoder || "none"]: (m[r.geocoder || "none"] || 0) + 1 }), {});
console.log(`${all.length} tickers · ${placed} placed in a district · ${foreign} foreign · ${all.length - placed - foreign} unplaced`, byGeocoder);
for (const r of all.filter((r) => !r.district && !r.foreign)) console.log(`  ${r.symbol}: ${r.note} [${r.street}, ${r.city} ${r.state}]`);
