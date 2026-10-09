import { stepAnchor } from "../../shared/citations.mjs";
import { when } from "../lib/api";
import type { Step, Turn } from "./types";

/** Opens a finished turn's collapsed timeline, scrolls to one step, and marks it briefly. */
export function revealStep(turnId: string, id: string) {
  const row = document.getElementById(stepAnchor(turnId, id));
  if (!row) return false;
  const box = row.closest("details");
  if (box) box.open = true;
  row.scrollIntoView({ block: "nearest" });
  row.classList.remove("st-hit");
  void row.offsetWidth;
  row.classList.add("st-hit");
  return true;
}

const PHASES = ["planning", "fetching", "computing", "writing"] as const;
const PHASE_WORD = { planning: "Planning", fetching: "Fetching", computing: "Computing", writing: "Writing" };

const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** `{ symbol: "NVDA", days: 30 }` → `symbol NVDA · days 30`; a spec is described by its "Using:" line instead. */
function argLine(args: unknown) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .filter(([k, v]) => k !== "spec" && v !== "" && v != null)
    .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 160);
}

function StepRow({ s, turnId }: { s: Step; turnId: string }) {
  const icon = s.state === "running" ? <span className="st-spin" aria-label="running" /> : s.state === "ok" ? <span className="st-ok" aria-label="done">✓</span> : <span className="st-bad" aria-label="failed">×</span>;
  const args = argLine(s.args);
  return (
    <li id={stepAnchor(turnId, s.id)} className={`st-row ${s.state}`}>
      {icon}
      <div className="st-main">
        <p className="st-title"><b>{s.label}</b> <span className="st-ref">{s.id}</span> <span className="st-ms">{secs(s.ms)}</span>{s.state !== "running" && s.rows ? <span className="st-rows">{s.rows} row{s.rows === 1 ? "" : "s"}</span> : null}</p>
        {args ? <p className="st-args">{args}</p> : null}
        {s.using ? <p className="st-using">{s.using}</p> : null}
        {s.diff?.length ? <p className="st-diff">Changed: {s.diff.join(" · ")}</p> : null}
        {s.state !== "running" && (s.source || s.asOf || s.latency) ? (
          <p className="st-src">{s.source || "no source reported"}{s.asOf ? ` · as of ${when(s.asOf)}` : ""}{s.latency ? ` · ${s.latency}` : ""}</p>
        ) : null}
        {s.state === "error" && s.note ? <p className="st-err">{s.note}</p> : null}
        {s.requests.length || s.preview ? (
          <details className="st-more">
            <summary>Request and response</summary>
            {s.requests.map((r, i) => <code key={i}>{r}</code>)}
            {s.preview ? <pre>{s.preview}</pre> : null}
          </details>
        ) : null}
      </div>
    </li>
  );
}

/** The live timeline of one answer: the phase it is in, then every tool call as it starts and ends. */
export function Steps({ turn }: { turn: Turn }) {
  const live = turn.phase !== "done" && turn.phase !== "error";
  if (!live && !turn.steps.length && !turn.notes.length) return null;
  const at = PHASES.indexOf(turn.phase as (typeof PHASES)[number]);
  return (
    <details className="st" open={live || undefined}>
      <summary>
        {live ? (
          <span className="st-phases" role="status">
            {PHASES.map((p, i) => <span key={p} className={i < at ? "past" : i === at ? "now" : ""}>{PHASE_WORD[p]}</span>)}
          </span>
        ) : (
          <span>{turn.steps.length} step{turn.steps.length === 1 ? "" : "s"}{turn.done ? ` · ${secs(turn.done.ms)}` : ""}{turn.model ? ` · ${turn.model}` : ""}</span>
        )}
      </summary>
      {turn.steps.length ? <ol>{turn.steps.map((s) => <StepRow key={s.id} s={s} turnId={turn.id} />)}</ol> : null}
      {turn.notes.map((n, i) => <p key={i} className="st-note">{n}</p>)}
    </details>
  );
}
