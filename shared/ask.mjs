/**
 * Ask, pure. Limits, the grounding prompt, how a tool result becomes evidence, the numeric grounding check, the
 * per-IP limiter, and the follow action each citation chip opens. Nothing here reads the network, the clock, or env.
 */
import { encodeSpec } from "./backtestSpec.mjs";

export const ASK_LIMITS = {
  question: 800,
  history: 6,
  toolCalls: 8,
  rounds: 6,
  totalMs: 90_000,
  roundMs: 45_000,
  tokenBudget: 60_000,
  maxOutputTokens: 1_400,
  resultChars: 9_000,
  resultItems: 10,
  perIp: 12,
  perIpWindowMs: 10 * 60_000,
  concurrent: 3
};

export const NOT_CONFIGURED = "Ask is not configured — add a key to .env.local";

const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The question and up to six earlier turns of this chat. */
export function cleanAsk(raw, limits = ASK_LIMITS) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "JSON body required." };
  const question = text(raw.question, limits.question);
  if (!question) return { ok: false, error: "A question is required." };
  const history = [];
  for (const turn of Array.isArray(raw.history) ? raw.history : []) {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant")) continue;
    const content = text(turn.content, 1500);
    if (content) history.push({ role: turn.role, content });
  }
  return { ok: true, question, history: history.slice(-limits.history) };
}

export function systemPrompt(today) {
  return [
    `You are the research assistant inside TradeSimple Intel, a read-only research terminal. Today is ${today}.`,
    "Answer only from tool results. Call tools to look things up; you have no other knowledge of this data.",
    "Every tool result carries a ref such as t3. Put that ref in square brackets, [t3], right after each sentence or number that comes from it. A number or fact without a ref from a result you called is not allowed.",
    "Quote numbers as the tool returned them. Do not do arithmetic that no tool did; if a difference or ratio matters, say the two figures with their refs instead of computing a third.",
    "If the tools cannot answer, say so plainly and say what is missing. Do not guess, do not fill gaps from memory.",
    "Never guess a ticker join. A symbol that the ticker tool says is not joined is not joined; say that and stop.",
    "Congress trades are known by their filing date, not their trade date, and amounts are ranges. Say so when you use them. Committee seats are the current roster, applied to past trades.",
    "A backtest is a replay of past public records with the caveats the tool returned. Report the benchmark and the excess return next to any return, name the largest caveat, and do not call a result proof of anything.",
    "Closeness in time between a trade and a hearing does not show what the hearing discussed or that anyone acted on it.",
    "This is research, not advice. Do not recommend buying or selling anything, do not suggest an order, and do not predict prices.",
    "Be short: a few plain sentences or a short list. Use at most six tool calls. No tables, no headings."
  ].join("\n");
}

const trimNode = (v, depth, items) => {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 320 ? `${v.slice(0, 320)}…` : v;
  if (depth > 6) return null;
  if (Array.isArray(v)) {
    const kept = v.slice(0, items).map((x) => trimNode(x, depth + 1, items));
    return v.length > items ? { items: kept, total: v.length, truncated: true } : kept;
  }
  if (typeof v !== "object") return null;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (/^(coordinates|geometry|geojson|features|apiKey|token|password|secret|authorization)$/i.test(k)) continue;
    out[k] = trimNode(x, depth + 1, items);
  }
  return out;
};

/** What the model sees. Long lists are cut with their true total; source, asOf, and latency always survive. */
export function trimForModel(value, limits = ASK_LIMITS) {
  const out = trimNode(value, 0, limits.resultItems);
  let json = "";
  try { json = JSON.stringify(out); } catch { json = ""; }
  if (json.length <= limits.resultChars) return out;
  const src = out && typeof out === "object" && !Array.isArray(out) ? out : {};
  const slim = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 200)) slim[k] = v;
  }
  return { ...slim, note: "Trimmed to fit the model context; ask a narrower question for more." };
}

