import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  bootPlan, cleanTaskInput, cleanTaskPatch, describeSchedule, draftFromQuestion, etParts, etToUtc, isScheduleRequest, newSignalCount,
  nextRunAfter, parseSchedule, researchSeverity, runsToday, specForRun
} from "../shared/taskSchedule.mjs";
import { DEFAULT_FILTERS, DEFAULT_RULES } from "../shared/backtestSpec.mjs";
import * as store from "../server/domain/tasks/store.mjs";
import { researchAlerts } from "../server/domain/tasks/alerts.mjs";
import { createTaskScheduler, dailyCap } from "../server/jobs/tasks.mjs";

const at = (s) => Date.parse(s);
const iso = (t) => new Date(t).toISOString();
const daily = (time, weekdays = false) => ({ kind: "daily", time, weekdays });
const SPEC = { source: "congress", filters: { ...DEFAULT_FILTERS }, rules: { ...DEFAULT_RULES } };

/* ---------- schedule math ---------- */

test("ET wall time to UTC follows EDT in summer and EST in winter", () => {
  assert.equal(iso(etToUtc(2026, 7, 1, 8, 0)), "2026-07-01T12:00:00.000Z");
  assert.equal(iso(etToUtc(2026, 1, 5, 8, 0)), "2026-01-05T13:00:00.000Z");
});

test("DST: a time skipped in March lands after the jump; a time repeated in November is its first reading", () => {
  assert.equal(iso(etToUtc(2026, 3, 8, 2, 30)), "2026-03-08T07:30:00.000Z");
  assert.equal(etParts(etToUtc(2026, 3, 8, 2, 30)).hh, 3);
  assert.equal(iso(etToUtc(2026, 11, 1, 1, 30)), "2026-11-01T05:30:00.000Z");
});

test("daily 08:00 ET stays 08:00 ET across both DST changes", () => {
  const s = daily("08:00");
  assert.equal(iso(nextRunAfter(s, at("2026-03-07T14:00:00Z"))), "2026-03-08T12:00:00.000Z");
  assert.equal(iso(nextRunAfter(s, at("2026-03-08T12:00:00Z"))), "2026-03-09T12:00:00.000Z");
  assert.equal(iso(nextRunAfter(s, at("2026-10-31T13:00:00Z"))), "2026-11-01T13:00:00.000Z");
  assert.equal(etParts(nextRunAfter(s, at("2026-10-31T13:00:00Z"))).hh, 8);
});

test("next run is strictly after: the run at 08:00 schedules tomorrow, not itself", () => {
  const eight = at("2026-10-08T12:00:00Z");
  assert.equal(iso(nextRunAfter(daily("08:00"), eight)), "2026-10-09T12:00:00.000Z");
  assert.equal(iso(nextRunAfter(daily("08:00"), eight - 1)), iso(eight));
});

test("weekdays only: Friday after the run goes to Monday; Saturday and Sunday are skipped", () => {
  const s = daily("08:00", true);
  assert.equal(iso(nextRunAfter(s, at("2026-10-09T14:00:00Z"))), "2026-10-12T12:00:00.000Z");
  assert.equal(iso(nextRunAfter(s, at("2026-10-10T05:00:00Z"))), "2026-10-12T12:00:00.000Z");
  assert.equal(iso(nextRunAfter(daily("16:30"), at("2026-10-09T14:00:00Z"))), "2026-10-09T20:30:00.000Z");
});

test("hour steps run on ET clock hours divisible by the step, through DST", () => {
  const four = { kind: "hours", hours: 4, weekdays: false };
  assert.equal(iso(nextRunAfter(four, at("2026-10-09T14:00:00Z"))), "2026-10-09T16:00:00.000Z");
  assert.equal(etParts(nextRunAfter(four, at("2026-03-08T05:30:00Z"))).hh % 4, 0);
  const hourly = { kind: "hours", hours: 1, weekdays: true };
  assert.equal(iso(nextRunAfter(hourly, at("2026-10-10T12:10:00Z"))), "2026-10-12T04:00:00.000Z");
});

