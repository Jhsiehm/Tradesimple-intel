import { fieldName, scalar, WORKFLOW_LIMITS } from "./workflowProtocol.mjs";
import { own, ledger, exactKey, combinedLineage, numericDescriptor, availabilityBound } from "./workflowRows.mjs";

export function filterRows(node, table) {
  const rows = [],
    excluded = [];
  for (const row of table.rows) {
    const value = own(row, node.field);
    if (value === undefined) {
      excluded.push({ rowId: row.id, reason: "missing-filter-field" });
      continue;
    }
    if (!scalar(value)) throw Error(`Filter ${node.id} requires an own scalar field.`);
    if (["gt", "gte", "lt", "lte"].includes(node.operator)) {
      if (value === null) {
        excluded.push({ rowId: row.id, reason: "null-ordered-value" });
        continue;
      }
      if (typeof value !== "number")
        throw Error(`Filter ${node.id} cannot order a nonnumeric ${node.field}; no coercion is performed.`);
    }
    const comparisons = {
      eq: () => value === node.value,
      ne: () => value !== node.value,
      gt: () => value > node.value,
      gte: () => value >= node.value,
      lt: () => value < node.value,
      lte: () => value <= node.value,
    };
    if (comparisons[node.operator]()) rows.push(row);
    else excluded.push({ rowId: row.id, reason: "filter-condition-false" });
  }
  return { rows, ledger: ledger(table.rows.length, rows, excluded) };
}
function joinIndex(rows, fields, nodeId, side) {
  const index = new Map(),
    missing = [];
  for (const row of rows) {
    const key = exactKey(row, fields);
    if (key === null) {
      missing.push(row.id);
      continue;
    }
    if (index.has(key))
      throw Error(
        `Join ${nodeId} has duplicate ${side} keys at row IDs ${index.get(key).id} and ${row.id}; one-to-one keys are required.`,
      );
    index.set(key, row);
  }
  return { index, missing };
}
export function joinRows(node, left, right) {
  const l = joinIndex(
    left.rows,
    node.keys.map((key) => key.left),
    node.id,
    "left",
  );
  const r = joinIndex(
    right.rows,
    node.keys.map((key) => key.right),
    node.id,
    "right",
  );
  const rightFields = [...new Set(["id", ...right.rows.flatMap((row) => Object.keys(row))])]
    .filter((key) => key !== "lineage")
    .sort();
  const leftFields = new Set(left.rows.flatMap((row) => Object.keys(row)));
  for (const field of rightFields)
    if (!fieldName(`right_${field}`) || leftFields.has(`right_${field}`))
      throw Error(`Join ${node.id} has a right-field collision or field name exceeding the bound: right_${field}.`);
  if (leftFields.size + rightFields.length > WORKFLOW_LIMITS.fields)
    throw Error(`Join ${node.id} exceeds the table field budget.`);
  const rows = [],
    excluded = [],
    unmatchedLeft = [],
    matchedRight = new Set();
  for (const row of left.rows) {
    const key = exactKey(
        row,
        node.keys.map((item) => item.left),
      ),
      match = key === null ? null : r.index.get(key);
    if (!match) {
      unmatchedLeft.push(row.id);
      if (node.how === "inner") {
        excluded.push({ rowId: row.id, reason: key === null ? "missing-left-key" : "unmatched-left-key" });
        continue;
      }
    } else matchedRight.add(match.id);
    const added = Object.fromEntries(
      rightFields.map((field) => [`right_${field}`, match && Object.hasOwn(match, field) ? match[field] : null]),
    );
    rows.push({
      ...row,
      ...added,
      derivedAvailableAt: availabilityBound(row, match),
      lineage: combinedLineage(row, match),
    });
  }
  const unmatchedRight = right.rows.filter((row) => !matchedRight.has(row.id)).map((row) => row.id);
  return {
    rows,
    ledger: ledger(left.rows.length, rows, excluded, {
      rightReceived: right.rows.length,
      matchedPairs: matchedRight.size,
      unmatchedLeft,
      unmatchedRight,
      missingLeftKeys: l.missing,
      missingRightKeys: r.missing,
    }),
  };
}
export function differenceRows(node, table) {
  const rows = [],
    excluded = [];
  for (const row of table.rows) {
    for (const field of [node.output, `${node.output}_unit`, `${node.output}_metric`, `${node.output}_semantics`])
      if (Object.hasOwn(row, field)) throw Error(`Difference ${node.id} would overwrite ${field}.`);
    const left = own(row, node.left),
      right = own(row, node.right);
    if (left == null || right == null) {
      excluded.push({
        rowId: row.id,
        reason: "missing-difference-operand",
        fields: [node.left, node.right].filter((field) => own(row, field) == null),
      });
      continue;
    }
    if (typeof left !== "number" || typeof right !== "number")
      throw Error(`Difference ${node.id} requires numeric operands; no coercion is performed.`);
    const a = numericDescriptor(row, node.left),
      b = numericDescriptor(row, node.right);
    if (a.unit !== b.unit)
      throw Error(`Difference ${node.id} has incompatible units at row ${row.id}: ${a.unit} versus ${b.unit}.`);
    const value = left - right;
    if (!Number.isFinite(value)) throw Error(`Difference ${node.id} produced a nonfinite result at row ${row.id}.`);
    if (Object.keys(row).length + 4 > WORKFLOW_LIMITS.fields)
      throw Error(`Difference ${node.id} exceeds the table field budget.`);
    rows.push({
      ...row,
      [node.output]: value,
      [`${node.output}_unit`]: a.unit,
      [`${node.output}_metric`]: JSON.stringify(["difference", a.metric, b.metric]),
      [`${node.output}_semantics`]: JSON.stringify(["difference", a.semantics, b.semantics]),
      derivedAvailableAt: availabilityBound(row),
    });
  }
  return { rows, ledger: ledger(table.rows.length, rows, excluded) };
}
function compensatedMean(rows, field) {
  function sum(scale) {
    let total = 0,
      correction = 0;
    for (const row of rows) {
      const value = row[field] / scale,
        next = total + value;
      correction += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
      total = next;
      if (!Number.isFinite(total) || !Number.isFinite(correction)) return null;
    }
    return (total / rows.length + correction / rows.length) * scale;
  }
  const direct = sum(1);
  if (Number.isFinite(direct)) return direct;
  const scale = rows.reduce((maximum, row) => Math.max(maximum, Math.abs(row[field])), 0);
  const scaled = sum(scale);
  if (!Number.isFinite(scaled)) throw Error("Summary produced a nonfinite mean.");
  return scaled;
}
export function summarizeRows(node, table) {
  const groups = new Map(),
    excluded = [];
  for (const row of table.rows) {
    const missing = node.groupBy.filter((field) => !Object.hasOwn(row, field));
    if (missing.length) {
      excluded.push({ rowId: row.id, reason: "missing-group-field", fields: missing });
      continue;
    }
    if (node.groupBy.some((field) => !scalar(row[field])))
      throw Error(`Summary ${node.id} groups require scalar fields.`);
    const value = own(row, node.value);
    if (value == null) {
      excluded.push({ rowId: row.id, reason: "missing-summary-value" });
      continue;
    }
    if (typeof value !== "number")
      throw Error(`Summary ${node.id} requires numeric ${node.value}; no coercion is performed.`);
    const descriptor = numericDescriptor(row, node.value),
      key = JSON.stringify(node.groupBy.map((field) => row[field]));
    if (!groups.has(key))
      groups.set(key, {
        fields: Object.fromEntries(node.groupBy.map((field) => [field, row[field]])),
        descriptor,
        members: [],
        min: value,
        max: value,
      });
    const group = groups.get(key);
    if (JSON.stringify(group.descriptor) !== JSON.stringify(descriptor))
      throw Error(`Summary ${node.id} cannot pool mixed metrics, units or observation semantics in one group.`);
    group.min = Math.min(group.min, value);
    group.max = Math.max(group.max, value);
    group.members.push(row);
  }
  const reserved = new Set([
    "id",
    "n",
    "mean",
    "sum",
    "sumReason",
    "sum_unit",
    "sum_metric",
    "sum_semantics",
    "min",
    "max",
    "lineage",
    "memberIds",
    "derivedAvailableAt",
    "valueField",
    "semantics",
    "groupValues",
    "mean_unit",
    "mean_metric",
    "mean_semantics",
    "min_unit",
    "min_metric",
    "min_semantics",
    "max_unit",
    "max_metric",
    "max_semantics",
  ]);
  if (node.groupBy.some((field) => reserved.has(field)))
    throw Error(`Summary ${node.id} group fields collide with summary output fields.`);
  const rows = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group], index) => {
      const { unit, metric, semantics } = group.descriptor;
      const numericFields = Object.fromEntries(
        ["sum", "mean", "min", "max"].flatMap((field) => [
          [`${field}_unit`, unit],
          [`${field}_metric`, JSON.stringify([field, metric])],
          [`${field}_semantics`, semantics],
        ]),
      );
      const lineage = [],
        seen = new Set();
      for (const member of group.members)
        for (const entry of member.lineage) {
          const key = JSON.stringify(entry);
          if (!seen.has(key)) {
            seen.add(key);
            lineage.push(entry);
          }
        }
      const mean = compensatedMean(group.members, node.value);
      const total = mean * group.members.length;
      return {
        ...group.fields,
        groupValues: group.fields,
        id: `${node.id}:${index + 1}`,
        valueField: node.value,
        metric,
        unit,
        semantics,
        n: group.members.length,
        mean,
        sum: Number.isFinite(total) ? total : null,
        sumReason: Number.isFinite(total) ? null : "Sum exceeds finite numeric range; not reported.",
        min: group.min,
        max: group.max,
        ...numericFields,
        memberIds: group.members.map((row) => row.id),
        derivedAvailableAt: availabilityBound(...group.members),
        lineage,
      };
    });
  return {
    rows,
    ledger: ledger(table.rows.length, rows, excluded, {
      summarized: table.rows.length - excluded.length,
      groups: rows.length,
    }),
  };
}
