import { auditInventory, auditRecord } from "./study-audit-store.mjs";
import { studyFacts } from "./study-audit-facts.mjs";
import { auditSelection, discoverAuditStudies } from "./study-audit-selection.mjs";
import { compareAuditStudies } from "./study-audit-comparison.mjs";

/** Deterministic inspection of frozen records. No collection, writes, execution or statistical re-analysis. */
export function auditSavedStudies(db, args = {}) {
  const choice = auditSelection(args);
  let selectedIds = choice.ids,
    discovery = null;
  if (choice.kind !== "experimentIds") {
    ({ selectedIds, discovery } = discoverAuditStudies(choice, auditInventory(db)));
  }
  const studies = selectedIds.map((key) => studyFacts(auditRecord(db, key)));
  return {
    ok: true,
    source: "Pinned saved-study audit",
    asOf:
      studies
        .map((s) => s.createdAt)
        .sort()
        .at(-1) || null,
    latency:
      "Frozen saved records only. Checksums checked; calculations not replayed; historical source completeness and publication timing not independently verified.",
    selection: choice.kind,
    selectedIds,
    discovery,
    studies,
    comparison: compareAuditStudies(studies, discovery),
    claimLimits: {
      replayPerformed: false,
      newBacktestPerformed: false,
      supported:
        "Describe recorded statistics, source counters, exclusions, assumptions and design differences with their pinned evidence origins.",
      unsupported:
        "Do not assert no look-ahead, before-news returns, causal effects, predictive skill or superiority of one signal from this inspection.",
      nullMeaning: "Unknown or absent in frozen evidence; never zero, complete, verified or equivalent.",
      sourceIntegrity:
        "Database bodies, frozen inputs, engine and dataset pins checked; this is not authentication of source truth or a full evidence-archive closure audit.",
    },
  };
}
