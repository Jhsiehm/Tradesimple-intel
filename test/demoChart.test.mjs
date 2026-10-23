import test from 'node:test';
import assert from 'node:assert/strict';
import { demoChartWindow } from '../shared/demoChart.mjs';
const bars = [1, 2, 3].map(day => ({ t: Date.UTC(2026, 9, day, 16), o: day, h: day + 2, l: day - 1, c: day + 1, v: 100 }));
const snapshot = { ok: true, bars, asOf: '2026-10-03T00:00:00Z', source: 'Test fixture' };
const options = { interval: '1d', from: bars[1].t, to: bars[2].t, adjusted: false, extended: false };
test('demo charts filter captured bars and preserve the source date', () => {
  const result = demoChartWindow(snapshot, options);
  assert.deepEqual(result.bars, bars.slice(1));
  assert.equal(result.asOf, snapshot.asOf);
  assert.equal(result.status, 'Historical snapshot');
  assert.equal(snapshot.bars.length, 3);
});
test('demo charts aggregate captured daily bars for monthly views', () => {
  const result = demoChartWindow(snapshot, { ...options, from: bars[0].t, interval: '1mo' });
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].v, 300);
  assert.equal(result.bars[0].c, 4);
});
test('demo charts do not fabricate unavailable settings or hide failed captures', () => {
  for (const extra of [{ interval: '5m' }, { adjusted: true }, { extended: true }]) {
    assert.equal(demoChartWindow(snapshot, { ...options, ...extra }).ok, false);
  }
  const error = { ok: false, error: 'Not captured' };
  assert.equal(demoChartWindow(error, options), error);
});