test("describeSchedule and runsToday use New York days", () => {
  assert.equal(describeSchedule(daily("08:00", true)), "Weekdays at 8:00 AM ET");
  assert.equal(describeSchedule(daily("16:30")), "Daily at 4:30 PM ET");
  assert.equal(describeSchedule({ kind: "hours", hours: 4, weekdays: false }), "Every 4 hours (ET clock)");
  const now = at("2026-10-09T03:30:00Z");
  assert.equal(runsToday([at("2026-10-09T02:00:00Z"), at("2026-10-08T05:00:00Z"), at("2026-10-07T23:00:00Z")], now), 2);
});

/* ---------- catch-up ---------- */

test("boot catch-up: one missed run (or one cut off) runs now, once; a future run stands", () => {
  const now = at("2026-10-09T14:00:00Z");
  const s = daily("08:00");
  assert.deepEqual(bootPlan({ enabled: true, schedule: s, nextRun: now - 3 * 86_400_000 }, now), { catchUp: true, nextRun: now });
  assert.deepEqual(bootPlan({ enabled: true, schedule: s, nextRun: now + 1000 }, now), { catchUp: false, nextRun: now + 1000 });
  assert.deepEqual(bootPlan({ enabled: true, schedule: s, nextRun: now + 1000, interrupted: true }, now), { catchUp: true, nextRun: now });
  assert.equal(bootPlan({ enabled: true, schedule: s, nextRun: null }, now).nextRun, at("2026-10-10T12:00:00Z"));
  assert.deepEqual(bootPlan({ enabled: false, schedule: s, nextRun: now - 1 }, now), { catchUp: false, nextRun: null });
});

/* ---------- parsing and cleaning ---------- */

test("parse: every morning at 8, weekday 4:30pm, every 4 hours, hourly", () => {
  assert.deepEqual(parseSchedule("every morning at 8, check new insider buys on my watchlist and backtest them"), { schedule: daily("08:00"), rest: "check new insider buys on my watchlist and backtest them" });
  assert.deepEqual(parseSchedule("Run this every weekday at 4:30pm").schedule, daily("16:30", true));
  assert.deepEqual(parseSchedule("every evening at 7 summarize the news").schedule, daily("19:00"));
  assert.deepEqual(parseSchedule("every 4 hours what moved in Taiwan"), { schedule: { kind: "hours", hours: 4, weekdays: false }, rest: "what moved in Taiwan" });
  assert.equal(parseSchedule("every 5 hours x").schedule, null);
  assert.equal(parseSchedule("what did Pelosi buy?"), null);
});

test("only real scheduling asks become drafts", () => {
  assert.equal(isScheduleRequest("What is NVDA's daily volume?"), false);
  assert.equal(draftFromQuestion({ question: "show me the daily chart of SPY", today: "2026-10-09" }), null);
  assert.equal(isScheduleRequest("run this daily"), true);
  assert.equal(isScheduleRequest("every morning at 8, check insider buys"), true);
});

test("draft: a backtest ask becomes fixed specs with a since-last-run window and the watchlist", () => {
  const out = draftFromQuestion({ question: "every morning at 8, check new insider buys on my watchlist and backtest them", today: "2026-10-09" });
  assert.equal(out.ok, true);
  assert.equal(out.draft.kind, "backtest");
  assert.equal(out.draft.specs[0].source, "form4");
  assert.equal(out.draft.specs[0].rules.openTrades, "mark");
  assert.deepEqual(out.draft.window, { sinceLast: true, days: 30 });
  assert.equal(out.draft.useWatchlist, true);
});

