import { tickerBySymbol, readCache, writeCache } from "./lib/db.mjs";
import { instrumentBySymbol, cryptoDigits } from "./instruments.mjs";
import { yahooChart } from "./feeds/yahoo.mjs";
import { once } from "./lib/once.mjs";
import {
  INTERVALS,
  DAY,
  retentionDays,
  mergeBars,
  calendarBucket,
  aggregateCalendar,
  mergeTrailingQuote,
} from "../shared/chartWorkspace.mjs";

export function parseWindow(body, { adjusted = false } = {}) {
  const r = body?.chart?.result?.[0];
  if (!r) throw new Error(body?.chart?.error?.description || "No chart from Yahoo");
  const q = r.indicators?.quote?.[0] || {},
    adj = r.indicators?.adjclose?.[0]?.adjclose || [];
  const bars = mergeBars(
    (r.timestamp || []).map((t, i) => {
      const c = q.close?.[i];
      const f = adjusted && Number.isFinite(adj[i]) && c ? adj[i] / c : 1;
      return {
        t: t * 1000,
        o: q.open?.[i] == null ? NaN : q.open[i] * f,
        h: q.high?.[i] == null ? NaN : q.high[i] * f,
        l: q.low?.[i] == null ? NaN : q.low[i] * f,
        c: c == null ? NaN : c * f,
        v: q.volume?.[i] ?? null,
      };
    }),
  );
  return { bars, meta: r.meta || {}, events: r.events || {} };
}
export async function chartWindow(db, symbol, opts) {
  const ticker = tickerBySymbol(db, symbol) || instrumentBySymbol(symbol);
  if (!ticker) return { ok: false, error: "Symbol is not in the registered equity, FX, or crypto universe." };
  const interval = opts.interval,
    from = Number(opts.from),
    to = Number(opts.to),
    now = Date.now();
  if (!INTERVALS.includes(interval) || interval === "4h")
    return { ok: false, error: "Unsupported native bar interval." };
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || from < 0 || to > now + DAY)
    return { ok: false, error: "Invalid historical window." };
  const oldest = Math.max(0, now - retentionDays(interval) * DAY),
    start = Math.max(oldest, from);
  if (start >= to)
    return { ok: false, error: "Unavailable history: outside provider intraday retention.", unavailable: true };
  const adjusted = opts.adjusted === "true" && ["1d", "1wk", "1mo"].includes(interval),
    extended = opts.extended === "true" && !["1d", "1wk", "1mo"].includes(interval);
  // Rounded windows deduplicate clients/polls without changing timestamps in returned bars.
  const aggregate = ["1wk", "1mo"].includes(interval);
  const bucketStart = aggregate ? calendarBucket(start, interval) : start;
  const p1 = Math.floor(Math.max(0, aggregate ? bucketStart - 2 * DAY : start) / 1000),
    p2 = Math.floor(to / 60000) * 60 + 60;
  const key = `chart-window:v2:${ticker.symbol}:${interval}:${p1}:${p2}:${adjusted}:${extended}`;
  const hit = readCache(db, key);
  if (hit) return { ...hit, cacheStatus: "Cached" };
  return once(key, async () => {
    try {
      const body = await yahooChart(ticker.symbol, {
        interval: aggregate ? "1d" : interval === "1h" ? "60m" : interval,
        period1: String(p1),
        period2: String(p2),
        includePrePost: String(extended),
        includeAdjustedClose: String(adjusted),
        events: "div,splits",
      });
      const parsed = parseWindow(body, { adjusted }),
        { meta, events } = parsed;
      const bars = aggregate
        ? aggregateCalendar(parsed.bars, interval, meta.exchangeTimezoneName || "UTC").filter((b) => b.t >= bucketStart)
        : mergeTrailingQuote(parsed.bars, interval);
      const payload = {
        ok: true,
        symbol: ticker.symbol,
        name: ticker.name,
        kind: ticker.kind || "equity",
        bars,
        interval,
        currency: meta.currency || "Unknown",
        exchange: meta.exchangeName || "",
        timezone: meta.exchangeTimezoneName || "UTC",
        digits:
          ticker.kind === "fx"
            ? ticker.digits
            : ticker.kind === "crypto"
              ? cryptoDigits(bars.at(-1)?.c || 1)
              : (meta.priceHint ?? 2),
        source: "Yahoo Finance chart",
        fetchedAt: new Date().toISOString(),
        asOf: parsed.bars.length ? new Date(parsed.bars.at(-1).t).toISOString() : null,
        cacheStatus: "Fetched",
        status: to < now - DAY ? "Historical" : "Delayed",
        adjustment: adjusted
          ? "Dividend/split adjusted OHLC using Yahoo adjusted-close ratio; volume remains provider-reported."
          : "Provider OHLC (Yahoo may split-adjust historical prices); no dividend adjustment applied.",
        extended,
        events,
        aggregation: aggregate
          ? "Daily bars aggregated by exchange-local calendar; axis dates identify period starts in UTC."
          : "Native provider bars; trailing point quotes merged into the forming bar.",
        oldestAvailable: oldest,
        unavailable: !bars.length,
        latency: "Delayed provider bars, not tick data or an execution feed. Missing sessions are not synthesized.",
      };
      writeCache(db, key, payload, to < now - DAY ? 3600000 : 60000);
      return payload;
    } catch (e) {
      return { ok: false, error: `Yahoo chart unavailable: ${e.message}` };
    }
  });
}
