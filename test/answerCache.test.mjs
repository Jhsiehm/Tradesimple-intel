import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { answerIdentity, dataText, noReuseReason, normalizeQuestion, replayEvents, reusedLabel } from "../shared/answerCache.mjs";
import { cacheTtlMs } from "../server/ai/answerCache.mjs";
import { makeAskHandler } from "../server/routes/ask.mjs";
import { makeLimiter } from "../shared/ask.mjs";

const T0 = Date.parse("2026-10-09T14:31:00Z");
const ENV = { ASK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-test", ASK_MONTHLY_BUDGET_USD: "0" };

function fakeReq(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = "POST";
  req.headers = {};
  req.socket = { remoteAddress: "9.9.9.9" };
  return req;
}
function fakeRes() {
  const res = { chunks: [], writableEnded: false, destroyed: false, on() {} };
  res.writeHead = () => {};
  res.write = (c) => { res.chunks.push(c); return true; };
  res.end = () => { res.writableEnded = true; };
  res.events = () => res.chunks.join("").split("\n\n").filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, "")));
  return res;
}

/** A model that calls congress_leaders once, then answers with a slot. Counts its calls. */
function makeModel(counter) {
  return (cfg) => {
    let round = 0;
    return {
      name: "openrouter",
      model: cfg.model,
      async *chat() {
        counter.calls += 1;
        if (round++ === 0) {
          yield { type: "tool_call", id: "c1", name: "congress_leaders", args: { days: 30 } };
          yield { type: "end", reason: "tool_calls" };
          return;
        }
        yield { type: "text", delta: "Buys beat SPY by {{t1.stats.excess|spct}} over {{t1.stats.n}} trades [t1]." };
        yield { type: "usage", input: 500, output: 40, cost: 0.004 };
        yield { type: "end", reason: "stop" };
      }
    };
  };
}

function setup() {
  const db = new DatabaseSync(":memory:");
  const counter = { calls: 0 };
  const data = { value: { ok: true, source: "House Clerk", asOf: "2026-10-09", latency: "45 days", stats: { excess: 0.0412, n: 52 }, ms: 1 } };
  const tools = { runs: 0 };
  let clock = T0;
  const handler = makeAskHandler({
    env: ENV,
    makeProvider: makeModel(counter),
    execute: async () => { tools.runs += 1; return { ...structuredClone(data.value), ms: tools.runs * 7 }; },
    now: () => clock,
    limiter: makeLimiter({ max: 99, windowMs: 1000 }),
    log: () => {}
  });
  const ask = async (body) => {
    const res = fakeRes();
    await handler({ req: fakeReq(body), res, db });
    return res.events();
  };
  return { ask, counter, data, tools, tick: (ms) => { clock += ms; } };
}

test("questions normalize; the identity covers chat, attachments and a pinned model, not wording noise", () => {
  assert.equal(normalizeQuestion("  Who   beat SPY?? "), "who beat spy");
  const base = { question: "Who beat SPY?", history: [], context: null, attached: null };
  assert.equal(answerIdentity(base), answerIdentity({ ...base, question: "who beat  spy" }));
  assert.notEqual(answerIdentity(base), answerIdentity({ ...base, context: { node: "ticker:NVDA" } }));
  assert.notEqual(answerIdentity(base), answerIdentity({ ...base, history: [{ role: "user", content: "x" }] }));
  assert.equal(answerIdentity(base, { model: "a", pinned: false }), answerIdentity(base, { model: "b", pinned: false }));
  assert.notEqual(answerIdentity(base, { model: "a", pinned: true }), answerIdentity(base, { model: "b", pinned: true }));
  assert.notEqual(answerIdentity(base, { model: "a", pinned: true }), answerIdentity(base));
});

test("the data fingerprint ignores timings and request traces, not values or as-of times", () => {
  assert.equal(dataText({ a: 1, ms: 5, latency: "x", requests: ["/a"] }), dataText({ ms: 9, a: 1 }));
  assert.notEqual(dataText({ a: 1, asOf: "2026-10-08" }), dataText({ a: 1, asOf: "2026-10-09" }));
  assert.notEqual(dataText({ a: 1 }), dataText({ a: 2 }));
});

