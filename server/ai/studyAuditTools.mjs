import { auditSavedStudies } from "../domain/study-audit.mjs";
import { researchStore } from "../domain/research-store.mjs";

const ids = (prefix) => ({
  type: "array",
  minItems: 1,
  maxItems: 4,
  uniqueItems: true,
  items: { type: "string", pattern: `^${prefix}_[a-f0-9]{32}$` },
});
export const STUDY_AUDIT_TOOLS = [
  {
    name: "research_audit_saved_studies",
    label: "Audit saved study evidence",
    description:
      "Deterministically inspect 1–4 exact saved experiment IDs, exact dataset IDs, or exact study title/ticker names. Named matching is bounded to latest500 saved experiments and reports unmatched/ambiguous names without unrelated substitutions. With no selector audit up to four newest distinct pinned datasets. Returns pinned coverage, timing, recorded statistics and descriptive comparison readiness. Never reruns calculations or establishes historical completeness or an investable effect.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        experimentIds: ids("exp"),
        datasetIds: ids("ds"),
        studyNames: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 120 },
          description:
            "Exact study title, dataset name or ticker. Mutually exclusive with IDs; ambiguous names require exact experiment IDs.",
        },
      },
    },
    run(db, args) {
      // Standard owner-store attachment/schema setup; the audit itself only reads frozen records.
      researchStore(db);
      return auditSavedStudies(db, args);
    },
  },
];
