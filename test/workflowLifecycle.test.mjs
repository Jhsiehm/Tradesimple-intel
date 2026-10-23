import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { importObservations, mergeObservationSnapshots } from "../server/domain/research-observations.mjs";
import { hashOf } from "../server/domain/research-store.mjs";
import {
  createResearchBackup,
  verifyResearchBackup,
  restoreResearchBackup,
} from "../server/domain/research-backup.mjs";
import {
  createInvestigation,
  amendInvestigation,
  replayInvestigation,
  getInvestigation,
  listInvestigations,
  runInvestigation,
  exportInvestigation,
  exportInvestigationArchive,
} from "../server/domain/workflow/investigations.mjs";

function snapshot(db, name = "Observed revenue", rows) {
  return importObservations(db, {
    name,
    source: "Explicit fixture provider",
    ownership: "local fixture",
    license: "Fixture-only; not production coverage",
    format: "json",
    content: JSON.stringify(
      rows || [
        {
          id: "a1",
          observationId: "a",
          entityId: "company:one",
          metric: "revenue",
          unit: "USD",
          value: 10,
          eventAt: "2020-01-01",
          availableAt: "2020-01-02",
          sourceUrl: "https://example.org/a",
        },
        {
          id: "a2",
          observationId: "a",
          entityId: "company:one",
          metric: "revenue",
          unit: "USD",
          value: 20,
          eventAt: "2020-01-01",
          availableAt: "2020-02-01",
          sourceUrl: "https://example.org/a-correction",
        },
        {
          id: "b1",
          observationId: "b",
          entityId: "company:two",
          metric: "revenue",
          unit: "USD",
          value: 30,
          eventAt: "2020-01-01",
          availableAt: "2020-01-03",
          sourceUrl: "https://example.org/b",
        },
      ],
    ),
  }).snapshot;
}
function protocol(id, changes = {}) {
  return {
    title: "Mean first-published revenue",
    question: "What is the observed mean across these imported records?",
    hypothesis: "Describe supplied revenue without a population or causal claim.",
    family: "descriptive",
    population: "Explicit imported fixture records",
    unitOfAnalysis: "One logical observation",
    outcome: "Revenue in USD",
    comparison: "No causal or trading comparison",
    from: "2020-01-01",
    to: "2020-01-31",
    knownAt: "2020-02-05",
    assumptions: ["Provider and availability labels are importer assertions."],
    unresolved: [],
    nodes: [
      { id: "source", op: "source", snapshotId: id, mode: "first-publication" },
      { id: "positive", op: "filter", input: "source", field: "value", operator: "gt", value: 0 },
      { id: "summary", op: "summarize", input: "positive", value: "value", groupBy: [] },
    ],
    outputs: ["summary"],
    ...changes,
  };
}
function extractStoredZip(bytes, directory) {
  const buffer = Buffer.from(bytes);
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0);
    const size = buffer.readUInt32LE(offset + 18),
      nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    assert.ok(!name.includes("..") && !path.isAbsolute(name));
    const start = offset + 30 + nameLength + extraLength,
      file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer.subarray(start, start + size));
    offset = start + size;
  }
}

