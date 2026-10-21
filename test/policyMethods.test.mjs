import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPolicyProtocol, policyDate, policyInstant} from '../shared/policyProtocol.mjs';
import {assessPolicyReadiness as rawAssess, evaluatePolicyStudy as rawEvaluate} from '../shared/policyStudy.mjs';

import {POLICY_FIXTURE_NOW as NOW, policyStudyProtocolInput as input, policyStudyProtocol as protocol, policyStudyEvidence as evidence} from './fixtures/policyStudy.mjs';
const evaluatePolicyStudy = (p, e, options) => rawEvaluate(p, e, {asOf: NOW, ...options});
const assessPolicyReadiness = (p, e, options) => rawAssess(p, e, {asOf: NOW, ...options});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function exclusion(change, code, p = protocol()) {
  const data = evidence(); change(data);
  const result = evaluatePolicyStudy(p, data);
  assert.equal(result.executed, false); assert.equal(result.status, 'insufficient-evidence');
  assert.ok(result.exclusions.some(e => e.code === code), JSON.stringify(result.exclusions)); return result;
}
test('protocol enforces bounded explicit rules and server-owned registration', () => {
  const p = protocol({registeredAt: '2020-01-01T00:00:00Z', universe: ['lmt']});
  assert.equal(p.registeredAt, NOW); assert.deepEqual(p.universe, ['LMT']);
  assert.equal(p.newsTimeBasis, 'publication'); assert.equal(p.benchmark, 'SPY');
  for (const patch of [{schemaVersion: 2}, {from: '2024-02-30'}, {to: '2028-01-01'}, {holdoutFrom: '2024-01-01'}, {holdingMinutes: 391},
    {holdingMinutes: 1.5}, {costBps: NaN}, {costBps: '10'}, {latencySeconds: Infinity}, {latencySeconds: -1}, {billIds: ['hr123']},
    {universe: []}, {universe: ['LMT', 'lmt']}, {eventTypes: ['congress-trades']}, {eventTypes: ['vote', 'vote']}, {benchmark: 'QQQ'},
    {newsArchive: ''}, {newsTimeBasis: 'any-news'}, {question: 'why?'}]) assert.equal(cleanPolicyProtocol({...input(), ...patch}, {now: NOW}).ok, false, JSON.stringify(patch));
  assert.equal(policyDate('2023-02-29'), false); assert.equal(policyDate('2024-02-29'), true);
  assert.equal(policyDate('2024-99-99'), false); assert.equal(policyInstant('2024-01-01'), null);
  assert.equal(policyInstant('2024-01-01T99:00:00Z'), null);
});
test('complete frozen inputs execute hand-calculated paired returns on identical cohorts', () => {
  const p = protocol(), data = evidence(), result = evaluatePolicyStudy(p, data);
  assert.equal(assessPolicyReadiness(p, data).ready, true);
  assert.equal(result.status, 'conditional-analysis'); assert.equal(result.executed, true);
  assert.equal(result.rows.length, 1); assert.equal(result.counts.candidatePairs, 1);
  const row = result.rows[0], r = row.returns;
  assert.equal(row.policyEntryAt, '2024-01-08T14:31:00.000Z'); assert.equal(row.policyExitAt, '2024-01-08T14:33:00.000Z');
  assert.equal(row.newsEntryAt, '2024-01-08T14:36:00.000Z'); assert.equal(row.newsExitAt, '2024-01-08T14:38:00.000Z');
  close(r.policyGross, .1); close(r.policyNet, .099); close(r.newsNet, 108 / 110 - 1 - .001);
  close(r.policyExcess, .09); close(r.newsExcess, (108 / 110 - 1) - (102 / 101 - 1));
  close(r.policySectorExcess, .08); close(r.pairedDifference, .1 - (108 / 110 - 1));
  assert.equal(result.summary.units, 'decimal-return'); assert.equal(result.summary.uncertainty.available, false);
  assert.equal(result.summary.portfolioMetrics, null); assert.match(result.summary.holdoutStatus, /retrospective/);
  assert.equal(row.evidenceStatus, 'conditional-on-supplied-evidence'); assert.match(result.claimCeiling, /no verified historical/);
  assert.deepEqual(evaluatePolicyStudy(p, structuredClone(data)), result, 'frozen replay is deterministic');
  assert.deepEqual(evaluatePolicyStudy(p, {...data, bars: [...data.bars].reverse()}), result, 'bar ordering has no effect');
});
test('two sides deduct one total round-trip cost without inventing a direction', () => {
  const data = evidence(); data.exposures[0].side = 'short';
  const r = evaluatePolicyStudy(protocol(), data).rows[0].returns;
  close(r.policyGross, -.1); close(r.policyNet, -.101); close(r.newsNet, -(108 / 110 - 1) - .001);
  exclusion(d => { delete d.exposures[0].side; }, 'invalid-exposure');
});
test('unknown or day-only availability never borrows the action date', () => {
  exclusion(d => { d.events[0].publicAt = null; d.events[0].availabilityBasis = 'unknown'; }, 'unknown-availability');
  exclusion(d => { d.events[0].publicPrecision = 'day'; }, 'unknown-availability');
  exclusion(d => { d.events[0].publicAt = '2024-01-08T14:29:00Z'; }, 'unknown-availability');
  exclusion(d => { delete d.events[0].sourceHash; }, 'unknown-availability');
});
test('collector observation is a prospective conservative bound, never historical publication', () => {
  exclusion(d => { d.events[0].availabilityBasis = 'collector-first-seen'; d.events[0].firstSeenAt = '2024-01-08T14:30:10Z'; d.events[0].publicAt = null; }, 'unknown-availability');
  const p = {...protocol(), registeredAt: '2024-01-01T00:00:00.000Z'}, data = evidence();
  Object.assign(data.events[0], {availabilityBasis: 'collector-first-seen', firstSeenAt: '2024-01-08T14:30:10Z', publicAt: null});
  const result = evaluatePolicyStudy(p, data); assert.equal(result.executed, true);
  assert.equal(result.rows[0].availabilityBasis, 'collector-first-seen'); assert.match(result.summary.holdoutStatus, /registered-before/);
});
test('news discovery cannot substitute for publication and query candidates cannot identify the event', () => {
  exclusion(d => { d.news[0].timingBasis = 'archive-first-seen'; }, 'unknown-news');
  exclusion(d => { d.news[0].publishedAt = null; }, 'unknown-news');
  exclusion(d => { d.news[0].reviewed = false; }, 'unknown-news');
  exclusion(d => { delete d.news[0].eventId; d.news[0].matchStatus = 'headline-alias-match'; }, 'unknown-news');
  exclusion(d => { d.news = []; }, 'unknown-news');
  const p = protocol({newsTimeBasis: 'archive-first-seen'}), data = evidence(); data.news[0].timingBasis = 'archive-first-seen'; data.news[0].publishedAt = null;
  const result = evaluatePolicyStudy(p, data); assert.equal(result.executed, true);
  assert.equal(result.rows[0].newsAt, '2024-01-08T14:35:20.000Z'); assert.ok(result.limitations.some(l => l.includes('not original news publication')));
});
test('all matched news must be timed and earliest valid article defeats late-news cherry-picking', () => {
  exclusion(d => { d.news.push({...d.news[0], id: 'earlier', publishedAt: '2024-01-08T14:30:30Z'}); }, 'not-before-news');
  exclusion(d => { d.news.push({...d.news[0], id: 'unknown', publishedAt: null}); }, 'unknown-news');
  exclusion(d => { d.news[0].sourceHash = ''; }, 'unknown-news');
});
test('news archive coverage must be explicitly complete rather than inferred from search success', () => {
  exclusion(d => { d.newsCoverage = []; }, 'incomplete-news-coverage');
  exclusion(d => { d.newsCoverage[0].complete = false; }, 'incomplete-news-coverage');
  exclusion(d => { d.newsCoverage[0].from = '2024-01-09'; }, 'incomplete-news-coverage');
});
test('exposure requires a reviewed directional citation known strictly before the signal', () => {
  for (const change of [d => { d.exposures[0].knownAt = d.events[0].publicAt; }, d => { d.exposures[0].reviewed = false; },
    d => { d.exposures[0].sourceUrl = ''; }, d => { d.exposures[0].rationale = ''; }, d => { d.exposures[0].validFrom = '2024-01-09T00:00:00Z'; },
    d => { d.exposures[0].validTo = '2024-01-07T00:00:00Z'; }, d => { d.exposures.push({...d.exposures[0], id: 'ambiguous'}); }]) exclusion(change, 'invalid-exposure');
});
test('missing, duplicate, daily, invalid and later-session bars exclude the same paired cohort', () => {
  exclusion(d => { d.bars = d.bars.filter(b => !(b.symbol === 'LMT' && b.at.includes('14:36:'))); }, 'missing-intraday-window');
  exclusion(d => { d.bars = d.bars.filter(b => !(b.symbol === 'SPY' && b.at.includes('14:32:'))); }, 'missing-intraday-window');
  exclusion(d => { d.bars = d.bars.filter(b => !(b.symbol === 'ITA' && b.at.includes('14:37:'))); }, 'missing-intraday-window');
  exclusion(d => { d.bars.push({...d.bars.find(b => b.symbol === 'LMT' && b.at.includes('14:31:'))}); }, 'missing-intraday-window');
  exclusion(d => { d.bars.forEach(b => { b.intervalMinutes = 1440; }); }, 'missing-intraday-window');
  exclusion(d => { d.bars.find(b => b.symbol === 'LMT' && b.at.includes('14:31:')).open = Infinity; }, 'missing-intraday-window');
  exclusion(d => { d.bars.find(b => b.symbol === 'LMT' && b.at.includes('14:31:')).at = '2024-01-09T14:31:00Z'; }, 'missing-intraday-window');
  assert.equal(evaluatePolicyStudy(protocol(), evidence('2024-01-07')).executed, false, 'Sunday bars do not manufacture an exchange session');
});
test('duplicates, source revisions and out-of-scope events remain visible in denominators', () => {
  const data = evidence(); data.events.push({...data.events[0]});
  const result = evaluatePolicyStudy(protocol(), data); assert.equal(result.rows.length, 1);
  assert.equal(result.counts.inputEvents, 2); assert.equal(result.counts.duplicateEvents, 1); assert.equal(result.exclusions[0].code, 'duplicate-event');
  exclusion(d => { d.events.push({...d.events[0], id: 'revision', sourceHash: 'new-hash'}); }, 'ambiguous-revision');
  exclusion(d => { d.events[0].billId = 'hr-118-999'; }, 'out-of-scope');
});
test('latency and holdout boundaries are frozen and incomplete end-period outcomes are censored', () => {
  exclusion(() => {}, 'not-before-news', protocol({latencySeconds: 300}));
  const holdout = evaluatePolicyStudy(protocol(), evidence('2024-01-22')); assert.equal(holdout.rows[0].partition, 'holdout');
  assert.equal(holdout.summary.train.pairs, 0); assert.equal(holdout.summary.holdout.pairs, 1);
  exclusion(d => { d.news[0].publishedAt = '2024-01-31T23:59:30Z'; d.news[0].firstSeenAt = '2024-01-31T23:59:40Z'; }, 'censored-outcome');
  exclusion(d => { d.news[0].publishedAt = '2024-01-16T14:35:10Z'; d.news[0].firstSeenAt = '2024-01-16T14:35:20Z'; }, 'partition-boundary');
});
test('empty, invalid and partially eligible inputs yield explicit readiness instead of invented metrics', () => {
  const empty = {events: [], news: [], exposures: [], bars: []};
  const result = evaluatePolicyStudy(protocol(), empty); assert.equal(result.executed, false); assert.equal(result.summary.meanPolicyNet, null);
  assert.equal(assessPolicyReadiness(protocol(), empty).ready, false);
  assert.equal(assessPolicyReadiness(protocol(), empty).gaps.length, 5);
  assert.equal(evaluatePolicyStudy(protocol(), {...empty, bars: {}}).status, 'invalid-input');
  assert.equal(evaluatePolicyStudy({...protocol(), holdingMinutes: NaN}, empty).status, 'invalid-input');
  const p = protocol({universe: ['LMT', 'RTX']}), partial = evaluatePolicyStudy(p, evidence());
  assert.equal(partial.counts.candidatePairs, 2); assert.equal(partial.counts.completedPairs, 1);
  assert.equal(partial.exclusions[0].symbol, 'RTX'); assert.equal(partial.rows[0].symbol, 'LMT');
});

