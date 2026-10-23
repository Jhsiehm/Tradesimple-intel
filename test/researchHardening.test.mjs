import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, writeCache } from '../server/lib/db.mjs';
import { beginResearchTrial, finishResearchTrial, listResearchTrials, exportResearchTrials } from '../server/domain/research-trials.mjs';
import { runSpec } from '../server/domain/backtest/index.mjs';
import { getRun } from '../server/domain/research-store.mjs';
import { exportRunFiles, replayRun } from '../server/domain/research-replay.mjs';
import { startSearch, waitForSearch, searchView } from '../server/domain/backtest/search.mjs';
import { summarizeBacktest } from '../server/ai/tools.mjs';
import { scopeCheck } from '../shared/claimScope.mjs';
import { dayOf } from '../shared/backtest.mjs';
import { cleanSpec, specHash } from '../shared/backtestSpec.mjs';
import { KEY } from '../server/lib/cacheKeys.mjs';

function database() {
  const before = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ':memory:';
  try { return openDb(decodeURIComponent(new URL('..', import.meta.url).pathname)); }
  finally { if (before === undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE = before; }
}
const spec = { source: 'form4', filters: { from: '2025-01-01', to: '2025-04-01', tickers: ['AAPL'] }, rules: { holdDays: 10 } };
const series = Array.from({ length: 100 }, (_, i) => [dayOf('2025-01-01') + i, 100 + i, 101 + i]);
const priceResult = { bars: { AAPL: series, SPY: series }, pending: [], missing: [], stale: [], cached: 2, fetched: 0 };
const source = async () => ({ signals: [{ id: 'one', symbol: 'AAPL', side: 'buy', tradeDate: '2025-01-02', signalDate: '2025-01-06' }], records: [], context: {}, coverage: {}, feeds: [] });

test('attempt inventory records failures and overlaps across methods, and refuses mutation', () => {
  const db = database();
  try {
    const first = beginResearchTrial(db, { kind: 'backtest', spec });
    finishResearchTrial(db, first, { status: 'failed', detail: 'No prices' });
    const second = beginResearchTrial(db, { kind: 'convergence-holdout', spec: { from: '2025-02-01', to: '2025-03-01', universe: ['AAPL'] } });
    assert.equal(second.priorOverlappingAttempts, 1);
    const other = beginResearchTrial(db, { kind: 'backtest', spec: { filters: { ...spec.filters, tickers: ['MSFT'] } } });
    assert.equal(other.priorOverlappingAttempts, 0);
    const inventory = exportResearchTrials(db, second.id);
    assert.equal(inventory.attempts.length, 2);
    assert.equal(inventory.attempts.find(x => x.trial.id === first.id).outcome.status, 'failed');
    assert.equal(inventory.attempts.find(x => x.trial.id === second.id).outcome.status, 'unfinished');
    assert.throws(() => db.prepare('DELETE FROM research.trial_attempts').run(), /immutable/);
    assert.throws(() => db.prepare('UPDATE research.trial_outcomes SET body=?').run('{}'), /immutable/);
  } finally { db.close(); }
});

test('backtest freezes validity, execution and trial evidence; archive includes attempt inventory', async () => {
  const db = database();
  try {
    const out = await runSpec(db, spec, { sourceFn: source, loadBarsFn: async () => priceResult });
    assert.equal(out.dataValidity.strictHistoricalTradability.eligible, false);
    assert.equal(out.executionAssessment.executablePortfolio, false);
    assert.equal(out.reality.inference.status, 'withheld');
    const saved = getRun(db, out.runId);
    assert.deepEqual(saved.provenance.dataValidity, out.dataValidity);
    assert.equal(replayRun(saved).matches, true);
    const files = exportRunFiles(db, saved);
    assert.ok(files.some(f => f.name === 'engine/executionAssessment.mjs'));
    const inventory = JSON.parse(files.find(f => f.name === 'trials.json').text);
    assert.equal(inventory.attempts[0].outcome.runId, out.runId);
    const summary = summarizeBacktest(out);
    assert.equal(summary.isItReal.inference.status, 'withheld');
    assert.equal(summary.isItReal.excessCI95Lo, undefined);
    assert.equal(summary.executionAssessment.executablePortfolio, false);
    assert.equal(summary.trial.id, out.trial.id);
    assert.equal(summary.dataValidity.priceCoverage.loaded, 2);
    assert.equal(summary.dataValidity.priceCoverage.series, undefined, 'per-security manifests stay in the frozen evidence rather than crowding the model summary');
    await assert.rejects(runSpec(db, spec, { sourceFn: async () => { throw Error('Provider unavailable'); } }), /Provider unavailable/);
    const attempts = listResearchTrials(db);
    assert.equal(attempts.length, 2);
    assert.equal(exportResearchTrials(db, attempts.find(t => t.id !== out.trial.id).id).attempts.find(x => x.trial.id !== out.trial.id).outcome.status, 'failed');
  } finally { db.close(); }
});

test('fresh search reloads prices and durably inventories untested variants', async () => {
  const db = database();
  let loads = 0;
  const deps = {
    insiderHistory: async () => ({ items: [{ id: 'f4', symbol: 'AAPL', side: 'buy', code: 'P', person: 'Person', title: 'CEO', filed: '2025-01-06', traded: '2025-01-02', value: 1000, plan: false }] }),
    sectorOf: () => 'Technology',
    loadBars: async () => { loads++; return priceResult; }
  };
  try {
    let last;
    for (let i = 0; i < 2; i++) {
      const started = startSearch(db, { sources: ['form4'], from: '2025-01-01', to: '2025-04-01', holdDays: 10 }, { fresh: true, inline: true, deps });
      await waitForSearch(started.id, 10000);
      last = searchView(db, started.id);
      assert.equal(last.state, 'done', last.error);
    }
    assert.equal(loads, 2);
    assert.ok(last.trial.priorOverlappingAttempts >= 1);
    const inventory = exportResearchTrials(db, last.trial.id);
    const children = inventory.attempts.filter(x => x.trial.parentId === last.trial.id);
    assert.equal(children.length, last.built);
    assert.ok(children.every(x => x.outcome.status === 'untested'));
  } finally { db.close(); }
});

test('source/cache assessment cannot be bypassed by an older cached result', async () => {
  const db = database();
  try {
    const out = await runSpec(db, spec, { sourceFn: source, loadBarsFn: async () => priceResult });
    const normalized = cleanSpec(spec).spec;
    const missingSpec = { source: 'dataset', datasetId: `ds_${'0'.repeat(32)}`, rules: { holdDays: 10 } };
    const legacy = { ...out, dataValidity: undefined, trial: undefined };
    writeCache(db, KEY.backtest(specHash(cleanSpec(missingSpec).spec)), legacy, 60000);
    const rejected = await runSpec(db, missingSpec);
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /Dataset version not found/);
    writeCache(db, KEY.backtest(specHash(normalized)), out, 60000);
    const hit = await runSpec(db, spec);
    assert.equal(hit.cache, 'hit');
    assert.equal(hit.trial.id, out.trial.id);
    assert.equal(listResearchTrials(db).length, 2, 'cache access does not manufacture a new experiment');
  } finally { db.close(); }
});

test('explicit trading certification and withheld significance claims are flagged, denials are not', () => {
  const evidence = [{ id: 't1', tool: 'run_backtest', ok: true, json: JSON.stringify({ ok: true, isItReal: { inference: { status: 'withheld' } } }) }];
  assert.ok(scopeCheck('This is a verified trading edge [t1].', evidence).some(f => f.kind === 'research'));
  assert.ok(scopeCheck('The result is statistically significant [t1].', evidence).some(f => f.kind === 'research'));
  assert.equal(scopeCheck('This is not a verified trading edge [t1].', evidence).length, 0);
  assert.equal(scopeCheck('The result is not statistically significant [t1].', evidence).length, 0);
});
