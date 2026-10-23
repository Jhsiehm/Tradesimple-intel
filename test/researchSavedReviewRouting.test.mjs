import test from "node:test";
import assert from "node:assert/strict";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";
import { DEFAULT_FILTERS, DEFAULT_RULES } from "../shared/backtestSpec.mjs";
import { interpretResearch } from "../shared/researchIntent.mjs";
import { researchToolRefusal } from "../shared/researchCompatibility.mjs";
import { savedStudyAuditArgs } from "../server/ai/studyAuditPlanning.mjs";
import { POLICY_QUESTION } from "./fixtures/policyQuestion.mjs";

const QUESTION =
  "Compare my saved LMT and HII procurement studies. Inspect their underlying datasets and results. Explain the records covered, exclusions, publication-timing assumptions, benchmark results, and coverage gaps. Which comparisons are supported, and which conclusions would overreach? Cite the saved evidence and distinguish completed calculations from complete data coverage.";
const prior = (source) => ({ source, filters: { ...DEFAULT_FILTERS }, rules: { ...DEFAULT_RULES } });

for (const [name, priors, history] of [
  ["one previous portfolio", [prior("contracts")], []],
  ["multiple previous portfolios", [prior("contracts"), prior("congress")], []],
  ["an earlier policy strategy", [prior("congress")], [{ role: "user", content: POLICY_QUESTION }]],
]) {
  test(`saved-study inspection takes precedence over ${name}`, async () => {
    const calls = [],
      events = [],
      seen = [];
    await runAsk({
      question: QUESTION,
      priors,
      prior: priors.at(-1),
      history,
      tools: toolDefs(),
      acceptDefaults: true,
      provider: {
        async *chat(messages) {
          seen.push(structuredClone(messages));
          yield { type: "text", delta: "This fixture has no saved studies to compare [t1]." };
        },
      },
      execute: async (name, args) => {
        calls.push({ name, args });
        assert.equal(name, "research_audit_saved_studies", "inspection must not rerun a previous portfolio");
        return { ok: true, source: "Fixture saved registry", studies: [], selectedIds: [] };
      },
      emit: (event) => events.push(event),
    });
    assert.deepEqual(calls, [{ name: "research_audit_saved_studies", args: { studyNames: ["LMT", "HII"] } }]);
    const done = events.findLast((event) => event.type === "done");
    assert.ok(done);
    assert.deepEqual(done.backtests, []);
    assert.equal(done.clarify, false);
    if (history.length) assert.ok(seen[0].some((message) => message.content === POLICY_QUESTION));
    assert.match(seen[0][0].content, /Earlier chat messages provide context, not frozen evidence/);
  });
}

test("saved-study inspection does not expose owner tools with web-only sourcing", async () => {
  const calls = [],
    events = [];
  await runAsk({
    question: QUESTION,
    priors: [prior("congress"), prior("contracts")],
    session: { sourcing: "web", style: "terminal" },
    tools: toolDefs("web"),
    acceptDefaults: true,
    provider: {
      async *chat() {
        yield { type: "text", delta: "Saved platform records are unavailable with web-only sourcing." };
      },
    },
    execute: async (name) => {
      calls.push(name);
      return { ok: false };
    },
    emit: (event) => events.push(event),
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(events.findLast((event) => event.type === "done").backtests, []);
});

test("a descriptive source reference does not authorize replay or optimization", () => {
  const intent = interpretResearch(QUESTION);
  assert.deepEqual(intent.allowedSources, ["contracts"], "mentioning a source is not a request to trade it");
  assert.match(
    researchToolRefusal(intent, "run_backtest", { spec: prior("contracts") }),
    /inspection of saved evidence/,
  );
  assert.match(
    researchToolRefusal(intent, "search_signals", { sources: ["contracts"] }),
    /inspection of saved evidence/,
  );
  const refinement = interpretResearch("Hold 30 days instead", { prior: prior("contracts") });
  assert.equal(refinement.route, "legacy");
  assert.equal(refinement.family, "descriptive");
  assert.equal(researchToolRefusal(refinement, "run_backtest", { spec: prior("contracts") }), "");
});

test("a model cannot replace saved-study inspection with a fresh backtest", async () => {
  const calls = [],
    events = [],
    seen = [];
  let round = 0;
  await runAsk({
    question: QUESTION,
    tools: toolDefs(),
    acceptDefaults: true,
    provider: {
      async *chat(messages) {
        seen.push(structuredClone(messages));
        if (!round++)
          yield { type: "tool_call", id: "replacement", name: "run_backtest", args: { spec: prior("contracts") } };
        else yield { type: "text", delta: "This fixture has no saved studies to compare [t1]." };
      },
    },
    execute: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, source: "Fixture saved registry", studies: [], selectedIds: [] };
    },
    emit: (event) => events.push(event),
  });
  assert.deepEqual(calls, [{ name: "research_audit_saved_studies", args: { studyNames: ["LMT", "HII"] } }]);
  assert.deepEqual(events.findLast((event) => event.type === "done").backtests, []);
  assert.match(JSON.stringify(seen), /inspection of saved evidence/);
  assert.ok(events.some((event) => event.type === "plan_note" && /Incompatible calculation blocked/.test(event.note)));
});

test("explicit new execution is not downgraded to saved-record inspection", () => {
  for (const question of [
    "Compare my saved studies and then backtest a new insider strategy",
    "Inspect and rerun my saved LMT studies",
    "Review my saved experiments; replay insider buys vs SPY",
    "Compare my saved studies and execute a new backtest",
  ]) {
    assert.equal(savedStudyAuditArgs(question), null, question);
    const intent = interpretResearch(question);
    assert.ok(["legacy", "assessment"].includes(intent.route), question);
  }
  for (const question of [
    `${QUESTION} Do not rerun them.`,
    "Inspect my saved LMT studies; do not rerun or replay them.",
    "Review my saved studies and provide an offline replay ZIP.",
  ]) {
    assert.deepEqual(
      savedStudyAuditArgs(question),
      question.includes("LMT") ? { studyNames: question.includes("HII") ? ["LMT", "HII"] : ["LMT"] } : {},
      question,
    );
    assert.equal(interpretResearch(question).family, "descriptive", question);
  }
});

test("explicit past-performance questions retain their identifiable trading source", () => {
  for (const [question, source] of [
    ["How did congress buys do?", "congress"],
    ["How did insider trades perform?", "form4"],
    ["How have congressional portfolios performed?", "congress"],
  ]) {
    const intent = interpretResearch(question);
    assert.equal(intent.route, "legacy", question);
    assert.equal(intent.family, "strategy", question);
    assert.equal(researchToolRefusal(intent, "run_backtest", { spec: prior(source) }), "");
  }
  assert.equal(interpretResearch("How did Congress vote on this bill?").route, "conversation");
});
