import { useState } from "react";
import {
  buildQuestionDraft,
  emptyQuestionBrief,
  exampleQuestionBrief,
  QUESTION_LIMIT,
  questionBriefIssues,
  questionModes,
  type QuestionBrief,
  type QuestionMode,
  type QuestionRecord,
} from "./questionDraft";
import "./question-guide.css";

export function ResearchQuestionGuide({
  records,
  busy,
  draft,
  onDraft,
}: {
  records: QuestionRecord[];
  busy: boolean;
  draft: string;
  onDraft: (value: string) => void;
}) {
  const [mode, setMode] = useState<QuestionMode>("inspect");
  const [brief, setBrief] = useState(emptyQuestionBrief);
  const [previous, setPrevious] = useState<string | null>(null);
  const [appliedDraft, setAppliedDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const generated = buildQuestionDraft(mode, brief, records);
  const issues = questionBriefIssues(brief);
  const overLimit = generated.length > QUESTION_LIMIT;
  const change = (field: keyof QuestionBrief, value: string) => {
    setBrief((prior) => ({ ...prior, [field]: value }));
    setNotice("");
  };
  const apply = (next: string) => {
    if (busy || next.length > QUESTION_LIMIT) return;
    setPrevious(draft);
    setAppliedDraft(next);
    onDraft(next);
    setNotice("Draft inserted into your question. Review before sending.");
    document.getElementById("research-question")?.focus();
  };
  const exampleLabels = {
    inspect: "Insert LMT/HII example",
    design: "Insert legislation example",
    execute: "Insert contract example",
  };
  const draftDescriptions = {
    inspect: "Ask to compare saved evidence without new calculations.",
    design: "Ask for a testable plan and a check of available evidence.",
    execute: "Ask to run a supported method after inputs and coverage are checked.",
  };
  return (
    <details className="research-question-guide" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Refine your question</summary>
      <fieldset disabled={busy}>
        <div className="research-question-intent">
          <label htmlFor="research-question-intent">Draft type</label>
          <select
            id="research-question-intent"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as QuestionMode);
              setNotice("");
            }}
            aria-describedby="research-question-intent-help"
          >
            {questionModes.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          <p id="research-question-intent-help">{draftDescriptions[mode]}</p>
          <button type="button" onClick={() => apply(buildQuestionDraft(mode, exampleQuestionBrief(mode), records))}>
            {exampleLabels[mode]}
          </button>
        </div>
        <details className="research-question-scope">
          <summary>Customize the draft</summary>
          <div className="research-question-fields">
            <label className="research-question-wide">
              Question or hypothesis
              <input
                value={brief.hypothesis}
                onChange={(event) => change("hypothesis", event.target.value)}
                maxLength={180}
                placeholder="What would the evidence need to show?"
              />
            </label>
            {mode === "inspect" ? (
              <>
                {(["studyA", "studyB"] as const).map((field, index) => (
                  <label key={field}>
                    Saved study {index === 0 ? "A" : "B"} · optional
                    <select value={brief[field]} onChange={(event) => change(field, event.target.value)}>
                      <option value="">Identify from my question</option>
                      {brief[field] && !records.some((record) => record.id === brief[field]) && (
                        <option value={brief[field]}>Outside current preview · {brief[field]}</option>
                      )}
                      {records.map((record) => (
                        <option key={record.id} value={record.id}>
                          {record.title || record.name || record.id} · {record.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <p className="research-question-wide">
                  {records.length
                    ? "This is a recent registry preview. Select exact records or name the studies in your question; ambiguous matches must be clarified."
                    : "No study records are listed here. The draft requests discovery and confirmation instead of assuming a match."}
                </p>
              </>
            ) : null}
            <label className="research-question-wide">
              Sources and entities · optional
              <input
                value={brief.entities}
                onChange={(event) => change("entities", event.target.value)}
                maxLength={100}
                placeholder="For example, bill amendments; affected companies"
              />
            </label>
            <label>
              Start date · optional
              <input type="date" value={brief.from} onChange={(event) => change("from", event.target.value)} />
            </label>
            <label>
              End date · optional
              <input type="date" value={brief.to} onChange={(event) => change("to", event.target.value)} />
            </label>
            <label>
              Outcome and benchmark · optional
              <input
                value={brief.outcome}
                onChange={(event) => change("outcome", event.target.value)}
                maxLength={100}
                placeholder="For example, 20-day excess return vs SPY"
              />
            </label>
            <label>
              Availability or timing rule · optional
              <input
                value={brief.timing}
                onChange={(event) => change("timing", event.target.value)}
                maxLength={100}
                placeholder="First verified public timestamp"
              />
            </label>
          </div>
          <p>Blank fields remain unresolved. The draft asks for clarification; it does not supply dates or coverage.</p>
          {issues.length > 0 && <p role="alert">{issues.join(" ")}</p>}
          <div className="research-question-actions">
            <button type="button" disabled={issues.length > 0 || overLimit} onClick={() => apply(generated)}>
              Build editable draft
            </button>
            <span data-over-limit={overLimit}>
              {generated.length}/{QUESTION_LIMIT} characters
            </span>
          </div>
          {overLimit && (
            <p role="alert">Shorten the scope to fit the question limit. Nothing will be cut automatically.</p>
          )}
        </details>
        <p className="research-question-help">
          Drafts only fill your question; review before sending. Sources controls retrieval, not coverage.
        </p>
      </fieldset>
      {notice && draft === appliedDraft && (
        <p className="research-question-notice" role="status">
          {notice}{" "}
          {previous !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (draft !== appliedDraft) return;
                onDraft(previous);
                setAppliedDraft(previous);
                setPrevious(null);
                setNotice("Previous question restored.");
              }}
            >
              Undo draft replacement
            </button>
          )}
        </p>
      )}
    </details>
  );
}
