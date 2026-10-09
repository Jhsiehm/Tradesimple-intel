import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPENROUTER_MENU, cleanContext, contextNote, fallbackTable, figureCount, greetingText, isGreeting, modelOptions, resolveModel, retryReason, rowCount, smallModel
} from "../shared/agent.mjs";
import { ASK_LIMITS, cleanAsk } from "../shared/ask.mjs";
import { askConfig } from "../server/ai/config.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { TOOLS, runTool, toolDefs } from "../server/ai/tools.mjs";

function scripted(...rounds) {
  const seen = [];
  return {
    seen,
    async *chat(messages, tools, opts) {
      seen.push({ messages: messages.map((m) => ({ ...m })), opts });
      for (const e of rounds.shift() || [{ type: "text", delta: "done" }]) yield e;
    }
  };
}
const TOOL = (name, args, id = "c1") => ({ type: "tool_call", id, name, args });
const TEXT = (t) => [{ type: "text", delta: t }];

async function ask(provider, { question = "q", execute, context = null, history = [], prefs = null, prior = null, answers = {}, acceptDefaults = false } = {}) {
  const events = [];
  await runAsk({
    question, history, context, prefs, prior, answers, acceptDefaults, provider, tools: toolDefs(), labelOf: (n) => n, emit: (e) => events.push(e), today: "2026-10-09",
    execute: execute || (async () => ({ ok: true, source: "House Clerk", asOf: "2026-10-09", latency: "12 h", items: [{ symbol: "NVDA", ret: 0.1234, spy: 0.0311 }, { symbol: "LMT", ret: -0.02, spy: 0.0311 }] }))
  });
  return events;
}

/* ---------- config and models ---------- */

test("an OpenRouter key alone configures Ask on openrouter with a Sonnet-class default; AGENT_MODEL is an alias", () => {
  const cfg = askConfig({ OPENROUTER_API_KEY: "sk-or" });
  assert.deepEqual([cfg.configured, cfg.provider, cfg.model, cfg.inferred], [true, "openrouter", "anthropic/claude-sonnet-4.6", true]);
  assert.equal(askConfig({ OPENROUTER_API_KEY: "k", AGENT_MODEL: "openai/gpt-4.1" }).model, "openai/gpt-4.1");
  assert.equal(askConfig({ OPENROUTER_API_KEY: "k", AGENT_MODEL: "x", ASK_MODEL: "y" }).model, "y");
  assert.equal(askConfig({ ASK_PROVIDER: "openai", OPENAI_API_KEY: "k" }).model, "gpt-4.1");
  assert.equal(askConfig({}).configured, false);
  assert.ok(!JSON.stringify(cfg).includes("sk-or"));
});

test("the model menu is OpenRouter only, and an id off the menu falls back to the server's model", () => {
  const or = { provider: "openrouter", model: "anthropic/claude-sonnet-4.6" };
  assert.deepEqual(modelOptions(or), OPENROUTER_MENU);
  assert.equal(resolveModel("openai/gpt-4.1", or), "openai/gpt-4.1");
  assert.equal(resolveModel("evil/model", or), or.model);
  assert.deepEqual(modelOptions({ provider: "openai", model: "gpt-4.1" }), ["gpt-4.1"]);
  assert.equal(resolveModel("openai/gpt-4.1", { provider: "openai", model: "gpt-4.1" }), "gpt-4.1");
});

test("small models are flagged; Sonnet-class and GPT-4.1 are not", () => {
  for (const id of ["openai/gpt-4o-mini", "openai/gpt-4.1-nano", "anthropic/claude-haiku-4.5", "google/gemini-2.5-flash", "llama-3-8b"]) assert.equal(smallModel(id), true, id);
  for (const id of ["anthropic/claude-sonnet-4.6", "openai/gpt-4.1", "gpt-4.1", "google/gemini-2.5-pro", "claude-sonnet-4-5"]) assert.equal(smallModel(id), false, id);
});

/* ---------- context hygiene ---------- */

test("nothing selected means no screen context at all", () => {
  assert.equal(cleanContext({ section: "map", node: null }), null);
  assert.equal(cleanContext({ node: "strait:hormuz" }), null);
  assert.equal(contextNote(null), "");
  const ctx = cleanContext({ node: "ticker:NVDA", label: "NVIDIA" });
  assert.match(contextNote(ctx), /attached .*Ticker NVDA \(NVIDIA\)/);
  assert.equal(cleanAsk({ question: "hi", context: { section: "map" } }).context, null);
});

