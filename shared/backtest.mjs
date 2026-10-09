/**
 * Backtest engine. Pure: signals + daily bars in, numbers out. No clock, no network.
 *
 * Bars are [day, open, close][] ascending, `day` = whole days since 1970-01-01 UTC, prices split/dividend adjusted.
 * A signal carries the PUBLIC date of the record. Entry is the first bar strictly after that date, so nothing
 * trades on a day the record was not yet public (a filing may post after the close).
 *
 * The portfolio is calendar-time: each trading day it holds the open positions at equal weight (or weight by
 * disclosed size) and earns their average daily return; days with nothing open earn 0. The benchmark gets the
 * same positions, weights, and days, so excess return compares like with like.
 */
import { SECTOR_ETF, cleanRules } from "./backtestSpec.mjs";

const DAY_MS = 86_400_000;
export const ENTRY_SLACK_DAYS = 7;
export const SIZE_CAP = 1_000_000;
export const MIN_TRADES = 30;

export const dayOf = (iso) => {
  const s = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
};
export const isoOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Index of the first bar with day > `day`, or -1. */
export function firstAfter(bars, day) {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid][0] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo < bars.length ? lo : -1;
}

/** Index of the last bar with day <= `day`, or -1. */
export function lastOnOrBefore(bars, day) {
  const i = firstAfter(bars, day);
  return i === -1 ? bars.length - 1 : i - 1;
}

const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10_000) / 10_000);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pctile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stdev = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** "$15,001 - $50,000" → 32,500.5. A single figure is itself; text without dollars falls back to `low`. */
export function amountMid(textValue, low = 0) {
  const nums = [...String(textValue || "").matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
  if (nums.length === 1) return nums[0];
  return low || 0;
}

/** Peak-to-trough drop of an index curve (starting value included). Dates are optional parallel labels. */
export function maxDrawdown(values, labels = []) {
  let peak = values[0];
  let peakAt = 0;
  let worst = 0;
  let from = 0;
  let to = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > peak) { peak = values[i]; peakAt = i; }
    const dd = values[i] / peak - 1;
    if (dd < worst) { worst = dd; from = peakAt; to = i; }
  }
  return { depth: worst, from: labels[from] ?? from, to: labels[to] ?? to, peak: values[from], trough: values[to] };
}

function benchmarkId(rules, signal) {
  if (rules.benchmark !== "SECTOR") return rules.benchmark;
  return SECTOR_ETF[signal.sector] || "SPY";
}

/** Benchmark level on `day`: the last close on or before it (holidays and halts carry forward). */
function levelOn(bars, day) {
  const i = lastOnOrBefore(bars, day);
  return i < 0 ? null : bars[i][2];
}

function costOf(rules) {
  return (rules.costBps + rules.slippageBps) / 10_000;
}

/**
 * One signal → a trade, or an exclusion reason. `sign` is +1 for a long and −1 for a short.
 * Pure over the bars passed in; looks only at bars from the entry day onward.
 */
