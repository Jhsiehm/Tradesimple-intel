import { createHash } from 'node:crypto';
/** Original fetched text/bytes and provider response JSON, independent of the disposable provider cache. */
import { researchStore, hashOf } from './research-store.mjs';
const ready = new WeakSet();
function ensure(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.source_documents (id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, body TEXT NOT NULL, observed_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS research.source_documents_update BEFORE UPDATE ON source_documents BEGIN SELECT RAISE(ABORT, 'Source documents are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS research.source_documents_delete BEFORE DELETE ON source_documents BEGIN SELECT RAISE(ABORT, 'Source documents are immutable'); END;`);
  ready.add(db);
}
export function preserveSourceDocument(db, { url, content, mediaType = 'text/plain' }) {
  const address = new URL(url);
  if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password) throw new Error('Source document URL must be HTTP(S) without credentials.');
  const binary = content instanceof Uint8Array;
  if ((!binary && typeof content !== 'string') || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('Source document must be text or bytes of at most 10 MiB.');
  ensure(db);
  const document = { url, mediaType, content: binary ? Buffer.from(content).toString('base64') : content, ...(binary ? { encoding: 'base64' } : {}), contentHash: createHash('sha256').update(content).digest('hex') };
  const body = JSON.stringify(document), hash = hashOf(body), observedAt = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO research.source_documents VALUES (?, ?, ?, ?)').run(hash, hash, body, observedAt);
  const stored = db.prepare('SELECT observed_at FROM research.source_documents WHERE id=?').get(hash);
  return { hash, contentHash: document.contentHash, url, observedAt: stored.observed_at, availabilityBasis: 'collector-observation; not original publication' };
}
export function getSourceDocument(db, hash) {
  ensure(db);
  const row = db.prepare('SELECT body_hash, body, observed_at FROM research.source_documents WHERE id=?').get(hash);
  if (!row) throw new Error('Original source document is missing. Restore a verified research backup.');
  if (hashOf(row.body) !== row.body_hash || row.body_hash !== hash) throw new Error('Source document checksum mismatch.');
  const document = JSON.parse(row.body);
  if (createHash('sha256').update(document.encoding === 'base64' ? Buffer.from(document.content, 'base64') : document.content).digest('hex') !== document.contentHash) throw new Error('Source content checksum mismatch.');
  return { ...document, observedAt: row.observed_at };
}
