/**
 * Ask, pure. Limits, the grounding prompt, how a tool result becomes evidence, the numeric grounding check, the
 * per-IP limiter, and the follow action each citation chip opens. Nothing here reads the network, the clock, or env.
 */
import { cleanSpec, encodeSpec } from "./backtestSpec.mjs";
import { PREF_FIELDS, cleanPrefs } from "./backtestAsk.mjs";
import { cleanAttached, cleanContext, rowCount } from "./agent.mjs";
import { SOURCING, STYLES, cleanSession, modeSystemNote } from "./askModes.mjs";

export const ASK_LIMITS = {
  question: 800,
  history: 6,
  toolCalls: 8,
  rounds: 6,
  totalMs: 150_000,
  roundMs: 60_000,
  tokenBudget: 80_000,
  maxOutputTokens: 1_800,
  resultChars: 9_000,
  resultItems: 10,
  perIp: 12,
  perIpWindowMs: 10 * 60_000,
  concurrent: 3
};

export const NOT_CONFIGURED = "Ask is not configured — add a key to .env.local";

const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The question, up to six earlier turns of this chat, the model asked for, and what the user attached. */
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
  return {
    ok: true,
    question,
    history: history.slice(-limits.history),
    model: text(raw.model, 120),
    context: cleanContext(raw.context),
    attached: cleanAttached(raw.attached),
    prefs: raw.prefs ? cleanPrefs(raw.prefs) : null,
    session: cleanSession(raw.session),
    prior: cleanPrior(raw.prior),
    answers: cleanAnswers(raw.answers),
    acceptDefaults: raw.acceptDefaults === true
  };
}

function cleanPrior(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = cleanSpec(raw);
  return out.ok ? out.spec : null;
}

/** Chip picks: backtest preference paths, plus sourcing/style mode answers. */
function cleanAnswers(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [path, v] of Object.entries(raw)) {
    if (path === "sourcing" && SOURCING.includes(v)) out.sourcing = v;
    else if (path === "style" && STYLES.includes(v)) out.style = v;
    else if (path in PREF_FIELDS && ["string", "number", "boolean"].includes(typeof v)) out[path] = typeof v === "string" ? v.slice(0, 20) : v;
  }
  return out;
}

const daysBefore = (today, n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Base research rules. Pass `modes` ({ sourcing, style }) to append sourcing, style, and layer packs. */
export function systemPrompt(today, modes = null) {
  const base = [
    `You are the research assistant inside TradeSimple Intel, a read-only research terminal. Today is ${today}.`,
    "Answer only from tool results. Call tools to look things up; you have no other knowledge of this data. Nothing on the user's screen is known to you unless the user attached it.",
    "Every tool result carries a ref such as t3. Put that ref in square brackets, [t3], right after each sentence, table row, or number that comes from it. A number or fact without a ref from a result you called is not allowed.",
    "When a tool returns rows, the answer must show the actual numbers: a compact markdown table (at most 8 rows, the key columns only, a ref in the last column) followed by one or two sentences. Never answer 'here are the results' without the figures.",
    "Quote numbers as the tool returned them (a fraction such as 0.0834 may be written 8.34%). Do not do arithmetic that no tool did; if a difference matters, give the two figures with their refs.",
    `Backtests: call run_backtest. For "the last N days", set filters.from to N days before today (30 days → ${daysBefore(today, 30)}), filters.to to ${today}, rules.openTrades to "mark" and rules.holdDays to N, because most of those positions have not reached a normal 90-day exit. "All data sources" means one run_backtest call per source in the same turn: congress, form4, and contracts (lobbying needs tickers; say so). State the spec you used in one line.`,
    "Use congress_leaders for disclosed buys ranked against SPY.",
    "For headlines and world updates use news / news_desk / x_pulse / x_posts / world_calendar / strait_news. For satellite status use satellite. For open-web context (when those tools are listed) use web_search and web_fetch.",
    "If the tools cannot answer, say so plainly and say what is missing. Do not guess, do not fill gaps from memory.",
    "Never guess a ticker join. A symbol that the ticker tool says is not joined is not joined; say that and stop.",
    "Congress trades are known by their filing date, not their trade date, and amounts are ranges. Say so when you use them. Committee seats are the current roster, applied to past trades.",
    "A backtest is a replay of past public records with the caveats the tool returned. Report the benchmark and the excess return next to any return, name the largest caveat, and do not call a result proof of anything.",
    "Closeness in time between a trade and a hearing does not show what the hearing discussed or that anyone acted on it.",
    "If the user wants to save a link between two things as their own theory, call propose_theory; it writes nothing until the user accepts it.",
    "This is research, not advice. Do not recommend buying or selling anything, do not suggest an order, and do not predict prices.",
    "Be short. No headings. Use at most six tool calls."
  ];
  if (modes?.sourcing || modes?.style) base.push(modeSystemNote(modes));
  return base.join("\n");
}

const trimNode = (v, depth, items, chars = 320, maxDepth = 6) => {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > chars ? `${v.slice(0, chars)}…` : v;
  if (depth > maxDepth) return null;
  if (Array.isArray(v)) {
    const kept = v.slice(0, items).map((x) => trimNode(x, depth + 1, items, chars, maxDepth));
    return v.length > items ? { items: kept, total: v.length, truncated: true } : kept;
  }
  if (typeof v !== "object") return null;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (/^(coordinates|geometry|geojson|features|apiKey|token|password|secret|authorization)$/i.test(k)) continue;
    out[k] = trimNode(x, depth + 1, items, chars, maxDepth);
  }
  return out;
};

