import { useState } from "react";
import { describeValue } from "../../shared/backtestAsk.mjs";
import { SOURCING_LABEL } from "../../shared/askModes.mjs";
import type { ClarifyAsk } from "./types";

const fallbackLabel = (path: string, value: unknown) => {
  if (path === "sourcing" && typeof value === "string" && value in SOURCING_LABEL) return SOURCING_LABEL[value as keyof typeof SOURCING_LABEL];
  try { return describeValue(path, value); } catch { return String(value ?? "—"); }
};

/** Follow-up chips before a backtest or a sourcing choice: one chip per answer, defaults shown. */
export function Clarify({ ask, disabled, onRun }: { ask: ClarifyAsk; disabled: boolean; onRun: (answers: Record<string, unknown>, acceptDefaults: boolean) => void }) {
  const [picked, setPicked] = useState<Record<string, unknown>>({});
  const sourcingOnly = ask.questions.every((q) => q.path === "sourcing");
  const pick = (path: string, value: unknown) => {
    const next = { ...picked, [path]: value };
    setPicked(next);
    if (ask.questions.every((q) => q.path in next)) onRun(next, false);
  };
  return (
    <section className="clar" aria-label={sourcingOnly ? "Where should Ask look" : "Before this backtest runs"}>
      <p className="clar-lead">
        {sourcingOnly
          ? "This question may need news, X, satellite context, or the open web."
          : `${ask.questions.length === 1 ? "One choice changes" : `${ask.questions.length} choices change`} the result, and nothing you said or saved settles ${ask.questions.length === 1 ? "it" : "them"} yet.`}
      </p>
      {ask.questions.map((q) => (
        <div key={q.path} className="clar-q">
          <b>{q.prompt}</b>
          <span className="clar-chips" role="group" aria-label={q.prompt}>
            {q.chips.map((c) => (
              <button key={String(c.value)} type="button" className="chip" aria-pressed={picked[q.path] === c.value} disabled={disabled} onClick={() => pick(q.path, c.value)}>{c.label}</button>
            ))}
          </span>
          <small>Default: {fallbackLabel(q.path, q.fallback)}</small>
        </div>
      ))}
      {ask.sentence ? <p className="clar-spec"><em>Will run</em> {ask.sentence}{ask.sources.length > 1 ? ` · one run each for ${ask.sources.join(", ")}` : ""}</p> : null}
      {ask.note ? <p className="clar-spec"><em>Applied</em> {ask.note}</p> : null}
      <div className="clar-actions">
        <button type="button" className="panels-btn" disabled={disabled} onClick={() => onRun(picked, true)}>Accept defaults</button>
        {Object.keys(picked).length ? <button type="button" className="panels-btn" disabled={disabled} onClick={() => onRun(picked, true)}>Run with these</button> : null}
      </div>
    </section>
  );
}
