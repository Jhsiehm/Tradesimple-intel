import type { AskApi } from "../ask/useAsk";
import { hasContext } from "../ask/useAsk";
import { contextLine, type AgentContext } from "../agent/context";

export function ResearchRunContext({ ask, context }: { ask: AskApi; context: AgentContext }) {
  const last = ask.turns.at(-1),
    steps = last?.steps || [],
    recent = steps.slice().reverse(),
    running = recent.find((step) => step.state === "running"),
    failed = steps.filter((step) => step.state === "error"),
    complete = steps.filter((step) => step.state === "ok").length,
    source = recent.find((step) => step.source),
    mode = last?.done?.memory?.mode || last?.memory?.mode,
    sourcing = ask.session.sourcing || "platform";
  const state = ask.busy
    ? "Running"
    : last?.error
      ? "Interrupted"
      : last?.done?.stopped
        ? "Run limit"
        : failed.length
          ? "Review failures"
          : last
            ? "Recorded"
            : !ask.status
              ? "Checking AI…"
              : ask.status.configured
                ? "Ready"
                : "AI unavailable";
  return (
    <section className="research-run-context" aria-label="Current research context">
      <details className="research-run-details">
        <summary>
          <span>Run context</span>
          <span
            className="research-state"
            data-state={ask.busy ? "active" : last?.error || failed.length || last?.done?.stopped ? "error" : "idle"}
          >
            {state}
          </span>
        </summary>
        {last && <p className="research-current-question">{last.question}</p>}
        <dl>
          <div>
            <dt>AI connection</dt>
            <dd>{ask.status ? (ask.status.configured ? "Configured" : "Unavailable") : "Checking…"}</dd>
          </div>
          <div>
            <dt>Next sources</dt>
            <dd>
              {({ platform: "Platform feeds", both: "Platform + web", web: "Web only" } as Record<string, string>)[
                sourcing
              ] || "Platform feeds"}
            </dd>
          </div>
          <div>
            <dt>Run memory</dt>
            <dd>
              {mode === "isolated" ? "Isolated" : mode === "context-aware" ? "Approved snapshot" : "Standard context"}
            </dd>
          </div>
        </dl>
        <p className="research-context-note">
          {hasContext(context) && !ask.detached ? `Attached: ${contextLine(context)}` : "No screen selection attached"}
          {ask.attachId ? " · Saved chat attached" : ""}
        </p>
        {last && <p className="research-context-note">{complete} tools completed</p>}
        {source && (
          <div className="research-last-source">
            <h3>Latest tool source</h3>
            <p>{source.source}</p>
            <p>
              As of {source.asOf || "not supplied"} · {source.latency || "latency not supplied"}
            </p>
            <p>
              {source.state === "error"
                ? "This retrieval failed."
                : "Reported by the tool; completeness is not certified."}
            </p>
          </div>
        )}
      </details>
      {last?.done?.modes?.sourcing === "web" && (
        <p className="research-context-restriction">Recorded answer uses web sources only.</p>
      )}
      {sourcing === "web" && <p className="research-context-restriction">Next question uses web sources only.</p>}
      {mode && (
        <p className="research-context-restriction">
          {mode === "isolated" ? "This run uses isolated memory." : "This run uses an approved memory snapshot."}
        </p>
      )}
      {ask.busy && (
        <p role="status" className="research-active-step">
          {running?.label || last?.phase || "Working…"}
        </p>
      )}
      {last?.error && (
        <p role="status" className="research-context-warning">
          Research interrupted. Review the answer for details.
        </p>
      )}
      {!last?.error && last?.done?.stopped && (
        <p role="status" className="research-context-warning">
          Run limit reached. The answer may be incomplete.
        </p>
      )}
      {failed.length > 0 && (
        <p role="status" className="research-context-warning">
          {failed.length} {failed.length === 1 ? "tool failed" : "tools failed"}. Inspect the answer’s tool steps.
        </p>
      )}
    </section>
  );
}
