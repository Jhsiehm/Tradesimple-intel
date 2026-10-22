import { useId, useMemo, useState } from "react";
import type { ResearchFigure } from "../../../shared/researchFigures.mjs";
import type { Step } from "../types";
import { ResearchFigureView } from "./ResearchFigureView";
import { StudyReview } from "./StudyReview";
import { figureGroups } from "./model";
import "./figures.css";
import "./figure-picker.css";
import "./study-review.css";

export function ResearchFigures({
  figures,
  steps,
  onChip,
}: {
  figures: ResearchFigure[];
  steps: Step[];
  onChip: (step: Step) => void;
}) {
  const byId = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps]);
  const picker = useId();
  const [selected, setSelected] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const available = figures.slice(0, 12);
  const current = Math.min(selected, Math.max(0, available.length - 1));
  const displayed = showAll ? available : available.slice(current, current + 1);
  const groups = figureGroups(displayed);
  if (!figures.length) return null;
  return (
    <div className="research-figures" role="region" aria-label="Interactive research figures">
      <div className="rf-picker">
        <label htmlFor={picker}>Figure</label>
        <select
          id={picker}
          value={current}
          onChange={(event) => {
            setSelected(Number(event.target.value));
            setShowAll(false);
          }}
        >
          {available.map((figure, index) => (
            <option key={`${figure.id}:${index}`} value={index}>
              {index + 1}. {figure.title}
            </option>
          ))}
        </select>
        {available.length > 1 ? (
          <label className="rf-picker-all">
            <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
            Show all figures
          </label>
        ) : null}
        <span className="rf-picker-count">
          {showAll ? `${available.length} figures` : `${current + 1} of ${available.length}`}
        </span>
      </div>
      {groups.map((group) => (
        <div className="rf-group" key={group.key}>
          {group.review ? (
            <StudyReview review={group.review} steps={byId} onChip={onChip} />
          ) : (
            <p className="rf-review-unavailable">
              These saved figures do not include a study comparison review. Check their notes and sources before
              comparing results.
            </p>
          )}
          {group.figures.map((figure) => (
            <ResearchFigureView key={figure.id} figure={figure} steps={byId} onChip={onChip} />
          ))}
        </div>
      ))}
      {figures.length > 12 ? <p className="rf-notice">Showing the first 12 figures.</p> : null}
    </div>
  );
}
