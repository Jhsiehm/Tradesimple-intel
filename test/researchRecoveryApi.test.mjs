import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { openDb } from "../server/lib/db.mjs";
import { importDataset, datasetSource } from "../server/domain/research-events.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { saveExperiment } from "../server/domain/research-store.mjs";
import { dayOf } from "../shared/backtest.mjs";
import {
  createResearchBackup,
  restoreResearchBackup,
  verifyResearchBackup,
} from "../server/domain/research-backup.mjs";
import { serverEnv } from "./fixtures/serverEnv.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
async function start(cache, research) {
  const child = spawn(process.execPath, ["--import", "./test/fixtures/offline.mjs", "server/index.mjs"], {
    cwd: root,
    env: serverEnv({ PORT: "0", INTEL_CACHE: cache, INTEL_RESEARCH: research }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stderr.on("data", (chunk) => {
    logs = (logs + chunk).slice(-4000);
  });
  try {
    const base = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Recovery API startup timed out: " + logs)), 10000);
      const finish = (err, value) => {
        clearTimeout(timer);
        child.off("exit", exit);
        child.off("error", error);
        err ? reject(err) : resolve(value);
      };
      const exit = (code) => finish(Error(`Recovery API exited ${code}: ${logs}`));
      const error = (err) => finish(err);
      child.once("exit", exit);
      child.once("error", error);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/intel api (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(null, match[1]);
      });
    });
    return { child, base };
  } catch (error) {
    await stop(child);
    throw error;
  }
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGKILL");
  });
}
async function json(server, route, body) {
  const response = await fetch(server.base + "/api/research/" + route, {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.notEqual(value.ok, false, JSON.stringify(value));
  return value;
}
test(
  "a running API backup recovers into an empty cache, preserves snapshot boundaries, and accepts durable new work",
  { timeout: 30000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-api-recovery-"));
    const cache = path.join(dir, "source-cache.sqlite"),
      research = path.join(dir, "source-research.sqlite");
    const prior = { cache: process.env.INTEL_CACHE, research: process.env.INTEL_RESEARCH };
    let db, server;
    try {
      process.env.INTEL_CACHE = cache;
      process.env.INTEL_RESEARCH = research;
      db = openDb(root);
      const dataset = importDataset(db, {
        name: "Recovery signals",
        source: "Synthetic fixture",
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
      const experiment = saveExperiment(db, { title: "Recovery experiment", runId: run.runId });
      db.close();
      db = null;
      server = await start(cache, research);
      const draft = {
        title: "Recovery finding",
        status: "draft",
        hypothesis: "Synthetic recovery exercise",
        conclusion: "",
        decision: "",
        tags: [],
        evidence: [{ kind: "experiment", id: experiment.id }],
        followups: [],
      };
      const notebook = (await json(server, "notebooks", draft)).notebook;
      const ledger = (
        await json(server, "paper", {
          title: "Recovery simulation",
          experimentId: experiment.id,
          initialCashCents: 100000,
          maxOrderCents: 50000,
          maxPositionShares: 10,
        })
      ).ledger;
      const fill = {
        kind: "fill",
        requestId: "before-backup",
        expectedSequence: 0,
        symbol: "AAPL",
        side: "buy",
        quantity: 2,
        priceCents: 10000,
        feeCents: 10,
        priceBasis: "Synthetic assumption",
        approvalReason: "Recovery test",
      };
      const recorded = (await json(server, `paper/${ledger.account.id}/actions`, fill)).ledger;
      createResearchBackup(research, path.join(dir, "backup"));
      await json(server, `notebooks/${notebook.id}`, { ...draft, baseRevision: 1, title: "After snapshot" });
      await stop(server.child);
      server = null;
      // The restored API has neither the source cache nor a usable source research path.
      fs.renameSync(research, research + ".retired");
      const recoveredDir = path.join(dir, "recovered");
      fs.mkdirSync(recoveredDir);
      const restored = path.join(recoveredDir, "research.sqlite");
      restoreResearchBackup(path.join(dir, "backup"), restored);
      const recoveredCache = path.join(recoveredDir, "empty-cache.sqlite");
      server = await start(recoveredCache, restored);
      assert.ok((await json(server, "experiments")).items.some((e) => e.id === experiment.id));
      const restoredExperiment = (await json(server, `experiments/${experiment.id}`)).experiment;
      assert.equal(restoredExperiment.run.inputHash, experiment.run.inputHash);
      assert.equal((await json(server, `datasets/${dataset.id}`)).dataset.contentHash, dataset.contentHash);
      const recoveredNotebook = (await json(server, `notebooks/${notebook.id}`)).notebook;
      assert.equal(recoveredNotebook.title, "Recovery finding");
      assert.equal(recoveredNotebook.revision, 1);
      assert.deepEqual(recoveredNotebook.evidence, notebook.evidence);
      assert.equal((await json(server, `runs/${run.runId}/replay`, {})).matches, true);
      assert.deepEqual((await json(server, `paper/${ledger.account.id}/actions`, fill)).ledger, recorded);
      const next = (
        await json(server, `paper/${ledger.account.id}/actions`, {
          ...fill,
          requestId: "after-restore",
          expectedSequence: 1,
          side: "sell",
          quantity: 1,
        })
      ).ledger;
      assert.equal(next.state.sequence, 2);
      assert.equal(next.state.cashCents, 89980);
      const revised = (
        await json(server, `notebooks/${notebook.id}`, { ...draft, baseRevision: 1, title: "Recovered and reviewed" })
      ).notebook;
      assert.equal(revised.revision, 2);
      const download = await fetch(server.base + `/api/research/runs/${run.runId}/export`);
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-type"), /application\/zip/);
      fs.writeFileSync(path.join(dir, "run.zip"), Buffer.from(await download.arrayBuffer()));
      const exported = path.join(dir, "export");
      fs.mkdirSync(exported);
      assert.equal(spawnSync("unzip", ["-q", path.join(dir, "run.zip"), "-d", exported]).status, 0);
      const replay = spawnSync(process.execPath, ["replay.mjs"], { cwd: exported, encoding: "utf8", timeout: 5000 });
      assert.equal(replay.status, 0, replay.stderr);
      assert.equal(JSON.parse(replay.stdout).matches, true);
      await stop(server.child);
      server = null;
      server = await start(recoveredCache, restored);
      assert.equal((await json(server, `notebooks/${notebook.id}`)).notebook.title, "Recovered and reviewed");
      assert.deepEqual((await json(server, `paper/${ledger.account.id}`)).ledger.state, next.state);
      assert.equal(fs.existsSync(research), false, "recovered API must not reopen the retired research path");
      createResearchBackup(restored, path.join(dir, "recovered-backup"));
      assert.equal(verifyResearchBackup(path.join(dir, "recovered-backup")).counts.paper_events, 2);
    } finally {
      await stop(server?.child);
      db?.close();
      for (const [key, value] of [
        ["INTEL_CACHE", prior.cache],
        ["INTEL_RESEARCH", prior.research],
      ]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
