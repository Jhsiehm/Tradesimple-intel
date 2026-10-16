import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  importRelationships,
  queryRelationships,
  getRelationshipSnapshot,
  listRelationshipSnapshots,
} from "../server/domain/relationship-history.mjs";
const row = (over = {}) => ({
  id: "v1",
  relationshipId: "ownership",
  subject: "company:example",
  predicate: "owns",
  object: "facility:one",
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
  availableAt: "2020-01-03",
  status: "asserted",
  sourceUrl: "https://example.org/filing",
  ...over,
});
const importRows = (db, rows) =>
  importRelationships(db, { name: "Fixture relationships", rows }, { now: "2025-01-01T12:00:00Z" });
test("historical lookup excludes future knowledge, applies corrected intervals and retains frozen versions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const snapshot = importRows(db, [row(), row({ id: "v2", availableAt: "2021-01-01", effectiveTo: "2020-06-01" })]);
    const before = queryRelationships(db, snapshot.id, { effectiveAt: "2020-07-01", knownAt: "2020-12-31" });
    assert.equal(before.items.length, 1);
    assert.equal(before.items[0].id, "v1");
    assert.equal(
      queryRelationships(db, snapshot.id, { effectiveAt: "2020-07-01", knownAt: "2021-01-01" }).items.length,
      0,
    );
    assert.equal(
      queryRelationships(db, snapshot.id, { effectiveAt: "2020-01-02", knownAt: "2020-01-02" }).items.length,
      0,
    );
    assert.equal(
      queryRelationships(db, snapshot.id, { effectiveAt: "2020-01-03", knownAt: "2020-01-03T12:00:00Z" }).items.length,
      0,
    );
    assert.equal(
      queryRelationships(db, snapshot.id, { effectiveAt: "2020-01-03", knownAt: "2020-01-03" }).items.length,
      1,
    );
    const updated = importRows(db, [
      ...snapshot.rows,
      row({ id: "v3", availableAt: "2022-01-01", status: "retracted" }),
    ]);
    assert.equal(updated.version, 2);
    assert.equal(importRows(db, updated.rows).id, updated.id);
    assert.equal(getRelationshipSnapshot(db, snapshot.id).rows.length, 2);
    assert.equal(
      queryRelationships(db, updated.id, { effectiveAt: "2020-02-01", knownAt: "2022-01-02" }).items.length,
      0,
    );
    assert.equal(
      queryRelationships(db, updated.id, { effectiveAt: "2020-02-01", knownAt: "2021-01-02" }).items.length,
      1,
    );
    assert.throws(() => db.prepare("DELETE FROM research.relationship_snapshots").run(), /immutable/);
  } finally {
    db.close();
  }
});
test("same-time conflicting revisions are visible as ambiguous rather than arbitrarily chosen", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const snapshot = importRows(db, [row(), row({ id: "v2", object: "facility:two" })]);
    const result = queryRelationships(db, snapshot.id, { effectiveAt: "2020-02-01", knownAt: "2020-02-01" });
    assert.equal(result.items.length, 0);
    assert.equal(result.ambiguous.length, 1);
    assert.deepEqual(result.ambiguous[0].assertionIds, ["v1", "v2"]);
  } finally {
    db.close();
  }
});
test("invalid imports are atomic and evidence/identity/date constraints are enforced", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const change of [
      { object: "untyped" },
      { predicate: "invented" },
      { effectiveFrom: "2020-02-30" },
      { effectiveTo: "2019-01-01" },
      { availableAt: "2026-01-01" },
      { sourceUrl: "https://user:password@example.org" },
      { status: "verified" },
    ])
      assert.throws(() => importRows(db, [row(), row({ id: "invalid", ...change })]));
    assert.throws(() => importRows(db, [row(), row()]), /unique/);
    assert.throws(
      () => importRows(db, [row(), row({ id: "changed-subject", subject: "company:another" })]),
      /same subject/,
    );
    assert.deepEqual(listRelationshipSnapshots(db), []);
  } finally {
    db.close();
  }
});
