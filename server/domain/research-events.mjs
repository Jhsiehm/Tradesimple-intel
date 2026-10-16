/** Event contract v1: event time, public availability and ingestion time are distinct. */
import { listTickers } from '../lib/db.mjs';
import { hashOf, putDataset } from './research-store.mjs';
export const IMPORT_LIMIT = 2 * 1024 * 1024;
export const ROW_LIMIT = 5000;
export const FIELDS = ['id', 'symbol', 'eventAt', 'availableAt', 'side', 'sourceUrl', 'value'];
export function timestamp(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!day && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  const n = Date.parse(day ? `${s}T00:00:00Z` : s);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== s.slice(0, 10)) return null;
  return { value: day ? s : new Date(n).toISOString(), precision: day ? 'day' : 'instant' };
}
export function identities(db) {
  const rows = listTickers(db).map(t => ({ symbol: t.symbol, securityId: `ticker:${t.symbol}`, companyId: t.cik ? `cik:${String(t.cik).replace(/^0+/, '')}` : null, name: t.name, sector: t.sector, basis: t.joinBasis || 'data/tickers.json' }));
  return { version: hashOf(rows), basis: 'Current ticker registry snapshot; historical validity is not established.', rows };
}
export function signalEvents(signals, source, identity, ingestedAt) {
  const by = new Map(identity.rows.map(x => [x.symbol, x]));
  return signals.map(s => ({ schemaVersion: 1, id: `${source}:${s.id}`, sourceRecordId: s.id, source, entity: by.get(s.symbol) || { securityId: `ticker:${s.symbol}`, companyId: null, symbol: s.symbol }, eventAt: s.tradeDate || null, availableAt: s.signalDate, availabilityPrecision: 'day', availabilityBasis: source === 'contracts' ? 'assumed-publication-lag' : 'source-derived-public-date', ingestedAt, identityVersion: identity.version }));
}
/** RFC4180-style CSV with quoted commas/newlines, escaped quotes, BOM and CRLF. */
export function parseCsv(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > IMPORT_LIMIT) throw new Error('CSV must be at most 2 MiB.');
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error('Unexpected quote in CSV.');
      quoted = true;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else { if (closed) throw new Error('Unexpected text after a closing CSV quote.'); cell += c; }
    if (rows.length > ROW_LIMIT + 1) throw new Error('At most 5,000 rows per import.');
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  const headers = (rows.shift() || []).map(h => h.trim());
  if (!headers.length || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('CSV requires unique, nonempty column headers.');
  return { headers, rows: rows.map((r, i) => { if (r.length !== headers.length) throw new Error(`CSV row ${i + 2} has ${r.length} cells; expected ${headers.length}.`); return Object.fromEntries(headers.map((h, j) => [h, r[j]])); }) };
}
export function prepareDataset(db, request, { now = new Date().toISOString() } = {}) {
  const { name, source, mapping = {}, format = 'csv', content } = request || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new Error('Dataset name is required (up to 120 characters).');
  if (typeof source !== 'string' || !source.trim() || source.length > 300) throw new Error('Source label is required (up to 300 characters).');
  if (typeof content !== 'string' || Buffer.byteLength(content) > IMPORT_LIMIT) throw new Error('Import must be at most 2 MiB.');
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Column mapping must be an object.');
  let parsed;
  if (format === 'csv') parsed = parseCsv(content);
  else if (format === 'json') {
    const json = JSON.parse(content); const rows = Array.isArray(json) ? json : json?.items;
    if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw new Error('JSON must be an array of row objects or {items: [...]}.');
    parsed = { rows, headers: [...new Set(rows.flatMap(Object.keys))] };
  } else throw new Error('Format must be csv or json.');
  if (!parsed.rows.length || parsed.rows.length > ROW_LIMIT) throw new Error('Import between 1 and 5,000 rows.');
  const identity = identities(db), by = new Map(identity.rows.map(t => [t.symbol, t]));
  const errors = [], events = [], ids = new Set();
  let errorCount = 0;
  const error = (row, field, message) => { errorCount++; if (errors.length < 100) errors.push({ row, field, message }); };
  const map = Object.fromEntries(FIELDS.map(f => [f, typeof mapping[f] === 'string' ? mapping[f] : f]));
  parsed.rows.forEach((raw, i) => {
    const row = i + 1, start = errorCount;
    const get = f => raw[map[f]];
    const id = String(get('id') ?? '').trim(), symbol = String(get('symbol') ?? '').trim().toUpperCase();
    const side = String(get('side') ?? '').trim().toLowerCase();
    const event = timestamp(get('eventAt')), available = timestamp(get('availableAt'));
    if (!id || id.length > 200 || ids.has(id)) error(row, 'id', 'Provide a unique record ID (up to 200 characters).');
    ids.add(id);
    if (!by.has(symbol)) error(row, 'symbol', 'Symbol is not an exact match in the current ticker registry. No fuzzy joins are made.');
    if (!event) error(row, 'eventAt', 'Use YYYY-MM-DD or a UTC ISO timestamp ending in Z.');
    if (!available) error(row, 'availableAt', 'A public-availability date is required; event time is never substituted.');
    if (event && available && Date.parse(available.value) < Date.parse(event.value)) error(row, 'availableAt', 'Transaction availability cannot precede the event.');
    if (available && (available.precision === 'day' ? available.value > now.slice(0, 10) : Date.parse(available.value) > Date.parse(now))) error(row, 'availableAt', 'Future availability cannot enter a historical dataset.');
    if (!['buy', 'sell'].includes(side)) error(row, 'side', 'Use buy or sell.');
    const value = get('value') == null || get('value') === '' ? null : Number(get('value'));
    if (value !== null && (!Number.isFinite(value) || value <= 0)) error(row, 'value', 'Value must be positive, or blank for equal weighting.');
    const sourceUrl = String(get('sourceUrl') || '').trim();
    if (sourceUrl) { try { const u = new URL(sourceUrl); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || sourceUrl.length > 2000) throw Error(); } catch { error(row, 'sourceUrl', 'Use an HTTP(S) source URL without credentials.'); } }
    if (start === errorCount) events.push({ schemaVersion: 1, id, sourceRecordId: id, source: source.trim(), sourceUrl: sourceUrl || null, entity: by.get(symbol), eventAt: event.value, availableAt: available.value, availabilityPrecision: available.precision, availabilityBasis: 'importer-asserted; not independently verified', ingestedAt: now, identityVersion: identity.version, side, value, original: raw });
  });
  const dates = events.map(e => e.availableAt).sort();
  const payload = { schemaVersion: 1, source: source.trim(), format, mapping: map, rawContent: content, rawHash: hashOf(content), identity, events, coverage: { received: parsed.rows.length, valid: events.length, rejected: parsed.rows.length - events.length, from: dates[0] || null, to: dates.at(-1) || null, missingSourceUrls: events.filter(e => !e.sourceUrl).length }, caveats: ['Imported availability is asserted by the importer, not independently verified.', 'Entity mappings reflect the current ticker registry, not a historical security master.', 'Date-only availability is treated conservatively: entry is on a later trading day.'] };
  return { ok: errorCount === 0, headers: parsed.headers, errors, errorCount, preview: events.slice(0, 10), coverage: payload.coverage, payload, contentHash: hashOf({ raw: content, mapping: map, source: source.trim(), identity: identity.version }), name: name.trim() };
}
export function importDataset(db, request) {
  const p = prepareDataset(db, request);
  if (!p.ok) return { ...p, payload: undefined };
  return { ok: true, dataset: putDataset(db, p.name, p.payload, p.contentHash) };
}
export function datasetSource(dataset) {
  const notes = dataset.caveats.map((text, i) => ({ id: `import${i}`, level: 'warn', text }));
  const coverage = dataset.manifest?.coverage;
  if (coverage && (coverage.completed < coverage.partitions || coverage.ambiguousVersions > 0 || coverage.unmapped > 0 || coverage.missingAmounts > 0 || coverage.missingDates > 0)) {
    notes.push({ id: 'evidenceCoverage', level: 'warn', text: 'Frozen evidence has incomplete retrieval, ambiguous identities, unmapped recipients or missing fields. Review its coverage manifest before interpreting results.' });
  }
  const timing = dataset.manifest?.policy?.mode;
  const latency = timing ? `Frozen evidence; availability uses ${timing === 'assumed' ? 'an assumed publication delay' : timing === 'observed' ? 'collector first-observation dates, not original publication' : 'verified publication dates'}.` : 'Imported snapshot; public dates asserted by the importer.';
  return { identity: dataset.identity, signals: dataset.events.map(e => ({ id: `${dataset.id}:${e.id}`, symbol: e.entity.symbol, signalDate: e.availableAt.slice(0, 10), tradeDate: e.eventAt.slice(0, 10), side: e.side, sizeHint: e.value, sizeIsRange: false, actor: dataset.id, actorLabel: dataset.name, sector: e.entity.sector || '' })), records: dataset.events, context: { notes }, feeds: [{ label: dataset.name, source: dataset.source, asOf: dataset.createdAt, latency }], dataset: { id: dataset.id, name: dataset.name, version: dataset.version, contentHash: dataset.contentHash } };
}