/** One tool result as the evidence the answer may cite. `body` is what the model saw. */
export function evidenceOf(id, tool, args, body, { ms = 0, label = "" } = {}) {
  const src = body && typeof body === "object" ? body : {};
  const failed = src.ok === false || Boolean(src.error);
  let json = "";
  try { json = JSON.stringify(body ?? null); } catch { json = ""; }
  return {
    id,
    tool,
    args: args && typeof args === "object" ? args : {},
    ok: !failed,
    label: text(label || tool, 120),
    source: text(src.source, 200),
    asOf: text(src.asOf, 40),
    latency: text(src.latency, 260),
    ms,
    note: failed ? text(src.error || "Tool returned no data.", 200) : "",
    caveats: Array.isArray(src.caveatTexts) ? src.caveatTexts.slice(0, 6).map((c) => text(c, 320)) : [],
    open: openAction(tool, args, body),
    json
  };
}

/** What the model receives for a tool call: the ref first, then the trimmed result. */
export function toolMessage(evidence, body) {
  return JSON.stringify({ ref: evidence.id, ...(body && typeof body === "object" && !Array.isArray(body) ? body : { result: body }) });
}

/** The follow action a citation chip opens. Empty when no board shows that tool's data. */
export function openAction(tool, args = {}, body = {}) {
  const a = args && typeof args === "object" ? args : {};
  const bio = String(a.id || a.member || "").toUpperCase();
  const sym = String(a.symbol || "").toUpperCase();
  switch (tool) {
    case "member_profile":
    case "member_trades":
      return /^[A-Z]\d{6}$/.test(bio) ? `member:${bio}` : "";
    case "member_timeline":
      return /^[A-Z]\d{6}$/.test(bio) ? `timeline:${bio}` : "";
    case "ticker_dossier":
    case "positions":
      return sym ? `ticker:${sym}` : "";
    case "corporate":
      return sym ? `ticker:${sym}` : "";
    case "case_file":
      return a.kind === "district" && a.id ? `district:${String(a.id).toUpperCase()}` : a.kind === "member" && a.id ? `member:${String(a.id).toUpperCase()}` : a.kind === "ticker" && a.id ? `ticker:${String(a.id).toUpperCase()}` : "";
    case "committee":
      return a.id ? `committee:${a.id}` : "";
    case "bill":
    case "bill_votes":
      return a.id ? `bill:${a.id}` : "";
    case "contracts":
      return sym ? `contracts:symbol:${sym}` : a.place ? `contracts:place:${String(a.place).toUpperCase()}` : /^[A-Za-z]\d{6}$/.test(String(a.member || "")) ? `contracts:member:${String(a.member).toUpperCase()}` : "";
    case "intel_scope":
      return a.member ? `scope:member:${String(a.member).toUpperCase()}` : sym ? `scope:symbol:${sym}` : "";
    case "run_backtest": {
      const spec = body && typeof body === "object" ? body.spec : null;
      return spec ? `bt:token:${encodeSpec(spec)}` : "";
    }
    default:
      return "";
  }
}

/* ---------- citations ---------- */

/** Refs the answer uses, in order, split into ones that match a tool result and ones that do not. */
export function citationRefs(answer, evidence) {
  const known = new Set(evidence.map((e) => e.id));
  const cited = [];
  const unknown = [];
  for (const m of String(answer || "").matchAll(/\[(t\d+(?:\s*,\s*t\d+)*)\]/g)) {
    for (const id of m[1].split(/\s*,\s*/)) {
      if (known.has(id)) { if (!cited.includes(id)) cited.push(id); } else if (!unknown.includes(id)) unknown.push(id);
    }
  }
  return { cited, unknown };
}

/* ---------- numeric grounding ---------- */

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const SCALE = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9, thousand: 1e3, million: 1e6, billion: 1e9 };

const stripNoise = (s) =>
  String(s)
    .replace(/\[t\d+(?:\s*,\s*t\d+)*\]/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, "gi"), " ")
    .replace(new RegExp(`\\b\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?\\b`, "gi"), " ")
    .replace(/\b(?:19|20)\d{2}\b(?![,.]?\d)/g, " ")
    .replace(/\b(?:H\.?R\.?|S\.?|HRES|HJRES|SJRES)\s?\d+\b/gi, " ")
    .replace(/\b[A-Z]{1,2}\d{6}\b/g, " ")
    .replace(/\b[A-Z]{2}-\d{1,2}\b/g, " ")
    .replace(/\bt\d+\b/g, " ");

const NUMBER = /(?<![\w.])([-−+]?)\$?(\d[\d,]*(?:\.\d+)?)\s?(%|bps|bn|billion|million|thousand|[kKmMbB](?![A-Za-z]))?/g;

