/**
 * What to do with a follow-up on a multi-source backtest turn when no run would change: say exactly which value each
 * previous run already used (and why, when the window set it), or, when the follow-up set no spec field at all, let the
 * model answer it with tools. Pure.
 */
import { SOURCE_LABEL } from "./backtestSpec.mjs";
import { describeValue } from "./backtestAsk.mjs";

const getPath = (obj, path) => {
  const [a, b] = path.split(".");
  return obj?.[a]?.[b];
};

/** Fields the follow-up's own words (or chip picks) set, in any run. */
export const askedFields = (multi) => [...new Set((multi?.runs || []).flatMap((r) => Object.entries(r.from || {}).filter(([, how]) => how === "question" || how === "your pick").map(([p]) => p)))];

const ALTERNATIVES = {
  "rules.holdDays": (v) => [30, 60, 90, 180, 365].filter((d) => d !== v).slice(0, 3).map((d) => `"hold ${d === 365 ? "1 year" : `${d} days`} instead"`),
  "rules.benchmark": (v) => (v === "SECTOR" ? ["\"vs SPY instead\""] : ["\"vs sector ETF instead\""]),
  "rules.sides": (v) => (v === "buy" ? ["\"both sides instead\""] : ["\"buys only instead\""]),
  "rules.sizing": (v) => (v === "equal" ? ["\"weight by size instead\""] : ["\"equal weight instead\""]),
  "rules.entry": (v) => (v === "nextOpen" ? ["\"enter at the next close instead\""] : ["\"enter at the next open instead\""])
};

/** Why a run already had that value, when it was not the user's own earlier pick. */
function whyAlready(path, prior) {
  const from = prior?.filters?.from;
  const to = prior?.filters?.to;
  if (path === "rules.holdDays" && from && to) {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    if (days === getPath(prior, path)) return ` (a "last ${days} days" backtest holds each trade for the window's ${days} days unless told otherwise)`;
  }
  return "";
}

/** What the model is told when a follow-up on several runs set no spec field the app understands. */
export function handOffNote(priors = [], refs = []) {
  return [
    `The previous turn ran ${priors.length} backtests: ${priors.map((p) => `${SOURCE_LABEL[p.source] || p.source} ${JSON.stringify(p)}`).join("; ")}.`,
    refs.length ? `The app re-ran ${refs.length > 1 ? "them" : "it"} unchanged so their figures are here as tool results ${refs.join(", ")}; answer from those, citing refs, and do not call run_backtest again for the same spec.` : "",
    "The app did not find a spec change in this follow-up. Answer the follow-up itself. If it does ask to change the runs, call run_backtest once per source with the changed spec and compare each with its previous run. Every figure needs a ref from this turn."
  ].filter(Boolean).join("\n");
}

/**
 * `{ understood, unchanged, text }` for a multi-source follow-up plan (planFollowUps). `understood` is false when the
 * follow-up set no field at all: the caller should hand the question to the model rather than reply. `text` is the
 * reply when every run is unchanged: the values that already matched, per source, and what to try instead.
 */
export function followUpOutcome(multi) {
  const asked = askedFields(multi);
  const runs = multi?.runs || [];
  const unchanged = runs.length > 0 && runs.every((r) => r.unchanged);
  if (!asked.length) return { understood: false, unchanged, text: "" };
  if (!unchanged) return { understood: true, unchanged: false, text: "" };
  const lines = [];
  const same = new Map();
  for (const r of runs) {
    const matched = asked.filter((p) => r.from?.[p] && JSON.stringify(getPath(r.prior, p)) === JSON.stringify(getPath(r.spec, p)) && (r.locked || []).includes(p));
    for (const p of matched) {
      const key = `${p}=${JSON.stringify(getPath(r.spec, p))}`;
      const entry = same.get(key) || { path: p, value: getPath(r.spec, p), sources: [], why: whyAlready(p, r.prior) };
      entry.sources.push(SOURCE_LABEL[r.spec.source]);
      same.set(key, entry);
    }
  }
  for (const e of same.values()) {
    const who = e.sources.length === runs.length && runs.length > 1 ? `all ${runs.length} previous runs (${e.sources.join(", ")})` : e.sources.join(" and ");
    lines.push(`${describeValue(e.path, e.value).replace(/^./, (c) => c.toUpperCase())} is already what ${who} used${e.why}, so nothing changed and nothing was re-run.`);
  }
  const notes = runs.flatMap((r) => r.notes || []);
  const tries = [...same.values()].flatMap((e) => ALTERNATIVES[e.path]?.(e.value) || []);
  const text = [
    ...lines,
    ...(lines.length ? [] : ["Nothing in the follow-up changes any previous run, so nothing was re-run."]),
    ...notes,
    tries.length ? `To see a different result, try ${tries.slice(0, 3).join(", ")}.` : ""
  ].filter(Boolean).join(" ");
  return { understood: true, unchanged: true, text };
}
