/**
 * Scheduled research tasks, pure. Schedule math in US Eastern time (DST-aware through Intl), the boot catch-up rule,
 * "every morning at 8 …" parsing, task cleaning, and the summary and severity a run posts to Alerts.
 * Times are epoch milliseconds; nothing here reads the clock, env, or network.
 */
import { cleanSpec, describeSpec } from "./backtestSpec.mjs";
import { buildSpec, questionHints, wantsBacktest } from "./backtestAsk.mjs";

export const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];
export const TASK_LIMITS = { title: 80, prompt: 800, specs: 4, tickers: 40, perUser: 30 };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });

/** Wall-clock parts in New York at `ms`: y, m (1-12), d, hh, mm, wd (0 = Sunday), date (YYYY-MM-DD). */
export function etParts(ms) {
  const p = Object.fromEntries(ET.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const out = { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute), wd: WEEKDAYS.indexOf(p.weekday) };
  return { ...out, date: `${p.year}-${p.month}-${p.day}` };
}

/**
 * The instant New York reads y-m-d hh:mm. A time skipped by spring-forward (2:30 on the March change) lands on the
 * same minutes after the jump (3:30 EDT); a time read twice in November is its first reading (EDT).
 */
export function etToUtc(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const exact = [4, 5].map((h) => guess + h * HOUR_MS).filter((t) => {
    const p = etParts(t);
    return p.d === d && p.hh === hh && p.mm === mm;
  });
  return exact.length ? Math.min(...exact) : guess + 5 * HOUR_MS;
}

const weekend = (wd) => wd === 0 || wd === 6;
const dayOfWeek = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const shiftDay = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** `{ kind: "daily", time: "HH:MM", weekdays }` or `{ kind: "hours", hours: 1|2|3|4|6|8|12, weekdays }`, or an error. */
export function cleanSchedule(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "schedule is required." };
  const weekdays = raw.weekdays === true;
  if (raw.kind === "daily") {
    const m = String(raw.time || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: "time must be HH:MM (24-hour, Eastern)." };
    return { ok: true, schedule: { kind: "daily", time: `${m[1].padStart(2, "0")}:${m[2]}`, weekdays } };
  }
  if (raw.kind === "hours" || raw.kind === "hourly") {
    const hours = raw.kind === "hourly" ? 1 : Number(raw.hours);
    if (!HOUR_STEPS.includes(hours)) return { ok: false, error: `hours must be one of ${HOUR_STEPS.join(", ")} (so runs land on the same clock hours every day).` };
    return { ok: true, schedule: { kind: "hours", hours, weekdays } };
  }
  return { ok: false, error: "schedule.kind must be daily or hours." };
}

/** The first scheduled instant strictly after `after`. Hour steps run on ET clock hours divisible by the step. */
export function nextRunAfter(schedule, after) {
  if (schedule.kind === "daily") {
    const [hh, mm] = schedule.time.split(":").map(Number);
    const start = etParts(after).date;
    for (let i = 0; i < 9; i++) {
      const day = shiftDay(start, i);
      if (schedule.weekdays && weekend(dayOfWeek(day))) continue;
      const [y, m, d] = day.split("-").map(Number);
      const t = etToUtc(y, m, d, hh, mm);
      if (t > after) return t;
    }
    return null;
  }
  const step = schedule.hours || 1;
  for (let t = Math.floor(after / HOUR_MS) * HOUR_MS + HOUR_MS, n = 0; n < 24 * 9; t += HOUR_MS, n++) {
    const p = etParts(t);
    if (p.hh % step === 0 && !(schedule.weekdays && weekend(p.wd))) return t;
  }
  return null;
}

/**
 * On boot (or `node --watch` restart): a run that was due while the server was down, or one cut off mid-run, is caught
 * up once, now; any earlier misses are not replayed. Otherwise the persisted next run stands (recomputed if absent).
 */
export function bootPlan({ enabled, schedule, nextRun = null, interrupted = false }, now) {
  if (!enabled) return { catchUp: false, nextRun: null };
  if (interrupted || (nextRun != null && nextRun <= now)) return { catchUp: true, nextRun: now };
  return { catchUp: false, nextRun: nextRun ?? nextRunAfter(schedule, now) };
}

