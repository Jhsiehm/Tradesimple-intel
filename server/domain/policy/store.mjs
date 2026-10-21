/** Append-only investigation revisions in the existing durable research database. */
import { researchStore, hashOf, newId } from '../research-store.mjs';

const initialized = new WeakSet();

function initialize(db) {
  researchStore(db);
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS research.policy_revisions (
      id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL,
      body_hash TEXT NOT NULL, body TEXT NOT NULL, summary TEXT, summary_hash TEXT,
      PRIMARY KEY(id, revision)
    );
    CREATE TRIGGER IF NOT EXISTS research.policy_revisions_update BEFORE UPDATE ON policy_revisions
      BEGIN SELECT RAISE(ABORT, 'Policy investigation revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS research.policy_revisions_delete BEFORE DELETE ON policy_revisions
      BEGIN SELECT RAISE(ABORT, 'Policy investigation revisions are immutable'); END;
  `);
  const columns = db.prepare('PRAGMA research.table_info(policy_revisions)').all();
  if (!columns.some(column => column.name === 'summary')) db.exec('ALTER TABLE research.policy_revisions ADD COLUMN summary TEXT');
  if (!columns.some(column => column.name === 'summary_hash')) db.exec('ALTER TABLE research.policy_revisions ADD COLUMN summary_hash TEXT');
  initialized.add(db);
}

export function getPolicyRecord(db, id, revision = null) {
  initialize(db);
  const row = revision === null
    ? db.prepare('SELECT body, body_hash FROM research.policy_revisions WHERE id=? ORDER BY revision DESC LIMIT 1').get(id)
    : db.prepare('SELECT body, body_hash FROM research.policy_revisions WHERE id=? AND revision=?').get(id, revision);
  if (!row) return null;
  if (hashOf(row.body) !== row.body_hash) throw Error('Policy investigation checksum mismatch.');
  const record = JSON.parse(row.body);
  if (hashOf(record.protocol) !== record.protocolHash) throw Error('Policy protocol checksum mismatch.');
  if (record.evaluation && hashOf(record.evaluation.inputs) !== record.evaluation.inputHash) throw Error('Policy inputs checksum mismatch.');
  if (record.evaluation && hashOf(record.result) !== record.evaluation.resultHash) throw Error('Policy result checksum mismatch.');
  return record;
}

export function savePolicyRecord(db, record, expectedRevision = 0) {
  initialize(db);
  const id = record.id || newId('policy');
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT MAX(revision) AS revision FROM research.policy_revisions WHERE id=?').get(id).revision || 0;
    if (current !== expectedRevision) throw Error('This investigation changed. Reload before trying again.');
    const saved = { ...record, id, revision: current + 1 };
    const body = JSON.stringify(saved);
    if (Buffer.byteLength(body) > 36 * 1024 * 1024) throw Error('Frozen investigation exceeds its 36 MiB storage budget. Narrow the study.');
    const summary = JSON.stringify(summarize(saved));
    db.prepare('INSERT INTO research.policy_revisions (id,revision,created_at,body_hash,body,summary,summary_hash) VALUES (?,?,?,?,?,?,?)')
      .run(id, saved.revision, saved.updatedAt, hashOf(body), body, summary, hashOf(summary));
    db.exec('COMMIT');
    return saved;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listPolicyRecords(db) {
  initialize(db);
  const rows = db.prepare(`SELECT p.id, p.summary, p.summary_hash FROM research.policy_revisions p
    JOIN (SELECT id, MAX(revision) revision FROM research.policy_revisions GROUP BY id) latest
    ON latest.id=p.id AND latest.revision=p.revision ORDER BY p.created_at DESC, p.id DESC LIMIT 100`).all();
  return rows.map(({ id, summary, summary_hash }) => {
    if (!summary) return summarize(getPolicyRecord(db, id));
    if (hashOf(summary) !== summary_hash) throw Error('Policy summary checksum mismatch.');
    return JSON.parse(summary);
  });
}

function summarize(record) {
  return { id: record.id, revision: record.revision, title: record.protocol.title, question: record.protocol.question,
    status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt,
    from: record.protocol.from, to: record.protocol.to, counts: record.readiness.counts };
}

export function policyView(record) {
  if (!record) return null;
  const { evaluation, ...view } = record;
  const sources = (view.evidence.sources || []).map(({ payload, ...receipt }) => receipt);
  return { ...view, evidence: { ...view.evidence, sources },
    evaluation: evaluation ? { inputHash: evaluation.inputHash, resultHash: evaluation.resultHash,
      engineHash: evaluation.engineHash, evaluatedAt: evaluation.evaluatedAt, revision: evaluation.revision } : null };
}