test("the system prompt carries the screen only when something is attached", async () => {
  const bare = scripted(TEXT("No figures needed."));
  await ask(bare, { question: "what is a PTR filing?" });
  assert.doesNotMatch(bare.seen[0].messages[0].content, /attached what is on screen|strait/i);
  const withCtx = scripted(TEXT("ok"));
  await ask(withCtx, { question: "what about this one?", context: cleanContext({ node: "member:P000197" }) });
  assert.match(withCtx.seen[0].messages[0].content, /attached what is on screen: Member P000197/);
});

test("'hi' gets a short greeting with example questions and no model call", async () => {
  assert.ok(isGreeting("hi") && isGreeting("Hello!") && isGreeting("thanks") && !isGreeting("hi, what did Pelosi buy?"));
  const p = scripted();
  const events = await ask(p, { question: "hi" });
  assert.equal(p.seen.length, 0);
  const done = events.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.greeting, true);
  assert.equal(done.answer, greetingText());
  assert.ok((done.answer.match(/^- /gm) || []).length >= 3);
  assert.doesNotMatch(done.answer, /strait/i);
});

/* ---------- answers carry the data ---------- */

test("rowCount and figureCount", () => {
  assert.equal(rowCount({ ok: true, items: [{}, {}, {}] }), 3);
  assert.equal(rowCount({ ok: true, items: { items: [{}], total: 40, truncated: true } }), 40);
  assert.equal(rowCount({ ok: true, stats: { trades: 17 } }), 17);
  assert.equal(rowCount({ ok: false, items: [{}] }), 0);
  assert.equal(figureCount("Here are the top disclosed buys [t1]. 1. Ask me more."), 0);
  assert.equal(figureCount("| NVDA | +12.3% | 3.1% | [t1] |"), 2);
});

test("an answer with no figures after a data tool returned rows is rewritten once with the numbers", async () => {
  const p = scripted([TOOL("congress_leaders", {})], TEXT("Here are the top disclosed buys ranked against SPY [t1]."), TEXT("| Ticker | Return | SPY |\n|---|---|---|\n| NVDA | 12.34% | 3.11% [t1] |"));
  const events = await ask(p, { question: "give me it" });
  assert.equal(p.seen.length, 3);
  assert.match(p.seen[2].messages.at(-1).content, /no figures.*t1 returned 2 rows/s);
  assert.ok(events.some((e) => e.type === "step_progress" && e.reset));
  const done = events.at(-1);
  assert.equal(done.retried, true);
  assert.match(done.answer, /12\.34%/);
  assert.equal(done.table, null);
  assert.deepEqual(done.grounding.unmatched, []);
});

test("if the rewrite still has no figures, done carries the tool's own table", async () => {
  const p = scripted([TOOL("congress_leaders", {})], TEXT("Here they are [t1]."), TEXT("Still here they are [t1]."));
  const done = (await ask(p)).at(-1);
  assert.equal(done.retried, true);
  assert.deepEqual(done.table.columns, ["symbol", "ret", "spy"]);
  assert.deepEqual(done.table.rows[0], ["NVDA", "0.1234", "0.0311"]);
  assert.equal(done.table.ref, "t1");
  assert.equal(done.table.source, "House Clerk");
});

test("a backtest question that skipped run_backtest is pushed to run it", async () => {
  assert.match(retryReason("backtest the last 30 days", "The platform cannot backtest.", []), /run_backtest/);
  const spec = { source: "congress", filters: { from: "2026-09-09", to: "2026-10-09" }, rules: { openTrades: "mark", holdDays: 30 } };
  const p = scripted(TEXT("The platform does not have a backtest tool."), [TOOL("run_backtest", { spec })], TEXT("Spec: congress buys 2026-09-09 → 2026-10-09, hold 30 d, marked. Return 4.10% vs SPY 2.00% [t1]."));
  const seenSpecs = [];
  const events = await ask(p, {
    question: "Backtest the last 30 days from all data sources",
    acceptDefaults: true,
    execute: async (name, args) => { seenSpecs.push(args.spec); return { ok: true, source: "House Clerk · Yahoo", asOf: "2026-10-09", latency: "x", spec: args.spec, stats: { trades: 12, totalReturn: 0.041, benchmarkReturn: 0.02 } }; }
  });
  assert.equal(seenSpecs.length, 1);
  assert.deepEqual([seenSpecs[0].source, seenSpecs[0].filters.from, seenSpecs[0].filters.to, seenSpecs[0].rules.openTrades, seenSpecs[0].rules.holdDays, seenSpecs[0].rules.benchmark], ["congress", "2026-09-09", "2026-10-09", "mark", 30, "SPY"]);
  const done = events.at(-1);
  assert.equal(done.retried, true);
  assert.deepEqual(done.cited, ["t1"]);
  assert.match(p.seen[0].messages[0].content, /filters\.from to N days before today \(30 days → 2026-09-09\)/);
});