test("workflow lifecycle pins exact observations, preserves decisions and retries idempotently", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const source = snapshot(db),
      plan = protocol(source.id);
    const created = createInvestigation(db, plan);
    assert.equal(created.status, "draft");
    assert.equal(created.archiveAvailable, false);
    assert.equal(createInvestigation(db, { ...plan, title: `  ${plan.title} ` }).id, created.id);
    assert.throws(() => exportInvestigationArchive(db, created.id), /Run and freeze/);
    await assert.rejects(runInvestigation(db, created.id, { revision: 7 }), /changed/);
    await assert.rejects(runInvestigation(db, created.id, { revision: "1" }), /positive integer/);
    const [run, concurrent] = await Promise.all([
      runInvestigation(db, created.id, { revision: 1 }),
      runInvestigation(db, created.id, { revision: 1 }),
    ]);
    assert.equal(run.status, "completed");
    assert.equal(run.executed, true);
    assert.deepEqual(run, concurrent);
    assert.equal(run.result.outputs.summary.preview[0].mean, 20);
    assert.equal(run.result.steps[0].ledger.excluded, 0);
    assert.equal(run.result.steps[0].source.decisionCounts.selected, 2);
    assert.equal(run.evaluation.inputs, undefined);
    assert.equal(run.result.outputs.summary.rows, undefined);
    assert.equal(run.result.outputs.summary.preview[0].lineage, undefined);
    assert.equal((await runInvestigation(db, created.id, { revision: 1 })).revision, 2);
    assert.equal((await runInvestigation(db, created.id, { revision: 2 })).revision, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM research.workflow_revisions").get().n, 2);
    const exported = exportInvestigation(db, created.id);
    assert.equal(exported.record.evaluation.originals[source.id].rawContent, source.rawContent);
    assert.equal(exported.record.evaluation.inputs.sources.source.rows[0].original, undefined);
    assert.equal(exported.record.evaluation.inputs.sources.source.decisions[0].otherKnownAssertionIds[0], "a2");
    assert.equal(exported.record.evaluation.inputs.sources.source.provenance.license, source.license);
    assert.equal(listInvestigations(db).items[0].protocol, undefined);
    assert.throws(() => db.prepare("UPDATE research.workflow_revisions SET body='{}'").run(), /immutable/);
  } finally {
    db.close();
  }
});

test("missing, unresolved, incompatible and non-descriptive plans persist blocked instead of manufactured results", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const source = snapshot(db);
    for (const plan of [
      protocol("obs_missing"),
      protocol(source.id, { family: "causal" }),
      protocol(source.id, { unresolved: ["No identification argument yet"] }),
    ]) {
      const created = createInvestigation(db, plan);
      assert.equal(created.status, "blocked");
      const run = await runInvestigation(db, created.id, { revision: 1 });
      assert.equal(run.status, "blocked");
      assert.equal(run.executed, false);
      assert.ok(run.result.gaps.length);
      assert.deepEqual(run.result.outputs, {});
      assert.equal(run.archiveAvailable, true);
    }
    const invalid = protocol(source.id, { nodes: [{ id: "eval", op: "javascript", code: "process.exit()" }] });
    assert.throws(() => createInvestigation(db, invalid), /Unknown workflow/);
    assert.equal(listInvestigations(db).items.length, 3);
  } finally {
    db.close();
  }
});

test("cancelled execution records a failed attempt and allows an explicit retry at the new revision", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const created = createInvestigation(db, protocol(snapshot(db).id));
    const controller = new AbortController();
    controller.abort();
    const failed = await runInvestigation(db, created.id, { revision: 1, signal: controller.signal });
    assert.equal(failed.status, "failed");
    assert.equal(failed.archiveAvailable, false);
    assert.match(failed.attempt.error, /cancelled/);
    assert.equal((await runInvestigation(db, created.id, { revision: 1 })).revision, 2);
    const retry = await runInvestigation(db, created.id, { revision: 2 });
    assert.equal(retry.status, "completed");
    assert.equal(retry.revision, 3);
    assert.equal(exportInvestigation(db, created.id).history.length, 2);
  } finally {
    db.close();
  }
});

