/**
 * world_markets: international indices for Ask ("tell me about the Taiwanese market today"). One Yahoo Finance chart
 * call per symbol through the shared Yahoo gate (server/feeds/yahoo.mjs); this module only composes. A symbol Yahoo
 * does not know is reported as not found, never filled in.
 */
import { yahooChart } from "../feeds/yahoo.mjs";
import { etStamp } from "../../shared/marketAsk.mjs";
import { REGIONS, indexName, localStamp, sessionOf, worldDisclaimer, worldSymbols } from "../../shared/worldMarkets.mjs";

const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const minutes = (ms) => Math.max(0, Math.round(ms / 60_000));

/** One quote from a Yahoo v8 chart body (range 5d, interval 1d). Null when Yahoo returned no price. Pure. */
export function quoteOf(symbol, body, now) {
  const result = body?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || meta.regularMarketPrice == null) return null;
  const closes = (result.indicators?.quote?.[0]?.close || []).map((c, i) => [result.timestamp?.[i], c]).filter(([t, c]) => t && c != null);
  const asOf = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : "";
  const lastDay = asOf.slice(0, 10);
  const before = closes.filter(([t]) => new Date(t * 1000).toISOString().slice(0, 10) < lastDay).at(-1);
  const prev = before ? before[1] : closes.length > 1 ? closes.at(-2)[1] : meta.chartPreviousClose ?? null;
  const last = meta.regularMarketPrice;
  const tz = meta.exchangeTimezoneName || "";
  const s = sessionOf({ asOf, tz, period: meta.currentTradingPeriod?.regular, now });
  return {
    symbol,
    name: indexName(symbol) || meta.longName || meta.shortName || symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    currency: meta.currency || "",
    last: r2(last),
    previousClose: r2(prev),
    change: prev ? r2(last - prev) : null,
    changePct: prev ? r2(((last - prev) / prev) * 100) : null,
    dayHigh: r2(meta.regularMarketDayHigh),
    dayLow: r2(meta.regularMarketDayLow),
    asOf,
    asOfLocal: localStamp(asOf, tz),
    asOfEt: etStamp(asOf),
    exchangeTimezone: tz,
    session: s.session,
    sessionNote: s.sessionNote,
    delayMin: asOf ? minutes(now - Date.parse(asOf)) : null
  };
}

/** The tool result from per-symbol outcomes `{ symbol, body?, error? }`. Pure, for tests. */
export function worldOf({ regions = [], outcomes = [], now = Date.now(), ms = 0 }) {
  const rows = [];
  const missing = [];
  for (const o of outcomes) {
    const q = o.body ? quoteOf(o.symbol, o.body, now) : null;
    if (q) rows.push(q);
    else missing.push({ symbol: o.symbol, why: o.error ? `Yahoo request failed: ${o.error}` : "Yahoo Finance returned no quote for this symbol (not found or not covered)." });
  }
  const covered = regions.map((id) => REGIONS[id]?.label).filter(Boolean);
  if (!rows.length) {
    return { ok: false, error: `No international quotes loaded from Yahoo Finance (${missing.map((m) => `${m.symbol}: ${m.why}`).join("; ") || "nothing asked"}).`, source: "Yahoo Finance chart (international indices)", asOf: "", latency: "", missing };
  }
  const asOf = rows.map((r) => r.asOf).filter(Boolean).sort().at(-1) || "";
  const open = rows.filter((r) => r.session === "open").map((r) => r.symbol);
  return {
    ok: true,
    source: "Yahoo Finance chart (international indices, delayed)",
    regions: covered,
    asOf,
    asOfEt: etStamp(asOf),
    latency: [
      `Yahoo index quotes are delayed (typically 15–20 min while an exchange trades; some exchanges more). Fetched at ${etStamp(new Date(now).toISOString())}.`,
      open.length ? `Open now: ${open.join(", ")}.` : "Every exchange asked about is closed now; figures are each one's last session.",
      ms ? `Fetched in ${ms} ms.` : ""
    ].filter(Boolean).join(" "),
    rows,
    ...(missing.length ? { missing } : {}),
    changeNote: "changePct is the change from the previous session's close, in percent, in the index's own points. asOfLocal is exchange time; asOfEt is US Eastern.",
    coverage: "Index levels only, from Yahoo Finance. No international filings, flows, or news in TradeSimple's own feeds; use web_search for news and context.",
    disclaimer: worldDisclaimer({ asOf })
  };
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} timed out`)), ms).unref?.())]);

/** `args`: `{ regions?: string[], symbols?: string[] }`. `chart` is injectable for tests. */
export async function runWorldMarkets(args = {}, { chart = yahooChart, now = () => Date.now(), timeoutMs = 15_000 } = {}) {
  const regions = (Array.isArray(args.regions) ? args.regions : [args.region]).map((r) => String(r || "").toLowerCase().replace(/[^a-z]/g, "")).filter((r) => r in REGIONS);
  const symbols = worldSymbols({ regions, symbols: Array.isArray(args.symbols) ? args.symbols : [] });
  if (!symbols.length) return { ok: false, error: `Name a region (${Object.keys(REGIONS).join(", ")}) or a Yahoo symbol such as ^TWII.`, source: "Yahoo Finance chart (international indices)", asOf: "", latency: "" };
  const started = now();
  const settled = await Promise.allSettled(symbols.map((s) => withTimeout(chart(s, { interval: "1d", range: "5d", includeAdjustedClose: "false" }, { timeoutMs }), timeoutMs + 2_000, `Yahoo ${s}`)));
  const outcomes = settled.map((r, i) => (r.status === "fulfilled" ? { symbol: symbols[i], body: r.value } : { symbol: symbols[i], error: r.reason?.message || "failed" }));
  return worldOf({ regions, outcomes, now: now(), ms: now() - started });
}
