import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDb, writeCache } from '../server/lib/db.mjs';
import { KEY } from '../server/lib/cacheKeys.mjs';
import { runSpec } from '../server/domain/backtest/index.mjs';
import { replicateSpec } from '../server/domain/backtest/replicate.mjs';
import { getRun, saveExperiment, getExperiment, listExperiments, getDataset, researchStore, hashOf } from '../server/domain/research-store.mjs';
import { ENGINE, replayRun, exportRun } from '../server/domain/research-replay.mjs';
import { parseCsv, timestamp, prepareDataset, importDataset, datasetSource } from '../server/domain/research-events.mjs';
import { readConnector, listConnectors } from '../server/domain/research-connectors.mjs';
import { dayOf } from '../shared/backtest.mjs';
const root = new URL('..', import.meta.url).pathname;
function dbAt(file = ':memory:') { const prior = process.env.INTEL_CACHE; process.env.INTEL_CACHE = file; try { return openDb(decodeURIComponent(root)); } finally { if (prior === undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE = prior; } }
const csv = 'id,symbol,eventAt,availableAt,side,sourceUrl,value\nfiling-1,AAPL,2025-01-02,2025-01-06,buy,https://example.org/filing-1,1000\n';
const request = (over = {}) => ({ name: 'Research fixtures', source: 'Synthetic test fixture', format: 'csv', content: csv, ...over });
const bars = Array.from({ length: 100 }, (_, i) => [dayOf('2025-01-01') + i, 100 + i, 101 + i]);
const priced = () => ({ bars: { AAPL: bars, SPY: bars.map(b => [b[0], 100, 100]) }, pending: [], stale: [], cached: 2, fetched: 0, missing: [], oldestStoredAt: Date.now() });
async function fixture(db, options = {}) {
  const dataset = importDataset(db, request()).dataset;
  const result = await runSpec(db, { source: 'dataset', datasetId: dataset.id, rules: { holdDays: 10 } }, { sourceFn: async () => datasetSource(dataset), loadBarsFn: async () => priced(), ...options });
  return { result, dataset, run: getRun(db, result.runId) };
}

test('CSV preserves quoted newlines, commas, BOM and escaped quotes; malformed records fail', () => {
  const p = parseCsv('\uFEFFid,note\r\n1,"a,b\n""quoted"""\r\n');
  assert.equal(p.rows[0].note, 'a,b\n"quoted"');
  for (const bad of ['id,id\n1,2', 'id,x\n1', 'id\n"open', 'id\n"a"b']) assert.throws(() => parseCsv(bad));
});
test('timestamp contract rejects impossible dates, ambiguous local time and missing availability', () => {
  assert.equal(timestamp('2025-02-29'), null);
  assert.equal(timestamp('2024-02-29').precision, 'day');
  assert.equal(timestamp('2025-01-01T12:00:00'), null);
  assert.equal(timestamp('2025-01-01T12:00:00Z').precision, 'instant');
  const db = dbAt();
  try { const p = prepareDataset(db, request({ content: csv.replace('2025-01-06', '') })); assert.equal(p.ok, false); assert.ok(p.errors.some(e => e.field === 'availableAt')); } finally { db.close(); }
});
test('imports validate exact entities, duplicate IDs, sides, dates and sizes without partial writes', () => {
  const db = dbAt();
  try {
    for (const content of [csv.replace('AAPL', 'NOTAREALTICKER'), csv + csv.split('\n')[1] + '\n', csv.replace(',buy,', ',hold,'), csv.replace('2025-01-06', '2024-01-01'), csv.replace(',1000', ',-1')]) {
      const p = importDataset(db, request({ content })); assert.equal(p.ok, false); assert.ok(p.errorCount > 0);
    }
    researchStore(db); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research.datasets').get().n, 0);
  } finally { db.close(); }
});
test('column mapping and JSON ingestion preserve originals, timestamps, source and current identity basis', () => {
  const db = dbAt();
  try {
    const out = importDataset(db, request({ format: 'json', content: JSON.stringify({ items: [{ ref: 'r1', ticker: 'aapl', happened: '2025-01-02', public: '2025-01-06T18:05:00Z', side: 'buy' }] }), mapping: { id: 'ref', symbol: 'ticker', eventAt: 'happened', availableAt: 'public' } }));
    assert.equal(out.ok, true); const event = out.dataset.events[0];
    assert.equal(event.entity.securityId, 'ticker:AAPL'); assert.equal(event.entity.companyId, 'cik:320193');
    assert.equal(event.availableAt, '2025-01-06T18:05:00.000Z'); assert.equal(event.original.ref, 'r1');
    assert.match(event.availabilityBasis, /not independently/); assert.equal(out.dataset.coverage.missingSourceUrls, 1);
  } finally { db.close(); }
});
test('dataset versions deduplicate identical content and cannot be overwritten or deleted', () => {
  const db = dbAt();
  try {
    const a = importDataset(db, request()).dataset, b = importDataset(db, request()).dataset;
    assert.equal(a.id, b.id);
    const c = importDataset(db, request({ content: csv.replace(',1000', ',2000') })).dataset;
    assert.equal(c.version, 2); assert.notEqual(c.contentHash, a.contentHash);
    assert.equal(getDataset(db, a.id).events[0].value, 1000);
    assert.throws(() => db.prepare('DELETE FROM research.datasets WHERE id=?').run(a.id), /immutable/);
    assert.throws(() => db.prepare('UPDATE research.datasets SET name=? WHERE id=?').run('changed', a.id), /immutable/);
  } finally { db.close(); }
});
test('frozen run and saved experiment survive cache deletion, database close and restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsi-research-')); const file = path.join(dir, 'cache.sqlite');
  let db = dbAt(file);
  try {
    const { result, run } = await fixture(db);
    assert.equal(replayRun(run).matches, true);
    const experiment = saveExperiment(db, { runId: result.runId, title: 'Frozen fixture', hypothesis: 'A test, not a real claim' });
    assert.equal(saveExperiment(db, { runId: result.runId, title: 'Duplicate save' }).id, experiment.id);
    assert.throws(() => db.prepare('UPDATE research.runs SET status=? WHERE id=?').run('changed', result.runId), /immutable/);
    db.close(); db = null;
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
    db = dbAt(file);
    const saved = getExperiment(db, experiment.id);
    assert.equal(saved.run.inputHash, hashOf(saved.run.inputs));
    assert.equal(replayRun(saved.run).matches, true); assert.equal(listExperiments(db).length, 1);
  } finally { db?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('cache mutation cannot change a frozen export; a rerun creates distinct inputs and lineage', async () => {
  const db = dbAt();
  try {
    const a = await fixture(db), parent = saveExperiment(db, { runId: a.result.runId, title: 'First run' });
    const before = replicateSpec(db, null, { runId: a.result.runId });
    writeCache(db, KEY.bars('AAPL'), [[dayOf('2025-01-01'), 1, 1]], 10000);
    const after = await replicateSpec(db, null, { runId: a.result.runId });
    assert.deepEqual((await before).prices, after.prices);
    const b = await fixture(db, { loadBarsFn: async () => ({ ...priced(), bars: { ...priced().bars, AAPL: bars.map(x => [x[0], x[1] * 2, x[2] * 2]) } }) });
    assert.notEqual(a.run.inputHash, b.run.inputHash); assert.notEqual(a.result.runId, b.result.runId);
    const child = saveExperiment(db, { runId: b.result.runId, title: 'Rerun', parentId: parent.id }); assert.equal(child.parentId, parent.id);
    assert.equal(replayRun(getRun(db, a.result.runId)).matches, true);
  } finally { db.close(); }
});
test('partial and failed attempts are preserved and are not labelled complete', async () => {
  const db = dbAt();
  try {
    const { run } = await fixture(db, { loadBarsFn: async () => ({ ...priced(), pending: ['AAPL'], bars: { SPY: priced().bars.SPY } }) });
    assert.equal(run.result.building, true);
    assert.equal(db.prepare('SELECT status FROM research.runs WHERE id=?').get(run.id).status, 'partial');
    const failed = await runSpec(db, { source: 'congress' }, { sourceFn: async () => ({ error: 'Fixture source unavailable' }) });
    const saved = saveExperiment(db, { runId: failed.runId, title: 'Failed attempt' });
    assert.equal(saved.run.result.ok, false); assert.equal(saved.run.inputs, null);
    assert.throws(() => replayRun(saved.run), /no calculation inputs/);
  } finally { db.close(); }
});
test('offline archive contains its engine and validates checksums before replay', async () => {
  const db = dbAt(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsi-replay-'));
  try {
    const { run } = await fixture(db);
    fs.writeFileSync(path.join(dir, 'run.zip'), exportRun(db, run));
    const unpack = spawnSync('unzip', ['-q', 'run.zip'], { cwd: dir, encoding: 'utf8' }); assert.equal(unpack.status, 0, unpack.stderr);
    const replay = spawnSync(process.execPath, ['replay.mjs'], { cwd: dir, encoding: 'utf8' }); assert.equal(replay.status, 0, replay.stderr); assert.equal(JSON.parse(replay.stdout).matches, true);
    const evidence = JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8'));
    assert.equal(evidence.datasets[run.provenance.dataset.id].rawContent, csv);
    assert.equal(evidence.runs[run.id].inputHash, run.inputHash);
    fs.appendFileSync(path.join(dir, 'evidence.json'), ' ');
    const corrupted = spawnSync(process.execPath, ['replay.mjs'], { cwd: dir, encoding: 'utf8' }); assert.notEqual(corrupted.status, 0); assert.match(corrupted.stderr, /Checksum mismatch/);
    assert.throws(() => replayRun({ ...run, engineId: 'different-version' }), /engine has changed/);
    assert.equal(run.engineId, ENGINE.id);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
const config = { RESEARCH_API_CONNECTORS: JSON.stringify({ fixture: { url: 'https://example.org/records', tokenEnv: 'FIXTURE_TOKEN' } }), FIXTURE_TOKEN: 'a-secret-fixture' };
test('API connector pins vetted public DNS, uses server credential and returns JSON for normal validation', async () => {
  let calls = 0;
  assert.deepEqual(listConnectors(config), [{ id: 'fixture', label: 'fixture', resumable: false }]);
  const out = await readConnector('fixture', { env: config, lookup: async () => [{ address: '93.184.216.34', family: 4 }], request: async (url, options) => { calls++; assert.equal(url.protocol, 'https:'); assert.equal(options.addresses[0].address, '93.184.216.34'); assert.equal(options.headers.authorization, 'Bearer a-secret-fixture'); return new Response('[{"id":"one"}]'); } });
  assert.equal(calls, 1); assert.equal(out.format, 'json'); assert.equal(out.source, 'API connector: fixture'); assert.ok(!JSON.stringify(out).includes(config.FIXTURE_TOKEN));
});
test('API connector refuses private DNS, redirects, oversized bodies and credential echoes', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34' }];
  await assert.rejects(readConnector('fixture', { env: config, lookup: async () => [{ address: '127.0.0.1' }], request: async () => { assert.fail('must not connect'); } }), /public internet/);
  await assert.rejects(readConnector('fixture', { env: config, lookup: publicLookup, request: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1' } }) }), /redirects/);
  await assert.rejects(readConnector('fixture', { env: config, lookup: publicLookup, request: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }), /2 MiB/);
  await assert.rejects(readConnector('fixture', { env: config, lookup: publicLookup, request: async () => new Response(config.FIXTURE_TOKEN) }), /credential/);
  await assert.rejects(readConnector('fixture', { env: { RESEARCH_API_CONNECTORS: '{secret-broken' } }), error => !error.message.includes('secret-broken'));
  await assert.rejects(readConnector('__proto__', { env: config }), /configured/);
});

test('timing exclusions are frozen and cannot re-enter Convergence through matched signals', async () => {
  const db = dbAt();
  try {
    const dataset = importDataset(db, request()).dataset;
    const src = datasetSource(dataset);
    src.signals.push({ ...src.signals[0], id: 'future-record', signalDate: '2099-01-01' });
    const result = await runSpec(db, { source: 'dataset', datasetId: dataset.id }, { sourceFn: async () => src, loadBarsFn: async () => priced() });
    const run = getRun(db, result.runId);
    assert.equal(run.provenance.integrity.excluded, 1);
    assert.equal(run.provenance.integrity.exclusions[0].id, 'future-record');
    assert.deepEqual(run.provenance.coverage.signals, { matched: 2, timingEligible: 1, timingExcluded: 1, selected: 1 });
    assert.equal(run.provenance.coverage.source.kind, 'frozen-dataset');
    assert.equal(run.provenance.coverage.source.records.valid, 1);
    assert.equal(run.provenance.coverage.historicalCompleteness, 'not-certified');
    assert.equal(run.provenance.coverage.status, 'calculation-complete');
    assert.deepEqual(run.provenance.coverage.prices.loaded, ['AAPL', 'SPY']);
    assert.equal(run.provenance.matchedSignals.length, 1);
    assert.equal(run.inputs.signals.length, 1);
    assert.equal(replayRun(run).matches, true);
  } finally { db.close(); }
});
