import {
  verifyConnectorEvidence,
  validConnectorTimestamp,
  validConnectorEndpoint,
  validConnectorPagination,
} from "./research-connector-evidence.mjs";
/** Durable bounded retrievals. Cached pages are revalidated through the normal connector reader. */
import { researchStore, hashOf, newId } from "./research-store.mjs";
import { connectorDescriptor, readConnector } from "./research-connectors.mjs";
import { fetchPinnedResponse } from "../lib/pinnedHttp.mjs";
const ready = new WeakSet(),
  running = new WeakMap();
function ensure(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.connector_retrievals(id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research.connector_pages(retrieval_id TEXT NOT NULL,page INTEGER NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(retrieval_id,page));
 CREATE TABLE IF NOT EXISTS research.connector_results(retrieval_id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,body TEXT NOT NULL);`);
  for (const table of ["connector_retrievals", "connector_pages", "connector_results"])
    for (const op of ["UPDATE", "DELETE"])
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS research.${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Connector checkpoints are immutable'); END;`,
      );
  ready.add(db);
}
function decode(row) {
  if (!row || hashOf(row.body) !== row.body_hash) throw Error("Connector checkpoint missing or corrupted.");
  return JSON.parse(row.body);
}
export function createRetrieval(db, connector, { env = process.env } = {}) {
  if (typeof connector !== "string" || !connector) throw Error("Choose a configured API connector.");
  ensure(db);
  const descriptor = connectorDescriptor(connector, env);
  const token = descriptor.credentialSlot ? env[descriptor.credentialSlot] || "" : "";
  if (token && JSON.stringify(descriptor).includes(token))
    throw Error("Connector descriptor contains its credential; retrieval refused.");
  if (!descriptor.pagination) throw Error("Connector resumable retrieval requires configured cursor pagination.");
  const job = {
    id: newId("retrieval"),
    connector,
    createdAt: new Date().toISOString(),
    configurationHash: hashOf(descriptor),
    endpoint: descriptor.endpoint,
    pagination: descriptor.pagination,
  };
  const body = JSON.stringify(job);
  db.prepare("INSERT INTO research.connector_retrievals VALUES (?,?,?)").run(job.id, hashOf(body), body);
  return getRetrieval(db, job.id);
}
export function verifyRetrievalRecords(job, pages, result) {
  if (
    !/^retrieval_[a-f0-9]+$/.test(job.id) ||
    typeof job.connector !== "string" ||
    !job.connector ||
    !validConnectorTimestamp(job.createdAt) ||
    !validConnectorEndpoint(job.endpoint) ||
    typeof job.configurationHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(job.configurationHash) ||
    pages.length > 20
  )
    throw Error("Connector retrieval metadata is invalid.");
  if (!validConnectorPagination(job.pagination) || pages.length > job.pagination.maxPages)
    throw Error("Connector checkpoint pagination is invalid.");
  let bytes = 0,
    cursor = null;
  const seen = new Set();
  for (const [i, page] of pages.entries()) {
    if (
      !validConnectorTimestamp(page.retrievedAt) ||
      page.page !== i + 1 ||
      typeof page.rawContent !== "string" ||
      hashOf(page.rawContent) !== page.responseHash ||
      !Number.isInteger(page.rows) ||
      page.rows < 0
    )
      throw Error("Connector checkpoint order or checksum mismatch.");
    const raw = JSON.parse(page.rawContent),
      rows = raw[job.pagination.itemsField],
      next = raw[job.pagination.nextCursorField];
    if (
      page.requestCursorHash !== (cursor === null ? null : hashOf(cursor)) ||
      !Array.isArray(rows) ||
      rows.some((r) => !r || typeof r !== "object" || Array.isArray(r)) ||
      rows.length !== page.rows ||
      (next !== null && (typeof next !== "string" || next.length > 2048)) ||
      (i < pages.length - 1 && (next === null || next === "")) ||
      (typeof next === "string" && next && seen.has(next))
    )
      throw Error("Connector checkpoint cursor chain mismatch.");
    if (next) seen.add(next);
    cursor = next;
    bytes += Buffer.byteLength(page.rawContent);
  }
  if (bytes > 2 * 1024 * 1024 || pages.reduce((n, p) => n + p.rows, 0) > 5000)
    throw Error("Connector checkpoints exceed import limits.");
  if (result) {
    if (Buffer.byteLength(result.content) > 2 * 1024 * 1024) throw Error("Connector result exceeds import limits.");
    const content = JSON.parse(result.content);
    verifyConnectorEvidence(content);
    if (
      content.connectorEvidence?.connector !== job.connector ||
      content.connectorEvidence.endpoint !== job.endpoint ||
      hashOf(content.connectorEvidence.pagination) !== hashOf(job.pagination) ||
      hashOf(content.connectorEvidence.pages) !== hashOf(pages) ||
      result.format !== "json" ||
      result.retrieval?.complete !== true ||
      result.retrieval.pages !== pages.length ||
      result.retrieval.rows !== content.items.length
    )
      throw Error("Connector result differs from its checkpoints.");
  }
}
export function getRetrieval(db, id) {
  ensure(db);
  const job = decode(db.prepare("SELECT * FROM research.connector_retrievals WHERE id=?").get(id));
  if (job.id !== id) throw Error("Connector retrieval identity mismatch.");
  const pages = db
    .prepare("SELECT * FROM research.connector_pages WHERE retrieval_id=? ORDER BY page")
    .all(id)
    .map(decode);
  const saved = db.prepare("SELECT * FROM research.connector_results WHERE retrieval_id=?").get(id);
  const result = saved ? decode(saved) : null;
  verifyRetrievalRecords(job, pages, result);
  return {
    ...job,
    status: saved ? "complete" : pages.length ? "partial" : "ready",
    pages: pages.length,
    rows: pages.reduce((sum, p) => sum + p.rows, 0),
    ...(saved ? { result } : {}),
  };
}
export function listRetrievals(db) {
  ensure(db);
  return db
    .prepare("SELECT id FROM research.connector_retrievals ORDER BY rowid DESC LIMIT 100")
    .all()
    .map(({ id }) => {
      const { result, ...job } = getRetrieval(db, id);
      return job;
    });
}
export async function resumeRetrieval(db, id, options = {}) {
  ensure(db);
  let active = running.get(db);
  if (!active) {
    active = new Set();
    running.set(db, active);
  }
  if (active.has(id)) throw Error("Connector retrieval is already running.");
  const job = getRetrieval(db, id);
  if (job.status === "complete") return { job };
  if (hashOf(connectorDescriptor(job.connector, options.env || process.env)) !== job.configurationHash)
    throw Error("Connector configuration changed. Start a new retrieval.");
  const saved = db
    .prepare("SELECT * FROM research.connector_pages WHERE retrieval_id=? ORDER BY page")
    .all(id)
    .map(decode);
  active.add(id);
  let requestIndex = 0;
  try {
    const result = await readConnector(job.connector, {
      ...options,
      request: async (url, requestOptions) => {
        const page = saved[requestIndex++];
        return page ? new Response(page.rawContent) : (options.request || fetchPinnedResponse)(url, requestOptions);
      },
      onPage: async (page) => {
        const retained = saved[page.page - 1];
        if (retained) {
          if (retained.responseHash !== page.responseHash || retained.requestCursorHash !== page.requestCursorHash)
            throw Error("Connector saved page chain changed.");
          return retained;
        }
        const body = JSON.stringify(page);
        db.prepare("INSERT INTO research.connector_pages VALUES (?,?,?,?)").run(id, page.page, hashOf(body), body);
      },
    });
    const body = JSON.stringify(result);
    db.prepare("INSERT INTO research.connector_results VALUES (?,?,?)").run(id, hashOf(body), body);
    return { job: getRetrieval(db, id) };
  } catch (error) {
    return {
      job: getRetrieval(db, id),
      error: /^(Connector|Choose)/.test(error.message)
        ? error.message
        : "Connector retrieval failed. Retained pages can be resumed.",
    };
  } finally {
    active.delete(id);
  }
}
