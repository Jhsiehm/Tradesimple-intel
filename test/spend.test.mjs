import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { WEB_SEARCH_USD, budgetLevel, budgetNote, budgetSettings, callCost, monthKey, priceOf, spendLine, webSearchCost } from "../shared/spend.mjs";
import { runWebSearch } from "../server/ai/webTool.mjs";
import { metered, monthSpend, recordSpend, spendState } from "../server/ai/spend.mjs";
import { askStatus, makeAskHandler } from "../server/routes/ask.mjs";
import { runPromptTask } from "../server/ai/taskAsk.mjs";
import { makeLimiter } from "../shared/ask.mjs";

const OCT = Date.parse("2026-10-09T14:00:00Z");
const ENV = { ASK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-test", ASK_MONTHLY_BUDGET_USD: "1" };

function fakeReq(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = "POST";
  req.headers = {};
  req.socket = { remoteAddress: "9.9.9.9" };
  return req;
}
function fakeRes() {
  const res = { chunks: [], head: null, ended: false, writableEnded: false, destroyed: false, on() {} };
  res.writeHead = (status, headers) => { res.head = { status, headers }; };
  res.write = (c) => { res.chunks.push(c); return true; };
  res.end = () => { res.ended = true; res.writableEnded = true; };
  res.events = () => res.chunks.join("").split("\n\n").filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, "")));
  return res;
}
/** A provider that answers in one round and reports usage the way OpenRouter does (with cost) or not at all. */
const answering = (model, { cost, usage = true } = {}) => ({
  name: "openrouter",
  model,
  async *chat() {
    yield { type: "text", delta: "Nothing to look up." };
    if (usage) yield { type: "usage", input: 1000, output: 200, ...(cost != null ? { cost } : {}) };
    yield { type: "end", reason: "stop" };
  }
});

test("prices: OpenRouter's reported cost wins; else tokens × the table; unknown models priced like Sonnet", () => {
  assert.deepEqual(callCost({ model: "anthropic/claude-sonnet-4.6", input: 1000, output: 200, cost: 0.0123 }), { usd: 0.0123, priced: "reported" });
  assert.equal(callCost({ model: "anthropic/claude-sonnet-4.6", input: 1_000_000, output: 100_000 }).usd, 4.5);
  assert.equal(callCost({ model: "openai/gpt-4o-mini", input: 1_000_000, output: 1_000_000 }).usd, 0.75);
  assert.deepEqual(priceOf("openai/gpt-4.1-mini"), { input: 0.4, output: 1.6, known: true });
  assert.equal(priceOf("openai/gpt-4.1").input, 2);
  assert.equal(callCost({ model: "acme/unknown-1", input: 1_000_000 }).priced, "fallback");
});

test("web searches count toward the month: OpenRouter's reported cost, else carrier tokens + per-result plugin price", async () => {
  assert.deepEqual(webSearchCost({ provider: "openrouter", results: 5, cost: 0.0213 }), { usd: 0.0213, priced: "reported" });
  const est = webSearchCost({ provider: "openrouter", model: "openai/gpt-4o-mini", results: 5, input: 1000, output: 60 });
  assert.equal(est.priced, "web-estimate");
  assert.ok(Math.abs(est.usd - (5 * WEB_SEARCH_USD.openrouterPerResult + (1000 * 0.15 + 60 * 0.6) / 1e6)) < 1e-12);
  assert.equal(webSearchCost({ provider: "brave" }).usd, WEB_SEARCH_USD.brave);

  const db = new DatabaseSync(":memory:");
  const env = { OPENROUTER_API_KEY: "sk-or-test" };
  const body = { choices: [{ message: { annotations: [{ type: "url_citation", url_citation: { url: "https://example.com/a", title: "A", content: "text" } }] } }], usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0071 } };
  let sent = null;
  const out = await runWebSearch({ query: "taiex today" }, { db, env, fetcher: async (_url, opts) => { sent = JSON.parse(opts.body); return body; } });
  assert.equal(out.ok, true);
  assert.equal("spend" in out, false, "the cost never reaches the model");
  assert.deepEqual(sent.usage, { include: true });
  const m = monthSpend(db, monthKey(Date.now()));
  assert.equal(m.calls, 1);
  assert.equal(m.web, 0.0071);
  assert.equal(m.spent, 0.0071);
  const failed = await runWebSearch({ query: "x" }, { db, env, fetcher: async () => { throw new Error("down"); } });
  assert.equal(failed.ok, false);
  assert.equal(monthSpend(db, monthKey(Date.now())).calls, 1, "a search that failed in transit is not billed");
});

