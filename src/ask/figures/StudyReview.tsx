import { useId } from "react";
import type { ResearchFigureReview } from "../../../shared/researchFigures.mjs";
import { Chip } from "../Answer";
import type { Step } from "../types";
import { reviewStatus } from "./model";

type Props = { review: ResearchFigureReview; steps: Map<string, Step>; onChip: (step: Step) => void };

/** Recorded design checks precede performance; matching fields never imply a valid causal comparison. */
export function StudyReview({ review, steps, onChip }: Props) {
  const heading = useId();
  const reasons = review.reasons.slice(0, 8);
  const missing = review.missingEvidence.slice(0, 8);
  const evidenceList = (items: typeof reasons) => (
    <ul>
      {items.map((item, index) => (
        <li key={`${item.path}:${index}`}>
          <span>{item.label}</span> <Chip id={item.ref} steps={steps} onChip={onChip} />
          <code>{item.path}</code>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="rf-review" aria-labelledby={heading}>
      <header className="rf-review-head">
        <h4 id={heading}>Study comparison</h4>
        <span className="rf-review-status">{reviewStatus(review.status)}</span>
      </header>
      <p className="rf-review-summary">{review.summary}</p>
      <div className="rf-review-studies">
        {review.studies.slice(0, 4).map((study) => (
          <article className="rf-review-study" key={study.id} aria-label={`${study.label} recorded study design`}>
            <header>
              <strong>{study.label}</strong>
              <Chip id={study.ref} steps={steps} onChip={onChip} />
              <details className="rf-review-id">
                <summary>Study ID and source</summary>
                <code>{study.id}</code>
                <code>{study.path}</code>
              </details>
            </header>
            <dl>
              <div>
                <dt>Collection coverage</dt>
                <dd>{study.coverage}</dd>
              </div>
              <div>
                <dt>Public availability</dt>
                <dd>{study.timing}</dd>
              </div>
              <div>
                <dt>Study period</dt>
                <dd>{study.window}</dd>
              </div>
              <div>
                <dt>Trading rules</dt>
                <dd>{study.rules}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      {reasons.length || missing.length ? (
        <details className="rf-review-checks">
          <summary>Comparison checks and evidence gaps · {reasons.length + missing.length}</summary>
          {reasons.length ? (
            <div>
              <h5>Recorded comparison checks</h5>
              {evidenceList(reasons)}
            </div>
          ) : null}
          {missing.length ? (
            <div>
              <h5>Evidence still needed</h5>
              {evidenceList(missing)}
            </div>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
