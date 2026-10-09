import { readCache, writeCache } from "./lib/db.mjs";
import { congressTrades } from "./positions.mjs";
import { LATE_DAYS } from "./alerts.mjs";
import { HOUR, DAY } from "./lib/time.mjs";
import { KEY } from "./lib/cacheKeys.mjs";
import { yahooChart } from "./feeds/yahoo.mjs";
import { readStale } from "./lib/cache.mjs";
import { warmEnabled } from "./lib/env.mjs";

export const BENCHMARK = "SPY";
export const MAX_SYMBOLS = 300;
export const MIN_BUYS = 10;
const SPACING_MS = 450;
const ENTRY_SLACK_DAYS = 5;
export const BASIS = "Disclosed buys, equal-weighted, not their actual portfolio. Entry is the adjusted close on the trade date (or the next trading day); exit is the latest close. The S&P 500 is SPY over the same days. Disclosed amounts are ranges, so the equal-weighted figure ignores size; the mid-weighted figure weights each buy by its range midpoint. Sells are not scored.";

export const dayNum = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY);
const isoOf = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10_000) / 10_000);

/** Index of the first close on or after `day` in an ascending [[day, close], …] series, or -1. */
export function indexOnOrAfter(series, day) {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo < series.length ? lo : -1;
}

function indexOnOrBefore(series, day) {
  const i = indexOnOrAfter(series, day);
  if (i === -1) return series.length - 1;
  return series[i][0] === day ? i : i - 1;
}

