import test from "node:test";
import assert from "node:assert/strict";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs, runTool } from "../server/ai/tools.mjs";
import { confidenceLine } from "../shared/confidence.mjs";
import { answerIdentity } from "../shared/answerCache.mjs";
import { POLICY_QUESTION } from "./fixtures/policyQuestion.mjs";
import { INVESTIGATION_TOOL_NAMES } from "../shared/investigationAccess.mjs";

function scripted(...rounds) {
  const seen = [];
  return {
    seen,
    async *chat(messages) {
      seen.push(structuredClone(messages));
      for (const item of rounds.shift() || [{ type: "text", delta: "No calculation executed." }]) yield item;
    },
  };
}
const call = (source, id = "call") => ({ type: "tool_call", id, name: "run_backtest", args: { spec: { source } } });
const text = (delta) => [{ type: "text", delta }];
async function run(question, extra = {}) {
  const events = [],
    calls = [];
  const provider = extra.provider || scripted();
  await runAsk({
    question,
    provider,
    // These regressions cover the conservative fallback used without a general study toolchain.
    // The enabled path and actual saved computations are covered in investigationAsk.test.mjs.
    tools: toolDefs().filter((tool) => !INVESTIGATION_TOOL_NAMES.has(tool.name)),
    acceptDefaults: true,
    researchEnv: {},
    execute: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, spec: args.spec, source: "Synthetic test fixture", stats: { trades: 12, totalReturn: 0.02 } };
    },
    emit: (event) => events.push(event),
    today: "2026-10-20",
    ...extra,
  });
  return { events, calls, provider, done: events.findLast((e) => e.type === "done") };
}

test("without study tools the failed policy task retains its truthful assessment before models or computations", async () => {
  const result = await run(POLICY_QUESTION, {
    prior: { source: "congress", filters: {}, rules: {} },
    priors: [{ source: "congress" }, { source: "contracts" }],
    prefs: { v: 1, values: { "rules.holdDays": 90 } },
  });
  assert.equal(result.calls.length, 0);
  assert.equal(result.provider.seen.length, 0);
  assert.equal(result.done.research.executed, false);
  assert.equal(result.done.research.status, "unsupported-design");
  assert.deepEqual(result.done.backtests, []);
  assert.equal(result.done.usage.tokens, 0);
  assert.equal(result.done.retried, false);
  assert.ok(!result.events.some((e) => e.type === "clarify" || e.type === "step_start"));
  assert.match(confidenceLine({ done: result.done }).text, /no study executed/);
  assert.doesNotMatch(confidenceLine({ done: result.done }).text, /figures matched|model/);
});

test("unresolved strategy requests ask for a signal rather than assigning Congress", async () => {
  const result = await run("Backtest this idea");
  assert.equal(result.done.research.status, "needs-clarification");
  assert.match(result.done.answer, /No default source has been selected/i);
  assert.equal(result.calls.length, 0);
});

test("a valid explicit replay remains executable", async () => {
  const provider = scripted([call("form4")], text("12 trades returned 2.00% [t1]."));
  const result = await run("Backtest insider buys vs SPY", { provider });
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].args.spec.source, "form4");
  assert.equal(result.done.backtests.length, 1);
});

test("model source substitution is blocked at dispatch and never reaches the executor", async () => {
  const provider = scripted([call("congress")], [call("form4", "corrected")], text("12 trades returned 2.00% [t1]."));
  const result = await run("Backtest insider buys vs SPY", { provider });
  assert.deepEqual(
    result.calls.map((c) => c.args.spec.source),
    ["form4"],
  );
  assert.ok(result.events.some((e) => e.type === "plan_note" && /Incompatible calculation blocked/.test(e.note)));
  assert.match(JSON.stringify(provider.seen), /outside the resolved research task/);
});

test("a factual bill question can use evidence tools but cannot turn into a portfolio", async () => {
  const provider = scripted([call("congress")], text("A bill lookup is needed; no portfolio was calculated."));
  const result = await run("What changed in the committee bill text?", { provider });
  assert.equal(result.calls.length, 0);
  assert.equal(result.done.backtests.length, 0);
  assert.match(JSON.stringify(provider.seen), /policy relationship/);
});

test("a historical policy follow-up does not revive the previous portfolio source", async () => {
  const result = await run("Now try one month", {
    prior: { source: "congress" },
    history: [
      { role: "user", content: POLICY_QUESTION },
      { role: "assistant", content: "Research capability assessment." },
    ],
  });
  assert.equal(result.done.research.intent.contextQuestion, POLICY_QUESTION);
  assert.equal(result.calls.length, 0);
});

test("capability tool is read-only, typed and explicit about unaudited source history", async () => {
  const result = await runTool(null, "assess_research_capabilities", { question: POLICY_QUESTION });
  assert.equal(result.ok, true);
  assert.equal(result.assessment.executed, false);
  assert.match(result.latency, /not audited/);
  assert.equal((await runTool(null, "assess_research_capabilities", { question: "" })).ok, false);
});

test("new routing invalidates old answer identities without destroying saved conversations", () => {
  const identity = JSON.parse(answerIdentity({ question: POLICY_QUESTION }));
  assert.equal(identity.v, 8);
  assert.equal(typeof identity.q, "string");
});
