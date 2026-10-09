/**
 * International markets in Ask: which questions name a non-US market, the Yahoo index symbols for each region, what
 * the model is told, and the closing disclaimer. Pure: no I/O, no env, no clock. The tool is server/ai/worldTool.mjs.
 * Ask answers only; the map's regions stay empty until a real regional feed exists.
 */
import { etStamp, hasDisclaimer } from "./marketAsk.mjs";

/** Region id → label, Yahoo symbols (index name), and the words that name it. */
export const REGIONS = {
  taiwan: { label: "Taiwan", symbols: [["^TWII", "TAIEX (Taiwan Weighted)"]], words: ["taiwan", "taiwanese", "taiex", "twse", "taipei"] },
  japan: { label: "Japan", symbols: [["^N225", "Nikkei 225"]], words: ["japan", "japanese", "nikkei", "tokyo", "topix"] },
  hongkong: { label: "Hong Kong", symbols: [["^HSI", "Hang Seng"]], words: ["hong kong", "hang seng", "hsi", "hk stocks"] },
  china: { label: "Mainland China", symbols: [["000001.SS", "Shanghai Composite"], ["399001.SZ", "Shenzhen Component"]], words: ["china", "chinese", "shanghai", "shenzhen", "csi 300", "a-shares", "a shares"] },
  korea: { label: "South Korea", symbols: [["^KS11", "KOSPI"]], words: ["korea", "korean", "kospi", "seoul"] },
  india: { label: "India", symbols: [["^NSEI", "Nifty 50"], ["^BSESN", "BSE Sensex"]], words: ["india", "indian", "nifty", "sensex", "mumbai"] },
  uk: { label: "United Kingdom", symbols: [["^FTSE", "FTSE 100"]], words: ["uk", "u.k.", "britain", "british", "ftse", "london", "england"] },
  germany: { label: "Germany", symbols: [["^GDAXI", "DAX"]], words: ["germany", "german", "dax", "frankfurt"] },
  france: { label: "France", symbols: [["^FCHI", "CAC 40"]], words: ["france", "french", "cac 40", "cac", "paris"] },
  europe: { label: "Europe", symbols: [["^STOXX50E", "Euro Stoxx 50"], ["^GDAXI", "DAX"], ["^FTSE", "FTSE 100"], ["^FCHI", "CAC 40"]], words: ["europe", "european", "euro stoxx", "stoxx", "eurozone", "euro zone"] },
  australia: { label: "Australia", symbols: [["^AXJO", "S&P/ASX 200"]], words: ["australia", "australian", "asx", "sydney"] },
  canada: { label: "Canada", symbols: [["^GSPTSE", "S&P/TSX Composite"]], words: ["canada", "canadian", "tsx", "toronto"] },
  brazil: { label: "Brazil", symbols: [["^BVSP", "Ibovespa"]], words: ["brazil", "brazilian", "bovespa", "ibovespa"] },
  mexico: { label: "Mexico", symbols: [["^MXX", "IPC Mexico"]], words: ["mexico", "mexican", "bmv"] },
  asia: { label: "Asia-Pacific", symbols: [["^N225", "Nikkei 225"], ["^HSI", "Hang Seng"], ["000001.SS", "Shanghai Composite"], ["^KS11", "KOSPI"], ["^TWII", "TAIEX (Taiwan Weighted)"], ["^NSEI", "Nifty 50"], ["^AXJO", "S&P/ASX 200"]], words: ["asia", "asian", "asia-pacific", "apac"] },
  global: { label: "Global", symbols: [["^STOXX50E", "Euro Stoxx 50"], ["^FTSE", "FTSE 100"], ["^N225", "Nikkei 225"], ["^HSI", "Hang Seng"], ["000001.SS", "Shanghai Composite"], ["^TWII", "TAIEX (Taiwan Weighted)"], ["^GSPTSE", "S&P/TSX Composite"], ["^BVSP", "Ibovespa"]], words: ["global markets", "world markets", "international markets", "markets around the world", "overseas markets", "foreign markets"] }
};

export const REGION_IDS = Object.keys(REGIONS);
const NAME_OF = new Map(Object.values(REGIONS).flatMap((r) => r.symbols));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = REGION_IDS.map((id) => [id, new RegExp(`(?<![\\w^])(?:${REGIONS[id].words.map(esc).join("|")})(?![\\w])`, "i")]);
const MARKET_CONTEXT = /\b(markets?|stocks?|shares|equit(y|ies)|index|indices|indexes|bourse|exchange|trading|traders?|investors?|economy|today|now|this week|doing|performing|closed?|open(ed)?|rall(y|ied)|fell|rose|sell-?off|crash)\b/i;
/** Index names are market words on their own ("how is the Nikkei"). */
const INDEX_WORDS = /\b(taiex|nikkei|topix|hang seng|kospi|nifty|sensex|ftse|dax|cac 40|euro stoxx|stoxx|asx|tsx|bovespa|ibovespa|shanghai composite|csi 300)\b/i;