const clock = (time) => {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function describeSchedule(s) {
  if (!s) return "";
  const days = s.weekdays ? "Weekdays" : "Daily";
  if (s.kind === "daily") return `${days} at ${clock(s.time)} ET`;
  const every = s.hours === 1 ? "Every hour" : `Every ${s.hours} hours`;
  return `${every}${s.weekdays ? " on weekdays" : ""} (ET clock)`;
}

/** Runs counted against the daily cap: those started on the same New York date as `now`. */
export function runsToday(startedAt, now) {
  const today = etParts(now).date;
  return startedAt.filter((t) => etParts(t).date === today).length;
}

/* ---------- "every morning at 8, …" ---------- */

const PART_HOUR = { morning: 8, afternoon: 13, evening: 18, night: 21 };
const DAILY = /\b(?:every|each)\s+(?:weekday\s+|business\s+day\s+|trading\s+day\s+)?(morning|afternoon|evening|night|day|weekday|business day|trading day)\b|\bdaily\b|\b(?:on\s+)?weekdays\b|\bmonday (?:through|to|-) friday\b/i;
const HOURS = /\b(?:every|each)\s+(\d{1,2})\s*(?:hours?|hrs?)\b|\bhourly\b|\b(?:every|each)\s+hour\b/i;
const AT = /\bat\s+(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?)(?:\s*(?:et|eastern(?: time)?|ny time))?\b/i;

/** The schedule a sentence asks for and the sentence without it, or null when it asks for none. */
export function parseSchedule(text) {
  const s = String(text || "");
  let rest = s;
  let schedule = null;
  const h = s.match(HOURS);
  const d = s.match(DAILY);
  const weekdays = /\bweekdays?\b|\bbusiness days?\b|\btrading days?\b|\bmonday (?:through|to|-) friday\b/i.test(s);
  if (h) {
    schedule = { kind: "hours", hours: h[1] ? Number(h[1]) : 1, weekdays };
    rest = rest.replace(h[0], " ");
  } else if (d) {
    const part = (d[1] || "").toLowerCase();
    const at = s.match(AT);
    let hh = PART_HOUR[part] ?? 8;
    let mm = 0;
    if (at) {
      if (/noon/i.test(at[1])) hh = 12;
      else if (/midnight/i.test(at[1])) hh = 0;
      else {
        hh = Number(at[2]) % 24;
        mm = Number(at[3] || 0) % 60;
        const mer = (at[4] || "").toLowerCase();
        if (mer.startsWith("p") && hh < 12) hh += 12;
        else if (mer.startsWith("a") && hh === 12) hh = 0;
        else if (!mer && hh < 12 && (["afternoon", "evening", "night"].includes(part) || (hh <= 6 && part !== "morning"))) hh += 12;
      }
      rest = rest.replace(at[0], " ");
    }
    schedule = { kind: "daily", time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, weekdays };
    rest = rest.replace(d[0], " ");
  } else return null;
  rest = rest
    .replace(/\b(?:on\s+)?(?:weekdays?|business days?|trading days?)\b/gi, " ")
    .replace(/\b(?:please|schedule|remind me to|can you|could you)\b/gi, " ")
    .replace(/^\s*(?:run|do|repeat)\s+(?=this\b|that\b|it\b|the same\b)/i, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:–—-]*(?:and\s+|then\s+)?/i, "")
    .replace(/[\s,.;:–—-]+$/g, "")
    .trim();
  const clean = cleanSchedule(schedule);
  return clean.ok ? { schedule: clean.schedule, rest } : { schedule: null, rest, error: clean.error };
}

/** Asks for a recurring run ("every morning", "every 4 hours", "run this daily"), not just a question with "daily" in it. */
export function isScheduleRequest(text) {
  const s = String(text || "");
  return /\b(?:every|each)\s+(?:weekday\s+)?(?:morning|afternoon|evening|night|day|weekday|business day|trading day|hour|\d{1,2}\s*(?:hours?|hrs?))\b/i.test(s)
    || /\b(?:run|check|do|repeat|schedule|send|post|rerun|re-run)\b[^.?!]*\b(?:daily|hourly|on weekdays)\b/i.test(s)
    || /^\s*(?:daily|hourly|weekdays)\b/i.test(s);
}

const BACK_REF = /^(?:run\s+)?(?:this|that|it|the same(?: thing| one)?|again|this (?:backtest|question|one|answer|search)|that (?:backtest|question|one|answer|search))?$/i;

