import test from "node:test";
import assert from "node:assert/strict";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";
import { savedStudyAuditArgs } from "../server/ai/studyAuditPlanning.mjs";
import { researchRouting } from "../server/ai/researchRouting.mjs";
import { researchToolRefusal } from "../shared/researchCompatibility.mjs";

const question =
  "Compare my saved LMT and HII procurement studies. Show interactive graphs of recorded returns and benchmark returns.";
const backtest = {
  type: "tool_call",
  id: "fresh-backtest",
  name: "run_backtest",
  args: { spec: { source: "contracts" } },
};
const search = { type: "tool_call", id: "fresh-search", name: "search_signals", args: { sources: ["contracts"] } };
async function ask(question, requested, extra = {}) {
  const calls = [],
    events = [],
    seen = [];
  let round = 0;
  const provider = {
    async *chat(messages) {
      seen.push(structuredClone(messages));
      if (++round === 1) {
        for (const item of requested) yield item;
      } else yield { type: "text", delta: "Inspect the saved evidence; no new claim is established." };
    },
  };
  await runAsk({
    question,
    provider,
    tools: toolDefs(),
    acceptDefaults: true,
    today: "2026-10-22",
    execute: async (name, args) => {
      calls.push({ name, args });
      return name === "research_audit_saved_studies"
        ? { ok: true, source: "Saved test evidence", studies: [], comparison: { fields: {} } }
        : { ok: true, source: "Synthetic test execution", spec: args.spec, counts: { signals: 0 }, stats: null };
    },
    emit: (event) => events.push(event),
    ...extra,
  });
  return { calls, events, seen, done: events.findLast((event) => event.type === "done") };
}

test("saved review with returns/graph vocabulary refuses both fresh computations at dispatch", async () => {
  assert.deepEqual(savedStudyAuditArgs(question), { studyNames: ["LMT", "HII"] });
  assert.equal(
    researchRouting(question).intent.route,
    "conversation",
    "pure saved inspection stays conversational despite incidental return vocabulary",
  );
  const result = await ask(question, [backtest, search], {
    priors: [{ source: "congress", filters: {}, rules: {} }],
    prior: { source: "congress", filters: {}, rules: {} },
  });
  assert.deepEqual(
    result.calls.map((call) => call.name),
    ["research_audit_saved_studies"],
  );
  assert.deepEqual(result.done.backtests, []);
  assert.match(JSON.stringify(result.seen), /inspection of saved evidence, not a fresh calculation/);
  assert.equal(
    result.events.filter((event) => event.type === "plan_note" && /Incompatible calculation blocked/.test(event.note))
      .length,
    2,
  );
});

test("explicitly inspect saved legislative or regulatory results without launching a design assessment", async () => {
  const result = await ask("Inspect my saved legislative studies and explain their recorded returns.", [backtest]);
  assert.equal(result.calls[0]?.name, "research_audit_saved_studies");
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.done.backtests, []);
  assert.equal(result.done.research, undefined);
});

test("an explicit rerun retains execution precedence and is not turned into inspection", async () => {
  const freshQuestion = "Compare my saved procurement studies and rerun the contracts backtest.";
  assert.equal(savedStudyAuditArgs(freshQuestion), null);
  const result = await ask(freshQuestion, [backtest]);
  assert.ok(result.calls.some((call) => call.name === "run_backtest"));
  assert.ok(!result.calls.some((call) => call.name === "research_audit_saved_studies"));
  assert.equal(result.done.backtests.length, 1);
});

test("inspection-only dispatch guard overrides compatible source vocabulary without restricting evidence tools", () => {
  const intent = { ...researchRouting(question).intent, inspectionOnly: true };
  assert.match(researchToolRefusal(intent, "run_backtest", backtest.args), /inspection of saved evidence/);
  assert.match(researchToolRefusal(intent, "search_signals", search.args), /inspection of saved evidence/);
  assert.equal(researchToolRefusal(intent, "research_audit_saved_studies", {}), "");
});
test("negated fresh executions keep saved inspection and block composed study creation/execution at dispatch", async () => {
  const requested = [
    { type: "tool_call", id: "create", name: "research_create_investigation", args: { title: "Replacement" } },
    {
      type: "tool_call",
      id: "execute",
      name: "research_run_investigation",
      args: { investigationId: "inv_replacement" },
    },
    backtest,
  ];
  for (const text of [
    "Review my saved LMT studies, but do not run a new analysis.",
    "Inspect my saved LMT studies; do not execute a new backtest.",
    "Review my saved LMT studies; never perform a new study.",
  ]) {
    const result = await ask(text, requested);
    assert.deepEqual(
      result.calls.map((call) => call.name),
      ["research_audit_saved_studies"],
      text,
    );
    assert.deepEqual(result.calls[0].args, { studyNames: ["LMT"] });
    assert.deepEqual(result.done.backtests, []);
    assert.equal(
      result.events.filter((event) => event.type === "plan_note" && /Incompatible calculation blocked/.test(event.note))
        .length,
      requested.length,
    );
  }
});
