import { count, text, point, pointer, human, object } from "./researchFiguresCore.mjs";
import { auditFigureReview, auditStudyLabels } from "./researchFiguresReview.mjs";
function warnings(body, studies) {
  const notes = [
    "Recorded saved results; this inspection did not rerun a backtest or independently replay arithmetic.",
    "Historical source completeness, absence of look-ahead and before-news tradability are not established.",
  ];
  const differences = Object.keys(body.comparison?.fields || {});
  if (differences.length)
    notes.push(`Unequal designs/windows (${differences.join(", ")}); these values do not rank signal quality.`);
  if (body.comparison?.missingFields?.length)
    notes.push("Comparison fields are missing; equivalence is not established.");
  for (const study of studies) {
    const name = text(study.symbols?.join("/")) || text(study.title) || text(study.id);
    const coverage = study.coverage || {};
    notes.push(
      `${name}: collection ${text(coverage.partitionStatus, "unknown")}; ${count(coverage.completed) ?? "unknown"} of ${count(coverage.partitions) ?? "unknown"} partitions completed.`,
    );
    notes.push(
      `${name}: ${study.timing?.mode === "assumed" ? "publication delays are assumed" : `source timing is ${text(study.timing?.mode, "unknown")}`}; historical ownership is ${text(coverage.historicalOwnership, "unknown")}.`,
    );
    notes.push(
      `${name}: result period ${text(study.window?.resultFrom, "unknown")} to ${text(study.window?.resultTo, "unknown")}; cooldown ${count(study.parameters?.cooldownDays) ?? "unknown"} calendar days.`,
    );
  }
  if (body.discovery?.omittedCandidates > 0)
    notes.push(`Bounded inventory omitted ${body.discovery.omittedCandidates} candidate studies.`);
  return notes;
}

export function auditFigures(entry, body) {
  if (!Array.isArray(body.studies)) return [];
  const studies = body.studies.slice(0, 4),
    ref = entry.id;
  if (studies.some((study) => !object(study))) return [];
  if (!studies.length) return [];
  const labels = auditStudyLabels(studies),
    review = auditFigureReview(entry, body, studies, labels);
  const notes = review
    ? [
        "Recorded saved results; no new backtest or replay. Study review above states comparison, coverage and timing limits.",
      ]
    : warnings(body, studies);
  const base = {
    kind: "bar",
    xLabel: "Saved study",
    sourceRefs: [ref],
    totalPoints: studies.length,
    notes,
    ...(review ? { review } : {}),
  };
  const values = (key) =>
    studies.map((study, i) =>
      point(
        ref,
        `/studies/${i}/stats/${key}`,
        labels[i],
        study.calculation?.status === "completed-as-recorded" ? study.stats?.[key] : null,
        `${text(study.id)} · ${text(study.window?.resultFrom, "unknown")} to ${text(study.window?.resultTo, "unknown")}; recorded, not replayed`,
      ),
    );
  const figures = [
    {
      ...base,
      id: `${ref}-recorded-returns`,
      title: "Recorded portfolio and benchmark returns",
      yLabel: "Recorded return",
      unit: "return fraction",
      format: "percent",
      series: [
        { id: "portfolio", label: "Portfolio", points: values("total") },
        { id: "benchmark", label: "Benchmark", points: values("benchmarkTotal") },
      ],
    },
    {
      ...base,
      id: `${ref}-recorded-excess`,
      title: "Recorded excess returns",
      yLabel: "Portfolio minus benchmark",
      unit: "difference of return fractions",
      format: "percentage-points",
      series: [{ id: "excess", label: "Excess", points: values("excessTotal") }],
    },
  ];
  const counters = [
    ["providerReceived", "Provider receipts"],
    ["normalizedReceived", "Normalized records"],
    ["normalizedValid", "Valid normalized records"],
  ];
  figures.push({
    ...base,
    id: `${ref}-collection-counts`,
    title: "Collection and selected signals",
    yLabel: "Recorded count",
    unit: "records / signals",
    format: "number",
    notes: [
      "Receipt, normalized and signal counts overlap; they are stages, not additive portions of one total.",
      ...notes,
    ],
    series: [
      ...counters.map(([key, label]) => ({
        id: key,
        label,
        points: studies.map((study, i) =>
          point(ref, `/studies/${i}/coverage/${key}`, labels[i], count(study.coverage?.[key]), text(study.id)),
        ),
      })),
      {
        id: "signals",
        label: "Selected signals",
        points: studies.map((study, i) =>
          point(ref, `/studies/${i}/counts/signals`, labels[i], count(study.counts?.signals), text(study.id)),
        ),
      },
    ],
  });
  const perStudyReasons = studies.map((study) =>
    Object.keys(study.exclusions || {})
      .filter((key) => !["origin", "recorded", "omittedFields"].includes(key))
      .sort(),
  );
  const allReasons = [...new Set(perStudyReasons.flat())].sort();
  // Balance a bounded category preview across studies instead of letting one alphabetic prefix hide another.
  const selected = new Set();
  for (
    let index = 0;
    index < Math.max(0, ...perStudyReasons.map((keys) => keys.length)) && selected.size < 20;
    index++
  ) {
    for (const keys of perStudyReasons) {
      if (index < keys.length) selected.add(keys[index]);
      if (selected.size === 20) break;
    }
  }
  const reasons = [...selected].sort();
  if (reasons.length)
    figures.push({
      ...base,
      id: `${ref}-exclusions`,
      title: "Dataset exclusions by reason",
      xLabel: "Recorded exclusion reason",
      yLabel: "Excluded records",
      unit: "records",
      format: "number",
      totalPoints: allReasons.length,
      notes: [
        `Exclusion categories: ${reasons.length} of ${allReasons.length} known categories displayed; the bounded selection balances studies. Hidden categories are not zero.`,
        ...studies.map(
          (study, i) =>
            `Upstream omitted exclusion-counter fields: ${count(study.exclusions?.omittedFields) ?? "unknown"} (${text(study.id, `Study ${i + 1}`).slice(0, 44)}); collection ${text(study.coverage?.partitionStatus, "unknown")}; timing ${text(study.timing?.mode, "unknown")}.`,
        ),
        ...notes.slice(0, 2),
        "Collection scope, result windows and selection rules govern these counters; they do not rank signal quality.",
        "Upstream omitted fields have unknown names and overlap; they cannot be added to the known category count.",
        "Dataset exclusion counters are shown exactly as recorded; absent counters are unknown, not zero.",
      ],
      series: studies.map((study, i) => ({
        id: text(study.id, String(i)),
        label: labels[i],
        points: reasons.map((key) =>
          point(
            ref,
            `/studies/${i}/exclusions/${pointer(key)}`,
            human(key),
            count(study.exclusions?.[key]),
            text(study.id),
          ),
        ),
      })),
    });
  return figures;
}
