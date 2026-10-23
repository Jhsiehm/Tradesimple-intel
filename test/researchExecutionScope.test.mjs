import test from "node:test";
import assert from "node:assert/strict";
import { designOnlyRequested, researchExecutionRefusal } from "../shared/researchExecutionScope.mjs";
import { interpretResearch } from "../shared/researchIntent.mjs";
import { researchToolRefusal } from "../shared/researchCompatibility.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";

const executionNames = ["run_backtest", "search_signals", "research_run_investigation"];

test("explicit design-only instructions preserve hypothesis family without authorizing legacy replay", () => {
  for (const question of [
    "Design only; do not execute calculations. Plan an insider stock-buy backtest.",
    "Design a procurement strategy. Plan only; inspect available data.",
    "Draft a protocol for congressional stock trades; don't execute any calculations.",
    "Please provide a research design only for an insider stock-buy backtest.",
    "Please design only an insider stock-buy backtest.",
  ]) {
    assert.equal(designOnlyRequested(question), true, question);
    const intent = interpretResearch(question);
    assert.equal(intent.designOnly, true, question);
    assert.notEqual(intent.route, "legacy", question);
    for (const name of executionNames) assert.match(researchToolRefusal(intent, name, {}), /design only/);
    assert.equal(researchToolRefusal(intent, "research_sources", {}), "");
    assert.equal(researchToolRefusal(intent, "research_create_investigation", {}), "");
  }
  const policy = interpretResearch("Design only; can legislative actions predict stock returns before news?");
  assert.equal(policy.family, "predictive");
  assert.ok(policy.domains.includes("legislation"));
  assert.equal(policy.route, "assessment", "a design-only flag must not downgrade unsupported policy research");
});

test("inspection-only includes composed execution and new-study creation, while evidence tools remain available", () => {
  const intent = { inspectionOnly: true };
  for (const name of [...executionNames, "research_create_investigation"])
    assert.match(researchExecutionRefusal(intent, name), /inspection of saved evidence/);
  for (const name of ["research_sources", "research_inspect_investigation", "research_audit_saved_studies"])
    assert.equal(researchExecutionRefusal(intent, name), "");
});

test("a later explicit execution request does not inherit an earlier planning-only limit", () => {
  const previous = "Design only; do not execute calculations. Plan an insider buys backtest.";
  const intent = interpretResearch("Now run an insider buys backtest.", {
    history: [{ role: "user", content: previous }],
  });
  assert.equal(intent.designOnly, undefined);
  assert.equal(intent.route, "legacy");
  assert.equal(researchToolRefusal(intent, "run_backtest", { spec: { source: "form4" } }), "");
  assert.equal(designOnlyRequested("Explain the design and run the descriptive calculation."), false);
});

async function ask(question, names, extra = {}) {
  const calls = [],
    events = [];
  let round = 0;
  await runAsk({
    question,
    tools: toolDefs(),
    acceptDefaults: true,
    provider: {
      async *chat() {
        if (!round++) {
          for (const [index, name] of names.entries())
            yield { type: "tool_call", id: `scope_${index}`, name, args: { spec: { source: "form4" } } };
        } else yield { type: "text", delta: "A protocol is a plan; no calculation has been executed." };
      },
    },
    execute: async (name) => {
      calls.push(name);
      return { ok: true, source: "Scope test evidence", rows: [] };
    },
    emit: (event) => events.push(event),
    ...extra,
  });
  return { calls, events, done: events.findLast((event) => event.type === "done") };
}

test("Ask dispatch blocks every calculation in a design-only turn but permits source inspection and a saved protocol", async () => {
  const result = await ask("Design only; do not execute calculations. Plan an insider buys backtest.", [
    ...executionNames,
    "research_sources",
    "research_create_investigation",
  ]);
  assert.deepEqual(result.calls, ["research_sources", "research_create_investigation"]);
  assert.deepEqual(result.done.backtests, []);
  assert.deepEqual(result.done.figures, []);
  assert.equal(
    result.events.filter((event) => event.type === "plan_note" && /Incompatible calculation blocked/.test(event.note))
      .length,
    executionNames.length,
  );
});

test("saved inspection cannot be replaced by a composed calculation or new protocol", async () => {
  const result = await ask("Inspect my saved LMT studies. Explain their recorded results.", [
    "research_run_investigation",
    "research_create_investigation",
  ]);
  assert.deepEqual(result.calls, ["research_audit_saved_studies"]);
  assert.deepEqual(result.done.backtests, []);
});

test("planning edits retain the earlier explicit design-only scope at actual dispatch", async () => {
  const result = await ask("Change the planned insider buys backtest to use SPY.", executionNames, {
    history: [{ role: "user", content: "Design only; do not execute calculations. Plan an insider buys backtest." }],
  });
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.done.backtests, []);
  assert.equal(
    result.events.filter((event) => event.type === "plan_note" && /Incompatible calculation blocked/.test(event.note))
      .length,
    executionNames.length,
  );
});

test("saved composed investigation inspection uses its own reader without creating or running a study", async () => {
  const question = "Inspect my saved LMT investigations; explain recorded results.";
  const intent = interpretResearch(question);
  assert.equal(intent.inspectionOnly, true);
  assert.equal(intent.route, "conversation");
  const result = await ask(question, [
    "research_inspect_investigation",
    "research_create_investigation",
    "research_run_investigation",
  ]);
  assert.deepEqual(result.calls, ["research_inspect_investigation"]);
  assert.deepEqual(result.done.backtests, []);
});

test("explicit negative calculation commands keep saved inspection as an inspection", async () => {
  const question = "Review my saved LMT studies, but do not run a new analysis.";
  assert.equal(interpretResearch(question).inspectionOnly, true);
  const result = await ask(question, ["research_create_investigation", "research_run_investigation"]);
  assert.deepEqual(result.calls, ["research_audit_saved_studies"]);
  assert.deepEqual(result.done.backtests, []);
});
