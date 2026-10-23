import test from "node:test";
import assert from "node:assert/strict";
import { interpretResearch } from "../shared/researchIntent.mjs";
import { researchToolRefusal } from "../shared/researchCompatibility.mjs";
import { researchRouting, assessmentAnswer } from "../server/ai/researchRouting.mjs";
import { researchCapabilities } from "../server/ai/researchCapabilities.mjs";
import { questionSources, buildSpec } from "../shared/backtestAsk.mjs";
import { draftFromQuestion } from "../shared/taskSchedule.mjs";
import { retryReason } from "../shared/agent.mjs";

import { POLICY_QUESTION } from "./fixtures/policyQuestion.mjs";

const prior = { source: "congress" };

test("the actual failed question retains all policy domains, periods and benchmark", () => {
  const { intent, assessment } = researchRouting(POLICY_QUESTION, { env: {} });
  assert.equal(intent.route, "assessment");
  assert.deepEqual(intent.domains, ["legislation", "regulation", "lobbying", "contracts"]);
  assert.deepEqual(intent.windows, ["2 years", "1 month"]);
  assert.equal(intent.benchmark, "SPY");
  assert.equal(assessment.executed, false);
  assert.equal(assessment.coverageAudited, false);
  assert.equal(assessment.capabilities.length, 4);
  assert.deepEqual(questionSources(POLICY_QUESTION), []);
  assert.throws(() => buildSpec({ question: POLICY_QUESTION, today: "2026-10-20" }), /research design/);
  const answer = assessmentAnswer(assessment);
  assert.match(answer, /no backtest executed/);
  assert.match(answer, /publication evidence/);
  assert.match(answer, /last 365 days/);
  assert.doesNotMatch(answer, /90[- ]day hold|strategy returned|edge in VA/i);
});

test("legislative and regulatory paraphrases cannot become stock-disclosure studies", () => {
  for (const question of [
    "Backtest committee markups and regulatory changes affecting government contractors",
    "Backtest Senate votes and House floor votes",
    "Backtest roll-call outcomes predicting stock returns",
    "Do bill amendments cause defense suppliers to outperform?",
    "Could investing after a bill advances out of committee beat SPY?",
    "Predict stock prices from rulemaking and appropriations",
    "Backtest new bill language, not congressional stock portfolios",
    "Compare lobbying increases, bill amendments and later returns",
    "Backtest legisaltion and regultion changes",
    "Backtest a joint strategy combining lobbying spikes and contract awards",
    "Run an event study of lobbying disclosures",
  ])
    assert.equal(interpretResearch(question, { prior }).route, "assessment", question);
});

test("procurement and causal outcomes are not replaced with market return replay", () => {
  const procurement = interpretResearch("Did regulatory changes predict future contract awards?");
  assert.equal(procurement.outcome, "procurement");
  assert.match(assessmentAnswer(researchRouting(procurement.question).assessment), /outcome is later procurement/);
  assert.equal(interpretResearch("Did contract awards cause higher returns?").family, "causal");
});

test("explicit supported signal strategies keep their sources", () => {
  for (const [question, sources] of [
    ["Backtest House members disclosed stock purchases", ["congress"]],
    ["Backtest congressional trades by committee membership", ["congress"]],
    ["Backtest congressional buys by Appropriations committee members", ["congress"]],
    ["Backtest insider buys", ["form4"]],
    ["Backtest contract awards", ["contracts"]],
    ["Backtest lobbying spikes for AAPL", ["lobbying"]],
    ["Backtest all data sources", ["congress", "form4", "contracts"]],
    ["Backtest insider filings and contract awards separately", ["form4", "contracts"]],
  ]) {
    const intent = interpretResearch(question);
    assert.equal(intent.route, "legacy", question);
    assert.deepEqual(intent.allowedSources, sources, question);
    assert.deepEqual(questionSources(question), sources, question);
  }
});

test("no unresolved question or negation silently selects Congress", () => {
  assert.deepEqual(questionSources("Backtest it"), []);
  assert.deepEqual(questionSources("Backtest congressional activity"), []);
  assert.deepEqual(questionSources("Backtest politicians"), []);
  assert.equal(interpretResearch("Backtest Congress actions").route, "assessment");
  assert.equal(interpretResearch("Backtest this idea").route, "assessment");
  assert.deepEqual(questionSources("Backtest insider buys, not congressional trades"), ["form4"]);
  assert.deepEqual(questionSources("Ignore legislation; backtest contract awards only"), ["contracts"]);
});

test("ordinary factual and documentary research still goes to the assistant", () => {
  for (const question of [
    "What changed in this bill?",
    "Show the regulatory document",
    "How are markets today?",
    "What is a contract award?",
    "What did Pelosi buy?",
  ]) {
    assert.equal(interpretResearch(question).route, "conversation", question);
  }
});

