#!/usr/bin/env node
/**
 * Freeze a running API into static JSON for the zero-key demo.
 *   node server/index.mjs &   # with your keys in .env.local
 *   node scripts/snapshot.mjs [--base http://127.0.0.1:8787] [--members all|N] [--tickers all|N]
 *                             [--spans 1d,6mo,1y,5y|all] [--contracts all|core|none] [--resume]
 * Members: every roster member plus every trader (traders first, by trade count); a number keeps the top N traders
 * plus everyone named on the landing feed. Tickers: every joined row in data/tickers.json (traded ones first).
 * Contracts: `all` adds per-member, per-district, per-state and per-ticker feeds through the server's paced
 * USAspending client and stops after repeated failures; `core` keeps the board, DoD and the all-agency views.
 * Responses stream to demo/snapshot.partial/ and replace demo/snapshot/ at the end; --resume reuses the partial dir.
 * Aborts if any .env.local value appears in a response.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demoFile } from "../shared/demoPath.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const limit = (value) => (String(value) === "all" ? Infinity : Math.max(0, Number(value) || 0));
const BASE = arg("base", "http://127.0.0.1:8787");
const MEMBERS = limit(arg("members", "all"));
const TICKERS = limit(arg("tickers", "all"));
const ALL_SPANS = ["1m", "5m", "15m", "1h", "1d", "6mo", "1y", "5y"];
const SPANS = arg("spans", "1d,6mo,1y,5y") === "all" ? ALL_SPANS : arg("spans", "1d,6mo,1y,5y").split(",").filter((s) => ALL_SPANS.includes(s));
const CONTRACTS = arg("contracts", "all");
const RESUME = process.argv.includes("--resume");
const OUT = path.join(root, "demo", "snapshot");
const PARTIAL = path.join(root, "demo", "snapshot.partial");

const secrets = (() => {
  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n")
    .map((line) => line.match(/^\s*[A-Z0-9_]+\s*=\s*"?([^"\n]+)"?\s*$/)?.[1]?.trim())
    .filter((v) => v && v.length >= 12);
})();

if (!RESUME) fs.rmSync(PARTIAL, { recursive: true, force: true });
fs.mkdirSync(PARTIAL, { recursive: true });

/** Routes written so far → byte size. Bodies are kept only for the list routes the snapshot enumerates. */
const written = new Map();
const bodies = new Map();
const KEEP = /^\/api\/(tickers|congress\/(roster|bills|committees(\/[A-Za-z0-9]+)?|votes\?.*|feed|leaders)|markets\/(politicians|supply)|strait\/theaters)$/;
let failed = 0;
let skipped = 0;
let bytes = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one route and write it. `accept(body)` false → not written (the demo then says the route is missing)
 * and retried once after `retryMs`. Returns the body, or null.
 */
