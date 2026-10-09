import { listTickers, readCache, tickerBySymbol, writeCache } from "../../lib/db.mjs";
import { readStale } from "../../lib/cache.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { MINUTE, DAY } from "../../lib/time.mjs";
import { pool } from "../../lib/pool.mjs";
import { once } from "../../lib/once.mjs";
import { BADGE_DAYS, WATCH_MAX, WATCH_SOURCES, badgesOf, cleanTickers, mergeEvents, watchAlertRows } from "../../../shared/watchlist.mjs";
import { congressSection, contractSection, filingSection, insiderSection, issuerFilings, lobbyingSection, newsSection, stakeSection, watchQuote, whaleSection } from "./sources.mjs";

const ACTIVITY_TTL = 10 * MINUTE;
const WATCH_KEEP = 14 * DAY;
/** Watched names refresh their EDGAR list this often (one SEC request each, far under the 8 req/s gate). */
const SUBS_FRESH = 20 * MINUTE;
const TIMEOUT = Symbol("timeout");

export const daysOf = (v) => (BADGE_DAYS.includes(Number(v)) ? Number(v) : 30);

/** Runs one section loader; past `ms` it reports "loading" while the loader keeps filling its caches for the next call. */
async function run(key, ms, load) {
  const t0 = Date.now();
  const job = Promise.resolve().then(load);
  job.catch(() => {});
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), ms); timer.unref?.(); });
  try {
    const out = await Promise.race([job, late]);
    if (out === TIMEOUT) return { key, status: "loading", source: "", latency: "", note: `Still fetching after ${Math.round(ms / 1000)} s; it fills in on the next refresh.`, events: [], building: true };
    return { key, ...out, ms: Date.now() - t0 };
  } catch (err) {
    return { key, status: "error", source: "", latency: "", note: String(err?.message || err).slice(0, 200), events: [], ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every activity source for one join-table ticker, composed from the existing feeds. A complete result is cached for
 * ten minutes; a partial one (some section still loading) is not, so the next call picks up what finished.
 */
export async function tickerActivity(db, symbol, { fresh = false, deadlineMs = 9000 } = {}) {
  const ticker = tickerBySymbol(db, String(symbol || ""));
  if (!ticker) return null;
  const key = KEY.watchActivity(ticker.symbol);
  if (!fresh) {
    const hit = readCache(db, key);
    if (hit) return hit;
  }
  return once(`watch:${ticker.symbol}:${fresh ? "fresh" : "read"}`, () => compose(db, ticker, key, fresh, deadlineMs));
}

async function compose(db, ticker, key, fresh, deadlineMs) {
  const filings = ticker.cik ? issuerFilings(db, ticker.cik, fresh ? SUBS_FRESH : 0) : Promise.resolve(null);
  filings.catch(() => {});
  const loaders = {
    congress: () => congressSection(db, ticker),
    insiders: () => insiderSection(db, ticker, deadlineMs - 500),
    whales: () => whaleSection(db, ticker),
    stakes: () => stakeSection(db, ticker, filings),
    contracts: () => contractSection(db, ticker),
    lobbying: () => lobbyingSection(db, ticker),
    filings: () => filingSection(db, ticker, filings),
    news: () => newsSection(db, ticker)
  };
  const sections = await Promise.all(WATCH_SOURCES.map((s) => run(s.key, deadlineMs, loaders[s.key]).then((out) => ({ ...out, label: s.label }))));
  const events = mergeEvents(sections.flatMap((s) => s.events || []));
  const result = {
    ok: true,
    symbol: ticker.symbol,
    name: ticker.name,
    inJoin: true,
    asOf: new Date().toISOString(),
    sections: sections.map(({ events: list, ...s }) => ({ ...s, count: (list || []).length })),
    events
  };
  if (!sections.some((s) => s.building || s.status === "loading")) writeCache(db, key, result, ACTIVITY_TTL);
  return result;
}

/** One ticker's activity plus badges for `days` and a delayed quote; the shape GET /api/watchlist/activity/:symbol returns. */
export async function tickerDossier(db, symbol, { days = 30 } = {}) {
  const ticker = tickerBySymbol(db, String(symbol || ""));
  if (!ticker) return null;
  touchWatched(db, [ticker.symbol], { onlyKnown: true });
  const [activity, quote] = await Promise.all([tickerActivity(db, ticker.symbol), watchQuote(db, ticker).catch((err) => ({ ok: false, source: "Yahoo Finance chart API", error: err.message }))]);
  const d = daysOf(days);
  return { ...activity, days: d, badges: badgesOf(activity.events, d), quote, building: activity.sections.some((s) => s.building || s.status === "loading") };
}

/** Rows for the Today watchlist: badges and quote per valid ticker (no events), plus the symbols not in the join table. */
export async function watchSummary(db, requested, { days = 30 } = {}) {
  const known = new Set(listTickers(db).map((t) => t.symbol));
  const { valid, invalid } = cleanTickers(requested, known);
  touchWatched(db, valid);
  const d = daysOf(days);
  const out = new Map();
  await pool(valid, 8, async (symbol) => {
    const row = await tickerDossier(db, symbol, { days: d }).catch((err) => ({ ok: false, symbol, error: err.message }));
    if (row) {
      const { events, ...rest } = row;
      out.set(symbol, { ...rest, newest: events?.[0] || null });
    }
  });
  return {
    ok: true,
    asOf: new Date().toISOString(),
    days: d,
    max: WATCH_MAX,
    items: valid.map((s) => out.get(s)).filter(Boolean),
    invalid,
    latency: "Each source keeps its own lag (see its section). Activity is recomposed at most every 10 min; watched names are refreshed in the background every 15 min."
  };
}

/** Records the symbols a client watches so the background job keeps them warm. Writes at most every 10 min per symbol. */
export function touchWatched(db, symbols, { onlyKnown = false } = {}) {
  if (!symbols.length) return;
  const now = Date.now();
  const seen = readStale(db, KEY.watchSet)?.value || {};
  if (onlyKnown && !symbols.some((s) => s in seen)) return;
  let changed = false;
  for (const s of symbols) if (!(now - (seen[s] || 0) < 10 * MINUTE)) { seen[s] = now; changed = true; }
  for (const [s, t] of Object.entries(seen)) if (now - t > WATCH_KEEP) { delete seen[s]; changed = true; }
  if (changed) writeCache(db, KEY.watchSet, seen, 30 * DAY);
}

export function watchedSymbols(db, now = Date.now()) {
  const seen = readStale(db, KEY.watchSet)?.value || {};
  return Object.entries(seen).filter(([, t]) => now - t <= WATCH_KEEP).sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, WATCH_MAX);
}

/**
 * Alert rows for watched tickers from the last composed activity (never fetches; the job and the watchlist keep it
 * fresh). Only sources the Alerts feed does not already build itself: 13D/13G, contracts, 13F changes and 8-Ks.
 */
export function watchAlerts(db, symbols, since = "") {
  touchWatched(db, symbols);
  const rows = [];
  let asOf = "";
  for (const s of symbols) {
    const stored = readStale(db, KEY.watchActivity(s));
    if (!stored?.value?.events) continue;
    if (!asOf || stored.value.asOf < asOf) asOf = stored.value.asOf;
    rows.push(...watchAlertRows(stored.value.events, since));
  }
  return { rows, asOf };
}

/** Background pass (jobs/warm.mjs): recompose every watched ticker with a fresh EDGAR list, two at a time. */
export async function refreshWatched(db) {
  const symbols = watchedSymbols(db);
  if (!symbols.length) return 0;
  let done = 0;
  await pool(symbols, 2, async (s) => {
    const res = await tickerActivity(db, s, { fresh: true, deadlineMs: 90_000 }).catch((err) => { console.error(`watch ${s}`, err.message); return null; });
    if (res) done += 1;
  });
  console.log(`watchlist warm: ${done} of ${symbols.length} tickers`);
  return done;
}
