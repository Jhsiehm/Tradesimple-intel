import {ensureTaskControl} from './control.mjs';
import {verifyAttemptRow,verifyCompletion} from './integrity.mjs';
import {researchStore,hashOf,newId} from '../research-store.mjs';
import {nyDate} from '../../../shared/dates.mjs';
/**
 * Scheduled research tasks and their runs, in the server's cache database (data/cache.sqlite or INTEL_CACHE, never
 * committed). A run row keeps the full stored result so Alerts can open it in Ask without running it again.
 * `running_since` + `running_pid` are a lease: one copy of a task runs at a time, even across two API processes.
 */
const ready = new WeakSet();
const KEEP_RUNS = 60;

function ensure(db) {
  if (ready.has(db)) return;
  researchStore(db);
  ensureTaskControl(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      next_run INTEGER,
      last_run INTEGER,
      running_since INTEGER,
      running_pid INTEGER
    );
    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      counted INTEGER NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      source TEXT NOT NULL,
      as_of TEXT NOT NULL,
      latency TEXT NOT NULL,
      meta TEXT NOT NULL,
      result TEXT
    );
    CREATE INDEX IF NOT EXISTS task_runs_task ON task_runs (task_id, started_at);
    CREATE INDEX IF NOT EXISTS task_runs_started ON task_runs (started_at);
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS research.task_attempts (id TEXT PRIMARY KEY,task_id TEXT NOT NULL,day TEXT NOT NULL,started_at INTEGER NOT NULL,pid INTEGER NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS research.task_attempts_day ON task_attempts(day);
    CREATE TABLE IF NOT EXISTS research.task_completions (attempt_id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,body TEXT NOT NULL);`);
  for(const table of ['task_attempts','task_completions'])for(const op of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS research.${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Task attempt records are immutable'); END;`);
  ready.add(db);
}

const rid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function hydrateTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    ...JSON.parse(row.body),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRun: row.next_run ?? null,
    lastRun: row.last_run ?? null,
    running: row.running_since != null,
    runningSince: row.running_since ?? null,
    runningPid: row.running_pid ?? null
  };
}

const BODY_KEYS = ["kind", "title", "prompt", "specs", "window", "schedule", "enabled", "thresholds", "watch"];
const bodyOf = (t) => JSON.stringify(Object.fromEntries(BODY_KEYS.map((k) => [k, t[k] ?? null])));

function hydrateRun(row, withResult = false) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    counted: Boolean(row.counted),
    severity: row.severity,
    title: row.title,
    summary: row.summary,
    source: row.source,
    asOf: row.as_of,
    latency: row.latency,
    meta: JSON.parse(row.meta || "{}"),
    ...(withResult ? { result: row.result ? JSON.parse(row.result) : null } : {})
  };
}

const RUN_COLS = "id, task_id, started_at, finished_at, status, counted, severity, title, summary, source, as_of, latency, meta";

export function listTasks(db) {
  ensure(db);
  return db.prepare("SELECT * FROM tasks ORDER BY created_at").all().map(hydrateTask);
}

export function getTask(db, id) {
  ensure(db);
  return hydrateTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(String(id)));
}

export function countTasks(db) {
  ensure(db);
  return db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n;
}

export function createTask(db, task, { now, nextRun }) {
  ensure(db);
  const id = rid("tk_");
  db.prepare("INSERT INTO tasks (id, body, created_at, updated_at, next_run) VALUES (?, ?, ?, ?, ?)").run(id, bodyOf(task), now, now, nextRun ?? null);
  return getTask(db, id);
}

/** Merges `patch` into the stored body; `nextRun` (may be null) and `lastRun` update their columns when present. */
export function updateTask(db, id, patch, { now, nextRun, lastRun } = {}) {
  ensure(db);
  const cur = getTask(db, id);
  if (!cur) return null;
  db.prepare("UPDATE tasks SET body = ?, updated_at = ? WHERE id = ?").run(bodyOf({ ...cur, ...patch }), now ?? Date.now(), id);
  if (nextRun !== undefined) db.prepare("UPDATE tasks SET next_run = ? WHERE id = ?").run(nextRun, id);
  if (lastRun !== undefined) db.prepare("UPDATE tasks SET last_run = ? WHERE id = ?").run(lastRun, id);
  return getTask(db, id);
}

