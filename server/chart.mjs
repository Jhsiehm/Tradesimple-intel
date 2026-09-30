import { fetchJson } from "./http.mjs";
import { listTickers, readCache, writeCache, tickerBySymbol } from "./db.mjs";
import { cryptoDigits, instrumentBySymbol } from "./instruments.mjs";

const SPANS = {
  "1m": { interval: "1m", range: "1d", note: "One-minute bars for the latest session." },
  "5m": { interval: "5m", range: "5d", note: "Five-minute bars across five sessions." },
  "15m": { interval: "15m", range: "5d", note: "Fifteen-minute bars across five sessions." },
  "1h": { interval: "60m", range: "1mo", note: "Hourly bars for one month." },
  "1d": { interval: "1d", range: "1mo", note: "Daily bars for one month, split-adjusted." },
  "1mo": { interval: "1d", range: "1mo", note: "Daily bars for one month, split-adjusted." },
  "6mo": { interval: "1d", range: "6mo", note: "Daily bars for six months, split-adjusted." },
  "1y": { interval: "1d", range: "1y", note: "Daily bars for one year, split-adjusted." },
  "5y": { interval: "1d", range: "5y", note: "Daily bars for five years, split-adjusted." }
};
const TTL = 15 * 60 * 1000;

export async function priceChart(db, symbol, spanId) {
  const ticker = tickerBySymbol(db, symbol) || instrumentBySymbol(symbol);
  if (!ticker) return { ok: false, error: "Symbol is not in the join table or the FX / crypto registry" };
  const kind = ticker.kind || "equity";
  const span = SPANS[spanId] ? spanId : "6mo";
  const spec = SPANS[span];
  const cacheKey = `chart:v3:${ticker.symbol}:${span}`;
  const hit = readCache(db, cacheKey);
  if (hit) return hit;

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.symbol)}`);
  url.searchParams.set("interval", spec.interval);
  url.searchParams.set("range", spec.range);
  url.searchParams.set("includeAdjustedClose", spec.interval === "1d" ? "true" : "false");
  url.searchParams.set("events", "div,splits");
  const body = await fetchJson(url, yahooHeaders());
  const result = body?.chart?.result?.[0];
  const error = body?.chart?.error?.description;
  if (!result) return { ok: false, error: error || "No chart from Yahoo Finance" };

  const stamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = spec.interval === "1d" ? result.indicators?.adjclose?.[0]?.adjclose || [] : [];
  const bars = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (open == null || high == null || low == null || close == null) continue;
    const adj = adjusted[i];
    const factor = adj != null && close ? adj / close : 1;
    bars.push({
      t: stamps[i] * 1000,
      o: round(open * factor),
      h: round(high * factor),
      l: round(low * factor),
      c: round(close * factor),
      v: quote.volume?.[i] || 0
    });
  }
  if (!bars.length) return { ok: false, error: "Chart returned no bars" };

  const meta = result.meta || {};
  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  const digits = kind === "fx" ? ticker.digits : kind === "crypto" ? cryptoDigits(lastBar.c) : 2;
  const payload = {
    ok: true,
    source: "Yahoo Finance chart",
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date(lastBar.t).toISOString(),
    latency: `${spec.note} Delayed, not a live book.${kind !== "fx" && kind !== "crypto" ? "" : " Trades around the clock; volume is exchange-reported where Yahoo has it."}`,
    symbol: ticker.symbol,
    code: ticker.code || ticker.symbol,
    kind,
    digits,
    name: ticker.name,
    range: span,
    interval: spec.interval,
    currency: meta.currency || "USD",
    exchange: meta.exchangeName || "",
    last: round(meta.regularMarketPrice ?? lastBar.c),
    previousClose: round(meta.chartPreviousClose ?? meta.previousClose ?? prevBar?.c ?? lastBar.o),
    dayHigh: round(meta.regularMarketDayHigh),
    dayLow: round(meta.regularMarketDayLow),
    dayVolume: meta.regularMarketVolume || null,
    yearHigh: round(meta.fiftyTwoWeekHigh),
    yearLow: round(meta.fiftyTwoWeekLow),
    bars
  };
  writeCache(db, cacheKey, payload, TTL);
  return payload;
}

export async function quoteBoard(db) {
  const tickers = listTickers(db);
  const hit = readCache(db, "board:screener:v1");
  if (hit) return hit;
  const started = Date.now();
  const body = await fetchJson("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true", {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
  }, 30000);
  const bySymbol = new Map((body?.data?.rows || []).map((r) => [String(r.symbol).trim().replace(/[/.^]/g, "-"), r]));
  const num = (v) => {
    const n = Number(String(v ?? "").replace(/[$,%]/g, ""));
    return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
  };
  const items = [];
  for (const t of tickers) {
    const r = bySymbol.get(t.symbol);
    if (!r) continue;
    const last = num(r.lastsale);
    const change = num(r.netchange);
    items.push({
      symbol: t.symbol,
      name: t.name,
      sector: t.sector || r.sector || "",
      industry: t.industry || r.industry || "",
      core: t.core,
      index: t.index,
      last,
      change,
      changePct: num(r.pctchange),
      previousClose: last != null && change != null ? Number((last - change).toFixed(4)) : null,
      volume: num(r.volume) || 0,
      marketCap: num(r.marketCap) || 0
    });
  }
  const asOf = new Date().toISOString();
  const payload = {
    ok: items.length > 0,
    source: "Nasdaq stock screener (all US listings, one call)",
    asOf,
    latency: `Exchange-delayed last sale (about 15 min in session) · refreshed every 60s · fetched in ${Date.now() - started} ms · ${items.length} of ${tickers.length} join-table names matched`,
    missing: tickers.filter((t) => !bySymbol.has(t.symbol)).map((t) => t.symbol),
    items: items.map((item) => ({ ...item, asOf }))
  };
  if (items.length) writeCache(db, "board:screener:v1", payload, 60 * 1000);
  return payload;
}

export async function sessionQuote(ticker, digitsFor = () => 2) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.symbol)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "5d");
  url.searchParams.set("includeAdjustedClose", "false");
  const body = await fetchJson(url, yahooHeaders());
  const result = body?.chart?.result?.[0];
  if (!result) return null;
  const stamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const close = quote.close?.[i];
    if (close == null) continue;
    bars.push({
      t: stamps[i] * 1000,
      o: quote.open?.[i],
      h: quote.high?.[i],
      l: quote.low?.[i],
      c: close,
      v: quote.volume?.[i] || 0
    });
  }
  const lastBar = bars.at(-1);
  if (!lastBar) return null;
  const prev = bars.length > 1 ? bars[bars.length - 2].c : null;
  const meta = result.meta || {};
  const last = meta.regularMarketPrice ?? lastBar.c;
  const change = prev == null ? null : last - prev;
  const digits = digitsFor(last);
  const r = (value) => fixed(value, digits);
  return {
    symbol: ticker.symbol,
    name: ticker.name,
    exchange: meta.exchangeName || "",
    digits,
    last: r(last),
    change: r(change),
    changePct: prev ? round((change / prev) * 100) : null,
    open: r(lastBar.o),
    high: r(meta.regularMarketDayHigh ?? lastBar.h),
    low: r(meta.regularMarketDayLow ?? lastBar.l),
    previousClose: r(prev),
    yearHigh: r(meta.fiftyTwoWeekHigh),
    yearLow: r(meta.fiftyTwoWeekLow),
    spark: bars.map((bar) => bar.c),
    volume: meta.regularMarketVolume || lastBar.v || 0,
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date(lastBar.t).toISOString()
  };
}

function yahooHeaders() {
  return {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json"
    }
  };
}

function round(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toPrecision(8));
}

function fixed(value, digits) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}
