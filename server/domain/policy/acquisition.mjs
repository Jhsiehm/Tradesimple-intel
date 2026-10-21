import { collectLegislation } from './legislation.mjs';
import { collectPolicyNews } from './news.mjs';
import { boundedInt, observationTime } from './evidenceHttp.mjs';

/** No cache reuse: collecting today cannot establish historical availability.
 * The caller stores the immutable snapshots and passes previous versions to preserve observations.
 */
export async function collectPolicyEvidence(_db, protocol, options = {}) {
  const startedAt = observationTime(options.now);
  const maxBills = boundedInt(options.maxBills, 10, 20);
  const ids = [...new Set(protocol.billIds || [])];
  const bounded = { ...protocol, billIds: ids.slice(0, maxBills) };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), boundedInt(options.maxDurationMs, 45000, 120000));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  const requestOptions = { ...options, signal, fetchImpl: options.fetchImpl || options.fetch || fetch };
  try {
    const legislation = await collectLegislation(bounded, requestOptions);
    const news = await collectPolicyNews(bounded, requestOptions);
    const gaps = [...legislation.gaps, ...news.gaps];
    if (ids.length > maxBills) gaps.push({ code: 'bill-cap', provider: 'collector',
      message: `Collected ${maxBills} of ${ids.length} requested bills; remaining bills were not searched.` });
    const receipts = [...legislation.manifest, ...news.manifest];
    const partial = receipts.some(receipt => !['complete', 'retrieved', 'zero-results'].includes(receipt.status)) || ids.length > maxBills;
    return { events: legislation.events, news: news.news, sources: [...legislation.sources, ...news.sources],
      newsCoverage: news.newsCoverage, gaps,
      manifest: { version: 1, startedAt, completedAt: observationTime(options.now), complete: false,
        status: signal.aborted ? options.signal?.aborted ? 'cancelled' : 'timeout' : partial ? 'partial' : 'collected',
        requestedBills: ids, searchedBills: bounded.billIds, maxBills,
        legislation: legislation.manifest, news: news.manifest,
        historicalAvailabilityAudited: false, newsCompleteness: 'unknown',
        requestedRange: { from: protocol.from, to: protocol.to } } };
  } finally { clearTimeout(timer); }
}
