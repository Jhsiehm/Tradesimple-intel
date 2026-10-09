import { useState } from "react";
import type { Turn } from "../ask/types";
import { loadResult, removeTask, runNow, setEnabled, type TaskView } from "./api";
import { useTasks } from "./useTasks";
import "./tasks.css";

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
const et = (iso: string | null) => (iso ? `${ET.format(new Date(iso))} ET` : "—");

/** Opens a stored run in the Ask sheet. */
export async function openStored(runId: string, openTurns: (turns: Turn[]) => void) {
  const turn = await loadResult(runId).catch(() => null);
  if (turn) openTurns([turn]);
  return Boolean(turn);
}

/** Scheduled research tasks, compact, inside the Ask sheet's Saved area. Results post to Alerts; each opens here. */
export function ScheduledTasks({ openTurns, active }: { openTurns: (turns: Turn[]) => void; active: boolean }) {
  const { res } = useTasks(active);
  const [fault, setFault] = useState("");
  const [confirm, setConfirm] = useState("");
  const items = res?.items || [];
  const act = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const out = await p.catch((err) => ({ ok: false, error: err instanceof Error ? err.message : "Failed." }));
    setFault(out.ok ? "" : out.error || "Failed.");
  };
  const open = async (t: TaskView) => {
    if (t.last && !(await openStored(t.last.id, openTurns))) setFault("That result is no longer stored.");
  };

  return (
    <details className="ask-tasks" open={items.length > 0}>
      <summary>
        Scheduled <small>{items.length ? `${items.length} task${items.length === 1 ? "" : "s"}` : "none"}{res?.budget ? ` · ${res.budget.usedToday}/${res.budget.perDay} runs today` : ""}{res?.scheduler === "off" ? " · scheduler off" : ""}</small>
      </summary>
      {items.length ? (
        <ul>
          {items.map((t) => (
            <li key={t.id} className={t.enabled ? "" : "off"}>
              <p className="tk-head">
                <b title={t.prompt || t.title}>{t.title}</b>
                <label className="tk-toggle" title={t.enabled ? "Pause" : "Resume"}>
                  <input type="checkbox" checked={t.enabled} onChange={() => void act(setEnabled(t.id, !t.enabled))} aria-label={`${t.enabled ? "Pause" : "Resume"} ${t.title}`} />
                </label>
              </p>
              <p className="tk-meta">
                {t.every} · {t.kind === "backtest" ? "backtest, no model call" : "Ask prompt"}{t.watch ? ` · ${t.watch.symbols.length} watched tickers` : ""}
                <br />
                {t.running ? <span className="tk-running"><span className="st-spin" aria-hidden /> running</span> : <>next {t.enabled ? et(t.nextRun) : "paused"}</>}
              </p>
              {t.last ? (
                <button type="button" className={`tk-last sev-${t.last.severity}${t.last.status === "ok" ? "" : " tk-bad"}`} onClick={() => void open(t)} title={`${t.last.source} · as of ${t.last.asOf}`}>
                  <em>{et(t.last.at)}</em> {t.last.summary}
                </button>
              ) : <p className="tk-meta">No run yet.</p>}
              <p className="tk-actions">
                <button type="button" className="link" disabled={t.running} onClick={() => void act(runNow(t.id))}>Run now</button>
                {confirm === t.id
                  ? <><button type="button" className="link tk-del" onClick={() => { setConfirm(""); void act(removeTask(t.id)); }}>Delete it and its results</button> <button type="button" className="link" onClick={() => setConfirm("")}>Keep</button></>
                  : <button type="button" className="link" disabled={t.running} onClick={() => setConfirm(t.id)}>Delete</button>}
              </p>
            </li>
          ))}
        </ul>
      ) : <p className="ask-note">Press “Run this every…” under an answer, or ask “every weekday at 8, backtest congress buys vs SPY”.</p>}
      {fault ? <p className="ask-fault">{fault}</p> : null}
      {res && !res.ok ? <p className="ask-note">{res.error || "Scheduled tasks unavailable."}</p> : null}
    </details>
  );
}
