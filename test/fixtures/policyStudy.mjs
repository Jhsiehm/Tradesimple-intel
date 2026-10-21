import {cleanPolicyProtocol} from '../../shared/policyProtocol.mjs';

export const POLICY_FIXTURE_NOW = '2026-10-20T12:00:00.000Z';
export const policyStudyProtocolInput = () => ({schemaVersion: 1, title: 'Defense votes before covered news', question: 'Does a predefined defense vote signal precede covered news returns?',
  billIds: ['hr-118-123'], from: '2024-01-01', to: '2024-01-31', universe: ['LMT'], eventTypes: ['vote'], benchmark: 'SPY',
  sectorBenchmark: 'ITA', latencySeconds: 0, holdingMinutes: 2, costBps: 10, holdoutFrom: '2024-01-16', newsArchive: 'fixture-archive', newsTimeBasis: 'publication'});
export const policyStudyProtocol = overrides => {
  const result = cleanPolicyProtocol({...policyStudyProtocolInput(), ...overrides}, {now: POLICY_FIXTURE_NOW});
  if (!result.ok) throw new Error(result.error); return result.protocol;
};
export function policyStudyEvidence(day = '2024-01-08') {
  const events = [{id: 'event-1', billId: 'hr-118-123', type: 'vote', title: 'Recorded vote', eventAt: `${day}T14:30:00Z`, eventPrecision: 'instant',
    publicAt: `${day}T14:30:10Z`, publicPrecision: 'instant', availabilityBasis: 'importer-asserted', firstSeenAt: POLICY_FIXTURE_NOW,
    sourceUrl: 'https://example.test/vote/1', sourceRecordId: 'congress:stable-action-1', sourceHash: 'action-sha256-1'}];
  const news = [{id: 'news-1', eventId: 'event-1', billId: 'hr-118-123', title: 'Vote result report', archive: 'fixture-archive',
    publishedAt: `${day}T14:35:10Z`, firstSeenAt: `${day}T14:35:20Z`, sourceUrl: 'https://example.test/news/1', timingBasis: 'importer-asserted', sourceHash: 'news-sha256-1', reviewed: true}];
  const exposures = [{id: 'exposure-1', eventId: 'event-1', symbol: 'LMT', side: 'long', knownAt: '2023-12-01T00:00:00Z', validFrom: '2023-12-01T00:00:00Z', sourceUrl: 'https://example.test/filing', rationale: 'Predetermined defense revenue exposure and signed rule.', reviewed: true}];
  const bars = [];
  for (const symbol of ['LMT', 'SPY', 'ITA']) for (let minute = 30; minute <= 40; minute++) {
    bars.push({symbol, at: `${day}T14:${minute}:00.000Z`, intervalMinutes: 1, open: 100, close: 100});
  }
  for (const [symbol, policyClose, newsOpen, newsClose] of [['LMT', 110, 110, 108], ['SPY', 101, 101, 102], ['ITA', 102, 102, 103]]) {
    bars.find(b => b.symbol === symbol && b.at.includes('14:32:')).close = policyClose;
    bars.find(b => b.symbol === symbol && b.at.includes('14:36:')).open = newsOpen;
    bars.find(b => b.symbol === symbol && b.at.includes('14:37:')).close = newsClose;
  }
  return {events, news, exposures, bars, newsCoverage: [{archive: 'fixture-archive', scope: 'archive-global', from: '2024-01-01', to: '2024-01-31', complete: true, basis: 'researcher-asserted'}]};
}
export function completePolicyStudyFixture() { return {protocol: policyStudyProtocol(), evidence: policyStudyEvidence()}; }
