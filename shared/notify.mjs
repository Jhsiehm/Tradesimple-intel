/**
 * Pure rules for phone notifications through ntfy (https://ntfy.sh): settings from env plus saved overrides, which
 * alert rows qualify (minimum severity, per-kind toggles, quiet hours in New York time), the message text, priority
 * and tags, and the masked topic the browser is allowed to see. The env object is passed in; nothing here reads it.
 */
import { ageLine, tradeAge } from "./tradeAge.mjs";

export const NOTIFY_LEVELS = ["high", "elevated", "routine"];

/** Toggle groups shown in the settings panel; each covers one or more alert kinds. */
export const NOTIFY_KINDS = [
  { key: "congress", label: "Congress trades", kinds: ["symbol-trade", "member-trade"], on: true },
  { key: "form4", label: "Form 4 insiders", kinds: ["form4"], on: true },
  { key: "8-k", label: "8-K material events", kinds: ["8-k"], on: true },
  { key: "stake", label: "13D/13G stakes", kinds: ["stake"], on: true },
  { key: "whale", label: "13F funds", kinds: ["whale"], on: true },
  { key: "contract", label: "Gov contracts", kinds: ["contract"], on: true },
  { key: "lobbying", label: "Lobbying", kinds: ["lobbying"], on: true },
  { key: "research", label: "Scheduled research", kinds: ["research"], on: true },
  { key: "late-filing", label: "Late filings (all members)", kinds: ["late-filing"], on: false },
  { key: "news", label: "News headlines", kinds: ["news"], on: false }
];

const GROUP_OF = new Map(NOTIFY_KINDS.flatMap((g) => g.kinds.map((k) => [k, g.key])));
export const kindGroup = (kind) => GROUP_OF.get(kind) || "";

/** ntfy priorities: 5 max, 4 high, 3 default, 2 low, 1 min. HIGH does not use 5, which overrides Do Not Disturb. */
export const PRIORITY = { high: 4, elevated: 3, routine: 2 };
const TAGS = { high: "rotating_light", elevated: "warning", routine: "information_source" };

export const DEFAULT_SERVER = "https://ntfy.sh";
export const DEFAULT_MAX_PER_HOUR = 20;

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "22:00-07:00" → { start: 1320, end: 420 } (minutes after midnight, New York); null when empty or malformed. */
export function parseQuiet(raw) {
  const m = /^\s*(\S+)\s*-\s*(\S+)\s*$/.exec(String(raw || ""));
  if (!m) return null;
  const a = HHMM.exec(m[1]);
  const b = HHMM.exec(m[2]);
  if (!a || !b) return null;
  const start = Number(a[1]) * 60 + Number(a[2]);
  const end = Number(b[1]) * 60 + Number(b[2]);
  return start === end ? null : { start, end };
}

