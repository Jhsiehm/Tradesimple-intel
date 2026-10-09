/**
 * Pure trade-age rules shared by server/ and src/: how long ago a record was filed and how long ago the trade (or
 * award, or event) it reports happened, the filing lag between the two, a freshness tier on the trade date, and the
 * severity downgrade for trades that are already old by the time they become public.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tiers on whole days since the trade date. A trade older than the last bound is "old". */
export const FRESHNESS = [
  { tier: "fresh", maxDays: 3, label: "FRESH" },
  { tier: "recent", maxDays: 14, label: "RECENT" },
  { tier: "stale", maxDays: 45, label: "STALE" },
  { tier: "old", maxDays: Infinity, label: "OLD" }
];

/** Kinds whose event date is a trade; only these are downgraded by age. */
export const TRADE_KINDS = ["symbol-trade", "member-trade", "form4"];

/** The word for each kind's event date. Kinds without one (news, research) show only the filed age. */
export const EVENT_WORDS = {
  "symbol-trade": "traded",
  "member-trade": "traded",
  "late-filing": "traded",
  form4: "traded",
  contract: "awarded",
  "8-k": "event",
  stake: "event",
  whale: "quarter ended",
  lobbying: "period ended"
};

export const AGE_RULE = "Trade age is days from the transaction date to now (New York calendar). FRESH ≤3 d, RECENT ≤14 d, STALE ≤45 d, OLD >45 d. A Congress trade or Form 4 that is STALE drops one severity level and one that is OLD drops two (never below ROUTINE), so a trade disclosed today but made 38 days ago ranks below an insider buy from yesterday. Late-filing rows keep their level: the lateness is the signal.";

const LEVELS = ["high", "elevated", "routine"];

const isDateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

function msOf(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  const s = String(v);
  return Date.parse(isDateOnly(s) ? `${s}T00:00:00Z` : s);
}

const nyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** New York calendar date (YYYY-MM-DD) of an instant; a date-only string is already one. */
function nyDay(v) {
  if (isDateOnly(v)) return String(v);
  const t = msOf(v);
  return Number.isFinite(t) ? nyFmt.format(new Date(t)) : "";
}

/** Whole New York calendar days from `from` to `to` (both instants or YYYY-MM-DD); null when either is missing. */
export function calendarDays(from, to) {
  const a = nyDay(from);
  const b = nyDay(to);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function freshness(days) {
  if (days == null || !Number.isFinite(days)) return null;
  return FRESHNESS.find((f) => days <= f.maxDays)?.tier || "old";
}

export const freshnessLabel = (tier) => FRESHNESS.find((f) => f.tier === tier)?.label || "";

/**
 * "12m ago", "3h ago", "today", "yesterday", "5d ago", "3mo ago". With a time of day the age is exact up to 48 h;
 * a date-only stamp is counted in New York calendar days. "" when unknown.
 */
export function agoLabel(at, now = Date.now()) {
  const t = msOf(at);
  if (!Number.isFinite(t)) return "";
  if (!isDateOnly(at)) {
    const m = Math.max(0, Math.round((now - t) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    if (m < 48 * 60) return `${Math.floor(m / 60)}h ago`;
  }
  const d = calendarDays(at, now);
  if (d == null) return "";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d}d ago`;
  if (d < 730) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

/**
 * Ages of one record: `filedAt` is when it became public (an instant or a date), `eventAt` the trade / award / event
 * date. `lagDays` is the filing lag (filed − event, calendar days). `tier` is the freshness of the event date.
 */
export function tradeAge({ kind = "", eventAt = "", filedAt = "" } = {}, now = Date.now()) {
  const word = EVENT_WORDS[kind] || "";
  const eventDays = word && eventAt ? calendarDays(eventAt, now) : null;
  const lagDays = word && eventAt && filedAt ? calendarDays(eventAt, filedAt) : null;
  return {
    kind,
    word,
    eventAt: word ? String(eventAt || "") : "",
    filedAt: String(filedAt || ""),
    eventDays: eventDays == null ? null : Math.max(0, eventDays),
    lagDays: lagDays == null ? null : Math.max(0, lagDays),
    tier: TRADE_KINDS.includes(kind) || word ? freshness(eventDays == null ? null : Math.max(0, eventDays)) : null,
    trade: TRADE_KINDS.includes(kind)
  };
}

/** Levels a trade drops for its age: 1 when stale, 2 when old. Non-trade kinds and late-filing rows never drop. */
export function ageSteps(kind, tier) {
  if (!TRADE_KINDS.includes(kind)) return 0;
  return tier === "stale" ? 1 : tier === "old" ? 2 : 0;
}

export function ageSeverity(severity, kind, tier) {
  const i = LEVELS.indexOf(severity);
  if (i < 0) return severity;
  return LEVELS[Math.min(LEVELS.length - 1, i + ageSteps(kind, tier))];
}

/** "filed 2h ago · traded 38d ago · filed 36d after" (the parts that are known). */
export function ageLine(age, now = Date.now()) {
  if (!age) return "";
  const parts = [];
  const filed = agoLabel(age.filedAt, now);
  if (filed) parts.push(`filed ${filed}`);
  const event = age.word && age.eventAt ? agoLabel(age.eventAt, now) : "";
  if (event) parts.push(`${age.word} ${event}`);
  if (age.lagDays != null && age.trade) parts.push(`${age.lagDays}d filing lag`);
  return parts.join(" · ");
}

/**
 * An alert row with `age` attached and its severity aged. The event date comes from `eventAt`, else `live.eventAt`;
 * the public time from `filedAt`, else `live.publishedAt`, else the row date. `baseSeverity` keeps the level before
 * the downgrade when there was one.
 */
export function ageAlert(row, now = Date.now()) {
  if (!row) return row;
  const eventAt = row.eventAt || row.live?.eventAt || "";
  const filedAt = row.filedAt || row.live?.publishedAt || row.date || "";
  const age = tradeAge({ kind: row.kind, eventAt, filedAt }, now);
  const base = row.baseSeverity || row.severity;
  const severity = ageSeverity(base, row.kind, age.tier);
  const { baseSeverity: _, ...rest } = row;
  return { ...rest, age, severity, ...(severity !== base ? { baseSeverity: base } : {}) };
}
