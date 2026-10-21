import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPolicyNews } from '../server/domain/policy/news.mjs';
import { collectPolicyEvidence } from '../server/domain/policy/acquisition.mjs';

const now = '2026-10-20T16:00:00.000Z';
const protocol = { billIds: ['hr-119-1968'], from: '2024-10-20', to: '2026-10-20', eventTypes: ['vote'], newsArchive: 'gdelt-doc2' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const article = { url: 'https://news.example/a', title: 'House passes H.R. 1968', seendate: '20261001T193000Z' };

test('news query uses exact bill aliases and records a clipped, incomplete source corpus', async () => {
  let requested;
  const result = await collectPolicyNews(protocol, { now, maxNewsRecords: 2, fetchImpl: async url => {
    requested = new URL(url); return json({ articles: [article, article] });
  } });
  assert.equal(requested.searchParams.get('query'), '("H.R. 1968" OR "HR 1968")');
  assert.equal(requested.searchParams.get('sort'), 'DateAsc');
  assert.equal(result.news.length, 1);
  assert.equal(result.news[0].publishedAt, null);
  assert.equal(result.news[0].firstSeenAt, '2026-10-01T19:30:00.000Z');
  assert.equal(result.news[0].collectorFirstSeenAt, now);
  assert.equal(result.news[0].timingBasis, 'archive-first-seen');
  assert.equal(result.news[0].archive, 'gdelt-doc2');
  assert.equal(result.news[0].eventId, undefined);
  assert.equal(result.news[0].matchStatus, 'headline-alias-match');
  assert.equal(result.manifest[0].capped, true);
  assert.equal(result.manifest[0].duplicates, 1);
  assert.equal(result.manifest[0].windowClipped, true);
  assert.equal(result.newsCoverage[0].complete, false);
  assert.ok(result.newsCoverage[0].from > protocol.from);
  assert.ok(result.gaps.some(gap => gap.code === 'news-coverage-unknown'));
});

test('bill alias query matches remain candidates when headlines do not establish identity', async () => {
  const result = await collectPolicyNews(protocol, { now, fetchImpl: async () => json({ articles: [{
    ...article, title: 'Congress acts on spending' }] }) });
  assert.equal(result.news[0].matchStatus, 'unverified-query-match');
  assert.match(result.news[0].matchBasis, /Congress and event association unverified/);
});

test('invalid or future archive dates are not invented and unsafe article URLs are excluded', async () => {
  const result = await collectPolicyNews(protocol, { now, fetchImpl: async () => json({ articles: [
    { ...article, seendate: '20261220T120000Z' },
    { ...article, url: 'https://news.example/b', seendate: '20260230T120000Z' },
    { ...article, url: 'javascript:alert(1)' }] }) });
  assert.equal(result.news.length, 2);
  assert.ok(result.news.every(item => item.firstSeenAt === null && item.publishedAt === null));
  assert.equal(result.manifest[0].invalidTimestamp, 2);
  assert.equal(result.manifest[0].invalidUrl, 1);
});

test('a historical window outside ArtList operational bounds is not mislabeled as no news', async () => {
  const result = await collectPolicyNews({ ...protocol, to: '2025-01-01' }, { now,
    fetchImpl: () => assert.fail('must not query an unsupported historical window') });
  assert.equal(result.news.length, 0);
  assert.equal(result.manifest[0].status, 'outside-supported-window');
  assert.equal(result.newsCoverage.length, 0);
});

test('zero news results, invalid schema, and provider failures remain distinct', async () => {
  const zero = await collectPolicyNews(protocol, { now, fetchImpl: async () => json({ articles: [] }) });
  assert.equal(zero.manifest[0].status, 'zero-results');
  assert.equal(zero.newsCoverage[0].complete, false);
  const missing = await collectPolicyNews(protocol, { now, fetchImpl: async () => json({ error: 'not articles' }) });
  assert.equal(missing.manifest[0].status, 'invalid-response');
  const limited = await collectPolicyNews(protocol, { now, fetchImpl: async () => json({}, 429) });
  assert.equal(limited.manifest[0].status, 'rate-limited');
  assert.equal(limited.news.length, 0);
});

test('repeat collection preserves collector first observations without claiming original publication', async () => {
  const fetchImpl = async () => json({ articles: [article] });
  const first = await collectPolicyNews(protocol, { now: '2026-10-19T00:00:00Z', fetchImpl });
  const later = await collectPolicyNews(protocol, { now, previous: { news: first.news }, fetchImpl });
  assert.equal(later.news[0].collectorFirstSeenAt, '2026-10-19T00:00:00.000Z');
  assert.equal(later.news[0].publishedAt, null);
});

test('overall collector caps bill selection explicitly and keeps all raw source hashes', async () => {
  const result = await collectPolicyEvidence(null, { ...protocol, billIds: ['hr-119-1968', 's-119-1'] }, {
    apiKey: '', now, maxBills: 1, fetchImpl: async () => json({ articles: [article] }) });
  assert.equal(result.manifest.requestedBills.length, 2);
  assert.equal(result.manifest.searchedBills.length, 1);
  assert.equal(result.manifest.complete, false);
  assert.equal(result.manifest.status, 'partial');
  assert.equal(result.events.length, 0);
  assert.equal(result.news.length, 1);
  assert.equal(result.sources.length, 1);
  assert.ok(result.sources[0].contentHash);
  assert.ok(result.gaps.some(gap => gap.code === 'bill-cap'));
});

test('overall cancellation preserves a partial manifest and makes no provider request', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await collectPolicyEvidence(null, protocol, { now, apiKey: 'x', signal: controller.signal,
    fetchImpl: () => assert.fail('cancelled collector must not fetch') });
  assert.equal(result.manifest.status, 'cancelled');
  assert.equal(result.manifest.legislation[0].status, 'cancelled');
  assert.equal(result.manifest.news[0].status, 'cancelled');
  assert.equal(result.sources.length, 0);
});
