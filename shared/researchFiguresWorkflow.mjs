import { numericDescriptor } from "./workflowRows.mjs";
import { FIGURE_LIMITS, count, text, number, object, pointer, point } from "./researchFiguresCore.mjs";

function rowLabel(row, index) {
  if (object(row.groupValues)) {
    const fields = Object.entries(row.groupValues)
      .slice(0, 5)
      .map(([key, value]) => `${text(key)}: ${value === null ? "missing" : text(String(value))}`);
    if (fields.length) return fields.join(" · ");
  }
  const entity = text(row.entityId) || text(row.id) || `Row ${index + 1}`;
  return row.eventAt ? `${entity} · ${text(row.eventAt)}` : entity;
}
function numericGroups(rows, field, ref, root) {
  const groups = new Map();
  for (const [index, row] of rows.slice(0, FIGURE_LIMITS.rows).entries()) {
    if (!object(row) || !Object.hasOwn(row, field) || (row[field] !== null && number(row[field]) === null)) continue;
    let descriptor;
    try {
      descriptor = numericDescriptor(row, field);
    } catch {
      continue;
    }
    const { unit, metric, semantics } = descriptor;
    const key = JSON.stringify([unit, metric, semantics]);
    if (!groups.has(key)) groups.set(key, { unit, metric, semantics, points: [] });
    groups
      .get(key)
      .points.push(
        point(
          ref,
          `${root}/${index}/${pointer(field)}`,
          rowLabel(row, index),
          row[field],
          `Row ${text(row.id, String(index + 1))}${count(row.n) !== null ? `; n=${row.n}` : ""}; metric ${text(metric)}; semantics ${text(semantics)}`,
        ),
      );
  }
  return [...groups.values()].slice(0, 6);
}
function outputFigures(entry, rows, field, root, totalRows, title, notes, id) {
  return numericGroups(rows, field, entry.id, root).map((group, index) => ({
    id: `${entry.id}-${id}-${index}`,
    title: `${text(title)} · ${text(group.metric)}`,
    kind: "bar",
    xLabel: "Observation / group",
    yLabel: text(group.metric),
    unit: text(group.unit),
    format: "number",
    totalPoints: count(totalRows) ?? rows.length,
    sourceRefs: [entry.id],
    notes: [
      ...notes,
      `Explicit unit: ${text(group.unit)}. Distinct metrics, units and observation semantics are kept in separate figures.`,
      `Observation semantics: ${text(group.semantics)}.`,
    ],
    series: [{ id: field, label: text(group.metric), points: group.points }],
  }));
}

export function workflowFigures(entry, body) {
  const record = body.investigation,
    result = record?.result;
  if (
    !object(record) ||
    record.status !== "completed" ||
    !result ||
    result.status !== "completed" ||
    result.executed !== true ||
    result.claimScope !== "descriptive" ||
    record.protocol?.family !== "descriptive" ||
    !object(result.outputs)
  )
    return [];
  const notes = [
    "Recorded executed descriptive workflow output; this view did not independently replay the calculation.",
  ];
  if (record.protocol.knownAt)
    notes.push(
      `Knowledge cutoff: ${text(record.protocol.knownAt)}; source availability assertions are not independently certified.`,
    );
  for (const limitation of Array.isArray(result.limitations) ? result.limitations.slice(0, 4) : [])
    notes.push(text(limitation));
  for (const step of Array.isArray(result.steps) ? result.steps.slice(0, 8) : []) {
    if (count(step.ledger?.excluded) > 0)
      notes.push(`${text(step.id)}: ${step.ledger.excluded} rows excluded; inspect the saved ledger for reasons.`);
    if (step.source?.coverage?.partial || step.source?.coverage?.rejected > 0)
      notes.push(
        `${text(step.id)}: source coverage has rejected or partial records; descriptive results do not establish complete coverage.`,
      );
  }
  const figures = [];
  for (const [outputId, output] of Object.entries(result.outputs).slice(0, 6)) {
    if (!object(output)) continue;
    const node = record.protocol.nodes?.find((item) => item.id === outputId);
    if (!node) continue;
    const field = node.op === "summarize" ? "mean" : node.op === "difference" ? node.output : "value";
    const full = Array.isArray(output.rows),
      rows = full ? output.rows : output.preview;
    if (!Array.isArray(rows) || !rows.length) continue;
    const totalRows = full ? (count(output.count) ?? rows.length) : (count(output.rowCount) ?? rows.length);
    figures.push(
      ...outputFigures(
        entry,
        rows,
        field,
        `/investigation/result/outputs/${pointer(outputId)}/${full ? "rows" : "preview"}`,
        totalRows,
        `${text(record.protocol.title, "Descriptive output")} · ${text(outputId)}`,
        notes,
        `workflow-${pointer(outputId)}`,
      ),
    );
    if (figures.length >= 6) break;
  }
  return figures;
}

export function observationFigures(entry, body) {
  const snapshot = body.snapshot;
  if (!object(snapshot) || !Array.isArray(snapshot.preview) || !snapshot.preview.length) return [];
  const notes = [
    "Saved observation preview; no calculation, source refresh or independent data validation was performed.",
    "Import coverage and publication dates are source assertions; historical completeness is not certified.",
  ];
  if (Array.isArray(snapshot.caveats))
    notes.push(...snapshot.caveats.slice(0, 4).filter((item) => typeof item === "string"));
  return outputFigures(
    entry,
    snapshot.preview,
    "value",
    "/snapshot/preview",
    count(snapshot.totalRows) ?? snapshot.preview.length,
    text(snapshot.name, "Saved observations"),
    notes,
    "observations",
  );
}
