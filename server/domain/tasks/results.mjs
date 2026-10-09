/**
 * What a scheduled run stores: an Ask turn (the shape src/ask/types.ts `Turn` reads), so Alerts can open the result in
 * the Ask sheet as if it had just been answered, and the alert's title, summary and labels.
 */
import { describeSpec, encodeSpec, SOURCE_LABEL } from "../../../shared/backtestSpec.mjs";
import { backtestSummary, describeSchedule } from "../../../shared/taskSchedule.mjs";
import { stripRefs } from "../../../shared/citations.mjs";

const iso = (ms) => new Date(ms).toISOString();
const MAX_TRADES = 300;
const PREVIEW = 400;

const etStamp = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms)) + " ET";

/** A backtest body small enough to store per run: every field the chat card reads, trades capped (best and worst kept). */
export function slimRun(out) {
  if (!out || out.ok === false || !Array.isArray(out.trades) || out.trades.length <= MAX_TRADES) return out;
  const byRet = [...out.trades].filter((t) => t.ret != null).sort((a, b) => b.ret - a.ret);
  const keep = new Set([...byRet.slice(0, MAX_TRADES / 2), ...byRet.slice(-MAX_TRADES / 4), ...[...out.trades].sort((a, b) => String(a.entry).localeCompare(String(b.entry))).slice(0, MAX_TRADES / 4)]);
  return { ...out, trades: out.trades.filter((t) => keep.has(t)), tradesStored: keep.size, tradesTotal: out.trades.length };
}

const blankDone = (extra) => ({
  answer: "", cited: [], unknown: [], grounding: { checked: 0, unmatched: [], mislabeled: [], miscited: [], uncitedRows: [], scope: [] },
  uncited: false, noTools: false, greeting: false, caveats: [], usage: { tokens: 0, toolCalls: 0 }, ms: 0, stopped: "", model: "",
  theory: null, table: null, retried: false, backtests: [], clarify: false, prefs: null, ...extra
});

export function blankTurn(question, at) {
  return { id: `r${at.toString(36)}`, question, at: iso(at), text: "", steps: [], phase: "planning", notes: [], done: null, clarify: null, error: "", model: "", context: "" };
}

/** `results` are `{ spec, out, ms }` per spec, in order; refs are t1..tN. */
export function backtestTurn(task, results, { startedAt, finishedAt, fresh = [] }) {
  const steps = results.map((r, i) => ({
    id: `t${i + 1}`, tool: "run_backtest", label: `Backtest · ${SOURCE_LABEL[r.spec.source] || r.spec.source}`, args: { spec: r.spec }, phase: "computing",
    at: iso(startedAt), state: r.out?.ok === false ? "error" : "ok", ms: r.ms, rows: r.out?.stats?.trades ?? 0,
    source: r.out?.source || "", asOf: r.out?.asOf || "", latency: r.out?.latency || "", note: r.out?.ok === false ? r.out.error || "" : "",
    open: `bt:token:${encodeSpec(r.spec)}`, requests: ["POST /api/backtest (scheduled, in process)"]
  }));
  const lines = results.map((r, i) => r.out?.ok === false
    ? `- **${SOURCE_LABEL[r.spec.source] || r.spec.source}**: did not run — ${r.out.error || "failed"} [t${i + 1}]`
    : `- **${SOURCE_LABEL[r.spec.source] || r.spec.source}**: ${backtestSummary(r.out, fresh[i] ?? null)} [t${i + 1}]`);
  const answer = [`Scheduled run of “${task.title}” (${describeSchedule(task.schedule)}), ${etStamp(startedAt)}. Research only; nothing was traded.`, "", ...lines].join("\n");
  const backtests = results.map((r, i) => ({
    id: `t${i + 1}`, spec: r.spec, from: {}, diff: [], prior: null, using: describeSpec(r.spec), note: "", ok: r.out?.ok !== false,
    open: steps[i].open, description: describeSpec(r.spec), run: r.out?.ok === false ? undefined : slimRun(r.out)
  }));
  const caveats = results.flatMap((r) => (r.out?.caveats?.items || []).filter((c) => c.level === "warn").map((c) => c.text)).slice(0, 8);
  return {
    ...blankTurn(task.title, startedAt),
    text: answer,
    steps,
    phase: "done",
    notes: [`Scheduled task · ${describeSchedule(task.schedule)} · stored when it ran, not re-run when opened.`],
    done: blankDone({ answer, cited: steps.map((s) => s.id), caveats, usage: { tokens: 0, toolCalls: steps.length }, ms: finishedAt - startedAt, backtests })
  };
}

/** Folds one runAsk event into a turn, as the browser hook does with the same stream. */
export function collectEvent(turn, e) {
  switch (e.type) {
    case "step_start":
      turn.steps.push({ id: String(e.id), tool: String(e.tool), label: String(e.label || e.tool), args: e.args, phase: e.phase || "fetching", at: String(e.at || ""), state: "running", ms: 0, requests: [] });
      break;
    case "step_end": {
      const s = turn.steps.find((x) => x.id === String(e.id));
      if (s) Object.assign(s, { state: e.ok ? "ok" : "error", ms: Number(e.ms) || s.ms, rows: Number(e.rows) || 0, source: String(e.source || ""), asOf: String(e.asOf || ""), latency: String(e.latency || ""), note: String(e.note || ""), open: String(e.open || ""), requests: Array.isArray(e.requests) ? e.requests.slice(0, 4) : s.requests, preview: String(e.preview || "").slice(0, PREVIEW) });
      break;
    }
    case "step_progress":
      if (e.reset) turn.text = "";
      break;
    case "token":
      turn.text += String(e.delta || "");
      break;
    case "plan_note":
      turn.notes.push(String(e.note || ""));
      break;
    case "clarify":
      turn.phase = "error";
      turn.error = "The question needs a choice before it can run; open it in Ask and pick one.";
      break;
    case "done":
      turn.phase = turn.phase === "error" ? "error" : "done";
      turn.text = e.answer || turn.text;
      turn.done = e;
      break;
    case "error":
      turn.phase = "error";
      turn.error = String(e.error || "Ask failed.");
      break;
  }
  return turn;
}

const plain = (s) => stripRefs(s).replace(/[*_`#>|]/g, "").replace(/\s+/g, " ").trim();

/** Alert labels for a finished Ask turn: first sentences of the answer, the feeds its steps cited, the oldest as-of. */
export function promptLabels(turn, { startedAt, finishedAt, model }) {
  const ok = turn.steps.filter((s) => s.state === "ok");
  const sources = [...new Set(ok.map((s) => s.source).filter(Boolean))];
  const asOfs = ok.map((s) => s.asOf).filter(Boolean).sort();
  return {
    summary: plain(turn.text).slice(0, 260) || turn.error || "No answer.",
    source: `${sources.slice(0, 3).join(" · ") || "Ask (no tool data)"}${sources.length > 3 ? ` +${sources.length - 3}` : ""} · answered by ${model}`,
    asOf: asOfs[0] || iso(finishedAt),
    latency: `Ask answer in ${((finishedAt - startedAt) / 1000).toFixed(1)} s from ${ok.length} tool call${ok.length === 1 ? "" : "s"}; each figure's feed latency is on its step.`
  };
}
