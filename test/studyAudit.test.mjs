import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { hashOf, putDataset } from "../server/domain/research-store.mjs";
import { studyAuditFixture as fixture } from "./fixtures/studyAuditFixture.mjs";
import { auditSavedStudies } from "../server/domain/study-audit.mjs";
import { STUDY_AUDIT_TOOLS } from "../server/ai/studyAuditTools.mjs";
import { trimForModel } from "../shared/ask.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function withDb(fn) {
  const db = new DatabaseSync(":memory:");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
test("saved-study audit pins counters, assumptions and stats without replaying or mutating evidence", () =>
  withDb((db) => {
    const a = fixture(db, { partial: true, cooldown: 30, from: "2025-01-09" });
    const b = fixture(db, { name: "Procurement B" });
    const changes = db.prepare("SELECT total_changes() AS n").get().n;
    db.exec("PRAGMA query_only=ON");
    const result = auditSavedStudies(db, { experimentIds: [a.experiment.id, b.experiment.id] });
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n, changes);
    const [first, second] = result.studies;
    assert.equal(first.coverage.partitionStatus, "partial");
    assert.equal(first.coverage.providerReceived, 2804);
    assert.equal(first.coverage.normalizedReceived, 2799);
    assert.equal(first.coverage.ambiguousVersions, 44);
    assert.equal(second.coverage.partitionStatus, "count-reconciled-within-declared-scope");
    assert.equal(second.coverage.historicalCompleteness, "not-certified");
    assert.equal(first.exclusions.nonPositiveObligation, 589);
    assert.equal(first.exclusions.ambiguousIdentity, 44);
    assert.equal(first.exclusions.cooldown, 2163);
    assert.equal(second.exclusions.nonPositiveObligation, 65);
    assert.equal(second.exclusions.cooldown, 130);
    assert.equal(first.timing.mode, "assumed");
    assert.equal(first.timing.lookAheadAbsence, "not-established");
    assert.equal(first.archivedCaveats.sourceSemanticMismatch, true);
    assert.deepEqual(first.symbols, ["AAA"]);
    assert.match(first.archivedCaveats.treatment, /inapplicable/);
    assert.equal(first.stats.excessTotal, 0.0138);
    assert.match(first.stats.origin, new RegExp(a.experiment.runId));
    assert.equal(first.calculation.replayPerformed, false);
    assert.equal(first.calculation.arithmeticVerified, false);
    assert.equal(first.parameters.stopLossPct, "disabled");
    assert.deepEqual(result.comparison.fields["parameters.cooldownDays"], {
      [a.experiment.id]: 30,
      [b.experiment.id]: 7,
    });
    assert.equal(result.comparison.status, "different-designs-or-windows");
    assert.equal(result.claimLimits.newBacktestPerformed, false);
    assert.deepEqual(trimForModel(result), result, "ordinary two-study evidence must survive model trimming intact");
  }));
test("audit chooses latest saved result per pinned dataset, never the strongest return", () =>
  withDb((db) => {
    const old = fixture(db),
      other = fixture(db, { name: "B" });
    const newest = fixture(db, { dataset: old.dataset, resultPatch: { stats: { total: -0.5 } } });
    // Fixed timestamps make selection deterministic even on a very fast test host.
    db.exec("DROP TRIGGER research.experiments_update");
    db.prepare("UPDATE research.experiments SET created_at=? WHERE id=?").run("2025-01-01", old.experiment.id);
    db.prepare("UPDATE research.experiments SET created_at=? WHERE id=?").run("2025-01-03", newest.experiment.id);
    db.prepare("UPDATE research.experiments SET created_at=? WHERE id=?").run("2025-01-02", other.experiment.id);
    const result = auditSavedStudies(db);
    assert.deepEqual(result.selectedIds, [newest.experiment.id, other.experiment.id]);
    assert.equal(result.studies[0].stats.total, -0.5);
    const exact = auditSavedStudies(db, { experimentIds: [old.experiment.id] });
    assert.equal(exact.studies[0].stats.total, 0.0829);
    const missing = `ds_${"f".repeat(32)}`;
    const byDataset = auditSavedStudies(db, { datasetIds: [old.dataset.id, missing] });
    assert.deepEqual(byDataset.selectedIds, [newest.experiment.id]);
    assert.deepEqual(byDataset.discovery.datasetsWithoutStudyInScope, [missing]);
  }));