test('frozen evaluation time censors future information and outcomes and supports ongoing protocols', () => {
  assert.equal(protocol({to: '2027-01-01'}).to, '2027-01-01');
  const p = {...protocol(), registeredAt: '2023-12-01T00:00:00Z'}, data = evidence();
  data.events[0].firstSeenAt = '2024-01-08T14:30:10Z';
  const asOf = '2024-01-08T14:38:00.000Z';
  const result = evaluatePolicyStudy(p, data, {asOf});
  assert.equal(result.executed, true); assert.equal(result.asOf, asOf);
  assert.deepEqual(rawEvaluate(p, structuredClone(data), {asOf}), result);
  let r = evaluatePolicyStudy(p, data, {asOf: '2024-01-08T14:37:00Z'});
  assert.equal(r.executed, false); assert.equal(r.exclusions[0].code, 'future-outcome');
  r = evaluatePolicyStudy(p, data, {asOf: '2024-01-08T14:34:00Z'});
  assert.equal(r.exclusions[0].code, 'future-news');
  r = evaluatePolicyStudy(p, data, {asOf: '2024-01-08T14:30:05Z'});
  assert.equal(r.exclusions[0].code, 'future-availability');
  assert.equal(evaluatePolicyStudy(p, data, {asOf: '2024-01-08'}).status, 'invalid-input');
});
test('coverage assertions cannot cross bill scopes and exact review cannot contradict bill identity', () => {
  exclusion(d => { delete d.newsCoverage[0].scope; d.newsCoverage[0].billId = 'hr-118-999'; }, 'incomplete-news-coverage');
  const data = evidence(); delete data.newsCoverage[0].scope; data.newsCoverage[0].billId = 'hr-118-123';
  assert.equal(evaluatePolicyStudy(protocol(), data).executed, true);
  exclusion(d => { d.news[0].billId = 'hr-118-999'; }, 'unknown-news');
});
test('passage rollcalls remain eligible for registered vote studies through explicit event types', () => {
  const data = evidence(); data.events[0].type = 'passed'; data.events[0].eventTypes = ['passed', 'vote'];
  assert.equal(evaluatePolicyStudy(protocol(), data).executed, true);
  exclusion(d => { d.events[0].eventTypes = ['vote', 'invented']; }, 'out-of-scope');
});
test('exposure date bounds are explicit conservative day boundaries; knowledge still needs an exact instant', () => {
  const data = evidence(); data.exposures[0].validFrom = '2024-01-08'; data.exposures[0].validTo = '2024-01-08';
  assert.equal(evaluatePolicyStudy(protocol(), data).executed, true);
  exclusion(d => { d.exposures[0].knownAt = '2024-01-07'; }, 'invalid-exposure');
});
test('conflicting identity anchors and IDs require adjudication instead of arbitrary duplicate choice', () => {
  exclusion(d => { d.events.push({...d.events[0], id: 'alternate-id'}); }, 'ambiguous-identity');
  exclusion(d => { d.events.push({...d.events[0], sourceRecordId: 'other-anchor'}); }, 'ambiguous-identity');
});
test('exact minute information boundaries always enter a strictly later minute', () => {
  const data = evidence(); data.events[0].publicAt = '2024-01-08T14:30:00Z';
  const r = evaluatePolicyStudy(protocol(), data); assert.equal(r.executed, true);
  assert.equal(r.rows[0].policyEntryAt, '2024-01-08T14:31:00.000Z');
  const withLatency = evaluatePolicyStudy(protocol({latencySeconds: 60}), data);
  assert.equal(withLatency.rows[0].policyEntryAt, '2024-01-08T14:32:00.000Z');
});

