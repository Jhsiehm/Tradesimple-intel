import { evidenceRequest, boundedInt, observationTime } from './evidenceHttp.mjs';
import { normalizePolicyAction, parsePolicyBillId } from './legislationActions.mjs';

/** Enumerate bill actions, not bills updated in a period. updateDate is not an event-time filter.
 * Field semantics: https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/BillEndpoint.md
 */
export async function collectLegislation(protocol, options = {}) {
  const { apiKey = process.env.CONGRESS_API_KEY || '', previous = {}, signal } = options;
  const pageSize = boundedInt(options.pageSize, 250, 250); const maxPages = boundedInt(options.maxPages, 4, 10);
  const events = []; const sources = []; const manifest = []; const gaps = [];
  for (const id of protocol.billIds || []) {
    const bill = parsePolicyBillId(id);
    const receipt = { provider: 'Congress.gov', billId: id, status: 'pending', requestedFrom: protocol.from,
      requestedTo: protocol.to, pageSize, maxPages, pages: [], retrieved: 0, retained: 0, duplicates: 0,
      excluded: { outsidePeriod: 0, eventType: 0, invalidDate: 0 }, providerCount: null, ambiguousAnchors: 0,
      enumerationComplete: false, historicalPublicationAudited: false };
    manifest.push(receipt);
    if (!bill || !apiKey || signal?.aborted) {
      receipt.status = !bill ? 'invalid-bill-id' : !apiKey ? 'not-configured' : 'cancelled';
      gaps.push({ code: receipt.status, provider: 'Congress.gov', billId: id,
        message: receipt.status === 'not-configured' ? 'CONGRESS_API_KEY is not configured; no actions were retrieved.' : 'Bill action collection did not run.' });
      continue;
    }
    const seen = new Set(); const anchors = new Map(); let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`https://api.congress.gov/v3/bill/${bill.congress}/${bill.type}/${bill.number}/actions`);
      url.search = new URLSearchParams({ api_key: apiKey, format: 'json', limit: String(pageSize), offset: String(offset) }).toString();
      const result = await evidenceRequest(url, 'Congress.gov', { ...options, apiKey });
      receipt.pages.push({ offset, status: result.status, observedAt: result.observedAt,
        ...(result.httpStatus ? { httpStatus: result.httpStatus, retryAfter: result.retryAfter } : {}),
        ...(result.source ? { url: result.source.url, sourceHash: result.source.contentHash } : {}) });
      if (!result.ok) { receipt.status = result.status; break; }
      sources.push(result.source);
      const actions = result.payload?.actions;
      if (!Array.isArray(actions)) { receipt.status = 'invalid-response'; break; }
      receipt.retrieved += actions.length;
      if (Number.isFinite(result.payload.pagination?.count)) receipt.providerCount = result.payload.pagination.count;
      for (const action of actions) {
        const event = normalizePolicyAction(action, bill, result.observedAt, previous.events || []);
        if (!event) { receipt.excluded.invalidDate++; continue; }
        if (seen.has(event.id)) { receipt.duplicates++; continue; }
        seen.add(event.id);
        if (anchors.has(event.sourceRecordId) && anchors.get(event.sourceRecordId) !== event.sourceHash) receipt.ambiguousAnchors++;
        anchors.set(event.sourceRecordId, event.sourceHash);
        if (action.actionDate < protocol.from || action.actionDate > protocol.to) { receipt.excluded.outsidePeriod++; continue; }
        if (protocol.eventTypes?.length && !event.eventTypes.some(type => protocol.eventTypes.includes(type))) {
          receipt.excluded.eventType++; continue;
        }
        events.push(event); receipt.retained++;
      }
      const next = result.payload.pagination?.next;
      // Offset is generated locally; never follow an arbitrary provider URL or send credentials to another host.
      if (!next && (receipt.providerCount !== null && offset + actions.length >= receipt.providerCount
        || result.payload.pagination && receipt.providerCount === null && actions.length < pageSize)) {
        receipt.status = 'complete'; receipt.enumerationComplete = true; break;
      }
      if (!result.payload.pagination) { receipt.status = 'incomplete-pagination'; break; }
      if (!actions.length) { receipt.status = 'incomplete-pagination'; break; }
      offset += actions.length;
      receipt.status = 'capped';
    }
    if (!receipt.enumerationComplete) gaps.push({ code: receipt.status, provider: 'Congress.gov', billId: id,
      message: `Bill actions enumeration is ${receipt.status}; an empty or partial result is not proof of no legislative activity.` });
    if (receipt.ambiguousAnchors) gaps.push({ code: 'ambiguous-action-version', provider: 'Congress.gov', billId: id,
      message: 'Multiple records share a source identity with differing payloads. Preserve versions and exclude ambiguous anchors from analysis until reviewed.' });
  }
  if (events.length) gaps.push({ code: 'historical-publication-unknown', provider: 'Congress.gov',
    message: 'Action dates, vote timestamps, updateDate and HTTP modification dates do not establish historical public release. Collector observation is prospective evidence only.' });
  return { events, sources, manifest, gaps, observedAt: observationTime(options.now) };
}