export const quietLabel = (q) => (q ? `${fmt(q.start)}–${fmt(q.end)} ET` : "");
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Minutes after midnight in New York at `now`. */
export function nyMinutes(now) {
  const parts = Object.fromEntries(nyClock.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

/** Whether `now` is inside the quiet window (which may wrap midnight). */
export function inQuiet(now, quiet) {
  if (!quiet) return false;
  const m = nyMinutes(now);
  return quiet.start < quiet.end ? m >= quiet.start && m < quiet.end : m >= quiet.start || m < quiet.end;
}

const level = (v, fallback) => (NOTIFY_LEVELS.includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : fallback);
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Server settings from env: `topic` (secret), `server`, `token` presence, `minSeverity` (NTFY_MIN_SEVERITY, default
 * elevated), `kinds` (NTFY_KINDS, comma list of NOTIFY_KINDS keys; default every group that is on), `quiet`
 * (NTFY_QUIET "22:00-07:00", New York), `quietHigh` (NTFY_QUIET_HIGH=0 also holds HIGH), `maxPerHour`, `clickUrl`
 * (NTFY_CLICK_URL, else PUBLIC_ORIGIN, else PUBLIC_URL; empty means no click link).
 */
export function envSettings(env = {}) {
  const kinds = list(env.NTFY_KINDS).filter((k) => NOTIFY_KINDS.some((g) => g.key === k));
  const click = String(env.NTFY_CLICK_URL || env.PUBLIC_ORIGIN || env.PUBLIC_URL || "").trim();
  return {
    topic: String(env.NTFY_TOPIC || "").trim(),
    server: String(env.NTFY_SERVER || DEFAULT_SERVER).trim().replace(/\/+$/, ""),
    token: Boolean(String(env.NTFY_TOKEN || "").trim()),
    minSeverity: level(env.NTFY_MIN_SEVERITY, "elevated"),
    kinds: kinds.length ? kinds : NOTIFY_KINDS.filter((g) => g.on).map((g) => g.key),
    quiet: parseQuiet(env.NTFY_QUIET),
    quietHigh: !["0", "false", "off"].includes(String(env.NTFY_QUIET_HIGH || "").toLowerCase()),
    maxPerHour: Math.max(1, Math.min(200, Number(env.NTFY_MAX_PER_HOUR) || DEFAULT_MAX_PER_HOUR)),
    clickUrl: /^https?:\/\//.test(click) ? click.replace(/\/+$/, "") : ""
  };
}

/**
 * Env settings with the user's saved choices (from the Alerts menu) on top. `enabled` defaults to on once a topic is
 * set. Unknown or malformed saved fields are ignored.
 */
export function mergeSettings(base, saved = {}) {
  const s = saved || {};
  const kinds = Array.isArray(s.kinds) ? s.kinds.filter((k) => NOTIFY_KINDS.some((g) => g.key === k)) : null;
  return {
    ...base,
    enabled: s.enabled == null ? Boolean(base.topic) : Boolean(s.enabled) && Boolean(base.topic),
    minSeverity: level(s.minSeverity, base.minSeverity),
    kinds: kinds || base.kinds,
    quiet: s.quiet === "" ? null : s.quiet != null ? parseQuiet(s.quiet) || base.quiet : base.quiet,
    quietHigh: s.quietHigh == null ? base.quietHigh : Boolean(s.quietHigh)
  };
}

/** Only what the browser may see: the topic masked, the token as a flag. */
export function publicSettings(s) {
  return {
    configured: Boolean(s.topic),
    enabled: Boolean(s.enabled),
    topic: maskTopic(s.topic),
    server: s.server,
    token: s.token,
    minSeverity: s.minSeverity,
    kinds: s.kinds,
    quiet: s.quiet ? `${fmt(s.quiet.start)}-${fmt(s.quiet.end)}` : "",
    quietHigh: s.quietHigh,
    maxPerHour: s.maxPerHour,
    clickUrl: Boolean(s.clickUrl)
  };
}

/** "tsi-k3…9q" (first four and last two characters); short topics show only a mask. */
export function maskTopic(topic) {
  const t = String(topic || "");
  if (!t) return "";
  if (t.length < 10) return "•".repeat(6);
  return `${t.slice(0, 4)}…${t.slice(-2)}`;
}

/** A hard-to-guess topic from random bytes (hex or any string of them): "tsi-" + 24 lower-case base-36 characters. */
export function topicFrom(bytes) {
  const arr = Array.from(bytes || []);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return `tsi-${arr.slice(0, 24).map((b) => chars[b % 36]).join("")}`;
}

/** `{ send, why }` for one alert row under `settings` at `now`. */
export function shouldNotify(row, settings, now = Date.now()) {
  if (!settings?.topic) return { send: false, why: "no NTFY_TOPIC" };
  if (!settings.enabled) return { send: false, why: "phone notifications are off" };
  if (!row?.id) return { send: false, why: "no id" };
  if (row.live?.backfill) return { send: false, why: "backfill" };
  const sev = level(row.severity, "routine");
  if (NOTIFY_LEVELS.indexOf(sev) > NOTIFY_LEVELS.indexOf(settings.minSeverity)) return { send: false, why: `below ${settings.minSeverity}` };
  const group = kindGroup(row.kind);
  if (!group || !settings.kinds.includes(group)) return { send: false, why: `${row.kind} is switched off` };
  if (inQuiet(now, settings.quiet) && !(sev === "high" && settings.quietHigh)) return { send: false, why: "quiet hours" };
  return { send: true, why: "" };
}

const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ""));

/**
 * The ntfy message for an alert row: `{ title, message, priority, tags, click, actions }`. The body carries the
 * ticker, who and what (the row title), traded and filed ages, filing lag and detection latency, and the source.
 */
export function buildMessage(row, { clickUrl = "", now = Date.now(), suppressed = 0 } = {}) {
  const sev = level(row.severity, "routine");
  const symbol = row.live?.symbol || row.pins?.find((p) => p.kind === "symbol")?.id || "";
  const age = row.age || tradeAge({ kind: row.kind, eventAt: row.eventAt || row.live?.eventAt || "", filedAt: row.filedAt || row.live?.publishedAt || row.date || "" }, now);
  const lines = [
    clip(row.title, 160),
    ageLine(age, now),
    row.live?.detection ? clip(row.live.detection, 120) : "",
    row.source ? `Source: ${clip(row.source, 80)}` : "",
    suppressed > 0 ? `+${suppressed} more alert${suppressed === 1 ? "" : "s"} held by the hourly limit` : ""
  ].filter(Boolean);
  return {
    title: clip(`${sev.toUpperCase()}${symbol ? ` · ${symbol}` : ""} · ${KIND_LABEL[row.kind] || row.kind}`, 120),
    message: lines.join("\n"),
    priority: PRIORITY[sev],
    tags: [TAGS[sev], ...(symbol ? [symbol.toLowerCase()] : [])],
    click: clickUrl ? `${clickUrl}/` : "",
    actions: /^https:\/\//.test(row.link || "") ? [{ action: "view", label: "Open filing", url: row.link, clear: true }] : []
  };
}

const KIND_LABEL = {
  "symbol-trade": "Congress trade",
  "member-trade": "Congress trade",
  "late-filing": "Late filing",
  form4: "Form 4",
  "8-k": "8-K",
  stake: "13D/G",
  whale: "13F",
  contract: "Contract",
  lobbying: "Lobbying",
  news: "News",
  research: "Research"
};

/** Sliding-window limiter state: send times (ms) within the last hour. */
export function underLimit(sentTimes, maxPerHour, now = Date.now()) {
  const recent = (sentTimes || []).filter((t) => now - t < 60 * 60 * 1000);
  return { ok: recent.length < maxPerHour, recent };
}