export function simulateTrade(signal, bars, bench, rules, signalDay, sign) {
  const entryAt = firstAfter(bars, signalDay);
  if (entryAt === -1) return { skip: "noBarAfterSignal" };
  if (bars[entryAt][0] - signalDay > ENTRY_SLACK_DAYS) return { skip: entryAt === 0 ? "beforePriceHistory" : "entryGap" };
  const atOpen = rules.entry === "nextOpen";
  const entryBar = bars[entryAt];
  const openMissing = atOpen && !(entryBar[1] > 0);
  const entryPrice = atOpen && !openMissing ? entryBar[1] : entryBar[2];
  if (!(entryPrice > 0)) return { skip: "badPrice" };
  const startDay = entryBar[0];
  const horizon = startDay + rules.holdDays;
  const firstCheck = atOpen && !openMissing ? entryAt : entryAt + 1;
  let exitAt = -1;
  let why = "";
  for (let j = firstCheck; j < bars.length; j += 1) {
    const pnl = sign * (bars[j][2] / entryPrice - 1);
    if (rules.stopLossPct && pnl <= -rules.stopLossPct / 100) { exitAt = j; why = "stop"; break; }
    if (rules.takeProfitPct && pnl >= rules.takeProfitPct / 100) { exitAt = j; why = "take"; break; }
    if (bars[j][0] >= horizon) { exitAt = j; why = "hold"; break; }
  }
  let open = false;
  if (exitAt === -1) {
    if (rules.openTrades === "exclude" || bars.length - 1 < firstCheck) return { skip: "stillOpen" };
    exitAt = bars.length - 1;
    why = "open";
    open = true;
  }
  const exitBar = bars[exitAt];
  const c = costOf(rules);
  const path = [];
  const benchStart = atOpen && !openMissing ? benchEntry(bench, startDay) : levelOn(bench, startDay);
  if (!(benchStart > 0)) return { skip: "noBenchmark" };
  let prevStock = entryPrice;
  let prevBench = benchStart;
  const from = atOpen && !openMissing ? entryAt : entryAt + 1;
  for (let k = from; k <= exitAt; k += 1) {
    const close = bars[k][2];
    const bl = levelOn(bench, bars[k][0]);
    path.push([bars[k][0], sign * (close / prevStock - 1), sign * (bl / prevBench - 1)]);
    prevStock = close;
    prevBench = bl;
  }
  if (!path.length) return { skip: "stillOpen" };
  // Costs: one side at entry, one at exit.
  path[0][1] -= c;
  path[path.length - 1][1] -= c;
  const gross = sign * (exitBar[2] / entryPrice - 1);
  const benchRet = sign * (prevBench / benchStart - 1);
  const ret = gross - 2 * c;
  return {
    trade: {
      entryDay: startDay,
      exitDay: exitBar[0],
      entryPrice,
      exitPrice: exitBar[2],
      ret,
      bench: benchRet,
      excess: ret - benchRet,
      days: exitBar[0] - startDay,
      exit: why,
      open,
      openFallback: openMissing,
      path
    }
  };
}

/** Benchmark price at the entry day's open when the benchmark traded that day, else its last close before it. */
function benchEntry(bench, day) {
  const i = lastOnOrBefore(bench, day);
  if (i < 0) return null;
  if (bench[i][0] === day && bench[i][1] > 0) return bench[i][1];
  return bench[i][2];
}

function weightOf(sizing, signal, fallback) {
  if (sizing !== "amountMid") return { w: 1, estimated: false, missing: false };
  const hint = Number(signal.sizeHint);
  if (hint > 0) return { w: Math.min(hint, SIZE_CAP), estimated: Boolean(signal.sizeIsRange), missing: false };
  return { w: fallback, estimated: false, missing: true };
}

function breakdown(trades, keyOf, labelOf, limit = 30) {
  const by = new Map();
  for (const t of trades) {
    const k = keyOf(t);
    if (!k) continue;
    const row = by.get(k) || { key: k, label: labelOf(t), rets: [], ex: [] };
    row.rets.push(t.ret);
    row.ex.push(t.excess);
    by.set(k, row);
  }
  const rows = [...by.values()].map((r) => ({
    key: r.key,
    label: r.label,
    n: r.rets.length,
    avg: r4(mean(r.rets)),
    median: r4(median(r.rets)),
    hitRate: r4(r.rets.filter((v) => v > 0).length / r.rets.length),
    avgExcess: r4(mean(r.ex)),
    beatRate: r4(r.ex.filter((v) => v > 0).length / r.ex.length)
  })).sort((a, b) => b.n - a.n || (b.avgExcess ?? 0) - (a.avgExcess ?? 0));
  return { total: rows.length, rows: rows.slice(0, limit) };
}

