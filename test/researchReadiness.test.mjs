import test from 'node:test';
import assert from 'node:assert/strict';
import { researchReadiness } from '../shared/researchReadiness.mjs';
const base = { ok: true, building: false, counts: { signals: 2, used: 1, tickers: 1, priced: 1 }, trades: [{ symbol: 'LMT', signal: '2025-02-01' }], caveats: { exclusions: {}, excludedSymbols: {} } };
test('unfinished history never becomes a zero-signal finding', () => {
 const out = researchReadiness({ ...base, building: true, counts: { signals: 0 } }, ['LMT']);
 assert.equal(out.status, 'building');
 assert.match(out.next, /not a finding/);
});
test('completed zero-signal retrieval remains distinct from failed or unknown', () => {
 assert.equal(researchReadiness(null).status, 'unchecked');
 assert.equal(researchReadiness({ ok: false }).status, 'failed');
 assert.equal(researchReadiness({ ...base, counts: { signals: 0 } }).status, 'no-signals');
});
test('missing benchmark or entry prices prevents review-ready status', () => {
 for (const reason of ['noPrice','notPriced','noBenchmark','beforePriceHistory','noBarAfterSignal','entryGap','badPrice']) {
  const out = researchReadiness({ ...base, caveats: { exclusions: { [reason]: 1 }, excludedSymbols: { [reason]: ['RTX'] } } }, ['LMT','RTX']);
  assert.equal(out.status, 'price-gaps'); assert.equal(out.priceGaps, 1); assert.match(out.tickers[1].status, /Excluded/);
 }
});
test('ticker without executed trades never inherits coverage from another name', () => {
 const out = researchReadiness(base, ['LMT','RTX','LMT']);
 assert.equal(out.status, 'review'); assert.equal(out.tickers.length, 2);
 assert.equal(out.tickers[0].first, '2025-02-01');
 assert.equal(out.tickers[1].first, null); assert.match(out.tickers[1].status, /unverified/);
});
test('unfinished trades are distinct from missing price coverage', () => {
 assert.equal(researchReadiness({ ...base, counts: { signals: 1, used: 0 }, caveats: { exclusions: { stillOpen: 1 } } }).status, 'no-trades');
});
test('completed but capped history remains an explicit source gap even with zero signals', () => {
 const out = researchReadiness({ ...base, counts: { signals: 0 }, caveats: { items: [{ id: 'f4capped', text: 'Earlier filings are missing.' }] } });
 assert.equal(out.status, 'source-gaps');
 assert.deepEqual(out.sourceWarnings, ['Earlier filings are missing.']);
});
