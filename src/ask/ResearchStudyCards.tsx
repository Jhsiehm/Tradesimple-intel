import { useId, useState } from "react";
import { cleanResearchStudies, type ResearchStudy } from "../../shared/researchChat.mjs";
import type { AskApi } from "./useAsk";
import "./research-studies.css";

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
const scalar = (value: unknown) => value == null || ["string", "number", "boolean"].includes(typeof value);
const display = (value: unknown) =>
  value == null ? "Not recorded" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);

/** Bounded readable views; full records remain available in the saved export. */
function DataView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (scalar(value)) return <span>{display(value)}</span>;
  if (depth > 5) return <p className="study-note">Additional nested detail is available in the saved report.</p>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="study-note">None recorded.</span>;
    const rows = value.slice(0, 20);
    const records = rows.every((row) => row && typeof row === "object" && !Array.isArray(row));
    const columns = records ? [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8) : [];
    const table = records && columns.length > 0 && rows.every((row) => columns.every((key) => scalar(row[key])));
    return (
      <>
        {table ? (
          <div className="study-table" tabIndex={0} role="region" aria-label="Research data table">
            <table>
              <thead>
                <tr>
                  {columns.map((key) => (
                    <th key={key} scope="col">
                      {label(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {columns.map((key) => (
                      <td key={key}>{display(row[key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul>
            {rows.map((row, index) => (
              <li key={index}>
                <DataView value={row} depth={depth + 1} />
              </li>
            ))}
          </ul>
        )}
        {value.length > rows.length ? (
          <p className="study-note">
            Showing {rows.length} of {value.length} records. Download the saved report for all records.
          </p>
        ) : null}
        {records && new Set(rows.flatMap((row) => Object.keys(row))).size > columns.length ? (
          <p className="study-note">Additional columns are included in the saved report.</p>
        ) : null}
      </>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <p className="study-note">Nothing recorded yet.</p>;
  return (
    <dl className="study-data">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd>
            {scalar(item) ? (
              display(item)
            ) : (
              <details>
                <summary>View {label(key)}</summary>
                <DataView value={item} depth={depth + 1} />
              </details>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StudyResults({ study }: { study: ResearchStudy }) {
  const amount = (value: unknown, unit: unknown) => typeof value === "number" && unit === "USD"
    ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value;
  const summaries = study.kind === "workflow" ? Object.entries(study.outputs).flatMap(([name, output]) => {
    const preview = (output as { preview?: Record<string, unknown>[] })?.preview;
    return Array.isArray(preview) ? preview.filter(row => typeof row.n === "number" && "sum" in row).map(row => ({
      output: name, group: JSON.stringify(row.groupValues || {}), metric: row.metric, unit: row.unit,
      count: row.n, total: amount(row.sum, row.unit), mean: amount(row.mean, row.unit),
      minimum: amount(row.min, row.unit), maximum: amount(row.max, row.unit),
    })) : [];
  }) : [];
  return <>
    {summaries.map(({output, group, metric, ...values}, index) => <div key={`${output}:${index}`}>
      <p className="study-note">{output} · {display(metric)}{group !== "{}" ? ` · ${group}` : ""}</p>
      <DataView value={[values]} />
    </div>)}
    {summaries.length ? <p className="study-note">USD amounts displayed to two decimals; full precision is retained in the result preview and export.</p> : null}
    <details><summary>Full result preview</summary><DataView value={study.outputs} /></details>
  </>;
}

function StudyCard({ study, busy, ask }: { study: ResearchStudy; busy: boolean; ask: AskApi }) {
  const [amendment, setAmendment] = useState("");
  const inputId = useId();
  const runnable = study.kind === "workflow" && study.status === "draft" && !study.gaps.length;
  const base = study.kind === "workflow" ? "/api/research/investigations/" : "/api/research/policy/";
  const exportUrl = `${base}${encodeURIComponent(study.id)}/export`;
  const run = (prompt: string) => void ask.run(prompt, { studyId: study.id });
  const next = runnable
    ? "Review the plan, then run this investigation here."
    : study.gaps.length
      ? study.kind === "policy"
        ? "Review the missing inputs below, collect available evidence, then evaluate readiness."
        : "Review the missing inputs below. Ask the assistant to resolve them or revise the question."
      : study.executed
        ? "Inspect the result and its limits, or revise the question for a linked investigation."
        : "Ask the assistant to inspect readiness and explain the next supported step.";
  return (
    <section className="research-study" aria-label={`Investigation: ${study.title}`}>
      <header>
        <h3>{study.title}</h3>
        <span className="study-status">
          {label(study.status)} · revision {study.revision}
        </span>
      </header>
      <p className="study-question">{study.question}</p>
      <p className="study-note">
        {study.claim ? `${study.claim} · ` : ""}
        {study.executed ? "Analysis executed" : "Analysis not executed"}
      </p>
      <p className="study-next">{next}</p>
      {study.gaps.length ? (
        <div className="study-gaps">
          <strong>Needed before proceeding</strong>
          <ul>
            {study.gaps.map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {study.limitations.length ? (
        <details className="study-limits study-section">
          <summary>Limits of this investigation ({study.limitations.length})</summary>
          <ul>
            {study.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {study.replay ? (
        <p className="study-next">
          {study.replay.matches
            ? "Replay verified: saved numeric results match."
            : "Replay mismatch: do not treat this result as verified."}
        </p>
      ) : null}
      <details className="study-section">
        <summary>Study plan</summary>
        <DataView value={study.plan} />
      </details>
      <details className="study-section">
        <summary>Evidence and coverage</summary>
        <DataView value={study.evidence} />
      </details>
      <details className="study-section" open={study.executed || undefined}>
        <summary>Saved results</summary>
        <p className="study-note">Preview of the saved result. The download contains the full record.</p>
        <StudyResults study={study} />
      </details>
      <div className="study-actions">
        {runnable ? (
          <button
            type="button"
            className="study-primary"
            disabled={busy}
            onClick={() => run(`Run investigation ${study.id} using its saved plan at revision ${study.revision}.`)}
          >
            Run investigation
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(
              `Inspect investigation ${study.id}. Explain its evidence, readiness, results and next supported action here in chat.`,
            )
          }
        >
          Inspect with assistant
        </button>
        {study.archiveAvailable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(`Replay investigation ${study.id} and verify its saved numeric results.`)}
          >
            Verify replay
          </button>
        ) : null}
        {study.kind === "policy" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  `Run evidence collection for policy investigation ${study.id}, preserving its saved protocol and reporting missing sources here.`,
                )
              }
            >
              Collect evidence
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  `Run evaluation of policy investigation ${study.id} against its saved evidence and readiness requirements. Report unsupported or missing inputs without inventing evidence.`,
                )
              }
            >
              Evaluate evidence
            </button>
          </>
        ) : null}
        <a href={exportUrl} download>
          Download saved report
        </a>
        {study.archiveAvailable ? (
          <a href={`${base}${encodeURIComponent(study.id)}/archive`} download>
            Download replay archive
          </a>
        ) : null}
      </div>
      {study.kind === "workflow" ? (
        <form
          className="study-amend"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && amendment.trim())
              run(
                `Revise investigation ${study.id}: ${amendment.trim()}. Preserve the original and explain the revised plan here.`,
              );
          }}
        >
          <label htmlFor={inputId}>Change this investigation</label>
          <div>
            <input
              id={inputId}
              value={amendment}
              disabled={busy}
              onChange={(event) => setAmendment(event.target.value)}
              placeholder="For example, extend the dates or change the benchmark"
              maxLength={2000}
            />
            <button type="submit" disabled={busy || !amendment.trim()}>
              Revise plan
            </button>
          </div>
        </form>
      ) : (
        <p className="study-note">
          Policy plan amendments are not yet supported in chat. Ask the assistant to explain which inputs can be
          collected for this saved plan.
        </p>
      )}
      <details className="study-section study-record">
        <summary>Saved record</summary>
        <p>
          Investigation ID: <code>{study.id}</code>
          {study.parentId ? (
            <>
              {" "}
              · Based on <code>{study.parentId}</code>
            </>
          ) : null}
        </p>
      </details>
    </section>
  );
}

export function ResearchStudyCards({ studies, busy, ask }: { studies: ResearchStudy[]; busy: boolean; ask: AskApi }) {
  return (
    <div className="research-studies">
      {cleanResearchStudies(studies).map((study) => (
        <StudyCard key={`${study.id}:${study.revision}`} study={study} busy={busy} ask={ask} />
      ))}
    </div>
  );
}
