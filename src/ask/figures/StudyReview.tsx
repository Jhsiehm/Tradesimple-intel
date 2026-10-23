import { useId } from "react";
import type { ResearchFigureReview } from "../../../shared/researchFigures.mjs";
import { Chip } from "../Answer";
import type { Step } from "../types";
import { reviewStatus } from "./model";
import { studyPreview } from "./reviewModel";

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
        {review.studies.slice(0, 4).map((study) => {
          const preview = studyPreview(study);
          return (
            <article className="rf-review-study" key={study.id} aria-label={`${study.label} recorded study design`}>
              <header>
                <div>
                  <strong>{study.label}</strong> <Chip id={study.ref} steps={steps} onChip={onChip} />
                </div>
                <p className="rf-review-period">
                  <span className="sr-only">Study period: </span>
                  {preview.window}
                </p>
              </header>
              <dl className="rf-review-overview">
                <div>
                  <dt>Collection</dt>
                  <dd>{preview.coverage}</dd>
                </div>
                <div>
                  <dt>Public availability</dt>
                  <dd>{preview.timing}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <details className="rf-review-checks">
        <summary>
          Design details{reasons.length + missing.length ? ` · ${reasons.length + missing.length} checks and gaps` : ""}
        </summary>
        {review.studies.slice(0, 4).map((study) => (
          <article className="rf-review-design" key={study.id}>
            <h5>
              {study.label} <Chip id={study.ref} steps={steps} onChip={onChip} />
            </h5>
            <dl>
              <div>
                <dt>Study ID</dt>
                <dd>
                  <code>{study.id}</code>
                </dd>
              </div>
              <div>
                <dt>Source path</dt>
                <dd>
                  <code>{study.path}</code>
                </dd>
              </div>
              <div>
                <dt>Study period</dt>
                <dd>{study.window}</dd>
              </div>
              <div>
                <dt>Collection coverage</dt>
                <dd>{study.coverage}</dd>
              </div>
              <div>
                <dt>Public availability</dt>
                <dd>{study.timing}</dd>
              </div>
              <div>
                <dt>Trading rules</dt>
                <dd>{study.rules}</dd>
              </div>
            </dl>
          </article>
        ))}
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
    </section>
  );
}
