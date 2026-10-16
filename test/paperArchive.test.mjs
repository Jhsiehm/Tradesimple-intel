import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openDb } from "../server/lib/db.mjs";
import { importDataset, datasetSource } from "../server/domain/research-events.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { saveExperiment, hashOf } from "../server/domain/research-store.mjs";
import { createPaperAccount, recordPaperAction } from "../server/domain/paper-ledger.mjs";
import { exportPaperArchive } from "../server/domain/paper-archive.mjs";
import { verifyPaperDirectory } from "../server/domain/paper-verifier.mjs";
import { dayOf } from "../shared/backtest.mjs";
async function fixture() {
  const prior = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ":memory:";
  let db;
  try {
    db = openDb(decodeURIComponent(new URL("..", import.meta.url).pathname));
  } finally {
    if (prior === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = prior;
  }
  try {
    const dataset = importDataset(db, {
      name: "Portable paper source",
      source: "Synthetic",
      format: "json",
      content: JSON.stringify([
        { id: "a", symbol: "AAPL", side: "buy", eventAt: "2025-01-01", availableAt: "2025-01-03" },
      ]),
    }).dataset;
    const bars = Array.from({ length: 80 }, (_, i) => [dayOf("2025-01-01") + i, 100 + i, 101 + i]);
    const run = await runSpec(
      db,
      { source: "dataset", datasetId: dataset.id, rules: { holdDays: 10 } },
      {
        sourceFn: async () => datasetSource(dataset),
        loadBarsFn: async () => ({
          bars: { AAPL: bars, SPY: bars.map((b) => [b[0], 100, 100]) },
          pending: [],
          stale: [],
          cached: 2,
          fetched: 0,
          missing: [],
          oldestStoredAt: Date.now(),
        }),
      },
    );
    const experiment = saveExperiment(db, { title: "Portable source", runId: run.runId });
    const ledger = createPaperAccount(db, {
      title: "Portable account",
      experimentId: experiment.id,
      initialCashCents: 100000,
      maxOrderCents: 50000,
      maxPositionShares: 10,
    });
    return { db, ledger, dataset };
  } catch (error) {
    db.close();
    throw error;
  }
}
function unpack(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-paper-archive-"));
  fs.writeFileSync(path.join(dir, "paper.zip"), bytes);
  assert.equal(spawnSync("unzip", ["-q", "paper.zip"], { cwd: dir }).status, 0);
  return dir;
}
function rehash(dir, name) {
  const file = path.join(dir, "checksums.json"),
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest[name] = hashOf(fs.readFileSync(path.join(dir, name), "utf8"));
  fs.writeFileSync(file, JSON.stringify(manifest));
}
test("paper archive independently replays balances and source after the database is closed", async () => {
  const { db, ledger, dataset } = await fixture();
  let dir;
  try {
    recordPaperAction(db, ledger.account.id, {
      kind: "fill",
      requestId: "buy",
      expectedSequence: 0,
      symbol: "AAPL",
      side: "buy",
      quantity: 2,
      priceCents: 10000,
      feeCents: 10,
      priceBasis: "Synthetic assumed price",
      approvalReason: "Test approved fill",
    });
    recordPaperAction(db, ledger.account.id, {
      kind: "halt",
      requestId: "halt",
      expectedSequence: 1,
      reason: "Review",
    });
    dir = unpack(exportPaperArchive(db, ledger.account.id));
    recordPaperAction(db, ledger.account.id, {
      kind: "resume",
      requestId: "resume",
      expectedSequence: 2,
      reason: "Later change not in archive",
    });
    db.close();
    const proof = await verifyPaperDirectory(dir);
    assert.equal(proof.verified, true);
    assert.equal(proof.events, 2);
    assert.equal(proof.halted, true);
    assert.equal(proof.cashCents, 79990);
    assert.deepEqual(proof.positions, { AAPL: 2 });
    assert.equal(proof.sourceReplay, true);
    const standalone = spawnSync(process.execPath, ["verify.mjs"], { cwd: dir, encoding: "utf8" });
    assert.equal(standalone.status, 0, standalone.stderr);
    assert.deepEqual(JSON.parse(standalone.stdout), proof);
    const evidence = JSON.parse(fs.readFileSync(path.join(dir, "source/evidence.json"), "utf8"));
    assert.equal(evidence.datasets[dataset.id].rawContent, dataset.rawContent);
  } finally {
    try {
      db.close();
    } catch {}
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("paper verifier rejects changed balances even when outer payload and file hashes are recomputed", async () => {
  const { db, ledger } = await fixture();
  const dir = unpack(exportPaperArchive(db, ledger.account.id));
  db.close();
  try {
    const file = path.join(dir, "paper.json"),
      bundle = JSON.parse(fs.readFileSync(file, "utf8"));
    bundle.ledger.state.cashCents += 1;
    bundle.ledgerHash = hashOf(bundle.ledger);
    fs.writeFileSync(file, JSON.stringify(bundle));
    rehash(dir, "paper.json");
    await assert.rejects(verifyPaperDirectory(dir), /balances/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("paper verifier refuses mismatched source experiment, missing evidence and unsafe archive paths", async () => {
  const { db, ledger } = await fixture(),
    bytes = exportPaperArchive(db, ledger.account.id);
  db.close();
  for (const change of ["reference", "missing", "unsafe", "engine", "omitted-engine"]) {
    const dir = unpack(bytes);
    try {
      if (change === "reference") {
        const file = path.join(dir, "source-experiment.json"),
          record = JSON.parse(fs.readFileSync(file, "utf8"));
        record.runId = "run_0000";
        fs.writeFileSync(file, JSON.stringify(record));
        rehash(dir, "source-experiment.json");
      }
      if (change === "missing") fs.unlinkSync(path.join(dir, "source/evidence.json"));
      if (change === "unsafe") {
        const file = path.join(dir, "checksums.json"),
          manifest = JSON.parse(fs.readFileSync(file, "utf8"));
        manifest["../outside"] = "bad";
        fs.writeFileSync(file, JSON.stringify(manifest));
      }
      if (change === "omitted-engine") {
        const file = path.join(dir, "checksums.json"),
          manifest = JSON.parse(fs.readFileSync(file, "utf8"));
        delete manifest["source/engine/backtest.mjs"];
        fs.writeFileSync(file, JSON.stringify(manifest));
      }
      if (change === "engine") fs.appendFileSync(path.join(dir, "paper-engine.mjs"), "\n// altered\n");
      await assert.rejects(verifyPaperDirectory(dir), /reference|ENOENT|Unsafe|Checksum|Missing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
