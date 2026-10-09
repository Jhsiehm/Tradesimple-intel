/**
 * Automatic signal search: builds many backtest variants from the same records a single backtest reads, prices them
 * once, and ranks them in a worker thread with Benjamini–Hochberg q-values (shared/signalSearch.mjs). One search runs
 * at a time; results are cached per options and reused while the data snapshot (record counts, latest filing, day)
 * is unchanged.
 */
import { Worker } from "node:worker_threads";
import { BENCHMARKS, DEFAULT_FILTERS, DEFAULT_RULES, LIMITS, ROLE_LABEL, SECTOR_ETF, SECTOR_ETFS, cleanSpec, describeSpec, encodeSpec, specHash } from "../../../shared/backtestSpec.mjs";
import { REALITY } from "../../../shared/backtestStats.mjs";
import { evaluateVariants, SEARCH } from "../../../shared/signalSearch.mjs";
import { readCache, writeCache } from "../../lib/db.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { HOUR, MINUTE } from "../../lib/time.mjs";
import { committees as loadCommittees } from "../../roster.mjs";
import { congressTrades, insiderHistory } from "../positions/index.mjs";
import { lastBarDay, loadBars } from "./bars.mjs";
import { capSignals } from "./index.mjs";
import { congressSignals, form4Signals, matchCommittees } from "./signals.mjs";
import { contractAwards, sectorLookup } from "./sources.mjs";

export const SEARCH_BUDGET_MS = 90_000;
const RESULT_TTL = 24 * HOUR;
const FRESH_MS = 30 * MINUTE;
const FORM4_DAYS = 365;
const SIZE_BUCKETS = [
  ["small", "Disclosed under $15k", { maxAmount: 15_000 }],
  ["mid", "Disclosed $15k–$100k", { minAmount: 15_000, maxAmount: 100_000 }],
  ["large", "Disclosed $100k or more", { minAmount: 100_000 }]
];
const SPEED = [["fast", "Fast filers (≤ 15 days after the trade)", { maxLagDays: 15 }], ["slow", "Slow filers (30+ days after the trade)", { minLagDays: 30 }]];
const AWARD_DAYS = 90;
const CLUSTER_MIN = 3;

/** Search options, cleaned: hold, benchmark, minimum trades, sources, public-date window. */
export function cleanSearch(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const spec = cleanSpec({ source: "congress", filters: { from: r.from, to: r.to }, rules: { holdDays: r.holdDays, benchmark: r.benchmark } }).spec;
  const sources = (Array.isArray(r.sources) ? r.sources : ["congress", "form4"]).filter((s) => s === "congress" || s === "form4");
  const minTrades = Math.round(Math.min(200, Math.max(10, Number(r.minTrades) || SEARCH.minTrades)));
  return { holdDays: spec.rules.holdDays, benchmark: BENCHMARKS.includes(spec.rules.benchmark) ? spec.rules.benchmark : "SPY", minTrades, sources: sources.length ? [...new Set(sources)].sort() : ["congress", "form4"], from: spec.filters.from, to: spec.filters.to };
}

/**
 * Every variant over the dimensions, from records already in hand. Pure. Each variant's signals are built and capped
 * exactly as POST /api/backtest would for its spec, so "open the full backtest" re-runs the same thing.
 */
export function buildVariants({ trades = [], committees = [], form4Rows = [], awards = null, sectorOf = () => "", opts }) {
  const rules = { ...DEFAULT_RULES, holdDays: opts.holdDays, benchmark: opts.benchmark, sides: "buy" };
  const out = [];
  const add = (source, dim, key, label, filters) => {
    const c = cleanSpec({ source, filters: { ...DEFAULT_FILTERS, from: opts.from, to: opts.to, ...filters }, rules });
    if (!c.ok) return;
    const f = c.spec.filters;
    const signals = source === "congress"
      ? congressSignals({ trades, filters: f, sectorOf, committee: f.committee ? matchCommittees(committees, f.committee) : null, awards }).signals
      : form4Signals({ rows: form4Rows, filters: f, sectorOf }).signals;
    out.push({ id: `${source}:${dim}:${key}`, dim, label, spec: c.spec, signals: capSignals(signals, rules.sides).signals });
  };
  if (opts.sources.includes("congress") && trades.length) {
    add("congress", "all", "all", "All disclosed congressional buys", {});
    add("congress", "chamber", "house", "House members' buys", { chamber: "house" });
    add("congress", "chamber", "senate", "Senators' buys", { chamber: "senate" });
    add("congress", "party", "D", "Democrats' buys", { party: "D" });
    add("congress", "party", "R", "Republicans' buys", { party: "R" });
    for (const c of committees) add("congress", "committee", c.id, `${c.name} members' buys`, { committee: c.id });
    const buys = new Map();
    for (const t of trades) if (t.side === "buy" && t.inJoin && t.bioguide) {
      const row = buys.get(t.bioguide) || { n: 0, name: t.person };
      row.n += 1;
      buys.set(t.bioguide, row);
    }
    for (const [id, m] of [...buys.entries()].filter(([, m]) => m.n >= opts.minTrades).sort((a, b) => a[0].localeCompare(b[0]))) add("congress", "member", id, `${m.name}'s buys`, { member: id });
    for (const [key, label, f] of SIZE_BUCKETS) add("congress", "size", key, label, f);
    for (const sector of Object.keys(SECTOR_ETF)) add("congress", "sector", sector, `Buys in ${sector}`, { sector });
    for (const [key, label, f] of SPEED) add("congress", "speed", key, label, f);
    if (awards?.size) add("congress", "award", `${AWARD_DAYS}d`, `Buys followed by a contract award within ${AWARD_DAYS} days`, { awardWithinDays: AWARD_DAYS });
  }
  if (opts.sources.includes("form4") && form4Rows.length) {
    add("form4", "all", "discretionary", "Form 4 discretionary buys (no 10b5-1 plan)", {});
    add("form4", "plan", "only", "Form 4 buys under a 10b5-1 plan", { planOnly: true });
    for (const role of Object.keys(ROLE_LABEL)) add("form4", "role", role, `Form 4 buys by ${ROLE_LABEL[role]}s`, { role });
    add("form4", "cluster", String(CLUSTER_MIN), `Cluster buys (${CLUSTER_MIN}+ insiders within 30 days)`, { clusterMin: CLUSTER_MIN });
  }
  return out;
}