/** Numbers in prose: `{ raw, value, decimals, pct, scale }`. Years, dates, bill and district codes are not numbers here. */
export function numbersIn(s) {
  const out = [];
  for (const m of stripNoise(s).matchAll(NUMBER)) {
    const body = m[2].replace(/,/g, "");
    const value = Number(body);
    if (!Number.isFinite(value)) continue;
    const unit = (m[3] || "").toLowerCase();
    const decimals = body.includes(".") ? body.split(".")[1].length : 0;
    out.push({ raw: m[0].trim(), value, decimals, pct: unit === "%", bps: unit === "bps", scale: SCALE[unit] || 1 });
  }
  return out;
}

/** Every number a tool result states, as plain values. */
export function evidenceNumbers(json) {
  const set = new Set();
  for (const m of String(json).matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const v = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) set.add(Math.abs(v));
  }
  return [...set];
}

function grounded(n, pool) {
  const v = Math.abs(n.value);
  if (!n.pct && !n.bps && n.scale === 1 && Number.isInteger(v) && v <= 10) return true;
  const tol = 0.5 * 10 ** -n.decimals * n.scale;
  const bases = n.pct ? [v, v / 100] : n.bps ? [v, v / 10_000] : [v * n.scale];
  const tols = n.pct ? [0.5 * 10 ** -n.decimals, tol / 100] : n.bps ? [0.5, 0.5 / 10_000] : [tol];
  const slack = 1e-9;
  return bases.some((b, i) => pool.some((e) => Math.abs(e - b) <= tols[i] + slack));
}

/** Numbers in the answer that no tool result contains. A warning to show, not a block. */
export function groundingCheck(answer, evidence) {
  const pool = [...new Set(evidence.filter((e) => e.ok).flatMap((e) => evidenceNumbers(e.json)))];
  const nums = numbersIn(answer);
  const unmatched = [];
  for (const n of nums) if (!grounded(n, pool) && !unmatched.includes(n.raw)) unmatched.push(n.raw);
  return { checked: nums.length, unmatched: unmatched.slice(0, 12) };
}

/* ---------- caveats ---------- */

/** Standing notes for the tools that ran, plus every warning a backtest carried. */
export function caveatsFor(evidence) {
  const used = new Set(evidence.filter((e) => e.ok).map((e) => e.tool));
  const out = [];
  const trades = ["member_profile", "member_trades", "member_timeline", "congress_feed", "congress_leaders", "run_backtest", "case_file", "positions"];
  if (trades.some((t) => used.has(t))) out.push("Congress trades are dated by filing, which can trail the trade by up to 45 days or more. Amounts are ranges, not exact dollars.");
  if (used.has("member_timeline") || used.has("committee") || used.has("run_backtest")) out.push("A hearing near a trade shows timing only. It does not show what was discussed or that anyone acted on it.");
  if (used.has("run_backtest")) {
    for (const e of evidence) if (e.tool === "run_backtest" && e.ok) out.push(...e.caveats);
  }
  out.push("Research only. Not investment advice, and nothing here places an order.");
  return [...new Set(out)].slice(0, 10);
}

/* ---------- limiter ---------- */

/** Sliding window per key. `take(key, now)` → `{ ok, retryMs }`. Old keys are dropped as they empty. */
export function makeLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    take(key, now) {
      const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { ok: false, retryMs: windowMs - (now - recent[0]) };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return { ok: true, retryMs: 0 };
    }
  };
}

/** A tool definition has a snake_case name, a description, and an object schema that closes its properties. */
export function toolProblems(tool) {
  const out = [];
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(tool?.name || "")) out.push(`${tool?.name}: bad name`);
  if (!tool?.description || tool.description.length < 12) out.push(`${tool.name}: description too short`);
  const p = tool?.parameters;
  if (!p || p.type !== "object" || typeof p.properties !== "object") out.push(`${tool.name}: parameters must be an object schema`);
  else {
    if (p.additionalProperties !== false) out.push(`${tool.name}: additionalProperties must be false`);
    for (const r of p.required || []) if (!(r in p.properties)) out.push(`${tool.name}: required ${r} is not a property`);
    for (const [k, v] of Object.entries(p.properties)) if (!v || (!v.type && !v.enum)) out.push(`${tool.name}.${k}: no type`);
  }
  return out;
}
