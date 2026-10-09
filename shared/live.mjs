/**
 * Pure rules for live watchlist detection: which checks run how often, backoff after failures, the latency labels
 * (filing lag = published − event, detection lag = detected − published) and the alert row a detection pushes.
 * Event objects are the shape shared/watchlist.mjs builds; ids match the Alerts rows so read/unread is shared.
 */
import { alertSeverity } from "./intel.mjs";
import { amountShort } from "./sentences.mjs";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY_MS = 24 * HOUR;

/**
 * One row per poller check. `covers` are shared/watchlist.mjs WATCH_SOURCES keys. `precision` is how exactly the
 * upstream says when a record became public: "time" (to the second), "day" (a date only) or "none" (no publish date).
 */
export const LIVE_CHECKS = [
  { id: "sec", label: "SEC filings", covers: ["insiders", "filings", "stakes"], everyMs: 30_000, maxMs: 15 * MIN, precision: "time", source: "SEC EDGAR latest-filings Atom (Form 4, 8-K, Schedule 13D/13G), plus an issuer submissions sweep every 30 min", publishes: "Continuously on business days, 6 AM–10 PM ET; the acceptance time is to the second, and the Atom feed lists a filing about 25–60 s after acceptance." },
  { id: "whales", label: "13F funds", covers: ["whales"], everyMs: 10 * MIN, maxMs: 2 * HOUR, precision: "time", source: "SEC EDGAR 13F-HR information tables for the funds in data/whales.json", publishes: "Quarterly, due 45 days after quarter end, so holdings are 45–135 days old when they appear." },
  { id: "congress", label: "House + Senate", covers: ["congress"], everyMs: 15 * MIN, maxMs: 2 * HOUR, precision: "day", source: "House Clerk PTR index + PDFs · Senate eFD PTRs", publishes: "In batches on business days with a filed date only; trades may be filed up to 45 days after the trade." },
  { id: "contracts", label: "Gov contracts", covers: ["contracts"], everyMs: HOUR, maxMs: 6 * HOUR, precision: "none", source: "USAspending.gov prime contract transactions (parents in data/tickers.json)", publishes: "No publish time per action; civilian actions post within days, DoD actions about 90 days after award." },
  { id: "lobbying", label: "Lobbying", covers: ["lobbying"], everyMs: HOUR, maxMs: 6 * HOUR, precision: "day", source: "LDA.gov filings API (clients in data/tickers.json)", publishes: "Quarterly LD-2 reports, due 20 days after quarter end; posted date only.", needs: "LDA_API_KEY" },
  { id: "news", label: "News", covers: ["news"], everyMs: 3 * MIN, maxMs: 30 * MIN, precision: "time", source: "Yahoo Finance per-ticker headline RSS", publishes: "Continuously; Yahoo's pubDate is to the second and its ticker tagging is Yahoo's own." }
];

const BY_ID = new Map(LIVE_CHECKS.map((c) => [c.id, c]));
export const checkOf = (id) => BY_ID.get(id) || null;

/** Which check finds events of a shared/watchlist.mjs source. */
export function checkFor(source) {
  return LIVE_CHECKS.find((c) => c.covers.includes(source)) || null;
}

/**
 * Wait before the next run: the check's interval after a success; after `failures` in a row, doubling up to `maxMs`.
 * An upstream Retry-After (429/503) is honoured when it is longer.
 */
export function nextDelay(check, failures = 0, retryAfterMs = 0) {
  const base = failures > 0 ? Math.min(check.everyMs * 2 ** failures, check.maxMs) : check.everyMs;
  return Math.max(base, Number(retryAfterMs) || 0);
}

const msOf = (v) => {
  if (!v) return NaN;
  if (typeof v === "number") return v;
  const s = String(v);
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
};
const hasTime = (v) => /T\d{2}:\d{2}/.test(String(v || ""));