test("months are counted in New York time", () => {
  assert.equal(monthKey(Date.parse("2026-11-01T03:00:00Z")), "2026-10");
  assert.equal(monthKey(Date.parse("2026-11-01T05:00:00Z")), "2026-11");
});

test("budget levels: warn from 80%, over at 100%, stop only with the hard stop; 0 turns the cap off", () => {
  assert.equal(budgetLevel({ spent: 15, budget: 20 }).level, "ok");
  assert.equal(budgetLevel({ spent: 16, budget: 20 }).level, "warn");
  assert.equal(budgetLevel({ spent: 20, budget: 20 }).level, "over");
  assert.equal(budgetLevel({ spent: 20, budget: 20, hardStop: true }).level, "stop");
  assert.equal(budgetLevel({ spent: 99, budget: 0 }).level, "ok");
  assert.deepEqual(budgetSettings({}, "openrouter"), { budget: 20, hardStop: false, cheap: "openai/gpt-4o-mini" });
  assert.deepEqual(budgetSettings({ ASK_MONTHLY_BUDGET_USD: "5", ASK_BUDGET_HARD_STOP: "1", ASK_CHEAP_MODEL: "x/y" }, "openrouter"), { budget: 5, hardStop: true, cheap: "x/y" });
  assert.match(budgetNote({ level: "over", spent: 20.4, budget: 20, cheap: "openai/gpt-4o-mini", month: "2026-10" }), /\$20\.40 of the \$20\.00 monthly Ask budget is spent, so every answer uses openai\/gpt-4o-mini until Nov 1/);
  assert.match(budgetNote({ level: "warn", spent: 16.5, budget: 20, cheap: "c", month: "2026-12" }), /83%/);
  assert.equal(spendLine({ spent: 3.214, budget: 20 }), "$3.21 of $20.00 this month");
});

test("the ledger: metered calls land in sqlite with reported or estimated cost; tasks count toward the month", async () => {
  const db = new DatabaseSync(":memory:");
  const drain = async (p) => { for await (const _ of p.chat([{ role: "user", content: "x".repeat(4000) }], [])) { /* drain */ } };
  await drain(metered(answering("anthropic/claude-sonnet-4.6", { cost: 0.02 }), { db, kind: "ask", now: () => OCT }));
  await drain(metered(answering("openai/gpt-4o-mini", { usage: false }), { db, kind: "task", now: () => OCT }));
  const failing = { name: "x", model: "m", async *chat() { throw new Error("401"); } };
  await assert.rejects(drain(metered(failing, { db, now: () => OCT })));
  const m = monthSpend(db, "2026-10");
  assert.equal(m.calls, 2, "a call that failed before any event costs nothing");
  assert.ok(m.spent > 0.02 && m.spent < 0.021);
  assert.ok(m.tasks > 0 && m.tasks < 0.001);
  assert.equal(monthSpend(db, "2026-09").calls, 0);
  const s = spendState(db, { ASK_MONTHLY_BUDGET_USD: "0.025" }, OCT, "openrouter");
  assert.equal(s.level, "warn");
  assert.match(s.note, /Ask has used/);
});