export function setNextRun(db, id, nextRun) {
  ensure(db);
  db.prepare("UPDATE tasks SET next_run = ? WHERE id = ?").run(nextRun, id);
}

export function deleteTask(db, id) {
  ensure(db);
  db.prepare("DELETE FROM task_runs WHERE task_id = ?").run(id);
  return db.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
}

/** Takes the lease. False when another run (this process or another) holds it. */
export function claimTask(db, id, { now, pid }) {
  ensure(db);
  return db.prepare("UPDATE tasks SET running_since = ?, running_pid = ? WHERE id = ? AND running_since IS NULL").run(now, pid, id).changes === 1;
}

export function releaseTask(db, id, { lastRun, nextRun }) {
  ensure(db);
  db.prepare("UPDATE tasks SET running_since = NULL, running_pid = NULL, last_run = COALESCE(?, last_run), next_run = ? WHERE id = ?").run(lastRun ?? null, nextRun ?? null, id);
}

/** Clears a lease whose process is gone; true when it did (that run was cut off). */
export function clearDeadLease(db, id, alive, { expectedLease, nextRun } = {}) {
  ensure(db);
  const t = getTask(db, id);
  if (!t?.running || alive(t.runningPid)) return false;
  if (expectedLease && (t.runningSince !== expectedLease.runningSince || t.runningPid !== expectedLease.runningPid)) return false;
  // A stopped lease and its next due time must change together: a second crash must not revive it.
  return nextRun !== undefined
    ? db.prepare("UPDATE tasks SET running_since = NULL, running_pid = NULL, next_run = ? WHERE id = ? AND running_since = ? AND running_pid = ?").run(nextRun, id, t.runningSince, t.runningPid).changes === 1
    : db.prepare("UPDATE tasks SET running_since = NULL, running_pid = NULL WHERE id = ? AND running_since = ? AND running_pid = ?").run(id, t.runningSince, t.runningPid).changes === 1;
}

