import { hashOf } from "./research-store.mjs";

const MAX_BODY = 64 * 1024 * 1024;
/** Reads only: store initialization, source refresh and replay are deliberately outside this audit. */
function checkedBody(row, label) {
  if (!row) throw Error(`${label} not found.`);
  if (row.size > MAX_BODY) throw Error(`${label} exceeds the bounded audit size.`);
  if (hashOf(row.body) !== row.body_hash) throw Error(`${label} checksum mismatch.`);
  return JSON.parse(row.body);
}
export function auditInventory(db) {
  if (
    !db.prepare("SELECT 1 FROM pragma_database_list WHERE name='research'").get() ||
    !db.prepare("SELECT 1 FROM research.sqlite_master WHERE type='table' AND name='experiments'").get()
  )
    return [];
  return db
    .prepare(
      `SELECT e.id, e.created_at AS createdAt, substr(e.title, 1, 240) AS title,
    json_extract(r.body, '$.provenance.dataset.id') AS datasetId,
    substr(d.name, 1, 240) AS datasetName,
    substr(json_extract(d.body, '$.manifest.scope.symbols'), 1, 2048) AS symbols
    FROM research.experiments e JOIN research.runs r ON r.id=e.run_id
    LEFT JOIN research.datasets d ON d.id=json_extract(r.body, '$.provenance.dataset.id')
    ORDER BY e.created_at DESC, e.id DESC LIMIT 500`,
    )
    .all()
    .map((row) => {
      let symbols = [];
      try {
        symbols = JSON.parse(row.symbols || "[]");
      } catch {
        /* Malformed metadata cannot establish a symbol match. */
      }
      return {
        ...row,
        symbols: Array.isArray(symbols)
          ? symbols.slice(0, 8).filter((s) => typeof s === "string" && s.length <= 24)
          : [],
      };
    });
}
export function auditRecord(db, id) {
  const experiment = db
    .prepare(
      `SELECT id, created_at AS createdAt, title, run_id AS runId
    FROM research.experiments WHERE id=?`,
    )
    .get(id);
  if (!experiment) throw Error("Saved experiment not found.");
  const run = checkedBody(
    db
      .prepare(
        `SELECT CASE WHEN length(body)<=${MAX_BODY} THEN body END AS body, body_hash, length(body) AS size
    FROM research.runs WHERE id=?`,
      )
      .get(experiment.runId),
    "Saved run",
  );
  if (run.id !== experiment.runId || hashOf(run.inputs) !== run.inputHash)
    throw Error("Saved run identity or input checksum mismatch.");
  const engineRow = db
    .prepare(
      `SELECT CASE WHEN length(body)<=${MAX_BODY} THEN body END AS body, length(body) AS size FROM research.engines WHERE id=?`,
    )
    .get(run.engineId);
  if (!engineRow || engineRow.size > MAX_BODY || hashOf(JSON.parse(engineRow.body)) !== run.engineId)
    throw Error("Saved engine checksum mismatch.");
  let dataset = null;
  const ref = run.provenance?.dataset;
  if (ref) {
    dataset = checkedBody(
      db
        .prepare(
          `SELECT CASE WHEN length(body)<=${MAX_BODY} THEN body END AS body, body_hash, length(body) AS size
      FROM research.datasets WHERE id=?`,
        )
        .get(ref.id),
      "Pinned dataset",
    );
    if (dataset.id !== ref.id || dataset.version !== ref.version || dataset.contentHash !== ref.contentHash)
      throw Error("Pinned dataset does not match the saved run.");
    if (typeof dataset.rawContent === "string" && hashOf(dataset.rawContent) !== dataset.rawHash)
      throw Error("Pinned dataset original content checksum mismatch.");
  }
  return { experiment, run, dataset };
}
