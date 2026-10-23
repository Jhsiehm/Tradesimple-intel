import { researchStore, hashOf, newId } from "../research-store.mjs";
import { verifySourceReferences } from "./sources.mjs";

export const RECORD_BYTES = 36 * 1024 * 1024;
const ready = new WeakSet();
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function workflowStore(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.workflow_revisions (
    id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, protocol_hash TEXT NOT NULL,
    body_hash TEXT NOT NULL, body TEXT NOT NULL, summary_hash TEXT NOT NULL, summary TEXT NOT NULL,
    PRIMARY KEY(id,revision));
    DROP INDEX IF EXISTS research.workflow_protocol_identity;
    CREATE UNIQUE INDEX IF NOT EXISTS research.workflow_root_identity ON workflow_revisions(protocol_hash)
      WHERE revision=1 AND json_extract(body,'$.parentId') IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS research.workflow_child_identity ON workflow_revisions(
      protocol_hash,json_extract(body,'$.parentId'),json_extract(body,'$.parentRevision'),json_extract(body,'$.amendment'))
      WHERE revision=1 AND json_extract(body,'$.parentId') IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS research.workflow_revisions_update BEFORE UPDATE ON workflow_revisions
      BEGIN SELECT RAISE(ABORT,'Workflow investigation revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS research.workflow_revisions_delete BEFORE DELETE ON workflow_revisions
      BEGIN SELECT RAISE(ABORT,'Workflow investigation revisions are immutable'); END;`);
  ready.add(db);
}

export function verifyWorkflowRecord(record, { lookupSnapshot } = {}) {
  if (
    !record ||
    record.schemaVersion !== 1 ||
    !/^inv_[a-f0-9]{32}$/.test(record.id) ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1 ||
    record.revision > 100 ||
    !["draft", "blocked", "failed", "completed", "empty"].includes(record.status) ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !Number.isFinite(Date.parse(record.updatedAt)) ||
    hashOf(record.protocol) !== record.protocolHash ||
    !digest(record.protocolHash) ||
    (record.revision === 1 ? record.previousHash !== null : !digest(record.previousHash))
  )
    throw Error("Workflow investigation metadata or protocol checksum mismatch.");
  if (
    record.parentId !== undefined &&
    (!/^inv_[a-f0-9]{32}$/.test(record.parentId) ||
      record.parentId === record.id ||
      !Number.isSafeInteger(record.parentRevision) ||
      record.parentRevision < 1 ||
      record.parentRevision > 100 ||
      typeof record.amendment !== "string" ||
      !record.amendment.trim() ||
      record.amendment.length > 8000)
  )
    throw Error("Workflow amendment lineage is invalid.");
  const evaluation = record.evaluation;
  if (evaluation) {
    if (
      record.revision < 2 ||
      evaluation.baseRevision !== record.revision - 1 ||
      hashOf(evaluation.inputs) !== evaluation.inputHash ||
      hashOf(record.result) !== evaluation.resultHash ||
      hashOf(evaluation.engineFiles) !== evaluation.engineHash ||
      hashOf(evaluation.originals) !== evaluation.originalsHash ||
      hashOf(evaluation.inputs.protocol) !== record.protocolHash ||
      record.result.status !== record.status ||
      !["completed", "empty", "blocked"].includes(record.result.status) ||
      record.result.claimScope !== "descriptive" ||
      (record.result.status === "blocked" && record.result.executed !== false)
    )
      throw Error("Workflow frozen inputs, engine, result or status checksum mismatch.");
    const names = Object.keys(evaluation.engineFiles);
    if (
      !names.includes("workflow.mjs") ||
      !names.includes("observationSources.mjs") ||
      names.some(
        (name) =>
          !/^(workflow[A-Za-z]*|observationSources)\.mjs$/.test(name) ||
          typeof evaluation.engineFiles[name] !== "string",
      )
    )
      throw Error("Workflow engine manifest is invalid.");
  } else {
    const initial = record.revision === 1 && ["draft", "blocked"].includes(record.status) && !record.attempt;
    const failed =
      record.revision > 1 &&
      record.status === "failed" &&
      record.attempt?.baseRevision === record.revision - 1 &&
      digest(record.attempt.inputHash) &&
      digest(record.attempt.engineHash) &&
      typeof record.attempt.error === "string";
    if (record.result !== null || (!initial && !failed)) throw Error("Workflow unevaluated status is invalid.");
  }
  verifySourceReferences(record, lookupSnapshot);
  return record;
}

function summarize(record) {
  return {
    id: record.id,
    revision: record.revision,
    title: record.protocol.title,
    question: record.protocol.question,
    family: record.protocol.family,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    from: record.protocol.from,
    to: record.protocol.to,
    protocolHash: record.protocolHash,
    ...(record.parentId
      ? { parentId: record.parentId, parentRevision: record.parentRevision, amendment: record.amendment }
      : {}),
    archiveAvailable: Boolean(record.evaluation),
    executed: record.result?.executed || false,
  };
}

export function decodeWorkflowRow(row, options = {}) {
  if (
    !row ||
    typeof row.body !== "string" ||
    Buffer.byteLength(row.body) > RECORD_BYTES ||
    hashOf(row.body) !== row.body_hash ||
    hashOf(row.summary) !== row.summary_hash
  )
    throw Error("Workflow investigation or summary checksum mismatch.");
  const record = verifyWorkflowRecord(JSON.parse(row.body), options);
  if (
    record.id !== row.id ||
    record.revision !== row.revision ||
    record.updatedAt !== row.created_at ||
    record.protocolHash !== row.protocol_hash ||
    hashOf(summarize(record)) !== hashOf(JSON.parse(row.summary))
  )
    throw Error("Workflow investigation index or summary mismatch.");
  return record;
}

export function readWorkflowHistory(db, id, lookupSnapshot) {
  workflowStore(db);
  const rows = db.prepare("SELECT * FROM research.workflow_revisions WHERE id=? ORDER BY revision").all(id);
  if (!rows.length) throw Error("Workflow investigation not found.");
  return verifyWorkflowRows(rows, { lookupSnapshot });
}

export function verifyWorkflowRows(rows, { lookupSnapshot } = {}) {
  if (rows.length > 100) throw Error("Workflow revision chain exceeds its lifecycle.");
  const last = rows.at(-1);
  if (!last || hashOf(last.body) !== last.body_hash) throw Error("Workflow investigation checksum mismatch.");
  const originals = JSON.parse(last.body).evaluation?.originals || {};
  const lookup = (id) => originals[id] || lookupSnapshot?.(id);
  const records = [];
  for (const row of rows) {
    const record = decodeWorkflowRow(row, { lookupSnapshot: lookup });
    const prior = records.at(-1);
    if (
      record.revision !== records.length + 1 ||
      record.previousHash !== (prior ? hashOf(prior) : null) ||
      (prior &&
        (prior.protocolHash !== record.protocolHash ||
          prior.createdAt !== record.createdAt ||
          prior.parentId !== record.parentId ||
          prior.parentRevision !== record.parentRevision ||
          prior.amendment !== record.amendment ||
          hashOf(prior.sourceRefs) !== hashOf(record.sourceRefs) ||
          hashOf(prior.sourceIssues) !== hashOf(record.sourceIssues)))
    )
      throw Error("Workflow investigation revision chain mismatch.");
    if (prior?.evaluation) throw Error("A frozen workflow evaluation cannot be overwritten.");
    records.push(record);
  }
  return records;
}

export function saveWorkflowRecord(db, input, expectedRevision = 0) {
  workflowStore(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!expectedRevision) {
      const existing = db
        .prepare(
          `SELECT id FROM research.workflow_revisions WHERE protocol_hash=? AND revision=1
          AND json_extract(body,'$.parentId') IS ? AND json_extract(body,'$.parentRevision') IS ?
          AND json_extract(body,'$.amendment') IS ?`,
        )
        .get(input.protocolHash, input.parentId || null, input.parentRevision || null, input.amendment || null);
      if (existing) {
        db.exec("COMMIT");
        return { existing: existing.id };
      }
    }
    const id = input.id || newId("inv");
    const prior = db
      .prepare("SELECT revision,body_hash FROM research.workflow_revisions WHERE id=? ORDER BY revision DESC LIMIT 1")
      .get(id);
    if ((prior?.revision || 0) !== expectedRevision)
      throw Error("This workflow investigation changed. Reload before trying again.");
    const record = { ...input, id, revision: expectedRevision + 1, previousHash: prior?.body_hash || null };
    const body = JSON.stringify(record),
      summary = JSON.stringify(summarize(record));
    if (Buffer.byteLength(body) > RECORD_BYTES) throw Error("Workflow frozen record exceeds 36 MiB. Narrow the study.");
    db.prepare("INSERT INTO research.workflow_revisions VALUES (?,?,?,?,?,?,?,?)").run(
      id,
      record.revision,
      record.updatedAt,
      record.protocolHash,
      hashOf(body),
      body,
      hashOf(summary),
      summary,
    );
    db.exec("COMMIT");
    return { record };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function workflowSummaries(db) {
  workflowStore(db);
  return db
    .prepare(
      `SELECT p.id,p.revision,p.protocol_hash,p.created_at,p.summary,p.summary_hash
    FROM research.workflow_revisions p JOIN (SELECT id,MAX(revision) revision FROM research.workflow_revisions GROUP BY id) latest
    ON p.id=latest.id AND p.revision=latest.revision ORDER BY p.created_at DESC,p.id DESC LIMIT 100`,
    )
    .all()
    .map((row) => {
      if (hashOf(row.summary) !== row.summary_hash) throw Error("Workflow summary checksum mismatch.");
      const item = JSON.parse(row.summary);
      if (
        item.id !== row.id ||
        item.revision !== row.revision ||
        item.protocolHash !== row.protocol_hash ||
        item.updatedAt !== row.created_at
      )
        throw Error("Workflow summary index mismatch.");
      return item;
    });
}

export function findWorkflowByProtocol(db, protocolHash) {
  workflowStore(db);
  return db
    .prepare(
      "SELECT id FROM research.workflow_revisions WHERE protocol_hash=? AND revision=1 AND json_extract(body,'$.parentId') IS NULL",
    )
    .get(protocolHash)?.id;
}

export { workflowView } from "./view.mjs";
