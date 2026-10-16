import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createResearchBackup, restoreResearchBackup } from "../server/domain/research-backup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/lib/db.mjs";
import {
  prepareObservations,
  importObservations,
  getObservations,
  listObservations,
  deriveObservationSignals,
  resolveObservations,
  verifyObservationDerivation,
  mergeObservationSnapshots,
  verifyObservationComposition,
} from "../server/domain/research-observations.mjs";
import { datasetSource } from "../server/domain/research-events.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { dayOf } from "../shared/backtest.mjs";
import { getRun } from "../server/domain/research-store.mjs";
import { replayRun, exportRun } from "../server/domain/research-replay.mjs";
import { archiveEvidence } from "../server/domain/research-archive.mjs";
const records = [
  {
    id: "cold",
    entityId: "facility:fixture",
    metric: "temperature",
    unit: "C",
    value: -4,
    eventAt: "2025-01-01",
    availableAt: "2025-01-03",
    sourceUrl: "https://example.org/cold",
  },
  {
    id: "warm",
    entityId: "facility:fixture",
    metric: "temperature",
    unit: "C",
    value: 20,
    eventAt: "2025-01-04",
    availableAt: "2025-01-06",
    sourceUrl: "https://example.org/warm",
  },
];
const request = (rows = records) => ({
  name: "Synthetic temperatures",
  source: "Synthetic fixture",
  ownership: "Local researcher",
  license: "Test fixture only",
  format: "json",
  content: JSON.stringify(rows),
});
function database(cache = ":memory:") {
  const prior = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = cache;
  try {
    return openDb(decodeURIComponent(new URL("..", import.meta.url).pathname));
  } finally {
    if (prior === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = prior;
  }
}
const policy = {
  name: "Cold threshold signals",
  metric: "temperature",
  unit: "C",
  operator: "lt",
  threshold: 0,
  side: "buy",
  bindings: { "facility:fixture": ["AAPL"] },
};
test("numeric observations retain units, negative values, provenance and immutable versions", () => {
  const db = database();
  try {
    const p = prepareObservations(request());
    assert.equal(p.ok, true);
    assert.equal(p.preview[0].value, -4);
    const s = importObservations(db, request()).snapshot;
    assert.equal(importObservations(db, request()).snapshot.id, s.id);
    const next = importObservations(db, request([...records, { ...records[0], id: "zero", value: 0 }])).snapshot;
    assert.equal(next.version, 2);
    assert.deepEqual(getObservations(db, s.id), s);
    assert.equal(listObservations(db).length, 2);
    assert.equal(s.events[0].availableAt, "2025-01-03");
    assert.equal(s.license, "Test fixture only");
    assert.throws(() => db.exec("DELETE FROM research.observation_snapshots"), /immutable/);
    for (const patch of [
      { value: "" },
      { value: true },
      { value: "NaN" },
      { entityId: "AAPL" },
      { availableAt: "" },
      { availableAt: "2024-01-01" },
      { sourceUrl: "file:///private" },
      { unit: "" },
      { unit: true },
      { metric: { name: "temperature" } },
    ])
      assert.equal(prepareObservations(request([{ ...records[0], ...patch }])).ok, false);
    assert.equal(prepareObservations(request([records[0], records[0]])).ok, false);
  } finally {
    db.close();
  }
});
test("explicit observation thresholds feed reproducible experiments with full source lineage", async () => {
  const db = database();
  try {
    const source = importObservations(db, request()).snapshot;
    for (const bad of [
      { bindings: {} },
      { unit: "F" },
      { threshold: "0" },
      { bindings: { "facility:fixture": ["NOT_A_TICKER"] } },
    ])
      assert.throws(() => deriveObservationSignals(db, source.id, { ...policy, ...bad }));
    const derived = deriveObservationSignals(db, source.id, policy);
    assert.equal(derived.dataset.events.length, 1);
    assert.equal(derived.dataset.events[0].availableAt, "2025-01-03");
    assert.equal(derived.dataset.events[0].value, null, "measurement is not position size");
    assert.equal(derived.transformation.lineage[0].observationId, "cold");
    assert.deepEqual(derived.transformation.snapshot, source);
    assert.equal(deriveObservationSignals(db, source.id, policy).dataset.id, derived.dataset.id);
    const bars = Array.from({ length: 80 }, (_, i) => [dayOf("2025-01-01") + i, 100 + i, 101 + i]);
    const result = await runSpec(
      db,
      { source: "dataset", datasetId: derived.dataset.id, rules: { holdDays: 10 } },
      {
        sourceFn: async () => datasetSource(derived.dataset),
        loadBarsFn: async () => ({
          bars: { AAPL: bars, SPY: bars },
          pending: [],
          stale: [],
          cached: 2,
          fetched: 0,
          missing: [],
          oldestStoredAt: Date.now(),
        }),
      },
    );
    const run = getRun(db, result.runId);
    assert.equal(replayRun(run).matches, true);
    const archive = archiveEvidence(db, run);
    assert.equal(
      archive.datasets[derived.dataset.id].manifest.observation.snapshot.rawContent,
      JSON.stringify(records),
    );
  } finally {
    db.close();
  }
});

test("expanded entity bindings enforce the signal row limit before materializing the full expansion", () => {
  const db = database();
  try {
    const rows = Array.from({ length: 101 }, (_, i) => ({ ...records[0], id: `cold-${i}` }));
    const source = importObservations(db, request(rows)).snapshot;
    assert.throws(
      () =>
        deriveObservationSignals(db, source.id, {
          ...policy,
          bindings: { "facility:fixture": Array.from({ length: 50 }, (_, i) => `TICKER${i}`) },
        }),
      /exceeds 5,000 signals/,
    );
  } finally {
    db.close();
  }
});

const revisionRows = () => [
  { ...records[0], id: "initial", observationId: "temperature-1" },
  { ...records[0], id: "correction", observationId: "temperature-1", value: 12, availableAt: "2025-01-08" },
  {
    ...records[0],
    id: "withdrawal",
    observationId: "temperature-1",
    status: "retracted",
    value: null,
    availableAt: "2025-01-12",
  },
];
test("observation vintages resolve publication dates, corrections and retractions without future leakage", () => {
  const db = database();
  try {
    const snapshot = importObservations(db, request(revisionRows())).snapshot;
    const lookup = (knownAt) => resolveObservations(snapshot, { knownAt });
    assert.equal(lookup("2025-01-03T12:00:00Z").items.length, 0, "date-only release is not known midday");
    assert.equal(lookup("2025-01-03").items[0].value, -4);
    assert.equal(lookup("2025-01-08T12:00:00Z").items[0].value, -4);
    assert.equal(lookup("2025-01-08").items[0].value, 12);
    assert.equal(lookup("2025-01-12").items.length, 0);
    assert.equal(lookup("2025-01-12").coverage.retracted, 1);
    assert.equal(lookup("2025-01-03").decisions[0].futureAssertionIds.length, 2);
    assert.throws(() => resolveObservations(snapshot), /cutoff/);
    assert.throws(() => resolveObservations(snapshot, { knownAt: "yesterday" }), /UTC/);
    const reverse = { ...snapshot, events: [...snapshot.events].reverse() };
    assert.deepEqual(resolveObservations(reverse, { knownAt: "2025-01-09" }), lookup("2025-01-09"));
  } finally {
    db.close();
  }
});
test("historical signals retain first publications even when later revisions reverse the threshold or retract it", () => {
  const db = database();
  try {
    const source = importObservations(db, request(revisionRows())).snapshot;
    const derived = deriveObservationSignals(db, source.id, policy);
    assert.equal(derived.dataset.events.length, 1);
    assert.equal(derived.dataset.events[0].availableAt, "2025-01-03");
    assert.equal(derived.transformation.policy.revisionPolicy, "first-publication");
    assert.equal(derived.transformation.lineage[0].observationId, "initial");
    assert.equal(derived.transformation.lineage[0].logicalObservationId, "temperature-1");
    assert.equal(derived.transformation.resolution.items[0].id, "initial");
    assert.doesNotThrow(() => verifyObservationDerivation(derived.dataset));
    const wrong = structuredClone(derived.dataset);
    wrong.manifest.observation.resolution.items[0].value = 100;
    assert.throws(() => verifyObservationDerivation(wrong), /resolution mismatch/);
    const backdated = structuredClone(derived.dataset);
    backdated.events[0].availableAt = "2025-01-01";
    assert.throws(() => verifyObservationDerivation(backdated), /signals or lineage mismatch/);
    assert.throws(
      () => deriveObservationSignals(db, source.id, { ...policy, knownAt: "2025-01-02" }),
      /No observations/,
    );
    assert.throws(
      () => deriveObservationSignals(db, source.id, { ...policy, revisionPolicy: "latest-known" }),
      /first-publication/,
    );
    assert.throws(() => deriveObservationSignals(db, source.id, { ...policy, knownAt: "" }), /UTC/);
    const initiallyWarm = importObservations(
      db,
      request([
        { ...revisionRows()[0], value: 12 },
        { ...revisionRows()[1], value: -4 },
      ]),
    ).snapshot;
    assert.throws(
      () => deriveObservationSignals(db, initiallyWarm.id, policy),
      /No observations/,
      "a later cold correction cannot create a backdated signal",
    );
  } finally {
    db.close();
  }
});
test("revision identity changes and malformed retractions are rejected; ties are excluded, not guessed", () => {
  const rows = revisionRows();
  for (const patch of [
    { entityId: "facility:other" },
    { metric: "rainfall" },
    { unit: "F" },
    { eventAt: "2025-01-02" },
  ])
    assert.equal(prepareObservations(request([rows[0], { ...rows[1], ...patch }])).ok, false);
  for (const patch of [{ status: "deleted" }, { status: "retracted", value: 3 }, { observationId: 42 }])
    assert.equal(prepareObservations(request([{ ...rows[0], ...patch }])).ok, false);
  const snapshot = prepareObservations(request([rows[0], { ...rows[1], availableAt: rows[0].availableAt }])).payload;
  const resolved = resolveObservations(snapshot, { knownAt: "2025-01-09" });
  assert.equal(resolved.items.length, 0);
  assert.equal(resolved.coverage.ambiguous, 1);
  assert.deepEqual(resolved.decisions[0].assertionIds, ["correction", "initial"]);
  assert.equal(resolveObservations(snapshot, { mode: "first-publication" }).coverage.ambiguous, 1);
});

test("explicit history merge pins sources, deduplicates repeated assertions and resolves revisions across snapshots", async () => {
  const db = database();
  try {
    const rows = revisionRows();
    const initial = importObservations(db, request([rows[0]])).snapshot;
    const correction = importObservations(db, request([rows[0], rows[1]])).snapshot;
    const merge = {
      name: "Combined temperature history",
      reason: "Combine original and correction deliveries",
      identityNamespace: "Provider temperature observations",
      snapshotIds: [initial.id, correction.id],
    };
    const combined = mergeObservationSnapshots(db, merge).snapshot;
    assert.equal(combined.events.length, 2);
    assert.equal(combined.composition.received, 3);
    assert.equal(combined.composition.unique, 2);
    assert.equal(
      mergeObservationSnapshots(db, { ...merge, snapshotIds: [...merge.snapshotIds].reverse() }).snapshot.id,
      combined.id,
      "selection order does not create another version",
    );
    assert.equal(JSON.parse(combined.rawContent).merge.sources.length, 2);
    assert.equal(combined.events.find((e) => e.id === "initial").original.mergeSourceSnapshotIds.length, 2);
    assert.equal(resolveObservations(combined, { knownAt: "2025-01-05" }).items[0].value, -4);
    assert.equal(resolveObservations(combined, { knownAt: "2025-01-09" }).items[0].value, 12);
    const derived = deriveObservationSignals(db, combined.id, policy).dataset;
    assert.doesNotThrow(() => verifyObservationDerivation(derived));
    const bars = Array.from({ length: 80 }, (_, i) => [dayOf("2025-01-01") + i, 100 + i, 101 + i]);
    const result = await runSpec(
      db,
      { source: "dataset", datasetId: derived.id, rules: { holdDays: 10 } },
      {
        sourceFn: async () => datasetSource(derived),
        loadBarsFn: async () => ({
          bars: { AAPL: bars, SPY: bars },
          pending: [],
          stale: [],
          cached: 2,
          fetched: 0,
          missing: [],
          oldestStoredAt: Date.now(),
        }),
      },
    );
    const run = getRun(db, result.runId);
    assert.equal(replayRun(run).matches, true);
    const archive = archiveEvidence(db, run),
      embedded = JSON.parse(archive.datasets[derived.id].manifest.observation.snapshot.rawContent).merge.sources;
    assert.deepEqual(embedded.map((s) => s.id).sort(), [initial.id, correction.id].sort());
    assert.ok(embedded.every((s) => typeof s.rawContent === "string"));
    const withdrawal = importObservations(db, request([rows[2]])).snapshot;
    const later = mergeObservationSnapshots(db, { ...merge, snapshotIds: [combined.id, withdrawal.id] }).snapshot;
    assert.equal(resolveObservations(later, { knownAt: "2025-01-12" }).coverage.retracted, 1);
    assert.equal(getObservations(db, combined.id).events.length, 2, "earlier merged history is immutable");
    const altered = structuredClone(combined);
    altered.composition.unique = 100;
    assert.throws(() => verifyObservationComposition(altered), /records mismatch/);
  } finally {
    db.close();
  }
});
test("history merge refuses conflicting IDs, changed identities, incompatible rights and implicit source selection", () => {
  const db = database();
  try {
    const initial = importObservations(db, request([revisionRows()[0]])).snapshot;
    const conflict = importObservations(db, request([{ ...revisionRows()[0], value: 100 }])).snapshot;
    const merge = {
      name: "Refused history",
      reason: "Conflict test",
      identityNamespace: "Synthetic shared IDs",
      snapshotIds: [initial.id, conflict.id],
    };
    assert.throws(() => mergeObservationSnapshots(db, merge), /conflicting contents/);
    assert.throws(() => mergeObservationSnapshots(db, { ...merge, snapshotIds: [initial.id, initial.id] }), /distinct/);
    assert.throws(() => mergeObservationSnapshots(db, { ...merge, snapshotIds: [initial.id] }), /distinct/);
    assert.throws(() => mergeObservationSnapshots(db, { ...merge, identityNamespace: "" }), /namespace/);
    const wrongIdentity = importObservations(db, request([{ ...revisionRows()[1], unit: "F" }])).snapshot;
    assert.throws(
      () => mergeObservationSnapshots(db, { ...merge, snapshotIds: [initial.id, wrongIdentity.id] }),
      /Revisions must retain/,
    );
    const wrongRights = importObservations(db, {
      ...request([revisionRows()[1]]),
      license: "Different rights",
    }).snapshot;
    assert.throws(
      () => mergeObservationSnapshots(db, { ...merge, snapshotIds: [initial.id, wrongRights.id] }),
      /license labels/,
    );
    assert.equal(listObservations(db).filter((s) => s.name === "Refused history").length, 0);
  } finally {
    db.close();
  }
});

const forecast = {
  ...records[0],
  id: "forecast-first",
  observationId: "forecast-issue-1",
  observationType: "forecast",
  eventAt: "2025-01-01",
  availableAt: "2025-01-02",
  targetAt: "2025-01-10",
  value: -8,
};
test("forecast contract distinguishes issuance, publication and target and rejects identity drift", () => {
  const prepared = prepareObservations(request([forecast]));
  assert.equal(prepared.ok, true);
  assert.equal(prepared.payload.schemaVersion, 3);
  for (const patch of [
    { targetAt: "" },
    { targetAt: "2025-01-01" },
    { observationType: "estimate" },
    { observationType: false },
    { availableAt: "2024-12-31" },
    { observationType: "realized" },
  ])
    assert.equal(prepareObservations(request([{ ...forecast, ...patch }])).ok, false);
  for (const patch of [
    { targetAt: "2025-01-11" },
    { eventAt: "2025-01-02" },
    { observationType: "realized", targetAt: "" },
  ])
    assert.equal(prepareObservations(request([forecast, { ...forecast, id: "changed", ...patch }])).ok, false);
  const lateCorrection = { ...forecast, id: "late-correction", availableAt: "2025-01-15", value: 12 };
  assert.equal(
    prepareObservations(request([forecast, lateCorrection])).ok,
    true,
    "late corrections are historical evidence, not a reason to discard the history",
  );
});

test("forecast thresholds preserve first publication, exclude late first publications and never substitute outcomes", async () => {
  const db = database();
  try {
    const correction = { ...forecast, id: "correction", availableAt: "2025-01-15", value: 12 };
    const actual = {
      ...records[0],
      id: "actual",
      observationId: "realized-target",
      eventAt: "2025-01-10",
      availableAt: "2025-01-11",
      value: -20,
    };
    const late = { ...forecast, id: "late-first", observationId: "late-issue", availableAt: "2025-01-10", value: -30 };
    const snapshot = importObservations(db, request([forecast, correction, actual, late])).snapshot;
    assert.throws(() => deriveObservationSignals(db, snapshot.id, policy), /Explicitly choose/);
    const derived = deriveObservationSignals(db, snapshot.id, { ...policy, observationType: "forecast" });
    assert.equal(derived.dataset.events.length, 1);
    assert.equal(derived.dataset.events[0].eventAt, forecast.eventAt);
    assert.equal(derived.dataset.events[0].availableAt, forecast.availableAt);
    assert.equal(derived.transformation.lineage[0].targetAt, forecast.targetAt);
    assert.equal(derived.transformation.lineage[0].observationId, forecast.id);
    assert.deepEqual(derived.transformation.forecastExclusions, [
      { id: "late-first", reason: "first-publication-not-before-target" },
    ]);
    assert.equal(
      resolveObservations(snapshot, { mode: "latest-known", knownAt: "2025-01-16" }).items.find(
        (e) => e.observationId === forecast.observationId,
      ).value,
      12,
    );
    const realized = deriveObservationSignals(db, snapshot.id, { ...policy, observationType: "realized" });
    assert.equal(realized.transformation.lineage[0].observationId, "actual");
    assert.throws(
      () =>
        deriveObservationSignals(db, snapshot.id, { ...policy, observationType: "forecast", knownAt: "2025-01-01" }),
      /No observations/,
    );
    verifyObservationDerivation(derived.dataset);
    const broken = structuredClone(derived.dataset);
    broken.manifest.observation.forecastExclusions = [];
    assert.throws(() => verifyObservationDerivation(broken), /timing exclusions/);
    const altered = structuredClone(derived.dataset);
    altered.manifest.observation.snapshot.events[0].targetAt = "2025-02-01";
    assert.throws(() => verifyObservationDerivation(altered), /original source/);
    const bars = Array.from({ length: 80 }, (_, i) => [dayOf("2025-01-01") + i, 100 + i, 101 + i]);
    const result = await runSpec(
      db,
      { source: "dataset", datasetId: derived.dataset.id, rules: { holdDays: 10 } },
      {
        sourceFn: async () => datasetSource(derived.dataset),
        loadBarsFn: async () => ({
          bars: { AAPL: bars, SPY: bars },
          pending: [],
          stale: [],
          cached: 2,
          fetched: 0,
          missing: [],
          oldestStoredAt: Date.now(),
        }),
      },
    );
    const run = getRun(db, result.runId);
    assert.equal(replayRun(run).matches, true);
    assert.equal(
      archiveEvidence(db, run).datasets[derived.dataset.id].manifest.observation.snapshot.events[0].targetAt,
      forecast.targetAt,
    );
  } finally {
    db.close();
  }
});

test("forecast merging retains targets and rejects conflicting forecast identities", () => {
  const db = database();
  try {
    const first = importObservations(db, { ...request([forecast]), name: "Forecast delivery 1" }).snapshot;
    const second = importObservations(db, {
      ...request([{ ...forecast, id: "correction", availableAt: "2025-01-15", value: 12 }]),
      name: "Forecast delivery 2",
    }).snapshot;
    const merged = mergeObservationSnapshots(db, {
      name: "Forecast history",
      reason: "Join publications",
      identityNamespace: "Synthetic issuance IDs",
      snapshotIds: [first.id, second.id],
    }).snapshot;
    verifyObservationComposition(merged);
    assert.equal(merged.events.length, 2);
    assert.ok(merged.events.every((e) => e.targetAt === forecast.targetAt));
    const conflict = importObservations(db, {
      ...request([{ ...forecast, id: "changed-target", targetAt: "2025-01-11" }]),
      name: "Conflicting identity",
    }).snapshot;
    assert.throws(
      () =>
        mergeObservationSnapshots(db, {
          name: "Invalid",
          reason: "Fixture",
          identityNamespace: "Same",
          snapshotIds: [first.id, conflict.id],
        }),
      /retain/,
    );
  } finally {
    db.close();
  }
});

test("forecast evidence survives backup recovery and standalone replay after the database closes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-forecast-portable-"));
  const archiveDir = path.join(dir, "standalone");
  fs.mkdirSync(archiveDir);
  const db = database(path.join(dir, "cache.sqlite"));
  let closed = false;
  try {
    const initial = importObservations(
      db,
      request([forecast, { ...forecast, id: "late", observationId: "late-issue", availableAt: forecast.targetAt }]),
    ).snapshot;
    const correction = importObservations(
      db,
      request([{ ...forecast, id: "corrected", value: 20, availableAt: "2025-01-15" }]),
    ).snapshot;
    const snapshot = mergeObservationSnapshots(db, {
      name: "Portable forecast history",
      reason: "Preserve original and late correction",
      identityNamespace: "Synthetic forecast issues",
      snapshotIds: [initial.id, correction.id],
    }).snapshot;
    const derived = deriveObservationSignals(db, snapshot.id, { ...policy, observationType: "forecast" }).dataset;
    const bars = Array.from({ length: 80 }, (_, i) => [dayOf("2025-01-01") + i, 100 + i, 101 + i]);
    const result = await runSpec(
      db,
      { source: "dataset", datasetId: derived.id, rules: { holdDays: 10 } },
      {
        sourceFn: async () => datasetSource(derived),
        loadBarsFn: async () => ({
          bars: { AAPL: bars, SPY: bars },
          pending: [],
          stale: [],
          cached: 2,
          fetched: 0,
          missing: [],
          oldestStoredAt: Date.now(),
        }),
      },
    );
    const run = getRun(db, result.runId);
    fs.writeFileSync(path.join(archiveDir, "run.zip"), exportRun(db, run));
    const backup = path.join(dir, "backup");
    createResearchBackup(path.join(dir, "research.sqlite"), backup);
    db.close();
    closed = true;
    const restoredPath = path.join(dir, "restored.sqlite");
    assert.equal(restoreResearchBackup(backup, restoredPath).verified, true);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      const recoveredSnapshot = JSON.parse(
        restored.prepare("SELECT body FROM observation_snapshots WHERE id=?").get(snapshot.id).body,
      );
      assert.deepEqual(recoveredSnapshot, snapshot);
      verifyObservationComposition(recoveredSnapshot);
      const recoveredDataset = JSON.parse(
        restored.prepare("SELECT body FROM datasets WHERE id=?").get(derived.id).body,
      );
      verifyObservationDerivation(recoveredDataset);
      assert.deepEqual(recoveredDataset, derived);
      const recoveredRun = JSON.parse(restored.prepare("SELECT body FROM runs WHERE id=?").get(run.id).body);
      assert.equal(replayRun(recoveredRun).matches, true);
    } finally {
      restored.close();
    }
    const unpack = spawnSync("unzip", ["-q", "run.zip"], { cwd: archiveDir, encoding: "utf8" });
    assert.equal(unpack.status, 0, unpack.stderr);
    // The child process has only the archive, not the application's module graph or database.
    const replay = () =>
      spawnSync(process.execPath, ["replay.mjs"], { cwd: archiveDir, encoding: "utf8", timeout: 30000 });
    const output = replay();
    assert.equal(output.status, 0, output.stderr);
    assert.equal(JSON.parse(output.stdout).matches, true);
    const evidencePath = path.join(archiveDir, "evidence.json");
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    const preserved = evidence.datasets[derived.id].manifest.observation;
    assert.equal(preserved.lineage.length, 1);
    assert.equal(preserved.lineage[0].targetAt, forecast.targetAt);
    assert.deepEqual(preserved.forecastExclusions, [{ id: "late", reason: "first-publication-not-before-target" }]);
    const deliveries = JSON.parse(preserved.snapshot.rawContent).merge.sources;
    assert.deepEqual(deliveries.map((s) => s.id).sort(), [initial.id, correction.id].sort());
    assert.ok(
      deliveries.some((s) => JSON.parse(s.rawContent).some((row) => row.id === "corrected" && row.value === 20)),
    );
    preserved.snapshot.events[0].targetAt = "2025-02-01";
    fs.writeFileSync(evidencePath, JSON.stringify(evidence));
    const changed = replay();
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /Checksum mismatch: evidence.json/);
  } finally {
    if (!closed) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