test("standalone ZIP replays original sources and engine with no database/network/packages, and detects changes", async () => {
  const db = new DatabaseSync(":memory:"),
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-workflow-replay-"));
  try {
    const created = createInvestigation(db, protocol(snapshot(db).id));
    await runInvestigation(db, created.id, { revision: 1 });
    extractStoredZip(exportInvestigationArchive(db, created.id), directory);
    const file = path.join(directory, "deny-network.cjs");
    fs.writeFileSync(file, "globalThis.fetch=()=>{throw Error('Network forbidden')};\n");
    const output = JSON.parse(
      execFileSync(process.execPath, ["--require", file, path.join(directory, "replay.mjs")], { encoding: "utf8" }),
    );
    assert.equal(output.matches, true);
    assert.equal(output.status, "completed");
    fs.appendFileSync(path.join(directory, "engine", "workflow.mjs"), "\n// changed\n");
    assert.throws(
      () => execFileSync(process.execPath, [path.join(directory, "replay.mjs")], { stdio: "pipe" }),
      /Command failed/,
    );
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("frozen embedded composition survives absent live sources; drafts and tampered frozen inputs fail recovery", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-workflow-backup-"));
  const db = new DatabaseSync(path.join(directory, "cache.sqlite"));
  try {
    const first = snapshot(db),
      second = snapshot(db, "Second compatible history");
    const merged = mergeObservationSnapshots(db, {
      name: "Merged fixture",
      snapshotIds: [first.id, second.id],
      reason: "Explicit overlap",
      identityNamespace: "fixture",
    }).snapshot;
    const created = createInvestigation(db, protocol(merged.id));
    await runInvestigation(db, created.id, { revision: 1 });
    db.exec("DROP TRIGGER research.observation_snapshots_delete");
    db.prepare("DELETE FROM research.observation_snapshots").run();
    assert.equal(getInvestigation(db, created.id).status, "completed");
    const backup = path.join(directory, "backup");
    createResearchBackup(path.join(directory, "research.sqlite"), backup);
    assert.equal(verifyResearchBackup(backup).counts.workflow_revisions, 2);
    const restored = path.join(directory, "restored");
    fs.mkdirSync(restored);
    restoreResearchBackup(backup, path.join(restored, "research.sqlite"));
    const restoredDb = new DatabaseSync(path.join(restored, "cache.sqlite"));
    try {
      assert.equal(getInvestigation(restoredDb, created.id).status, "completed");
    } finally {
      restoredDb.close();
    }
    db.exec("DROP TRIGGER research.workflow_revisions_update");
    const row = db.prepare("SELECT body FROM research.workflow_revisions WHERE id=? AND revision=2").get(created.id);
    const altered = JSON.parse(row.body);
    altered.evaluation.inputs.sources.source.rows[0].value = 999;
    const body = JSON.stringify(altered);
    db.prepare("UPDATE research.workflow_revisions SET body=?,body_hash=? WHERE id=? AND revision=2").run(
      body,
      hashOf(body),
      created.id,
    );
    assert.throws(() => getInvestigation(db, created.id), /checksum mismatch/);
    assert.throws(
      () => createResearchBackup(path.join(directory, "research.sqlite"), path.join(directory, "bad")),
      /checksum mismatch/,
    );
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("draft missing pinned source or index corruption is detected before calculation", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const source = snapshot(db),
      created = createInvestigation(db, protocol(source.id));
    db.exec("DROP TRIGGER research.observation_snapshots_delete");
    db.prepare("DELETE FROM research.observation_snapshots WHERE id=?").run(source.id);
    assert.throws(() => getInvestigation(db, created.id), /not found|missing/);
    await assert.rejects(runInvestigation(db, created.id, { revision: 1 }), /not found|missing/);
    db.exec("DROP TRIGGER research.workflow_revisions_update");
    db.prepare("UPDATE research.workflow_revisions SET summary='{}'").run();
    assert.throws(() => listInvestigations(db), /checksum mismatch/);
  } finally {
    db.close();
  }
});

test("separate database connections reconcile the same optimistic execution without duplicate revisions", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-workflow-cas-"));
  const first = new DatabaseSync(path.join(directory, "cache.sqlite"));
  const second = new DatabaseSync(path.join(directory, "cache.sqlite"));
  try {
    const created = createInvestigation(first, protocol(snapshot(first).id));
    const [left, right] = await Promise.all([
      runInvestigation(first, created.id, { revision: 1 }),
      runInvestigation(second, created.id, { revision: 1 }),
    ]);
    assert.deepEqual(left, right);
    assert.equal(left.status, "completed");
    assert.equal(first.prepare("SELECT COUNT(*) n FROM research.workflow_revisions").get().n, 2);
  } finally {
    first.close();
    second.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("blocked designs preserve unknown dates and original sources without inventing resolved observations", async () => {
  const db = new DatabaseSync(":memory:");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-workflow-blocked-"));
  try {
    const source = snapshot(db);
    const plan = protocol(source.id, { family: "causal", from: null, to: null, knownAt: null });
    plan.nodes[0].mode = "latest-known";
    const created = createInvestigation(db, plan);
    const result = await runInvestigation(db, created.id, { revision: 1 });
    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(result.protocol.knownAt, null);
    const archive = exportInvestigation(db, created.id);
    assert.deepEqual(archive.record.evaluation.inputs.sources, {});
    assert.equal(archive.record.evaluation.originals[source.id].rawContent, source.rawContent);
    extractStoredZip(exportInvestigationArchive(db, created.id), directory);
    const replayed = JSON.parse(
      execFileSync(process.execPath, [path.join(directory, "replay.mjs")], { encoding: "utf8" }),
    );
    assert.equal(replayed.matches, true);
    assert.equal(replayed.executed, false);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("amendments preserve originals, isolate lineage identities, and reject stale or downgraded protocols", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const plan = protocol(snapshot(db).id);
    const parent = createInvestigation(db, plan);
    const revised = { ...plan, title: "Revised mean", question: "Discard original" };
    const args = { revision: 1, protocol: revised, amendment: "Rename this study" };
    const child = amendInvestigation(db, parent.id, args);
    assert.notEqual(child.id, parent.id);
    assert.equal(child.parentId, parent.id);
    assert.equal(child.parentRevision, 1);
    assert.equal(child.protocol.question, parent.protocol.question);
    assert.equal(child.result, null);
    assert.deepEqual(getInvestigation(db, parent.id), parent);
    assert.equal(amendInvestigation(db, parent.id, args).id, child.id);
    const root = createInvestigation(db, child.protocol);
    assert.notEqual(root.id, child.id);
    assert.equal(createInvestigation(db, child.protocol).id, root.id);
    assert.notEqual(amendInvestigation(db, root.id, args).id, child.id);
    assert.throws(
      () => amendInvestigation(db, parent.id, { ...args, protocol: { ...revised, family: "causal" } }),
      /claim family/,
    );
    await runInvestigation(db, parent.id, { revision: 1 });
    assert.throws(() => amendInvestigation(db, parent.id, args), /changed/);
    const run = await runInvestigation(db, child.id, { revision: 1 });
    assert.equal(run.parentId, parent.id);
    assert.equal(listInvestigations(db).items.find((x) => x.id === child.id).parentId, parent.id);
  } finally {
    db.close();
  }
});

test("in-app replay uses frozen evidence without creating revisions and rejects unfrozen studies", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const created = createInvestigation(db, protocol(snapshot(db).id));
    await assert.rejects(replayInvestigation(db, created.id), /Run and freeze/);
    const run = await runInvestigation(db, created.id, { revision: 1 });
    db.exec("DROP TRIGGER research.observation_snapshots_delete");
    db.prepare("DELETE FROM research.observation_snapshots").run();
    const replay = await replayInvestigation(db, created.id);
    assert.equal(replay.replay.matches, true);
    assert.deepEqual(replay.investigation, run);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM research.workflow_revisions").get().n, 2);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(replayInvestigation(db, created.id, { signal: controller.signal }), /cancelled/);
  } finally {
    db.close();
  }
});

test("in-app replay refuses a different archived engine without evaluating archived code", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const created = createInvestigation(db, protocol(snapshot(db).id));
    await runInvestigation(db, created.id, { revision: 1 });
    const row = db.prepare("SELECT body FROM research.workflow_revisions WHERE id=? AND revision=2").get(created.id);
    const record = JSON.parse(row.body);
    record.evaluation.engineFiles["workflow.mjs"] += "\n// Earlier archived engine version\n";
    record.evaluation.engineHash = hashOf(record.evaluation.engineFiles);
    const body = JSON.stringify(record);
    db.exec("DROP TRIGGER research.workflow_revisions_update");
    db.prepare("UPDATE research.workflow_revisions SET body=?,body_hash=? WHERE id=? AND revision=2").run(
      body,
      hashOf(body),
      created.id,
    );
    await assert.rejects(replayInvestigation(db, created.id), /installed engine differs/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM research.workflow_revisions").get().n, 2);
  } finally {
    db.close();
  }
});
