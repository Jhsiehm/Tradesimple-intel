/**
 * The confidence line under an answer, pure: what was priced, what the checks could not verify, how many web pages
 * it leans on, how fresh the data is, and which model wrote it. Counts only; never a made-up percentage.
 */
import { modelShort } from "./modelRoute.mjs";

const WEB = new Set(["web_result", "web_fetch"]);
const NOT_DATA = new Set(["web_result", "web_fetch", "web_search", "propose_theory", "search"]);
const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ET_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const UTC_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "09:46 ET" on the same ET day as `now`, "Oct 8 16:00 ET" before it, "Oct 8" for a date with no time. */
export function asOfText(asOf, now) {
  const s = String(asOf || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return UTC_DATE.format(Date.parse(`${s}T00:00:00Z`));
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  const same = Number.isFinite(now) && ET_DAY.format(t) === ET_DAY.format(now);
  return `${same ? "" : `${ET_DATE.format(t)} `}${ET_TIME.format(t)} ET`;
}

const stamp = (asOf) => {
  const s = String(asOf || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59Z`) : Date.parse(s);
};

/**
 * `{ parts, tone, text }` for one finished turn, or null for greetings, clarifying questions, and turns that did not
 * finish. `steps` are the turn's steps; `done` is the done event (grounding, unknown refs, backtests with counts, model,
 * revision). The oldest as-of among the data steps is the one shown. Amber when a figure is unverified, a claim is
 * unsupported, a row has no ref, or a backtest priced fewer signals than it matched.
 */
export function confidenceLine({ steps = [], done, model = "", now = NaN }) {
  if (!done || done.greeting || done.clarify) return null;
  const g = done.grounding || {};
  const parts = [];
  let warn = false;

  let priced = 0;
  let signals = 0;
  for (const b of done.backtests || []) {
    const c = b?.ok && b.counts ? b.counts : null;
    const total = c ? c.signalsOnChosenSides ?? c.matchedSignals : undefined;
    if (!c || !Number.isFinite(c.tradesPriced) || !Number.isFinite(total)) continue;
    priced += c.tradesPriced;
    signals += total;
  }
  if (signals) {
    parts.push(`Priced ${priced}/${signals} signals`);
    if (priced < signals) warn = true;
  }

  const unverified = (g.unmatched?.length || 0) + (g.miscited?.length || 0) + (g.mislabeled?.length || 0) + (done.unknown?.length || 0);
  if (unverified) parts.push(`${plural(unverified, "figure")} unverified`);
  if (g.scope?.length) parts.push(`${plural(g.scope.length, "claim")} unsupported`);
  if (g.uncitedRows?.length) parts.push(`${plural(g.uncitedRows.length, "row")} without a ref`);
  if (done.noTools) parts.push("no tool data");
  else if (done.uncited) parts.push("no figure cited");
  else if (!unverified && g.checked) parts.push(`${plural(g.checked, "figure")} matched`);
  if (unverified || g.scope?.length || g.uncitedRows?.length || done.uncited || done.noTools) warn = true;

  const ok = steps.filter((s) => s && s.state === "ok");
  const web = ok.filter((s) => WEB.has(s.tool)).length;
  if (web) parts.push(plural(web, "web source"));

  const oldest = ok.filter((s) => !NOT_DATA.has(s.tool) && Number.isFinite(stamp(s.asOf))).sort((a, b) => stamp(a.asOf) - stamp(b.asOf))[0];
  const asOf = oldest ? asOfText(oldest.asOf, now) : "";
  if (asOf) parts.push(`data as of ${asOf}`);

  const name = modelShort(done.model || model);
  const rev = done.revision?.status === "applied" ? modelShort(done.revision.model) : "";
  if (name) parts.push(`model ${name}${rev && rev !== name ? `, revised by ${rev}` : ""}`);
  return { parts, tone: warn ? "amber" : "neutral", text: parts.join(" · ") };
}