/** What the model sees. Long lists are cut with their true total; source, asOf, and latency always survive. */
export function trimForModel(value, limits = ASK_LIMITS) {
  const size = (x) => { try { return JSON.stringify(x).length; } catch { return Infinity; } };
  const out = trimNode(value, 0, limits.resultItems);
  if (size(out) <= limits.resultChars) return out;
  // Several lists in one result: keep fewer rows each and shorter strings before giving up on rows altogether.
  for (const [items, chars, depth] of [[6, 120, 4], [4, 80, 3], [3, 60, 3]]) {
    const lean = trimNode(value, 0, items, chars, depth);
    if (size(lean) <= limits.resultChars) {
      return lean && typeof lean === "object" && !Array.isArray(lean) ? { ...lean, note: `Lists cut to ${items} rows each to fit the model context.` } : lean;
    }
  }
  const src = out && typeof out === "object" && !Array.isArray(out) ? out : {};
  const slim = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 200)) slim[k] = v;
  }
  return { ...slim, note: "Trimmed to fit the model context; ask a narrower question for more." };
}

/**
 * One tool result as the evidence the answer may cite. `body` is what the model saw; `raw` (optional) is the untrimmed
 * result, used only to count rows. `requests` are the in-process routes the tool called.
 */
export function evidenceOf(id, tool, args, body, { ms = 0, label = "", raw = body, requests = [] } = {}) {
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
    latency: text(src.latency, 420),
    ms,
    rows: failed ? 0 : rowCount(raw),
    note: failed ? text(src.error || "Tool returned no data.", 200) : "",
    caveats: Array.isArray(src.caveatTexts) ? src.caveatTexts.slice(0, 6).map((c) => text(c, 320)) : [],
    open: openAction(tool, args, body),
    requests: requests.slice(0, 6).map((r) => text(r, 300)),
    preview: json.length > 1600 ? `${json.slice(0, 1600)}…` : json,
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
    case "congress_leaders":
      return "today:leaders";
    case "intel_scope":
      return a.member ? `scope:member:${String(a.member).toUpperCase()}` : sym ? `scope:symbol:${sym}` : "";
    case "news":
    case "news_desk":
    case "x_pulse":
    case "x_posts":
      return "section:news";
    case "satellite":
    case "shipping":
    case "strait_news":
    case "strait_ships":
    case "air_theater":
      return "section:strait";
    case "world_calendar":
    case "macro_strip":
      return "calendar:macro";
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
  if (["news", "news_desk", "x_pulse", "x_posts", "strait_news"].some((t) => used.has(t))) out.push("Headlines and social posts use the publisher's stamp; trending lists can lag X by up to an hour.");
  if (used.has("satellite") || used.has("shipping") || used.has("air_theater") || used.has("strait_ships")) out.push("Satellite frames and volunteer AIS/ADS-B feeds are delayed or incomplete; empty coverage is honest, not a claim that nothing is there.");
  if (used.has("web_search") || used.has("web_fetch")) out.push("Open-web results are outside TradeSimple's own feeds. URLs can be wrong or stale; they are not filings.");
  out.push("Research only. Not investment advice, and nothing here places an order.");
  return [...new Set(out)].slice(0, 12);
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
    },
    refund(key) {
      const recent = hits.get(key);
      if (recent?.length) recent.pop();
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
