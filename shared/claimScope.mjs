/**
 * Time windows and benchmark comparisons, pure. An answer that says "last 30 days" or "vs SPY" must cite a tool
 * result that covers that window or holds benchmark figures; a leaderboard over every disclosure since 2025 with no
 * priced buys supports neither. Only claims we can parse, against tools that state their scope, are judged.
 */
import { citationUnits } from "./citations.mjs";

const REFS = /\[t\d+(?:\s*,\s*t\d+)*\]/g;
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, thirty: 30, sixty: 60, ninety: 90 };
const UNIT_DAYS = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };
const NUM = `\\d{1,3}|${Object.keys(WORDS).join("|")}`;
const NEGATED = /\b(?:not|no|cannot|can't|isn't|aren't|doesn't|don't|didn't|without|rather than|instead of|unable|lacks?)\b[^.|]{0,40}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const negated = (s, at) => NEGATED.test(s.slice(Math.max(0, at - 48), at));
const numOf = (w) => (w == null || w === "" ? 1 : /^\d+$/.test(w) ? Number(w) : WORDS[w.toLowerCase()] || 0);

/** "last 30 days", "past two weeks", "this month", "30-day window" → `{ raw, days, at }`. Hold periods are not windows. */
export function windowClaims(text) {
  const s = String(text || "").replace(REFS, " ");
  const out = [];
  const push = (m, days) => {
    if (!days || negated(s, m.index) || out.some((c) => c.raw.toLowerCase() === m[0].toLowerCase())) return;
    out.push({ raw: m[0].replace(/\s+/g, " ").trim(), days, at: m.index });
  };
  for (const m of s.matchAll(new RegExp(`\\b(?:last|past|previous|prior|trailing)\\s+(?:(${NUM})\\s+)?(day|week|month|quarter|year)s?\\b`, "gi"))) {
    if (!m[1] && /^day$/i.test(m[2])) continue;
    push(m, numOf(m[1]) * UNIT_DAYS[m[2].toLowerCase()]);
  }
  for (const m of s.matchAll(/\bthis\s+(week|month)\b/gi)) push(m, UNIT_DAYS[m[1].toLowerCase()]);
  for (const m of s.matchAll(/\b(\d{1,3})[- ]day\s+(?:window|period|lookback|span)\b/gi)) push(m, Number(m[1]));
  return out;
}

/** "vs SPY", "against the S&P 500", "beat the market", "outperformed the benchmark" → `{ raw, target, at }`. */
export function benchmarkClaims(text) {
  const s = String(text || "").replace(REFS, " ");
  const out = [];
  const re = /\b(?:vs\.?|versus|against|relative to|compared (?:with|to)|beat(?:s|ing)?|outperform(?:ed|s|ing)?|underperform(?:ed|s|ing)?)\s+(?:the\s+)?(SPY|S&P(?:\s*500)?|market|benchmark|index)(?![\w&])/gi;
  for (const m of s.matchAll(re)) {
    if (negated(s, m.index) || out.some((c) => c.raw.toLowerCase() === m[0].toLowerCase())) continue;
    out.push({ raw: m[0].replace(/\s+/g, " ").trim(), target: m[1], at: m.index });
  }
  return out;
}

const spanDays = (from, to) => (ISO.test(from) && ISO.test(to) ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) : null);

/**
 * What one tool result says it covers: `{ all, from, to, days, basis }`, or null when it states none. A
 * backtest covers its spec's from/to (or the replay's first and last trade).
 */
export function windowOf(tool, body) {
  if (!body || typeof body !== "object") return null;
  const w = body.window;
  if (w && typeof w === "object") {
    if (w.all) return { all: true, from: w.from || "", to: w.to || "", days: null, basis: w.basis || "" };
    const days = Number.isFinite(w.days) ? w.days : spanDays(w.from, w.to);
    return days == null ? null : { all: false, from: w.from || "", to: w.to || "", days, basis: w.basis || "" };
  }
  if (tool === "run_backtest") {
    const f = body.spec?.filters || {};
    const from = f.from || body.stats?.from || "";
    const to = f.to || body.stats?.to || String(body.asOf || "").slice(0, 10);
    const days = spanDays(from, to);
    return days == null ? null : { all: false, from, to, days, basis: "public date" };
  }
  return null;
}