/** Region ids a question names, in REGIONS order, with no market check. */
export function regionsIn(question) {
  const q = String(question || "").replace(/’/g, "'");
  return MATCHERS.filter(([, re]) => re.test(q)).map(([id]) => id);
}

/**
 * Regions a question asks about as markets: "tell me about the taiwanese market today", "Japan stocks", "Europe
 * markets", "how is the Nikkei". `[]` for anything else (backtests, "Taiwan Strait ships", US-only questions).
 */
export function worldRegions(question) {
  const q = String(question || "").toLowerCase();
  if (/\bbacktest|\breplay\b/.test(q)) return [];
  const ids = regionsIn(q);
  if (!ids.length) return [];
  if (!INDEX_WORDS.test(q) && !MARKET_CONTEXT.test(q)) return [];
  if (ids.includes("global")) return ["global"];
  const specific = ids.filter((id) => id !== "asia" && id !== "europe");
  return specific.length ? specific : ids;
}

export const wantsWorldMarkets = (question) => worldRegions(question).length > 0;

const SYMBOL = /^[\^A-Z0-9][A-Z0-9.=\-^]{0,14}$/;

/** Symbols to quote: each region's indices plus any Yahoo symbol the user named (validated by Yahoo, not here). Max 12. */
export function worldSymbols({ regions = [], symbols = [] } = {}) {
  const out = [];
  for (const id of regions) for (const [s] of REGIONS[id]?.symbols || []) if (!out.includes(s)) out.push(s);
  for (const raw of symbols) {
    const s = String(raw || "").trim().toUpperCase();
    if (SYMBOL.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 12);
}

export const indexName = (symbol) => NAME_OF.get(symbol) || "";

const localFmt = (tz) => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });
  } catch {
    return null;
  }
};

/** "Oct 8, 13:30 GMT+8" in the exchange's own zone; "" when the time or zone is unusable. */
export function localStamp(iso, tz) {
  const t = Date.parse(iso || "");
  const f = tz ? localFmt(tz) : null;
  return Number.isFinite(t) && f ? f.format(t) : "";
}

/**
 * One quote row's session words: open now, or closed with the time of the last close in exchange time and ET.
 * `period` is Yahoo's currentTradingPeriod.regular `{ start, end }` in epoch seconds.
 */
export function sessionOf({ asOf = "", tz = "", period = null, now = 0 }) {
  const start = Number(period?.start) * 1000;
  const end = Number(period?.end) * 1000;
  const open = Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end;
  const local = localStamp(asOf, tz);
  const et = etStamp(asOf);
  const when = [local, et ? `${et}` : ""].filter(Boolean).join(" = ");
  return {
    open,
    session: open ? "open" : "closed",
    sessionNote: open ? `Exchange open now; last trade ${when || "time not reported"}.` : `Exchange closed now; figures are the last session${when ? ` (last trade ${when})` : ""}, not today's trading.`
  };
}

/** Closing line for an answer that used world_markets (and web results, if any ran). */
export function worldDisclaimer({ asOf = "", web = false } = {}) {
  const at = etStamp(asOf);
  const quotes = at ? `Delayed data from Yahoo Finance as of ${at}` : "Yahoo Finance quotes did not load";
  return `${quotes}${web ? "; web results are third-party pages, not a TradeSimple feed" : ""}. Research only, not investment advice.`;
}

/** Text to append to a finished answer that used world_markets, when the model left the disclaimer out. */
export function worldTail(answer, body, { web = false } = {}) {
  if (!body || typeof body !== "object" || hasDisclaimer(answer)) return "";
  const line = body.ok === false ? `International quotes did not load: ${String(body.error || "unknown error").replace(/\.$/, "")}. ${worldDisclaimer({ web })}` : worldDisclaimer({ asOf: body.asOf, web });
  return `${String(answer || "").trim() ? "\n\n" : ""}${line}`;
}

/** Added to the system prompt when world_markets has already run for this question. */
export const WORLD_NOTE = [
  "International markets: world_markets has already run for this question; its result is in the conversation with its ref. Web results, if any, are separate refs.",
  "Answer from it: each index with last level, change % from the previous close, and its session note (open now, or closed with the last session's time in exchange time and ET), each figure with its [tN] ref. A closed exchange's figures are the last close: say so; do not call them today's moves.",
  "Add one or two sentences of context from the web results if they ran, each with its own ref and the site's name. Never say you only cover US data.",
  "Describe; do not forecast or recommend. End with the result's `disclaimer` sentence word for word."
].join("\n");