/** "42s", "3m 12s", "4h 5m", "2d 3h". */
export function durationLabel(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 ? ` ${s % 60}s` : ""}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? ` ${h % 24}h` : ""}`;
}

/** New York calendar date of an instant. */
function nyDay(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/**
 * Detection lag for one event: `{ ms, days, precision, label }`. With a publish time it is detected − published; with
 * a publish date only it is whole New York days; without any publish date it is days since the event date.
 */
export function detectionLag(ev, detectedAt, backfill = false) {
  const det = msOf(detectedAt);
  if (backfill) return { ms: null, days: null, precision: "backfill", label: "already on file when the ticker was added" };
  if (!Number.isFinite(det)) return { ms: null, days: null, precision: "none", label: "" };
  const pub = ev.publishedAt;
  if (pub && hasTime(pub) && Number.isFinite(msOf(pub))) {
    const ms = Math.max(0, det - msOf(pub));
    return { ms, days: null, precision: "time", label: `detected ${durationLabel(ms)} after it was published` };
  }
  if (pub && Number.isFinite(msOf(pub))) {
    const days = Math.round((msOf(nyDay(det)) - msOf(String(pub).slice(0, 10))) / DAY_MS);
    return { ms: null, days, precision: "day", label: days <= 0 ? "detected the day it was dated (the source gives a date, not a time)" : `detected ${days}d after its posted date (the source gives a date, not a time)` };
  }
  if (ev.eventAt && Number.isFinite(msOf(ev.eventAt))) {
    const days = Math.round((msOf(nyDay(det)) - msOf(String(ev.eventAt).slice(0, 10))) / DAY_MS);
    return { ms: null, days, precision: "none", label: `no publish date from the source; detected ${days}d after the event date` };
  }
  return { ms: null, days: null, precision: "none", label: "no publish date from the source" };
}

/** Slack for upstream indexing delay: a record published this long before the ticker was primed may still be new. */
const PREDATE_SLACK = { time: HOUR, day: 2 * DAY_MS };

/**
 * True when an event was already public before its (ticker, check) pair finished its first pass, so it is backfill
 * even if a later pass is the first to read it (e.g. older Form 4s beyond one pass's parse budget). Sources without a
 * publish date ("none") cannot tell and are never treated as predating.
 */
export function predatesWatch(ev, primedAt, precision) {
  const slack = PREDATE_SLACK[precision];
  const pub = msOf(ev?.publishedAt);
  if (!slack || !Number.isFinite(pub) || !Number.isFinite(msOf(primedAt))) return false;
  return pub < msOf(primedAt) - slack;
}

const LAG_WORDS = {
  congress: "after the trade",
  insiders: "after the trade",
  whales: "after quarter end",
  stakes: "after the event",
  filings: "after the event",
  lobbying: "after the period ended"
};

/** "filed 12d after the trade", or "" when the source has no separate event and publish dates. */
export function filingLagLabel(ev) {
  if (ev.lag == null || !LAG_WORDS[ev.source]) return "";
  const verb = ev.source === "lobbying" ? "posted" : "filed";
  return `${verb} ${ev.lag}d ${LAG_WORDS[ev.source]}`;
}

const KIND = { congress: "symbol-trade", insiders: "form4", whales: "whale", stakes: "stake", contracts: "contract", lobbying: "lobbying", filings: "8-k", news: "news" };
const PREFIX = { congress: "", insiders: "Form 4", whales: "13F", stakes: "", contracts: "Contract", lobbying: "Lobbying", filings: "", news: "News" };
const HONOR = { senate: "Sen.", house: "Rep." };

function severityOf(ev, kind) {
  if (ev.simulated) return ev.severity || "elevated";
  switch (kind) {
    case "symbol-trade": return alertSeverity({ kind, lag: ev.lag, amountLow: ev.amount, late: ev.late, buy: ev.side === "buy" });
    case "form4": return alertSeverity({ kind, value: ev.amount, planned: ev.planned, buy: (ev.buys || 0) > 0 });
    case "lobbying": return alertSeverity({ kind, amount: ev.amount });
    case "news": return "routine";
    default: return alertSeverity({ kind, amount: ev.amount, value: ev.amount, activist: ev.activist, change: ev.change, items: ev.items });
  }
}

function titleOf(ev, kind) {
  if (kind === "symbol-trade") {
    const verb = ev.side === "buy" ? "bought" : ev.side === "sell" ? "sold" : "traded";
    return `${HONOR[ev.chamber] ? `${HONOR[ev.chamber]} ` : ""}${ev.who} ${verb} ${amountShort(ev.amountLabel)} ${ev.symbol}`.replace(/\s+/g, " ").trim();
  }
  if (kind === "8-k" || kind === "stake") return `${ev.symbol} · ${ev.title}`;
  return `${PREFIX[ev.source] ? `${PREFIX[ev.source]} · ` : ""}${ev.symbol} · ${ev.title}`;
}

/**
 * The alert row a detection adds to the one Alerts system (same fields as server/alerts.mjs rows) plus `live`:
 * event, published and detected times and both latency labels.
 */
export function liveAlertRow(ev, { detectedAt, backfill = false, seq = 0 } = {}) {
  const kind = ev.simulated ? ev.kind || KIND[ev.source] : KIND[ev.source] || ev.source;
  const det = detectionLag(ev, detectedAt, backfill);
  const filing = filingLagLabel(ev);
  const published = ev.publishedAt || "";
  return {
    id: ev.id,
    kind,
    date: String(published || ev.eventAt || detectedAt || "").slice(0, 10),
    at: detectedAt ? new Date(msOf(detectedAt)).toISOString() : "",
    title: `${ev.simulated ? "TEST · " : ""}${titleOf(ev, kind)}`,
    detail: [ev.detail, filing, det.label].filter(Boolean).join(" · "),
    link: ev.link || "",
    action: `pos:${ev.symbol}`,
    late: Boolean(ev.late),
    severity: severityOf(ev, kind),
    source: ev.feed || "",
    pins: [{ kind: "symbol", id: ev.symbol, label: ev.symbol }],
    live: {
      seq,
      symbol: ev.symbol,
      source: ev.source,
      eventAt: ev.eventAt || "",
      publishedAt: published,
      detectedAt: detectedAt ? new Date(msOf(detectedAt)).toISOString() : "",
      filingLagDays: ev.lag ?? null,
      filingLag: filing,
      detectionLagMs: det.ms,
      detectionLagDays: det.days,
      detection: det.label,
      precision: det.precision,
      backfill,
      simulated: Boolean(ev.simulated)
    }
  };
}

/** Lower-cased words of a headline, first 80 characters: two wires carrying one story collapse to one key. */
export function headlineKey(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}

/** One item per headline key, earliest publish time kept (a later re-post is not news). */
export function dedupeHeadlines(items) {
  const best = new Map();
  for (const it of items || []) {
    const key = headlineKey(it.title);
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || (msOf(it.published) || Infinity) < (msOf(prev.published) || Infinity)) best.set(key, it);
  }
  return [...best.values()];
}

/** Short stable hash for ids built from text. */
export function textHash(value) {
  let h = 0;
  for (const ch of String(value)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

/** How a check looks right now: "off" (needs a key), "failing", "late" (missed its slot by 2 intervals), "ok" or "waiting". */
export function checkHealth(status, now = Date.now()) {
  if (!status) return "waiting";
  if (status.off) return "off";
  if (status.failures > 0) return "failing";
  if (!status.lastOk) return "waiting";
  const check = checkOf(status.id);
  if (check && now - msOf(status.lastOk) > 3 * check.everyMs + 5 * MIN) return "late";
  return "ok";
}
