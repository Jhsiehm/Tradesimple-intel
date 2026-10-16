import { taskControl, setTaskControl, taskControlHistory } from "../server/domain/tasks/control.mjs";
import * as taskStore from "../server/domain/tasks/store.mjs";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createRouter } from "../server/router.mjs";
import { MANIFEST, handlers } from "../server/routes/index.mjs";
import { makeAskHandler } from "../server/routes/ask.mjs";
import { taskScheduler } from "../server/jobs/tasks.mjs";
import { DEFAULT_FILTERS, DEFAULT_RULES } from "../shared/backtestSpec.mjs";

const db = new DatabaseSync(":memory:");
const APP = "http://127.0.0.1:5173";
let server;
let base;

before(async () => {
  const routes = createRouter(MANIFEST, {
    ...handlers,
    ask: makeAskHandler({ env: { ASK_PROVIDER: "openai", OPENAI_API_KEY: "test-not-a-key" }, log: () => {} }),
  });
  server = http.createServer((req, res) => routes.handle(req, res, { db, root: "" }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

const send = (method, path, body, headers = {}) =>
  fetch(base + path, {
    method,
    headers: { origin: APP, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({
    status: r.status,
    body: (r.headers.get("content-type") || "").includes("json") ? await r.json() : await r.text(),
  }));

const SPEC = { source: "congress", filters: { ...DEFAULT_FILTERS }, rules: { ...DEFAULT_RULES } };
const TASK = {
  kind: "backtest",
  title: "Congress buys vs SPY",
  specs: [SPEC],
  schedule: { kind: "daily", time: "08:00", weekdays: true },
};

test("mutations from another site, or without JSON, are refused by the guard", async () => {
  const evil = await send("POST", "/api/tasks", TASK, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.match(evil.body.error, /not allowed/);
  const form = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { origin: APP, "content-type": "text/plain" },
    body: JSON.stringify(TASK),
  });
  assert.equal(form.status, 403);
  const del = await send("DELETE", "/api/tasks/tk_abc", undefined, { origin: "https://evil.example" });
  assert.equal(del.status, 403);
  const list = await send("GET", "/api/tasks");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items, []);
});

test("create, list, patch, run now, open the stored result, delete", async () => {
  const bad = await send("POST", "/api/tasks", { ...TASK, schedule: { kind: "hours", hours: 5 } });
  assert.equal(bad.status, 400);
  const made = await send("POST", "/api/tasks", TASK);
  assert.equal(made.status, 201);
  const t = made.body.task;
  assert.match(t.id, /^tk_/);
  assert.equal(t.every, "Weekdays at 8:00 AM ET");
  assert.ok(Date.parse(t.nextRun) > Date.now());

  const list = await send("GET", "/api/tasks");
  assert.deepEqual(Object.keys(list.body).sort(), [
    "asOf",
    "budget",
    "control",
    "items",
    "latency",
    "ok",
    "scheduler",
    "source",
  ]);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.budget.perDay, 20);

  const off = await send("PATCH", `/api/tasks/${t.id}`, { enabled: false });
  assert.equal(off.body.task.enabled, false);
  assert.equal(off.body.task.nextRun, null);
  const on = await send("PATCH", `/api/tasks/${t.id}`, { enabled: true, thresholds: { excessPct: 2 } });
  assert.ok(on.body.task.nextRun);
  assert.equal(on.body.task.thresholds.excessPct, 2);

  assert.equal((await send("GET", `/api/tasks/${t.id}/run`)).status, 405);
  const run = await send("POST", `/api/tasks/${t.id}/run`, {});
  assert.equal(run.status, 202);
  assert.equal(run.body.queued, true);
  assert.equal(run.body.task.running, true);
  await taskScheduler(db).idle();

  const item = await send("GET", `/api/tasks/${t.id}`);
  assert.equal(item.body.runs.length, 1);
  const runId = item.body.runs[0].id;
  const alerts = await send("GET", "/api/alerts");
  const row = alerts.body.items.find((a) => a.kind === "research");
  assert.equal(row.id, `research:${runId}`);
  assert.equal(row.action, `ask:research:${runId}`);
  assert.ok(alerts.body.sources.some((s) => s.label === "Research tasks"));
  const result = await send("GET", `/api/tasks/runs/${runId}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.task.id, t.id);
  assert.ok(result.body.run.result.question);
  assert.equal((await send("GET", "/api/tasks/runs/rn_missing")).status, 404);

  const gone = await send("DELETE", `/api/tasks/${t.id}`);
  assert.equal(gone.body.deleted, t.id);
  assert.equal((await send("GET", `/api/tasks/${t.id}`)).status, 404);
});

test("asking Ask to schedule something answers with a draft and no model call", async () => {
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { origin: APP, "content-type": "application/json" },
    body: JSON.stringify({ question: "every morning at 8, check new insider buys on my watchlist and backtest them" }),
  });
  assert.equal(res.status, 200);
  const events = (await res.text())
    .split("\n\n")
    .filter(Boolean)
    .map((b) => JSON.parse(b.replace(/^data: /, "")));
  const done = events.find((e) => e.type === "done");
  assert.equal(done.task.kind, "backtest");
  assert.equal(done.task.specs[0].source, "form4");
  assert.equal(done.task.useWatchlist, true);
  assert.match(done.answer, /Schedule it/);
  assert.equal(done.usage.tokens, 0);
});

test("durable task attempts are inspectable after task deletion and are read-only", async () => {
  const made = await send("POST", "/api/tasks", TASK),
    task = taskStore.getTask(db, made.body.task.id);
  const attempt = taskStore.reserveAttempt(db, task, { startedAt: Date.now(), pid: 9999, trigger: "manual", cap: 100 });
  taskStore.completeAttempt(db, attempt.id, {
    status: "interrupted",
    finishedAt: Date.now(),
    reason: "Synthetic interruption",
  });
  await send("DELETE", `/api/tasks/${task.id}`);
  const list = await send("GET", "/api/tasks/attempts");
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((a) => a.id === attempt.id && a.status === "interrupted"));
  const read = await send("GET", `/api/tasks/attempts/${attempt.id}`);
  assert.equal(read.body.attempt.task.title, task.title);
  assert.equal(read.body.attempt.completion.reason, "Synthetic interruption");
  assert.equal((await send("POST", `/api/tasks/attempts/${attempt.id}`, {})).status, 405);
  assert.equal((await send("GET", "/api/tasks/attempts/ta_deadbeef")).status, 404);
});

test("admission pause requires a reason and current revision, is origin guarded and blocks run-now", async () => {
  const initial = await send("GET", "/api/tasks/control");
  assert.equal(initial.body.control.revision, 0);
  assert.equal((await send("POST", "/api/tasks/control", { paused: true, baseRevision: 0, reason: "" })).status, 400);
  assert.equal(
    (
      await send(
        "POST",
        "/api/tasks/control",
        { paused: true, baseRevision: 0, reason: "Pause" },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  const paused = await send("POST", "/api/tasks/control", {
    paused: true,
    baseRevision: 0,
    reason: "Synthetic control check",
    actor: "forged",
  });
  assert.equal(paused.body.control.actor, "local-owner");
  assert.equal(paused.body.control.paused, true);
  const made = await send("POST", "/api/tasks", TASK);
  assert.equal((await send("POST", `/api/tasks/${made.body.task.id}/run`, {})).status, 409);
  assert.equal((await send("GET", "/api/tasks")).body.control.paused, true);
  assert.equal(
    (await send("POST", "/api/tasks/control", { paused: false, baseRevision: 0, reason: "Stale resume" })).status,
    409,
  );
  const resumed = await send("POST", "/api/tasks/control", {
    paused: false,
    baseRevision: 1,
    reason: "Check complete",
  });
  assert.equal(resumed.body.control.paused, false);
  assert.equal((await send("GET", "/api/tasks/control")).body.history.length, 2);
  await send("DELETE", `/api/tasks/${made.body.task.id}`);
});

test("stop endpoint targets an exact active attempt, enforces origin and exposes request state", async () => {
  const task = taskStore.createTask(db, TASK, { now: Date.now(), nextRun: null });
  const start = Date.now();
  taskStore.claimTask(db, task.id, { now: start, pid: process.pid });
  const attempt = taskStore.reserveAttempt(db, task, {
    startedAt: start,
    pid: process.pid,
    trigger: "manual",
    cap: 100,
  });
  assert.ok(attempt);
  const url = `/api/tasks/attempts/${attempt.id}/stop`;
  assert.equal((await send("GET", url)).status, 405);
  assert.equal((await send("POST", url, { reason: "test" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await send("POST", url, { reason: "" })).status, 400);
  assert.equal((await send("POST", url, { reason: "Synthetic route stop" })).status, 202);
  const list = await send("GET", "/api/tasks");
  assert.deepEqual(list.body.items.find((t) => t.id === task.id).activeAttempt, {
    id: attempt.id,
    stopRequested: true,
  });
  const detail = await send("GET", `/api/tasks/attempts/${attempt.id}`);
  assert.equal(detail.body.stopRequest.reason, "Synthetic route stop");
  assert.equal(detail.body.attempt.completion, null);
  taskStore.completeAttempt(db, attempt.id, { status: "interrupted", finishedAt: Date.now() });
  taskStore.releaseTask(db, task.id, { lastRun: start, nextRun: null });
  assert.equal((await send("POST", url, { reason: "Retry" })).status, 202);
});