/* ---------- jobs ---------- */

const jobs = new Map();
const daysAgo = (n, now = Date.now()) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();
const feedOf = (label, res) => ({ label, source: res?.source || "", asOf: res?.asOf || "", latency: res?.latency || "" });

function view(job) {
  if (job.result) return { ...job.result, state: "done", progress: job.progress };
  return { ok: job.state !== "error", id: job.id, state: job.state, phase: job.phase, progress: job.progress, opts: job.opts, startedAt: iso(job.startedAt), error: job.error || "" };
}

/** In-memory job or the cached result for a search id. */
export function searchView(db, id) {
  const job = jobs.get(id);
  if (job) return view(job);
  const hit = readCache(db, KEY.signalSearch(id));
  return hit ? { ...hit, state: "done", cache: "hit" } : null;
}

/** The most recent search this process ran, or the default options' cached result. */
export function latestSearch(db) {
  const last = [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt)[0];
  if (last) return view(last);
  const id = specHash(cleanSearch({}));
  const hit = readCache(db, KEY.signalSearch(id));
  return hit ? { ...hit, state: "done", cache: "hit" } : { ok: true, state: "idle", defaults: cleanSearch({}) };
}

/** Resolves when the job finishes or after `ms`, whichever is first. */
export async function waitForSearch(id, ms) {
  const job = jobs.get(id);
  if (!job?.promise) return;
  await Promise.race([job.promise, new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); })]);
}

/**
 * Start a search (or return the running one / a fresh cached result). `deps` swaps loaders in tests; `inline` runs
 * the ranking on this thread instead of a worker.
 */
export function startSearch(db, raw, { fresh = false, inline = false, deps = {}, now = Date.now() } = {}) {
  const opts = cleanSearch(raw);
  const id = specHash(opts);
  const running = jobs.get(id);
  if (running?.state === "running") return view(running);
  const other = [...jobs.values()].find((j) => j.state === "running");
  if (other) return { ok: false, error: "Another signal search is running. One runs at a time; try again when it finishes.", busy: other.id };
  const hit = readCache(db, KEY.signalSearch(id));
  if (hit && !fresh && now - Date.parse(hit.ranAt) < FRESH_MS) return { ...hit, state: "done", cache: "hit" };
  const job = { id, opts, state: "running", phase: "data", progress: { done: 0, total: 0 }, startedAt: now, result: null, error: "" };
  jobs.set(id, job);
  job.promise = runJob(db, job, { inline, deps, cached: hit }).then(
    (result) => { job.result = result; job.state = "done"; },
    (err) => { job.state = "error"; job.error = err.message; }
  );
  return view(job);
}

