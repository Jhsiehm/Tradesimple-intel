import { nyDate } from "../../shared/dates.mjs";
import { backtestSummary, bootPlan, newSignalCount, nextRunAfter, researchSeverity, runsToday, specForRun } from "../../shared/taskSchedule.mjs";
import { SOURCE_LABEL } from "../../shared/backtestSpec.mjs";
import { askConfig } from "../ai/config.mjs";
import { runSpec } from "../domain/backtest/index.mjs";
import * as store from "../domain/tasks/store.mjs";
import { backtestTurn } from "../domain/tasks/results.mjs";

export const TICK_MS = 30_000;
export const DEFAULT_DAILY_RUNS = 20;

/** TASKS_MAX_RUNS_PER_DAY (default 20): runs of every task together per New York calendar day. Skips do not count. */
export function dailyCap(env = process.env) {
  const raw = String(env.TASKS_MAX_RUNS_PER_DAY ?? "").trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_RUNS;
}

/** Off with TASKS_SCHEDULER=off and under the test runner (INTEL_TEST=1); run-now still works. */
export const schedulerOn = (env = process.env) => !["off", "0", "false"].includes(String(env.TASKS_SCHEDULER || "").toLowerCase()) && env.INTEL_TEST !== "1";

export function pidAlive(pid, self = process.pid) {
  if (!pid || pid === self) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * In-process scheduler. Every tick runs due tasks one at a time. A task never runs twice at once: a queued or running
 * id is refused here, and the database lease refuses a second process sharing the cache. Everything is injectable.
 */
export function createTaskScheduler({ db, env = process.env, now = Date.now, pid = process.pid, alive = pidAlive, backtest = runSpec, prompt = null, log = (m) => console.log(m) }) {
  const queued = new Set();
  let chain = Promise.resolve();
  let timer = null;
  let ticking = false;
  const runPrompt = prompt || (async (args) => (await import("../ai/taskAsk.mjs")).runPromptTask(args));

  /** Recomputes next runs from what is stored: a missed or cut-off run is caught up once, now. */
  function boot() {
    const caught = [];
    const t = now();
    for (const task of store.listTasks(db)) {
      const interrupted = task.running && store.clearDeadLease(db, task.id, (p) => alive(p, pid));
      const plan = bootPlan({ enabled: task.enabled, schedule: task.schedule, nextRun: task.nextRun, interrupted }, t);
      store.setNextRun(db, task.id, plan.nextRun);
      if (plan.catchUp) caught.push(task.id);
    }
    return caught;
  }

  function skip(task, startedAt, reason, title, summary) {
    const last = store.lastRunOf(db, task.id);
    if (last?.status === "skipped" && last.meta.reason === reason && nyDate(last.startedAt) === nyDate(startedAt)) return null;
    return store.addRun(db, { taskId: task.id, startedAt, finishedAt: now(), status: "skipped", counted: false, severity: "routine", title: `${task.title} · skipped`, summary: `${title}. ${summary}`, source: "TradeSimple scheduler", asOf: iso(startedAt), latency: "Not run.", meta: { reason } });
  }

  async function runBacktests(task, startedAt) {
    const lastOk = store.lastRunOf(db, task.id, "ok");
    const today = nyDate(startedAt);
    const results = [];
    for (const raw of task.specs) {
      const spec = specForRun(raw, task.window, { today, lastRunDay: lastOk ? nyDate(lastOk.startedAt) : "" });
      const t0 = now();
      let out;
      try { out = await backtest(db, spec); } catch (err) { out = { ok: false, error: err?.message || "Backtest failed." }; }
      results.push({ spec, out: out?.ok === false ? out : { ...out, ok: true }, ms: now() - t0 });
    }
    const ids = results.map((r) => (r.out.ok ? (r.out.trades || []).map((x) => String(x.id)).slice(0, 2000) : []));
    const prevIds = lastOk?.meta?.signalIds || null;
    const fresh = results.map((r, i) => (r.out.ok ? newSignalCount(ids[i], prevIds?.[i]) : null));
    const good = results.filter((r) => r.out.ok);
    const excesses = good.map((r) => r.out.stats?.excessTotal).filter((v) => v != null);
    const excess = excesses.length ? Math.max(...excesses) : null;
    const freshSum = fresh.some((f) => f != null) ? fresh.reduce((n, f) => n + (f || 0), 0) : null;
    const { severity, why } = researchSeverity({ excess, fresh: freshSum }, task.thresholds);
    const finishedAt = now();
    const turn = backtestTurn(task, results, { startedAt, finishedAt, fresh });
    const asOfs = good.map((r) => r.out.asOf).filter(Boolean).sort();
    const summary = results.map((r, i) => `${results.length > 1 ? `${SOURCE_LABEL[r.spec.source] || r.spec.source}: ` : ""}${r.out.ok ? backtestSummary(r.out, fresh[i]) : `did not run — ${r.out.error || "failed"}`}`).join(" | ");
    return {
      status: good.length ? "ok" : "error",
      severity,
      title: `${task.title}${good.length ? "" : " · failed"}${why.length ? ` · ${why.join(", ")}` : ""}`,
      summary,
      source: [...new Set(good.flatMap((r) => (r.out.feeds || []).map((f) => f.source)))].join(" · ") || "TradeSimple backtest engine",
      asOf: asOfs[0] || iso(finishedAt),
      latency: `Scheduled backtest, ${((finishedAt - startedAt) / 1000).toFixed(1)} s, no model call${good.some((r) => r.out.cache === "hit") ? `; engine result cached from ${good.find((r) => r.out.cache === "hit").out.ranAt || "earlier"} (30 min)` : ""}. ${good.map((r) => (r.out.feeds || []).map((f) => `${f.label}: ${f.latency}`).join(" ")).join(" ").slice(0, 400)}`,
      meta: { signalIds: ids, excess, fresh: freshSum, why },
      result: turn
    };
  }

  async function runAskPrompt(task, startedAt) {
    const out = await runPrompt({ db, task, env, now });
    if (out.skipped) return { skipped: true, error: out.error };
    return {
      status: out.ok ? "ok" : "error",
      severity: "routine",
      title: `${task.title}${out.ok ? "" : " · failed"}`,
      summary: out.ok ? out.summary : out.error || out.summary,
      source: out.source,
      asOf: out.asOf,
      latency: out.latency,
      meta: { model: out.model, startedAt },
      result: out.turn
    };
  }

  async function perform(task, trigger) {
    const startedAt = now();
    if (!store.claimTask(db, task.id, { now: startedAt, pid })) return { ok: false, busy: true };
    let run = null;
    try {
      const cap = dailyCap(env);
      if (runsToday(store.countedStarts(db, startedAt), startedAt) >= cap) {
        run = skip(task, startedAt, "budget", `Daily cap of ${cap} scheduled runs reached`, "Raise TASKS_MAX_RUNS_PER_DAY in .env.local or wait until midnight ET.");
      } else if (task.kind === "prompt" && !askConfig(env).configured) {
        run = skip(task, startedAt, "not-configured", "Ask is not configured — add a key to .env.local", "This task asks the model; backtest tasks still run without a key.");
      } else {
        const r = task.kind === "backtest" ? await runBacktests(task, startedAt) : await runAskPrompt(task, startedAt);
        if (r.skipped) run = skip(task, startedAt, "not-configured", r.error || "Ask is not configured", "");
        else if (store.getTask(db, task.id)) run = store.addRun(db, { taskId: task.id, startedAt, finishedAt: now(), counted: true, ...r, meta: { ...r.meta, trigger } });
      }
    } catch (err) {
      run = store.addRun(db, { taskId: task.id, startedAt, finishedAt: now(), status: "error", counted: true, severity: "routine", title: `${task.title} · failed`, summary: err?.message || "Run failed.", source: "TradeSimple scheduler", asOf: iso(startedAt), latency: "", meta: { trigger } });
    } finally {
      const cur = store.getTask(db, task.id);
      if (cur) {
        const t = now();
        const keep = trigger === "manual" && cur.nextRun != null && cur.nextRun > t;
        store.releaseTask(db, task.id, { lastRun: startedAt, nextRun: cur.enabled ? (keep ? cur.nextRun : nextRunAfter(cur.schedule, t)) : null });
      }
    }
    if (run) log(`task ${task.id} ${trigger}: ${run.status} · ${run.summary.slice(0, 120)}`);
    return { ok: true, run };
  }

  /** Queues one run; resolves when it finishes. Refused while the same task is queued or running. */
  function enqueue(id, trigger) {
    const task = store.getTask(db, id);
    if (!task) return { ok: false, status: 404, error: "No such task." };
    if (queued.has(id) || task.running) return { ok: false, status: 409, error: "This task is already running." };
    queued.add(id);
    const done = chain.then(async () => {
      const fresh = store.getTask(db, id);
      return fresh ? perform(fresh, trigger) : { ok: false, gone: true };
    }).finally(() => queued.delete(id));
    chain = done.catch(() => null);
    return { ok: true, done };
  }

  async function tick() {
    if (ticking) return 0;
    ticking = true;
    let n = 0;
    try {
      const t = now();
      const due = store.listTasks(db).filter((x) => x.enabled && x.nextRun != null && x.nextRun <= t && !x.running && !queued.has(x.id)).sort((a, b) => a.nextRun - b.nextRun);
      for (const task of due) {
        const q = enqueue(task.id, "schedule");
        if (q.ok) { await q.done; n += 1; }
      }
    } finally {
      ticking = false;
    }
    return n;
  }

  function start() {
    const caught = boot();
    if (caught.length) log(`tasks: catching up ${caught.length} missed run${caught.length === 1 ? "" : "s"}`);
    timer = setInterval(() => { void tick().catch((err) => log(`tasks tick: ${err.message}`)); }, TICK_MS);
    timer.unref?.();
    setTimeout(() => { void tick().catch(() => null); }, 3_000).unref?.();
  }

  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const isQueued = (id) => queued.has(id);

  return { boot, tick, enqueue, start, stop, isQueued, idle: () => chain };
}

let current = null;

/** The scheduler the routes use; `startTasks` makes it at boot (the routes make one lazily if needed). */
export function taskScheduler(db) {
  if (!current) current = createTaskScheduler({ db });
  return current;
}

export function startTasks(db) {
  const s = taskScheduler(db);
  if (schedulerOn()) s.start();
  else s.boot();
  return s;
}
