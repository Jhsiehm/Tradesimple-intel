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
      "Deterministically inspect 1–4 exact saved experiment IDs, or latest saved experiments for exact dataset IDs. With no IDs audit up to four newest distinct pinned datasets within latest500 saved experiments. Returns pinned coverage, exclusions, timing assumptions, recorded statistics and comparison differences in one call. Does not rerun calculations, fetch data or establish historical completeness. Archived source-semantic caveat mismatches must not be reused as findings.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { experimentIds: ids("exp"), datasetIds: ids("ds") },
    },
    run(db, args) {
      // Standard owner-store attachment/schema setup; the audit itself only reads frozen records.
      researchStore(db);
      return auditSavedStudies(db, args);
    },
  },
];
