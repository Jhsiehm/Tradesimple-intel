import { reply } from "../router.mjs";
import { readJson } from "../lib/body.mjs";
import { nyDate } from "../../shared/dates.mjs";
import { TASK_LIMITS, cleanTaskInput, cleanTaskPatch, describeSchedule, draftFromQuestion, nextRunAfter, runsToday } from "../../shared/taskSchedule.mjs";
import * as store from "../domain/tasks/store.mjs";
import { dailyCap, schedulerOn, taskScheduler } from "../jobs/tasks.mjs";

const bad = (status, error) => reply(status, { ok: false, error, missing: "" });
const method = (req) => String(req?.method || "GET").toUpperCase();
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

function view(db, t) {
  const last = store.lastRunOf(db, t.id);
  return {
    id: t.id, kind: t.kind, title: t.title, prompt: t.prompt, specs: t.specs, window: t.window, schedule: t.schedule, every: describeSchedule(t.schedule),
    enabled: t.enabled, thresholds: t.thresholds, watch: t.watch, createdAt: iso(t.createdAt), lastRun: iso(t.lastRun), nextRun: iso(t.nextRun),
    running: t.running || taskScheduler(db).isQueued(t.id),
    last: last ? { id: last.id, status: last.status, severity: last.severity, title: last.title, summary: last.summary, at: iso(last.startedAt), source: last.source, asOf: last.asOf } : null
  };
}

const budget = (db, now = Date.now()) => ({ perDay: dailyCap(), usedToday: runsToday(store.countedStarts(db, now), now) });

async function body(req) {
  const b = await readJson(req, 64 * 1024);
  return b.ok ? { ok: true, value: b.value } : { ok: false, res: bad(b.status, b.error) };
}

/**
 * "Every morning at 8, check … and backtest them" asked in Ask: answered at once, with no model call, by a task draft
 * the sheet confirms (it adds the watchlist and POSTs /api/tasks). True when the question scheduled something.
 */
export function scheduleReply(asked, res, now = Date.now) {
  const t0 = now();
  const lastQuestion = [...(asked.history || [])].reverse().find((h) => h.role === "user")?.content || "";
  const out = draftFromQuestion({ question: asked.question, today: nyDate(t0), prefs: asked.prefs, priors: asked.priors?.length ? asked.priors : asked.prior ? [asked.prior] : [], lastQuestion });
  if (!out) return false;
  const answer = out.ok
    ? `I can run this ${describeSchedule(out.draft.schedule).replace(/^Daily/, "every day").replace(/^Weekdays/, "on weekdays").replace(/^Every/, "every")}: **${out.draft.title}**.\n\n${out.draft.kind === "backtest" ? `It replays ${out.draft.specs.length === 1 ? "a backtest" : `${out.draft.specs.length} backtests`} with fixed specs (no model call)${out.draft.window ? out.draft.window.sinceLast ? ", on signals made public since the previous run" : `, on the last ${out.draft.window.days} days` : ""}${out.draft.useWatchlist ? ", on the tickers in your watchlist" : ""}.` : "It asks this question again through Ask (one model call per run)."} Results post to Alerts. Press **Schedule it** below to save it; nothing is saved until you do.`
    : out.error;
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  emit({ type: "step_progress", phase: "writing" });
  emit({ type: "token", delta: answer });
  emit({ type: "done", ...askDone(answer, now() - t0), task: out.ok ? out.draft : null });
  res.end();
  return true;
}

const askDone = (answer, ms) => ({
  answer, cited: [], unknown: [], grounding: { checked: 0, unmatched: [], mislabeled: [], miscited: [], uncitedRows: [], scope: [] }, uncited: false, noTools: false,
  greeting: false, caveats: [], usage: { tokens: 0, toolCalls: 0 }, ms, stopped: "", model: "", theory: null, table: null, retried: false, backtests: [], clarify: false, prefs: null
});

export const handlers = {
  tasks: async ({ db, req }) => {
    if (method(req) === "GET") {
      return {
        ok: true,
        asOf: new Date().toISOString(),
        scheduler: schedulerOn() ? "on" : "off",
        budget: budget(db),
        items: store.listTasks(db).map((t) => view(db, t)),
        source: "Scheduled research tasks (this server's cache database)",
        latency: "Checked every 30 s; a due task starts within a minute. Results post to Alerts."
      };
    }
    if (method(req) !== "POST") return bad(405, "Use GET or POST.");
    const b = await body(req);
    if (!b.ok) return b.res;
    const clean = cleanTaskInput(b.value);
    if (!clean.ok) return bad(400, clean.error);
    if (store.countTasks(db) >= TASK_LIMITS.perUser) return bad(409, `At most ${TASK_LIMITS.perUser} scheduled tasks. Delete one first.`);
    const now = Date.now();
    const task = store.createTask(db, clean.task, { now, nextRun: clean.task.enabled ? nextRunAfter(clean.task.schedule, now) : null });
    return reply(201, { ok: true, task: view(db, task) });
  },
  "tasks.item": async ({ db, req, params }) => {
    const task = store.getTask(db, params.id);
    if (!task) return bad(404, "No such task.");
    if (method(req) === "GET") {
      const runs = store.runsSince(db, 0, 500).filter((r) => r.taskId === task.id).slice(0, 10);
      return { ok: true, task: view(db, task), runs: runs.map((r) => ({ id: r.id, status: r.status, severity: r.severity, title: r.title, summary: r.summary, at: iso(r.startedAt), source: r.source, asOf: r.asOf, latency: r.latency })) };
    }
    if (method(req) === "DELETE") {
      if (task.running || taskScheduler(db).isQueued(task.id)) return bad(409, "This task is running. Delete it when the run finishes.");
      store.deleteTask(db, task.id);
      return { ok: true, deleted: task.id };
    }
    if (method(req) !== "PATCH") return bad(405, "Use GET, PATCH, or DELETE.");
    const b = await body(req);
    if (!b.ok) return b.res;
    const clean = cleanTaskPatch(b.value);
    if (!clean.ok) return bad(400, clean.error);
    const next = { ...task, ...clean.patch };
    const reschedule = "enabled" in clean.patch || "schedule" in clean.patch;
    const now = Date.now();
    const updated = store.updateTask(db, task.id, clean.patch, { now, ...(reschedule ? { nextRun: next.enabled ? nextRunAfter(next.schedule, now) : null } : {}) });
    return { ok: true, task: view(db, updated) };
  },
  "tasks.run": async ({ db, req, params }) => {
    if (method(req) !== "POST") return bad(405, "POST to run now.");
    const q = taskScheduler(db).enqueue(params.id, "manual");
    if (!q.ok) return bad(q.status, q.error);
    q.done.catch(() => null);
    return reply(202, { ok: true, queued: true, task: view(db, store.getTask(db, params.id)) });
  },
  "tasks.result": ({ db, params }) => {
    const run = store.getRun(db, params.id, true);
    if (!run) return bad(404, "No such run. It may belong to a deleted task or be older than the last 60 runs.");
    const task = store.getTask(db, run.taskId);
    return { ok: true, run: { ...run, startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt) }, task: task ? { id: task.id, title: task.title, every: describeSchedule(task.schedule) } : null };
  }
};
