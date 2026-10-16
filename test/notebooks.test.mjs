import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/lib/db.mjs';
import { saveNotebook, getNotebook, listNotebooks, notebookHistory } from '../server/domain/notebooks.mjs';
import { putRun, saveExperiment } from '../server/domain/research-store.mjs';
import { ENGINE } from '../server/domain/research-replay.mjs';
const root = decodeURIComponent(new URL('..', import.meta.url).pathname);
function dbAt(file = ':memory:') { const old = process.env.INTEL_CACHE; process.env.INTEL_CACHE = file; try { return openDb(root); } finally { if (old === undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE = old; } }
const draft = () => ({ title: 'Insider confirmation', hypothesis: 'Does confirmation add value?', conclusion: '', decision: '', status: 'draft', tags: ['AAPL'], evidence: [], followups: [{ text: 'Collect another quarter', due: '2026-11-01', done: false }] });
test('notebooks preserve history, reject stale edits and support searching negative findings', () => {
  const db = dbAt();
  try {
    const a = saveNotebook(db, draft());
    const b = saveNotebook(db, { ...a, baseRevision: 1, status: 'rejected', conclusion: 'No incremental return', decision: 'Reject after holdout', followups: [{ ...a.followups[0], done: true }] }, a.id);
    assert.equal(b.revision, 2); assert.equal(getNotebook(db, a.id).status, 'rejected');
    assert.equal(notebookHistory(db, a.id)[1].conclusion, '');
    assert.equal(listNotebooks(db, 'incremental', 'rejected').length, 1);
    assert.equal(listNotebooks(db, 'AAPL').length, 1); assert.equal(listNotebooks(db, 'unmatched-term').length, 0);
    assert.throws(() => saveNotebook(db, { ...a, baseRevision: 1 }, a.id), /changed elsewhere/);
    assert.throws(() => db.prepare('DELETE FROM research.notebook_revisions').run(), /immutable/);
    assert.equal(notebookHistory(db, a.id).length, 2);
  } finally { db.close(); }
});
test('evidence is validated and frozen; malformed edits are atomic', () => {
  const db = dbAt();
  try {
    const runId = putRun(db, { inputs: null, result: { ok: false }, provenance: { source: 'congress' }, engine: ENGINE });
    const e = saveExperiment(db, { title: 'Negative attempt', runId });
    const n = saveNotebook(db, { ...draft(), evidence: [{ kind: 'experiment', id: e.id, runId: 'forged' }] });
    assert.equal(n.evidence[0].runId, runId); assert.equal(listNotebooks(db, 'congress').length, 1);
    for (const patch of [{ status: 'invalid' }, { status: 'promising' }, { evidence: [{ kind: 'experiment', id: 'missing' }] }, { followups: [{ text: 'x', due: '2025-02-30', done: false }] }]) assert.throws(() => saveNotebook(db, { ...n, ...patch, baseRevision: 1 }, n.id));
    assert.equal(notebookHistory(db, n.id).length, 1);
  } finally { db.close(); }
});
test('notebooks survive database restart and disposable cache deletion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsi-notebooks-')); let db = dbAt(path.join(dir, 'cache.sqlite'));
  try { const n = saveNotebook(db, draft()); db.prepare('DELETE FROM cache').run(); db.close(); db = dbAt(path.join(dir, 'cache.sqlite')); assert.deepEqual(getNotebook(db, n.id), n); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
