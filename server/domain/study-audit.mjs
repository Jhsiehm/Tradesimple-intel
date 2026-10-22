import { auditInventory, auditRecord } from "./study-audit-store.mjs";
import { studyFacts } from "./study-audit-facts.mjs";

const id = { experimentIds: /^exp_[a-f0-9]{32}$/, datasetIds: /^ds_[a-f0-9]{32}$/ };
function selection(args) {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((k) => !Object.hasOwn(id, k)))
    throw Error("Choose exact saved experimentIds or datasetIds.");
  const keys = Object.keys(args);
  if (keys.length > 1) throw Error("Choose experimentIds or datasetIds, not both.");
  if (!keys.length) return { kind: "latest-per-dataset", ids: [] };
  const kind = keys[0],
    values = args[kind];
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > 4 ||
    new Set(values).size !== values.length ||
    values.some((v) => typeof v !== "string" || !id[kind].test(v))
  )
    throw Error("Select 1–4 distinct exact saved IDs of the requested kind.");
  return { kind, ids: values };
}
function differences(studies) {
  if (studies.length < 2) return { status: "single-study", fields: {}, missingFields: [] };
  const fields = {},
    missingFields = [];
  for (const [group, names] of Object.entries({
    parameters: [
      "entry",
      "holdDays",
      "sides",
      "sizing",
      "benchmark",
      "costBps",
      "slippageBps",
      "openTrades",
      "stopLossPct",
      "takeProfitPct",
      "cooldownDays",
    ],
    window: ["resultFrom", "resultTo", "sourceActionFrom", "sourceActionTo", "publicFrom", "publicTo"],
    timing: ["mode", "defenseDays", "civilianDays"],
  })) {
    for (const name of names) {
      const values = studies.map((s) => s[group][name]);
      if (values.some((v) => v === null || v === "unknown")) missingFields.push(`${group}.${name}`);
      if (new Set(values.map(JSON.stringify)).size > 1)
        fields[`${group}.${name}`] = Object.fromEntries(studies.map((s, i) => [s.id, values[i]]));
    }
  }
  return {
    status: Object.keys(fields).length
      ? "different-designs-or-windows"
      : missingFields.length
        ? "insufficient-fields-to-establish-equivalence"
        : "listed-fields-match-only",
    fields,
    missingFields,
  };
}
/** Deterministic inspection of frozen records. No collection, writes, execution or statistical re-analysis. */
export function auditSavedStudies(db, args = {}) {
  const choice = selection(args);
  let selectedIds = choice.ids,
    discovery = null;
  if (choice.kind !== "experimentIds") {
    const rows = auditInventory(db),
      candidates = [],
      seen = new Set();
    for (const row of rows) {
      if (!row.datasetId || (choice.kind === "datasetIds" && !choice.ids.includes(row.datasetId))) continue;
      const key = row.datasetId || row.id;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(row);
      }
    }
    selectedIds =
      choice.kind === "datasetIds"
        ? choice.ids.map((key) => candidates.find((row) => row.datasetId === key)?.id).filter(Boolean)
        : candidates.slice(0, 4).map((row) => row.id);
    discovery = {
      scope:
        "Latest 500 saved experiment metadata rows; newest saved record per pinned dataset, not best-performing result.",
      scanned: rows.length,
      scanLimit: 500,
      omittedCandidates: Math.max(0, candidates.length - selectedIds.length),
      unpinnedExperimentsNotSelected: rows.filter((row) => !row.datasetId).length,
      otherCandidateIds: candidates
        .filter((row) => !selectedIds.includes(row.id))
        .slice(0, 8)
        .map((row) => row.id),
      datasetsWithoutStudyInScope: choice.kind === "datasetIds" ? choice.ids.filter((key) => !seen.has(key)) : [],
    };
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
    comparison: differences(studies),
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
