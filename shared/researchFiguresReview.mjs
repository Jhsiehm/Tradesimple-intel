import { count, object, text, validRef } from "./researchFiguresCore.mjs";

const statuses = ["not-directly-comparable", "listed-fields-match-only", "single-study"];
const validPath = (path) =>
  typeof path === "string" && path.startsWith("/") && path.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(path);
const known = (value) => (value === null || value === undefined || value === "unknown" ? "unknown" : String(value));
export function auditStudyLabels(studies) {
  const labels = studies.map((study) => {
    const label =
      (Array.isArray(study.symbols)
        ? study.symbols
            .map((s) => text(s))
            .filter(Boolean)
            .join("/")
        : "") ||
      text(study.title) ||
      "Study";
    return label.length > 64 ? `${label.slice(0, 61)}…` : label;
  });
  return labels.map((label, i) =>
    labels.filter((value) => value === label).length > 1 ? `${label} · ${i + 1}` : label,
  );
}
function limitedItems(items, path) {
  if (!Array.isArray(items)) return [];
  if (items.length <= 8) return items;
  return [
    ...items.slice(0, 7),
    {
      label: `${items.length - 7} additional items are preserved in the audit source; this panel is a bounded preview.`,
      path,
    },
  ];
}
export function auditFigureReview(entry, body, studies, labels) {
  const readiness = body.comparison?.readiness;
  if (!object(readiness) || !statuses.includes(readiness.status)) return undefined;
  const refs = (items, path) => limitedItems(items, path).map((item) => ({ ...item, ref: entry.id }));
  return {
    status: readiness.status,
    summary: readiness.summary,
    studies: studies.map((study, i) => {
      const c = study.coverage || {},
        t = study.timing || {},
        w = study.window || {},
        p = study.parameters || {};
      return {
        id: text(study.id),
        label: labels[i],
        ref: entry.id,
        path: `/studies/${i}`,
        coverage: `${known(c.partitionStatus)} · ${count(c.completed) ?? "unknown"}/${count(c.partitions) ?? "unknown"} partitions; historical completeness not certified.`,
        timing: `${known(t.mode)} · defense ${count(t.defenseDays) ?? "unknown"}d / civilian ${count(t.civilianDays) ?? "unknown"}d; original publication not independently verified.`,
        window: `${known(w.resultFrom)} to ${known(w.resultTo)}`,
        rules: `Benchmark ${known(p.benchmark)} · ${known(p.entry)} · hold ${known(p.holdDays)}d · cooldown ${known(p.cooldownDays)}d · cost/slippage ${known(p.costBps)}/${known(p.slippageBps)} bps`,
      };
    }),
    reasons: refs(readiness.reasons, "/comparison/readiness/reasons"),
    missingEvidence: refs(readiness.missingEvidence, "/comparison/readiness/missingEvidence"),
  };
}

/** Optional saved payload metadata is bounded plain data; old figures require no migration. */
export function cleanFigureReview(raw, sourceRefs) {
  if (!object(raw) || !statuses.includes(raw.status) || typeof raw.summary !== "string") return undefined;
  const source = (row) => object(row) && validRef(row.ref) && sourceRefs.includes(row.ref) && validPath(row.path);
  const items = (value) =>
    Array.isArray(value)
      ? value
          .slice(0, 8)
          .filter((row) => source(row) && typeof row.label === "string")
          .map((row) => ({ label: text(row.label), ref: row.ref, path: row.path }))
      : [];
  const studies = Array.isArray(raw.studies)
    ? raw.studies
        .slice(0, 4)
        .filter(
          (row) =>
            source(row) &&
            ["id", "label", "coverage", "timing", "window", "rules"].every((key) => typeof row[key] === "string"),
        )
        .map((row) => ({
          ...Object.fromEntries(
            ["id", "label", "coverage", "timing", "window", "rules"].map((key) => [key, text(row[key])]),
          ),
          ref: row.ref,
          path: row.path,
        }))
    : [];
  return {
    status: raw.status,
    summary: text(raw.summary),
    studies,
    reasons: items(raw.reasons),
    missingEvidence: items(raw.missingEvidence),
  };
}
