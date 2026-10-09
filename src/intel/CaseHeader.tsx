import { useState } from "react";
import { ACTIVITY_RULE, SEVERITY_RULE } from "../../shared/intel.mjs";
import { when } from "../lib/format";
import { useCaseFile } from "./useIntel";
import "./case.css";

/** `member:P000197`, `ticker:NVDA`, or `district:CA-11` → headline, signal chip, three stats, and provenance. */
export function CaseHeader({ caseKey }: { caseKey: string }) {
  const c = useCaseFile(caseKey);
  const [rule, setRule] = useState(false);
  const subject = caseKey.split(":")[0].toUpperCase();

  if (!c) {
    return (
      <header className="case case-wait" aria-busy="true">
        <div className="case-top"><span className="case-subject">{subject} · CASE FILE</span></div>
        <p className="case-headline">Assembling trades, hearings, contracts…</p>
      </header>
    );
  }
  if (!c.ok) {
    return (
      <header className="case case-err">
        <div className="case-top"><span className="case-subject">{subject} · CASE FILE</span></div>
        <p className="case-headline">Case file unavailable · {c.error || "no response"}</p>
      </header>
    );
  }
  const ruleText = c.signal.rule === "activity" ? ACTIVITY_RULE : SEVERITY_RULE;
  return (
    <header className="case" aria-label={`${c.subject.toLowerCase()} case file`}>
      <div className="case-top">
        <span className="case-subject">{c.subject}{c.sub ? <b> · {c.sub}</b> : null}</span>
        <button
          className={`case-chip case-lv-${c.signal.level}`}
          aria-expanded={rule}
          onClick={() => setRule((v) => !v)}
          title={`${c.signal.why}\n\nRule: ${ruleText}`}
        >
          {c.signal.label}
        </button>
      </div>
      <p className="case-headline">{c.headline}</p>
      {rule ? (
        <p className="case-rule">
          <span>{c.signal.why}</span>
          <span><em>RULE</em> {ruleText}</span>
        </p>
      ) : null}
      <dl className="case-stats">
        {c.stats.map((s) => (
          <div key={s.label} title={s.note}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
            {s.note ? <small>{s.note}</small> : null}
          </div>
        ))}
      </dl>
      <p className="case-src">
        <span><em>AS OF</em>{when(c.asOf)} UTC</span>
        <span><em>SOURCE</em>{c.sources.join(" · ")}</span>
        {c.latency ? <span><em>LAG</em>{c.latency}</span> : null}
      </p>
    </header>
  );
}
