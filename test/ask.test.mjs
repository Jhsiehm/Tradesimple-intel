import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { ASK_LIMITS, NOT_CONFIGURED, caveatsFor, cleanAsk, citationRefs, evidenceOf, groundingCheck, makeLimiter, numbersIn, openAction, toolProblems, trimForModel } from "../shared/ask.mjs";
import { askConfig, askKey } from "../server/ai/config.mjs";
import { sseEvents } from "../server/ai/sse.mjs";
import { ProviderError, anthropicProvider, createProvider, openaiProvider, toAnthropic, toOpenAI } from "../server/ai/providers.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { TOOLS, summarizeBacktest, toolDefs } from "../server/ai/tools.mjs";
import { makeAskHandler, askStatus } from "../server/routes/ask.mjs";

/* ---------- helpers: no network anywhere in this file ---------- */

const enc = new TextEncoder();
function streamOf(chunks) {
  return new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
}
const sse = (...events) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
const sseNamed = (...events) => events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join("");
function fakeFetch(...bodies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = bodies.shift();
    if (next instanceof Response) return next;
    return new Response(streamOf([next]), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  fn.calls = calls;
  return fn;
}
const collect = async (gen) => { const out = []; for await (const e of gen) out.push(e); return out; };

const OAI_TOOL_ROUND = sse(
  { choices: [{ delta: { content: "Looking." } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "ticker_dossier", arguments: '{"sym' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'bol":"NVDA"}' } }] } }] },
  { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  { choices: [], usage: { prompt_tokens: 120, completion_tokens: 18 } },
  "[DONE]"
);
const OAI_TEXT_ROUND = sse({ choices: [{ delta: { content: "NVDA is joined [t1]." } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]");

/* ---------- config ---------- */

test("no ASK_PROVIDER means not configured, with the sentence the panel shows", () => {
  const cfg = askConfig({});
  assert.equal(cfg.configured, false);
  assert.equal(cfg.error, NOT_CONFIGURED);
  assert.deepEqual(cfg.missing, ["ASK_PROVIDER"]);
  assert.equal(NOT_CONFIGURED, "Ask is not configured — add a key to .env.local");
});

test("each provider needs its own key; a key for another provider does not count", () => {
  assert.deepEqual(askConfig({ ASK_PROVIDER: "anthropic" }).missing, ["ANTHROPIC_API_KEY"]);
  assert.deepEqual(askConfig({ ASK_PROVIDER: "openai", ANTHROPIC_API_KEY: "x" }).missing, ["OPENAI_API_KEY"]);
  assert.deepEqual(askConfig({ ASK_PROVIDER: "compat", ASK_API_KEY: "k", ASK_MODEL: "m" }).missing, ["ASK_BASE_URL"]);
  assert.deepEqual(askConfig({ ASK_PROVIDER: "compat", ASK_BASE_URL: "https://gw.example/v1" }).missing.sort(), ["ASK_API_KEY", "ASK_MODEL"]);
  assert.deepEqual(askConfig({ ASK_PROVIDER: "openrouter" }).missing, ["OPENROUTER_API_KEY"]);
  assert.equal(askConfig({ ASK_PROVIDER: "bogus" }).configured, false);
});

test("a complete setup is configured; the key is read apart and never part of the config", () => {
  const env = { ASK_PROVIDER: "compat", ASK_BASE_URL: "https://gw.example/v1/", ASK_API_KEY: "sk-secret", ASK_MODEL: "vendor/model" };
  const cfg = askConfig(env);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.baseUrl, "https://gw.example/v1");
  assert.equal(askKey(cfg, env), "sk-secret");
  assert.ok(!JSON.stringify(cfg).includes("sk-secret"));
  assert.equal(askConfig({ ASK_PROVIDER: "gateway", ...env }).provider, "compat");
  assert.equal(askConfig({ ASK_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a" }).model.length > 0, true);
  assert.equal(askConfig({ ASK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "a" }).baseUrl, "https://openrouter.ai/api/v1");
});

/* ---------- SSE and adapters ---------- */

test("sseEvents reassembles events split across chunks and ignores comments", async () => {
  const body = streamOf([": ping\n\nda", 'ta: {"a":1}\n\nevent: x\ndata: two\n', "\ndata: tail"]);
  assert.deepEqual(await collect(sseEvents(body)), [{ event: "", data: '{"a":1}' }, { event: "x", data: "two" }, { event: "", data: "tail" }]);
});

test("OpenAI-style adapter: streams text, joins split tool arguments, reports usage, and sends the key only as a header", async () => {
  const f = fakeFetch(OAI_TOOL_ROUND);
  const p = openaiProvider({ baseUrl: "https://api.example/v1", key: "sk-test", model: "m", fetchFn: f });
  const events = await collect(p.chat([{ role: "system", content: "s" }, { role: "user", content: "q" }], toolDefs().slice(0, 2), { maxTokens: 50 }));
  assert.deepEqual(events.map((e) => e.type), ["text", "usage", "tool_call", "end"]);
  assert.deepEqual(events.find((e) => e.type === "tool_call"), { type: "tool_call", id: "call_1", name: "ticker_dossier", args: { symbol: "NVDA" } });
  assert.deepEqual(events.find((e) => e.type === "usage"), { type: "usage", input: 120, output: 18 });
  assert.equal(events.at(-1).reason, "tool_calls");
  const call = f.calls[0];
  assert.equal(call.url, "https://api.example/v1/chat/completions");
  assert.equal(call.init.headers.authorization, "Bearer sk-test");
  assert.ok(!call.init.body.includes("sk-test"));
  assert.equal(call.body.stream, true);
  assert.equal(call.body.tools[0].type, "function");
  assert.equal(call.body.max_tokens, 50);
});

test("OpenAI-style adapter: a full tool-call round trip carries the tool result back as a tool message", async () => {
  const f = fakeFetch(OAI_TOOL_ROUND, OAI_TEXT_ROUND);
  const p = openaiProvider({ baseUrl: "https://x/v1", key: "k", model: "m", fetchFn: f });
  const messages = [{ role: "user", content: "is NVDA joined?" }];
  const first = await collect(p.chat(messages, toolDefs()));
  const call = first.find((e) => e.type === "tool_call");
  messages.push({ role: "assistant", content: "Looking.", toolCalls: [{ id: call.id, name: call.name, args: call.args }] });
  messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: '{"ref":"t1","ok":true}' });
  const second = await collect(p.chat(messages, toolDefs()));
  assert.equal(second.filter((e) => e.type === "text").map((e) => e.delta).join(""), "NVDA is joined [t1].");
  const sent = f.calls[1].body.messages;
  assert.equal(sent[1].tool_calls[0].function.arguments, '{"symbol":"NVDA"}');
  assert.deepEqual(sent[2], { role: "tool", tool_call_id: "call_1", content: '{"ref":"t1","ok":true}' });
});

test("noTools sets tool_choice none on both adapters so a final round cannot call a tool", async () => {
  const f = fakeFetch(OAI_TEXT_ROUND);
  await collect(openaiProvider({ baseUrl: "https://x/v1", key: "k", model: "m", fetchFn: f }).chat([{ role: "user", content: "q" }], toolDefs(), { noTools: true }));
  assert.equal(f.calls[0].body.tool_choice, "none");
  const g = fakeFetch(sseNamed(["message_stop", { type: "message_stop" }]));
  await collect(anthropicProvider({ baseUrl: "https://a", key: "k", model: "m", fetchFn: g }).chat([{ role: "user", content: "q" }], toolDefs(), { noTools: true }));
  assert.deepEqual(g.calls[0].body.tool_choice, { type: "none" });
});

const ANTHROPIC_TOOL_ROUND = sseNamed(
  ["message_start", { type: "message_start", message: { usage: { input_tokens: 90 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking." } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "member_profile", input: {} } }],
  ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"id":"P00' } }],
  ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '0197"}' } }],
  ["content_block_stop", { type: "content_block_stop", index: 1 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 31 } }],
  ["message_stop", { type: "message_stop" }]
);

test("Anthropic adapter: x-api-key header, system split out, tool_use assembled from JSON fragments", async () => {
  const f = fakeFetch(ANTHROPIC_TOOL_ROUND);
  const p = anthropicProvider({ baseUrl: "https://api.anthropic.com", key: "sk-ant", model: "claude-x", fetchFn: f });
  const events = await collect(p.chat([{ role: "system", content: "rules" }, { role: "user", content: "q" }], toolDefs().slice(0, 3)));
  assert.deepEqual(events.find((e) => e.type === "tool_call"), { type: "tool_call", id: "toolu_1", name: "member_profile", args: { id: "P000197" } });
  assert.deepEqual(events.find((e) => e.type === "usage"), { type: "usage", input: 90, output: 31 });
  assert.equal(events.at(-1).reason, "tool_calls");
  const call = f.calls[0];
  assert.equal(call.url, "https://api.anthropic.com/v1/messages");
  assert.equal(call.init.headers["x-api-key"], "sk-ant");
  assert.equal(call.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(call.body.system, "rules");
  assert.ok(call.body.messages.every((m) => m.role !== "system"));
  assert.equal(call.body.tools[0].input_schema.type, "object");
});

test("Anthropic message conversion: tool calls become tool_use, results one user turn, a later user note joins it", () => {
  const { system, messages } = toAnthropic([
    { role: "system", content: "s" },
    { role: "user", content: "q" },
    { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", args: { n: 1 } }, { id: "b", name: "y", args: {} }] },
    { role: "tool", toolCallId: "a", name: "x", content: "ra" },
    { role: "tool", toolCallId: "b", name: "y", content: "rb" },
    { role: "user", content: "Limit reached." }
  ]);
  assert.equal(system, "s");
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(messages[1].content.map((b) => b.type), ["tool_use", "tool_use"]);
  assert.deepEqual(messages[2].content.map((b) => b.type), ["tool_result", "tool_result", "text"]);
  assert.equal(toOpenAI([{ role: "assistant", content: "t", toolCalls: [{ id: "a", name: "x", args: {} }] }])[0].tool_calls[0].id, "a");
});

test("an HTTP error becomes a ProviderError with the status, and the key is scrubbed from it", async () => {
  const f = fakeFetch(new Response(JSON.stringify({ error: { message: "bad key sk-leak123 rejected", type: "auth" } }), { status: 401 }));
  const p = openaiProvider({ baseUrl: "https://x/v1", key: "sk-leak123", model: "m", fetchFn: f });
  await assert.rejects(collect(p.chat([{ role: "user", content: "q" }], [])), (err) => {
    assert.ok(err instanceof ProviderError);
    assert.equal(err.status, 401);
    assert.ok(!err.message.includes("sk-leak123"));
    assert.match(err.message, /401/);
    return true;
  });
  const down = async () => { throw new Error("connect ECONNREFUSED with sk-leak123"); };
  await assert.rejects(collect(openaiProvider({ baseUrl: "https://x/v1", key: "sk-leak123", model: "m", fetchFn: down }).chat([], [])), (err) => !err.message.includes("sk-leak123") && /could not be reached/.test(err.message));
});

test("createProvider picks the adapter, and the openrouter preset asks for no stream_options", async () => {
  assert.equal(createProvider(askConfig({ ASK_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }), "k").name, "anthropic");
  assert.equal(createProvider(askConfig({ ASK_PROVIDER: "openai", OPENAI_API_KEY: "k" }), "k").name, "openai");
  const f = fakeFetch(OAI_TEXT_ROUND);
  const p = createProvider(askConfig({ ASK_PROVIDER: "compat", ASK_BASE_URL: "https://gw/v1", ASK_API_KEY: "k", ASK_MODEL: "m" }), "k", f);
  await collect(p.chat([{ role: "user", content: "q" }], []));
  assert.equal(f.calls[0].body.stream_options, undefined);
  assert.equal(f.calls[0].body.tools, undefined);
});

/* ---------- tools ---------- */

test("every tool has a valid, closed schema and a unique name", () => {
  assert.deepEqual(TOOLS.flatMap(toolProblems), []);
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
  for (const need of ["search", "member_profile", "ticker_dossier", "case_file", "committee", "hearings", "bill_votes", "contracts", "corporate", "alerts", "intel_scope", "run_backtest"]) assert.ok(TOOLS.some((t) => t.name === need), need);
  const bt = TOOLS.find((t) => t.name === "run_backtest");
  assert.deepEqual(bt.parameters.required, ["spec"]);
  assert.ok(bt.parameters.properties.spec.properties.source.enum.includes("form4"));
});

test("tools are read-only: nothing names an order, a write, or a fetch", () => {
  for (const t of TOOLS) assert.ok(!/\b(order|buy now|sell now|submit|place|delete|write)\b/i.test(t.name), t.name);
});

test("tool argument checks reject bad ids before any route runs", async () => {
  const never = async () => assert.fail("route called");
  for (const [name, args] of [["member_profile", { id: "pelosi" }], ["ticker_dossier", { symbol: "" }], ["case_file", { kind: "planet", id: "x" }], ["bill", { id: "../x" }], ["corporate", { kind: "orders", symbol: "AAPL" }]]) {
    const out = await TOOLS.find((t) => t.name === name).run({}, args, never);
    assert.equal(out.ok, false, name);
  }
});

test("a tool passes cleaned arguments to the route it wraps", async () => {
  const seen = [];
  const call = async (_db, id, params, query) => { seen.push([id, params, query]); return { ok: true, source: "s", asOf: "a", latency: "l" }; };
  await TOOLS.find((t) => t.name === "contracts").run({}, { symbol: "lmt", days: 9999, sort: "largest" }, call);
  assert.deepEqual(seen[0], ["contracts.feed", {}, "symbol=LMT&days=365&sort=largest"]);
  await TOOLS.find((t) => t.name === "member_profile").run({}, { id: "p000197", chamber: "senate" }, call);
  assert.equal(seen.at(-2)[0], "congress.member");
  assert.deepEqual(seen.at(-2)[1], { id: "P000197" });
  assert.equal(seen.at(-1)[0], "congress.memberTrades");
});

test("summarizeBacktest keeps the stats, the warnings, and the feed labels, not 500 trades", () => {
  const out = summarizeBacktest({
    ok: true, description: "d", spec: { source: "congress" }, counts: { used: 3 }, stats: { trades: 3, total: 0.1, benchmarkTotal: 0.08, excessTotal: 0.02 },
    byMember: { rows: Array.from({ length: 9 }, (_, i) => ({ id: i })) }, byTicker: { rows: [] }, trades: Array.from({ length: 500 }, () => ({})), curve: Array.from({ length: 400 }, () => ({})),
    caveats: { items: [{ level: "info", text: "lag" }, { level: "warn", text: "paper" }] }, feeds: [{ label: "Signals", source: "House Clerk", asOf: "x" }], asOf: "t", latency: "l"
  });
  assert.equal(out.topMembers.length, 5);
  assert.equal(out.trades, undefined);
  assert.deepEqual(out.caveatTexts, ["paper", "lag"]);
  assert.equal(out.source, "House Clerk");
  assert.equal(out.stats.excessReturn, 0.02);
});

/* ---------- grounding ---------- */

const EV = (body, tool = "run_backtest", id = "t1") => evidenceOf(id, tool, {}, body);

test("grounding passes numbers the tools returned, in any of the usual spellings", () => {
  const ev = [EV({ ok: true, stats: { totalReturn: 0.2969, trades: 520, drawdown: -0.1765 }, size: 1234567890, note: "median 27 days, up to $1,001 - $15,000" })];
  for (const ok of ["Return +29.7% [t1].", "520 trades", "max drawdown of 17.65%", "about $1.2 billion", "median lag 27 days", "range $15,000", "-17.7% drawdown"]) {
    assert.deepEqual(groundingCheck(ok, ev).unmatched, [], ok);
  }
});

test("grounding flags a number no tool result contains", () => {
  const ev = [EV({ ok: true, stats: { totalReturn: 0.2969, trades: 520 } })];
  const out = groundingCheck("It returned 29.7% over 520 trades, and beat the market by 8.4% with 77 members [t1].", ev);
  assert.deepEqual(out.unmatched, ["8.4%", "77"]);
  assert.equal(out.checked, 4);
});

test("grounding ignores dates, years, citation refs, bill and district codes, and one-digit counts", () => {
  const ev = [EV({ ok: true, n: 5 })];
  assert.deepEqual(groundingCheck("On 2025-01-15 (Oct 9, 2026) HR 5334 in TX-12 [t1] by P000197 in 2025, 3 of them.", ev).unmatched, []);
});

test("grounding does not count numbers from a failed tool result", () => {
  const ev = [EV({ ok: false, error: "no", n: 999 })];
  assert.deepEqual(groundingCheck("There were 999 trades.", ev).unmatched, ["999"]);
});

test("numbersIn reads percent, bps, scale words, signs, and thousands separators", () => {
  const n = numbersIn("up 12.5%, 40 bps, $3.2M, −2.2%, 1,234, 7 members");
  assert.deepEqual(n.map((x) => [x.value, x.pct, x.bps, x.scale]), [[12.5, true, false, 1], [40, false, true, 1], [3.2, false, false, 1e6], [2.2, true, false, 1], [1234, false, false, 1], [7, false, false, 1]]);
});

test("citationRefs separates refs that match a tool result from ones the model made up", () => {
  const ev = [EV({}, "x", "t1"), EV({}, "y", "t2")];
  assert.deepEqual(citationRefs("A [t1]. B [t2, t9]. C [t1] [t7]", ev), { cited: ["t1", "t2"], unknown: ["t9", "t7"] });
});

test("openAction maps a tool call to a board the app already has", () => {
  assert.equal(openAction("member_profile", { id: "p000197" }), "member:P000197");
  assert.equal(openAction("member_timeline", { id: "P000197" }), "timeline:P000197");
  assert.equal(openAction("ticker_dossier", { symbol: "nvda" }), "ticker:NVDA");
  assert.equal(openAction("case_file", { kind: "district", id: "tx-12" }), "district:TX-12");
  assert.equal(openAction("contracts", { symbol: "LMT" }), "contracts:symbol:LMT");
  assert.match(openAction("run_backtest", {}, { spec: { source: "congress", filters: { committee: "Armed Services" }, rules: {} } }), /^bt:token:[\w-]+$/);
  assert.equal(openAction("news", {}), "section:news");
  assert.equal(openAction("satellite", {}), "section:strait");
  assert.equal(openAction("web_search", { q: "nvda" }), "");
});

test("caveats always say research only, and add the filing-lag note when trades were read", () => {
  assert.deepEqual(caveatsFor([]).length, 1);
  const c = caveatsFor([EV({ ok: true, caveatTexts: ["117 paper filings are not parsed."] }), EV({ ok: true }, "member_trades", "t2")]);
  assert.ok(c.some((x) => /filing/.test(x)));
  assert.ok(c.includes("117 paper filings are not parsed."));
  assert.match(c.at(-1), /Not investment advice/);
});

test("trimForModel cuts long lists with their true total and keeps source, asOf, latency", () => {
  const out = trimForModel({ ok: true, source: "S", asOf: "A", latency: "L", items: Array.from({ length: 50 }, (_, i) => ({ i })) });
  assert.equal(out.items.total, 50);
  assert.equal(out.items.items.length, ASK_LIMITS.resultItems);
  const huge = trimForModel({ ok: true, source: "S", asOf: "A", rows: Array.from({ length: 10 }, () => ({ t: "x".repeat(300) })).concat() , a: "y".repeat(100), items: Array.from({ length: 9 }, () => ({ t: "z".repeat(300), u: "w".repeat(300), v: "q".repeat(300), k: "k".repeat(300) })) }, { ...ASK_LIMITS, resultChars: 500 });
  assert.equal(huge.source, "S");
  assert.match(huge.note, /Trimmed/);
});

/* ---------- limiter, input ---------- */

test("the limiter allows max per window per key, then says when to retry, and forgets old hits", () => {
  const l = makeLimiter({ max: 2, windowMs: 1000 });
  assert.equal(l.take("a", 0).ok, true);
  assert.equal(l.take("a", 10).ok, true);
  const third = l.take("a", 20);
  assert.equal(third.ok, false);
  assert.equal(third.retryMs, 980);
  assert.equal(l.take("b", 20).ok, true);
  assert.equal(l.take("a", 1001).ok, true);
});

test("cleanAsk needs a question, trims it, and keeps six clean turns", () => {
  assert.equal(cleanAsk({}).ok, false);
  assert.equal(cleanAsk(null).ok, false);
  const out = cleanAsk({ question: "  Who   bought   NVDA?  ", history: [{ role: "system", content: "x" }, ...Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` }))] });
  assert.equal(out.question, "Who bought NVDA?");
  assert.equal(out.history.length, 6);
  assert.equal(out.history.at(-1).content, "t8");
  assert.equal(cleanAsk({ question: "x".repeat(5000) }).question.length, ASK_LIMITS.question);
});

/* ---------- the loop ---------- */

const kinds = (events) => events.filter((e) => e.type !== "step_progress").map((e) => e.type);

function scripted(...rounds) {
  const seen = [];
  return {
    seen,
    name: "fake",
    model: "fake",
    async *chat(messages, tools, opts) {
      seen.push({ messages: messages.map((m) => ({ ...m })), tools: tools.length, opts });
      const round = rounds.shift() || [{ type: "text", delta: "done" }, { type: "end", reason: "stop" }];
      for (const e of round) yield e;
    }
  };
}
const TOOL_ROUND = (name, args, id = "c1") => [{ type: "tool_call", id, name, args }, { type: "end", reason: "tool_calls" }];
const TEXT_ROUND = (t) => [{ type: "text", delta: t }, { type: "usage", input: 100, output: 20 }, { type: "end", reason: "stop" }];

async function ask(provider, { execute, limits, question = "q" } = {}) {
  const events = [];
  await runAsk({
    question,
    provider,
    tools: toolDefs(),
    execute: execute || (async (name) => ({ ok: true, source: `src ${name}`, asOf: "2026-10-09", latency: "1 ms", n: 520, pct: 0.2969 })),
    labelOf: (n) => n,
    emit: (e) => events.push(e),
    limits: limits || ASK_LIMITS,
    today: "2026-10-09"
  });
  return events;
}

test("a question that needs a tool: stream, call, evidence, final answer with its citations", async () => {
  const p = scripted(TOOL_ROUND("ticker_dossier", { symbol: "NVDA" }), TEXT_ROUND("It ran 520 trades for +29.7% [t1]."));
  const events = await ask(p);
  assert.deepEqual(kinds(events), ["step_start", "step_end", "token", "citation", "done"]);
  const ev = events.find((e) => e.type === "step_end");
  assert.deepEqual([ev.id, ev.tool, ev.ok, ev.source, ev.open], ["t1", "ticker_dossier", true, "src ticker_dossier", "ticker:NVDA"]);
  assert.equal(ev.json, undefined);
  const done = events.at(-1);
  assert.deepEqual(done.cited, ["t1"]);
  assert.deepEqual(done.grounding.unmatched, []);
  assert.equal(done.usage.toolCalls, 1);
  const second = p.seen[1].messages;
  assert.equal(second.at(-1).role, "tool");
  assert.match(second.at(-1).content, /"ref":"t1"/);
  assert.equal(second.at(-2).toolCalls[0].name, "ticker_dossier");
  assert.match(p.seen[0].messages[0].content, /Today is 2026-10-09/);
});

test("an answer with an invented number is delivered with the number flagged", async () => {
  const events = await ask(scripted(TOOL_ROUND("alerts", {}), TEXT_ROUND("There were 520 filings and 61 late ones [t1].")));
  const done = events.at(-1);
  assert.deepEqual(done.grounding.unmatched, ["61"]);
  assert.equal(done.noTools, false);
});

test("an answer from no tool at all says so, and a made-up ref is reported", async () => {
  const none = (await ask(scripted(TEXT_ROUND("Probably higher."))))[0];
  assert.equal(none.type, "step_progress");
  const done = (await ask(scripted(TEXT_ROUND("Probably higher."))))
    .at(-1);
  assert.equal(done.noTools, true);
  const fake = (await ask(scripted(TOOL_ROUND("alerts", {}), TEXT_ROUND("Yes [t5].")))).at(-1);
  assert.deepEqual(fake.unknown, ["t5"]);
  assert.equal(fake.uncited, true);
});

test("the tool-call cap refuses extra calls, then forces a last answer round with no tools", async () => {
  const limits = { ...ASK_LIMITS, toolCalls: 2 };
  const many = [{ type: "tool_call", id: "a", name: "alerts", args: {} }, { type: "tool_call", id: "b", name: "alerts", args: {} }, { type: "tool_call", id: "c", name: "alerts", args: {} }, { type: "end", reason: "tool_calls" }];
  const p = scripted(many, TEXT_ROUND("Partial answer [t1]."));
  const events = await ask(p, { limits });
  assert.equal(events.filter((e) => e.type === "step_end").length, 2);
  const done = events.at(-1);
  assert.equal(done.stopped, "tool-call limit");
  const toolMsgs = p.seen[1].messages.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 3);
  assert.match(toolMsgs[2].content, /limit reached/i);
  assert.equal(p.seen[1].opts.noTools, true);
  assert.match(p.seen[1].messages.at(-1).content, /Limit reached/);
});

test("the token budget stops the loop the same way", async () => {
  const limits = { ...ASK_LIMITS, tokenBudget: 100 };
  const p = scripted([{ type: "tool_call", id: "a", name: "alerts", args: {} }, { type: "usage", input: 90, output: 30 }, { type: "end", reason: "tool_calls" }], TEXT_ROUND("Short [t1]."));
  const done = (await ask(p, { limits })).at(-1);
  assert.equal(done.stopped, "token budget");
});

test("an unknown tool or arguments that are not JSON come back to the model as errors, not crashes", async () => {
  const p = scripted([{ type: "tool_call", id: "a", name: "place_order", args: {} }, { type: "tool_call", id: "b", name: "alerts", args: null }, { type: "end", reason: "tool_calls" }], TEXT_ROUND("I could not."));
  const events = await ask(p);
  assert.equal(events.filter((e) => e.type === "step_end").length, 0);
  const results = p.seen[1].messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
  assert.match(results[0].error, /No such tool/);
  assert.match(results[1].error, /not valid JSON/);
});

test("a provider failure becomes an error event, with no done", async () => {
  const boom = { name: "x", model: "x", async *chat() { throw new ProviderError("Anthropic returned 529: overloaded.", 529); } };
  const events = await ask(boom);
  assert.deepEqual(kinds(events), ["error"]);
  assert.equal(events[1].code, "provider");
  assert.match(events[1].error, /529/);
});

test("an empty final answer is replaced with a plain note", async () => {
  const done = (await ask(scripted(TEXT_ROUND("   ")))).at(-1);
  assert.match(done.answer, /ran out of room/);
});

/* ---------- the route ---------- */

function fakeReq(body, { method = "POST", ip = "9.9.9.9" } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = {};
  req.socket = { remoteAddress: ip };
  return req;
}
function fakeRes() {
  const res = { chunks: [], head: null, ended: false, writableEnded: false, destroyed: false, handlers: {} };
  res.writeHead = (status, headers) => { res.head = { status, headers }; };
  res.write = (c) => { res.chunks.push(c); return true; };
  res.end = () => { res.ended = true; res.writableEnded = true; };
  res.on = (ev, fn) => { res.handlers[ev] = fn; };
  res.events = () => res.chunks.join("").split("\n\n").filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, "")));
  return res;
}
const CONFIGURED = { ASK_PROVIDER: "compat", ASK_BASE_URL: "https://gw/v1", ASK_API_KEY: "sk-route", ASK_MODEL: "m" };
const noLog = () => {};

test("GET /api/ask reports whether Ask is configured, never the key", () => {
  const off = askStatus({});
  assert.deepEqual([off.ok, off.configured, off.notice], [true, false, NOT_CONFIGURED]);
  const on = askStatus(CONFIGURED);
  assert.deepEqual([on.configured, on.provider, on.model], [true, "compat", "m"]);
  assert.ok(!JSON.stringify(on).includes("sk-route"));
  assert.ok(on.tools.includes("run_backtest"));
});

test("POST when not configured is a 503 with the not-configured sentence, and no model is built", async () => {
  const handler = makeAskHandler({ env: {}, makeProvider: () => assert.fail("provider built"), log: noLog });
  const out = await handler({ req: fakeReq({ question: "hi" }), res: fakeRes(), db: {} });
  assert.equal(out.status, 503);
  assert.equal(out.body.error, NOT_CONFIGURED);
  assert.equal(out.body.notConfigured, true);
  assert.equal(out.body.missing, "ASK_PROVIDER");
});

test("POST streams SSE events from the loop, through the real tool list with an injected executor", async () => {
  const provider = scripted(TOOL_ROUND("ticker_dossier", { symbol: "NVDA" }), TEXT_ROUND("NVDA has 520 rows [t1]."));
  const handler = makeAskHandler({ env: CONFIGURED, makeProvider: () => provider, execute: async () => ({ ok: true, source: "S", asOf: "A", latency: "L", n: 520 }), log: noLog });
  const res = fakeRes();
  const out = await handler({ req: fakeReq({ question: "NVDA?" }), res, db: {} });
  assert.equal(out, undefined);
  assert.equal(res.head.status, 200);
  assert.match(res.head.headers["Content-Type"], /text\/event-stream/);
  assert.equal(res.ended, true);
  assert.deepEqual(kinds(res.events()), ["step_start", "step_end", "token", "citation", "done"]);
});

test("POST validates the body, and rate-limits per client", async () => {
  const limiter = makeLimiter({ max: 2, windowMs: 60_000 });
  const handler = makeAskHandler({ env: CONFIGURED, makeProvider: () => scripted(TEXT_ROUND("ok")), limiter, log: noLog, now: () => 1000 });
  assert.equal((await handler({ req: fakeReq({}), res: fakeRes(), db: {} })).status, 400);
  assert.equal(await handler({ req: fakeReq({ question: "one" }), res: fakeRes(), db: {} }), undefined);
  assert.equal(await handler({ req: fakeReq({ question: "two" }), res: fakeRes(), db: {} }), undefined);
  const third = await handler({ req: fakeReq({ question: "three" }), res: fakeRes(), db: {} });
  assert.equal(third.status, 429);
  assert.match(third.body.error, /limited to/);
  assert.equal(await handler({ req: fakeReq({ question: "other ip" }, { ip: "1.1.1.1" }), res: fakeRes(), db: {} }), undefined);
});

test("replies that never reach the model (greeting, saved preference) do not use up the rate limit", async () => {
  const limiter = makeLimiter({ max: 1, windowMs: 60_000 });
  const handler = makeAskHandler({ env: CONFIGURED, makeProvider: () => scripted(TEXT_ROUND("ok")), limiter, log: noLog, now: () => 1000 });
  assert.equal(await handler({ req: fakeReq({ question: "hi" }), res: fakeRes(), db: {} }), undefined);
  assert.equal(await handler({ req: fakeReq({ question: "I usually want 90-day holds vs SPY" }), res: fakeRes(), db: {} }), undefined);
  assert.equal(await handler({ req: fakeReq({ question: "What changed?" }), res: fakeRes(), db: {} }), undefined);
  assert.equal((await handler({ req: fakeReq({ question: "And now?" }), res: fakeRes(), db: {} })).status, 429);
});

test("the route never puts the key in a log line or an event", async () => {
  const lines = [];
  const provider = { name: "x", model: "x", async *chat() { throw new ProviderError("The model endpoint returned 401: nope.", 401); } };
  const handler = makeAskHandler({ env: CONFIGURED, makeProvider: () => provider, log: (e) => lines.push(JSON.stringify(e)) });
  const res = fakeRes();
  await handler({ req: fakeReq({ question: "What changed this week?" }), res, db: {} });
  assert.ok(![...lines, ...res.chunks].join("").includes("sk-route"));
  assert.equal(res.events().at(-1).type, "error");
});

test("a result with several lists keeps fewer rows each instead of dropping them", async () => {
  const { trimForModel } = await import("../shared/ask.mjs");
  const row = (i) => ({ person: `Member ${i}`, link: "https://example.com/".padEnd(240, "x"), excess: i / 100, best: { symbol: "NVDA", excess: 0.5 } });
  const big = { ok: true, source: "House Clerk", asOf: "2026-10-09", latency: "12 h", top: Array.from({ length: 25 }, (_, i) => row(i)), bottom: Array.from({ length: 25 }, (_, i) => row(i)), active: Array.from({ length: 25 }, (_, i) => row(i)), late: Array.from({ length: 25 }, (_, i) => row(i)) };
  const out = trimForModel(big);
  assert.ok(JSON.stringify(out).length <= 9_000);
  assert.ok(out.top.items.length >= 3 && out.top.total === 25);
  assert.equal(out.top.items[0].excess, 0);
  assert.equal(out.source, "House Clerk");
  assert.match(out.note, /rows each/);
});
