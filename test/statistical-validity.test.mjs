import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clusteredT,
  inferenceApplicability,
  realityCheck,
  realityVerdict,
  tSurvival,
} from "../shared/backtestStats.mjs";
import { bhQValues, evaluateVariant, rankFindings, searchWarning } from "../shared/signalSearch.mjs";
import { dayOf, isoOf, runBacktest } from "../shared/backtest.mjs";
import { cleanRules } from "../shared/backtestSpec.mjs";

const reference = JSON.parse(readFileSync(new URL("./statistical-reference-fixtures.json", import.meta.url)));
const relativeNear = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-300, Math.abs(expected) * 1e-11), `${actual} vs ${expected}`);

test("Student tails, CR1 and BH match independently generated SciPy / matrix fixtures", () => {
  for (const fixture of reference.tails) relativeNear(tSurvival(fixture.t, fixture.df), fixture.survival);
  const c = clusteredT(reference.cluster.values, reference.cluster.keys);
  for (const key of ["se", "t", "pOne"]) relativeNear(c[key], reference.cluster[key]);
  bhQValues(reference.bh.p).forEach((q, i) => relativeNear(q, reference.bh.q[i]));
  assert.ok(tSurvival(100, 30) > 0, "no subtraction of a near-one CDF");
});

const monday = dayOf("2025-01-06");
const intervals = (hold = 2, count = 12) =>
  Array.from({ length: count }, (_, i) => ({ entry: isoOf(monday + i * 7), exit: isoOf(monday + i * 7 + hold) }));

test("inference screen withholds cross-week shared returns, invalid dates and small block counts", () => {
  assert.equal(inferenceApplicability(intervals()).status, "exploratory");
  for (const hold of [7, 30]) assert.match(inferenceApplicability(intervals(hold)).reasons.join(" "), /overlap/);
  assert.match(inferenceApplicability(intervals(2, 9)).reasons.join(" "), /at least 10/);
  assert.match(inferenceApplicability([{ entry: "bad", exit: "bad" }]).reasons.join(" "), /invalid/);
  const reversed = intervals().reverse();
  assert.deepEqual(inferenceApplicability(reversed), inferenceApplicability(intervals()));
  const rows = intervals(30).map((t, i) => ({ ...t, ret: 0.2 + i / 1000, excess: 0.1 + i / 1000, actor: `M${i}` }));
  const result = realityCheck({ trades: rows, rules: { benchmark: "SPY" }, placebo: false });
  assert.ok(result.bootstrap.meanExcess.lo > 0, "positive diagnostic does not override failed applicability");
  assert.equal(result.inference.status, "withheld");
  assert.match(result.verdict.text, /^Inference withheld/);
  assert.notEqual(result.verdict.level, "beat");
});

test("failed timing placebo never asserts stock selection skill", () => {
  const result = realityVerdict({
    n: 60,
    bootstrap: { meanExcess: { lo: 0.01, hi: 0.05 } },
    placebo: { p: 0.4, pct: 0.6, iters: 1000 },
  });
  assert.match(result.text, /does not establish stock-selection skill/);
  assert.doesNotMatch(result.text, /edge is in/);
});

test("BH keeps sub-display precision at decision boundaries and rejects invalid inputs", () => {
  const rows = [0.05000001, 0.7].map((p, i) => ({ id: String(i), n: 40, signals: 40, p, stats: { avgExcess: 0.02 } }));
  const result = rankFindings(rows, { fdr: 0.1 });
  assert.equal(result.findings[0].q, 0.10000002);
  assert.equal(result.findings[0].passes, false);
  for (const p of [NaN, Infinity, -0.1, 1.1]) assert.throws(() => bhQValues([p]), RangeError);
  assert.equal(rankFindings([{ ...rows[0], p: NaN }]).tested, 0);
  const warning = searchWarning({ built: 20, tested: 20, passing: 10 });
  assert.match(warning, /does not estimate the number/);
  assert.match(warning, /not repeated searches/);
  assert.doesNotMatch(warning, /expect about.*false/);
});

test("variant testing retains raw p precision and excludes overlapping holds", () => {
  const bars = Array.from({ length: 320 }, (_, i) => [
    monday + i,
    100 + i + Math.sin(i) * 5,
    100 + i + Math.sin(i) * 5,
  ]);
  const bench = bars.map(([d]) => [d, 100, 100]);
  const signals = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    signalDate: isoOf(monday + i * 7),
    symbol: "AAA",
    actor: `M${i % 8}`,
    side: "buy",
  }));
  const variant = {
    id: "v",
    dim: "test",
    label: "test",
    signals,
    spec: { rules: cleanRules({ holdDays: 2, slippageBps: 0 }) },
  };
  const input = { variant, bars: { AAA: bars }, benchBars: { SPY: bench } };
  const result = evaluateVariant(input);
  const run = runBacktest({ ...input, signals, rules: variant.spec.rules });
  // Exact independent reference above validates the estimator; this guards its call-site precision.
  assert.ok(result.p > 0 && result.p < 1);
  assert.notEqual(result.p, Math.round(result.p * 10000) / 10000);
  assert.equal(result.inference.status, "exploratory");
  variant.spec.rules = cleanRules({ holdDays: 20, slippageBps: 0 });
  const overlapping = evaluateVariant(input);
  assert.equal(overlapping.p, null);
  assert.equal(rankFindings([overlapping]).tested, 0);
  assert.ok(run.trades.length >= 30);
});

test("empty and singleton runs preserve inference status on the early return", () => {
  for (const trades of [[], [{ entry: "2025-01-06", exit: "2025-01-08", ret: 0.02, excess: 0.01 }]]) {
    const result = realityCheck({ trades, rules: { benchmark: "SPY" }, placebo: false });
    assert.equal(result.n, trades.length);
    assert.equal(result.inference.status, "withheld");
    assert.equal(result.inference.blocks, trades.length);
    assert.match(result.verdict.text, /^Inference withheld/);
    assert.equal(result.bootstrap, null);
  }
});
