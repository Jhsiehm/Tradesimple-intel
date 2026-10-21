import { cleanTheory } from "../../shared/theories.mjs";
import { THEORY_LOOK } from "../relations/palette";
import { miscitedNote } from "../../shared/citations.mjs";
import { Answer, Chip, ToolTable } from "../ask/Answer";
import { AnswerMeta } from "../ask/AnswerMeta";
import { ReuseNote } from "../ask/Spend";
import { BacktestCard } from "../ask/BacktestCard";
import { Clarify } from "../ask/Clarify";
import { ScheduleControl } from "../tasks/ScheduleControl";
import { revealStep, Steps } from "../ask/Steps";
import { type AskApi } from "../ask/useAsk";
import type { Step, Turn } from "../ask/types";

export function TurnView({
  turn,
  busy,
  ask,
  prompts,
  onFollow,
}: {
  turn: Turn;
  busy: boolean;
  ask: AskApi;
  prompts: string[];
  onFollow: (action: string) => void;
}) {
  const done = turn.done;
  const chip = (s: Step) => {
    revealStep(turn.id, s.id);
    if (s.open) onFollow(s.open);
  };
  const byId = new Map(turn.steps.map((s) => [s.id, s]));
  const theory = done?.theory ? cleanTheory(done.theory) : null;
  return (
    <>
      <p className="ask-user">
        <em className="ask-kicker">You{turn.context ? ` · with ${turn.context}` : ""}</em>
        {turn.question}
      </p>
      <article className="ask-turn">
        {turn.memory && (
          <p className="bt-note">
            {turn.memory.mode === "isolated"
              ? "Isolated analysis · saved research disabled"
              : "Context-aware analysis · selected approved revisions only"}
            . Earlier chat, page context and saved backtest preferences were not sent.{" "}
            {done?.memory && (
              <a href={`/api/research/memory/snapshots/${done.memory.snapshotId}`} target="_blank" rel="noreferrer">
                Inspect frozen context · cutoff {done.memory.knownAt}
              </a>
            )}
          </p>
        )}
        {done?.analysisId && (
          <p className="bt-note">
            <a href={`/api/research/analyses/${done.analysisId}`} target="_blank" rel="noreferrer">
              Inspect saved analysis and execution evidence
            </a>
          </p>
        )}
        <Steps turn={turn} />
        {turn.clarify ? (
          <Clarify
            ask={turn.clarify}
            disabled={busy}
            onRun={(answers, acceptDefaults) =>
              void ask.run(turn.question, { answers, acceptDefaults, turnId: turn.id })
            }
          />
        ) : null}
        {turn.text ? (
          <Answer text={done?.greeting ? turn.text.split("\n\n")[0] : turn.text} steps={turn.steps} onChip={chip} />
        ) : null}
        {done?.greeting ? (
          <div className="ask-examples">
            {prompts.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => void ask.run(q)}>
                {q}
              </button>
            ))}
          </div>
        ) : null}
        <AnswerMeta turn={turn} />
        <ReuseNote
          turn={turn}
          busy={busy}
          onReask={() => void ask.run(turn.question, { turnId: turn.id, fresh: true })}
        />
        {done?.table ? <ToolTable table={done.table} steps={turn.steps} onChip={chip} /> : null}
        {done?.backtests
          ?.filter((b) => b.ok)
          .map((b) => (
            <BacktestCard key={b.id} bt={b} onFollow={onFollow} cite={<Chip id={b.id} steps={byId} onChip={chip} />} />
          ))}
        <ScheduleControl turn={turn} />
        {theory ? (
          <section className="ask-theory" style={{ ["--tint" as string]: THEORY_LOOK.color }}>
            <h3>Proposed theory</h3>
            <p>
              {theory.a.label} ↔ {theory.b.label}
              {theory.label ? ` · ${theory.label}` : ""}
            </p>
            {theory.note ? <p>{theory.note}</p> : null}
            <p className="ask-meta">
              {theory.confidence} confidence · yours, not a filing · Accept saves it in this browser
            </p>
          </section>
        ) : null}
        {done && !done.greeting && !done.clarify ? (
          <>
            {done.modes?.label ? <p className="ask-meta">Mode · {done.modes.label}</p> : null}
            {done.grounding.unmatched.length ? (
              <p className="ask-warn">
                Not found in any tool result: {done.grounding.unmatched.join(", ")}. Treat as unverified.
              </p>
            ) : null}
            {done.grounding.mislabeled?.length ? (
              <p className="ask-warn">
                Counted as something else in the tool results:{" "}
                {done.grounding.mislabeled.map((m) => `“${m.raw}” is ${m.foundAs[0]}`).join("; ")}. Treat as mislabeled.
              </p>
            ) : null}
            {done.grounding.scope?.length ? (
              <p className="ask-warn">
                Not what the cited data covers: {done.grounding.scope.map((s) => `“${s.raw}”`).join(", ")}. See the
                caveats.
              </p>
            ) : null}
            {done.grounding.miscited?.length ? (
              <p className="ask-warn">Cited to the wrong step: {done.grounding.miscited.map(miscitedNote).join(" ")}</p>
            ) : null}
            {done.grounding.uncitedRows?.length ? (
              <p className="ask-warn">
                {done.grounding.uncitedRows.length} table row
                {done.grounding.uncitedRows.length === 1 ? " has" : "s have"} figures and no ref. Treat as unverified.
              </p>
            ) : null}
            {done.uncited ? (
              <p className="ask-warn">Tools ran, but the answer cites none of them. Treat its figures as unverified.</p>
            ) : null}
            {done.unknown.length ? (
              <p className="ask-warn">Cites results that were never fetched: {done.unknown.join(", ")}.</p>
            ) : null}
            {done.noTools && !done.prefs ? (
              <p className="ask-warn">No tool was called, so nothing here comes from the app's data.</p>
            ) : null}
            {done.stopped ? (
              <p className="ask-warn">Stopped at the {done.stopped}; the answer may be incomplete.</p>
            ) : null}
            {done.caveats.length ? (
              <details className="ask-cav">
                <summary>Data caveats ({done.caveats.length})</summary>
                <ul>
                  {done.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
        {turn.phase === "error" ? <p className="ask-fault">{turn.error}</p> : null}
        {turn.phase === "error" && !busy ? (
          <button
            type="button"
            className="panels-btn ask-retry"
            onClick={() => void ask.run(turn.question, { turnId: turn.id })}
          >
            Retry
          </button>
        ) : null}
      </article>
    </>
  );
}
