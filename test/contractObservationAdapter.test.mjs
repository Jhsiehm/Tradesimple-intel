import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { hashOf, putDataset } from "../server/domain/research-store.mjs";
import { getObservations, listObservations } from "../server/domain/research-observations.mjs";
import {
  contractObservationInput,
  listCompatibleContractDatasets,
  prepareContractObservations,
} from "../server/domain/contractObservationAdapter.mjs";
import { DATASET_OBSERVATION_TOOLS } from "../server/ai/datasetObservationTools.mjs";

function fixture(db, override = {}) {
  const events = [
    {
      id: "usa:contract1",
      value: 1200,
      eventAt: "2025-01-02",
      availableAt: "2025-04-02",
      entity: { companyId: "cik:1501585" },
      sourceUrl: "https://www.usaspending.gov/award/test",
      original: { firstObservedAt: "2026-01-02T12:00:00.000Z", rawHash: "original-raw-record-hash" },
    },
  ];
  const manifest = { signal: "positive-obligation", cooldownDays: 7 };
  const rawContent = JSON.stringify({ manifest, records: events });
  return putDataset(
    db,
    "Test contracts",
    {
      sourceFamily: "contracts",
      format: "evidence",
      rawContent,
      rawHash: hashOf(rawContent),
      events,
      manifest,
      caveats: ["Historical ownership unverified"],
      coverage: { received: 204 },
      ...override,
    },
    hashOf({ manifest, events }),
  );
}

test("selected contract preparation preserves values and lineage without claiming historical publication", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const dataset = fixture(db);
    const inventory = listCompatibleContractDatasets(db);
    assert.equal(inventory[0].selectedRows, 1);
    assert.equal(inventory[0].underlyingReceived, 204);
    const result = prepareContractObservations(db, dataset.id);
    const snapshot = getObservations(db, result.snapshot.id);
    assert.equal(snapshot.events[0].value, 1200);
    assert.equal(snapshot.events[0].availableAt, "2026-01-02T12:00:00.000Z");
    assert.equal(snapshot.events[0].original.lineage.originalSignal.availableAt, "2025-04-02");
    assert.equal(snapshot.events[0].original.lineage.contentHash, dataset.contentHash);
    assert.equal(snapshot.events[0].sourceUrl, dataset.events[0].sourceUrl);
    assert.match(result.provenance.limits.join(" "), /not the full transaction population/);
    assert.equal(prepareContractObservations(db, dataset.id).snapshot.id, result.snapshot.id);
    assert.equal(listObservations(db).length, 1);
  } finally {
    db.close();
  }
});

test("adapter rejects incompatible evidence, checksum drift and missing actual observation timing", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const d = fixture(db);
    assert.throws(() => contractObservationInput({ ...d, sourceFamily: "insiders" }), /contract evidence/);
    assert.throws(() => contractObservationInput({ ...d, rawContent: "changed" }), /source checksum/);
    assert.throws(() => contractObservationInput({ ...d, contentHash: "changed" }), /selection checksum/);
    const events = [{ ...d.events[0], original: {} }];
    assert.throws(
      () => contractObservationInput({ ...d, events, contentHash: hashOf({ manifest: d.manifest, events }) }),
      /first-observation/,
    );
    assert.equal(listObservations(db).length, 0);
  } finally {
    db.close();
  }
});

test("tool allows source preparation for design but blocks inspection-only mutations", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const dataset = fixture(db);
    const tool = DATASET_OBSERVATION_TOOLS[0];
    assert.throws(
      () =>
        tool.run(db, { datasetId: dataset.id }, null, {
          question: "Inspect sources",
          intent: { inspectionOnly: true },
        }),
      /inspection only/,
    );
    assert.equal(listObservations(db).length, 0);
    const out = tool.run(db, { datasetId: dataset.id }, null, {
      question: "Prepare a descriptive plan",
      intent: { designOnly: true },
    });
    assert.equal(out.ok, true);
    assert.match(out.message, /No analysis was executed/);
  } finally {
    db.close();
  }
});
