/**
 * Web results in Ask, pure: when a question needs the web, the search query, per-turn caps, page text cleanup, and
 * how one search becomes one cited step per result. The adapter that fetches is server/feeds/web.mjs. Web pages are
 * third-party text, never a TradeSimple feed, and every step says so.
 */
import { numbersIn } from "./ask.mjs";
import { etStamp } from "./marketAsk.mjs";
import { REGIONS, worldRegions } from "./worldMarkets.mjs";

/** Per question. Searches return several results; each result is its own ref but not a tool call. */
export const WEB_CAPS = { web_search: 3, web_fetch: 3, results: 5, pageChars: 6_000, snippetChars: 1_200 };

export const WEB_LABEL = "web, not a TradeSimple feed";

const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "09:58 ET" for an ISO time. */
export const etClock = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? `${ET_TIME.format(t)} ET` : "";
};

/** "www.reuters.com" → "reuters.com"; "" for anything that is not an http(s) URL. */
export function domainOf(url) {
  try {
    const u = new URL(String(url || ""));
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "").toLowerCase() : "";
  } catch {
    return "";
  }
}

const NEWS = /\b(news|headlines?|what happened|latest on|announce[ds]?|announcement|press release|earnings call|guidance|central bank|rate (decision|cut|hike)|boj|ecb|pboc|bank of (japan|england|korea|canada)|election|tariffs?|sanctions?|search the web|on the web|online|internet|google it|look it up)\b/i;
const OURS = /\b(congress|senators?|representatives?|house members?|pelosi|ptrs?|disclosures?|form ?4|insiders?|lobbying|contracts?|usaspending|backtest|committee|bill|vote)\b/i;

/**
 * Whether the server searches the web before the model writes: a non-US market question (context next to the Yahoo
 * quotes), or a news/event question about something TradeSimple's own feeds do not hold. The model may still call
 * web_search itself for anything else.
 */
export function wantsWeb(question) {
  const q = String(question || "");
  if (/\bbacktest|\breplay\b/i.test(q)) return false;
  if (worldRegions(q).length) return true;
  return NEWS.test(q) && !OURS.test(q);
}

/** The query the server runs: the region's market and index on that date, or the question itself. */
export function webQuery(question, today = "") {
  const ids = worldRegions(question);
  const q = String(question || "").replace(/\s+/g, " ").trim();
  if (!ids.length) return q.slice(0, 200);
  const r = REGIONS[ids[0]];
  if (ids[0] === "global") return `global stock markets ${today} summary`.trim();
  const index = r.symbols[0][1].replace(/\s*\(.*\)$/, "");
  return `${r.label} stock market ${index} ${today ? `${today} ` : ""}close and main movers`.slice(0, 200);
}

