import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, runBacktest } from '../shared/backtest.mjs';

const start = dayOf('2025-01-02');
const series = prices => prices.map((p, i) => [start + i, p, p]);
function run({ prices = [100, 100, 110, 100], side = 'buy', costBps = 0, signals } = {}) {
  return runBacktest({
    signals: signals ?? [{ id: 'one', symbol: 'AAA', side, signalDate: '2025-01-01' }],
    bars: { AAA: series(prices) }, benchBars: { SPY: series(prices.map(() => 100)) },
    rules: { entry: 'nextClose', holdDays: 3, sides: 'both', costBps, slippageBps: 0, openTrades: 'mark' },
  });
}

test('every run including an empty run denies executable portfolio claims', () => {
  for (const result of [run(), run({ signals: [] })]) {
    assert.equal(result.executionAssessment.executablePortfolio, false);
    assert.equal(result.executionAssessment.liveTradingValidated, false);
    assert.equal(result.executionAssessment.gates.find(g => g.id === 'capital').status, 'unverified');
    assert.equal(result.executionAssessment.gates.find(g => g.id === 'turnover').status, 'unmodeled');
    assert.ok(result.caveats.items.some(c => c.id === 'executionModel' && c.level === 'warn'));
  }
  assert.ok(run({ signals: [] }).executionAssessment.costSensitivity.scenarios.every(s => s.meanTradeReturn === null));
});

test('a round-trip short has zero trade P&L but a negative daily-reset curve', () => {
  // 100 -> 100 -> 110 -> 100: daily short factors 1 * .9 * (1 + 1/11).
  const result = run({ side: 'sell' });
  assert.ok(result.trades[0].ret === 0);
  assert.equal(result.stats.total, -0.0182);
  assert.equal(result.executionAssessment.shortTrades, 1);
  assert.equal(result.executionAssessment.gates.find(g => g.id === 'shorts').status, 'unmodeled');
  assert.match(result.executionAssessment.tradeBasis, /differs from curve/);
});

test('cost sensitivity is exact arithmetic trade sensitivity, not compounded equity', () => {
  // Flat stock: 1% at each endpoint -> trade -2%; daily product .99 * .99 -> -1.99%.
  const result = run({ prices: [100, 100, 100, 100], costBps: 100 });
  assert.equal(result.trades[0].ret, -0.02);
  assert.equal(result.stats.total, -0.0199);
  const sensitivity = result.executionAssessment.costSensitivity;
  assert.equal(sensitivity.scope, 'mean_trade_return_only');
  assert.equal(sensitivity.scenarios.find(s => s.oneWayBps === 100).meanTradeReturn, -0.02);
  assert.equal(sensitivity.scenarios.find(s => s.oneWayBps === 25).meanTradeReturn, -0.005);
  assert.equal(sensitivity.scenarios.find(s => s.oneWayBps === 0).meanTradeReturn, 0);
  assert.equal(sensitivity.includesRebalancing, false);
});

test('a bar calendar never establishes verified exchange sessions or capital feasibility', () => {
  const result = run();
  assert.equal(result.executionAssessment.gates.find(g => g.id === 'calendar').status, 'unverified');
  assert.match(result.executionAssessment.gates.find(g => g.id === 'calendar').detail, /not a validated exchange calendar/);
  assert.equal(result.executionAssessment.gates.find(g => g.id === 'shorts').status, 'not_applicable');
});

test('missing stock bars are not silently represented as verified held capital', () => {
  const result = runBacktest({
    signals: ['AAA', 'BBB'].map(symbol => ({ id: symbol, symbol, side: 'buy', signalDate: '2025-01-01' })),
    bars: { AAA: series([100, 110, 110, 110]), BBB: series([100, 100, 100, 100]).filter((_, i) => i !== 1) },
    benchBars: { SPY: series([100, 100, 100, 100]) },
    rules: { entry: 'nextClose', holdDays: 3, slippageBps: 0, costBps: 0 },
  });
  // On the missing day only AAA contributes: +10%, not +5% for fixed half allocations.
  assert.equal(result.stats.total, 0.1);
  assert.match(result.executionAssessment.gates.find(g => g.id === 'calendar').detail, /remove that path/);
});

test('uncompleted marks retain hypothetical exit-cost and fill qualifications', () => {
  const result = runBacktest({
    signals: [{ id: 'one', symbol: 'AAA', side: 'buy', signalDate: '2025-01-01' }],
    bars: { AAA: series([100, 101]) }, benchBars: { SPY: series([100, 100]) },
    rules: { entry: 'nextClose', holdDays: 10, openTrades: 'mark', slippageBps: 0, costBps: 0 },
  });
  assert.equal(result.executionAssessment.markedOpenTrades, 1);
  assert.equal(result.executionAssessment.gates.find(g => g.id === 'valuation').status, 'assumed');
});
