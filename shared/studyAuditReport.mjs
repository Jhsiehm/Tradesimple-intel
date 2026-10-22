import { savedAuditResults } from "./studyAuditClaims.mjs";

const cell = (value) =>
  String(value ?? "unknown")
    .replace(/[|\n\r`]/g, " ")
    .replace(/\[/g, "［")
    .replace(/\]/g, "］");
const number = (value) => (typeof value === "number" && Number.isFinite(value) ? String(value) : "unknown");
const percent = (value) =>
  typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "unknown";
const points = (value) =>
  typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)} percentage points` : "unknown";
const ledger = (value) =>
  Object.entries(value || {})
    .filter(([key]) => !["origin", "recorded", "omittedFields"].includes(key))
    .map(([key, count]) => `${key}: ${number(count)}`)
    .join("; ") || "not recorded";

/** Conservative fallback when a model's saved-study narrative retains grounding errors after revision. */
export function studyAuditReport(evidence) {
  const audits = savedAuditResults(evidence);
  if (!audits.some((audit) => audit.body.studies.length)) return null;
  const lines = [
    "The narrative retained verification problems, so this answer shows the recorded evidence and its limits. It is an inspection of saved results; no new backtest or calculation replay was performed.",
  ];
  for (const { id, body } of audits) {
    if (body.selection === "latest-per-dataset")
      lines.push(
        "",
        `These records were automatically selected from a bounded inventory; selection did not verify the requested study names. This report describes that inventory and cannot resolve a named-study comparison when its requested records are absent. [${id}]`,
      );
    for (const study of body.studies) {
      const ref = `[${id}]`,
        coverage = study.coverage || {},
        stats = study.stats || {},
        rules = study.parameters || {};
      lines.push(
        "",
        `${cell(study.title || study.id)} — ${cell(study.id)}. ${ref}`,
        "",
        "| Recorded measure | Value | Ref |",
        "|---|---|---|",
        `| Calculation | ${cell(study.calculation?.status)}; arithmetic not replayed | ${ref} |`,
        `| Collection | ${cell(coverage.partitionStatus)}; completed partitions ${number(coverage.completed)} of ${number(coverage.partitions)} | ${ref} |`,
        `| Provider receipts | ${number(coverage.providerReceived)} | ${ref} |`,
        `| Normalized received records | ${number(coverage.normalizedReceived)} | ${ref} |`,
        `| Normalized valid records | ${number(coverage.normalizedValid)} | ${ref} |`,
        `| Ambiguous versions | ${number(coverage.ambiguousVersions)} | ${ref} |`,
        `| Selected signals | ${number(study.counts?.signals)} | ${ref} |`,
        `| Portfolio / benchmark / excess | ${percent(stats.total)} / ${percent(stats.benchmarkTotal)} / ${points(stats.excessTotal)} | ${ref} |`,
        `| Benchmark | ${cell(rules.benchmark)} | ${ref} |`,
        `| Result period | ${cell(study.window?.resultFrom)} to ${cell(study.window?.resultTo)} | ${ref} |`,
        `| Cooldown / holding period | ${number(rules.cooldownDays)} / ${number(rules.holdDays)} calendar days | ${ref} |`,
        "",
        `Dataset exclusions — ${cell(ledger(study.exclusions))}; omitted counters: ${number(study.exclusions?.omittedFields)}. ${ref}`,
        `Run exclusions — ${cell(ledger(study.runExclusions))}; omitted counters: ${number(study.runExclusions?.omittedFields)}. ${ref}`,
        `Publication policy: ${cell(study.timing?.mode)}; defense delay ${number(study.timing?.defenseDays)} days, civilian delay ${number(study.timing?.civilianDays)} days; historical ownership ${cell(coverage.historicalOwnership)}. ${ref}`,
        `Historical completeness, publication timing, before-news tradability and absence of look-ahead bias are not established by this audit. ${ref}`,
      );
      if (study.archivedCaveats?.sourceSemanticMismatch)
        lines.push(
          `Archived caveats contain inapplicable stock-filing terminology; those labels are not valid procurement findings. ${ref}`,
        );
    }
    const fields = Object.keys(body.comparison?.fields || {});
    if (fields.length)
      lines.push(
        "",
        `Comparison differences: ${fields.map(cell).join(", ")}; headline returns do not establish superior signal quality. ${`[${id}]`}`,
      );
    if (body.comparison?.missingFields?.length)
      lines.push(
        `Comparison fields missing: ${body.comparison.missingFields.map(cell).join(", ")}; equivalence is not established. [${id}]`,
      );
    lines.push(
      `This supports description of saved results and assumptions, not causal effects, predictive skill or an investable edge. [${id}]`,
    );
    if (body.discovery)
      lines.push(
        `Discovery covers the latest ${number(body.discovery.scanLimit)} saved experiment metadata rows; omitted candidate studies: ${number(body.discovery.omittedCandidates)}. [${id}]`,
      );
  }
  return lines.join("\n");
}
