import test from "node:test";
import assert from "node:assert/strict";
import { interpretResearch } from "../shared/researchIntent.mjs";
import { researchToolRefusal } from "../shared/researchCompatibility.mjs";
import { DESCRIPTIVE_QUESTION } from "./fixtures/descriptiveQuestion.mjs";
import { POLICY_QUESTION } from "./fixtures/policyQuestion.mjs";

test("the actual revenue/cost request stays descriptive and cannot substitute a trading source", () => {
  const intent = interpretResearch(DESCRIPTIVE_QUESTION);
  assert.equal(intent.family, "descriptive");
  assert.equal(intent.route, "conversation");
  assert.equal(intent.outcome, "description");
  assert.deepEqual(intent.allowedSources, []);
  assert.match(researchToolRefusal(intent, "run_backtest", { spec: { source: "congress" } }), /evidence inspection/);
});

test("research bookkeeping and input descriptions do not request a market simulation", () => {
  for (const question of [
    "Save this investigation and calculate average revenue.",
    "Calculate revenue minus costs and provide an offline replay ZIP download.",
    "Compute the mean across the observations. Include a replay bundle and JSON evidence.",
    "Inspect the stock-trading dataset columns and summarize the missing values.",
    "Describe the records; do not substitute stock-trading data.",
  ]) {
    const intent = interpretResearch(question);
    assert.equal(intent.family, "descriptive", question);
    assert.equal(intent.route, "conversation", question);
  }
});

test("descriptive bookkeeping cannot downgrade actual strategy, predictive, or causal demands", () => {
  for (const [question, family, route] of [
    ["Save a descriptive report and offline replay ZIP, but backtest insider buys vs SPY.", "strategy", "legacy"],
    ["Save the investigation: could investing after a bill advances beat SPY?", "strategy", "assessment"],
    ["Use stock-trading data to backtest contract awards and export a replay bundle.", "strategy", "legacy"],
    ["Call this descriptive, but predict returns from legislative actions.", "predictive", "assessment"],
    ["Export a descriptive replay package and estimate the causal effect of contract awards.", "causal", "assessment"],
    ["Replay insider buys vs SPY and save the investigation.", "strategy", "legacy"],
    ["Replay archives of insider buys vs SPY.", "strategy", "legacy"],
    ["Execute the saved offline replay bundle of insider buys vs SPY.", "strategy", "legacy"],
    ["Run the replay archive of insider buys vs SPY.", "strategy", "legacy"],
    ["Invest in contractors after regulatory changes.", "strategy", "assessment"],
  ]) {
    const intent = interpretResearch(question);
    assert.equal(intent.family, family, question);
    assert.equal(intent.route, route, question);
  }
});

test("an explicit new descriptive workflow does not inherit a previous policy strategy", () => {
  const options = { prior: { source: "congress" }, history: [{ role: "user", content: POLICY_QUESTION }] };
  const intent = interpretResearch(`Now ${DESCRIPTIVE_QUESTION}`, options);
  assert.equal(intent.family, "descriptive");
  assert.equal(intent.route, "conversation");
  assert.equal(intent.contextQuestion, null);
  assert.deepEqual(intent.domains, []);
  assert.deepEqual(intent.allowedSources, []);
  const refinement = interpretResearch("Now try one month", options);
  assert.equal(refinement.route, "assessment");
  assert.equal(refinement.contextQuestion, POLICY_QUESTION);
});

test("bookkeeping-only history cannot create a new policy strategy", () => {
  const intent = interpretResearch("Now inspect legislation", {
    history: [{ role: "user", content: "Save the investigation and provide an offline replay ZIP." }],
  });
  assert.equal(intent.family, "descriptive");
  assert.equal(intent.route, "conversation");
  assert.equal(intent.contextQuestion, null);
});
