// Warms every API cache the UI reads. Prints status and time per route, never bodies.
// Usage: npm run warm [-- --base http://127.0.0.1:8787 --traders 50 --no-tickers]
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const BASE = flag("base", process.env.INTEL_API || "http://127.0.0.1:8787").replace(/\/$/, "");
const TRADERS = Number(flag("traders", 50));
const TICKERS = !args.includes("--no-tickers");
const TIMEOUT = Number(flag("timeout", 180)) * 1000;

const results = [];

function redact(text) {
  return String(text || "")
    .replace(/([?&](api_?key|key|token|access_token)=)[^&\s]+/gi, "$1***")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "***")
    .slice(0, 120);
}

async function hit(path, { keep = false } = {}) {
  const t0 = performance.now();
  let status = 0;
  let note = "";
  let body = null;
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(TIMEOUT) });
    status = res.status;
    const text = await res.text();
    try {
      body = JSON.parse(text);
      if (body && body.ok === false) note = `ok=false ${redact(body.error || body.missing || "")}`.trim();
    } catch {
      if (!path.startsWith("/geo/")) note = "non-JSON";
    }
  } catch (err) {
    note = err.name === "TimeoutError" ? `timeout ${TIMEOUT / 1000}s` : redact(err.message);
  }
  const ms = Math.round(performance.now() - t0);
  const fail = status !== 200;
  results.push({ path, status, ms, fail, note });
  console.log(`${fail ? "FAIL" : note ? "SOFT" : " ok "} ${String(status).padStart(3)} ${String(ms).padStart(7)}ms  ${path}${note ? `  [${note}]` : ""}`);
  return keep ? body : null;
}

async function pool(paths, concurrency) {
  const queue = [...paths];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) await hit(queue.shift());
  }));
}

const enc = encodeURIComponent;

async function main() {
  const started = performance.now();
  console.log(`warm ${BASE}  traders=${TRADERS} tickers=${TICKERS}`);

  const health = await hit("/api/health", { keep: true });
  if (!health?.ok) {
    console.log("API is not healthy; aborting.");
    process.exit(1);
  }

  // Discovery responses are reused for the per-entity phase.
  const [politicians, tickers, committees, theaters, supply, houseVotes, senateVotes] = await Promise.all([
    hit("/api/markets/politicians", { keep: true }),
    hit("/api/tickers", { keep: true }),
    hit("/api/congress/committees", { keep: true }),
    hit("/api/strait/theaters", { keep: true }),
    hit("/api/markets/supply", { keep: true }),
    hit("/api/congress/votes?chamber=house", { keep: true }),
    hit("/api/congress/votes?chamber=senate", { keep: true })
  ]);

  console.log("— boards");
  await pool([
    "/api/congress/roster",
    "/api/congress/bills",
    "/api/congress/calendar",
    "/api/congress/feed",
    "/api/congress/leaders",
    "/api/alerts?late=all",
    "/api/markets/insiders",
    "/api/markets/whales",
    "/api/markets/shorts",
    "/api/markets/positions",
    "/api/markets/board",
    "/api/markets/globals",
    "/api/markets/chart?symbol=SPY&span=1d",
    "/api/markets/events?symbol=SPY",
    "/api/fx/board",
    "/api/crypto/board",
    "/api/macro/strip",
    "/api/macro/fomc",
    "/api/calendar/macro?back=0&ahead=14",
    "/api/calendar/macro?back=10&ahead=35",
    "/api/calendar/earnings",
    "/api/calendar/lobbying",
    "/api/calendar/pacs",
    "/api/news",
    "/api/news/x",
    "/api/news/xpulse",
    "/api/strait/news",
    "/api/strait/ais",
    "/api/earth/imagery",
    "/api/earth/live",
    "/api/earth/lanes",
    "/api/contracts/board",
    "/api/contracts/dod",
    "/api/contracts/feed?sort=largest&days=30",
    "/api/contracts/feed?sort=recent&days=30",
    "/api/sites",
    "/geo/states.geojson",
    "/geo/cd119.geojson",
    ...(theaters?.items || []).map((t) => `/api/air?theater=${enc(t.id)}`)
  ], 3);

  console.log("— congress detail");
  const latestVote = (chamber, list) => {
    const v = (list?.items || [])[0];
    return v ? [`/api/congress/votes/${chamber}/${v.congress}/${v.session}/${v.roll}`] : [];
  };
  await pool([
    ...latestVote("house", houseVotes),
    ...latestVote("senate", senateVotes),
    ...(committees?.items || []).map((c) => `/api/congress/committees/${enc(c.id)}`)
  ], 3);

  console.log(`— top ${TRADERS} traders`);
  const counts = new Map();
  for (const row of politicians?.items || []) {
    if (!row.bioguide) continue;
    const seat = counts.get(row.bioguide) || { n: 0, chamber: /senate/i.test(row.chamber || "") ? "senate" : "house" };
    seat.n += 1;
    counts.set(row.bioguide, seat);
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, TRADERS);
  await pool(top.flatMap(([id, seat]) => [
    `/api/congress/member/${id}?chamber=${seat.chamber}`,
    `/api/congress/member/${id}/trades`,
    `/api/congress/member/${id}/timeline`
  ]), 3);

  console.log("— supply chains");
  await pool((supply?.items || []).map((s) => `/api/markets/supply/${enc(s)}`), 3);

  if (TICKERS) {
    const symbols = (tickers?.items || []).map((t) => t.symbol);
    console.log(`— ${symbols.length} ticker dossiers + positions`);
    await pool(symbols.flatMap((s) => [`/api/tickers/${enc(s)}`, `/api/markets/positions/${enc(s)}`]), 2);
  }

  const total = results.length;
  const fails = results.filter((r) => r.fail);
  const soft = results.filter((r) => !r.fail && r.note);
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  console.log("\n=== summary");
  console.log(`routes ${total}  failures ${fails.length}  soft (ok=false) ${soft.length}  wall ${((performance.now() - started) / 1000).toFixed(1)}s`);
  console.log(`median ${pct(0.5)}ms  p90 ${pct(0.9)}ms  max ${times[times.length - 1]}ms`);
  console.log("slowest:");
  for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 8)) console.log(`  ${String(r.ms).padStart(7)}ms  ${r.path}`);
  if (fails.length) {
    console.log("failures:");
    for (const r of fails) console.log(`  ${r.status} ${r.path}  ${r.note}`);
  }
  if (soft.length) {
    console.log("soft:");
    for (const r of soft.slice(0, 20)) console.log(`  ${r.path}  ${r.note}`);
  }
  process.exit(fails.length ? 1 : 0);
}

main();
