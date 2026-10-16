import { useId, useState } from "react";
import { setAdmission, type TaskControl } from "./api";

export function TaskAdmission({ control }: { control: TaskControl }) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");
  const change = async () => {
    setBusy(true); setFault("");
    try {
      const out = await setAdmission(!control.paused, control.revision, reason);
      if (out.ok) setReason("");
      else setFault(out.error || "Could not change task admission. Try again.");
    } catch (error) { setFault(error instanceof Error ? error.message : "Task controls are unavailable. Try again."); }
    finally { setBusy(false); }
  };
  return <section className="tk-admission" aria-label="Task execution controls">
    <p role="status"><strong>{control.paused ? "New task executions paused" : "New task executions allowed"}</strong></p>
    <p>Applies to every scheduled task and Run now. Already admitted work can finish. Resuming allows overdue enabled tasks to run on the next check.</p>
    {control.revision > 0 && <p className="tk-control-record">Last change: {control.reason} · {control.actor} · {control.createdAt && new Date(control.createdAt).toLocaleString()}</p>}
    <form onSubmit={event => { event.preventDefault(); void change(); }}>
      <label htmlFor={reasonId}>Reason for {control.paused ? "resuming" : "pausing"}</label>
      <textarea id={reasonId} value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} rows={2} disabled={busy} />
      <button type="submit" disabled={busy || !reason.trim()}>{busy ? "Saving…" : control.paused ? "Resume new executions" : "Pause new executions"}</button>
    </form>
    <a href="/api/tasks/control" target="_blank" rel="noreferrer">Inspect control history (JSON)</a>
    {fault && <p role="alert" className="ask-fault">{fault}</p>}
  </section>;
}