test("fallbackTable turns backtest stats into metric rows", () => {
  const t = fallbackTable({ ok: true, stats: { trades: 12, totalReturn: 0.04123456, from: "2026-09-10" } });
  assert.deepEqual(t.columns, ["metric", "value"]);
  assert.deepEqual(t.rows, [["trades", "12"], ["totalReturn", "0.0412"], ["from", "2026-09-10"]]);
});

/* ---------- live steps ---------- */

test("tool calls in one turn run in parallel and stream start, routes, and end with rows and labels", async () => {
  const p = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")], TEXT("NVDA 12.34% [t1], insiders 2 rows [t2] with 0.0311."));
  let inflight = 0;
  let peak = 0;
  const events = await ask(p, {
    execute: async (name, _args, hooks) => {
      inflight += 1; peak = Math.max(peak, inflight);
      hooks?.onRoute?.(`GET /api/${name}`);
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
      return { ok: true, source: `S ${name}`, asOf: "2026-10-09", latency: "1 h", items: [{ a: 1.5 }, { a: 2.5 }] };
    }
  });
  assert.equal(peak, 2);
  const starts = events.filter((e) => e.type === "step_start");
  assert.deepEqual(starts.map((e) => [e.id, e.tool, e.phase]), [["t1", "congress_leaders", "fetching"], ["t2", "insiders", "fetching"]]);
  const end = events.find((e) => e.type === "step_end" && e.id === "t1");
  assert.deepEqual([end.ok, end.rows, end.source, end.requests[0]], [true, 2, "S congress_leaders", "GET /api/congress_leaders"]);
  assert.match(end.preview, /"a":1.5/);
  assert.ok(events.some((e) => e.type === "step_progress" && e.request === "GET /api/insiders"));
  const phases = events.filter((e) => e.type === "step_progress" && e.phase).map((e) => e.phase);
  assert.deepEqual([...new Set(phases)], ["planning", "fetching", "writing"]);
  assert.deepEqual(events.filter((e) => e.type === "citation").map((e) => e.id), ["t1", "t2"]);
  assert.ok(events.indexOf(starts[1]) < events.indexOf(end), "both steps start before either ends");
});

test("run_backtest is a computing step", async () => {
  const p = scripted([TOOL("run_backtest", { spec: { source: "form4" } })], TEXT("4.10% [t1] over 12 trades."));
  const events = await ask(p, { execute: async () => ({ ok: true, source: "SEC", asOf: "a", latency: "l", stats: { trades: 12, totalReturn: 0.041 } }) });
  assert.equal(events.find((e) => e.type === "step_start").phase, "computing");
  assert.equal(events.find((e) => e.type === "step_end").rows, 12);
});

/* ---------- tools ---------- */

test("propose_theory writes nothing and hands the theory to done", async () => {
  const t = TOOLS.find((x) => x.name === "propose_theory");
  assert.equal((await t.run({}, { a: "member:P000197", b: "member:P000197", label: "x" })).ok, false);
  const p = scripted([TOOL("propose_theory", { a: "member:P000197", aLabel: "Nancy Pelosi", b: "ticker:NVDA", label: "Pelosi ↔ NVDA" })], TEXT("Proposed [t1]."));
  const done = (await ask(p, { execute: (name, args) => runTool({}, name, args) })).at(-1);
  assert.deepEqual([done.theory.a.id, done.theory.a.label, done.theory.b.id], ["member:P000197", "Nancy Pelosi", "ticker:NVDA"]);
});

