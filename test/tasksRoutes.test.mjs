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
  const routes = createRouter(MANIFEST, { ...handlers, ask: makeAskHandler({ env: { ASK_PROVIDER: "openai", OPENAI_API_KEY: "test-not-a-key" }, log: () => {} }) });
  server = http.createServer((req, res) => routes.handle(req, res, { db, root: "" }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

const send = (method, path, body, headers = {}) =>
  fetch(base + path, { method, headers: { origin: APP, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: (r.headers.get("content-type") || "").includes("json") ? await r.json() : await r.text() }));

const SPEC = { source: "congress", filters: { ...DEFAULT_FILTERS }, rules: { ...DEFAULT_RULES } };
const TASK = { kind: "backtest", title: "Congress buys vs SPY", specs: [SPEC], schedule: { kind: "daily", time: "08:00", weekdays: true } };

test("mutations from another site, or without JSON, are refused by the guard", async () => {
  const evil = await send("POST", "/api/tasks", TASK, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.match(evil.body.error, /not allowed/);
  const form = await fetch(`${base}/api/tasks`, { method: "POST", headers: { origin: APP, "content-type": "text/plain" }, body: JSON.stringify(TASK) });
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
  assert.deepEqual(Object.keys(list.body).sort(), ["asOf", "budget", "items", "latency", "ok", "scheduler", "source"]);
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
  const res = await fetch(`${base}/api/ask`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: JSON.stringify({ question: "every morning at 8, check new insider buys on my watchlist and backtest them" }) });
  assert.equal(res.status, 200);
  const events = (await res.text()).split("\n\n").filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, "")));
  const done = events.find((e) => e.type === "done");
  assert.equal(done.task.kind, "backtest");
  assert.equal(done.task.specs[0].source, "form4");
  assert.equal(done.task.useWatchlist, true);
  assert.match(done.answer, /Schedule it/);
  assert.equal(done.usage.tokens, 0);
});