/**
 * A task draft from an Ask question such as "every morning at 8, check new insider buys on my watchlist and backtest them".
 * "Run this every morning" reuses the previous backtest specs (`priors`) or the last question. Backtests become specs
 * (no model call when they run); anything else is a prompt for Ask. null when the question schedules nothing.
 */
export function draftFromQuestion({ question, today, prefs = null, priors = [], lastQuestion = "" }) {
  if (!isScheduleRequest(question)) return null;
  const parsed = parseSchedule(question);
  if (!parsed) return null;
  if (!parsed.schedule) return { ok: false, error: parsed.error };
  const rest = parsed.rest;
  const base = { schedule: parsed.schedule, enabled: true, thresholds: { excessPct: null, newSignals: null } };
  if (BACK_REF.test(rest)) {
    if (priors.length) return { ok: true, draft: { ...base, kind: "backtest", title: titleOf(describeSpec(priors.at(-1))), prompt: "", specs: priors.slice(-TASK_LIMITS.specs), window: null, useWatchlist: false } };
    if (lastQuestion) return { ok: true, draft: { ...base, kind: "prompt", title: titleOf(lastQuestion), prompt: lastQuestion.slice(0, TASK_LIMITS.prompt), specs: [], window: null, useWatchlist: false } };
    return { ok: false, error: "Say what to run on that schedule, or ask a question first and then say “run this every morning”." };
  }
  const useWatchlist = /\b(?:my )?watch ?list\b|\bwatched\b|\bmy (?:tickers|stocks)\b/i.test(rest);
  if (!wantsBacktest(rest)) return { ok: true, draft: { ...base, kind: "prompt", title: titleOf(rest), prompt: rest.slice(0, TASK_LIMITS.prompt), specs: [], window: null, useWatchlist } };
  const hints = questionHints(rest, today);
  const fixedTo = hints.fields["filters.to"] === today && hints.fields["filters.from"];
  const win = /\bnew\b|\bsince (?:the )?last (?:run|time|check)\b|\blatest\b/i.test(rest)
    ? { sinceLast: true, days: 30 }
    : fixedTo ? { sinceLast: false, days: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fixedTo}T00:00:00Z`)) / DAY_MS) } : null;
  const specs = hints.sources.slice(0, TASK_LIMITS.specs).map((source) => {
    const built = buildSpec({ question: rest, today, prefs }).spec;
    return win ? { ...built, source, rules: { ...built.rules, openTrades: "mark" } } : { ...built, source };
  });
  return { ok: true, draft: { ...base, kind: "backtest", title: titleOf(rest), prompt: rest.slice(0, TASK_LIMITS.prompt), specs, window: win, useWatchlist } };
}

const titleOf = (s) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, TASK_LIMITS.title) || "Research task";
};

/* ---------- create / update bodies ---------- */

const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * `{ ok, task }` from a POST body: kind, title, prompt or specs, schedule, enabled, thresholds, window, and the
 * watchlist snapshot. `useWatchlist` puts the snapshot's tickers on every spec now; the task keeps them as sent.
 */
export function cleanTaskInput(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "JSON body required." };
  const kind = raw.kind === "backtest" ? "backtest" : raw.kind === "prompt" ? "prompt" : "";
  if (!kind) return { ok: false, error: "kind must be backtest or prompt." };
  const sched = cleanSchedule(raw.schedule);
  if (!sched.ok) return sched;
  const prompt = String(raw.prompt || "").replace(/\s+/g, " ").trim().slice(0, TASK_LIMITS.prompt);
  const symbols = [...new Set((Array.isArray(raw.watch?.symbols) ? raw.watch.symbols : []).map((s) => String(s).toUpperCase().trim()).filter((s) => SYMBOL.test(s)))].slice(0, TASK_LIMITS.tickers);
  const useWatchlist = raw.useWatchlist === true;
  if (useWatchlist && !symbols.length) return { ok: false, error: "This task reads your watchlist, and it has no tickers. Star a ticker first." };
  let specs = [];
  if (kind === "backtest") {
    for (const s of (Array.isArray(raw.specs) ? raw.specs : []).slice(0, TASK_LIMITS.specs)) {
      const withWatch = useWatchlist && s && typeof s === "object" ? { ...s, filters: { ...(s.filters || {}), tickers: symbols } } : s;
      const c = cleanSpec(withWatch);
      if (!c.ok) return { ok: false, error: c.error };
      specs.push(c.spec);
    }
    if (!specs.length) return { ok: false, error: "A backtest task needs at least one spec." };
  } else if (!prompt) return { ok: false, error: "A prompt task needs a prompt." };
  const w = raw.window && typeof raw.window === "object" ? raw.window : null;
  const days = num(w?.days);
  const win = w && days != null ? { sinceLast: w.sinceLast === true, days: Math.min(730, Math.max(1, Math.round(days))) } : null;
  const t = raw.thresholds && typeof raw.thresholds === "object" ? raw.thresholds : {};
  return {
    ok: true,
    task: {
      kind,
      title: titleOf(raw.title || prompt || (specs[0] ? describeSpec(specs[0]) : "")),
      prompt,
      specs,
      window: kind === "backtest" ? win : null,
      schedule: sched.schedule,
      enabled: raw.enabled !== false,
      thresholds: { excessPct: num(t.excessPct), newSignals: num(t.newSignals) == null ? null : Math.max(1, Math.round(num(t.newSignals))) },
      watch: useWatchlist ? { symbols } : null
    }
  };
}

/** Fields a PATCH may change: enabled, title, schedule, thresholds. */
export function cleanTaskPatch(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "JSON body required." };
  const out = {};
  if ("enabled" in raw) out.enabled = raw.enabled === true;
  if ("title" in raw) out.title = titleOf(raw.title);
  if ("schedule" in raw) {
    const s = cleanSchedule(raw.schedule);
    if (!s.ok) return s;
    out.schedule = s.schedule;
  }
  if ("thresholds" in raw) {
    const t = raw.thresholds && typeof raw.thresholds === "object" ? raw.thresholds : {};
    out.thresholds = { excessPct: num(t.excessPct), newSignals: num(t.newSignals) == null ? null : Math.max(1, Math.round(num(t.newSignals))) };
  }
  if (!Object.keys(out).length) return { ok: false, error: "Nothing to change: send enabled, title, schedule, or thresholds." };
  return { ok: true, patch: out };
}

/** The spec a run uses: a rolling window (or since the last run) is applied to the public-date filter. */
export function specForRun(spec, win, { today, lastRunDay = "" }) {
  if (!win) return spec;
  const from = win.sinceLast && lastRunDay ? lastRunDay : shiftDay(today, -win.days);
  return { ...spec, filters: { ...spec.filters, from, to: today } };
}

/* ---------- what a run posts ---------- */

const pts = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`);

