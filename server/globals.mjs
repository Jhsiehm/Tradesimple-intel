import { readFileSync } from "node:fs";
import { fetchJson } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";

const GLOBALS = JSON.parse(readFileSync(new URL("../data/globals.json", import.meta.url), "utf8"));
const TTL = 2 * 60 * 1000;

export function globalInstrument(symbol) {
  const s = String(symbol || "").toUpperCase();
  const index = GLOBALS.indices.find((row) => row.symbol.toUpperCase() === s);
  if (index) return { ...index, kind: "index", digits: 2 };
  const etf = GLOBALS.etfs.find((row) => row.symbol === s);
  if (etf) return { ...etf, kind: "etf", digits: 2 };
  const adr = GLOBALS.adrs.find((row) => row.adr === s || row.local.toUpperCase() === s);
  if (adr) return { symbol: s, name: adr.local.toUpperCase() === s ? `${adr.name} (${adr.venue})` : `${adr.name} ADR`, kind: "equity", digits: 2 };
  return null;
}

export async function metaQuote(symbol) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "5d");
  const body = await fetchJson(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }, 12000);
  const result = body?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  const closes = (result.indicators?.quote?.[0]?.close || []).filter((c) => c != null);
  const last = meta.regularMarketPrice ?? closes.at(-1);
  if (last == null) return null;
  const stamps = result.timestamp || [];
  const lastDay = stamps.length ? new Date(stamps.at(-1) * 1000).toISOString().slice(0, 10) : "";
  const marketDay = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10) : "";
  const prev = closes.length > 1 && lastDay === marketDay ? closes.at(-2) : closes.at(-1) ?? meta.chartPreviousClose;
  const period = meta.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  return {
    symbol,
    last,
    previousClose: prev ?? null,
    change: prev ? last - prev : null,
    changePct: prev ? ((last - prev) / prev) * 100 : null,
    currency: meta.currency || "",
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    tz: meta.exchangeTimezoneName || "",
    open: period ? now >= period.start && now < period.end : null,
    session: period ? { start: period.start * 1000, end: period.end * 1000 } : null,
    spark: closes,
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
  };
}

async function quoteMany(symbols) {
  const queue = [...new Set(symbols)];
  const out = new Map();
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      const q = await metaQuote(s).catch(() => null);
      if (q) out.set(s, q);
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  return out;
}

export async function globalBoard(db) {
  const hit = readCache(db, "globals:v1");
  if (hit) return hit;
  const started = Date.now();
  const ccys = ["TWD", "HKD", "JPY", "EUR", "DKK", "GBP", "INR", "AUD"];
  const quotes = await quoteMany([
    ...GLOBALS.indices.map((r) => r.symbol),
    ...GLOBALS.etfs.map((r) => r.symbol),
    ...GLOBALS.adrs.flatMap((r) => [r.adr, r.local]),
    ...ccys.map((c) => `${c}=X`)
  ]);
  const fx = Object.fromEntries(ccys.map((c) => [c, quotes.get(`${c}=X`)?.last ?? null]));
  fx.USD = 1;
  const indices = GLOBALS.indices.map((row) => ({ ...row, ...(quotes.get(row.symbol) || {}), ok: quotes.has(row.symbol) }));
  const etfs = GLOBALS.etfs.map((row) => ({ ...row, ...(quotes.get(row.symbol) || {}), ok: quotes.has(row.symbol) }));
  const adrs = GLOBALS.adrs.map((row) => {
    const a = quotes.get(row.adr);
    const l = quotes.get(row.local);
    if (!a || !l) return { ...row, ok: false };
    const pence = l.currency === "GBp" || l.currency === "GBX";
    const ccy = pence ? "GBP" : l.currency;
    const localPrice = pence ? l.last / 100 : l.last;
    const rate = fx[ccy];
    const implied = rate ? (localPrice / rate) * row.ratio : null;
    const premium = implied ? (a.last / implied - 1) * 100 : null;
    const gapHours = a.asOf && l.asOf ? Math.abs(Date.parse(a.asOf) - Date.parse(l.asOf)) / 3600000 : null;
    return {
      ...row,
      ok: true,
      adrLast: a.last,
      adrChangePct: a.changePct,
      adrOpen: a.open,
      adrAsOf: a.asOf,
      localLast: l.last,
      localCurrency: l.currency,
      localChangePct: l.changePct,
      localOpen: l.open,
      localAsOf: l.asOf,
      fx: rate,
      fxPair: `USD/${ccy}`,
      implied,
      premium,
      gapHours
    };
  });
  const payload = {
    ok: indices.some((r) => r.ok),
    source: "Yahoo Finance chart (indices, ETFs, ADRs, local lines, USD FX legs)",
    asOf: new Date().toISOString(),
    latency: `Index levels are exchange-delayed (≈15–20 min, some exchanges end-of-day). FX legs are indicative. Board refreshes every 2 min · fetched ${quotes.size} quotes in ${Date.now() - started} ms.`,
    arbNote: "Not an arbitrage feed. Real cross-listing arbitrage lives in sub-millisecond moves on direct exchange feeds with co-located execution. These are delayed snapshots, and most local markets are closed while the ADR trades, so premiums compare a live ADR against a stale local close. Treat them as a map of where dislocations tend to appear. A licensed low-latency feed (e.g. direct TWSE/HKEX/LSE + consolidated US tape) would be the path to expand this.",
    ratioNote: "Premium = ADR ÷ (local price ÷ USD/CCY × ADR ratio) − 1. Ratios are the depositary ratios as listed by the depositary banks; confirm against the depositary before relying on them.",
    fx,
    indices,
    etfs,
    adrs
  };
  if (payload.ok) writeCache(db, "globals:v1", payload, TTL);
  return payload;
}
