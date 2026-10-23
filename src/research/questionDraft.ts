export type QuestionMode = "inspect" | "design" | "execute";
export type QuestionBrief = {
  hypothesis: string;
  entities: string;
  from: string;
  to: string;
  outcome: string;
  timing: string;
  studyA: string;
  studyB: string;
};
export type QuestionRecord = { id: string; title?: string; name?: string };
export const QUESTION_LIMIT = 800;
export const questionModes: { id: QuestionMode; label: string; description: string }[] = [
  {
    id: "inspect",
    label: "Inspect saved results",
    description: "Compare recorded evidence and its limits. This does not run or replay a calculation.",
  },
  {
    id: "design",
    label: "Design a new investigation",
    description: "Turn a hypothesis into a testable plan and check feasibility before execution.",
  },
  {
    id: "execute",
    label: "Run a supported analysis",
    description:
      "Request execution after required inputs and source coverage are checked. Unsupported methods must stop.",
  },
];

export function emptyQuestionBrief(): QuestionBrief {
  return { hypothesis: "", entities: "", from: "", to: "", outcome: "", timing: "", studyA: "", studyB: "" };
}

export function exampleQuestionBrief(mode: QuestionMode): QuestionBrief {
  const brief = emptyQuestionBrief();
  if (mode === "inspect") {
    brief.hypothesis = "Compare my saved LMT and HII procurement studies";
  } else if (mode === "design") {
    brief.hypothesis = "Do legislative actions predict excess returns before news coverage?";
    brief.entities = "US legislation; affected listed companies";
    brief.outcome = "excess returns versus SPY";
    brief.timing = "first verified public availability versus first news report";
  } else {
    brief.hypothesis = "Summarize federal contract awards for LMT";
    brief.entities = "federal contract awards; LMT";
    brief.outcome = "award counts and amounts over time";
  }
  return brief;
}

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const validStudyId = (value: string) => /^exp_[a-f0-9]{1,64}$/.test(value);
const calendarDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

export function questionBriefIssues(brief: QuestionBrief): string[] {
  const issues: string[] = [];
  if ((brief.from && !calendarDate(brief.from)) || (brief.to && !calendarDate(brief.to)))
    issues.push("Use real calendar dates in YYYY-MM-DD format.");
  if (brief.from && brief.to && brief.from > brief.to) issues.push("The end date must be on or after the start date.");
  if (brief.studyA && brief.studyA === brief.studyB) issues.push("Choose two different studies or leave one empty.");
  if ([brief.studyA, brief.studyB].some((id) => id && !validStudyId(id)))
    issues.push("A selected study ID is invalid. Choose a saved study again or clear that selection.");
  return issues;
}

export function buildQuestionDraft(mode: QuestionMode, brief: QuestionBrief, records: QuestionRecord[] = []): string {
  const known = new Set(records.map((record) => record.id));
  const selected = [brief.studyA, brief.studyB].filter(Boolean);
  if (mode === "inspect" && selected.some((id) => !validStudyId(id))) return "";
  const ids = [...new Set(selected)];
  const scope = [
    clean(brief.entities) && `Sources/entities: ${clean(brief.entities)}.`,
    brief.from || brief.to ? `Dates: ${brief.from || "start unspecified"} to ${brief.to || "end unspecified"}.` : "",
    clean(brief.outcome) && `Outcome/benchmark: ${clean(brief.outcome)}.`,
    clean(brief.timing) && `Timing: ${clean(brief.timing)}.`,
  ].filter(Boolean);
  const hypothesis = clean(brief.hypothesis);
  if (mode === "inspect") {
    return [
      ids.length
        ? `Inspect saved experiments ${ids.join(", ")}.`
        : hypothesis
          ? `${hypothesis}.`
          : "Inspect saved studies.",
      ids.length && hypothesis ? `Question: ${hypothesis}.` : "",
      ids.some((id) => !known.has(id))
        ? "Selected IDs are outside the current registry preview; resolve these exact records and report any missing IDs without substitution."
        : "",
      ...scope,
      "Confirm exact matching IDs; ask if missing or ambiguous. Do not substitute unrelated studies.",
      "Compare recorded returns, benchmarks, periods, rules, timing assumptions, coverage and exclusions. Show cited interactive charts and exact values where available; never invent daily curves.",
      "Explain comparability, uncertainty and reproducibility limits. Inspection only; do not rerun, replay or start calculations.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    hypothesis ? `Question: ${hypothesis}.` : "Ask me for a falsifiable hypothesis.",
    ...scope,
    mode === "design"
      ? "Design only; do not execute calculations."
      : "Run only a compatible supported analysis after resolving missing inputs and checking actual data coverage.",
    "Clarify missing scope; preserve requested sources. Check methods and coverage first. If unsupported, report gaps; do not substitute another study or source.",
    "Specify outcomes, controls, timing, exclusions, costs and validation. Assess uncertainty and look-ahead risk; separate association from causation.",
    "Chart only cited observations. Preserve inputs, method, assumptions and outputs for replay; disclose reproducibility limits.",
  ]
    .filter(Boolean)
    .join(" ");
}
