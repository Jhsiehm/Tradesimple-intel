import test from "node:test";
import assert from "node:assert/strict";
import { questionHints, buildSpec, mergeModelSpec } from "../shared/backtestAsk.mjs";
import { researchRouting, assessmentAnswer } from "../server/ai/researchRouting.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";
import { CONTRACT_QUESTION, PRE_NEWS_QUESTION } from "./fixtures/contractQuestion.mjs";
import { explicitSignalSources } from "../shared/researchIntent.mjs";
import { INVESTIGATION_TOOL_NAMES } from "../shared/investigationAccess.mjs";

test("contract scope retains the ticker list and never invents a Rules Committee filter", () => {
  const hints = questionHints(CONTRACT_QUESTION, "2026-10-20");
  assert.equal(hints.fields["filters.committee"], undefined);
  assert.deepEqual(hints.fields["filters.tickers"], ["LMT", "RTX", "NOC", "GD", "HII"]);
  const plan = buildSpec({
    question:
      "Backtest contract awards for LMT, RTX, NOC, GD, and HII; check these rules; hold 30 calendar days vs SPY with equal position weights",
    today: "2026-10-20",
    prefs: { v: 1, values: { "rules.holdDays": 90, "rules.sizing": "amountMid" } },
  });
  const merged = mergeModelSpec(plan, { source: "contracts", filters: { tickers: ["AAPL"] } });
  assert.deepEqual(merged.filters.tickers, ["LMT", "RTX", "NOC", "GD", "HII"]);
  assert.equal(merged.filters.committee, "");
  assert.equal(merged.rules.holdDays, 30);
  assert.equal(merged.rules.sizing, "equal");
  assert.equal(
    questionHints("Backtest Rules Committee members’ stock trades", "2026-10-20").fields["filters.committee"],
    "Rules",
  );
  assert.equal(
    questionHints("Backtest insider buys; explain these rules", "2026-10-20").fields["filters.committee"],
    undefined,
  );
  assert.deepEqual(
    explicitSignalSources(
      "Backtest congressional votes; enter trades after public availability. Do not substitute politicians’ personal stock trades.",
    ),
    [],
  );
  assert.deepEqual(explicitSignalSources("Compare congressional stock trades and legislative votes"), ["congress"]);
});

test("an unsupported trading-session hold is not replaced by a calendar-day default", () => {
  const { intent, assessment } = researchRouting(CONTRACT_QUESTION);
  assert.equal(intent.route, "assessment");
  assert.deepEqual(intent.domains, ["contracts"]);
  assert.deepEqual(intent.windows, ["12 months", "1 month"]);
  assert.equal(intent.benchmark, "SPY");
  assert.equal(assessment.executed, false);
  assert.match(assessmentAnswer(assessment), /calendar days, not trading sessions/);
  assert.match(assessmentAnswer(assessment), /assumed publication delays/);
  assert.throws(() => buildSpec({ question: CONTRACT_QUESTION, today: "2026-10-20" }), /research design/);
  const insider = researchRouting("Backtest insider buys, hold for 30 trading days");
  assert.equal(insider.assessment.status, "unsupported-design");
  assert.match(assessmentAnswer(insider.assessment), /using insider stock filings/);
});

test("pre-news legislative research requires publication, archive and intraday evidence", () => {
  const { intent, assessment } = researchRouting(PRE_NEWS_QUESTION);
  assert.equal(intent.route, "assessment");
  assert.ok(intent.domains.includes("legislation"));
  assert.ok(!intent.allowedSources.includes("congress"));
  assert.deepEqual(intent.windows, ["2 years", "1 month"]);
  assert.ok(assessment.requirements.some((r) => r.includes("intraday prices")));
  const answer = assessmentAnswer(assessment);
  for (const expected of [
    /public-availability timestamps/,
    /not global first news/,
    /missing coverage is not evidence/,
    /Daily price bars cannot establish/,
    /processing\/execution delay/,
    /separate tests/,
  ])
    assert.match(answer, expected);
  const follow = researchRouting("Now try one month", { history: [{ role: "user", content: PRE_NEWS_QUESTION }] });
  assert.match(assessmentAnswer(follow.assessment), /Daily price bars cannot establish/);
});

test("without a study toolchain both exact questions retain the safe assessment fallback", async () => {
  for (const question of [CONTRACT_QUESTION, PRE_NEWS_QUESTION]) {
    const events = [];
    await runAsk({
      question,
      today: "2026-10-20",
      acceptDefaults: true,
      researchEnv: {},
      tools: toolDefs().filter((tool) => !INVESTIGATION_TOOL_NAMES.has(tool.name)),
      provider: {
        async *chat() {
          throw Error("Unexpected paid model call");
        },
      },
      execute: async () => {
        throw Error("Unexpected computation");
      },
      emit: (e) => events.push(e),
    });
    const done = events.find((e) => e.type === "done");
    assert.equal(done.research.executed, false);
    assert.deepEqual(done.backtests, []);
    assert.equal(done.usage.tokens, 0);
    assert.ok(!events.some((e) => e.type === "clarify"));
  }
});
