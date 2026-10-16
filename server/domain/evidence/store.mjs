import { researchStore, hashOf, newId } from '../research-store.mjs';
const ready = new WeakSet();
export function evidenceStore(db) {
  researchStore(db); if (ready.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS research.evidence_jobs (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research.evidence_blobs (hash TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research.evidence_observations (job_id TEXT NOT NULL, partition_id TEXT NOT NULL, page INTEGER NOT NULL, hash TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY(job_id, partition_id, page));
    CREATE TABLE IF NOT EXISTS research.evidence_records (job_id TEXT NOT NULL, record_key TEXT NOT NULL, version_hash TEXT NOT NULL, raw_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(job_id, record_key, version_hash));
    CREATE TABLE IF NOT EXISTS research.evidence_mappings (hash TEXT PRIMARY KEY, body TEXT NOT NULL);
  `);
  for (const table of ['evidence_blobs', 'evidence_observations', 'evidence_records', 'evidence_mappings']) for (const op of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS research.${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT, 'Evidence is immutable'); END;`);
  ready.add(db);
}
export function putBlob(db, body) {
  evidenceStore(db); const text = JSON.stringify(body), hash = hashOf(text);
  db.prepare('INSERT OR IGNORE INTO research.evidence_blobs VALUES (?, ?)').run(hash, text); return hash;
}
export function blob(db, hash) {
  evidenceStore(db); const row = db.prepare('SELECT body FROM research.evidence_blobs WHERE hash = ?').get(hash);
  if (!row) throw new Error('Evidence record not found.');
  if (hashOf(row.body) !== hash) throw new Error('Evidence checksum mismatch.');
  return JSON.parse(row.body);
}
export function saveJob(db, job) {
  evidenceStore(db); job.updatedAt = new Date().toISOString();
  db.prepare('INSERT INTO research.evidence_jobs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, body=excluded.body').run(job.id, job.updatedAt, JSON.stringify(job)); return job;
}
export function getJob(db, id) {
  evidenceStore(db); const r = db.prepare('SELECT body FROM research.evidence_jobs WHERE id=?').get(id); if (!r) throw new Error('Retrieval job not found.'); return JSON.parse(r.body);
}
export function jobs(db) { evidenceStore(db); return db.prepare('SELECT body FROM research.evidence_jobs ORDER BY updated_at DESC LIMIT 100').all().map(r => JSON.parse(r.body)); }
export function records(db, id) {
  evidenceStore(db); return db.prepare('SELECT body, raw_hash AS rawHash, version_hash AS versionHash FROM research.evidence_records WHERE job_id=? ORDER BY record_key, version_hash').all(id).map(r => ({ ...JSON.parse(r.body), rawHash: r.rawHash, versionHash: r.versionHash }));
}
export function putRecord(db, job, partition, raw, normalized) {
  const rawHash = putBlob(db, raw), key = normalized.recordKey || `unresolved:${rawHash}`;
  // First observation is version-specific; a newly discovered revision never inherits the old date.
  const prior = db.prepare('SELECT body FROM research.evidence_records WHERE record_key=? AND raw_hash=? ORDER BY rowid LIMIT 1').get(key, rawHash);
  const body = { ...normalized, firstObservedAt: prior ? JSON.parse(prior.body).firstObservedAt : normalized.firstObservedAt, partition };
  const versionHash = hashOf({ rawHash, mapping: job.mappingHash, record: key });
  db.prepare('INSERT OR IGNORE INTO research.evidence_records VALUES (?, ?, ?, ?, ?)').run(job.id, key, versionHash, rawHash, JSON.stringify(body));
}
export function newJobId() { return newId('ev'); }
