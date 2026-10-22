import {
  FIGURE_LIMITS,
  evidenceBody,
  finishFigure,
  object,
  text,
  count,
  finite,
  validRef,
} from "./researchFiguresCore.mjs";
import { auditFigures } from "./researchFiguresAudit.mjs";
import { workflowFigures, observationFigures } from "./researchFiguresWorkflow.mjs";
import { backtestFigures } from "./researchFiguresLegacy.mjs";

const adapters = {
  research_audit_saved_studies: auditFigures,
  research_run_investigation: workflowFigures,
  research_inspect_investigation: workflowFigures,
  research_sources: observationFigures,
  run_backtest: backtestFigures,
};
const priority = (tool) => (tool === "research_sources" ? 3 : tool === "research_inspect_investigation" ? 2 : 1);

/** Deterministic projections of successful current-turn tool evidence, never model chart specifications. */
export function researchFigures(evidence, rawBodies = new Map()) {
  if (!Array.isArray(evidence)) return [];
  const figures = [],
    seenRecords = new Set();
  const candidates = evidence
    .slice(-FIGURE_LIMITS.evidence)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => priority(a.entry?.tool) - priority(b.entry?.tool) || b.index - a.index);
  for (const { entry } of candidates) {
    const adapter = adapters[entry?.tool];
    if (!Object.hasOwn(adapters, entry?.tool) || typeof adapter !== "function") continue;
    const body = evidenceBody(entry, rawBodies);
    if (!body) continue;
    const record = body.investigation;
    const recordKey = record?.id && record?.revision ? `${record.id}:${record.revision}` : null;
    if (recordKey && seenRecords.has(recordKey)) continue;
    try {
      for (const raw of adapter(entry, body)) {
        const figure = finishFigure(raw);
        if (figure) figures.push(figure);
        if (figures.length === FIGURE_LIMITS.figures) return cleanResearchFigures(figures);
      }
      if (recordKey) seenRecords.add(recordKey);
    } catch {
      /* A malformed result is not a license to infer missing figure data. */
    }
  }
  return cleanResearchFigures(figures);
}

/** Saved-chat migration and client defense: accept a bounded plain data contract only. */
export function cleanResearchFigures(raw) {
  if (!Array.isArray(raw)) return [];
  const figures = [],
    seen = new Set();
  for (const figure of raw.slice(0, FIGURE_LIMITS.figures)) {
    if (
      !object(figure) ||
      !["bar", "line", "scatter"].includes(figure.kind) ||
      !["number", "percent", "percentage-points"].includes(figure.format) ||
      ["id", "title", "xLabel", "yLabel", "unit"].some(
        (key) => typeof figure[key] !== "string" || !figure[key].trim(),
      ) ||
      !Array.isArray(figure.series) ||
      count(figure.totalPoints) === null ||
      seen.has(figure.id)
    )
      continue;
    const series = [],
      seriesIds = new Set();
    let remaining = FIGURE_LIMITS.points;
    for (const item of figure.series.slice(0, 8)) {
      if (
        !object(item) ||
        typeof item.id !== "string" ||
        !item.id ||
        typeof item.label !== "string" ||
        !Array.isArray(item.points) ||
        seriesIds.has(item.id)
      )
        continue;
      const points = [];
      for (const p of item.points.slice(0, remaining)) {
        if (
          !object(p) ||
          typeof p.label !== "string" ||
          !(typeof p.x === "string" || finite(p.x)) ||
          !(p.y === null || finite(p.y)) ||
          !validRef(p.ref) ||
          typeof p.path !== "string" ||
          !p.path.startsWith("/") ||
          p.path.length > 1024
        )
          continue;
        points.push({
          label: text(p.label),
          x: typeof p.x === "string" ? text(p.x) : p.x,
          y: p.y,
          ref: p.ref,
          path: p.path,
          ...(typeof p.detail === "string" ? { detail: text(p.detail) } : {}),
        });
      }
      remaining -= points.length;
      if (points.length) {
        series.push({ id: text(item.id), label: text(item.label), points });
        seriesIds.add(item.id);
      }
    }
    if (!series.some((item) => item.points.some((p) => finite(p.y)))) continue;
    const clean = finishFigure({
      id: text(figure.id),
      title: text(figure.title),
      kind: figure.kind,
      xLabel: text(figure.xLabel),
      yLabel: text(figure.yLabel),
      unit: text(figure.unit),
      ...(typeof figure.xUnit === "string" ? { xUnit: text(figure.xUnit) } : {}),
      format: figure.format,
      series,
      totalPoints: figure.totalPoints,
      notes: Array.isArray(figure.notes) ? figure.notes.slice(0, 16).filter((note) => typeof note === "string") : [],
    });
    if (clean) {
      figures.push(clean);
      seen.add(figure.id);
    }
  }
  return figures;
}
