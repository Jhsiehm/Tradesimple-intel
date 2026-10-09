/**
 * Market-overview questions in Ask: which questions they are, what the model is told, and the closing disclaimer.
 * Pure: no I/O, no env. The tool itself is server/ai/marketTool.mjs.
 */

const MARKET_WORDS = /\b(markets?(?! cap)|stocks|equities|indices|indexes|s&p( 500)?|spx|nasdaq|dow( jones)?|russell( 2000)?|vix|wall street|treasury yields?|10[- ]?year( yield)?)\b/;
const NOW_WORDS = /\b(today|right now|now|this morning|this afternoon|so far|currently|current|at the moment)\b/;

/** "how are the markets today", "how's the S&P doing right now", "market overview". Backtests and single tickers are not this. */
export function wantsMarkets(question) {
  const q = String(question || "").toLowerCase().replace(/’/g, "'");
  if (/\bbacktest|\breplay\b/.test(q)) return false;
  if (/\bmarket (overview|snapshot|update|wrap|recap)\b/.test(q)) return true;
  if (/\bhow('s| is| are| did| were)( the)? (stock )?markets?\b(?! cap)/.test(q)) return true;
  return MARKET_WORDS.test(q) && NOW_WORDS.test(q);
}

/** Added to the system prompt when the question is a market overview and market_snapshot has already run. */
export const MARKET_NOTE = [
  "Market overview: market_snapshot has already run for this question; its result is in the conversation with its ref.",
  "Answer from it: the S&P 500, Nasdaq Composite, Dow, Russell 2000 and VIX with last level and day change %, the 10-year Treasury yield, and the biggest sector or benchmark ETF moves, each figure with its [tN] ref. A compact table is fine.",
  "Never say you cannot provide market data. If the result has ok:false or stale:true, say what failed and give the as-of of the data you do have.",
  "Describe; do not forecast or recommend. End with the result's `disclaimer` sentence word for word."
].join("\n");

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** "09:43 ET, Oct 9" for an ISO time; "" when there is none. */
export function etStamp(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  return `${ET.format(t)} ET, ${ET_DAY.format(t)}`;
}

/** The closing line of a market answer. `yieldAsOf` is FRED's observation date for the 10-year yield. */
export function marketDisclaimer({ asOf = "", yieldAsOf = "", stale = false } = {}) {
  const at = etStamp(asOf);
  const quotes = at ? `${stale ? "Last cached" : "Delayed"} data from Yahoo Finance as of ${at}` : "Yahoo Finance quotes did not load";
  const rates = yieldAsOf ? `; 10-year yield from FRED as of ${yieldAsOf}` : "";
  return `${quotes}${rates}. Research only, not investment advice.`;
}

/** True when an answer already closes with a delayed-data disclaimer, so it is not added twice. */
export const hasDisclaimer = (answer) => /not investment advice/i.test(answer) && /(delayed|cached|did not load)/i.test(answer) && /yahoo/i.test(answer);

/**
 * Text to append to a finished answer that used market_snapshot: its disclaimer (or what failed) when the model
 * left it out. `body` is what the tool returned to the model.
 */
export function marketTail(answer, body) {
  if (!body || typeof body !== "object") return "";
  if (hasDisclaimer(answer)) return "";
  const line = body.ok === false ? `Market data did not load: ${body.error || "unknown error"}. ${marketDisclaimer({})}` : String(body.disclaimer || marketDisclaimer({}));
  return `${String(answer || "").trim() ? "\n\n" : ""}${line}`;
}
