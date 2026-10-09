import { dayOf, isoOf } from "../../../shared/backtest.mjs";
import { readCache } from "../../lib/db.mjs";
import { readStale } from "../../lib/cache.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { runSpec } from "./index.mjs";

const PAD_DAYS = 10;

const barsOf = (db, symbol) => readCache(db, KEY.bars(symbol)) || readStale(db, KEY.bars(symbol))?.value || null;

/**
 * Everything needed to re-run one backtest outside this app: the spec, the trades it used, and the daily bars
 * (each symbol and benchmark, from ten days before the first public date to the last exit) that the engine read.
 * The run itself comes from the 30-minute result cache when it is warm.
 */
export async function replicateSpec(db, raw, { run = runSpec } = {}) {
  const out = await run(db, raw);
  if (!out.ok) return out;
  const trades = out.trades || [];
  const priceFeed = (out.feeds || []).find((f) => f.label === "Prices") || {};
  const calendarId = out.spec.rules.benchmark === "SECTOR" ? "SPY" : out.spec.rules.benchmark;
  const result = {
    ok: true,
    spec: out.spec,
    description: out.description,
    stats: out.stats,
    reality: out.reality || null,
    counts: out.counts,
    trades,
    calendarId,
    prices: [],
    benchmarks: [],
    feeds: out.feeds,
    source: out.source,
    asOf: out.asOf,
    latency: out.latency,
    ranAt: out.ranAt,
    priceSource: priceFeed.source || "Yahoo Finance v8 chart, daily bars adjusted for splits and dividends",
    priceAsOf: priceFeed.asOf || out.asOf,
    missing: []
  };
  if (!trades.length) return result;
  const first = Math.min(...trades.map((t) => dayOf(t.signal))) - PAD_DAYS;
  const last = Math.max(...trades.map((t) => dayOf(t.exit)));
  const cut = (bars) => bars.filter((b) => b[0] >= first && b[0] <= last);
  const symbols = [...new Set(trades.map((t) => t.symbol))].sort();
  const benches = [...new Set([...trades.map((t) => t.benchmark), calendarId])].sort();
  for (const [list, ids] of [[result.prices, symbols], [result.benchmarks, benches]]) {
    for (const symbol of ids) {
      const bars = barsOf(db, symbol);
      if (bars?.length) list.push({ symbol, bars: cut(bars) });
      else result.missing.push(symbol);
    }
  }
  result.window = { from: isoOf(first), to: isoOf(last) };
  return result;
}
