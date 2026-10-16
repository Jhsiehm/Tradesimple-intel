/** Immutable researcher-supplied relationship assertions with effective and knowledge dates. */
import { researchStore, hashOf, newId } from './research-store.mjs';
import { timestamp } from './research-events.mjs';
import { getSourceDocument } from './source-documents.mjs';
const ready = new WeakSet();
const predicates = new Set(['owns', 'operates', 'located-in', 'regulated-by', 'member-of', 'issued-by', 'exposed-to']);
const entityPattern = /^(company|security|facility|jurisdiction|agency|institution|person|industry|policy):[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const caveats = [
  'Relationships and public-availability dates are researcher assertions, not independently verified facts.',
  'Effective intervals include the start and exclude the end. Date-only availability is conservatively known at the end of that UTC day.',
  'A lookup resolves revisions using only assertions available by the knowledge cutoff, then applies the effective-date interval.',
  'Conflicting latest revisions are excluded and reported as ambiguous; missing relationships do not prove absence.',
  'Current ticker identity mappings are unchanged. This registry does not certify historical market-universe completeness.'
];
function ensure(db) {
  researchStore(db); if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.relationship_snapshots (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, content_hash TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(name,version), UNIQUE(name,content_hash));
    CREATE TRIGGER IF NOT EXISTS research.relationship_snapshots_update BEFORE UPDATE ON relationship_snapshots BEGIN SELECT RAISE(ABORT, 'Relationship snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS research.relationship_snapshots_delete BEFORE DELETE ON relationship_snapshots BEGIN SELECT RAISE(ABORT, 'Relationship snapshots are immutable'); END;`);
  ready.add(db);
}
function date(value, field) {
  const parsed = timestamp(value);
  if (!parsed || parsed.precision !== 'day') throw new Error(`${field} must be YYYY-MM-DD.`);
  return parsed.value;
}
function key(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${field} must contain 1–200 characters.`);
  return value.trim();
}
const knownMillis = parsed => Date.parse(parsed.value) + (parsed.precision === 'day' ? 86400000 - 1 : 0);
export function importRelationships(db, body, { now = new Date().toISOString() } = {}) {
  const name = key(body?.name, 'Snapshot name');
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 5000) throw new Error('Import 1–5,000 relationship assertions.');
  const nowTime = timestamp(now);
  if (!nowTime) throw new Error('Invalid import time.');
  const ids = new Set(), identities = new Map();
  const rows = body.rows.map((raw, index) => {
    const error = message => { throw new Error(`Row ${index + 1}: ${message}`); };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) error('Assertion object required.');
    const id = key(raw.id, 'Assertion ID'), relationshipId = key(raw.relationshipId, 'Relationship ID');
    if (ids.has(id)) error('Assertion IDs must be unique.'); ids.add(id);
    for (const field of ['subject','object']) if (typeof raw[field] !== 'string' || !entityPattern.test(raw[field])) error(`${field} must be a typed stable entity ID.`);
    if (!predicates.has(raw.predicate)) error('Unsupported relationship predicate.');
    const identity = `${raw.subject}|${raw.predicate}`;
    if (identities.has(relationshipId) && identities.get(relationshipId) !== identity) error('Revisions of a relationship must keep the same subject and predicate.');
    identities.set(relationshipId, identity);
    const effectiveFrom = date(raw.effectiveFrom, 'effectiveFrom');
    const effectiveTo = raw.effectiveTo == null || raw.effectiveTo === '' ? null : date(raw.effectiveTo, 'effectiveTo');
    if (effectiveTo && effectiveTo <= effectiveFrom) error('effectiveTo must follow effectiveFrom.');
    const available = timestamp(raw.availableAt);
    if (!available) error('availableAt requires a UTC timestamp or date.');
    if (Date.parse(available.value) > Date.parse(nowTime.value)) error('Availability cannot be in the future.');
    const status = raw.status || 'asserted';
    if (!['asserted','retracted'].includes(status)) error('Status must be asserted or retracted.');
    let url;
    try { url = new URL(raw.sourceUrl); } catch { error('Evidence source URL required.'); }
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || raw.sourceUrl.length > 2000) error('Evidence URL must be HTTP(S) without credentials.');
    const documentHash = raw.documentHash || null;
    if (documentHash) {
      if (typeof documentHash !== 'string' || !/^[a-f0-9]{64}$/.test(documentHash)) error('documentHash must be a SHA-256 reference.');
      const document = getSourceDocument(db, documentHash);
      if (document.url !== raw.sourceUrl) error('Archived evidence URL does not match sourceUrl.');
    }
    const weighted = raw.exposureWeight !== undefined;
    if (weighted && (typeof raw.exposureWeight !== 'number' || !Number.isFinite(raw.exposureWeight) || raw.exposureWeight < 0 || raw.exposureWeight > 1)) error('exposureWeight must be a number from 0 to 1.');
    if (weighted && (typeof raw.weightBasis !== 'string' || !raw.weightBasis.trim() || raw.weightBasis.length > 1000)) error('Explain the asserted weightBasis in 1–1,000 characters.');
    if (!weighted && raw.weightBasis !== undefined) error('weightBasis requires an explicit exposureWeight.');
    return { ...(weighted ? {exposureWeight:raw.exposureWeight,weightBasis:raw.weightBasis.trim()} : {}), id, relationshipId, subject: raw.subject, predicate: raw.predicate, object: raw.object, effectiveFrom, effectiveTo, availableAt: available.value, availabilityPrecision: available.precision, status, sourceUrl: raw.sourceUrl, documentHash, availabilityBasis: 'researcher-asserted; not independently verified' };
  }).sort((a,b) => a.id.localeCompare(b.id));
  ensure(db);
  const contentHash = hashOf(rows);
  const existing = db.prepare('SELECT id FROM research.relationship_snapshots WHERE name=? AND content_hash=?').get(name, contentHash);
  if (existing) return getRelationshipSnapshot(db, existing.id);
  const version = db.prepare('SELECT COALESCE(MAX(version),0)+1 AS n FROM research.relationship_snapshots WHERE name=?').get(name).n;
  const snapshot = { id: newId('rel'), schemaVersion: rows.some(r=>r.exposureWeight!==undefined)?2:1, name, version, createdAt: now, contentHash, rows, caveats };
  const text = JSON.stringify(snapshot);
  db.prepare('INSERT INTO research.relationship_snapshots VALUES (?,?,?,?,?,?,?)').run(snapshot.id,name,version,now,contentHash,hashOf(text),text);
  return snapshot;
}
export function getRelationshipSnapshot(db,id) {
  ensure(db);
  const row = db.prepare('SELECT body,body_hash FROM research.relationship_snapshots WHERE id=?').get(id);
  if (!row) throw new Error('Relationship snapshot not found.');
  if (hashOf(row.body) !== row.body_hash) throw new Error('Relationship snapshot checksum mismatch.');
  const snapshot = JSON.parse(row.body);
  if (hashOf(snapshot.rows) !== snapshot.contentHash) throw new Error('Relationship content checksum mismatch.');
  return snapshot;
}
export function listRelationshipSnapshots(db) {
  ensure(db);
  return db.prepare("SELECT id,name,version,created_at AS createdAt,content_hash AS contentHash,json_array_length(body,'$.rows') AS rows FROM research.relationship_snapshots ORDER BY created_at DESC,id DESC LIMIT 500").all();
}
export function queryRelationships(db,id,{effectiveAt,knownAt,subject='',predicate=''}={}) {
  return resolveRelationships(getRelationshipSnapshot(db,id), {effectiveAt,knownAt,subject,predicate});
}
export function resolveRelationships(snapshot,{effectiveAt,knownAt,subject='',predicate=''}={}) {
  effectiveAt = date(effectiveAt,'effectiveAt');
  const known = timestamp(knownAt);
  if (!known) throw new Error('knownAt requires a UTC timestamp or date.');
  if (subject && !entityPattern.test(subject)) throw new Error('subject must be a typed stable entity ID.');
  if (predicate && !predicates.has(predicate)) throw new Error('Unsupported relationship predicate.');
  const groups = new Map();
  for (const row of snapshot.rows) {
    if ((subject && row.subject !== subject) || (predicate && row.predicate !== predicate)) continue;
    const at = knownMillis(timestamp(row.availableAt));
    if (at > knownMillis(known)) continue;
    const prior = groups.get(row.relationshipId);
    if (!prior || at > prior.at) groups.set(row.relationshipId,{at,rows:[row]});
    else if (at === prior.at) prior.rows.push(row);
  }
  const items = [], ambiguous = [];
  for (const [relationshipId,group] of groups) {
    if (group.rows.length > 1) { ambiguous.push({relationshipId,assertionIds:group.rows.map(r=>r.id),reason:'Conflicting assertions at the latest available time.'}); continue; }
    const row = group.rows[0];
    if (row.status === 'retracted' || row.effectiveFrom > effectiveAt || (row.effectiveTo && effectiveAt >= row.effectiveTo)) continue;
    items.push(row);
  }
  return { snapshotId:snapshot.id,contentHash:snapshot.contentHash,effectiveAt,knownAt:known.value,items,ambiguous,caveats:snapshot.caveats };
}

/** Resolve a bounded, directed chain with a common effective date and knowledge cutoff. */
export function resolveRelationshipPath(snapshot, {subject, policy, effectiveAt, knownAt}) {
  const path = policy.path || [policy.predicate];
  if (!Array.isArray(path) || !path.length || path.length > 4 || path[0] !== policy.predicate || path.some(p=>!predicates.has(p))) throw new Error('Invalid relationship path.');
  if (!entityPattern.test(subject) || !entityPattern.test(policy.object)) throw new Error('Relationship path requires typed endpoints.');
  const weighted = policy.minPathWeight !== undefined;
  if (weighted && (typeof policy.minPathWeight !== 'number' || !Number.isFinite(policy.minPathWeight) || policy.minPathWeight<0 || policy.minPathWeight>1)) throw Error('Minimum path weight must be between 0 and 1.');
  let frontier = new Map([[subject,{nodes:[subject],assertionIds:[],...(weighted?{weight:1}:{})}]]);
  const ambiguous = [];
  for (let step=0;step<path.length;step++) {
    // Resolve this predicate once, then index by subject to bound work by snapshot size.
    const lookup = resolveRelationships(snapshot,{predicate:path[step],effectiveAt,knownAt});
    const bySubject = new Map();
    for (const row of lookup.items) {
      if (!bySubject.has(row.subject)) bySubject.set(row.subject,[]);
      bySubject.get(row.subject).push(row);
    }
    const assertionSubjects = new Map(snapshot.rows.map(row=>[row.id,row.subject]));
    for (const conflict of lookup.ambiguous) if (conflict.assertionIds.some(id=>frontier.has(assertionSubjects.get(id)))) ambiguous.push({...conflict,step:step+1,predicate:path[step]});
    const next = new Map();
    for (const [entity,witness] of frontier) for (const row of bySubject.get(entity) || []) {
      // Nonnegative products allow retaining only the strongest fully weighted prefix.
      if(weighted && (typeof row.exposureWeight!=='number' || !Number.isFinite(row.exposureWeight) || row.exposureWeight<0 || row.exposureWeight>1)) continue;
      const weight=weighted?witness.weight*row.exposureWeight:undefined;
      if (!next.has(row.object) || (weighted && weight>next.get(row.object).weight)) next.set(row.object,{nodes:[...witness.nodes,row.object],assertionIds:[...witness.assertionIds,row.id],...(weighted?{weight}:{})});
    }
    frontier=next;
    if (!frontier.size) break;
  }
  const witness=frontier.get(policy.object);
  return {matched:Boolean(witness)&&(!weighted||witness.weight>=policy.minPathWeight),witness:witness || null,ambiguous};
}

/** Eligibility is evaluated at each signal's public day, before entry and before caps. */
export function relationshipEligibility(db, signals, policy) {
  const snapshot = getRelationshipSnapshot(db, policy.snapshotId);
  const kept = [], decisions = [], cache = new Map();
  for (const signal of signals) {
    const subject = policy.subjects[signal.symbol];
    let lookup;
    if (subject) {
      const key = JSON.stringify([subject, signal.signalDate]);
      if (!cache.has(key)) cache.set(key, resolveRelationshipPath(snapshot, {subject,policy,effectiveAt:signal.signalDate,knownAt:signal.signalDate}));
      lookup = cache.get(key);
    }
    const reason = !subject ? 'unmapped-symbol' : lookup.ambiguous.length ? 'ambiguous-relationship' : !lookup.matched ? (policy.minPathWeight!==undefined?(lookup.witness?'insufficient-path-weight':'no-known-weighted-match'):'no-known-effective-match') : 'eligible';
    if (reason === 'eligible') kept.push(signal);
    decisions.push({...(policy.minPathWeight!==undefined?{pathWeight:lookup?.witness?.weight??null}:{}),signalId:signal.id,symbol:signal.symbol,subject:subject || null,effectiveAt:signal.signalDate,knownAt:signal.signalDate,reason,assertionIds:lookup?.witness?.assertionIds || [],path:lookup?.witness?.nodes || [],ambiguous:lookup?.ambiguous || []});
  }
  return {signals:kept, report:{schemaVersion:policy.minPathWeight!==undefined?3:2,policy,snapshot,received:signals.length,eligible:kept.length,excluded:signals.length-kept.length,decisions,caveats:[...snapshot.caveats,...(policy.minPathWeight!==undefined?['Path weight multiplies explicitly asserted edge weights; missing weights never default to one. The strongest fully weighted path is compared to the threshold, without summing alternative paths. Weights and their compatibility are research assumptions, not verified ownership, aggregate exposure or position sizing.']:[]),'Symbol-to-subject mappings are explicitly supplied by the researcher; historical identity validity is not independently verified.','Eligibility uses the end of the signal publication day, with entry on a later trading day.','Paths are directed and limited to four edges. Each edge uses the same dates. Any ambiguous revision on a visited branch excludes the signal; one deterministic witness per endpoint is retained.']}};
}