/** "$15,001 - $50,000" → 32,500.5; "Over $50,000,000" → 50,000,000; a single figure is itself. */
export function amountMid(text, low = 0) {
  const nums = [...String(text || "").matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
  if (nums.length === 1) return nums[0];
  return low || 0;
}

function leg(series, spy, from, to) {
  const a = series[from];
  const b = series[to];
  const sa = spy[indexOnOrBefore(spy, a[0])];
  const sb = spy[indexOnOrBefore(spy, b[0])];
  if (!sa || !sb || sa[0] < a[0] - ENTRY_SLACK_DAYS) return null;
  const ret = b[1] / a[1] - 1;
  const spyRet = sb[1] / sa[1] - 1;
  return { ret: r4(ret), spy: r4(spyRet), excess: r4(ret - spyRet), days: b[0] - a[0], to: isoOf(b[0]) };
}

/**
 * Pure. One buy against SPY: since the trade, and at +30 / +90 calendar days when that much time has passed.
 * Returns null when there is no close within ENTRY_SLACK_DAYS of the trade date.
 */
export function tradeReturn(traded, series, spy) {
  if (!series?.length || !spy?.length || !traded) return null;
  const start = dayNum(traded);
  const i = indexOnOrAfter(series, start);
  if (i < 0 || series[i][0] - start > ENTRY_SLACK_DAYS) return null;
  const last = series.length - 1;
  const since = leg(series, spy, i, last);
  if (!since) return null;
  const at = (days) => {
    const target = series[i][0] + days;
    if (target > series[last][0]) return null;
    const j = indexOnOrAfter(series, target);
    return j < 0 ? null : leg(series, spy, i, j);
  };
  return { entry: isoOf(series[i][0]), since, d30: at(30), d90: at(90) };
}

/** Pure. Scored rows for every disclosed buy of a symbol with closes. */
export function buyReturns(trades, closes, spy) {
  const out = [];
  for (const t of trades) {
    if (t.side !== "buy" || !t.symbol || !t.inJoin) continue;
    const r = tradeReturn(t.traded, closes.get(t.symbol), spy);
    if (!r) continue;
    out.push({ id: t.id, bioguide: t.bioguide, person: t.person, symbol: t.symbol, traded: t.traded, mid: amountMid(t.amount, t.amountLow), ...r });
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Pure. Per-member summary of scored buys; `buys` counts every disclosed buy, `priced` the ones with quotes. */
export function memberStats(trades, rows) {
  const buys = new Map();
  for (const t of trades) if (t.side === "buy" && t.bioguide) buys.set(t.bioguide, (buys.get(t.bioguide) || 0) + 1);
  const by = new Map();
  for (const r of rows) {
    if (!r.bioguide) continue;
    by.set(r.bioguide, [...(by.get(r.bioguide) || []), r]);
  }
  const out = new Map();
  for (const [id, list] of by) {
    const since = list.map((r) => r.since.excess);
    const d30 = list.filter((r) => r.d30).map((r) => r.d30.excess);
    const d90 = list.filter((r) => r.d90).map((r) => r.d90.excess);
    const weight = list.reduce((a, r) => a + r.mid, 0);
    const ranked = [...list].sort((a, b) => b.since.excess - a.since.excess);
    out.set(id, {
      bioguide: id,
      person: list[0].person,
      buys: buys.get(id) || list.length,
      priced: list.length,
      excessSince: r4(mean(since)),
      medianSince: r4(median(since)),
      excess30: r4(mean(d30)),
      n30: d30.length,
      excess90: r4(mean(d90)),
      n90: d90.length,
      hitRate: r4(since.filter((v) => v > 0).length / since.length),
      excessMid: weight > 0 ? r4(list.reduce((a, r) => a + r.since.excess * r.mid, 0) / weight) : null,
      best: { symbol: ranked[0].symbol, traded: ranked[0].traded, excess: ranked[0].since.excess },
      worst: { symbol: ranked.at(-1).symbol, traded: ranked.at(-1).traded, excess: ranked.at(-1).since.excess }
    });
  }
  return out;
}

/** Pure. Four leaderboards from the disclosure rows and the per-member return stats. */
export function buildLeaders({ trades, stats, people = new Map(), minBuys = MIN_BUYS, limit = 25 }) {
  const seat = (id, t) => {
    const p = people.get(id) || {};
    return { bioguide: id, person: p.name || t?.person || id, party: p.party || t?.party || "", state: p.state || t?.state || "", chamber: p.chamber || t?.chamber || "" };
  };
  const firstTrade = new Map();
  for (const t of trades) if (t.bioguide && !firstTrade.has(t.bioguide)) firstTrade.set(t.bioguide, t);
  const scored = [...stats.values()].filter((s) => s.priced >= minBuys && s.excessSince != null).map((s) => ({ ...s, ...seat(s.bioguide, firstTrade.get(s.bioguide)) }));
  const excessTop = [...scored].sort((a, b) => b.excessSince - a.excessSince).slice(0, limit);
  const excessBottom = [...scored].sort((a, b) => a.excessSince - b.excessSince).slice(0, Math.min(10, limit));

  const per = new Map();
  for (const t of trades) {
    if (!t.bioguide) continue;
    const m = per.get(t.bioguide) || { trades: 0, buys: 0, sells: 0, low: 0, symbols: new Set(), lastFiled: "", late: 0, lateReports: new Set(), reports: new Set(), maxLag: null, maxLagLink: "", maxLagSymbol: "", lags: [] };
    m.trades += 1;
    if (t.side === "buy") m.buys += 1;
    if (t.side === "sell") m.sells += 1;
    m.low += t.amountLow || 0;
    if (t.symbol) m.symbols.add(t.symbol);
    if (String(t.filed) > m.lastFiled) m.lastFiled = t.filed;
    if (t.link) m.reports.add(t.link);
    if (t.lag != null) {
      m.lags.push(t.lag);
      if (t.lag > LATE_DAYS) { m.late += 1; m.lateReports.add(t.link || t.id); }
      if (m.maxLag == null || t.lag > m.maxLag) { m.maxLag = t.lag; m.maxLagLink = t.link; m.maxLagSymbol = t.symbol || t.asset; }
    }
    per.set(t.bioguide, m);
  }
  const rows = [...per.entries()].map(([id, m]) => ({
    ...seat(id, firstTrade.get(id)),
    trades: m.trades, buys: m.buys, sells: m.sells, low: m.low, symbols: m.symbols.size, lastFiled: m.lastFiled,
    reports: m.reports.size, late: m.late, lateReports: m.lateReports.size, maxLag: m.maxLag, maxLagLink: m.maxLagLink, maxLagSymbol: m.maxLagSymbol,
    medianLag: median(m.lags)
  }));
  const active = [...rows].sort((a, b) => b.trades - a.trades || b.low - a.low).slice(0, limit);
  const late = rows.filter((r) => r.late > 0).sort((a, b) => b.lateReports - a.lateReports || b.late - a.late || (b.maxLag || 0) - (a.maxLag || 0)).slice(0, limit);
  const longest = rows.filter((r) => r.maxLag != null && r.maxLag > LATE_DAYS).sort((a, b) => b.maxLag - a.maxLag).slice(0, Math.min(10, limit));

  const sym = new Map();
  for (const t of trades) {
    if (!t.symbol) continue;
    const s = sym.get(t.symbol) || { symbol: t.symbol, asset: t.asset, inJoin: Boolean(t.inJoin), trades: 0, buys: 0, sells: 0, members: new Set(), low: 0 };
    s.trades += 1;
    if (t.side === "buy") s.buys += 1;
    if (t.side === "sell") s.sells += 1;
    s.members.add(t.bioguide || t.person);
    s.low += t.amountLow || 0;
    sym.set(t.symbol, s);
  }
  const tickers = [...sym.values()].map((s) => ({ ...s, members: s.members.size })).sort((a, b) => b.members - a.members || b.trades - a.trades).slice(0, limit);
  return { minBuys, scoredMembers: scored.length, excessTop, excessBottom, active, late, longest, tickers };
}

/* ---------- date window and benchmark status ---------- */

/** A windowed board ranks members with this many priced buys in the window; the all-time board keeps MIN_BUYS. */
export const WINDOW_MIN_BUYS = 3;
const BASIS_LABEL = { filed: "disclosure date (filed)", traded: "trade date" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const back = (today, days) => isoOf(dayNum(today) - days);

/**
 * Pure. The disclosure rows inside [from, to] by `basis` ("filed", the day the public could see it, or "traded"),
 * and the window that was applied. `days` means the last N days through `today`. With no window every row is kept
 * and `window.all` says so, with the span the rows actually cover.
 */
export function applyWindow(trades, { from = "", to = "", days = 0, basis = "filed", today }) {
  const key = basis === "traded" ? "traded" : "filed";
  const n = Math.round(Number(days) || 0);
  let lo = ISO.test(from) ? from : "";
  let hi = ISO.test(to) ? to : "";
  if (n > 0) { hi = hi || today; lo = back(hi, n); }
  const label = BASIS_LABEL[key];
  if (!lo && !hi) {
    const dates = trades.map((t) => String(t[key] || "")).filter((d) => ISO.test(d.slice(0, 10))).map((d) => d.slice(0, 10)).sort();
    return { trades, window: { all: true, from: dates[0] || "", to: dates.at(-1) || "", basis: label, note: `No window requested: every disclosure the app holds${dates.length ? `, ${label} ${dates[0]} to ${dates.at(-1)}` : ""}.` } };
  }
  const kept = trades.filter((t) => {
    const d = String(t[key] || "").slice(0, 10);
    return ISO.test(d) && (!lo || d >= lo) && (!hi || d <= hi);
  });
  return { trades: kept, window: { all: false, from: lo, to: hi, ...(n > 0 ? { days: n } : {}), basis: label, rows: kept.length } };
}

/**
 * Pure. Whether the board holds any SPY comparison, and why not when it doesn't. `benchmarkComparison` is null
 * whenever no member row carries an excess-vs-SPY figure, so a 0 is never read as "matched the market".
 */
export function benchmarkStatus({ lastClose, buys, pricedBuys, scoredMembers, minBuys, progress = {}, warm = true }) {
  const symbols = Math.max(0, (progress.total || 0) - 1);
  const none = (reason) => ({ benchmarkComparison: null, benchmarkComparisonReason: reason });
  if (!lastClose) {
    if (progress.running) return none(`Prices are still loading after a server start (${progress.priced || 0} of ${symbols} symbols read so far), so no buy has an SPY comparison yet.`);
    if (progress.total && progress.failed) return none("SPY closes could not be read from Yahoo Finance, so no buy can be compared with SPY.");
    return none(warm ? "Prices have not been loaded yet, so no buy can be compared with SPY." : "Price loading is off (INTEL_NO_WARM), so no buy can be compared with SPY.");
  }
  if (!buys) return none("There are no disclosed buys in this window.");
  if (!pricedBuys) return none(`None of the ${buys} disclosed buys in this window has a priced entry (a joined ticker with a close within ${ENTRY_SLACK_DAYS} days of the trade date; closes through ${lastClose}).`);
  if (!scoredMembers) return none(`${pricedBuys} of ${buys} disclosed buys are priced, but no member has the ${minBuys} priced buys needed to be ranked against SPY.`);
  return {
    benchmarkComparison: {
      benchmark: BENCHMARK,
      buysInWindow: buys,
      pricedBuys,
      membersRanked: scoredMembers,
      minPricedBuysToRank: minBuys,
      measured: "Each buy from the close on its trade date to the latest close, against SPY over the same days (excessSince); excess30 / excess90 only where 30 / 90 days have passed.",
      through: lastClose,
      ...(progress.running ? { partial: `Prices still loading: ${progress.priced || 0} of ${symbols} symbols so far.` } : {})
    },
    benchmarkComparisonReason: ""
  };
}

/* ---------- daily closes (Yahoo chart, adjusted), cached in sqlite ---------- */


async function fetchCloses(symbol) {
  const body = await yahooChart(symbol, { interval: "1d", range: "2y", includeAdjustedClose: "true", events: "div,splits" });
  const result = body?.chart?.result?.[0];
  if (!result) throw new Error(body?.chart?.error?.description || "no chart");
  const stamps = result.timestamp || [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose || [];
  const raw = result.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const c = adj[i] ?? raw[i];
    if (c == null || !Number.isFinite(c)) continue;
    const d = Math.floor(stamps[i] / 86_400);
    if (out.length && out.at(-1)[0] === d) out[out.length - 1] = [d, Number(c.toPrecision(7))];
    else out.push([d, Number(c.toPrecision(7))]);
  }
  return out;
}

/** Fresh cache → no network. Otherwise fetch; on failure fall back to the stale copy. `fetched` says if we hit Yahoo. */
async function closesFor(db, symbol) {
  const key = KEY.closes(symbol);
  const hit = readCache(db, key);
  if (hit) return { series: hit, fetched: false };
  try {
    const series = await fetchCloses(symbol);
    if (series.length) writeCache(db, key, series, 20 * HOUR);
    return { series, fetched: true };
  } catch (err) {
    return { series: readStale(db, key)?.value ?? null, fetched: true, error: err.message };
  }
}

const state = {
  closes: new Map(),
  spy: null,
  rows: [],
  stats: new Map(),
  progress: { done: 0, total: 0, fetched: 0, failed: 0, startedAt: null, finishedAt: null, running: false },
  tradesAsOf: null
};

function recompute(trades) {
  if (!state.spy?.length) return;
  state.rows = buyReturns(trades, state.closes, state.spy);
  state.stats = memberStats(trades, state.rows);
}

/** Symbols to price: joined tickers with disclosed buys, most-bought first, capped at MAX_SYMBOLS. */
export function pickSymbols(trades, max = MAX_SYMBOLS) {
  const n = new Map();
  for (const t of trades) if (t.side === "buy" && t.symbol && t.inJoin) n.set(t.symbol, (n.get(t.symbol) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([s]) => s);
}

let job = null;

/** One build at a time; callers that want to wait share its promise. */
export function buildReturns(db) {
  if (!job) job = build(db).finally(() => { job = null; });
  return job;
}

/**
 * Wait up to `ms` for prices when none are loaded yet. Prices live in memory, so every server start rebuilds them
 * (about a second from the sqlite cache, minutes when Yahoo must be fetched); a board read in that gap has none.
 */
export async function awaitReturns(db, ms) {
  if (state.spy?.length && !(state.progress.running && !state.rows.length)) return;
  if (!job && !warmEnabled()) return;
  const running = buildReturns(db).catch(() => {});
  let timer;
  await Promise.race([running, new Promise((r) => { timer = setTimeout(r, ms); timer.unref?.(); })]);
  clearTimeout(timer);
}

async function build(db) {
  const board = await congressTrades(db).catch(() => ({ items: [] }));
  const trades = board.items || [];
  if (!trades.length) return;
  const symbols = pickSymbols(trades);
  state.progress = { done: 0, total: symbols.length + 1, fetched: 0, failed: 0, startedAt: new Date().toISOString(), finishedAt: null, running: true };
  state.tradesAsOf = board.asOf || null;
  try {
    const spy = await closesFor(db, BENCHMARK);
    state.spy = spy.series;
    state.progress.done += 1;
    if (spy.fetched) state.progress.fetched += 1;
    if (!state.spy?.length) { state.progress.failed += 1; return; }
    for (const symbol of symbols) {
      const r = await closesFor(db, symbol);
      if (r.series?.length) state.closes.set(symbol, r.series);
      else state.progress.failed += 1;
      if (r.fetched) state.progress.fetched += 1;
      state.progress.done += 1;
      if (state.progress.done % 15 === 0) recompute(trades);
      if (r.fetched) await new Promise((res) => setTimeout(res, SPACING_MS));
    }
    recompute(trades);
  } finally {
    state.progress.running = false;
    state.progress.finishedAt = new Date().toISOString();
  }
}

export function refreshReturns(db) {
  return buildReturns(db)
    .then(() => console.log(`returns: ${state.closes.size} symbols priced, ${state.rows.length} buys scored, ${state.progress.fetched} fetched, ${state.progress.failed} failed`))
    .catch((err) => console.error("returns", err.message));
}

function sourceBlock() {
  const p = state.progress;
  const lastClose = state.spy?.length ? isoOf(state.spy.at(-1)[0]) : null;
  return {
    source: "Disclosures: House Clerk PTRs · Senate eFD. Prices: Yahoo Finance daily adjusted closes.",
    asOf: p.finishedAt || p.startedAt || new Date().toISOString(),
    latency: `Daily closes through ${lastClose || "—"}, refreshed every 12 h (cached 20 h). ${p.running ? `Pricing in progress: ${state.closes.size} of ${Math.max(0, p.total - 1)} symbols priced so far.` : `${state.closes.size} of ${Math.max(0, p.total - 1)} symbols priced.`} Only joined tickers from data/tickers.json with disclosed buys, up to ${MAX_SYMBOLS}.`,
    basis: BASIS,
    progress: { ...p, priced: state.closes.size, scored: state.rows.length, lastClose }
  };
}

/** Per-member return summary for the timeline and share card, plus per-trade results keyed by trade id. */
export function memberReturns(bioguide) {
  const stats = state.stats.get(bioguide) || null;
  const byTrade = new Map(state.rows.filter((r) => r.bioguide === bioguide).map((r) => [r.id, r]));
  return { stats: stats ? { ...stats, basis: BASIS, lastClose: state.spy?.length ? isoOf(state.spy.at(-1)[0]) : null, building: state.progress.running } : null, byTrade };
}

/**
 * The leaderboards over every disclosure, or over a window (`from`/`to`/`days`, by filed or traded date). `waitMs`
 * waits that long for prices after a server start instead of answering with none. `window` and
 * `benchmarkComparison` say what the board covers and whether it holds any SPY figures.
 */
export async function leaders(db, people, { from = "", to = "", days = 0, basis = "filed", waitMs = 0, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (waitMs > 0) await awaitReturns(db, waitMs);
  else if (!state.spy && !state.progress.running && warmEnabled()) void buildReturns(db);
  const board = await congressTrades(db).catch(() => ({ items: [] }));
  const all = board.items || [];
  const { trades, window } = applyWindow(all, { from, to, days, basis, today });
  const ids = window.all ? null : new Set(trades.map((t) => t.id));
  const rows = ids ? state.rows.filter((r) => ids.has(r.id)) : state.rows;
  const stats = ids ? memberStats(trades, rows) : state.stats;
  const minBuys = window.all ? MIN_BUYS : WINDOW_MIN_BUYS;
  const boards = buildLeaders({ trades, stats, people, minBuys });
  const lastClose = state.spy?.length ? isoOf(state.spy.at(-1)[0]) : null;
  return {
    ok: all.length > 0,
    building: state.progress.running || Boolean(board.building),
    ...sourceBlock(),
    window,
    ...benchmarkStatus({
      lastClose,
      buys: trades.filter((t) => t.side === "buy").length,
      pricedBuys: rows.length,
      scoredMembers: boards.scoredMembers,
      minBuys,
      progress: { ...state.progress, priced: state.closes.size },
      warm: warmEnabled()
    }),
    tradesSource: { source: board.source, asOf: board.asOf, latency: board.latency },
    ...boards
  };
}