test('malformed provenance and extreme numeric inputs do not create unserializable performance', () => {
  exclusion(d => { d.events[0].eventPrecision = 'instant'; d.events[0].eventAt = '2024-01-08'; }, 'unknown-availability');
  exclusion(d => { d.news[0].sourceHash = 42; }, 'unknown-news');
  exclusion(d => { delete d.exposures[0].id; }, 'invalid-exposure');
  exclusion(d => { d.bars.find(b => b.symbol === 'LMT' && b.at.includes('14:31:')).open = 1e-300; d.bars.find(b => b.symbol === 'LMT' && b.at.includes('14:32:')).close = 1e300; }, 'nonfinite-return');
});

test('legislative action-day scope preserves source dates while availability retains UTC period bounds', () => {
  const data = evidence('2024-01-09'); data.events[0].sourceEventDate = '2024-01-08';
  const result = evaluatePolicyStudy(protocol(), data); assert.equal(result.executed, true);
  assert.equal(result.rows[0].actionDate, '2024-01-08'); assert.equal(result.rows[0].availabilityDateUTC, '2024-01-09');
  const bounded = evaluatePolicyStudy(protocol({to: '2024-01-08', holdoutFrom: '2024-01-05'}), data);
  assert.equal(bounded.counts.scopedEvents, 1); assert.equal(bounded.exclusions[0].code, 'availability-outside-period');
  exclusion(d => { d.events[0].sourceEventDate = '2023-12-31'; }, 'out-of-scope');
  exclusion(d => { d.events[0].sourceEventDate = '2024-02-30'; }, 'out-of-scope');
});
test('archive observation before claimed publication cannot manufacture a before-news lead', () => {
  const result = exclusion(d => { d.news[0].firstSeenAt = '2024-01-08T14:30:00Z'; }, 'unknown-news');
  assert.match(result.gaps[0], /publication is later than archive observation/);
});

