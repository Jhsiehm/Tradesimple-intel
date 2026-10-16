import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { saveNotebook } from "../server/domain/notebooks.mjs";
import {
  approveMemory,
  createMemorySnapshot,
  getMemorySnapshot,
  usableMemorySnapshot,
  listMemoryApprovals,
  listMemorySnapshots,
} from "../server/domain/research-context.mjs";
const finding = {
  title: "Rejected hypothesis",
  hypothesis: "A test",
  conclusion: "No supporting evidence",
  decision: "Do not reuse this strategy",
  status: "rejected",
  tags: [],
  evidence: [],
  followups: [],
};
const time = (n) => new Date(n).toISOString();
test("memory pins exact approved revisions and rejects future knowledge", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const n = saveNotebook(db, finding);
    const at = Date.now() + 1000;
    const approval = approveMemory(
      db,
      {
        notebookId: n.id,
        revision: 1,
        action: "approve",
        reason: "Reviewed negative result",
        createdAt: "2000-01-01T00:00:00Z",
      },
      { now: time(at) },
    );
    assert.equal(approval.createdAt, time(at), "caller body cannot backdate approval");
    const revised = saveNotebook(db, { ...finding, title: "Changed finding", baseRevision: 1 }, n.id);
    assert.equal(revised.revision, 2);
    assert.throws(
      () =>
        createMemorySnapshot(
          db,
          { mode: "context-aware", knownAt: time(at - 1), approvalIds: [approval.id] },
          { now: time(at + 1) },
        ),
      /not available/,
    );
    const snapshot = createMemorySnapshot(
      db,
      { mode: "context-aware", knownAt: time(at), approvalIds: [approval.id] },
      { now: time(at + 1) },
    );
    assert.equal(snapshot.records[0].notebook.title, finding.title);
    assert.equal(snapshot.records[0].notebook.revision, 1);
    assert.deepEqual(getMemorySnapshot(db, snapshot.id), snapshot);
    assert.deepEqual(usableMemorySnapshot(db, snapshot.id), snapshot);
    assert.equal(listMemorySnapshots(db)[0].records, 1);
    assert.throws(
      () =>
        createMemorySnapshot(
          db,
          { mode: "context-aware", knownAt: time(at + 100), approvalIds: [approval.id] },
          { now: time(at + 1) },
        ),
      /future/,
    );
    assert.throws(
      () => approveMemory(db, { notebookId: n.id, revision: 2, action: "approve", reason: "x", scope: "organization" }),
      /Only local-owner/,
    );
  } finally {
    db.close();
  }
});
test("revocation prevents new use while retaining the original reproducibility artifact", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const n = saveNotebook(db, finding),
      at = Date.now() + 1000;
    const request = { notebookId: n.id, revision: 1, action: "approve", reason: "Reviewed" };
    const approval = approveMemory(db, request, { now: time(at) });
    const input = { mode: "context-aware", knownAt: time(at), approvalIds: [approval.id] };
    const snapshot = createMemorySnapshot(db, input, { now: time(at) });
    const revocation = approveMemory(
      db,
      { ...request, action: "revoke", reason: "Evidence needs review" },
      { now: time(at + 1) },
    );
    assert.equal(revocation.previousId, approval.id);
    assert.throws(() => createMemorySnapshot(db, input, { now: time(at + 2) }), /revoked or superseded/);
    assert.throws(() => usableMemorySnapshot(db, snapshot.id), /revoked or superseded/);
    assert.deepEqual(getMemorySnapshot(db, snapshot.id), snapshot);
    const renewed = approveMemory(db, request, { now: time(at + 3) });
    assert.equal(listMemoryApprovals(db)[0].id, renewed.id);
    assert.throws(
      () => usableMemorySnapshot(db, snapshot.id),
      /revoked or superseded/,
      "new approval does not revive old authorization",
    );
    assert.equal(
      createMemorySnapshot(db, { ...input, knownAt: time(at + 3), approvalIds: [renewed.id] }, { now: time(at + 4) })
        .records.length,
      1,
    );
    assert.throws(() => db.exec("DELETE FROM research.memory_snapshots"), /immutable/);
    assert.throws(() => db.exec("UPDATE research.memory_approvals SET revision=99"), /immutable/);
  } finally {
    db.close();
  }
});
test("isolated snapshots contain no memory and malformed or unapproved selections fail atomically", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const draft = saveNotebook(db, { ...finding, status: "draft" }),
      at = Date.now() + 1000;
    assert.throws(
      () => approveMemory(db, { notebookId: draft.id, revision: 1, action: "approve", reason: "Review" }),
      /Classify/,
    );
    const isolated = createMemorySnapshot(
      db,
      { mode: "isolated", knownAt: time(at), approvalIds: [] },
      { now: time(at) },
    );
    assert.deepEqual(isolated.records, []);
    for (const body of [
      { mode: "isolated", approvalIds: ["ma_missing"] },
      { mode: "context-aware", approvalIds: [] },
      { mode: "context-aware", approvalIds: ["ma_missing"] },
      { mode: "context-aware", approvalIds: ["x", "x"] },
      { mode: "paired", approvalIds: [] },
      { mode: "isolated", scope: "organization", approvalIds: [] },
    ])
      assert.throws(() => createMemorySnapshot(db, { knownAt: time(at), ...body }, { now: time(at) }));
    assert.equal(listMemorySnapshots(db).length, 1);
    assert.deepEqual(listMemoryApprovals(db), []);
  } finally {
    db.close();
  }
});

