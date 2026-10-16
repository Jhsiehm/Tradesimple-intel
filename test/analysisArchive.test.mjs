import { openDb } from "../server/lib/db.mjs";
import { dayOf } from "../shared/backtest.mjs";
import { DEFAULT_RULES } from "../shared/backtestSpec.mjs";
import { importDataset, datasetSource } from "../server/domain/research-events.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { prepareAskMemory } from "../server/ai/researchContext.mjs";
import { startAnalysis } from "../server/domain/research-analysis.mjs";
import { exportAnalysis } from "../server/domain/analysis-archive.mjs";
import { verifyAnalysisArchive, verifyAnalysisDirectory } from "../server/domain/analysis-verifier.mjs";
import { saveNotebook } from "../server/domain/notebooks.mjs";
import { approveMemory, createMemorySnapshot } from "../server/domain/research-context.mjs";
import { hashOf, putRun, saveExperiment } from "../server/domain/research-store.mjs";
import { ENGINE } from "../server/domain/research-replay.mjs";
function unpack(bytes, dir) {
  fs.writeFileSync(path.join(dir, "record.zip"), bytes);
  execFileSync("unzip", ["-q", "record.zip"], { cwd: dir });
}
function command(dir) {
  return JSON.parse(execFileSync(process.execPath, [path.join(dir, "verify.mjs")], { encoding: "utf8" }));
}
for (const status of ["completed", "failed", "incomplete"])
  test(`portable analysis verifies ${status} after database closure`, () => {
    const db = new DatabaseSync(":memory:"),
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-analysis-"));
    let closed = false;
    try {
      const memory = prepareAskMemory(db, { mode: "isolated" });
      const journal = startAnalysis(db, {
        request: { question: "Synthetic only" },
        memory,
        provider: "fixture",
        model: "fixture",
      });
      journal.append("model_input", { messages: [{ role: "user", content: "Question" }] });
      journal.append("tool_output", { name: "fixture", result: { value: 7, source: "Synthetic" } });
      journal.append("event", { type: "token", delta: "Partial text" });
      if (status !== "incomplete") journal.finish(status);
      unpack(exportAnalysis(db, journal.id), dir);
      db.close();
      closed = true;
      const proof = command(dir);
      assert.equal(proof.status, status);
      assert.equal(proof.analysisId, journal.id);
      const file = path.join(dir, "analysis.json"),
        bundle = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(bundle.payload.events[3].data.delta, "Partial text");
      const bad = structuredClone(bundle);
      bad.payload.events[2].data.result.value = 8;
      bad.payloadHash = hashOf(bad.payload);
      assert.throws(() => verifyAnalysisArchive(bad), /chain|head/i);
      const statusBad = structuredClone(bundle);
      statusBad.payload.status = status === "incomplete" ? "completed" : "incomplete";
      statusBad.payloadHash = hashOf(statusBad.payload);
      assert.throws(() => verifyAnalysisArchive(statusBad), /status mismatch/);
      fs.appendFileSync(file, " ");
      assert.throws(() => verifyAnalysisDirectory(dir), /Checksum mismatch/);
    } finally {
      if (!closed) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
for (const replay of [false, true])
  test(`analysis export pins historical notebook evidence after edits and revocation (replay=${replay})`, async () => {
    const old = process.env.INTEL_CACHE;
    process.env.INTEL_CACHE = ":memory:";
    let db;
    try {
      db = openDb(path.resolve("."));
    } finally {
      if (old === undefined) delete process.env.INTEL_CACHE;
      else process.env.INTEL_CACHE = old;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-analysis-memory-"));
    let closed = false;
    try {
      let runId;
      if (replay) {
        const dataset = importDataset(db, {
          name: "Analysis source",
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
        runId = run.runId;
      } else
        runId = putRun(db, {
          inputs: null,
          result: { ok: false, error: "Synthetic source failure" },
          provenance: {},
          engine: ENGINE,
        });
      const exp = saveExperiment(db, { runId, title: "Failed source" });
      const note = saveNotebook(db, {
        title: "Original finding",
        hypothesis: "Synthetic",
        conclusion: "Original conclusion",
        decision: "Keep limitations",
        status: "inconclusive",
        tags: [],
        followups: [],
        evidence: [{ kind: "experiment", id: exp.id }],
      });
      const approval = approveMemory(db, { notebookId: note.id, revision: 1, action: "approve", reason: "Reviewed" });
      const snapshot = createMemorySnapshot(db, {
        mode: "context-aware",
        knownAt: new Date().toISOString(),
        approvalIds: [approval.id],
      });
      const memory = prepareAskMemory(db, { mode: "context-aware", snapshotId: snapshot.id });
      const journal = startAnalysis(db, {
        request: { question: "Synthetic memory test" },
        memory,
        provider: "fixture",
        model: "fixture",
      });
      journal.finish("completed");
      saveNotebook(db, { ...note, baseRevision: 1, conclusion: "Later conclusion" }, note.id);
      approveMemory(db, { notebookId: note.id, revision: 1, action: "revoke", reason: "No new reuse" });
      unpack(exportAnalysis(db, journal.id), dir);
      db.close();
      closed = true;
      const proof = command(dir);
      assert.equal(proof.notebooks[0].revision, 1);
      assert.equal(proof.notebooks[0].results[0].status, replay ? "replayed" : "record-only");
      if (replay) assert.equal(proof.notebooks[0].results[0].matches, true);
      const manifestPath = path.join(dir, "checksums.json"),
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const notePath = `notebooks/${note.id}-r1/notebook.json`;
      const saved = JSON.parse(fs.readFileSync(path.join(dir, notePath), "utf8"));
      assert.equal(saved.notebook.conclusion, "Original conclusion");
      const missing = { ...manifest };
      delete missing[notePath];
      fs.writeFileSync(manifestPath, JSON.stringify(missing));
      assert.throws(() => verifyAnalysisDirectory(dir), /Missing analysis notebook/);
      manifest["../outside"] = "fake";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      assert.throws(() => verifyAnalysisDirectory(dir), /Unsafe analysis archive path/);
    } finally {
      if (!closed) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
