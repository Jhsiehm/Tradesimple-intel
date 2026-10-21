import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { policyStudyProtocolInput, policyStudyEvidence, POLICY_FIXTURE_NOW } from './fixtures/policyStudy.mjs';
import { createPolicyInvestigation, importPolicyEvidence, evaluatePolicyInvestigation,
  getPolicyInvestigation, collectPolicyInvestigation, cancelPolicyCollection } from '../server/domain/policy/investigations.mjs';
import { getPolicyRecord } from '../server/domain/policy/store.mjs';
import { preparePolicyImport, mergePolicyRows, assertPolicyEvidenceSize } from '../server/domain/policy/imports.mjs';
import { exportPolicyArchive, exportPolicyInvestigation, replayPolicyInvestigation } from '../server/domain/policy/replay.mjs';
import { runPolicyMethod } from '../server/domain/policy/worker.mjs';

const options = { now: POLICY_FIXTURE_NOW };
async function complete(db) {
  let saved = await createPolicyInvestigation(db, policyStudyProtocolInput(), options);
  for (const [kind, records] of Object.entries(policyStudyEvidence())) {
    saved = await importPolicyEvidence(db, saved.id, { kind, records, revision: saved.revision }, options);
  }
  return saved;
}

test('policy lifecycle locks protocol, appends assertions, freezes exact inputs and replays offline', async () => {
  const db = new DatabaseSync(':memory:'), folder = mkdtempSync(join(tmpdir(), 'policy-replay-'));
  try {
    const saved = await complete(db);
    assert.equal(saved.readiness.ready, true);
    assert.equal(saved.protocol.registeredAt, POLICY_FIXTURE_NOW);
    assert.equal(saved.evidence.events[0].availabilityBasis, 'importer-asserted');
    assert.equal(saved.evidence.newsCoverage[0].basis, 'researcher-asserted; not independently audited');
    assert.equal(saved.evidence.sources[0].payload, undefined, 'detail view hides duplicate raw payloads');
    const evaluated = await evaluatePolicyInvestigation(db, saved.id, { ...options, revision: saved.revision });
    assert.equal(evaluated.result.status, 'conditional-analysis');
    assert.equal(evaluated.result.rows.length, 1);
    assert.ok(Math.abs(evaluated.result.rows[0].returns.policyNet - 0.099) < 1e-12);
    assert.equal(evaluated.evaluation.inputs, undefined, 'view does not duplicate full frozen inputs');
    assert.equal(evaluated.result.asOf, POLICY_FIXTURE_NOW);
    assert.equal((await replayPolicyInvestigation(db, saved.id)).matches, true);
    assert.equal((await evaluatePolicyInvestigation(db, saved.id, options)).revision, evaluated.revision, 'identical timestamp and inputs are idempotent');
    const later = await evaluatePolicyInvestigation(db, saved.id, { now: '2026-10-20T12:01:00Z' });
    assert.ok(later.revision > evaluated.revision, 'explicit evaluation freezes a fresh as-of time');
    assert.equal(getPolicyRecord(db, saved.id, evaluated.revision).result.asOf, POLICY_FIXTURE_NOW, 'old report remains intact');
    assert.throws(() => db.prepare('UPDATE research.policy_revisions SET body=? WHERE id=?').run('{}', saved.id), /immutable/);
    assert.ok(exportPolicyInvestigation(db, saved.id).record.evaluation.inputs.evidence.sources[0].payload);
    writeFileSync(join(folder, 'study.zip'), exportPolicyArchive(db, saved.id));
    const unpack = spawnSync('unzip', ['-q', 'study.zip'], { cwd: folder, encoding: 'utf8' });
    assert.equal(unpack.status, 0, unpack.stderr);
    const replay = spawnSync(process.execPath, ['replay.mjs'], { cwd: folder, encoding: 'utf8' });
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).matches, true);
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('append imports are atomic, exact duplicates idempotent, and stale/conflicting revisions refused', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const saved = await createPolicyInvestigation(db, policyStudyProtocolInput(), options);
    const request = { kind: 'events', records: policyStudyEvidence().events, revision: saved.revision };
    const imported = await importPolicyEvidence(db, saved.id, request, options);
    const repeated = await importPolicyEvidence(db, saved.id, { ...request, revision: imported.revision }, { now: '2026-10-20T12:02:00Z' });
    assert.equal(repeated.revision, imported.revision);
    await assert.rejects(importPolicyEvidence(db, saved.id, request, options), /changed/);
    await assert.rejects(importPolicyEvidence(db, saved.id, { ...request, revision: imported.revision, records: [{ ...request.records[0], publicAt: '2024-01-08T15:00:00Z' }] }, options), /Conflicting/);
    assert.equal(getPolicyInvestigation(db, saved.id).revision, imported.revision);
    const old = getPolicyRecord(db, saved.id, saved.revision);
    assert.equal(old.evidence.events.length, 0);
  } finally { db.close(); }
});

