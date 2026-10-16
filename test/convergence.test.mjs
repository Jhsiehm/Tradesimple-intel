import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanConvergence, combineSignals, runConvergence } from '../shared/convergence.mjs';
import { dayOf } from '../shared/backtest.mjs';
import { openDb } from '../server/lib/db.mjs';
import { putRun, saveExperiment, getRun } from '../server/domain/research-store.mjs';
import { ENGINE, replayRun, exportRun } from '../server/domain/research-replay.mjs';
import { createPlan, evaluatePlan, getPlan, listPlans } from '../server/domain/convergence.mjs';
const spec = () => cleanConvergence({ from: '2025-01-01', split: '2025-04-01', to: '2025-06-30', universe: 'AAPL', windowDays: 7, embargoDays: 7, rules: { holdDays: 10 } });
const sig = (id, date, side = 'buy') => ({ id, signalDate: date, tradeDate: date, symbol: 'AAPL', side });
const sources = () => [{ id: 'a', label: 'A', signals: [sig('a1', '2025-01-05'), sig('a2', '2025-04-05'), sig('a3', '2025-03-22')] }, { id: 'b', label: 'B', signals: [sig('b1', '2025-01-08'), sig('b2', '2025-04-08'), sig('b3', '2025-03-23')] }];
const bars = () => Array.from({ length: 181 }, (_, i) => [dayOf('2025-01-01') + i, 100 + i, 101 + i]);
const input = () => ({ kind: 'convergence', phase: 'evaluation', spec: spec(), sources: sources(), bars: { AAPL: bars() }, benchBars: { SPY: bars().map(b => [b[0], 100, 100]) } });
function dbAt() { const prior = process.env.INTEL_CACHE; process.env.INTEL_CACHE = ':memory:'; try { return openDb(decodeURIComponent(new URL('..', import.meta.url).pathname)); } finally { if (prior === undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE = prior; } }
function fixtures(db) {
  const i = input();
  return i.sources.map((s, n) => saveExperiment(db, { title: s.label, runId: putRun(db, { engine: ENGINE, inputs: { signals: s.signals, bars: i.bars, benchBars: i.benchBars }, provenance: { matchedSignals: s.signals }, result: { ok: true, spec: { source: ['congress', 'form4'][n], filters: {} } } }) }).id);
}
test('confirmation waits for last public date, deduplicates daily votes, and is order independent', () => {
  const ss = sources(); ss[0].signals.push(sig('duplicate', '2025-01-05'));
  const opts = { ...spec(), to: '2025-03-24' };
  const out = combineSignals(ss, [0, 1], opts);
  assert.equal(out.signals[0].signalDate, '2025-01-08'); assert.equal(out.counts.duplicateDailyVotes, 1);
  assert.deepEqual(combineSignals(ss.map(s => ({ ...s, signals: s.signals.reverse() })), [0, 1], opts), out);
  assert.equal(combineSignals(ss, [0, 1], { ...opts, windowDays: 1 }).signals.length, 1);
  ss[1].signals = ss[1].signals.map(s => ({ ...s, side: 'sell' }));
  assert.equal(combineSignals(ss, [0, 1], { ...opts, sides: 'both' }).signals.length, 0);
});
test('holdout prices and signals cannot change development; boundaries purge positions and reset confirmation', () => {
  const i = input(), before = runConvergence(i);
  assert.equal(before.periods.development.variants.find(v => v.id === 'combined').counts.executed, 1);
  assert.ok(before.periods.development.variants.find(v => v.id === 'combined').counts.excluded > 0);
  i.bars.AAPL = i.bars.AAPL.map(b => b[0] >= dayOf(i.spec.split) ? [b[0], b[1] * 2, b[2] * 3] : b);
  i.sources[0].signals.push(sig('future', '2025-05-05'));
  assert.deepEqual(runConvergence(i).periods.development, before.periods.development);
  i.sources[0].signals = [sig('prior', '2025-03-31')]; i.sources[1].signals = [sig('later', '2025-04-02')];
  assert.equal(runConvergence(i).periods.holdout.variants.find(v => v.id === 'combined').counts.decisions, 0);
  assert.equal(runConvergence({ ...i, phase: 'development' }).periods.holdout, undefined);
});
test('three sources produce individual baselines, combined and three leave-one-out variants', () => {
  const i = input(); i.sources.push({ id: 'c', label: 'C', signals: [sig('c1', '2025-01-09')] });
  const p = runConvergence(i).periods.development;
  assert.equal(p.variants.length, 7); assert.equal(p.ablations.length, 3);
  assert.equal(p.variants.find(v => v.id === 'combined').result.trades[0].entry, '2025-01-10');
  assert.ok(p.variants.every(v => v.windowStats.benchmarkReturn === p.variants[0].windowStats.benchmarkReturn));
});
test('configuration refuses invalid dates, insufficient windows and unsupported comparisons', () => {
  for (const change of [{ split: '2025-02-30' }, { universe: '' }, { windowDays: -1 }, { embargoDays: 0 }, { rules: { holdDays: 180 } }, { rules: { benchmark: 'SECTOR' } }]) assert.throws(() => cleanConvergence({ ...spec(), ...change }));
});
test('locked plans persist exact inputs, evaluate once, track exposure, and replay offline', () => {
  const db = dbAt(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsi-convergence-'));
  try {
    const experimentIds = fixtures(db), request = { title: 'Fixture plan', experimentIds, spec: spec() };
    const p = createPlan(db, request);
    assert.equal(p.report.periods.holdout, undefined); assert.equal(p.priorEvaluations, 0);
    assert.throws(() => db.prepare('UPDATE research.convergence_plans SET body=?').run('{}'), /immutable/);
    const evaluated = evaluatePlan(db, p.id);
    assert.ok(evaluated.report.periods.holdout); assert.equal(evaluatePlan(db, p.id).runId, evaluated.runId);
    assert.equal(getPlan(db, p.id).evaluated, true); assert.equal(listPlans(db).length, 1);
    assert.equal(createPlan(db, request).priorEvaluations, 1);
    const run = getRun(db, evaluated.runId); assert.equal(replayRun(run).matches, true);
    fs.writeFileSync(path.join(dir, 'run.zip'), exportRun(db, run));
    const unzip = spawnSync('unzip', ['-q', 'run.zip'], { cwd: dir, encoding: 'utf8' }); assert.equal(unzip.status, 0, unzip.stderr);
    const replay = spawnSync(process.execPath, ['replay.mjs'], { cwd: dir, encoding: 'utf8' }); assert.equal(replay.status, 0, replay.stderr); assert.equal(JSON.parse(replay.stdout).matches, true);
    assert.throws(() => createPlan(db, { ...request, experimentIds: [experimentIds[0], experimentIds[0]] }), /distinct/);
    assert.throws(() => createPlan(db, { ...request, spec: { ...spec(), universe: 'MSFT' } }), /price coverage/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('weekly uncertainty intervals are deterministic and zero-trade strategies retain common benchmark', () => {
  const i = input(); i.sources = i.sources.map(s => ({ ...s, signals: Array.from({ length: 12 }, (_, n) => sig(`${s.id}-${n}`, `2025-01-${String(n + 2).padStart(2, '0')}`)) }));
  const a = runConvergence(i), b = runConvergence(i);
  assert.deepEqual(a, b); assert.ok(a.periods.development.variants.every(v => v.bootstrap && Number.isFinite(v.bootstrap.low)));
  const h = a.periods.holdout; assert.ok(h.variants.every(v => v.counts.executed === 0 && v.windowStats.strategyReturn === 0));
});

test('convergence runs cannot enter single-source save and legacy export paths', async () => {
  const { replicateSpec } = await import('../server/domain/backtest/replicate.mjs');
  const db = dbAt();
  try {
    const plan = createPlan(db, { title: 'Endpoint isolation', experimentIds: fixtures(db), spec: spec() });
    const out = await replicateSpec(db, null, { runId: plan.runId });
    assert.equal(out.ok, false); assert.match(out.error, /frozen comparison export/);
    assert.throws(() => saveExperiment(db, { title: 'Wrong record type', runId: plan.runId }), /locked plan/);
  } finally { db.close(); }
});
test('notebook evidence remains pinned when a convergence holdout is evaluated later', async () => {
  const { saveNotebook, getNotebook } = await import('../server/domain/notebooks.mjs');
  const db = dbAt();
  try {
    const plan = createPlan(db, { title: 'Cited plan', experimentIds: fixtures(db), spec: spec() });
    const n = saveNotebook(db, { title: 'Pinned evidence', status: 'draft', tags: [], followups: [], evidence: [{ kind: 'convergence', id: plan.id }] });
    const evaluated = evaluatePlan(db, plan.id); assert.notEqual(evaluated.runId, plan.runId);
    const edited = saveNotebook(db, { ...n, baseRevision: 1, hypothesis: 'Revised question' }, n.id);
    assert.equal(edited.evidence[0].runId, plan.runId);
    assert.equal(getNotebook(db, n.id).evidence[0].phase, 'development only');
  } finally { db.close(); }
});