async function runJob(db, job, { inline, deps, cached }) {
  const { opts } = job;
  const t0 = Date.now();
  const deadline = t0 + SEARCH_BUDGET_MS;
  const d = { congressTrades, loadCommittees, insiderHistory, contractAwards, loadBars, sectorOf: sectorLookup(db), ...deps };
  const notes = [];
  const feeds = [];
  let trades = [];
  let committees = [];
  let awards = null;
  let form4Rows = [];
  if (opts.sources.includes("congress")) {
    const board = await d.congressTrades(db).catch(() => null);
    trades = board?.items || [];
    if (board) feeds.push(feedOf("Congress trades", board));
    if (board?.building) notes.push("Disclosures were still being read; the search uses what was parsed so far.");
    const all = await d.loadCommittees(db).catch(() => null);
    committees = all?.items || [];
    if (all) feeds.push(feedOf("Committees", all));
    notes.push("Committee variants apply today's assignments to every past trade; members who joined or left mid-window are misclassified.");
    const got = await d.contractAwards(db).catch(() => null);
    if (got?.count) {
      awards = got.awards;
      feeds.push(feedOf("Contracts", got.res));
      notes.push(`The contract-award variant uses USAspending's ${got.count} largest actions of the last 365 days (a sample, not every award) and counts an award only once it was public by the trade's disclosure.`);
    }
  }
  if (opts.sources.includes("form4")) {
    const res = await d.insiderHistory(db, { from: opts.from || daysAgo(FORM4_DAYS), to: opts.to, deadline: t0 + Math.round(SEARCH_BUDGET_MS * 0.3) }).catch(() => null);
    form4Rows = res?.items || [];
    if (res) feeds.push(feedOf("Form 4", res));
    if (res?.building) notes.push(`Form 4 history was still loading from SEC EDGAR (${res.filings?.read ?? "?"} of ${res.filings?.wanted ?? "?"} filings read); Form 4 variants use what was read.`);
    if (!form4Rows.length) notes.push("No Form 4 rows were available, so no Form 4 variants were built.");
  }
  const lastOf = (xs, k) => xs.reduce((m, x) => (String(x[k] || "") > m ? String(x[k]) : m), "");
  const fingerprint = [trades.length, lastOf(trades, "filed"), form4Rows.length, lastOf(form4Rows, "filed"), awards?.size || 0, iso(Date.now()).slice(0, 10), `r${REALITY.version}`].join("|");
  if (cached && cached.fingerprint === fingerprint) return { ...cached, cache: "snapshot" };

  const variants = buildVariants({ trades, committees, form4Rows, awards, sectorOf: d.sectorOf, opts });
  job.phase = "prices";
  job.progress = { done: 0, total: variants.length };
  const benchIds = opts.benchmark === "SECTOR" ? ["SPY", ...SECTOR_ETFS] : [opts.benchmark];
  const symbols = [...new Set(variants.flatMap((v) => v.signals.map((s) => s.symbol)))].sort();
  const priced = await d.loadBars(db, [...symbols, ...benchIds], { deadline });
  const benchBars = Object.fromEntries(benchIds.map((b) => [b, priced.bars[b]]).filter(([, v]) => v?.length));
  if (!Object.keys(benchBars).length) throw new Error(`No benchmark prices for ${benchIds.join(", ")} yet; try again shortly.`);
  const bars = Object.fromEntries(symbols.map((s) => [s, priced.bars[s]]).filter(([, v]) => v?.length));
  if (priced.pending.length) notes.push(`${priced.pending.length} tickers were still loading prices when the ${SEARCH_BUDGET_MS / 1000} s budget ended; their trades are left out of every variant.`);
  const tPrices = Date.now();

  job.phase = "testing";
  const input = { variants, bars, benchBars, minTrades: opts.minTrades };
  const outcome = inline
    ? evaluateVariants({ ...input, onProgress: (done, total) => { job.progress = { done, total }; } })
    : await inWorker(input, (done, total) => { job.progress = { done, total }; });
  const tDone = Date.now();
  feeds.push({ label: "Prices", source: "Yahoo Finance v8 chart, daily bars adjusted for splits and dividends", asOf: priced.oldestStoredAt ? iso(priced.oldestStoredAt) : iso(tPrices), latency: `Daily bars through ${lastBarDay({ ...bars, ...benchBars }) || "—"}; cached 12 h.` });
  const link = (r) => ({ ...r, description: describeSpec(r.spec), open: `bt:token:${encodeSpec(r.spec)}` });
  const body = {
    ok: true,
    id: job.id,
    opts,
    fingerprint,
    ...outcome,
    findings: outcome.findings.map(link),
    notes,
    feeds,
    source: feeds.map((f) => f.source).filter(Boolean).join(" · "),
    asOf: feeds.map((f) => f.asOf).filter(Boolean).sort()[0] || iso(tDone),
    latency: `Search took ${((tDone - t0) / 1000).toFixed(1)} s: records and prices ${((tPrices - t0) / 1000).toFixed(1)} s, ${outcome.built} variants evaluated in ${((tDone - tPrices) / 1000).toFixed(1)} s (${inline ? "inline" : "worker thread"}). Cached for this data snapshot.`,
    timing: { totalMs: tDone - t0, loadMs: tPrices - t0, testMs: tDone - tPrices },
    limits: { signalsPerVariant: LIMITS.signals },
    ranAt: iso(tDone),
    cache: "miss"
  };
  writeCache(db, KEY.signalSearch(job.id), body, RESULT_TTL);
  return body;
}

function inWorker(input, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../jobs/searchWorker.mjs", import.meta.url), { workerData: input });
    worker.on("message", (m) => {
      if (m.type === "progress") onProgress(m.done, m.total);
      else if (m.type === "done") resolve(m.outcome);
      else if (m.type === "error") reject(new Error(m.error));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => { if (code !== 0) reject(new Error(`search worker exited with ${code}`)); });
  });
}
