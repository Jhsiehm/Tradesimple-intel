import { useState } from "react";
import { describeSchedule, HOUR_STEPS, type TaskDraft, type TaskSchedule } from "../../shared/taskSchedule.mjs";
import type { Turn } from "../ask/types";
import { DEMO } from "../lib/api";
import { useWatch } from "../lib/useWatch";
import { createTask } from "./api";
import "./tasks.css";

type Mode = "daily" | "weekdays" | "hours";

/** The draft an answer schedules: its backtests as fixed specs (no model call), else its question as an Ask prompt. */
function draftOf(turn: Turn): TaskDraft | null {
  const proposed = turn.done?.task;
  if (proposed) return proposed;
  const bts = (turn.done?.backtests || []).filter((b) => b.ok).slice(-4);
  const base = { enabled: true, thresholds: { excessPct: null, newSignals: null }, window: null, schedule: { kind: "daily", time: "08:00", weekdays: true } as TaskSchedule };
  if (bts.length) return { ...base, kind: "backtest", title: turn.question.slice(0, 80), prompt: turn.question, specs: bts.map((b) => b.spec) };
  return { ...base, kind: "prompt", title: turn.question.slice(0, 80), prompt: turn.question, specs: [] };
}

const modeOf = (s: TaskSchedule): Mode => (s.kind === "hours" ? "hours" : s.weekdays ? "weekdays" : "daily");

/** "Run this every…" under an answer: a small schedule picker that saves a task whose results post to Alerts. */
export function ScheduleControl({ turn }: { turn: Turn }) {
  const draft = turn.phase === "done" && !turn.done?.greeting && !turn.done?.clarify && !turn.notes[0]?.startsWith("Scheduled task") ? draftOf(turn) : null;
  if (!draft || DEMO) return null;
  return <Picker draft={draft} proposed={Boolean(turn.done?.task)} />;
}

function Picker({ draft, proposed }: { draft: TaskDraft; proposed: boolean }) {
  const { watch } = useWatch();
  const [open, setOpen] = useState(proposed);
  const [mode, setMode] = useState<Mode>(() => modeOf(draft.schedule));
  const [time, setTime] = useState(() => (draft.schedule.kind === "daily" ? draft.schedule.time : "08:00"));
  const [hours, setHours] = useState(() => (draft.schedule.kind === "hours" ? draft.schedule.hours : 4));
  const [excess, setExcess] = useState("");
  const [state, setState] = useState<{ phase: "idle" | "saving" | "saved" | "error"; text: string }>({ phase: "idle", text: "" });

  const schedule: TaskSchedule = mode === "hours" ? { kind: "hours", hours, weekdays: false } : { kind: "daily", time, weekdays: mode === "weekdays" };
  const save = async () => {
    setState({ phase: "saving", text: "" });
    const thresholds = { excessPct: excess.trim() === "" ? null : Number(excess), newSignals: null };
    const out = await createTask({ ...draft, schedule, thresholds }, watch.symbols).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : "Failed." }));
    setState(out.ok ? { phase: "saved", text: `Scheduled · ${describeSchedule(schedule)}. Results post to Alerts; manage it under Scheduled.` } : { phase: "error", text: out.error || "Could not save the task." });
  };

  if (state.phase === "saved") return <p className="tk-saved">{state.text}</p>;
  if (!open) {
    return (
      <p className="tk-cta">
        <button type="button" className="link" onClick={() => setOpen(true)}>Run this every…</button>
        <small>{draft.kind === "backtest" ? "replays the backtest on a schedule, no model call" : "asks again on a schedule (one model call per run)"}</small>
      </p>
    );
  }
  return (
    <form className="tk-pick" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label="Schedule this">
      <span className="tk-pick-what">{draft.kind === "backtest" ? `${draft.specs.length} backtest${draft.specs.length === 1 ? "" : "s"}` : "Ask prompt"}{draft.useWatchlist ? ` · your ${watch.symbols.length} watched tickers` : ""}</span>
      <select aria-label="How often" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
        <option value="weekdays">Weekdays</option>
        <option value="daily">Every day</option>
        <option value="hours">Every N hours</option>
      </select>
      {mode === "hours"
        ? <select aria-label="Hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{HOUR_STEPS.map((h) => <option key={h} value={h}>{h === 1 ? "every hour" : `every ${h} h`}</option>)}</select>
        : <label>at <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value || "08:00")} aria-label="Time (ET)" /> ET</label>}
      {draft.kind === "backtest" ? <label title="The alert is ELEVATED when the best run's excess return reaches this">elevate if excess ≥ <input type="number" step="0.5" value={excess} onChange={(e) => setExcess(e.target.value)} placeholder="—" aria-label="Elevate at excess percent" />%</label> : null}
      <button type="submit" className="panels-btn" disabled={state.phase === "saving"}>{proposed ? "Schedule it" : "Save"}</button>
      <button type="button" className="link" onClick={() => setOpen(false)}>Cancel</button>
      {state.phase === "error" ? <p className="ask-fault">{state.text}</p> : null}
    </form>
  );
}