test("runTool reports each in-process route it calls", async () => {
  const seen = [];
  const call = async () => ({ ok: true, source: "s", asOf: "a", latency: "l", items: [] });
  await runTool({}, "ticker_dossier", { symbol: "nvda" }, call, (r) => seen.push(r));
  assert.deepEqual(seen, ["GET /api/tickers/NVDA"]);
});

test("the backtest spec the model can send includes openTrades", () => {
  const bt = TOOLS.find((t) => t.name === "run_backtest");
  assert.deepEqual(bt.parameters.properties.spec.properties.rules.properties.openTrades.enum, ["exclude", "mark"]);
  assert.ok(ASK_LIMITS.totalMs >= 120_000);
});

/* ---------- backtests in the chat ---------- */

test("an ambiguous backtest asks chips first and calls no model", async () => {
  const p = scripted();
  const events = await ask(p, { question: "backtest congress buys" });
  assert.equal(p.seen.length, 0);
  const c = events.find((e) => e.type === "clarify");
  assert.deepEqual(c.questions.map((q) => q.path), ["rules.holdDays", "rules.benchmark"]);
  assert.match(c.sentence, /Congressional trades/);
  assert.equal(events.at(-1).clarify, true);
});

test("preference statements are saved by the client, not answered by the model", async () => {
  const p = scripted();
  const done = (await ask(p, { question: "I usually want 90-day holds vs SPY" })).at(-1);
  assert.equal(p.seen.length, 0);
  assert.deepEqual(done.prefs, { set: { "rules.holdDays": 90, "rules.benchmark": "SPY" } });
  assert.match(done.answer, /hold 90 days/);
  assert.deepEqual((await ask(scripted(), { question: "clear my preferences" })).at(-1).prefs, { clear: true });
});

test("preferences and picks fill the spec the model sends, and the step says which", async () => {
  const p = scripted([TOOL("run_backtest", { spec: { source: "congress", rules: { holdDays: 90, benchmark: "SPY" } } })], TEXT("Using: congress. 4.10% [t1] over 12 trades."));
  const seen = [];
  const events = await ask(p, {
    question: "backtest congress buys",
    prefs: { v: 1, values: { "rules.holdDays": 30 } },
    answers: { "rules.benchmark": "SECTOR" },
    execute: async (_n, args) => { seen.push(args.spec); return { ok: true, source: "s", asOf: "a", latency: "l", spec: args.spec, stats: { trades: 12, totalReturn: 0.041 } }; }
  });
  assert.equal(seen[0].rules.holdDays, 30);
  assert.equal(seen[0].rules.benchmark, "SECTOR");
  assert.match(p.seen[0].messages[0].content, /Backtest spec to use/);
  const start = events.find((e) => e.type === "step_start");
  assert.equal(start.from["rules.holdDays"], "preference");
  assert.equal(start.from["rules.benchmark"], "your pick");
  assert.ok(events.some((e) => e.type === "step_progress" && /^Using: .*hold 30 d.*from your preferences: hold/.test(e.note || "")));
  const done = events.at(-1);
  assert.equal(done.backtests.length, 1);
  assert.equal(done.backtests[0].spec.rules.holdDays, 30);
  assert.match(done.backtests[0].open, /^bt:token:/);
});

test("a follow-up reruns the previous spec with the change and a diff", async () => {
  const prior = { source: "congress", filters: {}, rules: { holdDays: 90, benchmark: "SPY" } };
  const p = scripted([TOOL("run_backtest", { spec: { source: "congress", rules: { holdDays: 90 } } })], TEXT("Using: 30 d. 1.00% vs 2.00% [t1]."));
  const seen = [];
  const events = await ask(p, { question: "hold 30 days instead", prior, execute: async (_n, args) => { seen.push(args.spec); return { ok: true, source: "s", asOf: "a", latency: "l", spec: args.spec, stats: { trades: 3, totalReturn: 0.01 } }; } });
  assert.equal(events.some((e) => e.type === "clarify"), false);
  assert.equal(seen[0].rules.holdDays, 30);
  assert.match(p.seen[0].messages[0].content, /changes the previous run/);
  const done = events.at(-1);
  assert.deepEqual(done.backtests[0].diff, ["hold 90 d → hold 30 d"]);
  assert.equal(done.backtests[0].prior.rules.holdDays, 90);
});
