import { readFileSync } from "node:fs";
import { fetchJson } from "./http.mjs";
import { readCache, tickerBySymbol, writeCache } from "./db.mjs";

const CHAIN = JSON.parse(readFileSync(new URL("../data/supplychain.json", import.meta.url), "utf8"));

const SUFFIX = {
  TW: { index: "^TWII", etf: "EWT", market: "Taiwan SE" },
  KS: { index: "^KS11", etf: "EWY", market: "Korea Exchange" },
  T: { index: "^N225", etf: "EWJ", market: "Tokyo SE" },
  HK: { index: "^HSI", etf: "EWH", market: "HKEX" },
  SZ: { index: "000300.SS", etf: "ASHR", market: "Shenzhen SE" },
  SS: { index: "000300.SS", etf: "ASHR", market: "Shanghai SE" },
  PA: { index: "^FCHI", etf: "EWQ", market: "Euronext Paris" },
  L: { index: "^FTSE", etf: "EWU", market: "London SE" },
  DE: { index: "^GDAXI", etf: "EWG", market: "Xetra" },
  AS: { index: "^AEX", etf: "EWN", market: "Euronext Amsterdam" }
};
const ADR_HOME = { TSM: "^TWII", ASML: "^AEX", BHP: "^AXJO", RIO: "^FTSE", SONY: "^N225" };
const SECTOR_ETF = {
  "Information Technology": "XLK",
  "Communication Services": "XLC",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Industrials: "XLI",
  Energy: "XLE",
  "Health Care": "XLV",
  Financials: "XLF",
  Materials: "XLB",
  Utilities: "XLU",
  "Real Estate": "XLRE"
};

export function chainSymbols() {
  return Object.keys(CHAIN).filter((k) => !k.startsWith("_"));
}

function linksFor(db, symbol) {
  const suffix = symbol.includes(".") ? symbol.split(".").pop() : "";
  if (SUFFIX[suffix]) return { market: SUFFIX[suffix].market, index: SUFFIX[suffix].index, etf: SUFFIX[suffix].etf, joined: false };
  const t = tickerBySymbol(db, symbol);
  const industry = t?.industry || "";
  const etf = /Semiconductor/i.test(industry) ? "SMH" : /Aerospace|Defense/i.test(industry) ? "ITA" : SECTOR_ETF[t?.sector] || "";
  const index = ADR_HOME[symbol] || (t?.index?.includes("SP500") ? "^GSPC" : "^IXIC");
  return { market: ADR_HOME[symbol] ? "US ADR" : "US", index, etf, joined: Boolean(t), sp500: Boolean(t?.index?.includes("SP500")) };
}

async function closes(symbol) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "6mo");
  const body = await fetchJson(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }, 12000);
  const r = body?.chart?.result?.[0];
  if (!r) return null;
  const c = r.indicators?.adjclose?.[0]?.adjclose || r.indicators?.quote?.[0]?.close || [];
  const series = new Map();
  (r.timestamp || []).forEach((t, i) => {
    if (c[i] != null) series.set(new Date(t * 1000).toISOString().slice(0, 10), c[i]);
  });
  return { series, currency: r.meta?.currency || "", last: r.meta?.regularMarketPrice ?? null, name: r.meta?.longName || r.meta?.shortName || "" };
}

function stats(a, b) {
  const days = [...a.series.keys()].filter((d) => b.series.has(d)).sort();
  const ra = [];
  const rb = [];
  for (let i = 1; i < days.length; i += 1) {
    ra.push(a.series.get(days[i]) / a.series.get(days[i - 1]) - 1);
    rb.push(b.series.get(days[i]) / b.series.get(days[i - 1]) - 1);
  }
  if (ra.length < 20) return { corr: null, beta: null, days: ra.length };
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < ra.length; i += 1) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  return { corr: va && vb ? cov / Math.sqrt(va * vb) : null, beta: va ? cov / va : null, days: ra.length };
}

function rebased(s) {
  const days = [...s.series.keys()].sort();
  const base = s.series.get(days[0]);
  return days.map((d) => [d, Number(((s.series.get(d) / base - 1) * 100).toFixed(2))]);
}

export async function supplyChain(db, raw) {
  const symbol = String(raw || "").toUpperCase();
  const entry = CHAIN[symbol];
  if (!entry) return { ok: false, symbol, available: chainSymbols(), error: `No curated supply chain for ${symbol} yet.` };
  const key = `supply:v1:${symbol}`;
  const hit = readCache(db, key);
  if (hit) return hit;
  const started = Date.now();
  const focusLinks = linksFor(db, symbol);
  const nodes = [
    ...entry.suppliers.map((n) => ({ ...n, role: "supplier" })),
    ...entry.customers.map((n) => ({ ...n, role: n.what?.includes("subsidiary") ? "subsidiary" : "customer" }))
  ].map((n) => ({ ...n, ...linksFor(db, n.symbol) }));
  const indexSet = [...new Set([focusLinks.index, focusLinks.etf, ...nodes.flatMap((n) => [n.index, n.etf])].filter(Boolean))];
  const want = [...new Set([symbol, ...nodes.map((n) => n.symbol), ...indexSet])];
  const got = new Map();
  const queue = [...want];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const c = await closes(s).catch(() => null);
      if (c) got.set(s, c);
    }
  }));
  const focal = got.get(symbol);
  const withStats = (s) => {
    const c = got.get(s);
    if (!c || !focal) return { corr: null, beta: null, ret: null };
    const st = s === symbol ? { corr: 1, beta: 1 } : stats(focal, c);
    const r = rebased(c);
    return { ...st, ret: r.at(-1)?.[1] ?? null, currency: c.currency, last: c.last };
  };
  const out = {
    ok: true,
    symbol,
    name: tickerBySymbol(db, symbol)?.name || focal?.name || symbol,
    source: "Curated edges from 10-K/20-F filings, supplier lists, and company announcements (data/supplychain.json) · prices Yahoo Finance daily",
    asOf: new Date().toISOString(),
    latency: `Edges are curated and change only when filings change. Correlation and beta use 6 months of daily adjusted closes on overlapping trading days (different holidays and time zones reduce overlap; Asian closes lead the U.S. session by ~13 h, which understates same-day correlation). Fetched ${got.size}/${want.length} series in ${Date.now() - started} ms.`,
    focus: { ...focusLinks, ...withStats(symbol) },
    segments: entry.segments,
    nodes: nodes.map((n) => ({ ...n, ...withStats(n.symbol), priced: got.has(n.symbol) })),
    indices: indexSet.map((s) => ({ symbol: s, ...withStats(s) })),
    series: Object.fromEntries([...got.entries()].map(([s, c]) => [s, rebased(c)]))
  };
  writeCache(db, key, out, 30 * 60 * 1000);
  return out;
}