/** Signals in this run that the previous run of the same task did not have (null on the first run). */
export function newSignalCount(ids, prevIds) {
  if (!Array.isArray(prevIds)) return null;
  const seen = new Set(prevIds);
  return ids.filter((id) => !seen.has(id)).length;
}

/** One line of key figures for a backtest run. */
export function backtestSummary(run, fresh = null) {
  const s = run?.stats;
  const bench = run?.spec?.rules?.benchmark === "SECTOR" ? "sector ETFs" : run?.spec?.rules?.benchmark || "benchmark";
  const signals = fresh == null ? "" : ` · ${fresh} new signal${fresh === 1 ? "" : "s"} since the last run`;
  if (!s) return `No priced trades · ${run?.counts?.matched ?? run?.counts?.signals ?? 0} signals matched${signals}`;
  return `Excess ${pts(s.excessTotal)} vs ${bench} · strategy ${pts(s.total)} · ${s.trades} trade${s.trades === 1 ? "" : "s"} · hit ${s.hitRate == null ? "—" : `${Math.round(s.hitRate * 100)}%`}${signals}`;
}

/**
 * Alert level for a run: ROUTINE unless a threshold the user set is crossed (excess return in percentage points, or
 * new signals since the last run), then ELEVATED. Failures and skips are ROUTINE with the reason in the title.
 */
export function researchSeverity({ excess = null, fresh = null }, thresholds = {}) {
  const why = [];
  if (thresholds.excessPct != null && excess != null && excess * 100 >= thresholds.excessPct) why.push(`excess ${pts(excess)} ≥ ${thresholds.excessPct}%`);
  if (thresholds.newSignals != null && fresh != null && fresh >= thresholds.newSignals) why.push(`${fresh} new signals ≥ ${thresholds.newSignals}`);
  return { severity: why.length ? "elevated" : "routine", why };
}

export const RESEARCH_RULE = "Scheduled research is ROUTINE unless a threshold you set on the task is crossed (excess return, or new signals since the last run); then ELEVATED.";