export function addRun(db, run) {
  ensure(db);
  const id = rid("rn_");
  db.prepare(`INSERT INTO task_runs (${RUN_COLS}, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, run.taskId, run.startedAt, run.finishedAt, run.status, run.counted ? 1 : 0, run.severity || "routine",
    String(run.title || "").slice(0, 200), String(run.summary || "").slice(0, 600), run.source || "", run.asOf || "", run.latency || "",
    JSON.stringify(run.meta || {}), run.result == null ? null : JSON.stringify(run.result)
  );
  const old = db.prepare("SELECT id FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT -1 OFFSET ?").all(run.taskId, KEEP_RUNS);
  for (const r of old) db.prepare("DELETE FROM task_runs WHERE id = ?").run(r.id);
  return getRun(db, id);
}

export function getRun(db, id, withResult = false) {
  ensure(db);
  return hydrateRun(db.prepare(`SELECT ${RUN_COLS}${withResult ? ", result" : ""} FROM task_runs WHERE id = ?`).get(String(id)), withResult);
}

export function lastRunOf(db, taskId, status = null) {
  ensure(db);
  const row = status
    ? db.prepare(`SELECT ${RUN_COLS} FROM task_runs WHERE task_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1`).get(taskId, status)
    : db.prepare(`SELECT ${RUN_COLS} FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1`).get(taskId);
  return hydrateRun(row);
}

/** Runs started at or after `since`, newest first, without stored results. */
export function runsSince(db, since, limit = 200) {
  ensure(db);
  return db.prepare(`SELECT ${RUN_COLS} FROM task_runs WHERE started_at >= ? ORDER BY started_at DESC LIMIT ?`).all(since, limit).map((r) => hydrateRun(r));
}

/** Start times of runs that count against the daily cap, over the last two days (the caller picks today's in ET). */
export function countedStarts(db, now) {
  ensure(db);
  return [...legacyCountedStarts(db,now),...db.prepare('SELECT started_at FROM research.task_attempts WHERE started_at >= ?').all(now-2*86_400_000).map(r=>r.started_at)];
}

function legacyCountedStarts(db,now){return db.prepare("SELECT started_at,meta FROM task_runs WHERE counted=1 AND started_at>=?").all(now-2*86_400_000).filter(r=>!JSON.parse(r.meta||'{}').attemptId).map(r=>r.started_at);}
function decodeAttempt(row){if(!row)return null;if(hashOf(row.body)!==row.body_hash)throw Error('Task execution checksum mismatch.');return JSON.parse(row.body);}
export function getAttempt(db,id){
 ensure(db);const attempt=verifyAttemptRow(db.prepare('SELECT * FROM research.task_attempts WHERE id=?').get(id));if(!attempt)return null;
 const completion=decodeAttempt(db.prepare('SELECT body,body_hash FROM research.task_completions WHERE attempt_id=?').get(id));
 return {...attempt,completion:completion?verifyCompletion(completion,attempt):null};
}
export function listAttempts(db,limit=200){ensure(db);return db.prepare('SELECT id FROM research.task_attempts ORDER BY started_at DESC,id DESC LIMIT ?').all(Math.min(500,Math.max(1,limit))).map(r=>getAttempt(db,r.id));}
/** A single conditional INSERT reserves capacity across processes before any work starts. */
export function reserveAttempt(db,task,{startedAt,pid,trigger,cap}){
 ensure(db);const day=nyDate(startedAt),id=newId('ta');
 const attempt={schemaVersion:1,id,taskId:task.id,day,startedAt,pid,trigger,task:{id:task.id,...JSON.parse(bodyOf(task)),createdAt:task.createdAt,updatedAt:task.updatedAt}};
 const encoded=JSON.stringify(attempt),legacy=legacyCountedStarts(db,startedAt).filter(t=>nyDate(t)===day).length;
 const inserted=db.prepare('INSERT INTO research.task_attempts SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM research.task_attempts WHERE day=?)+? < ? AND COALESCE((SELECT paused FROM research.task_controls ORDER BY revision DESC LIMIT 1),0)=0').run(id,task.id,day,startedAt,pid,hashOf(encoded),encoded,day,legacy,cap);
 return inserted.changes===1?attempt:null;
}
export function completeAttempt(db,id,{status,finishedAt,run=null,reason=''}){
 const attempt=getAttempt(db,id);if(!attempt)throw Error('Task attempt not found.');if(attempt.completion)return attempt;
 if(!['finished','interrupted'].includes(status))throw Error('Invalid task completion state.');
 const {completion,...original}=attempt;
 const record={attemptId:id,attemptHash:hashOf(original),status,finishedAt,run,reason},encoded=JSON.stringify(record);
 verifyCompletion(record,original);
 db.prepare('INSERT OR IGNORE INTO research.task_completions VALUES (?,?,?)').run(id,hashOf(encoded),encoded);return getAttempt(db,id);
}
export function recoverAttempts(db,alive,now){
 ensure(db);let recovered=0;
 const unfinished=db.prepare('SELECT a.id FROM research.task_attempts a LEFT JOIN research.task_completions c ON c.attempt_id=a.id WHERE c.attempt_id IS NULL').all();
 for(const {id} of unfinished){const attempt=getAttempt(db,id);if(alive(attempt.pid))continue;
  const saved=db.prepare("SELECT id FROM task_runs WHERE json_extract(meta,'$.attemptId')=? LIMIT 1").get(id);
  completeAttempt(db,id,{status:saved?'finished':'interrupted',finishedAt:now,run:saved?getRun(db,saved.id,true):null,reason:saved?'Recovered saved result after process interruption.':'Owning process is no longer alive; no terminal result was recorded. The attempt remains charged to its original day.'});recovered++;
 }
 return recovered;
}