test("a new policy question overrides prior portfolios; policy follow-ups retain their question", () => {
  assert.equal(interpretResearch("Now test legislative markups", { prior }).route, "assessment");
  const intent = interpretResearch("Now try one month", {
    prior,
    history: [
      { role: "user", content: POLICY_QUESTION },
      { role: "assistant", content: "A capability assessment." },
    ],
  });
  assert.equal(intent.route, "assessment");
  assert.equal(intent.contextQuestion, POLICY_QUESTION);
  assert.ok(intent.domains.includes("legislation"));
  const independent = interpretResearch("Backtest insider buys", {
    prior,
    history: [{ role: "user", content: POLICY_QUESTION }],
  });
  assert.equal(independent.route, "legacy");
  assert.deepEqual(independent.allowedSources, ["form4"]);
});

test("existing parameter follow-ups preserve single and multi-source scope", () => {
  assert.deepEqual(interpretResearch("Hold 30 days instead", { prior }).allowedSources, ["congress"]);
  assert.deepEqual(
    interpretResearch("exclude Pelosi", { prior, priors: [prior, { source: "form4" }, { source: "contracts" }] })
      .allowedSources,
    ["congress", "form4", "contracts"],
  );
});

test("capability configuration never leaks credentials or claims audited data", () => {
  const catalog = researchCapabilities({ CONGRESS_API_KEY: "secret-one", LDA_API_KEY: "secret-two" });
  assert.equal(catalog.find((c) => c.domain === "legislation").lookup, "configured");
  assert.equal(catalog.find((c) => c.domain === "lobbying").lookup, "configured");
  assert.ok(catalog.every((c) => c.coverage === "not-audited"));
  assert.doesNotMatch(JSON.stringify(catalog), /secret-one|secret-two/);
});

test("dispatch guards reject model source changes and policy optimization", () => {
  const insider = interpretResearch("Backtest insider buys");
  assert.match(researchToolRefusal(insider, "run_backtest", { spec: { source: "congress" } }), /outside/);
  assert.equal(researchToolRefusal(insider, "run_backtest", { spec: { source: "form4" } }), "");
  const policy = interpretResearch(POLICY_QUESTION);
  assert.match(researchToolRefusal(policy, "search_signals", {}), /research design/);
  assert.equal(researchToolRefusal(policy, "bill", {}), "");
});

test("retry logic accepts an appropriate feasibility finding instead of demanding a backtest", () => {
  assert.equal(retryReason(POLICY_QUESTION, "The requested historical design is unavailable.", []), "");
  assert.equal(retryReason("Backtest it", "Which signal should trigger entry?", []), "");
  assert.match(retryReason("Backtest insider buys", "No test yet.", []), /run_backtest/);
});

test("scheduling a policy backtest cannot bypass the research guard or reuse old portfolios", () => {
  const requested = draftFromQuestion({
    question: "Every morning at 8, backtest legislative markups and lobbying activity",
    today: "2026-10-20",
  });
  assert.equal(requested.ok, false);
  assert.match(requested.error, /resolved design/);
  const reference = draftFromQuestion({
    question: "Run this every morning at 8",
    today: "2026-10-20",
    lastQuestion: POLICY_QUESTION,
    priors: [{ source: "congress" }],
  });
  assert.equal(reference.ok, false);
});

test("signal optimization cannot expand a declared insider study to Congress", () => {
  const intent = interpretResearch("Backtest insider buys");
  assert.match(researchToolRefusal(intent, "search_signals", { sources: ["congress", "form4"] }), /outside/);
  assert.equal(researchToolRefusal(intent, "search_signals", { sources: ["form4"] }), "");
});

test("explicit questions about saved results can inspect their original source", () => {
  assert.deepEqual(interpretResearch("Why did that result fall?", { prior: { source: "contracts" } }).allowedSources, [
    "contracts",
  ]);
});

test("an explicit narrower replacement can leave the policy assessment without inheriting the old source", () => {
  const question = "Now backtest contract awards only instead";
  const intent = interpretResearch(question, { prior, history: [{ role: "user", content: POLICY_QUESTION }] });
  assert.equal(intent.route, "legacy");
  assert.equal(intent.contextQuestion, null);
  assert.deepEqual(intent.allowedSources, ["contracts"]);
  assert.equal(
    buildSpec({ question, prior: { source: "congress", filters: {}, rules: {} }, today: "2026-10-20" }).spec.source,
    "contracts",
  );
});

test("explicitly excluded return calculations do not turn obligation descriptions into strategies", () => {
  const intent = interpretResearch(
    "Create a descriptive study plan for HII contract obligation amounts. Plan only; do not calculate returns or run the study yet.",
  );
  assert.equal(intent.family, "descriptive");
  assert.equal(intent.designOnly, true);
  assert.equal(interpretResearch("Calculate returns for HII contract awards.").family, "strategy");
});
test("creating a plan takes precedence over reviewing its saved source records", () => {
  const intent = interpretResearch("Review my saved HII studies and create a descriptive study plan. Plan only.");
  assert.equal(Boolean(intent.inspectionOnly), false);
  assert.equal(intent.designOnly, true);
});
