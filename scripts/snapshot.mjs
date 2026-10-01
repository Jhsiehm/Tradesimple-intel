#!/usr/bin/env node
/**
 * Freeze a running API into static JSON for the zero-key demo.
 *   node server/index.mjs &   # with your keys in .env.local
 *   node scripts/snapshot.mjs [--base http://127.0.0.1:8787] [--members 40]
 * Members: the top N traders plus everyone named on the landing feed, so every feed name opens a timeline.
 * Writes demo/snapshot/*.json and demo/snapshot/manifest.json. Aborts if any .env.local value appears in a response.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demoFile } from "../src/lib/demoPath.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:8787");
const MEMBERS = Number(arg("members", 40));
const OUT = path.join(root, "demo", "snapshot");

const secrets = (() => {
  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n")
    .map((line) => line.match(/^\s*[A-Z0-9_]+\s*=\s*"?([^"\n]+)"?\s*$/)?.[1]?.trim())
    .filter((v) => v && v.length >= 12);
})();

const store = new Map();
let failed = 0;

async function grab(route, timeoutMs = 120_000) {
  if (store.has(route)) return store.get(route);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + route, { signal: ctrl.signal });
    const text = await res.text();
    for (const s of secrets) {
      if (text.includes(s)) throw new Error(`refusing to write ${route}: response contains a value from .env.local`);
    }
    const body = JSON.parse(text);
    store.set(route, body);
    return body;
  } catch (err) {
    if (String(err.message).startsWith("refusing")) throw err;
    failed += 1;
    console.warn(`skip ${route}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

const fixed = [
  "/api/health", "/api/tickers", "/api/sites",
  "/api/congress/bills", "/api/congress/roster", "/api/congress/committees", "/api/congress/calendar",
  "/api/congress/votes?chamber=house", "/api/congress/votes?chamber=senate",
  "/api/markets/politicians", "/api/markets/insiders", "/api/markets/whales", "/api/markets/shorts",
  "/api/markets/positions", "/api/markets/supply", "/api/markets/board", "/api/markets/globals",
  "/api/news", "/api/strait/theaters", "/api/earth/imagery", "/api/earth/lanes",
  "/api/macro/strip", "/api/fx/board", "/api/crypto/board", "/api/calendar/macro?back=0&ahead=14",
  "/api/calendar/earnings", "/api/calendar/lobbying", "/api/calendar/pacs", "/api/alerts?late=all",
  "/api/congress/feed"
];

console.log(`snapshot from ${BASE}`);
await pool(fixed, 4, grab);
if (!store.has("/api/health")) {
  console.error(`no API at ${BASE}; leaving demo/snapshot untouched`);
  process.exit(1);
}

const votes = [...(store.get("/api/congress/votes?chamber=house")?.items || []), ...(store.get("/api/congress/votes?chamber=senate")?.items || [])];
await pool(votes, 4, (v) => grab(`/api/congress/votes/${v.chamber}/${v.congress}/${v.session}/${v.roll}`));
await pool(store.get("/api/congress/bills")?.items || [], 4, (b) => grab(`/api/congress/bills/${encodeURIComponent(b.id)}`));
await pool(store.get("/api/congress/committees")?.items || [], 4, async (c) => {
  const detail = await grab(`/api/congress/committees/${c.id}`);
  for (const sub of detail?.committee?.subcommittees || []) await grab(`/api/congress/committees/${sub.id}`);
});

const roster = store.get("/api/congress/roster")?.items || [];
const seatOf = new Map(roster.map((m) => [m.bioguide, m.chamber]));
await pool(roster, 4, (m) => grab(`/api/congress/member/${m.bioguide}?chamber=${m.chamber}`));

const trades = store.get("/api/markets/politicians")?.items || [];
const counts = new Map();
for (const t of trades) if (t.bioguide) counts.set(t.bioguide, (counts.get(t.bioguide) || 0) + 1);
const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MEMBERS);
const feed = store.get("/api/congress/feed") || {};
const featured = [feed.latest, feed.late, feed.biggest].flatMap((list) => (list || []).slice(0, 15)).map((t) => t.bioguide).filter(Boolean);
const members = [...top, ...[...new Set(featured)].filter((id) => !top.some(([t]) => t === id)).map((id) => [id, counts.get(id) || 0])];
await pool(members, 2, async ([id]) => {
  await grab(`/api/congress/member/${id}?chamber=${seatOf.get(id) || "house"}`);
  await grab(`/api/congress/member/${id}/trades`);
  await grab(`/api/congress/member/${id}/timeline`);
});

const joined = new Set((store.get("/api/tickers")?.items || store.get("/api/tickers")?.tickers || []).map((t) => t.symbol));
const symbols = [...new Set(trades.map((t) => t.symbol).filter((s) => s && joined.has(s)))].slice(0, 60);
await pool(symbols, 3, async (s) => {
  const q = encodeURIComponent(s);
  await grab(`/api/tickers/${q}`);
  await grab(`/api/markets/positions/${q}`);
  await grab(`/api/markets/chart?symbol=${q}&span=6mo`);
  await grab(`/api/markets/events?symbol=${q}`);
});
await pool(store.get("/api/markets/supply")?.items || [], 4, (s) => grab(`/api/markets/supply/${encodeURIComponent(s)}`));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [route, body] of store) {
  const text = JSON.stringify(body);
  bytes += text.length;
  fs.writeFileSync(path.join(OUT, demoFile(route)), text);
}
for (const name of ["states.geojson", "cd119.geojson"]) {
  fs.copyFileSync(path.join(root, "data", "geo", name), path.join(OUT, demoFile(`/geo/${name}`)));
}
const manifest = { takenAt: new Date().toISOString(), base: BASE, routes: store.size, members: members.map(([id]) => id), symbols, failed };
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`wrote ${store.size} routes (${(bytes / 1e6).toFixed(1)} MB) to demo/snapshot · ${failed} skipped`);