test("route: spend shows in GET /api/ask and closes each stream; at 100% everything runs on the cheap model and says so", async () => {
  const db = new DatabaseSync(":memory:");
  const built = [];
  const handler = makeAskHandler({ env: ENV, makeProvider: (cfg) => { built.push(cfg.model); return answering(cfg.model, { cost: 0.85 }); }, now: () => OCT, limiter: makeLimiter({ max: 99, windowMs: 1000 }), log: () => {} });
  const status = await handler({ req: { method: "GET" }, res: null, db });
  assert.deepEqual([status.spend.spent, status.spend.budget, status.spend.level], [0, 1, "ok"]);

  const first = fakeRes();
  await handler({ req: fakeReq({ question: "What changed in contracts?", model: "anthropic/claude-sonnet-4.6" }), res: first, db });
  const spendEv = first.events().at(-1);
  assert.equal(spendEv.type, "spend");
  assert.equal(spendEv.spend.spent, 0.85);
  assert.equal(built.at(-1), "anthropic/claude-sonnet-4.6");

  const second = fakeRes();
  await handler({ req: fakeReq({ question: "And lobbying?", model: "anthropic/claude-sonnet-4.6" }), res: second, db });
  const warn = second.events().find((e) => e.type === "budget");
  assert.equal(warn.level, "warn");

  const third = fakeRes();
  await handler({ req: fakeReq({ question: "And insiders?", model: "anthropic/claude-sonnet-4.6" }), res: third, db });
  const over = third.events().find((e) => e.type === "budget");
  assert.deepEqual([over.level, over.model], ["over", "openai/gpt-4o-mini"]);
  assert.match(over.note, /every answer uses openai\/gpt-4o-mini/);
  assert.equal(built.at(-1), "openai/gpt-4o-mini", "a pinned model is overridden once the budget is spent");
  assert.equal(third.events().find((e) => e.type === "done").model, "openai/gpt-4o-mini");
  assert.equal(askStatus(ENV, db, OCT).spend.level, "over");
});

test("route: with ASK_BUDGET_HARD_STOP the question is refused with the reason, and no model is built", async () => {
  const db = new DatabaseSync(":memory:");
  recordSpend(db, { at: OCT, model: "anthropic/claude-sonnet-4.6", cost: 2 });
  const handler = makeAskHandler({ env: { ...ENV, ASK_BUDGET_HARD_STOP: "1" }, makeProvider: () => assert.fail("provider built"), now: () => OCT, log: () => {} });
  const out = await handler({ req: fakeReq({ question: "Anything new?" }), res: fakeRes(), db });
  assert.equal(out.status, 402);
  assert.match(out.body.error, /Ask is paused/);
});

test("scheduled prompt tasks are metered as 'task' and fall back to the cheap model when the budget is spent", async () => {
  const db = new DatabaseSync(":memory:");
  const task = { id: "tk_1", prompt: "Summarize new contracts" };
  const models = [];
  const makeProvider = (cfg) => { models.push(cfg.model); return answering(cfg.model, { cost: 0.3 }); };
  await runPromptTask({ db, task, env: ENV, now: () => OCT, makeProvider, execute: async () => ({ ok: true }) });
  assert.equal(monthSpend(db, "2026-10").tasks, 0.3);
  recordSpend(db, { at: OCT, model: "m", cost: 1 });
  const out = await runPromptTask({ db, task, env: ENV, now: () => OCT, makeProvider, execute: async () => ({ ok: true }) });
  assert.equal(models.at(-1), "openai/gpt-4o-mini");
  assert.ok(out.turn.notes.some((n) => /monthly Ask budget is spent/.test(n)));
  const stopped = await runPromptTask({ db, task, env: { ...ENV, ASK_BUDGET_HARD_STOP: "1" }, now: () => OCT, makeProvider, execute: async () => ({ ok: true }) });
  assert.deepEqual([stopped.ok, stopped.skipped], [false, true]);
});
