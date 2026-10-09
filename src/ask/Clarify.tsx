import { useState } from "react";
import { describeValue } from "../../shared/backtestAsk.mjs";
import type { ClarifyAsk } from "./types";

/** A short follow-up before a backtest runs: one chip per answer, defaults shown, the spec always visible. */
export function Clarify({ ask, disabled, onRun }: { ask: ClarifyAsk; disabled: boolean; onRun: (answers: Record<string, unknown>, acceptDefaults: boolean) => void }) {
  const [picked, setPicked] = useState<Record<string, unknown>>({});
  const pick = (path: string, value: unknown) => {
    const next = { ...picked, [path]: value };
    setPicked(next);
    if (ask.questions.every((q) => q.path in next)) onRun(next, false);
  };
  return (
    <section className="clar" aria-label="Before this backtest runs">
      <p className="clar-lead">{ask.questions.length === 1 ? "One choice changes" : `${ask.questions.length} choices change`} the result, and nothing you said or saved settles {ask.questions.length === 1 ? "it" : "them"} yet.</p>
      {ask.questions.map((q) => (
        <div key={q.path} className="clar-q">
          <b>{q.prompt}</b>
          <span className="clar-chips" role="group" aria-label={q.prompt}>
            {q.chips.map((c) => (
              <button key={String(c.value)} type="button" className="chip" aria-pressed={picked[q.path] === c.value} disabled={disabled} onClick={() => pick(q.path, c.value)}>{c.label}</button>
            ))}
          </span>
          <small>Default: {describeValue(q.path, q.fallback)}</small>
        </div>
      ))}
      <p className="clar-spec"><em>Will run</em> {ask.sentence}{ask.sources.length > 1 ? ` · one run each for ${ask.sources.join(", ")}` : ""}</p>
      {ask.note ? <p className="clar-spec"><em>Applied</em> {ask.note}</p> : null}
      <div className="clar-actions">
        <button type="button" className="panels-btn" disabled={disabled} onClick={() => onRun(picked, true)}>Accept defaults</button>
        {Object.keys(picked).length ? <button type="button" className="panels-btn" disabled={disabled} onClick={() => onRun(picked, true)}>Run with these</button> : null}
      </div>
    </section>
  );
}
