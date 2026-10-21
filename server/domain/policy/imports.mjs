/** Evidence imports are researcher assertions, never a way to manufacture provider certification. */
import { hashOf } from '../research-store.mjs';
import { policyDate, policyInstant } from '../../../shared/policyProtocol.mjs';

export const POLICY_IMPORT_LIMIT = 6 * 1024 * 1024;
export const POLICY_ROW_LIMIT = 20000;
export const POLICY_EVIDENCE_LIMIT = 16 * 1024 * 1024;
export const POLICY_KINDS = ['events', 'news', 'exposures', 'bars', 'newsCoverage'];
export function assertPolicyEvidenceSize(evidence) {
  if (Buffer.byteLength(JSON.stringify(evidence)) > POLICY_EVIDENCE_LIMIT) throw Error('Combined evidence exceeds 16 MiB. Narrow the study or create separate investigations.');
}
const at = value => typeof value === 'string' && value.endsWith('Z') && policyInstant(value) !== null;
const dated = value => policyDate(value) || at(value);
const text = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function sourceUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && ![...url.searchParams.keys()].some(key => /^(?:api_?key|token|access_token)$/i.test(key));
  } catch { return false; }
}

function validateRow(kind, row, index) {
  const fail = reason => { throw Error(`Row ${index + 1}: ${reason}`); };
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('provide an evidence object.');
  if (kind !== 'bars' && kind !== 'newsCoverage' && !text(row.id, 300)) fail('provide a record ID of at most 300 characters.');
  if (kind === 'bars') {
    if (!text(row.symbol, 20) || !at(row.at) || row.intervalMinutes !== 1 || !Number.isFinite(row.open) || !Number.isFinite(row.close) || row.open <= 0 || row.close <= 0) fail('bars require symbol, UTC timestamp, positive open/close prices and intervalMinutes: 1.');
  } else if (kind === 'events') {
    if (!text(row.billId, 60) || !text(row.type, 60) || !text(row.sourceRecordId, 300) || !sourceUrl(row.sourceUrl)) fail('events require billId, type, sourceRecordId and a cited HTTP(S) source.');
    if (row.publicAt !== null && row.publicAt !== undefined && !at(row.publicAt)) fail('publicAt must be a UTC timestamp or null.');
    if (!dated(row.eventAt)) fail('eventAt must be a valid date or UTC timestamp.');
  } else if (kind === 'news') {
    if (!text(row.billId, 60) || !text(row.archive, 120) || !sourceUrl(row.sourceUrl)) fail('news requires billId, archive and sourceUrl.');
    if (row.publishedAt != null && !at(row.publishedAt)) fail('publishedAt must be a UTC timestamp or null.');
    if (row.firstSeenAt != null && !at(row.firstSeenAt)) fail('firstSeenAt must be a UTC timestamp or null.');
  } else if (kind === 'exposures') {
    if ((!text(row.eventId, 300) && !text(row.billId, 60)) || !text(row.symbol, 20) || !['long', 'short'].includes(row.side) || !at(row.knownAt) || !dated(row.validFrom) || (row.validTo != null && !dated(row.validTo)) || !sourceUrl(row.sourceUrl) || !text(row.rationale, 4000) || typeof row.reviewed !== 'boolean') fail('exposures require an event or bill, symbol, long/short side, knownAt, validFrom, citation, rationale and reviewed flag.');
  } else if (kind === 'newsCoverage') {
    if (!text(row.archive, 120) || !dated(row.from) || !dated(row.to) || Date.parse(row.from) > Date.parse(row.to) || typeof row.complete !== 'boolean' || (!text(row.eventId, 300) && !text(row.billId, 60) && row.scope !== 'archive-global')) fail('coverage requires archive, ordered from/to dates, a complete flag and eventId, billId or scope: archive-global.');
  }
}

export function evidenceKey(kind, row) {
  if (kind === 'bars') return `${row.symbol}:${row.at}`;
  if (kind === 'newsCoverage') return `${row.archive}:${row.eventId || ''}:${row.billId || ''}:${row.scope || ''}:${row.from}:${row.to}`;
  return row.id;
}

export function preparePolicyImport(kind, records, now) {
  if (!POLICY_KINDS.includes(kind)) throw Error('Choose events, news, exposures, bars or newsCoverage.');
  if (!Array.isArray(records) || records.length < 1 || records.length > POLICY_ROW_LIMIT) throw Error(`Import 1–${POLICY_ROW_LIMIT.toLocaleString('en-US')} evidence rows.`);
  if (Buffer.byteLength(JSON.stringify(records)) > POLICY_IMPORT_LIMIT) throw Error('Evidence import exceeds 6 MiB.');
  const rawHash = hashOf(records);
  const normalized = records.map((row, index) => {
    validateRow(kind, row, index);
    const value = { ...row, provenance: 'researcher-asserted', importedAt: now, importHash: rawHash, assertedPayloadHash: hashOf(row) };
    if (value.symbol) value.symbol = value.symbol.trim().toUpperCase();
    if (kind === 'events') {
      value.availabilityBasis = 'importer-asserted';
      value.sourceHash = hashOf(row);
      value.firstSeenAt = now;
    }
    if (kind === 'news') { value.timingBasis = 'importer-asserted'; value.sourceHash = hashOf(row); }
    if (kind === 'newsCoverage') value.basis = 'researcher-asserted; not independently audited';
    return value;
  });
  return { records: normalized, rawHash, source: { provider: 'Researcher import', kind, observedAt: now, contentHash: rawHash, payload: records } };
}

export function mergePolicyRows(kind, existing = [], incoming = [], { allowVersions = false } = {}) {
  const rows = new Map(existing.map(row => [evidenceKey(kind, row), row]));
  const comparable = ({ importedAt, ...row }) => row;
  for (const row of incoming) {
    const key = evidenceKey(kind, row), previous = rows.get(key);
    if (previous?.assertedPayloadHash && previous.assertedPayloadHash === row.assertedPayloadHash) continue;
    if (previous && hashOf(comparable(previous)) !== hashOf(comparable(row))) {
      if (!allowVersions) throw Error(`Conflicting ${kind} record ${key}. Create a new investigation for revised evidence.`);
    }
    rows.set(key, previous || row);
  }
  if (rows.size > POLICY_ROW_LIMIT) throw Error(`At most ${POLICY_ROW_LIMIT.toLocaleString('en-US')} rows per evidence type.`);
  return [...rows.values()];
}