test("explicit supersession atomically retires only the chosen older revision", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const n = saveNotebook(db, finding),
      at = Date.now() + 1000;
    const first = approveMemory(
      db,
      { notebookId: n.id, revision: 1, action: "approve", reason: "Original review" },
      { now: time(at) },
    );
    const frozen = createMemorySnapshot(
      db,
      { mode: "context-aware", knownAt: time(at), approvalIds: [first.id] },
      { now: time(at) },
    );
    saveNotebook(db, { ...finding, baseRevision: 1, conclusion: "Revised finding" }, n.id);
    const replacement = approveMemory(
      db,
      {
        notebookId: n.id,
        revision: 2,
        action: "approve",
        reason: "Corrected evidence",
        supersedesApprovalId: first.id,
        expectedPreviousId: null,
      },
      { now: time(at + 1) },
    );
    assert.equal(replacement.supersedesApprovalId, first.id);
    const revoked = listMemoryApprovals(db).find((a) => a.revision === 1);
    assert.equal(revoked.action, "revoke");
    assert.equal(revoked.previousId, first.id);
    assert.equal(revoked.replacementApprovalId, replacement.id);
    assert.throws(() => usableMemorySnapshot(db, frozen.id), /revoked or superseded/);
    assert.deepEqual(getMemorySnapshot(db, frozen.id), frozen);
    assert.equal(
      createMemorySnapshot(
        db,
        { mode: "context-aware", knownAt: time(at + 1), approvalIds: [replacement.id] },
        { now: time(at + 1) },
      ).records[0].notebook.revision,
      2,
    );
    assert.throws(
      () =>
        approveMemory(
          db,
          { notebookId: n.id, revision: 2, action: "approve", reason: "Stale retry", supersedesApprovalId: first.id },
          { now: time(at + 2) },
        ),
      /changed/,
    );
    assert.throws(
      () =>
        approveMemory(
          db,
          { notebookId: n.id, revision: 2, action: "revoke", reason: "Stale view", expectedPreviousId: null },
          { now: time(at + 2) },
        ),
      /changed/,
    );
    assert.equal(listMemoryApprovals(db).filter((a) => a.action === "approve").length, 1);
  } finally {
    db.close();
  }
});
test("replacement failure rolls back the new approval and refuses cross-notebook or backward replacement", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const n = saveNotebook(db, finding),
      other = saveNotebook(db, finding),
      at = Date.now() + 1000;
    const first = approveMemory(
      db,
      { notebookId: n.id, revision: 1, action: "approve", reason: "Original review" },
      { now: time(at + 100) },
    );
    saveNotebook(db, { ...finding, baseRevision: 1 }, n.id);
    const body = {
      notebookId: n.id,
      revision: 2,
      action: "approve",
      reason: "Replacement",
      supersedesApprovalId: first.id,
    };
    // New revision inserts first; retiring the old approval fails its chronological check.
    assert.throws(() => approveMemory(db, body, { now: time(at) }), /chronological/);
    assert.deepEqual(listMemoryApprovals(db), [first]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM research.memory_approvals").get().n, 1);
    for (const invalid of [
      { ...body, notebookId: other.id },
      { ...body, revision: 1 },
      { ...body, action: "revoke" },
    ])
      assert.throws(() => approveMemory(db, invalid, { now: time(at + 200) }), /same notebook|Only an approval/);
  } finally {
    db.close();
  }
});