test("draft: 'run this every morning' reuses the previous backtests, else the last question", () => {
  const bt = draftFromQuestion({ question: "run this every weekday morning", today: "2026-10-09", priors: [SPEC] });
  assert.equal(bt.draft.kind, "backtest");
  assert.deepEqual(bt.draft.specs, [SPEC]);
  assert.equal(bt.draft.schedule.weekdays, true);
  const q = draftFromQuestion({ question: "do this every day at 5pm", today: "2026-10-09", lastQuestion: "How are markets today?" });
  assert.equal(q.draft.kind, "prompt");
  assert.equal(q.draft.prompt, "How are markets today?");
  assert.equal(q.draft.schedule.time, "17:00");
  assert.equal(draftFromQuestion({ question: "run this every morning", today: "2026-10-09" }).ok, false);
});

test("cleanTaskInput: watchlist tickers go onto every spec; bad bodies are refused", () => {
  const ok = cleanTaskInput({ kind: "backtest", specs: [{ ...SPEC, source: "form4" }], schedule: daily("08:00"), useWatchlist: true, watch: { symbols: ["nvda", "AAPL", "bad ticker"] } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.task.specs[0].filters.tickers, ["NVDA", "AAPL"]);
  assert.equal(cleanTaskInput({ kind: "backtest", specs: [SPEC], schedule: daily("08:00"), useWatchlist: true, watch: { symbols: [] } }).ok, false);
  assert.equal(cleanTaskInput({ kind: "prompt", prompt: "", schedule: daily("08:00") }).ok, false);
  assert.equal(cleanTaskInput({ kind: "prompt", prompt: "x", schedule: { kind: "daily", time: "25:00" } }).ok, false);
  assert.equal(cleanTaskPatch({}).ok, false);
  assert.deepEqual(cleanTaskPatch({ enabled: false }).patch, { enabled: false });
});

test("specForRun: rolling and since-last-run windows set the public-date filter", () => {
  assert.deepEqual(specForRun(SPEC, { sinceLast: false, days: 30 }, { today: "2026-10-09" }).filters.from, "2026-09-09");
  assert.equal(specForRun(SPEC, { sinceLast: true, days: 30 }, { today: "2026-10-09", lastRunDay: "2026-10-08" }).filters.from, "2026-10-08");
  assert.equal(specForRun(SPEC, null, { today: "2026-10-09" }), SPEC);
});

test("severity: routine unless a threshold the user set is crossed", () => {
  assert.equal(researchSeverity({ excess: 0.5, fresh: 9 }, {}).severity, "routine");
  assert.equal(researchSeverity({ excess: 0.031 }, { excessPct: 3 }).severity, "elevated");
  assert.equal(researchSeverity({ excess: 0.029 }, { excessPct: 3 }).severity, "routine");
  assert.equal(researchSeverity({ fresh: 2 }, { newSignals: 2 }).severity, "elevated");
  assert.equal(newSignalCount(["a", "b", "c"], ["a"]), 2);
  assert.equal(newSignalCount(["a"], null), null);
});

/* ---------- scheduler ---------- */

const fakeRun = (excess = 0.04, ids = ["s1", "s2"]) => ({
  ok: true, spec: SPEC, description: "x", source: "House Clerk PTR · Yahoo", asOf: "2026-10-09T11:00:00.000Z", latency: "Daily bars",
  feeds: [{ label: "Prices", source: "Yahoo", asOf: "2026-10-09T11:00:00.000Z", latency: "daily" }],
  stats: { total: 0.06, benchmarkTotal: 0.02, excessTotal: excess, trades: ids.length, hitRate: 0.5 }, trades: ids.map((id) => ({ id, ret: 0.01 })), counts: { matched: ids.length }, caveats: { items: [] }
});

function harness({ env = {}, clock = { t: at("2026-10-09T14:00:00Z") }, db = new DatabaseSync(":memory:"), backtest, prompt, pid = 4242, alive = () => false } = {}) {
  const calls = [];
  const s = createTaskScheduler({
    db, env, pid, alive, now: () => clock.t, log: () => {},
    backtest: backtest || (async (_db, spec) => { calls.push(spec); return fakeRun(); }),
    prompt
  });
  return { s, db, clock, calls };
}

const addTask = (db, extra = {}, clock = { t: at("2026-10-09T14:00:00Z") }) =>
  store.createTask(db, { kind: "backtest", title: "Congress buys", prompt: "", specs: [SPEC], window: null, schedule: daily("08:00"), enabled: true, thresholds: { excessPct: null, newSignals: null }, watch: null, ...extra }, { now: clock.t, nextRun: clock.t - 1000 });

test("a due task runs once per tick and its next run moves to the next slot", async () => {
  const h = harness();
  const task = addTask(h.db);
  assert.equal(await h.s.tick(), 1);
  assert.equal(h.calls.length, 1);
  assert.equal(await h.s.tick(), 0);
  const t = store.getTask(h.db, task.id);
  assert.equal(iso(t.nextRun), "2026-10-10T12:00:00.000Z");
  assert.equal(t.running, false);
  assert.equal(t.lastRun, h.clock.t);
});

test("no double run: a second run-now is refused while queued, and a second process cannot take the lease", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ backtest: async () => { await gate; return fakeRun(); } });
  const task = addTask(h.db);
  const first = h.s.enqueue(task.id, "manual");
  assert.equal(first.ok, true);
  const second = h.s.enqueue(task.id, "manual");
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  await new Promise((r) => setImmediate(r));
  assert.equal(store.getTask(h.db, task.id).running, true);
  const other = harness({ db: h.db, pid: 5151, alive: () => true });
  assert.equal(other.s.enqueue(task.id, "schedule").status, 409);
  assert.equal(await other.s.tick(), 0);
  release();
  await first.done;
  assert.equal(store.getTask(h.db, task.id).running, false);
  assert.equal(store.runsSince(h.db, 0).length, 1);
});

