import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { hashOf, putDataset, putRun, getRun } from "../server/domain/research-store.mjs";
import { putBlob } from "../server/domain/evidence/store.mjs";
import { archiveEvidence } from "../server/domain/research-archive.mjs";
const engine = { files: { "fixture.mjs": "fixture" } };
engine.id = hashOf(engine.files);
test("archive follows immutable contract manifest hashes rather than current retrieval job state", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const page = { results: [{ id: "original", amount: 100 }] };
    const pageHash = putBlob(db, { request: {}, response: page, observedAt: "2025-01-01T00:00:00Z" }),
      rawHash = putBlob(db, page.results[0]);
    const mappingHash = putBlob(db, { mapping: [{ symbol: "AAPL" }], proofs: [], observedAt: "2025-01-01T00:00:00Z" });
    db.prepare("INSERT INTO research.evidence_observations VALUES (?, ?, ?, ?, ?)").run(
      "job1",
      "partition1",
      1,
      pageHash,
      "2025-01-01T00:00:00Z",
    );
    const rawContent = JSON.stringify(page.results);
    const dataset = putDataset(
      db,
      "Frozen contracts",
      {
        rawContent,
        rawHash: hashOf(rawContent),
        manifest: {
          jobId: "job1",
          mappingHash,
          partitions: [{ id: "partition1", hashes: [hashOf(page.results)] }],
          versions: [{ rawHash }],
        },
      },
      hashOf("fixture"),
    );
    const run = getRun(
      db,
      putRun(db, {
        inputs: {},
        result: { ok: true },
        provenance: { dataset: { id: dataset.id, version: dataset.version, contentHash: dataset.contentHash } },
        engine,
      }),
    );
    const later = putBlob(db, { results: [{ id: "later", amount: 999 }] });
    const archive = archiveEvidence(db, run);
    assert.deepEqual(archive.blobs[pageHash].response, page);
    assert.equal(archive.blobs[later], undefined);
    assert.equal(archive.datasets[dataset.id].rawContent, rawContent);
    assert.deepEqual(archive.engines[engine.id], engine.files);
    assert.throws(
      () =>
        archiveEvidence(db, { ...run, provenance: { dataset: { ...run.provenance.dataset, contentHash: "wrong" } } }),
      /does not match/,
    );
    assert.throws(
      () => archiveEvidence(db, { ...run, provenance: { sourceRuns: [{ runId: "missing", inputHash: "missing" }] } }),
      /source is missing/,
    );
  } finally {
    db.close();
  }
});
test("missing evidence blobs fail export rather than yielding an apparently complete archive", () => {
  const db = new DatabaseSync(":memory:");
  try {
    putBlob(db, { initialize: true });
    const rawContent = "[]";
    const dataset = putDataset(
      db,
      "Incomplete",
      { rawContent, rawHash: hashOf(rawContent), manifest: { partitions: [{ hashes: ["missing"] }] } },
      hashOf("incomplete"),
    );
    const run = getRun(
      db,
      putRun(db, {
        inputs: {},
        result: { ok: true },
        provenance: { dataset: { id: dataset.id, version: dataset.version, contentHash: dataset.contentHash } },
        engine,
      }),
    );
    assert.throws(() => archiveEvidence(db, run), /Frozen evidence page is missing/);
  } finally {
    db.close();
  }
});
