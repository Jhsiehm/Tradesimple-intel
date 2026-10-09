/**
 * Ask sheet helpers, pure: which model a run may use, what the screen attaches, greetings, and whether a finished
 * answer actually carries the numbers its tools returned. Nothing here reads env, the network, or the clock.
 */
import { cleanTheory } from "./theories.mjs";

/** OpenRouter menu. Strong tool-callers first; the small ones stay available but carry a warning badge. */
export const OPENROUTER_MENU = [
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-4.1",
  "openai/gpt-5.4",
  "google/gemini-2.5-pro",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4.1-mini",
  "openai/gpt-4o-mini"
];

/** Small or fast tiers that follow the citation and table rules less reliably. */
export function smallModel(id) {
  return /(?:^|[-/:.])(mini|nano|haiku|flash|lite|small|tiny)(?:$|[-/:.\d])|\b\d{1,2}b\b/i.test(String(id || ""));
}

/** Models the sheet may offer: the server's own and its strong model, plus the menu when the provider is OpenRouter. */
export function modelOptions(cfg) {
  const own = [cfg?.model, cfg?.strong].map((m) => String(m || "").trim()).filter(Boolean);
  return [...new Set(cfg?.provider === "openrouter" ? [...own, ...OPENROUTER_MENU] : own)];
}

/** A requested id is used only when it is one of the options; anything else falls back to the server's model. */
export function resolveModel(requested, cfg) {
  const want = typeof requested === "string" ? requested.trim() : "";
  return want && modelOptions(cfg).includes(want) ? want : String(cfg?.model || "");
}

const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** What the screen attached: a member or ticker node, or a theory. Null when nothing is attached. */
export function cleanContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const node = text(raw.node, 160);
  const theory = cleanTheory(raw.theory);
  const okNode = NODE.test(node) ? node : "";
  if (!okNode && !theory) return null;
  return { node: okNode, label: text(raw.label, 120), theory };
}

/** Members and tickers by id; bills, roll calls, committees, districts, map links and nodes, and other cards by key. */
const NODE = /^(member:[A-Z]\d{6}|ticker:[A-Z][A-Z0-9.\-]{0,11}|(bill|vote|committee|district|edge|rel|item):\S.{0,149})$/;
const NODE_KIND = { member: "Member", ticker: "Ticker", bill: "Bill", vote: "Roll call", committee: "Committee", district: "District", edge: "Relationship-map link", rel: "Relationship-map node", item: "Card" };

/** The line the model sees about the screen. Empty when nothing is attached, so nothing leaks in by default. */
export function contextNote(ctx) {
  if (!ctx) return "";
  const bits = [];
  if (ctx.node) {
    const [kind, ...rest] = ctx.node.split(":");
    const id = rest.join(":");
    const keyed = kind === "member" || kind === "ticker" || kind === "bill" || kind === "vote" || kind === "committee" || kind === "district";
    bits.push(keyed ? `${NODE_KIND[kind]} ${id}${ctx.label ? ` (${ctx.label})` : ""}` : `${NODE_KIND[kind] || "Card"}: ${ctx.label || id}`);
  }
  if (ctx.theory) bits.push(`the user's own theory, not a filing: ${ctx.theory.a.label} ↔ ${ctx.theory.b.label}${ctx.theory.label ? ` — ${ctx.theory.label}` : ""}`);
  return `The user attached what is on screen: ${bits.join("; ")}. Use it only when the question refers to it.`;
}

/** A prior chat the user picked. Labeled as a chat, never as data. */
export function cleanAttached(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.turns)) return null;
  const turns = [];
  for (const t of raw.turns) {
    if (!t || (t.role !== "user" && t.role !== "assistant")) continue;
    const content = text(t.content, 1200);
    if (content) turns.push({ role: t.role, content });
    if (turns.length >= 8) break;
  }
  if (!turns.length) return null;
  return { title: text(raw.title, 80) || "Saved chat", turns };
}

export function attachedNote(att) {
  if (!att) return "";
  return `Prior chat "${att.title}", attached by the user. It is not a data source; cite only tool results.\n${att.turns.map((t) => `${t.role}: ${t.content}`).join("\n")}`;
}

/* ---------- greetings ---------- */

export const EXAMPLES = [
  "Top disclosed buys vs SPY in the last 30 days",
  "Backtest the last 30 days from all data sources",
  "What did Nancy Pelosi file most recently?",
  "Latest markets headlines on semis",
  "Parse the latest GOES and Himawari satellite frames",
  "Use TradeSimple and the web: what is moving NVDA today?"
];

