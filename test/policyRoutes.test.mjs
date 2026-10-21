import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { router } from '../server/routes/index.mjs';
import { policyStudyProtocolInput, policyStudyEvidence } from './fixtures/policyStudy.mjs';

let db, server, base, id, revision;
before(async () => {
  db = new DatabaseSync(':memory:');
  const routes = router();
  server = http.createServer((req, res) => routes.handle(req, res, { db }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
async function call(method, path, body, origin = 'http://localhost:5173') {
  const response = await fetch(base + path, { method, headers: { origin, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('policy API validates methods/origins/protocols and creates no partial records', async () => {
  const payload = { protocol: policyStudyProtocolInput() };
  assert.equal((await call('POST', '/api/research/policy', payload, 'https://untrusted.example')).status, 403);
  assert.equal((await call('DELETE', '/api/research/policy')).status, 405);
  assert.equal((await call('POST', '/api/research/policy', { protocol: { ...payload.protocol, costBps: '10' } })).status, 400);
  assert.equal((await call('GET', '/api/research/policy')).body.items.length, 0);
  const created = await call('POST', '/api/research/policy', payload);
  assert.equal(created.status, 200);
  id = created.body.investigation.id; revision = created.body.investigation.revision;
  assert.equal(created.body.investigation.status, 'draft');
  assert.equal(created.body.investigation.readiness.ready, false);
  assert.ok(created.body.investigation.readiness.gaps.length >= 4);
  assert.match(created.body.investigation.protocolHash, /^[a-f0-9]{64}$/);
  assert.equal((await call('GET', `/api/research/policy/${id}`)).body.investigation.id, id);
  assert.equal((await call('GET', '/api/research/policy/policy_0000')).status, 404);
});

test('policy API imports complete evidence, evaluates paired returns and verifies frozen replay', async () => {
  const data = policyStudyEvidence();
  for (const [kind, records] of Object.entries(data)) {
    const imported = await call('POST', `/api/research/policy/${id}/import`, { kind, records, revision });
    assert.equal(imported.status, 200, imported.body.error);
    revision = imported.body.investigation.revision;
  }
  const before = await call('GET', `/api/research/policy/${id}`);
  assert.equal(before.body.investigation.readiness.ready, true);
  const evaluated = await call('POST', `/api/research/policy/${id}/evaluate`, { revision });
  assert.equal(evaluated.status, 200, evaluated.body.error);
  assert.equal(evaluated.body.investigation.result.status, 'conditional-analysis');
  assert.equal(evaluated.body.investigation.result.counts.completedPairs, 1);
  assert.equal(evaluated.body.investigation.result.summary.portfolioMetrics, null);
  assert.equal(evaluated.body.investigation.evaluation.inputs, undefined);
  const replay = await call('POST', `/api/research/policy/${id}/replay`, {});
  assert.equal(replay.status, 200);
  assert.equal(replay.body.matches, true);
  assert.equal((await call('POST', `/api/research/policy/${id}/evaluate`, { revision })).status, 409);
});

test('policy exports contain inputs, raw source receipts and original executable engine', async () => {
  const exported = await call('GET', `/api/research/policy/${id}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.format, 'tradesimple-policy-study-v1');
  assert.ok(exported.body.record.evaluation.engineFiles['policyStudy.mjs']);
  assert.equal(exported.body.record.evaluation.inputs.evidence.events.length, 1);
  assert.equal(exported.body.record.evidence.sources.length, 5);
  const zip = await fetch(base + `/api/research/policy/${id}/archive`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.equal(zip.headers.get('cache-control'), 'no-store');
  assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(0), 0x04034b50);
});

test('insufficient policy studies persist their gap report without fabricating returns', async () => {
  const created = await call('POST', '/api/research/policy', { protocol: policyStudyProtocolInput() });
  const emptyId = created.body.investigation.id;
  assert.equal((await call('GET', `/api/research/policy/${emptyId}/archive`)).status, 400);
  const evaluated = await call('POST', `/api/research/policy/${emptyId}/evaluate`, {});
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.body.investigation.result.executed, false);
  assert.equal(evaluated.body.investigation.result.summary.meanPolicyNet, null);
  assert.equal((await call('POST', `/api/research/policy/${emptyId}/replay`, {})).body.matches, true);
  assert.equal((await call('POST', `/api/research/policy/${emptyId}/cancel`, {})).body.stopping, false);
});
