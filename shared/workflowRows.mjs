import { plainObject, plainArray, fieldName, scalar, workflowTime, WORKFLOW_LIMITS } from "./workflowProtocol.mjs";

export const own = (row, field) => (Object.hasOwn(row, field) ? row[field] : undefined);
export const rowIds = (rows) => rows.map((row) => row.id);
export function ledger(received, rows, excluded = [], extra = {}) {
  return { received, retained: rows.length, excluded: excluded.length, excludedRows: excluded, ...extra };
}
export function boundedJson(value, bytes, label) {
  let visited = 0;
  function inspect(item, depth) {
    if (++visited > 500000 || depth > 20) throw Error(`${label} exceeds structural bounds.`);
    if (typeof item === "number" && !Number.isFinite(item)) throw Error(`${label} requires finite numeric scalars.`);
    if (scalar(item)) return;
    if (Array.isArray(item)) {
      plainArray(item, label);
      for (const child of item) inspect(child, depth + 1);
      return;
    }
    plainObject(item, label);
    for (const child of Object.values(item)) inspect(child, depth + 1);
  }
  inspect(value, 0);
  const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (size > bytes) throw Error(`${label} exceeds its byte budget.`);
  return size;
}
export function sourceRows(node, source, protocol) {
  plainObject(source, `Source ${node.id}`);
  if (source.snapshotId !== node.snapshotId || source.mode !== node.mode)
    throw Error(`Source ${node.id} does not match its pinned snapshot and revision mode.`);
  if (!Array.isArray(source.rows) || source.rows.length > WORKFLOW_LIMITS.rows)
    throw Error(`Source ${node.id} exceeds 5,000 rows or has no row array.`);
  plainObject(source.provenance, `Source ${node.id} provenance`);
  plainObject(source.coverage, `Source ${node.id} coverage`);
  if (!Array.isArray(source.decisions)) throw Error(`Source ${node.id} requires frozen revision decisions.`);
  const cutoff = workflowTime(protocol.knownAt).end,
    from = workflowTime(protocol.from).start,
    to = workflowTime(protocol.to).end;
  const rows = [],
    excluded = [],
    ids = new Set();
  for (const raw of source.rows) {
    plainObject(raw, `Source ${node.id} row`);
    const fields = Object.keys(raw);
    if (
      fields.length > WORKFLOW_LIMITS.fields ||
      fields.some(
        (key) =>
          !fieldName(key) ||
          ["lineage", "derivedAvailableAt"].includes(key) ||
          !scalar(raw[key]) ||
          (typeof raw[key] === "string" && raw[key].length > 4000),
      )
    )
      throw Error(
        `Source ${node.id} rows require bounded own scalar fields; lineage and derivedAvailableAt are reserved.`,
      );
    if (typeof raw.id !== "string" || !raw.id || raw.id.length > 200 || ids.has(raw.id))
      throw Error(`Source ${node.id} requires distinct row IDs.`);
    ids.add(raw.id);
    for (const key of ["entityId", "metric", "unit"])
      if (typeof own(raw, key) !== "string" || !raw[key].trim() || raw[key].length > 200)
        throw Error(`Source ${node.id} row ${raw.id} requires ${key}.`);
    if (!Object.hasOwn(raw, "value") || (raw.value !== null && typeof raw.value !== "number"))
      throw Error(`Source ${node.id} row ${raw.id} requires a finite numeric value or null.`);
    if (Object.hasOwn(raw, "observationType") && !["forecast", "realized"].includes(raw.observationType))
      throw Error(`Source ${node.id} row ${raw.id} has an invalid observation type.`);
    if (raw.observationType === "forecast" && !workflowTime(raw.targetAt))
      throw Error(`Source ${node.id} row ${raw.id} requires a valid forecast target.`);
    const event = workflowTime(own(raw, "eventAt")),
      available = workflowTime(own(raw, "availableAt"));
    let reason = !event
      ? "unknown-or-invalid-event-time"
      : !available
        ? "unknown-or-invalid-availability"
        : available.end > cutoff
          ? "not-known-at-cutoff"
          : event.start < from || event.end > to
            ? "outside-event-period"
            : null;
    if (!reason && own(raw, "status") === "retracted") reason = "retracted";
    if (reason) {
      excluded.push({ rowId: raw.id, reason });
      continue;
    }
    rows.push({ ...raw, lineage: [{ nodeId: node.id, snapshotId: node.snapshotId, rowId: raw.id }] });
  }
  return {
    rows,
    ledger: ledger(source.rows.length, rows, excluded),
    source: {
      snapshotId: node.snapshotId,
      mode: node.mode,
      provenance: source.provenance,
      coverage: source.coverage,
      decisions: source.decisions,
    },
  };
}
export function numericDescriptor(row, field) {
  const explicit = field !== "value" && Object.hasOwn(row, `${field}_unit`) && Object.hasOwn(row, `${field}_metric`);
  const unitField =
    field === "value"
      ? "unit"
      : explicit
        ? `${field}_unit`
        : field.endsWith("_value")
          ? `${field.slice(0, -6)}_unit`
          : `${field}_unit`;
  const metricField =
    field === "value"
      ? "metric"
      : explicit
        ? `${field}_metric`
        : field.endsWith("_value")
          ? `${field.slice(0, -6)}_metric`
          : `${field}_metric`;
  const unit = own(row, unitField),
    metric = own(row, metricField);
  if (typeof unit !== "string" || !unit.trim() || typeof metric !== "string" || !metric.trim())
    throw Error(`Numeric field ${field} requires explicit ${unitField} and ${metricField} descriptors.`);
  const prefix = field === "value" ? "" : field.endsWith("_value") ? `${field.slice(0, -6)}_` : `${field}_`;
  const semantics =
    own(row, `${field}_semantics`) ??
    JSON.stringify([own(row, `${prefix}observationType`) ?? "realized", own(row, `${prefix}targetAt`) ?? null]);
  if (typeof semantics !== "string") throw Error(`Numeric field ${field} has invalid observation semantics.`);
  return { unit, metric, semantics };
}
export function combinedLineage(left, right) {
  const entries = [...left.lineage, ...(right?.lineage || [])],
    seen = new Set();
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function availabilityBound(...rows) {
  const ends = rows
    .filter(Boolean)
    .map((row) => workflowTime(own(row, "derivedAvailableAt") ?? own(row, "availableAt"))?.end);
  if (ends.some((value) => !Number.isFinite(value)))
    throw Error("Derived rows require all operand availability bounds.");
  return new Date(Math.max(...ends)).toISOString();
}
export function exactKey(row, fields) {
  const values = fields.map((field) => own(row, field));
  if (values.some((value) => value !== undefined && !scalar(value)))
    throw Error("Exact join/group keys must be own scalar values.");
  return values.some((value) => value === null || value === undefined) ? null : JSON.stringify(values);
}