test("missing metadata stays unknown and calculation completion never certifies coverage", () =>
  withDb((db) => {
    const rawContent = "[]";
    const d = putDataset(db, "Sparse", { source: "test", rawContent, rawHash: hashOf(rawContent) }, hashOf("sparse"));
    const f = fixture(db, { dataset: d, resultPatch: { stats: {} } });
    const [s] = auditSavedStudies(db, { experimentIds: [f.experiment.id] }).studies;
    assert.equal(s.calculation.status, "completed-as-recorded");
    assert.equal(s.coverage.partitionStatus, "unknown");
    assert.equal(s.coverage.normalizedReceived, null);
    assert.equal(s.coverage.providerReceived, null);
    assert.equal(s.exclusions.recorded, false);
    assert.equal(s.stats.total, null);
    assert.equal(s.archivedCaveats.sourceSemanticMismatch, false);
    assert.equal(s.timing.mode, "unknown");
  }));
test("strict selection rejects invented, wrong-family, duplicate, overwide and extra arguments", () =>
  withDb((db) => {
    const f = fixture(db);
    for (const args of [
      null,
      [],
      { experimentIds: ["exp_foo"] },
      { experimentIds: [f.dataset.id] },
      { datasetIds: [f.experiment.id] },
      { experimentIds: [f.experiment.id, f.experiment.id] },
      { experimentIds: Array(5).fill(f.experiment.id) },
      { experimentIds: [], datasetIds: [] },
      { limit: 1000 },
    ])
      assert.throws(() => auditSavedStudies(db, args));
    assert.throws(() => auditSavedStudies(db, { experimentIds: [`exp_${"f".repeat(32)}`] }), /not found/);
    assert.equal(STUDY_AUDIT_TOOLS[0].name, "research_audit_saved_studies");
    assert.deepEqual(STUDY_AUDIT_TOOLS[0].run(db, { experimentIds: [f.experiment.id] }).selectedIds, [f.experiment.id]);
  }));
test("a different dataset hash or modified frozen run fails closed", () =>
  withDb((db) => {
    const first = fixture(db);
    const mismatch = fixture(db, {
      dataset: first.dataset,
      inputRef: { id: first.dataset.id, version: first.dataset.version, contentHash: "wrong" },
    });
    assert.throws(() => auditSavedStudies(db, { experimentIds: [mismatch.experiment.id] }), /does not match/);
    db.exec("DROP TRIGGER research.runs_update");
    db.prepare("UPDATE research.runs SET body=? WHERE id=?").run("{}", first.experiment.runId);
    assert.throws(() => auditSavedStudies(db, { experimentIds: [first.experiment.id] }), /checksum mismatch/);
  }));
test("automatic discovery is bounded, exposes omitted candidates and preserves exact selection", () =>
  withDb((db) => {
    const saved = Array.from({ length: 6 }, (_, i) => fixture(db, { name: `Study ${i}` }));
    const result = auditSavedStudies(db);
    assert.equal(result.studies.length, 4);
    assert.equal(result.discovery.omittedCandidates, 2);
    assert.equal(result.discovery.otherCandidateIds.length, 2);
    assert.equal(result.discovery.scanLimit, 500);
    const selected = result.discovery.otherCandidateIds[0];
    assert.equal(auditSavedStudies(db, { experimentIds: [selected] }).studies[0].id, selected);
    assert.equal(saved.length, 6);
  }));
test("empty registry discovery returns an empty report without initializing a database", () =>
  withDb((db) => {
    db.exec("PRAGMA query_only=ON");
    const result = auditSavedStudies(db);
    assert.deepEqual(result.selectedIds, []);
    assert.deepEqual(result.studies, []);
    assert.equal(result.discovery.scanned, 0);
    assert.deepEqual(
      db
        .prepare("SELECT name FROM pragma_database_list")
        .all()
        .map((s) => s.name),
      ["main"],
    );
  }));
test("Ask tool attaches an existing owner registry before its first audit call", () => {
  const directory = mkdtempSync(join(tmpdir(), "study-audit-"));
  const prior = process.env.INTEL_RESEARCH;
  const file = join(directory, "research.sqlite");
  process.env.INTEL_RESEARCH = file;
  let cache;
  try {
    const initial = new DatabaseSync(":memory:");
    const saved = fixture(initial);
    initial.close();
    cache = new DatabaseSync(":memory:");
    assert.deepEqual(auditSavedStudies(cache).selectedIds, [], "domain does not initialize or attach storage");
    assert.deepEqual(STUDY_AUDIT_TOOLS[0].run(cache, {}).selectedIds, [saved.experiment.id]);
  } finally {
    cache?.close();
    if (prior === undefined) delete process.env.INTEL_RESEARCH;
    else process.env.INTEL_RESEARCH = prior;
    rmSync(directory, { recursive: true, force: true });
  }
});
