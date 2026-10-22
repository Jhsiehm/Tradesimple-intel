const unknown = (value) => value === null || value === undefined || value === "unknown";
const fieldsToCompare = {
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
};
const label = (study) => study.symbols?.join("/") || study.title || study.id;

/** Recorded-design checks only: no statistical re-analysis or certification of an investable effect. */
export function compareAuditStudies(studies, discovery) {
  const fields = {},
    missingFields = [];
  for (const name of ["source", "engineId"]) {
    const values = studies.map((study) => study[name]);
    if (values.some(unknown)) missingFields.push(name);
    if (new Set(values.map(JSON.stringify)).size > 1)
      fields[name] = Object.fromEntries(studies.map((study, i) => [study.id, values[i]]));
  }
  for (const [group, names] of Object.entries(fieldsToCompare)) {
    for (const name of names) {
      const values = studies.map((s) => s[group]?.[name]);
      if (values.some(unknown)) missingFields.push(`${group}.${name}`);
      if (new Set(values.map(JSON.stringify)).size > 1)
        fields[`${group}.${name}`] = Object.fromEntries(studies.map((s, i) => [s.id, values[i]]));
    }
  }
  const reasons = [],
    missingEvidence = [];
  const add = (list, text, path) => list.push({ label: text, path });
  if (discovery?.unresolvedNames?.length)
    add(
      reasons,
      `Requested studies unresolved: ${discovery.unresolvedNames.join(", ")}. Supply exact experiment IDs; no unrelated records were substituted.`,
      "/discovery/requestedNames",
    );
  if (discovery?.datasetsWithoutStudyInScope?.length)
    add(
      reasons,
      "Requested dataset IDs have no saved study in the bounded inventory. Supply an exact experiment ID or preserve the missing study.",
      "/discovery/datasetsWithoutStudyInScope",
    );
  if (studies.length < 2)
    add(
      reasons,
      studies.length
        ? "Only one saved study was resolved; a between-study comparison is unavailable."
        : "No requested saved studies were resolved; there are no recorded results to compare.",
      "/selectedIds",
    );
  if (Object.keys(fields).length)
    add(
      reasons,
      `Recorded designs/windows differ: ${Object.keys(fields).join(", ")}. Align these fields before attributing return differences to a signal.`,
      "/comparison/fields",
    );
  if (missingFields.length)
    add(
      reasons,
      `Required comparison fields are absent: ${missingFields.join(", ")}. Missing fields do not establish equivalence.`,
      "/comparison/missingFields",
    );
  for (const [index, study] of studies.entries()) {
    const name = label(study),
      prefix = `/studies/${index}`;
    if (study.coverage.partitionStatus !== "count-reconciled-within-declared-scope")
      add(
        reasons,
        `${name}: collection is ${study.coverage.partitionStatus}; repair incomplete partitions or record a reconciled, explicitly bounded collection scope.`,
        `${prefix}/coverage`,
      );
    if (
      study.calculation.status !== "completed-as-recorded" ||
      ["total", "benchmarkTotal", "excessTotal"].some((key) => unknown(study.stats[key]))
    )
      add(
        reasons,
        `${name}: completed portfolio/benchmark/excess statistics are absent or incomplete. Preserve a completed result before comparing returns.`,
        `${prefix}/calculation`,
      );
    if (study.timing.mode !== "verified")
      add(
        missingEvidence,
        `${name}: preserve independently supported historical public-availability timestamps and an archived news baseline before testing a before-news claim. Current timing is ${study.timing.mode}.`,
        `${prefix}/timing`,
      );
    if (study.coverage.historicalOwnership !== "verified")
      add(
        missingEvidence,
        `${name}: validate company/entity ownership as of each event date and preserve mappings; current historical ownership is ${study.coverage.historicalOwnership}.`,
        `${prefix}/coverage/historicalOwnership`,
      );
  }
  if (studies.length)
    add(
      missingEvidence,
      "Replay pinned calculations separately and preserve the replay result; this inspection only checks saved evidence integrity and recorded values.",
      "/claimLimits/replayPerformed",
    );
  const notComparable = reasons.some((reason) => reason.path !== "/selectedIds");
  const readinessStatus =
    notComparable || !studies.length
      ? "not-directly-comparable"
      : studies.length < 2
        ? "single-study"
        : "listed-fields-match-only";
  const summary =
    readinessStatus === "not-directly-comparable"
      ? "Recorded results can be inspected, but selection, coverage, missing fields or unequal designs prevent a direct signal-quality comparison."
      : readinessStatus === "single-study"
        ? "One saved result can be described; a between-study comparison is unavailable."
        : "Listed recorded design fields match. This permits a descriptive comparison only; it does not establish causality, predictive skill, historical tradability or superior signal quality.";
  return {
    status:
      studies.length < 2
        ? "single-study"
        : Object.keys(fields).length
          ? "different-designs-or-windows"
          : missingFields.length
            ? "insufficient-fields-to-establish-equivalence"
            : "listed-fields-match-only",
    fields,
    missingFields,
    readiness: { status: readinessStatus, summary, reasons, missingEvidence },
  };
}
