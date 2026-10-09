import { runBacktest } from "../../../shared/backtest.mjs";
import { BENCHMARKS, BENCHMARK_LABEL, DEFAULT_FILTERS, DEFAULT_RULES, LIMITS, SECTOR_ETF, SOURCES, SOURCE_LABEL, cleanSpec, describeSpec, specHash } from "../../../shared/backtestSpec.mjs";
import { readCache, writeCache } from "../../lib/db.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { MINUTE } from "../../lib/time.mjs";
import { committees } from "../../roster.mjs";
import { lastBarDay, loadBars } from "./bars.mjs";
import { congressSource, contractsSource, form4Source, lobbyingSource } from "./sources.mjs";

const SOURCE_FNS = { congress: congressSource, form4: form4Source, contracts: contractsSource, lobbying: lobbyingSource };

export const RUN_BUDGET_MS = 40_000;
export const MAX_SYMBOLS = 350;
const RESULT_TTL = 30 * MINUTE;

/** What the form needs: sources, benchmarks, sectors, committees, defaults, limits. */
export async function backtestOptions(db) {
  const res = await committees(db).catch(() => ({ items: [] }));
  return {
    ok: true,
    sources: SOURCES.map((id) => ({ id, label: SOURCE_LABEL[id] })),
    benchmarks: BENCHMARKS.map((id) => ({ id, label: BENCHMARK_LABEL[id] || `${id} sector ETF` })),
    sectors: Object.keys(SECTOR_ETF),
    committees: (res.items || []).map((c) => ({ id: c.id, name: c.name, chamber: c.chamber, size: c.members.length })),
    defaults: { source: "congress", filters: DEFAULT_FILTERS, rules: DEFAULT_RULES },
    limits: LIMITS
  };
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * Run one spec. Cached by spec hash (30 min) only when every price was in hand. Capped signals, a symbol cap,
 * and a wall-clock budget bound the run; what did not finish is counted in the caveats, never dropped silently.
 */
export async function runSpec(db, raw, { budgetMs = RUN_BUDGET_MS, loadBarsFn = loadBars, now = Date.now() } = {}) {
  const cleaned = cleanSpec(raw);
  if (!cleaned.ok) return { ok: false, error: cleaned.error, missing: "" };
  const spec = cleaned.spec;
  const hash = specHash(spec);
  const hit = readCache(db, KEY.backtest(hash));
  if (hit) return { ...hit, cache: "hit" };
  const t0 = Date.now();
  const deadline = t0 + budgetMs;

  const src = await SOURCE_FNS[spec.source](db, spec.filters);
  if (src.error) return { ok: false, error: src.error, missing: src.missing || "", building: Boolean(src.building), spec, description: describeSpec(spec) };
  const tSignals = Date.now();

  let signals = src.signals;
  const uncapped = signals.length;
  signals = [...signals].sort((a, b) => String(b.signalDate).localeCompare(String(a.signalDate))).slice(0, LIMITS.signals);
  const notes = [...(src.context.notes || [])];
  if (uncapped > signals.length) notes.push({ level: "warn", id: "cap", text: `${uncapped} signals matched; only the ${signals.length} most recently made public are run (cap ${LIMITS.signals}).` });

  const counts = new Map();
  for (const s of signals) counts.set(s.symbol, (counts.get(s.symbol) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const symbols = ranked.slice(0, MAX_SYMBOLS);
  if (ranked.length > symbols.length) {
    const dropSet = new Set(ranked.slice(MAX_SYMBOLS));
    signals = signals.filter((s) => !dropSet.has(s.symbol));
    notes.push({ level: "warn", id: "symcap", text: `${ranked.length} distinct tickers matched; the ${MAX_SYMBOLS} with the most signals are priced (${dropSet.size} dropped).` });
  }
  const benchIds = new Set(spec.rules.benchmark === "SECTOR" ? ["SPY", ...new Set(signals.map((s) => SECTOR_ETF[s.sector]).filter(Boolean))] : [spec.rules.benchmark]);
  const need = [...new Set([...symbols, ...benchIds])];
  const priced = await loadBarsFn(db, need, { deadline });
  const tPrices = Date.now();
  const benchBars = Object.fromEntries([...benchIds].map((id) => [id, priced.bars[id]]).filter(([, v]) => v?.length));
  const missingBench = [...benchIds].filter((id) => !benchBars[id]);
  if (missingBench.length === benchIds.size) {
    return { ok: false, error: `No benchmark prices for ${missingBench.join(", ")} yet${priced.pending.length ? ". Prices are still loading; try again shortly" : ""}.`, building: priced.pending.length > 0, spec, description: describeSpec(spec) };
  }
  const symbolBars = Object.fromEntries(symbols.map((s) => [s, priced.bars[s]]).filter(([, v]) => v?.length));
  const pendingSyms = priced.pending.filter((s) => symbols.includes(s));
  if (pendingSyms.length) notes.push({ level: "warn", id: "pending", text: `${pendingSyms.length} tickers were still loading prices when the ${Math.round(budgetMs / 1000)} s budget ended and are left out of this run (${pendingSyms.slice(0, 10).join(", ")}${pendingSyms.length > 10 ? "…" : ""}). They keep loading; run again in a minute.` });
  if (priced.stale.length) notes.push({ level: "info", id: "stale", text: `${priced.stale.length} tickers use a cached price history older than 12 h because Yahoo did not answer.` });

  const result = runBacktest({
    signals,
    bars: symbolBars,
    benchBars,
    rules: spec.rules,
    context: { ...src.context, notes, unpriced: pendingSyms }
  });
  const tEngine = Date.now();
  const last = lastBarDay({ ...symbolBars, ...benchBars });
  const feeds = [
    ...src.feeds,
    {
      label: "Prices",
      source: "Yahoo Finance v8 chart, daily bars adjusted for splits and dividends",
      asOf: priced.oldestStoredAt ? iso(priced.oldestStoredAt) : iso(tPrices),
      latency: `Daily bars through ${last || "—"}; cached 12 h. ${priced.cached} symbols from cache, ${priced.fetched} fetched in ${((tPrices - tSignals) / 1000).toFixed(1)} s${priced.missing.length ? `, ${priced.missing.length} unknown to Yahoo` : ""}.`
    }
  ];
  const asOfs = feeds.map((f) => f.asOf).filter(Boolean).sort();
  const complete = !pendingSyms.length && !src.building;
  const body = {
    ...result,
    spec,
    description: describeSpec(spec),
    source: feeds.map((f) => f.source).filter(Boolean).join(" · "),
    asOf: asOfs[0] || iso(tEngine),
    latency: `${feeds.map((f) => `${f.label}: ${f.latency}`).filter((s) => s.length > 10).join(" ")} Run took ${((tEngine - t0) / 1000).toFixed(1)} s.`,
    feeds,
    timing: { totalMs: tEngine - t0, signalsMs: tSignals - t0, pricesMs: tPrices - tSignals, engineMs: tEngine - tPrices },
    counts: { ...result.counts, matched: uncapped, tickers: symbols.length, priced: Object.keys(symbolBars).length },
    building: !complete,
    pending: pendingSyms,
    cache: "miss",
    ranAt: iso(now)
  };
  if (complete) writeCache(db, KEY.backtest(hash), body, RESULT_TTL);
  return body;
}