test("budget cap: runs past TASKS_MAX_RUNS_PER_DAY are skipped once with an alert; skips do not count", async () => {
  assert.equal(dailyCap({}), 20);
  assert.equal(dailyCap({ TASKS_MAX_RUNS_PER_DAY: "3" }), 3);
  const h = harness({ env: { TASKS_MAX_RUNS_PER_DAY: "2" } });
  const task = addTask(h.db);
  for (let i = 0; i < 4; i++) await (h.s.enqueue(task.id, "manual")).done;
  const runs = store.runsSince(h.db, 0);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(runs.map((r) => r.status).sort(), ["ok", "ok", "skipped"]);
  const skipped = runs.find((r) => r.status === "skipped");
  assert.match(skipped.summary, /Daily cap of 2/);
  assert.equal(skipped.counted, false);
  h.clock.t += 86_400_000;
  await (h.s.enqueue(task.id, "manual")).done;
  assert.equal(h.calls.length, 3);
});

test("persistence across restart: a run due while down is caught up once; a dead process's lease counts as cut off", async () => {
  const db = new DatabaseSync(":memory:");
  const clock = { t: at("2026-10-09T14:00:00Z") };
  const task = addTask(db, {}, clock);
  store.setNextRun(db, task.id, clock.t - 5 * 86_400_000);
  const h = harness({ db, clock });
  assert.deepEqual(h.s.boot(), [task.id]);
  assert.equal(store.getTask(db, task.id).nextRun, clock.t);
  assert.equal(await h.s.tick(), 1);
  assert.equal(await h.s.tick(), 0);
  assert.equal(h.calls.length, 1);

  store.setNextRun(db, task.id, clock.t + 3_600_000);
  assert.equal(store.claimTask(db, task.id, { now: clock.t, pid: 9999 }), true);
  const restarted = harness({ db, clock, alive: () => false });
  assert.deepEqual(restarted.s.boot(), [task.id]);
  assert.equal(store.getTask(db, task.id).running, false);
  const alive = harness({ db, clock, alive: () => true });
  store.setNextRun(db, task.id, clock.t + 3_600_000);
  store.claimTask(db, task.id, { now: clock.t, pid: 9998 });
  assert.deepEqual(alive.s.boot(), []);
  assert.equal(store.getTask(db, task.id).running, true);
});

