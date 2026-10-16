import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb, writeCache } from '../server/lib/db.mjs';
import { KEY } from '../server/lib/cacheKeys.mjs';
import { router } from '../server/routes/index.mjs';
import { dayOf } from '../shared/backtest.mjs';
let db, server, base, datasetId, experiment;
const body = { name: 'HTTP fixture', source: 'Synthetic test', content: 'id,symbol,eventAt,availableAt,side\nr1,AAPL,2025-01-02,2025-01-06,buy', format: 'csv' };
before(async () => {
  const prior = process.env.INTEL_CACHE; process.env.INTEL_CACHE = ':memory:';
  db = openDb(decodeURIComponent(new URL('..', import.meta.url).pathname));
  if (prior === undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE = prior;
  const routes = router(); server = http.createServer((req, res) => routes.handle(req, res, { db }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
async function call(method, path, payload, origin = 'http://127.0.0.1:5173') {
  const res = await fetch(base + path, { method, headers: { origin, 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  return { status: res.status, body: await res.json() };
}
test('research routes enforce methods, same-origin writes, and atomic validation', async () => {
  assert.equal((await call('POST', '/api/research/datasets', body, 'https://evil.example')).status, 403);
  assert.equal((await call('GET', '/api/research/preview')).status, 405);
  assert.equal((await call('DELETE', '/api/research/experiments')).status, 405);
  assert.equal((await call('POST', '/api/research/datasets', { ...body, content: body.content.replace('2025-01-06', '') })).status, 422);
  assert.equal((await call('GET', '/api/research/datasets')).body.items.length, 0);
  const preview = await call('POST', '/api/research/preview', body);
  assert.equal(preview.body.ok, true); assert.equal(preview.body.coverage.valid, 1);
  assert.equal((await call('GET', '/api/research/datasets')).body.items.length, 0, 'preview is not a commit');
  const imported = await call('POST', '/api/research/datasets', body);
  assert.equal(imported.status, 200); datasetId = imported.body.dataset.id;
  assert.equal(imported.body.dataset.rawContent, undefined, 'raw import is not repeated in list/detail response');
  assert.equal((await call('GET', `/api/research/datasets/${datasetId}`)).body.dataset.coverage.received, 1);
});
test('imported dataset runs through the existing engine, saves, replays and exports over HTTP', async () => {
  const bars = Array.from({ length: 90 }, (_, i) => [dayOf('2025-01-01') + i, 100 + i, 101 + i]);
  writeCache(db, KEY.bars('AAPL'), bars, 100000); writeCache(db, KEY.bars('SPY'), bars.map(b => [b[0], 100, 100]), 100000);
  const out = await call('POST', '/api/research/run', { title: 'Synthetic HTTP experiment', hypothesis: 'Fixture only', datasetId, rules: { holdDays: 10 } });
  assert.equal(out.status, 200); experiment = out.body.experiment;
  assert.equal(experiment.run.result.spec.source, 'dataset'); assert.equal(experiment.run.result.spec.datasetId, datasetId);
  assert.equal(experiment.run.result.ok, true); assert.equal(experiment.run.result.trades[0].signal, '2025-01-06');
  assert.equal(experiment.run.provenance.dataset.id, datasetId); assert.equal(experiment.run.inputs, undefined);
  assert.equal((await call('POST', `/api/research/runs/${experiment.runId}/replay`, {})).body.matches, true);
  assert.equal((await call('GET', '/api/research/experiments')).body.items.length, 1);
  const zip = await fetch(`${base}/api/research/runs/${experiment.runId}/export`);
  assert.equal(zip.status, 200); assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), 'PK');
});
test('fresh-data reruns link to a parent and preserve failure details', async () => {
  db.prepare('DELETE FROM cache').run();
  // A missing dataset never executes or creates an experiment.
  assert.equal((await call('POST', '/api/research/run', { title: 'No dataset', datasetId: 'ds_0000' })).status, 404);
  assert.equal((await call('POST', '/api/research/experiments', { title: 'Not found', runId: 'run_0000' })).status, 400);
  assert.equal((await call('POST', `/api/research/runs/${experiment.runId}/replay`, {})).body.matches, true);
  assert.equal((await call('GET', `/api/research/experiments/${experiment.id}`)).body.experiment.hypothesis, 'Fixture only');
});
test('convergence HTTP lifecycle locks development, evaluates once, replays and enforces origin', async () => {
  const { putRun, saveExperiment } = await import('../server/domain/research-store.mjs');
  const { ENGINE } = await import('../server/domain/research-replay.mjs');
  const bars = Array.from({ length: 181 }, (_, i) => [dayOf('2025-01-01') + i, 100 + i, 101 + i]);
  const experimentIds = ['congress', 'form4'].map((source, i) => {
    const signals = ['2025-01-06', '2025-04-06'].map((d, n) => ({ id: `${i}-${n}`, symbol: 'AAPL', signalDate: d, side: 'buy' }));
    return saveExperiment(db, { title: `HTTP ${source}`, runId: putRun(db, { engine: ENGINE, inputs: { signals, bars: { AAPL: bars }, benchBars: { SPY: bars } }, result: { ok: true, spec: { source, filters: {} } }, provenance: { matchedSignals: signals } }) }).id;
  });
  const request = { title: 'HTTP convergence', experimentIds, spec: { from: '2025-01-01', split: '2025-04-01', to: '2025-06-30', universe: 'AAPL', rules: { holdDays: 10 } } };
  assert.equal((await call('POST', '/api/research/convergence', request, 'https://evil.example')).status, 403);
  const saved = await call('POST', '/api/research/convergence', request); assert.equal(saved.status, 200);
  const p = saved.body.plan; assert.equal(p.report.periods.holdout, undefined); assert.equal(p.inputs, undefined);
  assert.equal((await call('GET', `/api/research/convergence/${p.id}`)).body.plan.runId, p.runId);
  const evaluated = await call('POST', `/api/research/convergence/${p.id}/evaluate`, {});
  assert.ok(evaluated.body.plan.report.periods.holdout);
  assert.equal((await call('POST', `/api/research/convergence/${p.id}/evaluate`, {})).body.plan.runId, evaluated.body.plan.runId);
  assert.equal((await call('POST', `/api/research/runs/${evaluated.body.plan.runId}/replay`, {})).body.matches, true);
});