test('late collector observation cannot conceal earlier news between the action and collection', () => {
  const p = {...protocol(), registeredAt: '2024-01-01T00:00:00Z'}, data = evidence('2024-01-22');
  Object.assign(data.events[0], {eventAt: '2024-01-08T14:30:00Z', firstSeenAt: '2024-01-22T14:30:10Z', publicAt: null, availabilityBasis: 'collector-first-seen'});
  data.newsCoverage[0].from = '2024-01-22';
  const missing = evaluatePolicyStudy(p, data); assert.equal(missing.executed, false);
  assert.equal(missing.exclusions[0].code, 'incomplete-news-coverage');
  data.newsCoverage[0].from = '2024-01-08T14:30:00Z';
  const asserted = evaluatePolicyStudy(p, data); assert.equal(asserted.executed, true);
  assert.equal(asserted.rows[0].newsCoverageFromAt, '2024-01-08T14:30:00.000Z');
  Object.assign(data.events[0], {eventAt: '2024-01-08', sourceEventDate: '2024-01-08', eventPrecision: 'day'});
  assert.equal(evaluatePolicyStudy(p, data).executed, false, 'unknown action hour requires coverage from start of action date');
  data.newsCoverage[0].from = '2024-01-08'; assert.equal(evaluatePolicyStudy(p, data).executed, true);
});

