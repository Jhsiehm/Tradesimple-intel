import { fetchJson, fetchText, makeGate } from "../lib/http.mjs";
import { gateSpacing } from "../lib/env.mjs";
import { BROWSER_UA } from "../lib/ua.mjs";
import { parseBars } from "../parsers/bars.mjs";

/** Every Yahoo chart call goes through one gate so boards, dossiers, and the returns warm cannot burst together. */
export const yahooGate = makeGate(8, gateSpacing(60));

export function yahooHeaders() {
  return {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json"
    }
  };
}

/** Raw Yahoo v8 chart body for `symbol` with the given query params. */
export function yahooChart(symbol, params, { timeoutMs = 20000, priority = false } = {}) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return yahooGate(() => fetchJson(url, yahooHeaders(), timeoutMs), { priority });
}

/** Three years of adjusted daily [day, open, close] bars for a symbol or index (^GSPC). Throws on HTTP errors; `status` is kept. */
export async function yahooBars(symbol, { range = "3y", timeoutMs = 20000, priority = false } = {}) {
  const body = await yahooChart(symbol, { interval: "1d", range, includeAdjustedClose: "true", events: "div,splits" }, { timeoutMs, priority });
  return parseBars(body);
}

const rssGate = makeGate(2, gateSpacing(250));

/** Yahoo Finance headline RSS for one symbol, as raw XML (newest ~20 items, publisher time stamps). */
export function yahooHeadlines(symbol, { timeoutMs = 10000 } = {}) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  return rssGate(() => fetchText(url, { headers: { "User-Agent": BROWSER_UA, Accept: "application/rss+xml, application/xml" } }, timeoutMs));
}

export async function sessionQuote(ticker, digitsFor = () => 2) {
  const body = await yahooChart(ticker.symbol, { interval: "1d", range: "5d", includeAdjustedClose: "false" });
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

export function round(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toPrecision(8));
}

function fixed(value, digits) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}
