import { evidenceHash, preservedObservation } from './evidenceHttp.mjs';

export function parsePolicyBillId(value) {
  const match = String(value).toLowerCase().match(/^(hr|s|hjres|sjres|hconres|sconres|hres|sres)-(\d{1,3})-([1-9]\d{0,5})$/);
  return match ? { id: match[0], type: match[1], congress: Number(match[2]), number: match[3] } : null;
}

export function actionTypes(action) {
  const text = String(action.text || '').toLowerCase(); const kinds = [];
  if (/became (?:public|private) law|signed by president|enacted/.test(text)) kinds.push('enacted');
  if (/\bpassed\b|agreed to (?:in|by) (?:house|senate)/.test(text)) kinds.push('passed');
  if (/\bmarkup\b|\bmark-up\b|ordered to be reported|committee consideration and mark/.test(text)) kinds.push('markup');
  if (String(action.actionCode) === '1000' || /\bintroduced\b/.test(text)) kinds.push('introduced');
  if (action.recordedVotes?.length || /\b(?:yeas|nays|roll call|recorded vote|voice vote|vote on)\b/.test(text)) kinds.push('vote');
  return kinds;
}

function actionTimestamp(action, types) {
  const date = action.actionDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  const time = String(action.actionTime || '');
  // House actionTime often lacks an offset. Preserve it raw, never assume UTC.
  if (/^\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(time)) {
    const instant = Date.parse(`${date}T${time}`);
    if (Number.isFinite(instant)) return { eventAt: new Date(instant).toISOString(), eventPrecision: 'instant' };
  }
  const votes = action.recordedVotes || [];
  if (types.includes('vote') && votes.length === 1 && /T.+(?:Z|[+-]\d{2}:\d{2})$/.test(votes[0].date || '')) {
    const instant = Date.parse(votes[0].date);
    if (Number.isFinite(instant)) return { eventAt: new Date(instant).toISOString(), eventPrecision: 'instant' };
  }
  return { eventAt: date, eventPrecision: 'day' };
}

export function normalizePolicyAction(action, bill, observedAt, previous = []) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const types = actionTypes(action); const timing = actionTimestamp(action, types);
  if (!timing) return null;
  const identity = { billId: bill.id, date: action.actionDate, time: action.actionTime || '',
    code: action.actionCode || '', type: action.type || '', source: action.sourceSystem?.code ?? '',
    rolls: (action.recordedVotes || []).map(v => `${v.chamber}:${v.congress}:${v.sessionNumber}:${v.rollNumber}`).sort() };
  const sourceHash = evidenceHash(action);
  const sourceRecordId = `congress:${bill.id}:${evidenceHash(identity).slice(0, 24)}`;
  const record = { id: `${sourceRecordId}:${sourceHash.slice(0, 16)}`, sourceRecordId, sourceHash };
  return { ...record, billId: bill.id, type: types[0] || 'other', eventTypes: types,
    title: String(action.text || ''), ...timing, sourceEventDate: action.actionDate,
    sourceEventTime: action.actionTime || null, publicAt: null, publicPrecision: null,
    availabilityBasis: 'collector-first-seen', firstSeenAt: preservedObservation(previous, record, observedAt),
    sourceUrl: `https://www.congress.gov/bill/${bill.congress}th-congress/${bill.type === 'hr' ? 'house-bill' : bill.type === 's' ? 'senate-bill' : ({ hjres: 'house-joint-resolution', sjres: 'senate-joint-resolution', hconres: 'house-concurrent-resolution', sconres: 'senate-concurrent-resolution', hres: 'house-resolution', sres: 'senate-resolution' })[bill.type]}/${bill.number}/all-actions` };
}