test('simultaneous imports cannot overwrite each other after worker validation', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const saved = await createPolicyInvestigation(db, policyStudyProtocolInput(), options), data = policyStudyEvidence();
    const outcomes = await Promise.allSettled(['events', 'news'].map(kind => importPolicyEvidence(db, saved.id, { kind, records: data[kind], revision: saved.revision }, options)));
    assert.equal(outcomes.filter(out => out.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(out => out.status === 'rejected').length, 1);
    assert.equal(getPolicyInvestigation(db, saved.id).revision, saved.revision + 1);
  } finally { db.close(); }
});

test('collection observation clock stays live and cancellation preserves completed receipts', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    let current = POLICY_FIXTURE_NOW;
    const saved = await createPolicyInvestigation(db, policyStudyProtocolInput(), { now: () => current });
    let started;
    const collecting = collectPolicyInvestigation(db, saved.id, { now: () => current, collect: async (_db, _protocol, opts) => {
      current = '2026-10-20T12:00:05.000Z';
      assert.equal(opts.now(), current, 'observation time is not the start of request');
      started?.();
      await new Promise(resolve => opts.signal.addEventListener('abort', resolve, { once: true }));
      return { events: [], news: [], newsCoverage: [], sources: [{ provider: 'Fixture', contentHash: 'preserved', payload: { records: [] } }], gaps: [], manifest: { status: 'cancelled' } };
    } });
    assert.equal(cancelPolicyCollection(db, saved.id).stopping, true);
    const partial = await collecting;
    assert.equal(partial.status, 'partial');
    assert.equal(partial.evidence.sources.length, 1);
    assert.equal(partial.evidence.manifest.status, 'cancelled');
    const evaluated = await evaluatePolicyInvestigation(db, saved.id, { now: current });
    assert.equal(evaluated.result.executed, false);
    assert.equal((await replayPolicyInvestigation(db, saved.id)).matches, true);
  } finally { db.close(); }
});

test('imports reject invalid dates, encoded credentials, and unscoped coverage assertions', () => {
  const event = policyStudyEvidence().events[0];
  assert.throws(() => preparePolicyImport('events', [{ ...event, eventAt: '2026-02-30' }], POLICY_FIXTURE_NOW), /eventAt/);
  assert.throws(() => preparePolicyImport('events', [{ ...event, sourceUrl: 'https://example.test/?api%5fkey=private' }], POLICY_FIXTURE_NOW), /cited/);
  assert.throws(() => preparePolicyImport('newsCoverage', [{ archive: 'a', from: '2024-01-01', to: '2024-01-02', complete: true }], POLICY_FIXTURE_NOW), /scope/);
  const first = { archive: 'a', billId: 'hr-118-1', from: '2024-01-01', to: '2024-01-02', complete: true };
  assert.equal(mergePolicyRows('newsCoverage', [first], [{ ...first, billId: 'hr-118-2' }]).length, 2);
  assert.throws(() => assertPolicyEvidenceSize({ raw: 'x'.repeat(16 * 1024 * 1024) }), /16 MiB/);
});

test('analysis workers support cancellation and refuse unknown operations', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runPolicyMethod('evaluate', {}, {}, { signal: controller.signal }), /cancelled/);
  await assert.rejects(runPolicyMethod('arbitrary-code', {}, {}), /Unknown/);
});

test('development watch dependency messages cannot masquerade as analysis results', async () => {
  const previous = process.env.WATCH_REPORT_DEPENDENCIES;
  process.env.WATCH_REPORT_DEPENDENCIES = '1';
  try {
    const result = await runPolicyMethod('readiness', { ...policyStudyProtocolInput(), registeredAt: POLICY_FIXTURE_NOW }, policyStudyEvidence(), { asOf: POLICY_FIXTURE_NOW });
    assert.equal(result.ready, true);
    assert.equal(result.counts.completedPairs, 1);
  } finally {
    if (previous === undefined) delete process.env.WATCH_REPORT_DEPENDENCIES;
    else process.env.WATCH_REPORT_DEPENDENCIES = previous;
  }
});
