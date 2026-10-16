/** Owner-approved notebook revisions and immutable context boundaries. No implicit latest-record retrieval. */
import { researchStore, hashOf, newId, getRun } from "./research-store.mjs";
import { notebookHistory } from "./notebooks.mjs";
import { timestamp } from "./research-events.mjs";
const ready = new WeakSet();
const scope = "local-owner";
function ensure(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.memory_approvals (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, notebook_id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research.memory_snapshots (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL);`);
  for (const table of ["memory_approvals", "memory_snapshots"])
    for (const op of ["UPDATE", "DELETE"])
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS research.${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Memory records are immutable'); END;`,
      );
  ready.add(db);
}
function decode(row) {
  if (!row) throw new Error("Memory record not found.");
  if (hashOf(row.body) !== row.body_hash) throw new Error("Memory record checksum mismatch.");
  return JSON.parse(row.body);
}
function instant(value) {
  const at = timestamp(value);
  if (!at || at.precision !== "instant") throw new Error("Memory timestamps require a UTC timestamp ending in Z.");
  return at.value;
}
function latest(db, id, revision) {
  const row = db
    .prepare(
      "SELECT body,body_hash FROM research.memory_approvals WHERE notebook_id=? AND revision=? ORDER BY sequence DESC LIMIT 1",
    )
    .get(id, revision);
  return row ? decode(row) : null;
}
export function listMemoryApprovals(db) {
  ensure(db);
  return db
    .prepare(
      "SELECT a.body,a.body_hash FROM research.memory_approvals a JOIN (SELECT notebook_id,revision,MAX(sequence) AS seq FROM research.memory_approvals GROUP BY notebook_id,revision) b ON a.sequence=b.seq ORDER BY a.sequence DESC",
    )
    .all()
    .map(decode);
}
function recordApproval(db, body, { now = new Date().toISOString(), links = {} } = {}) {
  ensure(db);
  now = instant(now);
  if (body?.scope != null && body.scope !== scope)
    throw new Error("Only local-owner memory is supported; project/team permissions are not implemented.");
  if (!["approve", "revoke"].includes(body?.action)) throw new Error("Choose approve or revoke.");
  if (!Number.isSafeInteger(body.revision) || body.revision < 1 || typeof body.notebookId !== "string")
    throw new Error("Choose an exact notebook revision.");
  if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 2000)
    throw new Error("Record an approval or revocation reason (1–2,000 characters).");
  const notebook = notebookHistory(db, body.notebookId).find((n) => n.revision === body.revision);
  if (!notebook) throw new Error("Notebook revision not found.");
  if (Date.parse(notebook.createdAt) > Date.parse(now)) throw new Error("Approval cannot precede notebook creation.");
  const previous = latest(db, notebook.id, notebook.revision);
  if (Object.hasOwn(body, "expectedPreviousId") && body.expectedPreviousId !== (previous?.id || null))
    throw new Error("Approval changed. Refresh and review the current state.");
  if (previous && Date.parse(previous.createdAt) > Date.parse(now))
    throw new Error("Approval events must be chronological.");
  if (body.action === "approve" && (notebook.status === "draft" || !notebook.conclusion || !notebook.decision))
    throw new Error("Classify the finding and record its conclusion and rationale before approval.");
  if (body.action === "revoke" && previous?.action !== "approve")
    throw new Error("This revision has no active approval to revoke.");
  const event = {
    id: newId("ma"),
    schemaVersion: 1,
    scope,
    actor: "local-owner",
    action: body.action,
    notebookId: notebook.id,
    revision: notebook.revision,
    notebookHash: hashOf(notebook),
    title: notebook.title,
    reason: body.reason.trim(),
    createdAt: now,
    previousId: previous?.id || null,
    ...links,
  };
  const encoded = JSON.stringify(event);
  db.prepare(
    "INSERT INTO research.memory_approvals(id,notebook_id,revision,created_at,body_hash,body) VALUES (?,?,?,?,?,?)",
  ).run(event.id, event.notebookId, event.revision, now, hashOf(encoded), encoded);
  return event;
}
/** Replace a specific earlier approval in the same transaction as the new approval. */
export function approveMemory(db, body, options = {}) {
  ensure(db);
  const now = options.now || new Date().toISOString();
  db.exec("SAVEPOINT memory_replacement");
  try {
    if (!body?.supersedesApprovalId) {
      const result = recordApproval(db, body, { now });
      db.exec("RELEASE memory_replacement");
      return result;
    }
    if (body.action !== "approve" || typeof body.supersedesApprovalId !== "string")
      throw new Error("Only an approval can replace an earlier approval.");
    const prior = decode(
      db.prepare("SELECT body,body_hash FROM research.memory_approvals WHERE id=?").get(body.supersedesApprovalId),
    );
    if (prior.action !== "approve" || latest(db, prior.notebookId, prior.revision)?.id !== prior.id)
      throw new Error("Earlier approval changed. Refresh before replacing it.");
    if (prior.notebookId !== body.notebookId || prior.revision >= body.revision)
      throw new Error("Replace an earlier revision of the same notebook.");
    if (latest(db, body.notebookId, body.revision)?.action === "approve")
      throw new Error("Target revision is already approved. Revoke earlier approvals separately.");
    const replacement = recordApproval(db, body, { now, links: { supersedesApprovalId: prior.id } });
    recordApproval(
      db,
      {
        notebookId: prior.notebookId,
        revision: prior.revision,
        action: "revoke",
        reason: body.reason,
        expectedPreviousId: prior.id,
      },
      { now, links: { replacementApprovalId: replacement.id } },
    );
    db.exec("RELEASE memory_replacement");
    return replacement;
  } catch (error) {
    db.exec("ROLLBACK TO memory_replacement");
    db.exec("RELEASE memory_replacement");
    throw error;
  }
}
export function createMemorySnapshot(db, body, { now = new Date().toISOString() } = {}) {
  ensure(db);
  now = instant(now);
  const knownAt = instant(body?.knownAt);
  if (Date.parse(knownAt) > Date.parse(now)) throw new Error("Memory cutoff cannot be in the future.");
  if (!["isolated", "context-aware"].includes(body.mode))
    throw new Error("Choose isolated or context-aware. Paired execution is not implemented here.");
  if (body.scope != null && body.scope !== scope) throw new Error("Only local-owner memory is supported.");
  const ids = body.approvalIds ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 30 ||
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Choose up to 30 distinct approval IDs.");
  if (body.mode === "isolated" && ids.length) throw new Error("Isolated context cannot contain memory approvals.");
  if (body.mode === "context-aware" && !ids.length) throw new Error("Choose at least one approved revision.");
  const records = ids.map((id) => {
    const approval = decode(db.prepare("SELECT body,body_hash FROM research.memory_approvals WHERE id=?").get(id));
    if (approval.action !== "approve" || latest(db, approval.notebookId, approval.revision)?.id !== id)
      throw new Error("Selected approval is revoked or superseded.");
    if (Date.parse(approval.createdAt) > Date.parse(knownAt))
      throw new Error("Approval was not available by the memory cutoff.");
    const notebook = notebookHistory(db, approval.notebookId).find((n) => n.revision === approval.revision);
    if (!notebook || hashOf(notebook) !== approval.notebookHash)
      throw new Error("Approved notebook revision checksum mismatch.");
    if (Date.parse(notebook.createdAt) > Date.parse(knownAt))
      throw new Error("Notebook was not available by the memory cutoff.");
    for (const reference of notebook.evidence) {
      const run = getRun(db, reference.runId);
      if (!run || run.inputHash !== reference.inputHash)
        throw new Error("Memory evidence is missing or differs from its pinned run.");
      if (Date.parse(run.createdAt) > Date.parse(knownAt))
        throw new Error("Evidence was not available by the memory cutoff.");
    }
    return { approval, notebook };
  });
  const content = { mode: body.mode, scope, knownAt, records };
  const snapshot = {
    id: newId("mem"),
    schemaVersion: 1,
    createdAt: now,
    ...content,
    contentHash: hashOf(content),
    caveats: [
      "Approval records permission to reuse a researcher-authored finding; it does not verify the conclusion.",
      "Cutoffs use server-recorded notebook, approval and evidence creation times, never a user-supplied historical publication claim.",
      "This is a frozen context artifact, not an AI execution or a paired evaluation. Local-owner scope is not multi-user access control.",
    ],
  };
  const encoded = JSON.stringify(snapshot);
  db.prepare("INSERT INTO research.memory_snapshots VALUES (?,?,?,?)").run(snapshot.id, now, hashOf(encoded), encoded);
  return snapshot;
}
export function getMemorySnapshot(db, id) {
  ensure(db);
  const snapshot = decode(db.prepare("SELECT body,body_hash FROM research.memory_snapshots WHERE id=?").get(id));
  const { mode, scope, knownAt, records } = snapshot;
  if (hashOf({ mode, scope, knownAt, records }) !== snapshot.contentHash)
    throw new Error("Memory context checksum mismatch.");
  return snapshot;
}
export function listMemorySnapshots(db) {
  ensure(db);
  return db
    .prepare("SELECT body,body_hash FROM research.memory_snapshots ORDER BY created_at DESC,id DESC LIMIT 500")
    .all()
    .map((row) => {
      const { records, ...snapshot } = decode(row);
      return { ...snapshot, records: records.length };
    });
}
/** Historical reads remain possible after revocation; new context use must recheck authorization. */
export function usableMemorySnapshot(db, id) {
  const snapshot = getMemorySnapshot(db, id);
  for (const { approval } of snapshot.records)
    if (latest(db, approval.notebookId, approval.revision)?.id !== approval.id)
      throw new Error("Snapshot contains revoked or superseded memory. Create a newly approved context.");
  return snapshot;
}
