import { confidenceLine } from "../../shared/confidence.mjs";
import { revisionSummary } from "../../shared/revise.mjs";
import type { Turn } from "./types";
import "./meta.css";

const STATUS_WORD = { corrected: "corrected", removed: "removed", "still flagged": "still flagged" } as const;

/**
 * Under an answer: "Checking figures…" while the revision pass runs, then what it changed (expandable), then one
 * factual confidence line — amber when a figure is unverified or a backtest priced only part of its signals.
 */
export function AnswerMeta({ turn }: { turn: Turn }) {
  const done = turn.done;
  if (turn.revising) return <p className="ask-checking" role="status"><span className="st-spin" aria-hidden="true" /> {turn.revising}</p>;
  if (!done) return null;
  const rev = done.revision;
  const summary = revisionSummary(rev);
  const line = confidenceLine({ steps: turn.steps, done, model: turn.model, now: Date.now() });
  return (
    <>
      {rev && summary ? (
        rev.status === "applied" ? (
          <details className="ask-revised">
            <summary>{summary}{rev.model ? ` · ${rev.model}` : ""}</summary>
            <ul>{rev.changes.map((c, i) => <li key={i} data-status={c.status}><b>{STATUS_WORD[c.status]}</b> {c.note}</li>)}</ul>
            {rev.removed.length || rev.added.length ? (
              <div className="ask-diff" aria-label="Lines changed">
                {rev.removed.map((l, i) => <code key={`r${i}`} className="del">− {l}</code>)}
                {rev.added.map((l, i) => <code key={`a${i}`} className="add">+ {l}</code>)}
              </div>
            ) : null}
          </details>
        ) : <p className="ask-revised-note">{summary}</p>
      ) : null}
      {line ? <p className="ask-confidence" data-tone={line.tone}>{line.text}</p> : null}
    </>
  );
}