const SKIP_TEXT = {
  noPrice: "had no daily price history (renamed, delisted, acquired, or not covered by Yahoo)",
  notPriced: "were not priced inside the time budget",
  noBarAfterSignal: "were made public after the last price bar",
  entryGap: "had no trading day within a week after the public date",
  beforePriceHistory: "were public before the symbol's price history begins (new listing, ticker change, or older than the three-year window)",
  badPrice: "had an unusable entry price",
  stillOpen: "have not reached their exit yet (hold not complete)",
  noBenchmark: "had no benchmark price on the entry day",
  badDate: "had no usable public date",
};

/**
 * Run a backtest. `signals`: { id, symbol, signalDate, side, sizeHint?, sizeIsRange?, tradeDate?, actor?, actorLabel?, sector?, meta? }.
 * `bars` and `benchBars` map symbol → bars. `context` carries what the engine cannot see: notes, paper-filing counts.
 */
export function runBacktest({ signals: allSignals = [], bars = {}, benchBars = {}, rules: rawRules, context = {}, calendar = null }) {
  const rules = cleanRules(rawRules);
  let signals = allSignals;
  const skipped = {};
  const skippedSymbols = {};
  const bump = (reason, symbol) => {
    skipped[reason] = (skipped[reason] || 0) + 1;
    if (symbol) (skippedSymbols[reason] ||= new Set()).add(symbol);
  };
  const offered = signals.length;
  signals = signals.filter((s) => {
    const side = s.side === "sell" ? "sell" : s.side === "buy" ? "buy" : "";
    return side && (rules.sides === "both" || rules.sides === side);
  });
  const sizes = signals.map((s) => Number(s.sizeHint)).filter((v) => v > 0).map((v) => Math.min(v, SIZE_CAP));
  const sizeFallback = median(sizes) || 1;
  const trades = [];
  let estimated = 0;
  let missingSize = 0;
  let openFallback = 0;
  let benchFallback = 0;
  const c = costOf(rules);

  for (const signal of signals) {
    const sym = String(signal.symbol || "").toUpperCase();
    const side = signal.side === "sell" ? "sell" : "buy";
    const signalDay = dayOf(signal.signalDate);
    if (signalDay == null) { bump("badDate", sym); continue; }
    const series = bars[sym];
    if (!series?.length) { bump(context.unpriced?.includes(sym) ? "notPriced" : "noPrice", sym); continue; }
    const id = benchmarkId(rules, signal);
    const bench = benchBars[id] || (rules.benchmark === "SECTOR" ? benchBars.SPY : null);
    if (!bench?.length) { bump("noBenchmark", sym); continue; }
    if (rules.benchmark === "SECTOR" && !benchBars[id]) benchFallback += 1;
    const out = simulateTrade(signal, series, bench, rules, signalDay, side === "sell" ? -1 : 1);
    if (out.skip) { bump(out.skip, sym); continue; }
    const wt = weightOf(rules.sizing, signal, sizeFallback);
    if (wt.estimated) estimated += 1;
    if (wt.missing) missingSize += 1;
    if (out.trade.openFallback) openFallback += 1;
    trades.push({
      id: signal.id,
      symbol: sym,
      side,
      actor: signal.actor || "",
      actorLabel: signal.actorLabel || signal.actor || "",
      signalDay,
      tradeDay: dayOf(signal.tradeDate),
      weight: wt.w,
      benchmark: id,
      ...out.trade
    });
  }

  const result = {
    ok: true,
    rules,
    counts: { signals: signals.length, offeredSignals: offered, used: trades.length, skipped: Object.values(skipped).reduce((a, b) => a + b, 0) },
    trades: [],
    byMember: { total: 0, rows: [] },
    byTicker: { total: 0, rows: [] },
    curve: [],
    stats: null,
    caveats: { items: [] }
  };
  result.caveats = buildCaveats({ rules, signals, trades, skipped, skippedSymbols, estimated, missingSize, openFallback, benchFallback, context, c });
  if (!trades.length) return result;

  trades.sort((a, b) => a.entryDay - b.entryDay || String(a.id).localeCompare(String(b.id)));
  const curve = buildCurve(trades, calendar || benchBars[rules.benchmark === "SECTOR" ? "SPY" : rules.benchmark] || null);
  const rets = trades.map((t) => t.ret);
  const ex = trades.map((t) => t.excess);
  const days = curve.days;
  const spanDays = days.length ? days.at(-1) - days[0] + 1 : 0;
  const total = curve.s.at(-1) - 1;
  const btotal = curve.b.at(-1) - 1;
  const annual = (v) => (spanDays >= 90 && v > -1 ? (1 + v) ** (365 / spanDays) - 1 : null);
  const dd = maxDrawdown(curve.s, curve.labels);
  const bdd = maxDrawdown(curve.b, curve.labels);
  const sd = stdev(curve.R);
  const sdx = stdev(curve.R.map((v, i) => v - curve.B[i]));
  const exBeat = ex.filter((v) => v > 0).length;
  const sdEx = stdev(ex);
  result.curve = curve.labels.map((d, i) => ({ d, s: r4(curve.s[i]), b: r4(curve.b[i]) }));
  result.stats = {
    trades: trades.length,
    total: r4(total),
    annualized: r4(annual(total)),
    benchmarkTotal: r4(btotal),
    benchmarkAnnualized: r4(annual(btotal)),
    excessTotal: r4(total - btotal),
    excessAnnualized: annual(total) != null && annual(btotal) != null ? r4(annual(total) - annual(btotal)) : null,
    hitRate: r4(rets.filter((v) => v > 0).length / rets.length),
    beatRate: r4(exBeat / ex.length),
    avgTrade: r4(mean(rets)),
    medianTrade: r4(median(rets)),
    avgExcess: r4(mean(ex)),
    medianExcess: r4(median(ex)),
    excessT: sdEx ? r2(mean(ex) / (sdEx / Math.sqrt(ex.length))) : null,
    best: r4(Math.max(...rets)),
    worst: r4(Math.min(...rets)),
    avgHoldDays: r2(mean(trades.map((t) => t.days))),
    maxDrawdown: r4(dd.depth),
    drawdownFrom: dd.from,
    drawdownTo: dd.to,
    benchmarkMaxDrawdown: r4(bdd.depth),
    wins: rets.filter((v) => v > 0).length,
    sessions: curve.R.length,
    dailyMean: curve.R.length ? Math.round(mean(curve.R) * 1e8) / 1e8 : null,
    dailySd: sd ? Math.round(sd * 1e8) / 1e8 : null,
    drawdownPeak: r4(dd.peak),
    drawdownTrough: r4(dd.trough),
    volatility: sd ? r4(sd * Math.sqrt(252)) : null,
    sharpeish: sd ? r2((mean(curve.R) / sd) * Math.sqrt(252)) : null,
    infoRatioish: sdx ? r2((mean(curve.R.map((v, i) => v - curve.B[i])) / sdx) * Math.sqrt(252)) : null,
    maxConcurrent: curve.maxOpen,
    avgConcurrent: r2(curve.avgOpen),
    activeShare: r4(curve.activeDays / Math.max(1, curve.R.length)),
    from: curve.labels[0],
    to: curve.labels.at(-1),
    spanDays,
    sharpeNote: "Sharpe-ish: mean daily return ÷ daily standard deviation × √252, risk-free rate taken as 0, calendar-time portfolio. A rough score on a short, overlapping sample, not a risk-adjusted performance claim.",
    weighting: rules.sizing === "amountMid" ? `Weighted by disclosed range midpoint (capped at $${SIZE_CAP.toLocaleString("en-US")}).` : "Equal weight across open positions."
  };
  result.trades = trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    actor: t.actor,
    actorLabel: t.actorLabel,
    signal: isoOf(t.signalDay),
    traded: t.tradeDay == null ? "" : isoOf(t.tradeDay),
    entry: isoOf(t.entryDay),
    exit: isoOf(t.exitDay),
    entryPrice: r4(t.entryPrice),
    exitPrice: r4(t.exitPrice),
    ret: r4(t.ret),
    bench: r4(t.bench),
    excess: r4(t.excess),
    days: t.days,
    why: t.exit,
    open: t.open,
    benchmark: t.benchmark,
    weight: t.weight
  }));
  result.byMember = breakdown(trades, (t) => t.actor, (t) => t.actorLabel);
  result.byTicker = breakdown(trades, (t) => t.symbol, (t) => t.symbol);
  return result;
}

