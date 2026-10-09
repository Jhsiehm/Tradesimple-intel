/**
 * market_snapshot: US benchmarks for "how are the markets today". Reads the Globals board (Yahoo Finance chart, the
 * symbols in data/globals.json) and the macro strip (FRED Treasury yields) in process, so Ask quotes what the app shows.
 */
import { KEY } from "../lib/cacheKeys.mjs";
import { etStamp, marketDisclaimer } from "../../shared/marketAsk.mjs";

const INDICES = ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX"];
const ETFS = ["SPY", "QQQ", "IWM", "XLK", "XLF", "XLE", "SMH", "ITA", "TLT", "GLD"];
const YIELDS = [["10y", "DGS10", "US 10-year Treasury yield"], ["2y", "DGS2", "US 2-year Treasury yield"]];

const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const minutes = (ms) => Math.max(0, Math.round(ms / 60_000));

const quoteRow = (row, kind) => ({
  symbol: row.symbol,
  name: row.name,
  kind,
  last: r2(row.last),
  changePct: r2(row.changePct),
  previousClose: r2(row.previousClose),
  asOf: row.asOf || ""
});

/**
 * The tool result from the two boards. `stale` is set when the live Globals call failed and `globals` is the last
 * cached board, with `error` saying what failed. Pure, for tests.
 */
export function snapshotOf({ globals, macro = null, stale = null, error = "", now = Date.now(), ms = 0 }) {
  const pick = (list, symbols, kind) => symbols.map((s) => list?.find((r) => r.symbol === s && r.ok !== false && r.last != null)).filter(Boolean).map((r) => quoteRow(r, kind));
  const quotes = [...pick(globals?.indices, INDICES, "index"), ...pick(globals?.etfs, ETFS, "etf")];
  const items = Array.isArray(macro?.items) ? macro.items : [];
  const yields = YIELDS.map(([id, symbol, name]) => {
    const it = items.find((x) => x.id === id);
    const v = Number.parseFloat(String(it?.value || ""));
    return Number.isFinite(v) ? { symbol, name, kind: "yield", last: v, unit: "%", changePct: null, previousClose: null, asOf: it.asOf || "" } : null;
  }).filter(Boolean);
  if (!quotes.length) {
    return { ok: false, error: error || "The Yahoo Finance Globals board returned no US benchmarks.", source: "Yahoo Finance chart (via the Globals board)", asOf: "", latency: "" };
  }
  const spx = globals.indices.find((r) => r.symbol === "^GSPC");
  const asOf = (spx?.asOf || quotes.map((q) => q.asOf).filter(Boolean).sort().at(-1) || globals.asOf || "");
  const age = asOf ? minutes(now - Date.parse(asOf)) : null;
  const session = spx?.open === true ? "open" : spx?.open === false ? "closed" : "unknown";
  const ten = yields.find((y) => y.symbol === "DGS10");
  const staleAt = stale ? etStamp(stale.storedAt) : "";
  return {
    ok: true,
    stale: Boolean(stale),
    ...(stale ? { note: `Live Yahoo fetch failed (${error || "no data"}); these are the last cached quotes, stored ${staleAt}.` } : {}),
    source: `Yahoo Finance chart (indices and ETFs, via the Globals board)${yields.length ? " · FRED DGS10/DGS2 (via the macro strip)" : ""}`,
    asOf,
    asOfEt: etStamp(asOf),
    session,
    latency: [
      `Yahoo index and ETF quotes are not a live feed and can trail the exchange by up to about 15–20 min; Yahoo stamped the S&P 500 print ${age ?? "?"} min before this fetch at ${etStamp(new Date(now).toISOString())}; US session ${session}.`,
      ten ? `FRED Treasury yields are daily closes published with a one-day lag (latest ${ten.asOf}).` : "Treasury yields did not load from FRED.",
      ms ? `Fetched in ${ms} ms.` : ""
    ].filter(Boolean).join(" "),
    rows: [...quotes, ...yields],
    changeNote: "changePct is the change from the previous close, in percent. VIX is a volatility index (points), not a price.",
    disclaimer: marketDisclaimer({ asOf, yieldAsOf: ten?.asOf || "", stale: Boolean(stale) })
  };
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} timed out`)), ms).unref?.())]);

/** The last stored Globals board, whatever its age; null when there is none or `db` is not SQLite. */
function lastCachedGlobals(db) {
  try {
    const row = db?.prepare?.("SELECT body, stored_at FROM cache WHERE key = ?").get(KEY.globals);
    return row ? { body: JSON.parse(row.body), storedAt: new Date(row.stored_at).toISOString() } : null;
  } catch {
    return null;
  }
}

/** `call(db, routeId)` is the tool runner's in-process (traced) route call. */
export async function runMarketSnapshot(db, call, { now = () => Date.now(), timeoutMs = 25_000 } = {}) {
  const started = now();
  const [g, m] = await Promise.allSettled([withTimeout(call(db, "markets.globals"), timeoutMs, "Yahoo Globals board"), withTimeout(call(db, "macro.strip"), 10_000, "FRED macro strip")]);
  const globals = g.status === "fulfilled" ? g.value : null;
  const macro = m.status === "fulfilled" && m.value?.ok !== false ? m.value : null;
  if (globals?.ok) return snapshotOf({ globals, macro, now: now(), ms: now() - started });
  const error = g.status === "rejected" ? g.reason?.message || "failed" : globals?.error || "the board returned no quotes";
  const cached = lastCachedGlobals(db);
  if (cached?.body?.indices) return snapshotOf({ globals: cached.body, macro, stale: cached, error, now: now(), ms: now() - started });
  return snapshotOf({ globals: null, macro, error: `Yahoo Globals board failed: ${error}. No cached board to fall back on.` });
}