test('distinct source aliases for one exact bill vote require adjudication without double-counting', () => {
  const data = evidence();
  data.events[0].title = 'On passage Passed ... Roll70';
  data.events.push({...data.events[0], id: 'event-alias', sourceRecordId: 'congress:alternate-action-anchor', sourceHash: 'alias-source-hash',
    type: 'passed', eventTypes: ['passed', 'vote'], eventAt: '2024-01-08T09:30:00-05:00', title: 'Passed/agreed to in House: On passage...'});
  data.news.push({...data.news[0], id: 'alias-news', eventId: 'event-alias'});
  data.exposures.push({...data.exposures[0], id: 'alias-exposure', eventId: 'event-alias'});
  const raw = structuredClone(data), result = evaluatePolicyStudy(protocol(), data);
  assert.equal(result.executed, false); assert.equal(result.rows.length, 0); assert.equal(result.counts.inputEvents, 2);
  assert.equal(result.counts.ambiguousVoteEvents, 2); assert.equal(result.counts.ambiguousVoteGroups, 1);
  assert.equal(result.counts.candidatePairs, 2); assert.equal(result.counts.excludedPairs, 2);
  assert.deepEqual(result.exclusions.map(e => e.code), ['ambiguous-vote-alias', 'ambiguous-vote-alias']);
  assert.deepEqual(data, raw, 'all raw source aliases remain preserved');
  data.events[1].eventAt = '2024-01-08T14:30:01Z';
  const differentTimes = evaluatePolicyStudy(protocol(), data); assert.equal(differentTimes.rows.length, 2);
  assert.equal(differentTimes.counts.ambiguousVoteEvents, 0);
  for (const event of data.events) Object.assign(event, {type: 'markup', eventTypes: ['markup'], eventPrecision: 'day', eventAt: '2024-01-08'});
  assert.equal(evaluatePolicyStudy(protocol({eventTypes: ['markup']}), data).rows.length, 2, 'day-only markups are not collapsed by date');
});
test('collector observation cannot turn a future completed action into an eligible signal', () => {
  const p = {...protocol(), registeredAt: '2024-01-01T00:00:00Z'};
  for (const [eventAt, eventPrecision] of [['2024-01-09T14:30:00Z', 'instant'], ['2024-01-09', 'day']]) {
    const data = evidence(); Object.assign(data.events[0], {eventAt, eventPrecision, availabilityBasis: 'collector-first-seen', publicAt: null, firstSeenAt: '2024-01-08T14:30:10Z'});
    const result = evaluatePolicyStudy(p, data); assert.equal(result.executed, false);
    assert.equal(result.exclusions[0].code, 'unknown-availability'); assert.match(result.gaps[0], /future scheduled actions are not completed signals/);
  }
});