/** Calendar-time curve from trade paths. Idle days (nothing open) earn 0; `calendar` adds benchmark trading days. */
function buildCurve(trades, calendar) {
  const byDay = new Map();
  for (const t of trades) for (const [d, rs, rb] of t.path) {
    let row = byDay.get(d);
    if (!row) byDay.set(d, (row = { w: 0, s: 0, b: 0, n: 0 }));
    row.w += t.weight;
    row.s += t.weight * rs;
    row.b += t.weight * rb;
    row.n += 1;
  }
  const first = Math.min(...byDay.keys());
  const last = Math.max(...byDay.keys());
  const daySet = new Set(byDay.keys());
  if (calendar) for (const bar of calendar) if (bar[0] >= first && bar[0] <= last) daySet.add(bar[0]);
  const days = [...daySet].sort((a, b) => a - b);
  const s = [1];
  const b = [1];
  const R = [];
  const B = [];
  const labels = [isoOf(days[0] - 1)];
  let maxOpen = 0;
  let sumOpen = 0;
  let activeDays = 0;
  for (const d of days) {
    const row = byDay.get(d);
    const rs = row ? row.s / row.w : 0;
    const rb = row ? row.b / row.w : 0;
    R.push(rs);
    B.push(rb);
    s.push(s.at(-1) * (1 + rs));
    b.push(b.at(-1) * (1 + rb));
    labels.push(isoOf(d));
    if (row) { activeDays += 1; sumOpen += row.n; maxOpen = Math.max(maxOpen, row.n); }
  }
  return { days, s, b, R, B, labels, maxOpen, avgOpen: activeDays ? sumOpen / activeDays : 0, activeDays };
}

