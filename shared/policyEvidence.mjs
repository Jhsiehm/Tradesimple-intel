import {policyDate, policyInstant} from './policyProtocol.mjs';
export const MINUTE = 60_000;
export function policyDay(value) {
  if (policyDate(value)) return value;
  return policyInstant(value) === null ? null : new Date(value).toISOString().slice(0, 10);
}
export function cited(record) {
  if (!record || typeof record.sourceUrl !== 'string') return false;
  try { return ['https:', 'http:'].includes(new URL(record.sourceUrl).protocol); } catch { return false; }
}
export function policyAvailability(event, protocol) {
  if (!['day', 'instant'].includes(event.eventPrecision) || (event.eventPrecision === 'instant' && policyInstant(event.eventAt) === null)) return {error: 'The legislative action precision or timestamp is invalid.'};
  if (!cited(event) || typeof event.sourceHash !== 'string' || !event.sourceHash || typeof event.sourceRecordId !== 'string' || !event.sourceRecordId) return {error: 'Event citation, source record ID, or source hash is missing.'};
  if (event.availabilityBasis === 'collector-first-seen') {
    const observed = policyInstant(event.firstSeenAt);
    if (observed === null || observed < Date.parse(protocol.registeredAt)) return {error: 'Collector observation cannot establish retrospective public availability; only observations after registration are eligible.'};
    if ((event.eventPrecision === 'instant' && policyInstant(event.eventAt) !== null && observed < policyInstant(event.eventAt)) || (policyDay(event.eventAt) && new Date(observed).toISOString().slice(0, 10) < policyDay(event.eventAt))) return {error: 'Collector observation precedes the legislative action; future scheduled actions are not completed signals.'};
    return {at: observed, basis: 'collector-first-seen', asserted: false};
  }
  if (!['verified-publication', 'importer-asserted'].includes(event.availabilityBasis) || event.publicPrecision !== 'instant' || policyInstant(event.publicAt) === null) return {error: 'Exact public availability is unknown; an action date cannot substitute for public release.'};
  const at = policyInstant(event.publicAt);
  if (event.eventPrecision === 'instant' && policyInstant(event.eventAt) !== null && at < policyInstant(event.eventAt)) return {error: 'Action content is claimed publicly available before the action occurred.'};
  if (policyDay(event.eventAt) && new Date(at).toISOString().slice(0, 10) < policyDay(event.eventAt)) return {error: 'Public release precedes the legislative action date.'};
  return {at, basis: event.availabilityBasis, asserted: event.availabilityBasis === 'importer-asserted'};
}
function coverageBoundary(value, end = false) {
  return policyDate(value) ? Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`) : policyInstant(value);
}
/** Coverage is an explicit researcher assertion, never inferred from a successful news query. */
export function policyNewsCoverage(protocol, evidence, from, to, event) {
  const intervals = [...(Array.isArray(evidence.newsCoverage) ? evidence.newsCoverage : []),
    ...(Array.isArray(evidence.news) ? evidence.news.filter(n => n.coverageComplete === true).map(n => ({archive: n.archive, eventId: n.eventId, billId: n.billId, from: n.coverageFrom, to: n.coverageTo, complete: true})) : [])];
  return intervals.some(c => (c.scope === 'archive-global' || (event && (c.eventId ? c.eventId === event.id : c.billId === event.billId))) && c.archive === protocol.newsArchive && c.complete === true && coverageBoundary(c.from) !== null && coverageBoundary(c.to, true) !== null && coverageBoundary(c.from) <= from && coverageBoundary(c.to, true) >= to);
}
export function earliestPolicyNews(event, protocol, evidence) {
  const matching = (evidence.news || []).filter(n => n.archive === protocol.newsArchive && n.eventId === event.id && n.reviewed === true);
  if (!matching.length) return {error: 'No reviewed article explicitly associated with this event in the named archive; query matches or missing records cannot establish earliest news.'};
  const timed = [];
  for (const news of matching) {
    if (news.billId !== event.billId) return {error: 'A reviewed news association contradicts the legislative bill ID.'};
    if (typeof news.id !== 'string' || !news.id || !cited(news) || typeof news.sourceHash !== 'string' || !news.sourceHash) return {error: 'Matching news is missing citation or source hash; earliest coverage cannot be established.'};
    if (protocol.newsTimeBasis === 'publication' && policyInstant(news.publishedAt) !== null && policyInstant(news.firstSeenAt) !== null && policyInstant(news.publishedAt) > policyInstant(news.firstSeenAt)) return {error: 'Claimed publication is later than archive observation of the same article; original publication versus revision timing is unresolved.'};
    const value = protocol.newsTimeBasis === 'publication' ? news.publishedAt : news.firstSeenAt;
    const at = policyInstant(value);
    if (at === null || (protocol.newsTimeBasis === 'publication' && !['verified-publication', 'importer-asserted'].includes(news.timingBasis))) return {error: 'A matching article lacks an exact, eligible timestamp for the selected news timing basis.'};
    timed.push({news, at});
  }
  timed.sort((a, b) => a.at - b.at || String(a.news.id).localeCompare(String(b.news.id)));
  return timed[0];
}
export function policyExposure(event, symbol, at, evidence) {
  const matches = (evidence.exposures || []).filter(e => e.symbol === symbol && (e.eventId ? e.eventId === event.id : e.billId === event.billId));
  if (!matches.length) return {error: 'No predefined company exposure mapping.'};
  const valid = matches.filter(e => typeof e.id === 'string' && e.id && e.reviewed === true && ['long', 'short'].includes(e.side) && cited(e) && typeof e.rationale === 'string' && e.rationale.trim()
    && (!e.billId || e.billId === event.billId) && policyInstant(e.knownAt) !== null && policyInstant(e.knownAt) < at && coverageBoundary(e.validFrom) !== null && coverageBoundary(e.validFrom) <= at
    && (e.validTo == null || (coverageBoundary(e.validTo, true) !== null && coverageBoundary(e.validTo, true) >= at)));
  if (valid.length !== 1) return {error: valid.length ? 'Multiple eligible exposure mappings make the trading direction ambiguous.' : 'Exposure lacks prior knowledge, validity, review, or a cited directional rationale.'};
  return {exposure: valid[0]};
}
const sessionFormatter = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export function policySessionMinute(at) {
  const parts = Object.fromEntries(sessionFormatter.formatToParts(new Date(at)).map(p => [p.type, p.value]));
  const time = Number(parts.hour) * 60 + Number(parts.minute);
  return !['Sat', 'Sun'].includes(parts.weekday) && time >= 570 && time < 960;
}
/** Exact minute starts only: no jumping to a later session, interpolation, or daily bars. */
export function policyBarIndex(bars) {
  const index = new Map(), conflicts = new Set();
  for (const b of bars || []) {
    const at = policyInstant(b?.at);
    if (at === null || at % MINUTE || b.intervalMinutes !== 1 || typeof b.symbol !== 'string' || !Number.isFinite(b.open) || !Number.isFinite(b.close) || b.open <= 0 || b.close <= 0) continue;
    const key = `${b.symbol}:${at}`;
    if (index.has(key)) { conflicts.add(key); index.delete(key); }
    else if (!conflicts.has(key)) index.set(key, b);
  }
  return {index, conflicts};
}
export function policyPriceWindow(index, symbol, entry, minutes) {
  for (let i = 0; i < minutes; i++) {
    const at = entry + i * MINUTE;
    if (!policySessionMinute(at) || !index.has(`${symbol}:${at}`)) return null;
  }
  return {entry: index.get(`${symbol}:${entry}`).open, exit: index.get(`${symbol}:${entry + (minutes - 1) * MINUTE}`).close};
}
