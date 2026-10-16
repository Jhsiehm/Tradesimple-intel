import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openDb } from "../server/lib/db.mjs";
import { dayOf } from "../shared/backtest.mjs";
import { DEFAULT_RULES } from "../shared/backtestSpec.mjs";
import { importDataset, datasetSource } from "../server/domain/research-events.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { saveExperiment, putRun, hashOf } from "../server/domain/research-store.mjs";
import { ENGINE } from "../server/domain/research-replay.mjs";
import { saveNotebook } from "../server/domain/notebooks.mjs";
import { createEventStudy, evaluateEventStudy } from "../server/domain/event-studies.mjs";
import { createStressPlan, evaluateStressPlan } from "../server/domain/research-stress.mjs";
import { exportNotebook } from "../server/domain/notebook-archive.mjs";
import { verifyNotebookArchive } from "../server/domain/notebook-verifier.mjs";
const root = decodeURIComponent(new URL("..", import.meta.url).pathname);
const noteBody = {
  title: "Portable finding",
  hypothesis: "Synthetic only",
  conclusion: "No investment conclusion",
  decision: "Retain evidence",
  status: "inconclusive",
  tags: ["AAPL"],
  followups: [],
};
function memoryDb() {
  const old = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ":memory:";
  try {
    return openDb(root);
  } finally {
    if (old === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = old;
  }
}
function unpack(bytes, dir) {
  fs.writeFileSync(path.join(dir, "notebook.zip"), bytes);
  const out = spawnSync("unzip", ["-q", "notebook.zip"], { cwd: dir, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
}
test("exact notebook revisions carry all source, study and stress evidence and replay independently", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-notebook-archive-"));
  let db = memoryDb();
  try {
    const dataset = importDataset(db, {
      name: "Portable source",
      source: "Synthetic",
      format: "json",
      content: JSON.stringify([
        { id: "a", symbol: "AAPL", side: "buy", eventAt: "2025-02-20", availableAt: "2025-02-21" },
      ]),
    }).dataset;
    const bars = Array.from({ length: 100 }, (_, i) => [dayOf("2025-01-01") + i, 100 + i, 100 + i]);
    const run = await runSpec(
      db,
      { source: "dataset", datasetId: dataset.id, rules: { ...DEFAULT_RULES, holdDays: 10 } },
      {
        sourceFn: async () => datasetSource(dataset),
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
    const experiment = saveExperiment(db, { runId: run.runId, title: "Portable source" });
    const study = createEventStudy(db, {
      title: "Portable market model",
      hypothesis: "Synthetic",
      experimentId: experiment.id,
      spec: {
        from: "2025-01-01",
        to: "2025-03-01",
        before: 2,
        after: 2,
        sides: "both",
        model: "market-model",
        estimationSessions: 20,
        estimationGap: 5,
      },
    });
    evaluateEventStudy(db, study.id);
    const stress = createStressPlan(db, {
      title: "Portable sensitivity",
      hypothesis: "Synthetic",
      experimentId: experiment.id,
      scenarios: [{ id: "cost", label: "Higher costs", extraCostBps: 10 }],
    });
    evaluateStressPlan(db, stress.id);
    const first = saveNotebook(db, {
      ...noteBody,
      evidence: [
        { kind: "experiment", id: experiment.id },
        { kind: "event-study", id: study.id },
        { kind: "stress", id: stress.id },
      ],
    });
    saveNotebook(db, { ...first, baseRevision: 1, conclusion: "A later interpretation" }, first.id);
    assert.equal(exportNotebook(db, first.id).revision, 2);
    assert.throws(() => exportNotebook(db, first.id, 0), /positive/);
    assert.throws(() => exportNotebook(db, first.id, 3), /not found/);
    const exported = exportNotebook(db, first.id, 1);
    unpack(exported.bytes, dir);
    db.close();
    db = null;
    const bundle = JSON.parse(fs.readFileSync(path.join(dir, "notebook.json"), "utf8"));
    assert.deepEqual(bundle.notebook, first);
    const verified = verifyNotebookArchive(dir);
    assert.equal(verified.revision, 1);
    assert.equal(verified.uniqueRuns, 3);
    assert.ok(verified.results.every((r) => r.status === "replayed" && r.matches));
    const command = spawnSync(process.execPath, ["verify.mjs"], { cwd: dir, encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(JSON.parse(command.stdout).verified, true);
    const alias = path.join(dir, "verify-alias.mjs");
    fs.symlinkSync(path.join(dir, "verify.mjs"), alias);
    const absolute = spawnSync(process.execPath, [alias], { encoding: "utf8" });
    assert.equal(absolute.status, 0, absolute.stderr);
    assert.equal(JSON.parse(absolute.stdout).verified, true);
    const evidence = JSON.parse(
      fs.readFileSync(path.join(dir, "runs", first.evidence[1].runId, "evidence.json"), "utf8"),
    );
    assert.equal(evidence.datasets[dataset.id].rawContent, dataset.rawContent);
    fs.appendFileSync(path.join(dir, "notebook.json"), " ");
    assert.throws(() => verifyNotebookArchive(dir), /Checksum mismatch/);
    bundle.notebook.evidence[0].inputHash = "forged";
    bundle.notebookHash = hashOf(bundle.notebook);
    const encoded = JSON.stringify(bundle);
    fs.writeFileSync(path.join(dir, "notebook.json"), encoded);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "checksums.json"), "utf8"));
    manifest["notebook.json"] = hashOf(encoded);
    fs.writeFileSync(path.join(dir, "checksums.json"), JSON.stringify(manifest));
    assert.throws(() => verifyNotebookArchive(dir), /pin mismatch/);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("portable notebooks retain failed attempts as record-only evidence and reject unsafe manifest paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-notebook-record-")),
    db = memoryDb();
  try {
    const runId = putRun(db, {
        inputs: null,
        result: { ok: false, error: "Synthetic unavailable source" },
        provenance: {},
        engine: ENGINE,
      }),
      exp = saveExperiment(db, { runId, title: "Failed attempt" });
    const note = saveNotebook(db, { ...noteBody, evidence: [{ kind: "experiment", id: exp.id }] });
    unpack(exportNotebook(db, note.id).bytes, dir);
    const verified = verifyNotebookArchive(dir);
    assert.equal(verified.results[0].status, "record-only");
    assert.equal(verified.results[0].matches, undefined);
    const file = path.join(dir, "checksums.json"),
      manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest["../outside"] = hashOf("x");
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => verifyNotebookArchive(dir), /Unsafe archive path/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
