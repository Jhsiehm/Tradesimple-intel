import { useId, useState } from "react";
import { stopAttempt } from "./api";

export function StopTask({ id, requested }: { id: string; requested: boolean }) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const stop = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await stopAttempt(id, reason);
      if (out.ok) setSent(true);
      else setError(out.error || "Could not request a stop.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request a stop.");
    } finally {
      setBusy(false);
    }
  };
  if (requested || sent)
    return (
      <p role="status" className="tk-meta">
        Stop requested. Waiting for the current operation to finish. Completed work and usage remain recorded.
      </p>
    );
  return (
    <details className="tk-admission">
      <summary>Stop this execution</summary>
      <p>
        Stops at the next checkpoint. A model request receives an abort signal; an in-flight backtest or tool may finish
        first. The future schedule is unchanged.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void stop();
        }}
      >
        <label htmlFor={reasonId}>Reason for stopping</label>
        <textarea
          id={reasonId}
          required
          maxLength={1000}
          rows={2}
          value={reason}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
        <button type="submit" disabled={busy || !reason.trim()}>
          {busy ? "Requesting stop…" : "Request stop"}
        </button>
      </form>
      {error && (
        <p role="alert" className="ask-fault">
          {error}
        </p>
      )}
    </details>
  );
}
