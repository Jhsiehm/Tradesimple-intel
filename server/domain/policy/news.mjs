import { evidenceHash, evidenceRequest, observationTime, boundedInt, safeUrl, preservedObservation } from './evidenceHttp.mjs';
import { parsePolicyBillId } from './legislationActions.mjs';

const ARCHIVE = 'gdelt-doc2';
const DOCS = 'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/';
const DAY = 86_400_000;
function billAliases(bill) {
  const labels = { hr: 'H.R.', s: 'S.', hjres: 'H.J.Res.', sjres: 'S.J.Res.',
    hconres: 'H.Con.Res.', sconres: 'S.Con.Res.', hres: 'H.Res.', sres: 'S.Res.' };
  return [`${labels[bill.type]} ${bill.number}`, `${bill.type.toUpperCase()} ${bill.number}`];
}
function archiveTime(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
  const valueISO = `${y}-${m}-${d}T${h}:${min}:${s}Z`;
  return Number.isFinite(Date.parse(valueISO)) && new Date(valueISO).toISOString().replace('.000', '') === valueISO
    ? new Date(valueISO).toISOString() : null;
}
const gdeltTime = date => new Date(date).toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** A bounded discovery corpus, not a historical or globally exhaustive news audit.
 * DOC2 ArtList is capped at 250; seendate is archive timing, never original publication.
 * API limits and exact phrase operators: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 */
export async function collectPolicyNews(protocol, options = {}) {
  const news = []; const sources = []; const manifest = []; const gaps = []; const newsCoverage = [];
  const observedAt = observationTime(options.now); const nowMs = Date.parse(observedAt);
  const maxRecords = boundedInt(options.maxNewsRecords, 250, 250);
  const earliest = nowMs - 90 * DAY; // Conservative operational limit; provider completeness remains unverified.
  const from = Math.max(Date.parse(`${protocol.from}T00:00:00Z`), earliest);
  const to = Math.min(Date.parse(`${protocol.to}T23:59:59.999Z`), nowMs);
  for (const id of protocol.billIds || []) {
    const bill = parsePolicyBillId(id);
    const receipt = { provider: 'GDELT DOC 2.0', archive: ARCHIVE, billId: id, requestedFrom: protocol.from,
      requestedTo: protocol.to, status: 'pending', searchTerms: bill ? billAliases(bill) : [], maxRecords,
      retrieved: 0, retained: 0, duplicates: 0, invalidTimestamp: 0, invalidUrl: 0, capped: false,
      completeness: 'unknown', pagination: 'not-supported', publicationTimeVerified: false, documentation: DOCS };
    manifest.push(receipt);
    if (!bill || !Number.isFinite(from) || !Number.isFinite(to) || from >= to || protocol.newsArchive && protocol.newsArchive !== ARCHIVE) {
      receipt.status = !bill ? 'invalid-bill-id' : protocol.newsArchive && protocol.newsArchive !== ARCHIVE
        ? 'unsupported-archive' : 'outside-supported-window';
      gaps.push({ code: receipt.status, provider: 'GDELT DOC 2.0', billId: id,
        message: 'No GDELT ArtList search was possible for this bill/window; this does not establish an absence of news.' });
      continue;
    }
    receipt.searchedFrom = new Date(from).toISOString(); receipt.searchedTo = new Date(to).toISOString();
    receipt.windowClipped = from > Date.parse(`${protocol.from}T00:00:00Z`) || to < Date.parse(`${protocol.to}T23:59:59.999Z`);
    const query = `(${receipt.searchTerms.map(term => `"${term}"`).join(' OR ')})`;
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.search = new URLSearchParams({ query, mode: 'ArtList', format: 'json', sort: 'DateAsc',
      maxrecords: String(maxRecords), startdatetime: gdeltTime(from), enddatetime: gdeltTime(to) }).toString();
    const result = await evidenceRequest(url, 'GDELT DOC 2.0', options);
    Object.assign(receipt, { status: result.status, observedAt: result.observedAt,
      ...(result.httpStatus ? { httpStatus: result.httpStatus, retryAfter: result.retryAfter } : {}) });
    newsCoverage.push({ archive: ARCHIVE, billId: id, from: receipt.searchedFrom, to: receipt.searchedTo,
      complete: false, basis: 'bounded-exact-bill-alias-discovery; historical completeness unknown' });
    if (!result.ok) {
      gaps.push({ code: result.status, provider: 'GDELT DOC 2.0', billId: id,
        message: `News discovery is ${result.status}; no missing articles were synthesized.` });
      continue;
    }
    sources.push(result.source); receipt.sourceHash = result.source.contentHash; receipt.url = result.source.url;
    const articles = result.payload?.articles;
    if (!Array.isArray(articles)) {
      receipt.status = 'invalid-response';
      gaps.push({ code: receipt.status, provider: 'GDELT DOC 2.0', billId: id, message: 'Expected an articles array; no news availability conclusion can be drawn.' });
      continue;
    }
    receipt.retrieved = articles.length; receipt.capped = articles.length >= maxRecords;
    receipt.status = receipt.capped ? 'capped' : articles.length ? 'retrieved' : 'zero-results';
    const seen = new Set();
    for (const article of articles.slice(0, maxRecords)) {
      const sourceUrl = safeUrl(article.url);
      if (!sourceUrl) { receipt.invalidUrl++; continue; }
      const sourceHash = evidenceHash(article); const sourceRecordId = `${ARCHIVE}:${id}:${evidenceHash(sourceUrl).slice(0, 24)}`;
      const record = { id: `${sourceRecordId}:${sourceHash.slice(0, 16)}`, sourceRecordId, sourceHash };
      if (seen.has(record.id)) { receipt.duplicates++; continue; } seen.add(record.id);
      let firstSeenAt = archiveTime(article.seendate);
      if (firstSeenAt && Date.parse(firstSeenAt) > Date.parse(result.observedAt)) firstSeenAt = null;
      if (!firstSeenAt) receipt.invalidTimestamp++;
      const headlineMatch = receipt.searchTerms.some(term => String(article.title || '').toLowerCase().includes(term.toLowerCase()));
      news.push({ ...record, billId: id, publishedAt: null, firstSeenAt,
        collectorFirstSeenAt: preservedObservation((options.previous?.news || []).map(item => ({ ...item, firstSeenAt: item.collectorFirstSeenAt })), record, result.observedAt),
        sourceUrl, title: String(article.title || ''), archive: ARCHIVE,
        timingBasis: firstSeenAt ? 'archive-first-seen' : 'unknown', coverageFrom: receipt.searchedFrom,
        coverageTo: receipt.searchedTo, matchStatus: headlineMatch ? 'headline-alias-match' : 'unverified-query-match',
        matchBasis: 'provider-exact-bill-alias-query; Congress and event association unverified' });
      receipt.retained++;
    }
    gaps.push({ code: 'news-timing-and-identity-unverified', provider: 'GDELT DOC 2.0', billId: id,
      message: 'GDELT observation time is not original publication or global first coverage. Bill-number aliases may recur across Congresses; candidate articles need verified event association.' });
  }
  gaps.push({ code: 'news-coverage-unknown', provider: 'GDELT DOC 2.0',
    message: 'Bounded ArtList discovery (operational 90-day lookback, maximum 250 results per bill) cannot certify the requested historical window or absence of earlier news.' });
  return { news, sources, manifest, gaps, newsCoverage };
}