const GREETING = /^(hi|hey|hello|yo|hiya|howdy|sup|hola|good (morning|afternoon|evening)|thanks|thank you|ok|okay|test|help|what can you do)[\s!.?,]*$/i;

export function isGreeting(question) {
  return GREETING.test(String(question || "").trim());
}

export function greetingText() {
  return [
    "Hi. Default is in-app feeds only: Records (filings, Form 4, contracts, prices) and Signals (news wires, X pulse, satellite status) — every number cited, and world questions pull more than one feed.",
    "Say “use in-app and the web” (or pick the chip) to also search the open web. Say “professional” or “simplified” to change the writing style.",
    "",
    "Try one of these:",
    ...EXAMPLES.map((q) => `- ${q}`)
  ].join("\n");
}

/* ---------- does the answer carry the data ---------- */

const listIn = (body) => {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return null;
  for (const k of ["items", "rows", "trades", "leaders", "buys", "results", "topMembers", "topTickers", "edges"]) {
    const v = body[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object" && Array.isArray(v.items)) return v.items;
  }
  for (const v of Object.values(body)) {
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object") return v;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const w of Object.values(v)) if (Array.isArray(w) && w.length && w[0] && typeof w[0] === "object") return w;
    }
  }
  return null;
};

/** How many rows a tool result carries (its true total when the list was cut), or 0. A backtest counts its trades. */
export function rowCount(body) {
  if (!body || typeof body !== "object" || body.ok === false) return 0;
  if (body.stats && typeof body.stats === "object" && Number.isFinite(body.stats.trades)) return body.stats.trades;
  for (const k of ["items", "rows", "trades", "leaders"]) {
    const v = body[k];
    if (v && typeof v === "object" && !Array.isArray(v) && Number.isFinite(v.total)) return v.total;
  }
  const list = listIn(body);
  return list ? list.length : 0;
}

/** Numbers an answer states beyond list markers, refs, dates, and one-digit counts. */
export function figureCount(answer) {
  const s = String(answer || "")
    .replace(/\[t\d+(?:\s*,\s*t\d+)*\]/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/^\s*\d+[.)]\s/gm, " ");
  return [...s.matchAll(/[-+−]?\$?\d[\d,]*(?:\.\d+)?\s?%?/g)].filter((m) => /[.%$,]|\d\d/.test(m[0])).length;
}

export const wantsBacktest = (q) => /\bback-?test/i.test(String(q || ""));

/**
 * Why a finished answer should be rewritten once, or "". `evidence` items carry `tool`, `ok`, and `rows`.
 */
export function retryReason(question, answer, evidence) {
  const data = evidence.filter((e) => e.ok && e.rows > 0 && e.tool !== "search" && e.tool !== "propose_theory");
  if (wantsBacktest(question) && !evidence.some((e) => e.tool === "run_backtest")) {
    return "The user asked for a backtest and run_backtest was not called. Call run_backtest now with a sensible spec (see the rules), then answer with its numbers and state the spec you used.";
  }
  if (data.length && figureCount(answer) < 2) {
    return `Your answer has no figures, but ${data.map((e) => `${e.id} returned ${e.rows} rows`).join(", ")}. Rewrite it with the actual numbers: a compact markdown table of up to 8 rows with the key columns, each row or figure followed by its [tN] ref. Do not call more tools.`;
  }
  return "";
}

const SKIP_COL = /^(id|url|link|href|source|asOf|latency|note|open|bioguide|cik|accession|docId|raw|meta)$/i;

/** The first list of records in a result as a small table: up to 8 columns with values, up to 12 rows. */
export function fallbackTable(body, maxRows = 12) {
  if (body && typeof body === "object" && body.stats && typeof body.stats === "object") {
    const rows = Object.entries(body.stats).filter(([, v]) => typeof v === "number" || (typeof v === "string" && v.length <= 20)).map(([k, v]) => [k, typeof v === "number" ? String(Math.round(v * 10_000) / 10_000) : v]);
    return rows.length ? { columns: ["metric", "value"], rows, total: rows.length } : null;
  }
  const list = listIn(body);
  if (!list || !list.length || typeof list[0] !== "object") return null;
  const rows = list.filter((r) => r && typeof r === "object" && !Array.isArray(r)).slice(0, maxRows);
  const cols = [];
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (cols.includes(k) || SKIP_COL.test(k) || cols.length >= 8) continue;
      if (typeof v === "number" || (typeof v === "string" && v.length <= 60)) cols.push(k);
    }
  }
  if (!cols.length) return null;
  const cell = (v) => (v == null ? "" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 10_000) / 10_000)) : String(v).slice(0, 60));
  return { columns: cols, rows: rows.map((r) => cols.map((c) => cell(r[c]))), total: rowCount(body) || list.length };
}
