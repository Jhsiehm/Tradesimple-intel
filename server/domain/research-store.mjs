/** Durable, append-only research records. Separate from the disposable feed cache. */
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export const hashOf = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const newId = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const ready = new WeakSet();
export function researchStore(db) {
  if (ready.has(db)) return db;
  const main = db.prepare('PRAGMA database_list').all().find(x => x.name === 'main')?.file;
  const file = process.env.INTEL_RESEARCH || (main ? join(dirname(main), 'research.sqlite') : ':memory:');
  db.prepare('ATTACH DATABASE ? AS research').run(file);
  db.exec(`
    PRAGMA research.journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS research.notebook_revisions (notebook_id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(notebook_id, revision));
    CREATE TABLE IF NOT EXISTS research.convergence_plans (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research.convergence_evaluations (plan_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research.engines (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research.runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, engine TEXT NOT NULL, input_hash TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research.experiments (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, title TEXT NOT NULL, hypothesis TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE, parent_id TEXT);
    CREATE TABLE IF NOT EXISTS research.datasets (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, content_hash TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(name, version), UNIQUE(name, content_hash));
  `);
  for (const table of ['notebook_revisions', 'engines', 'runs', 'experiments', 'datasets', 'convergence_plans', 'convergence_evaluations']) {
    for (const op of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS research.${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT, 'Research records are immutable'); END;`);
  }
  ready.add(db);
  return db;
}
export function putRun(db, { inputs, result, provenance, engine }) {
  researchStore(db);
  const id = newId('run');
  const createdAt = new Date().toISOString();
  const body = { schemaVersion: 1, id, createdAt, inputs, result, provenance, engineId: engine.id, inputHash: hashOf(inputs) };
  const text = JSON.stringify(body);
  db.prepare('INSERT OR IGNORE INTO research.engines VALUES (?, ?)').run(engine.id, JSON.stringify(engine.files));
  db.prepare('INSERT INTO research.runs VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, createdAt, !result.ok ? 'failed' : result.building ? 'partial' : 'complete', engine.id, body.inputHash, hashOf(text), text);
  return id;
}
export function getRun(db, id) {
  researchStore(db);
  const row = db.prepare('SELECT body, body_hash FROM research.runs WHERE id = ?').get(id);
  if (!row) return null;
  if (hashOf(row.body) !== row.body_hash) throw new Error('Run checksum mismatch. Restore a verified backup.');
  const run = JSON.parse(row.body);
  if (hashOf(run.inputs) !== run.inputHash) throw new Error('Input checksum mismatch.');
  return run;
}
export function getEngine(db, id) {
  researchStore(db);
  const row = db.prepare('SELECT body FROM research.engines WHERE id = ?').get(id);
  if (!row) throw new Error('Recorded engine is missing.');
  const files = JSON.parse(row.body);
  if (hashOf(files) !== id) throw new Error('Engine checksum mismatch.');
  return files;
}
export function saveExperiment(db, { runId, title, hypothesis = '', parentId = null }) {
  researchStore(db);
  if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Provide a title of 1–200 characters.');
  if (typeof hypothesis !== 'string' || hypothesis.length > 4000) throw new Error('Hypothesis must be at most 4,000 characters.');
  const run = getRun(db, String(runId || ''));
  if (!run) throw new Error('Frozen run not found. Run the backtest again before saving.');
  if (run.inputs?.kind) throw new Error('Comparison and stress runs belong to their locked plan, not single-source experiments.');
  if (parentId && !db.prepare('SELECT id FROM research.experiments WHERE id = ?').get(String(parentId))) throw new Error('Parent experiment not found.');
  const existing = db.prepare('SELECT id FROM research.experiments WHERE run_id = ?').get(runId);
  if (existing) return getExperiment(db, existing.id);
  const id = newId('exp');
  db.prepare('INSERT INTO research.experiments VALUES (?, ?, ?, ?, ?, ?)').run(id, new Date().toISOString(), title.trim(), hypothesis.trim(), runId, parentId);
  return getExperiment(db, id);
}
export function listExperiments(db) {
  researchStore(db);
  return db.prepare(`SELECT e.id, e.created_at AS createdAt, e.title, e.hypothesis, e.run_id AS runId, e.parent_id AS parentId, r.status FROM research.experiments e JOIN research.runs r ON r.id=e.run_id ORDER BY e.created_at DESC, e.id DESC LIMIT 500`).all();
}
export function getExperiment(db, id) {
  researchStore(db);
  const row = db.prepare('SELECT id, created_at AS createdAt, title, hypothesis, run_id AS runId, parent_id AS parentId FROM research.experiments WHERE id = ?').get(id);
  return row ? { ...row, run: getRun(db, row.runId) } : null;
}
export function putDataset(db, name, payload, contentHash) {
  researchStore(db);
  const existing = db.prepare('SELECT id FROM research.datasets WHERE name = ? AND content_hash = ?').get(name, contentHash);
  if (existing) return getDataset(db, existing.id);
  const id = newId('ds');
  const version = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS n FROM research.datasets WHERE name = ?').get(name).n;
  const body = JSON.stringify({ ...payload, id, name, version, contentHash, createdAt: new Date().toISOString() });
  db.prepare('INSERT INTO research.datasets VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, name, version, JSON.parse(body).createdAt, contentHash, hashOf(body), body);
  return JSON.parse(body);
}
export function getDataset(db, id) {
  researchStore(db);
  const row = db.prepare('SELECT body, body_hash FROM research.datasets WHERE id = ?').get(id);
  if (!row) return null;
  if (hashOf(row.body) !== row.body_hash) throw new Error('Dataset checksum mismatch.');
  return JSON.parse(row.body);
}
export function listDatasets(db) {
  researchStore(db);
  return db.prepare("SELECT id, name, version, created_at AS createdAt, content_hash AS contentHash, json_array_length(body, '$.events') AS rows FROM research.datasets ORDER BY created_at DESC, version DESC LIMIT 500").all();
}
