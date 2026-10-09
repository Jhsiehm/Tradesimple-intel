/**
 * The Replicate export, pure: GET /api/backtest/replicate's body in, files out (spec.json, trades.csv, prices.csv,
 * benchmark.csv, METHODS.md), plus a stored (uncompressed) zip writer. The scripts themselves are static text in
 * shared/replicate/ and read these files; nothing run-specific is baked into them.
 */
import { isoOf } from "./backtest.mjs";
import { backtestFormulas } from "./formulas.mjs";

export const EXPECTED_KEYS = ["trades", "total", "annualized", "benchmarkTotal", "excessTotal", "hitRate", "avgTrade", "medianTrade", "maxDrawdown", "sharpeish", "spanDays"];

const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (head, rows) => [head.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";

export function expectedOf(stats) {
  return Object.fromEntries(EXPECTED_KEYS.map((k) => [k, stats?.[k] ?? null]));
}

const barsCsv = (series, source, asOf) => toCsv(
  ["symbol", "date", "open_adj", "close_adj", "source", "as_of"],
  series.flatMap(({ symbol, bars }) => bars.map(([d, o, c]) => [symbol, isoOf(d), o == null ? "" : o, c, source, asOf]))
);

/** `rep` is the replicate endpoint's body. Returns `{ name, mime, text }[]`, scripts excluded. */
export function replicateFiles(rep) {
  const trades = rep.trades || [];
  const spec = {
    spec: rep.spec,
    description: rep.description,
    expected: expectedOf(rep.stats),
    counts: rep.counts,
    window: rep.window || null,
    sources: (rep.feeds || []).map((f) => ({ label: f.label, source: f.source, asOf: f.asOf, latency: f.latency })),
    ranAt: rep.ranAt,
    missingPrices: rep.missing || []
  };
  const tradesCsv = toCsv(
    ["id", "symbol", "side", "actor", "public_date", "trade_date", "entry", "exit", "entry_price", "exit_price", "ret", "bench", "excess", "days", "why", "open", "benchmark", "weight"],
    trades.map((t) => [t.id, t.symbol, t.side, t.actorLabel || t.actor, t.signal, t.traded, t.entry, t.exit, t.entryPrice, t.exitPrice, t.ret, t.bench, t.excess, t.days, t.why, t.open, t.benchmark, t.weight ?? 1])
  );
  return [
    { name: "spec.json", mime: "application/json", text: `${JSON.stringify(spec, null, 2)}\n` },
    { name: "trades.csv", mime: "text/csv", text: tradesCsv },
    { name: "prices.csv", mime: "text/csv", text: barsCsv(rep.prices || [], rep.priceSource, rep.priceAsOf) },
    { name: "benchmark.csv", mime: "text/csv", text: barsCsv(rep.benchmarks || [], rep.priceSource, rep.priceAsOf) },
    { name: "METHODS.md", mime: "text/markdown", text: methodsMd(rep) }
  ];
}

export function methodsMd(rep) {
  const s = rep.stats || {};
  const f = backtestFormulas({ stats: s, rules: rep.spec?.rules, trades: rep.trades });
  const lines = [
    "# Backtest replication",
    "",
    `**Spec:** ${rep.description || ""}`,
    "",
    `Run at ${rep.ranAt || "?"} by TradeSimple Intel. Research only; not investment advice and not an order.`,
    "",
    "## Files",
    "- `spec.json` — the cleaned spec, the app's headline numbers (`expected`), and every feed's source, as-of, and latency.",
    "- `trades.csv` — each trade the run used: public date (filing/posting), entry, exit, prices, return, benchmark leg, weight.",
    "- `prices.csv` / `benchmark.csv` — daily bars the engine read (adjusted open and close), with source and as-of.",
    "- `replicate.mjs` (Node 18+, no packages) and `replicate.py` (Python 3, pandas optional) recompute the headline numbers from the CSVs and exit 1 on any mismatch over 0.0001.",
    "",
    "## Run",
    "```",
    "node replicate.mjs",
    "python3 replicate.py",
    "```",
    "",
    "## Formulas",
    ...f.flatMap((x) => [`### ${x.title}`, "", `$$${x.tex}$$`, "", x.worked ? `This run: $${x.worked}$` : "", x.note ? `\n${x.note}` : "", ""]),
    "## Sources",
    ...(rep.feeds || []).map((x) => `- **${x.label}:** ${x.source} — as of ${x.asOf || "?"}. ${x.latency || ""}`),
    "",
    "## Caveats",
    "- Entry is the first trading day strictly after the public date (within 7 days); the trade date is never used for entry.",
    "- Disclosed amounts are ranges; range-midpoint sizing is an estimate.",
    "- Prices come from Yahoo Finance for symbols that still trade; delisted or renamed symbols are excluded (survivorship).",
    "- Trades overlap and cluster; the sample is smaller than the trade count suggests.",
    ...(rep.missing?.length ? [`- No cached bars were available for: ${rep.missing.join(", ")}; those trades cannot be re-run from these files.`] : []),
    ""
  ];
  return lines.join("\n");
}

/* ---------- zip (stored, no compression) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** `files`: `{ name, text }[]` → zip bytes. `stamp` is a Date for the entries' modified time. */
export function zipFiles(files, stamp = new Date(Date.UTC(2026, 0, 1))) {
  const enc = new TextEncoder();
  const time = (stamp.getUTCHours() << 11) | (stamp.getUTCMinutes() << 5) | (stamp.getUTCSeconds() >> 1);
  const date = ((stamp.getUTCFullYear() - 1980) << 9) | ((stamp.getUTCMonth() + 1) << 5) | stamp.getUTCDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.text === "string" ? enc.encode(f.text) : f.text;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
