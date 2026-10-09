/**
 * Scheduled research tasks and their runs, in the server's cache database (data/cache.sqlite or INTEL_CACHE, never
 * committed). A run row keeps the full stored result so Alerts can open it in Ask without running it again.
 * `running_since` + `running_pid` are a lease: one copy of a task runs at a time, even across two API processes.
 */
const ready = new WeakSet();
const KEEP_RUNS = 60;

function ensure(db) {
  if (ready.has(db)) return;
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
export function clearDeadLease(db, id, alive) {
  ensure(db);
  const t = getTask(db, id);
  if (!t?.running || alive(t.runningPid)) return false;
  db.prepare("UPDATE tasks SET running_since = NULL, running_pid = NULL WHERE id = ?").run(id);
  return true;
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
  return db.prepare("SELECT started_at FROM task_runs WHERE counted = 1 AND started_at >= ?").all(now - 2 * 86_400_000).map((r) => r.started_at);
}