test("what is never stored: errors, clarify chips, quick replies, web answers, early stops", () => {
  const done = (x = {}) => ({ type: "done", usage: { tokens: 10 }, ...x });
  assert.equal(noReuseReason([done()], [{ tool: "congress_leaders" }]), "");
  assert.equal(noReuseReason([done(), { type: "error" }], [{ tool: "a" }]), "error");
  assert.equal(noReuseReason([done({ clarify: true })], [{ tool: "a" }]), "not a model answer");
  assert.equal(noReuseReason([done({ usage: { tokens: 0 } })], [{ tool: "a" }]), "no model call");
  assert.equal(noReuseReason([done({ stopped: "time limit" })], [{ tool: "a" }]), "stopped early");
  assert.equal(noReuseReason([done()], [{ tool: "web_search" }]), "web or theory tools");
  assert.equal(noReuseReason([done()], []), "no tool data");
});

test("replay keeps steps and citations, sends the answer in one token, marks done.reused", () => {
  const out = replayEvents([
    { type: "step_progress", phase: "fetching" },
    { type: "step_start", id: "t1" },
    { type: "step_end", id: "t1" },
    { type: "token", delta: "A " },
    { type: "token", delta: "B" },
    { type: "citation", id: "t1" },
    { type: "done", answer: "A B" }
  ], { at: T0, model: "m" });
  assert.deepEqual(out.map((e) => e.type), ["step_start", "step_end", "citation", "token", "done"]);
  assert.equal(out[3].delta, "A B");
  assert.deepEqual(out[4].reused, { at: T0, model: "m" });
  assert.equal(reusedLabel(T0), "Reused answer from 10:31 ET — data unchanged");
});

test("TTL: 15 minutes by default, configurable, 0 turns reuse off", () => {
  assert.equal(cacheTtlMs({}), 15 * 60_000);
  assert.equal(cacheTtlMs({ ASK_ANSWER_CACHE_MIN: "5" }), 5 * 60_000);
  assert.equal(cacheTtlMs({ ASK_ANSWER_CACHE_MIN: "0" }), 0);
});

test("route: the same question with unchanged data is reused without a model call; Re-ask (fresh) runs it again", async () => {
  const { ask, counter, tools, tick } = setup();
  const first = await ask({ question: "Did members beat SPY in the last 30 days?" });
  const done1 = first.find((e) => e.type === "done");
  assert.match(done1.answer, /beat SPY by \+4\.1% over 52 trades \[t1\]/);
  assert.equal(done1.reused, undefined);
  assert.equal(counter.calls, 2);

  tick(4 * 60_000);
  const again = await ask({ question: "did members beat SPY in the last 30 days" });
  const done2 = again.find((e) => e.type === "done");
  assert.equal(counter.calls, 2, "no model call for a reused answer");
  assert.equal(tools.runs, 2, "the recorded tool call ran again to compare the data");
  assert.deepEqual(done2.reused, { at: Date.parse("2026-10-09T14:31:00Z"), model: "anthropic/claude-sonnet-4.6" });
  assert.equal(done2.answer, done1.answer);
  assert.ok(again.some((e) => e.type === "step_end" && e.id === "t1"), "steps replay so the citation chips still open");
  assert.equal(again.find((e) => e.type === "token").delta, done1.answer);

  const fresh = await ask({ question: "Did members beat SPY in the last 30 days?", fresh: true });
  assert.equal(counter.calls, 4);
  assert.equal(fresh.find((e) => e.type === "done").reused, undefined);
});

test("route: changed data, an expired entry, or a different chat is never reused", async () => {
  const { ask, counter, data, tick } = setup();
  await ask({ question: "Did members beat SPY?" });
  data.value.stats.excess = 0.05;
  const changed = await ask({ question: "Did members beat SPY?" });
  assert.equal(counter.calls, 4, "the data changed, so the model answered again");
  assert.match(changed.find((e) => e.type === "done").answer, /\+5\.0%/);

  tick(16 * 60_000);
  await ask({ question: "Did members beat SPY?" });
  assert.equal(counter.calls, 6, "past the 15-minute TTL");

  await ask({ question: "Did members beat SPY?", history: [{ role: "user", content: "earlier" }, { role: "assistant", content: "ok" }] });
  assert.equal(counter.calls, 8, "a different chat is a different question");
});

test("route: an answer from one pinned model is never reused for another pinned model or for Auto", async () => {
  const { ask, counter } = setup();
  await ask({ question: "Did members beat SPY?", model: "openai/gpt-4o-mini" });
  assert.equal(counter.calls, 2);
  await ask({ question: "Did members beat SPY?", model: "openai/gpt-4o-mini" });
  assert.equal(counter.calls, 2, "same pinned model: reused");
  await ask({ question: "Did members beat SPY?", model: "anthropic/claude-sonnet-4.6" });
  assert.equal(counter.calls, 4, "another pinned model: answered again");
  await ask({ question: "Did members beat SPY?", model: "auto" });
  assert.equal(counter.calls, 6, "Auto: answered again");
});