/** Plain text from an HTML page: no scripts, styles, tags, or entities beyond the common ones; at most `max` chars. */
export function htmlToText(html, max = WEB_CAPS.pageChars) {
  const s = String(html || "")
    .replace(/<(script|style|noscript|svg|iframe|template|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 31 && c < 0x10ffff ? String.fromCodePoint(c) : " "; })
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** `<title>` of an HTML page, or "". */
export const titleOf = (html) => htmlToText((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "", 200);

/** Step fields for one web page: the chip reads "web · domain · retrieved HH:MM ET · title · …". */
export function webStep({ url, title = "", retrievedAt, via = "" }) {
  const domain = domainOf(url) || "unknown site";
  const at = etClock(retrievedAt);
  return {
    label: `web · ${domain} · retrieved ${at || "time unknown"}`,
    source: `${title ? `${title.slice(0, 120)} — ` : ""}${url} (${WEB_LABEL})`,
    asOf: retrievedAt,
    latency: `Retrieved ${at ? `${at}, ${etStamp(retrievedAt).split(", ")[1]}` : "at an unknown time"}${via ? ` via ${via}` : ""}; the page's own publish time is not verified by the app.`
  };
}

/** "869.7 billion" in page text as 869700000000, so an answer's "NT$869.7 billion" grounds against the excerpt. */
export const scaledFigures = (text) => [...new Set(numbersIn(text).filter((n) => n.scale !== 1).map((n) => n.value * n.scale))].slice(0, 40);

/**
 * One search result per ref. `raw` is what web_search returned; `nextId()` hands out refs. Returns the children (each
 * `{ id, body, step }`) and the parent body the model sees, where each result carries its own `ref`.
 */
export function splitWebResults(raw, nextId) {
  if (!raw || raw.ok === false || !Array.isArray(raw.results) || !raw.results.length) return { children: [], parent: raw };
  const children = raw.results.map((r) => {
    const id = nextId();
    const step = webStep({ url: r.url, title: r.title, retrievedAt: raw.retrievedAt, via: raw.via });
    const body = { ok: true, ref: id, url: r.url, domain: domainOf(r.url), title: r.title || "", snippet: r.snippet || "", ...(r.published ? { published: r.published } : {}), source: step.source, asOf: step.asOf, latency: step.latency, scaledFigures: scaledFigures(`${r.title || ""} ${r.snippet || ""}`) };
    return { id, body, step };
  });
  const parent = { ...raw, results: children.map((c) => ({ ref: c.id, domain: c.body.domain, title: c.body.title, url: c.body.url, snippet: c.body.snippet, ...(c.body.published ? { published: c.body.published } : {}) })), note: `Each result has its own ref (${children.map((c) => c.id).join(", ")}); cite the result a fact comes from, not this search.` };
  return { children, parent };
}

/** Step label for a web or world call, before it runs; "" for other tools. */
export function webCallLabel(name, args = {}) {
  const a = args && typeof args === "object" ? args : {};
  if (name === "web_search") return `Web search · "${String(a.query || a.q || "").slice(0, 60)}"`;
  if (name === "web_fetch") return `web · ${domainOf(a.url) || "page"}`;
  if (name === "world_markets") return `World markets · ${[...(Array.isArray(a.regions) ? a.regions : []), ...(Array.isArray(a.symbols) ? a.symbols : [])].join(", ").slice(0, 60) || "indices"}`;
  return "";
}

/** Added to the system prompt when web_search already ran before the model. */
export const WEB_NOTE = "web_search has already run for this question; each result is its own ref with the site, title and a text excerpt. Use them for context the TradeSimple tools do not hold, cite each result's ref and name the site, and say they are web pages, not TradeSimple data. Quote figures exactly as the excerpt states them.";

export const WEB_CAVEAT = "Web results are third-party pages found by search, not TradeSimple feeds; the app checked their figures against the excerpts it retrieved, not against the original source.";

/** Closing line for an answer that used the web without a market disclaimer. */
export function webTail(answer) {
  if (/not investment advice/i.test(String(answer || ""))) return "";
  return `${String(answer || "").trim() ? "\n\n" : ""}Web results are third-party pages, not a TradeSimple feed. Research only, not investment advice.`;
}

/** Standing rule in every Ask system prompt: what to do when a question is outside TradeSimple's own data. */
export const COVERAGE_NOTE = [
  "Coverage: TradeSimple's own tools hold US Congress trades, Form 4 insiders, lobbying, federal contracts, US market boards and backtests. world_markets has international index quotes from Yahoo Finance. web_search and web_fetch read the public web for anything else (non-US markets news, macro events, company news).",
  "Never say you can only cover US data or that a question is outside your capabilities. Use TradeSimple tools first, then world_markets, then the web; say which source each fact is from and its time. If even the web has nothing, say precisely what was searched and what is and is not covered.",
  "Web results are third-party pages, not TradeSimple feeds: cite each result's own ref, name the site, and quote figures exactly as the snippet states them. Never present a web figure as TradeSimple data.",
  "Research only, not investment advice."
].join("\n");