test("alerts: a run posts a research row with summary, severity, source, as-of, and a link to the stored result", async () => {
  const h = harness({ backtest: async () => fakeRun(0.05, ["a", "b", "c"]) });
  const task = addTask(h.db, { thresholds: { excessPct: 3, newSignals: null } });
  await (h.s.enqueue(task.id, "manual")).done;
  const [row] = researchAlerts(h.db, "2026-10-01");
  assert.equal(row.kind, "research");
  assert.match(row.id, /^research:rn_/);
  assert.equal(row.severity, "elevated");
  assert.match(row.title, /Congress buys · excess \+5\.0% ≥ 3%/);
  assert.match(row.detail, /Excess \+5\.0% vs SPY · strategy \+6\.0% · 3 trades · hit 50%/);
  assert.equal(row.source, "Yahoo");
  assert.equal(row.asOf, "2026-10-09T11:00:00.000Z");
  assert.match(row.latency, /no model call/);
  assert.equal(row.action, `ask:research:${row.id.slice(9)}`);
  const run = store.getRun(h.db, row.id.slice(9), true);
  assert.equal(run.result.phase, "done");
  assert.equal(run.result.done.backtests[0].run.stats.excessTotal, 0.05);
  assert.match(run.result.text, /\[t1\]/);
  assert.deepEqual(run.meta.signalIds, [["a", "b", "c"]]);
  await (h.s.enqueue(task.id, "manual")).done;
  assert.match(researchAlerts(h.db, "2026-10-01")[0].detail, /0 new signals since the last run/);
});

test("a prompt task without a provider key is skipped with an alert that says so; with one it stores the answer", async () => {
  const h = harness({ prompt: async () => ({ skipped: true }) });
  const task = addTask(h.db, { kind: "prompt", prompt: "How are markets today?", specs: [] });
  await (h.s.enqueue(task.id, "manual")).done;
  const [row] = researchAlerts(h.db);
  assert.equal(row.status, "skipped");
  assert.match(row.detail, /Ask is not configured — add a key to \.env\.local/);
  assert.equal(row.action, "ask:open");

  let seen = null;
  const env = { ASK_PROVIDER: "openai", OPENAI_API_KEY: "test-not-a-key" };
  const h2 = harness({ env, prompt: async (args) => { seen = args; return { ok: true, turn: { phase: "done", text: "Up 1% [t1]" }, summary: "Up 1%", source: "Yahoo · answered by m", asOf: "2026-10-09T13:00:00Z", latency: "Ask answer in 2 s", model: "m" }; } });
  const t2 = addTask(h2.db, { kind: "prompt", prompt: "How are markets today?", specs: [] });
  await (h2.s.enqueue(t2.id, "manual")).done;
  assert.equal(seen.task.prompt, "How are markets today?");
  const [r2] = researchAlerts(h2.db);
  assert.equal(r2.status, "ok");
  assert.equal(r2.detail, "Up 1%");
  assert.equal(store.getRun(h2.db, r2.id.slice(9), true).result.text, "Up 1% [t1]");
});

test("deleting a task removes its runs; a manual run keeps the scheduled slot", async () => {
  const h = harness();
  const task = addTask(h.db);
  store.setNextRun(h.db, task.id, h.clock.t + 3_600_000);
  await (h.s.enqueue(task.id, "manual")).done;
  assert.equal(store.getTask(h.db, task.id).nextRun, h.clock.t + 3_600_000);
  assert.equal(store.deleteTask(h.db, task.id), true);
  assert.equal(store.runsSince(h.db, 0).length, 0);
});