const BENCH_KEY = /benchmark|excess|spy|sp500|s&p/i;
const BENCH_ROW = /^(SPY|\^GSPC|S&P 500|VOO|IVV)$/i;

/** Whether a tool result holds a benchmark figure: a number under a benchmark/excess/SPY key, or a SPY row with numbers. */
export function hasBenchmarkFigures(body) {
  if (!body || typeof body !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(body, "benchmarkComparison") && body.benchmarkComparison == null) return false;
  let found = false;
  const walk = (v, key, depth) => {
    if (found || depth > 8 || v == null) return;
    if (typeof v === "number") { if (Number.isFinite(v) && BENCH_KEY.test(key)) found = true; return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, key, depth + 1); return; }
    if (typeof v !== "object") return;
    const label = v.symbol || v.ticker || v.label || v.name;
    if (typeof label === "string" && BENCH_ROW.test(label.trim()) && Object.values(v).some((x) => typeof x === "number" && Number.isFinite(x))) { found = true; return; }
    for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(body, "", 0);
  return found;
}

const parse = (json) => { try { return JSON.parse(json); } catch { return null; } };
const tolerance = (days) => Math.max(2, Math.round(days * 0.2));

const coverText = (w) => (w.all
  ? `every record the app holds${w.from && w.to ? ` (${w.basis ? `${w.basis}, ` : ""}${w.from} to ${w.to})` : ""}`
  : `${w.from && w.to ? `${w.from} to ${w.to}, ` : ""}${w.days} days${w.basis ? ` by ${w.basis}` : ""}`);

/**
 * Window and benchmark claims the cited results do not support: `[{ kind, raw, refs, note }]`. A claim is judged
 * against the refs of its own sentence or row, or every ref the answer cites when it has none (a table title). A
 * window claim is flagged only when every one of those results states its window and none is within 20% of the claim;
 * a benchmark claim only when none of them holds a benchmark figure.
 */
export function scopeCheck(answer, evidence) {
  const byId = new Map(evidence.filter((e) => e && e.ok).map((e) => [e.id, e]));
  const units = citationUnits(answer);
  const allRefs = [...new Set(units.flatMap((u) => u.refs))].filter((id) => byId.has(id));
  if (!allRefs.length) return [];
  const out = [];
  for (const unit of units) {
    const own = unit.refs.filter((id) => byId.has(id));
    const refs = own.length ? own : allRefs;
    const results = refs.map((id) => ({ id, tool: byId.get(id).tool, body: parse(byId.get(id).json) }));
    for (const c of windowClaims(unit.text)) {
      const scopes = results.map((r) => ({ id: r.id, w: windowOf(r.tool, r.body) }));
      if (scopes.some((s) => !s.w)) continue;
      if (scopes.some((s) => !s.w.all && Math.abs(s.w.days - c.days) <= tolerance(c.days))) continue;
      if (out.some((o) => o.kind === "window" && o.raw.toLowerCase() === c.raw.toLowerCase())) continue;
      const covers = scopes.map((s) => `${s.id} covers ${coverText(s.w)}`).join("; ");
      out.push({ kind: "window", raw: c.raw, refs, note: `The answer says “${c.raw}”, but ${covers}. Treat that window as unsupported; the figures are for what the tool covered.` });
    }
    for (const c of benchmarkClaims(unit.text)) {
      if (results.some((r) => hasBenchmarkFigures(r.body))) continue;
      if (out.some((o) => o.kind === "benchmark" && o.raw.toLowerCase() === c.raw.toLowerCase())) continue;
      const reason = results.map((r) => r.body?.benchmarkComparisonReason).find(Boolean);
      out.push({ kind: "benchmark", raw: c.raw, refs, note: `The answer says “${c.raw}”, but ${refs.join(", ")} ${refs.length > 1 ? "have" : "has"} no ${c.target} or benchmark figures${reason ? ` (${reason.replace(/\.$/, "")})` : ""}. Treat that comparison as unsupported.` });
    }
  }
  return out.slice(0, 6);
}
