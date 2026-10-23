import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assessPriceCoverage, assessResearchDataValidity, requireStrictHistoricalTradability } from '../shared/researchDataValidity.mjs';
import { form4Source } from '../server/domain/backtest/sources.mjs';
import { contractSignals } from '../server/domain/backtest/signals.mjs';
import { cleanFilters } from '../shared/backtestSpec.mjs';
import { openDb } from '../server/lib/db.mjs';

const prices = { requested: ['A', 'SPY'], bars: { A: [[20000, 10, 11]], SPY: [[20000, 20, 21]] } };
test('successful loading never certifies point-in-time history', () => {
  const r = assessResearchDataValidity({ source: 'form4', signals: [{ signalDate: '2025-01-01' }], coverage: { completeness: 'complete' }, prices });
  assert.equal(r.timing.sourceDate, 1);
  assert.equal(r.timing.independentlyVerified, 0);
  assert.equal(r.strictHistoricalTradability.eligible, false);
  assert.equal(r.sourceCoverage.certification, 'not-certified');
  assert.equal(r.priceCoverage.sessionCompleteness, 'not-verified');
  assert.throws(() => requireStrictHistoricalTradability(r), /not established/);
});
test('importer assertions and forged eligibility cannot unlock strict claims', () => {
  const r = assessResearchDataValidity({ source: 'dataset', signals: [{ availabilityBasis: 'independently-verified' }], prices });
  assert.equal(r.timing.assertedOrUnknown, 1);
  assert.throws(() => requireStrictHistoricalTradability({ strictHistoricalTradability: { eligible: true } }), /not established/);
});
test('contract signals explicitly carry assumed publication and source sampling limits', () => {
  const out = contractSignals({ rows: [{ id: '1', date: '2025-01-01', symbol: 'A', amount: 10 }], filters: cleanFilters({}), sectorOf: () => '' });
  assert.equal(out.signals[0].availabilityBasis, 'assumed-publication-lag');
  const r = assessResearchDataValidity({ source: 'contracts', signals: out.signals, coverage: { completeness: 'sample' } });
  assert.equal(r.timing.assumedLag, 1);
  assert.ok(r.strictHistoricalTradability.blockers.includes('assumed-publication'));
});
test('records known missing, current committee selection and future hearings remain visible', () => {
  const r = assessResearchDataValidity({ source: 'congress', filters: { nearHearingDays: 7 }, coverage: { progress: { house: { failed: 118, paper: 3 } }, building: true } });
  assert.equal(r.sourceCoverage.gaps.find(g => g.code === 'house-unparsed').count, 118);
  assert.ok(r.strictHistoricalTradability.blockers.includes('future-hearing'));
  assert.ok(r.strictHistoricalTradability.blockers.includes('current-committee'));
});
test('price audit records absent, stale, malformed and duplicate histories without certifying loaded series', () => {
  const r = assessPriceCoverage({ requested: ['A', 'B'], bars: { A: [[20000, 10, 11], [20000, null, 12]] }, stale: ['A'], missing: ['B'] });
  assert.deepEqual(r.absent, ['B']);
  assert.equal(r.series[0].invalidRows, 1);
  assert.deepEqual(r.stale, ['A']);
  assert.equal(r.delistedCoverage, 'not-certified');
});
test('built-in Form 4 source publishes assessment in its frozen input context', async () => {
  const previousCache = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ':memory:';
  const db = openDb(fileURLToPath(new URL('..', import.meta.url)));
  try {
    const out = await form4Source(db, cleanFilters({}), { history: async () => ({ items: [{id:'f',symbol:'A',person:'X',code:'P',side:'buy',filed:'2025-01-02',traded:'2025-01-01',value:100}], filings:{wanted:2,read:1,failed:1,pending:0},coverage:{shortList:[],capped:[]},store:{coveredFrom:'2024-01-01',amended:2},issuers:1 }) });
    assert.equal(out.context.dataValidity.timing.sourceDate, 1);
    assert.ok(out.context.dataValidity.sourceCoverage.gaps.some(g => g.code === 'filings-failed'));
    assert.equal(out.context.dataValidity.sourceCoverage.store.amended, 2);
    assert.ok(out.context.notes.some(n => n.id === 'f4failed'));
  } finally { db.close(); if (previousCache === undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE = previousCache; }
});

test('runtime caps and auxiliary samples are explicit without mislabeling ordinary side filtering', () => {
  const r = assessResearchDataValidity({ source: 'congress', coverage: { selection: { matched: 1000, eligible: 900, selected: 100, capped: true }, auxiliary: { contracts: { completeness: 'sample' } } } });
  assert.ok(r.strictHistoricalTradability.blockers.includes('run-selection-cap'));
  assert.ok(r.strictHistoricalTradability.blockers.includes('contract-filter-sample'));
  assert.equal(r.sourceCoverage.selection.selected, 100);
  const uncapped = assessResearchDataValidity({ coverage: { selection: { eligible: 100, selected: 50, capped: false } } });
  assert.ok(!uncapped.strictHistoricalTradability.blockers.includes('run-selection-cap'));
});

test('bulk store start gaps and excluded amendment lines are recorded even with no issuer caps', () => {
  const r = assessResearchDataValidity({ source: 'form4', coverage: { from: '2020-01-01', store: { coveredFrom: '2024-01-01', amended: 9 }, providerCoverage: { capped: [], shortList: [] } } });
  assert.ok(r.strictHistoricalTradability.blockers.includes('store-start-gap'));
  assert.equal(r.sourceCoverage.gaps.find(g => g.code === 'amendment-lines-excluded').count, 9);
  assert.equal(r.sourceCoverage.store.coveredFrom, '2024-01-01');
});

test('annual index read failure is preserved and assessed as missing source enumeration', async () => {
  const { readHouseIndexYear } = await import('../server/domain/positions/congress.mjs');
  const failure = await readHouseIndexYear(null, 2025, async () => { throw Error('Fixture unavailable'); });
  assert.deepEqual(failure, { ok: false, year: 2025, error: 'Fixture unavailable' });
  const empty = await readHouseIndexYear(null, 2026, async () => '');
  assert.equal(empty.ok, false);
  const success = await readHouseIndexYear(null, 2024, async () => 'index header');
  assert.equal(success.ok, true);
  const r = assessResearchDataValidity({ source: 'congress', coverage: { progress: { house: { indexFailures: [failure] } }, failures: ['Fixture unavailable'] } });
  assert.ok(r.sourceCoverage.gaps.some(g => g.code === 'house-index-failures' && g.count === 1));
  assert.ok(r.sourceCoverage.gaps.some(g => g.code === 'feed-failures' && g.count === 1));
});
