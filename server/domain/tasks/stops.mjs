import { hashOf } from '../research-store.mjs';
import { getAttempt } from './store.mjs';
import { verifyStopRequest } from './integrity.mjs';

const ready = new WeakSet();
function ensure(db) {
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.task_stop_requests (attempt_id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS research.task_stop_requests_update BEFORE UPDATE ON task_stop_requests BEGIN SELECT RAISE(ABORT,'Task stop requests are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS research.task_stop_requests_delete BEFORE DELETE ON task_stop_requests BEGIN SELECT RAISE(ABORT,'Task stop requests are immutable'); END;`);
  ready.add(db);
}
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
export function stopRequest(db, id) {
  const attempt = getAttempt(db, id);
  if (!attempt) return null;
  ensure(db);
  const row = db.prepare('SELECT * FROM research.task_stop_requests WHERE attempt_id=?').get(id);
  if (!row) return null;
  const { completion, ...original } = attempt;
  return verifyStopRequest(row, original);
}

/** Persist before signalling. One request targets one immutable attempt, never a future run. */
export function requestStop(db, id, { reason } = {}, now = Date.now()) {
  const attempt = getAttempt(db, id);
  if (!attempt) fail(404, 'Task attempt not found.');
  const existing = stopRequest(db, id);
  if (existing) return existing;
  if (attempt.completion) fail(409, 'This execution has already finished.');
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) fail(400, 'Provide a stop reason of 1–1000 characters.');
  const { completion, ...original } = attempt;
  const record = { schemaVersion: 1, attemptId: id, attemptHash: hashOf(original), requestedAt: now, actor: 'local-owner', reason: reason.trim() };
  const body = JSON.stringify(record);
  verifyStopRequest({ attempt_id: id, body_hash: hashOf(body), body }, original);
  db.prepare(`INSERT OR IGNORE INTO research.task_stop_requests SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM research.task_completions WHERE attempt_id=?)`).run(id, hashOf(body), body, id);
  return stopRequest(db, id) || fail(409, 'This execution has already finished.');
}

/** Match the cache lease to its journal entry even after recovery has completed that entry. */
function leaseAttempt(db, task, incompleteOnly) {
  if (!task.running) return null;
  // Initialize the journal through its public store before querying it.
  getAttempt(db, '');
  return db.prepare(`SELECT a.id FROM research.task_attempts a LEFT JOIN research.task_completions c ON c.attempt_id=a.id
    WHERE a.task_id=? AND a.started_at=? AND a.pid=? ${incompleteOnly ? 'AND c.attempt_id IS NULL' : ''}
    ORDER BY a.rowid DESC LIMIT 1`).get(task.id, task.runningSince, task.runningPid) || null;
}

export function activeAttempt(db, task) {
  const row = leaseAttempt(db, task, true);
  return row ? { id: row.id, stopRequested: Boolean(stopRequest(db, row.id)) } : null;
}

export function leaseStopRequest(db, task) {
  const row = leaseAttempt(db, task, false);
  return row ? stopRequest(db, row.id) : null;
}