/**
 * Filing lag = original report date − trade date. A trade that first became public in a later amendment has its
 * extra wait counted separately as `amended`, not as filing lag.
 */
function lagStats(signals) {
  const lags = [];
  const waits = [];
  for (const s of signals) {
    const a = dayOf(s.tradeDate);
    const f = dayOf(s.filedDate || s.signalDate);
    const p = dayOf(s.signalDate);
    if (a != null && f != null && f >= a) lags.push(f - a);
    if (f != null && p != null && p > f) waits.push(p - f);
  }
  if (!lags.length) return null;
  return {
    n: lags.length,
    median: median(lags),
    mean: r2(mean(lags)),
    p90: pctile(lags, 0.9),
    max: Math.max(...lags),
    over45: lags.filter((v) => v > 45).length,
    amended: waits.length ? { n: waits.length, median: median(waits), max: Math.max(...waits) } : null
  };
}

function buildCaveats({ rules, signals, trades, skipped, skippedSymbols, estimated, missingSize, openFallback, benchFallback, context, c }) {
  const items = [];
  const add = (level, id, textValue) => items.push({ level, id, text: textValue });
  const lag = lagStats(signals);
  if (lag) {
    add("info", "lag", `Disclosure lag on the ${lag.n} signals (original filing date minus trade date): median ${lag.median} days, mean ${lag.mean}, 90th percentile ${lag.p90}, longest ${lag.max}; ${lag.over45} filed after the 45-day STOCK Act deadline. Entry is the first trading day after the public date, so the run only uses what was public.`);
    if (lag.amended) add("info", "amendLag", `${lag.amended.n} signals first appear in a later amendment, a median ${lag.amended.median} days (up to ${lag.amended.max}) after the original report; they enter after the amendment date. That wait is not counted as filing lag.`);
  }
  if (rules.sizing === "amountMid" || context.rangeAmounts) {
    add("warn", "ranges", `Congress discloses dollar ranges, not amounts. ${estimated ? `${estimated} trades are sized by the range midpoint, an estimate.` : "Equal weight ignores size."}${missingSize ? ` ${missingSize} had no amount and use the median size.` : ""} Ranges are open-ended at the top; sizes are capped at $${SIZE_CAP.toLocaleString("en-US")}.`);
  }
  for (const [reason, n] of Object.entries(skipped)) {
    const syms = [...(skippedSymbols[reason] || [])].sort();
    const shown = syms.slice(0, 12).join(", ");
    add(reason === "noPrice" || reason === "notPriced" ? "warn" : "info", `skip:${reason}`, `${n} signals ${SKIP_TEXT[reason] || reason}${syms.length ? ` (${syms.length} symbols: ${shown}${syms.length > 12 ? "…" : ""})` : ""}. They are left out, not counted as zero.`);
  }
  if (context.paperFilings) add("warn", "paper", `${context.paperFilings} scanned paper filings in the window are not parsed, so those trades are missing from the signal set.`);
  if (context.unparsed) add("warn", "unparsed", `${context.unparsed} electronic reports could not be read this run.`);
  if (rules.sides !== "buy" && trades.some((t) => t.side === "sell")) add("warn", "short", "Sells are scored as shorts of the same stock with no borrow cost, no dividends owed, and no squeeze risk. A sale by a member is often liquidity, not a view.");
  const byActor = new Map();
  for (const t of trades) byActor.set(t.actorLabel || t.actor, (byActor.get(t.actorLabel || t.actor) || 0) + 1);
  const top = [...byActor.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && byActor.size > 1 && top[1] / trades.length >= 0.4) {
    add("warn", "concentration", `One name drives this sample: ${top[0]} accounts for ${top[1]} of ${trades.length} trades (${Math.round((top[1] / trades.length) * 100)}%). Read the result as that person's record, not the group's.`);
  }
  if (rules.benchmark === "^GSPC") {
    add("warn", "priceIndex", "^GSPC is a price index without dividends, while the stocks use dividend-adjusted prices. That tilts excess return upward by roughly the S&P yield (about 1.2%/yr). Pick SPY for a like-for-like comparison.");
  }
  if (openFallback) add("info", "open", `${openFallback} entries had no open print and used the close.`);
  if (benchFallback) add("info", "sectorFallback", `${benchFallback} trades had no sector ETF mapped and used SPY.`);
  add("info", "costs", `Costs: ${rules.costBps} bps commission + ${rules.slippageBps} bps slippage per side (${r2(c * 2e4)} bps round trip). No taxes, no market impact, fills assumed at the quoted open or close.`);
  add("info", "overlap", "Trades overlap in time and cluster in a few names and members, so the sample is smaller than the trade count suggests. The t-statistic treats trades as independent and overstates confidence.");
  add("info", "survivorship", "Survivorship: prices come from Yahoo Finance for symbols that still trade. Delisted, acquired, and renamed symbols have no history and are excluded and counted above, which tends to flatter results. Joined tickers only (data/tickers.json); no symbol is matched by guess.");
  add("info", "weights", "The portfolio rebalances to equal weight (or size weight) each day across open positions. Per-trade returns are buy-and-hold and do not include this rebalancing.");
  if (trades.length < MIN_TRADES) add("warn", "sample", `Only ${trades.length} trades. Treat the result as an anecdote, not evidence.`);
  for (const note of context.notes || []) add(note.level || "info", note.id || "note", note.text);
  return { items, lag, exclusions: { ...skipped }, excludedSymbols: Object.fromEntries(Object.entries(skippedSymbols).map(([k, v]) => [k, [...v].sort()])) };
}
