// Warms every API cache the UI reads. Prints status and time per route, never bodies.
// Usage: npm run warm [-- --base http://127.0.0.1:8787 --traders 50 --no-tickers]
import { fillRoute, warmSamples } from "../server/routes/manifest.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const BASE = flag("base", process.env.INTEL_API || "http://127.0.0.1:8787").replace(/\/$/, "");
const TRADERS = Number(flag("traders", 50));
const TICKERS = !args.includes("--no-tickers");
const TIMEOUT = Number(flag("timeout", 180)) * 1000;
const LOBBY_CONCURRENCY = 2;

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

  // Discovery responses are reused for the per-entity phase. Route lists come from the server's manifest.
  const discover = warmSamples("discover");
  const found = new Map(await Promise.all(discover.map(async (p) => [p, await hit(p, { keep: true })])));
  const bodyOf = (id, query = "") => found.get(fillRoute(id, {}, query));
  const politicians = bodyOf("markets.politicians");
  const tickers = bodyOf("tickers");
  const committees = bodyOf("congress.committees");
  const theaters = bodyOf("strait.theaters");
  const supply = bodyOf("markets.supply");
  const houseVotes = bodyOf("congress.votes", "chamber=house");
  const senateVotes = bodyOf("congress.votes", "chamber=senate");

  console.log("— boards");
  await pool([
    ...warmSamples("board"),
    ...(theaters?.items || []).map((t) => fillRoute("air", {}, `theater=${enc(t.id)}`))
  ], 3);

  console.log("— congress detail");
  const latestVote = (chamber, list) => {
    const v = (list?.items || [])[0];
    return v ? [fillRoute("congress.vote", { chamber, congress: v.congress, session: v.session, roll: v.roll })] : [];
  };
  await pool([
    ...latestVote("house", houseVotes),
    ...latestVote("senate", senateVotes),
    ...(committees?.items || []).map((c) => fillRoute("congress.committee", { id: c.id }))
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
    fillRoute("congress.member", { id }, `chamber=${seat.chamber}`),
    fillRoute("congress.memberTrades", { id }),
    fillRoute("congress.memberTimeline", { id })
  ]), 3);

  console.log("— supply chains");
  await pool((supply?.items || []).map((s) => fillRoute("markets.supplyChain", { symbol: s })), 3);

  if (TICKERS) {
    const rows = tickers?.items || [];
    const symbols = rows.map((t) => t.symbol);
    // Same split as the UI: the dossier skips LDA.gov (?lobby=0) and /api/lobby?client= loads it on its own.
    // LDA.gov can hang for 45 s per client, so its warm runs beside the dossiers instead of inside them.
    const clients = [...new Set(rows.map((t) => t.ldaClients?.[0] || t.name).filter(Boolean))];
    console.log(`— ${symbols.length} ticker dossiers + positions · ${clients.length} LDA clients alongside`);
    await Promise.all([
      pool(symbols.flatMap((s) => [fillRoute("ticker", { symbol: s }, "lobby=0"), fillRoute("markets.position", { symbol: s })]), 2),
      pool(clients.map((c) => fillRoute("lobby", {}, `client=${enc(c)}`)), LOBBY_CONCURRENCY)
    ]);
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