async function grab(route, { timeoutMs = 180_000, accept = null, retryMs = 0 } = {}) {
  if (bodies.has(route)) return bodies.get(route);
  const file = path.join(PARTIAL, demoFile(route));
  if (written.has(route)) return { cached: true };
  if (RESUME && fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    written.set(route, text.length);
    bytes += text.length;
    if (!KEEP.test(route)) return { cached: true };
    const body = JSON.parse(text);
    bodies.set(route, body);
    return body;
  }
  for (let attempt = 0; attempt < (retryMs ? 2 : 1); attempt++) {
    if (attempt) await sleep(retryMs);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(BASE + route, { signal: ctrl.signal });
      const text = await res.text();
      for (const s of secrets) {
        if (text.includes(s)) throw new Error(`refusing to write ${route}: response contains a value from .env.local`);
      }
      const body = JSON.parse(text);
      if (accept && !accept(body)) {
        if (attempt + 1 < (retryMs ? 2 : 1)) continue;
        skipped += 1;
        return { rejected: true, body };
      }
      fs.writeFileSync(file, text);
      written.set(route, text.length);
      bytes += text.length;
      if (KEEP.test(route)) bodies.set(route, body);
      return body;
    } catch (err) {
      if (String(err.message).startsWith("refusing")) throw err;
      if (attempt + 1 < (retryMs ? 2 : 1)) continue;
      failed += 1;
      console.warn(`skip ${route}: ${err.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function pool(items, size, fn) {
  const queue = [...items];
  let done = 0;
  const total = items.length;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (queue.length) {
      await fn(queue.shift());
      done += 1;
      if (total >= 50 && done % 50 === 0) console.log(`  ${done}/${total}`);
    }
  }));
}

/** Minimum spacing between Yahoo-backed requests from this script (charts and dossier quotes). Free for routes already on disk. */
let yahooNext = 0;
async function yahooSlot(route, ms = 350) {
  if (written.has(route) || (RESUME && fs.existsSync(path.join(PARTIAL, demoFile(route))))) return;
  const now = Date.now();
  const at = Math.max(now, yahooNext);
  yahooNext = at + ms;
  if (at > now) await sleep(at - now);
}

const okBody = (body) => body && body.ok !== false;
const phase = (name) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${name} · ${written.size} routes · ${(bytes / 1e6).toFixed(1)} MB`);

const fixed = [
  "/api/health", "/api/tickers", "/api/sites",
  "/api/congress/bills", "/api/congress/roster", "/api/congress/committees", "/api/congress/calendar",
  "/api/congress/votes?chamber=house", "/api/congress/votes?chamber=senate",
  "/api/markets/politicians", "/api/markets/insiders", "/api/markets/whales", "/api/markets/shorts",
  "/api/markets/positions", "/api/markets/supply", "/api/markets/board", "/api/markets/globals",
  "/api/news", "/api/news/x", "/api/news/xpulse", "/api/strait/theaters", "/api/strait/news", "/api/strait/ais",
  "/api/earth/imagery", "/api/earth/lanes", "/api/earth/live",
  "/api/macro/strip", "/api/fx/board", "/api/crypto/board",
  "/api/calendar/macro?back=0&ahead=14", "/api/calendar/macro?back=10&ahead=35",
  "/api/calendar/earnings", "/api/calendar/lobbying", "/api/calendar/pacs", "/api/alerts?late=all",
  "/api/congress/feed", "/api/congress/leaders"
];

console.log(`snapshot from ${BASE} · members ${arg("members", "all")} · tickers ${arg("tickers", "all")} · spans ${SPANS.join(",")} · contracts ${CONTRACTS}${RESUME ? " · resume" : ""}`);
await pool(fixed, 4, (r) => grab(r));
if (!written.has("/api/health")) {
  console.error(`no API at ${BASE}; leaving demo/snapshot untouched`);
  process.exit(1);
}

phase("air, votes, bills, committees");
await pool(bodies.get("/api/strait/theaters")?.items || [], 2, (t) => grab(`/api/air?theater=${encodeURIComponent(t.id)}`));
const votes = [...(bodies.get("/api/congress/votes?chamber=house")?.items || []), ...(bodies.get("/api/congress/votes?chamber=senate")?.items || [])];
await pool(votes, 4, (v) => grab(`/api/congress/votes/${v.chamber}/${v.congress}/${v.session}/${v.roll}`));
await pool(bodies.get("/api/congress/bills")?.items || [], 4, async (b) => {
  const id = encodeURIComponent(b.id);
  await grab(`/api/congress/bills/${id}`);
  for (const chamber of ["house", "senate"]) await grab(`/api/congress/bills/${id}/vote?chamber=${chamber}`);
});
await pool(bodies.get("/api/congress/committees")?.items || [], 4, async (c) => {
  const detail = await grab(`/api/congress/committees/${c.id}`);
  for (const sub of detail?.committee?.subcommittees || []) await grab(`/api/congress/committees/${sub.id}`);
});

const roster = bodies.get("/api/congress/roster")?.items || [];
const seatOf = new Map(roster.map((m) => [m.bioguide, m.chamber]));
const trades = bodies.get("/api/markets/politicians")?.items || [];
const counts = new Map();
for (const t of trades) if (t.bioguide) counts.set(t.bioguide, (counts.get(t.bioguide) || 0) + 1);
const traders = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
const feed = bodies.get("/api/congress/feed") || {};
const lead = bodies.get("/api/congress/leaders") || {};
const featured = [feed.latest, feed.late, feed.biggest, lead.excessTop, lead.excessBottom, lead.late].flatMap((list) => list || []).map((t) => t.bioguide).filter(Boolean);
const members = MEMBERS === Infinity
  ? [...new Set([...traders, ...featured, ...roster.map((m) => m.bioguide)])]
  : [...new Set([...traders.slice(0, MEMBERS), ...featured])];

phase(`members (${members.length})`);
await pool(members, 3, async (id) => {
  await grab(`/api/congress/member/${id}?chamber=${seatOf.get(id) || "house"}`);
  await grab(`/api/congress/member/${id}/trades`);
  await grab(`/api/congress/member/${id}/timeline`);
});
await pool(roster.filter((m) => !members.includes(m.bioguide)), 4, (m) => grab(`/api/congress/member/${m.bioguide}?chamber=${m.chamber}`));

const tickerRows = bodies.get("/api/tickers")?.items || bodies.get("/api/tickers")?.tickers || [];
const joined = new Set(tickerRows.map((t) => t.symbol));
const traded = [...new Set(trades.map((t) => t.symbol).filter((s) => s && joined.has(s)))];
const symbols = [...new Set([...traded, ...joined])].slice(0, TICKERS);

phase(`tickers (${symbols.length})`);
await pool(symbols, 2, async (s) => {
  const q = encodeURIComponent(s);
  await yahooSlot(`/api/tickers/${q}`);
  await grab(`/api/tickers/${q}`);
  await grab(`/api/markets/positions/${q}`);
  await grab(`/api/markets/events?symbol=${q}`);
  for (const span of SPANS) {
    const route = `/api/markets/chart?symbol=${q}&span=${span}`;
    await yahooSlot(route);
    await grab(route, { accept: okBody, retryMs: 8000 });
  }
});
await pool(bodies.get("/api/markets/supply")?.items || [], 4, (s) => grab(`/api/markets/supply/${encodeURIComponent(s)}`));

phase("contracts");
const contractNotes = [];
await grab("/api/contracts/board", { timeoutMs: 60_000 });
await grab("/api/contracts/dod", { timeoutMs: 60_000 });
if (CONTRACTS !== "none") {
  for (const sort of ["largest", "recent"]) {
    for (const days of [30, 90, 365]) await grab(`/api/contracts/feed?sort=${sort}&days=${days}`, { accept: okBody });
  }
}
if (CONTRACTS === "all") {
  const code = (m) => (m.chamber === "senate" || !m.district || m.district === "0" ? m.state : `${m.state}-${String(m.district).padStart(2, "0")}`);
  const scoped = [
    ...roster.map((m) => `member=${m.bioguide}`),
    ...[...new Set(roster.map(code))].map((c) => `place=${c}`),
    ...[...new Set(roster.map((m) => m.state))].map((s) => `place=${s}`),
    ...symbols.map((s) => `symbol=${encodeURIComponent(s)}`)
  ];
  let streak = 0;
  let stopped = 0;
  let missing = 0;
  await pool([...new Set(scoped)], 2, async (q) => {
    if (streak >= 8) { stopped += 1; return; }
    const body = await grab(`/api/contracts/feed?sort=recent&days=30&${q}`, { accept: okBody, timeoutMs: 120_000 });
    if (!body || body.rejected) { streak += 1; missing += 1; } else streak = 0;
  });
  if (missing || stopped) contractNotes.push(`${missing} scoped contract feeds failed${stopped ? `; stopped after 8 failures in a row, ${stopped} not tried` : ""}`);
  console.log(contractNotes.at(-1) || `scoped contract feeds: ${scoped.length}`);
}

for (const name of ["states.geojson", "cd119.geojson"]) {
  fs.copyFileSync(path.join(root, "data", "geo", name), path.join(PARTIAL, demoFile(`/geo/${name}`)));
}
const manifest = {
  takenAt: new Date().toISOString(),
  base: BASE,
  routes: written.size,
  members,
  symbols,
  spans: SPANS,
  contracts: CONTRACTS,
  contractNotes,
  failed,
  rejected: skipped
};
fs.writeFileSync(path.join(PARTIAL, "manifest.json"), JSON.stringify(manifest, null, 1));
fs.rmSync(OUT, { recursive: true, force: true });
fs.renameSync(PARTIAL, OUT);
phase("done");
console.log(`wrote ${written.size} routes (${(bytes / 1e6).toFixed(1)} MB) to demo/snapshot · ${members.length} members · ${symbols.length} tickers · ${failed} failed · ${skipped} rejected`);
