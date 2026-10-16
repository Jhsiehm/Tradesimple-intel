import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { zipEntries, zipEntryStream } from "../server/lib/zip.mjs";
import { hashOf, saveExperiment } from "../server/domain/research-store.mjs";
import { openDb } from "../server/lib/db.mjs";
import { dayOf } from "../shared/backtest.mjs";
import { DEFAULT_RULES } from "../shared/backtestSpec.mjs";
import { importDataset, datasetSource } from "../server/domain/research-events.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { pairedArchive, exportPair } from "../server/domain/paired-archive.mjs";
import { verifyPairedArchive, verifyPairedDirectory } from "../server/domain/paired-verifier.mjs";
import { savePairEvaluation, listPairEvaluations } from "../server/domain/pair-evaluations.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { saveNotebook } from "../server/domain/notebooks.mjs";
import { approveMemory, createMemorySnapshot } from "../server/domain/research-context.mjs";
import { prepareAskMemory } from "../server/ai/researchContext.mjs";
import { startAnalysis } from "../server/domain/research-analysis.mjs";
import { createPairProtocol } from "../server/domain/research-pairs.mjs";
import { executePair, getPairExecution } from "../server/ai/pairedResearch.mjs";
const env = {
  ASK_PROVIDER: "openai",
  OPENAI_API_KEY: "test-only",
  ASK_MODEL: "fixture",
  ASK_STRONG_MODEL: "fixture",
  ASK_MONTHLY_BUDGET_USD: "0",
};
function fixture({ db = new DatabaseSync(":memory:"), evidence = [] } = {}) {
  const notebook = saveNotebook(db, {
    title: "APPROVED_MEMORY",
    hypothesis: "test",
    conclusion: "APPROVED_MEMORY",
    decision: "Caveat",
    status: "rejected",
    tags: [],
    evidence,
    followups: [],
  });
  const approval = approveMemory(db, { notebookId: notebook.id, revision: 1, action: "approve", reason: "Reviewed" });
  const context = createMemorySnapshot(db, {
    mode: "context-aware",
    knownAt: new Date().toISOString(),
    approvalIds: [approval.id],
  });
  const memory = prepareAskMemory(db, { mode: "isolated" });
  const a = startAnalysis(db, { request: { question: "Source" }, memory, provider: "openai", model: "fixture" });
  a.append("tool_output", {
    name: "market_snapshot",
    args: {},
    result: { ok: true, source: "SYNTHETIC_EXTERNAL", rows: [{ value: 7 }] },
  });
  a.finish("completed");
  const p = createPairProtocol(db, {
    question: "Describe the evidence limitations",
    hypothesis: "Memory adds a caveat",
    evaluation: "Grounded caveat count",
    provider: "openai",
    model: "fixture",
    style: "professional",
    snapshotId: context.id,
    evidenceAnalysisId: a.id,
    evidenceSequences: [1],
  });
  return { db, notebook, p };
}
test("paired execution supplies identical external evidence, isolates memory, records both arms and never reruns an existing pair", async () => {
  const { db, p } = fixture();
  try {
    const inputs = [];
    const makeProvider = (cfg) => ({
      name: "openai",
      model: cfg.model,
      async *chat(messages, tools, options) {
        inputs.push(structuredClone(messages));
        assert.deepEqual(tools, []);
        assert.equal(options.noTools, true);
        assert.equal(options.maxTokens, 1400);
        yield {
          type: "text",
          delta: JSON.parse(messages[1].content).approvedFindings.length
            ? "Memory caveat [M1], evidence [E1]."
            : "Evidence [E1].",
        };
        yield { type: "usage", input: 20, output: 10 };
      },
    });
    const out = await executePair(db, p.id, { env, makeProvider, chooseOrder: () => 0 });
    assert.equal(out.status, "completed");
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0][0].content, inputs[1][0].content);
    const [isolated, aware] = inputs.map((m) => JSON.parse(m[1].content));
    assert.deepEqual(isolated.externalEvidence, aware.externalEvidence);
    assert.deepEqual(isolated.approvedFindings, []);
    assert.ok(JSON.stringify(aware.approvedFindings).includes("APPROVED_MEMORY"));
    assert.ok(!JSON.stringify(inputs[0]).includes("APPROVED_MEMORY"));
    assert.equal(out.result.evaluation.status, "pending");
    assert.deepEqual(out.result.arms["context-aware"].unknownReferences, []);
    assert.equal(out.arms.isolated.status, "completed");
    assert.equal(out.arms["context-aware"].status, "completed");
    assert.ok(!JSON.stringify(out).includes("test-only"));
    assert.deepEqual(await executePair(db, p.id, { env, makeProvider }), out);
    assert.equal(inputs.length, 2);
  } finally {
    db.close();
  }
});
test("paired executor blocks invented tools, retains partial failure and rejects wrong configuration before any execution", async () => {
  const { db, p } = fixture();
  try {
    await assert.rejects(
      () => executePair(db, p.id, { env: { ...env, ASK_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fixture" } }),
      /pinned/,
    );
    assert.equal(getPairExecution(db, p.id), null);
    let calls = 0;
    const out = await executePair(db, p.id, {
      env,
      chooseOrder: () => 1,
      makeProvider: (cfg) => ({
        name: "openai",
        model: cfg.model,
        async *chat() {
          if (calls++ === 0) yield { type: "tool_call", name: "web_search", args: { query: "live" } };
          else yield { type: "text", delta: "External [E1], invalid [M1]." };
        },
      }),
    });
    assert.equal(out.status, "incomplete");
    assert.match(out.result.arms["context-aware"].error, /No tool was executed/);
    assert.equal(out.result.arms.isolated.status, "completed");
    assert.deepEqual(out.result.arms.isolated.unknownReferences, ["M1"]);
    assert.equal(calls, 2);
  } finally {
    db.close();
  }
});
test("approval is rechecked between arms and no memory is sent after revocation", async () => {
  const { db, p, notebook } = fixture();
  try {
    let calls = 0;
    const out = await executePair(db, p.id, {
      env,
      chooseOrder: () => 0,
      makeProvider: (cfg) => ({
        name: "openai",
        model: cfg.model,
        async *chat() {
          calls++;
          yield { type: "text", delta: "Evidence [E1]." };
          approveMemory(db, { notebookId: notebook.id, revision: 1, action: "revoke", reason: "Review" });
        },
      }),
    });
    assert.equal(calls, 1);
    assert.equal(out.status, "incomplete");
    assert.match(out.result.arms["context-aware"].error, /revoked/);
  } finally {
    db.close();
  }
});
test("cancelled and truncated arms remain incomplete instead of being reported as successful", async () => {
  for (const scenario of ["cancel", "truncated"]) {
    const { db, p } = fixture();
    try {
      const controller = new AbortController();
      let calls = 0;
      const out = await executePair(db, p.id, {
        env,
        signal: controller.signal,
        chooseOrder: () => 0,
        makeProvider: (cfg) => ({
          name: "openai",
          model: cfg.model,
          async *chat() {
            calls++;
            yield { type: "text", delta: "Partial" };
            if (scenario === "cancel") controller.abort();
            else yield { type: "end", reason: "length" };
          },
        }),
      });
      assert.equal(out.status, "incomplete");
      assert.notEqual(out.arms.isolated.status, "completed");
      if (scenario === "cancel") {
        assert.equal(calls, 1);
        assert.equal(out.arms["context-aware"].status, "aborted");
      } else assert.match(out.result.arms.isolated.error, /truncated/);
    } finally {
      db.close();
    }
  }
});
test("paired evaluations pin results, validate excerpts and preserve revisions with conflict checks", async () => {
  const { db, p, notebook } = fixture();
  try {
    const assessment = {
      criteriaAssessment: "Cites supplied evidence but adds no supported distinction",
      strengths: "Names the evidence",
      limitations: "No independently verified claim support",
    };
    const review = {
      baseRevision: 0,
      verdict: "inconclusive",
      rationale: "Insufficient distinction",
      reviewReason: "First review",
      assessments: { isolated: assessment, "context-aware": assessment },
      excerpts: [{ arm: "isolated", quote: "Evidence [E1].", comment: "Names the frozen reference" }],
    };
    assert.throws(() => savePairEvaluation(db, p.id, review), /Both arms/);
    await executePair(db, p.id, {
      env,
      makeProvider: (cfg) => ({
        name: "openai",
        model: cfg.model,
        async *chat() {
          yield { type: "text", delta: "Evidence [E1]." };
        },
      }),
    });
    for (const patch of [
      { verdict: "winner" },
      { rationale: "" },
      { reviewReason: "" },
      { assessments: {} },
      { excerpts: [{ arm: "isolated", quote: "Invented passage", comment: "Not in answer" }] },
    ])
      assert.throws(() => savePairEvaluation(db, p.id, { ...review, ...patch }));
    const first = savePairEvaluation(db, p.id, { ...review, actor: "someone-else", createdAt: "2000-01-01T00:00:00Z" });
    assert.equal(first.actor, "local-owner");
    assert.notEqual(first.createdAt, "2000-01-01T00:00:00Z");
    assert.equal(first.criteria, p.evaluation);
    assert.equal(first.excerpts[0].analysisId, getPairExecution(db, p.id).execution.arms.isolated);
    assert.throws(() => savePairEvaluation(db, p.id, review), /changed elsewhere/);
    // Historical review remains possible after permission to reuse memory is revoked.
    approveMemory(db, { notebookId: notebook.id, revision: 1, action: "revoke", reason: "No further model use" });
    const second = savePairEvaluation(db, p.id, {
      ...review,
      baseRevision: 1,
      verdict: "tie",
      reviewReason: "Reviewed both exact answers again",
    });
    assert.equal(second.revision, 2);
    assert.equal(second.previousId, first.id);
    assert.equal(second.resultHash, first.resultHash);
    assert.deepEqual(listPairEvaluations(db, p.id), [second, first]);
    assert.throws(() => db.exec("DELETE FROM research.pair_evaluations"), /immutable/);
    assert.throws(() => db.prepare("UPDATE research.pair_evaluations SET body=?").run("{}"), /immutable/);
  } finally {
    db.close();
  }
});
test("paired export verifies offline after database close and detects inconsistent answers and evidence", async () => {
  const { db, p } = fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paired-archive-"));
  let closed = false;
  try {
    assert.equal(verifyPairedArchive(pairedArchive(db, p.id)).status, "not-executed");
    await executePair(db, p.id, {
      env,
      makeProvider: (cfg) => ({
        name: "openai",
        model: cfg.model,
        async *chat() {
          yield { type: "text", delta: "Evidence [E1]." };
        },
      }),
    });
    const assessment = {
      criteriaAssessment: "Equivalent answers",
      strengths: "Reference included",
      limitations: "Synthetic only",
    };
    savePairEvaluation(db, p.id, {
      baseRevision: 0,
      verdict: "tie",
      rationale: "Same supplied evidence",
      reviewReason: "Fixture",
      assessments: { isolated: assessment, "context-aware": assessment },
      excerpts: [{ arm: "isolated", quote: "Evidence [E1].", comment: "Exact answer excerpt" }],
    });
    const bundle = pairedArchive(db, p.id);
    fs.writeFileSync(path.join(dir, "pair.zip"), exportPair(db, p.id));
    db.close();
    closed = true;
    assert.equal(verifyPairedArchive(bundle).reviews, 1);
    for (const entry of zipEntries(path.join(dir, "pair.zip"))) {
      assert.ok(!entry.name.includes(".."));
      fs.mkdirSync(path.dirname(path.join(dir, entry.name)), { recursive: true });
      const parts = [];
      for await (const part of zipEntryStream(path.join(dir, "pair.zip"), entry)) parts.push(part);
      fs.writeFileSync(path.join(dir, entry.name), Buffer.concat(parts));
    }
    const proof = JSON.parse(
      execFileSync(process.execPath, [path.join(dir, "verify.mjs")], { cwd: dir, encoding: "utf8" }),
    );
    assert.equal(proof.ok, true);
    assert.equal(proof.protocolId, p.id);
    for (const mutate of [
      (b) => {
        b.payload.execution.result.arms.isolated.answer = "Changed answer";
      },
      (b) => {
        b.payload.protocol.conditions.evidence[0].result.rows[0].value = 999;
      },
      (b) => {
        b.payload.execution.arms.isolated.events.splice(1, 1);
      },
      (b) => {
        b.payload.reviews[0].excerpts[0].quote = "Not in answer";
      },
    ]) {
      const broken = structuredClone(bundle);
      mutate(broken);
      broken.payloadHash = hashOf(broken.payload);
      assert.throws(() => verifyPairedArchive(broken));
    }
    bundle.payloadHash = "corrupt";
    fs.writeFileSync(path.join(dir, "pair.json"), JSON.stringify(bundle));
    assert.throws(() => execFileSync(process.execPath, [path.join(dir, "verify.mjs")], { cwd: dir, stdio: "pipe" }));
  } finally {
    if (!closed) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paired exports include the frozen historical notebook and replay its underlying evidence offline", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paired-evidence-"));
  const old = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ":memory:";
  let db;
  try {
    db = openDb(path.resolve("."));
  } finally {
    if (old === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = old;
  }
  try {
    const dataset = importDataset(db, {
      name: "Pair source",
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
    const experiment = saveExperiment(db, { runId: run.runId, title: "Pinned pair calculation" });
    const { p, notebook } = fixture({ db, evidence: [{ kind: "experiment", id: experiment.id }] });
    // A later notebook edit must not replace the approved revision used by the pair.
    saveNotebook(db, { ...notebook, baseRevision: 1, conclusion: "LATER_UNAPPROVED_EDIT" }, notebook.id);
    fs.writeFileSync(path.join(dir, "pair.zip"), exportPair(db, p.id));
    db.close();
    db = null;
    execFileSync("unzip", ["-q", "pair.zip"], { cwd: dir });
    const proof = verifyPairedDirectory(dir);
    assert.equal(proof.status, "not-executed");
    assert.equal(proof.notebooks.length, 1);
    assert.equal(proof.notebooks[0].revision, 1);
    assert.equal(proof.notebooks[0].results[0].matches, true);
    const folder = `notebooks/${notebook.id}-r1`,
      noteFile = path.join(dir, folder, "notebook.json");
    const note = JSON.parse(fs.readFileSync(noteFile, "utf8"));
    assert.equal(note.notebook.conclusion, "APPROVED_MEMORY");
    const evidence = JSON.parse(fs.readFileSync(path.join(dir, folder, "runs", run.runId, "evidence.json"), "utf8"));
    assert.equal(evidence.datasets[dataset.id].rawContent, dataset.rawContent);
    const output = JSON.parse(execFileSync(process.execPath, [path.join(dir, "verify.mjs")], { encoding: "utf8" }));
    assert.equal(output.notebooks[0].uniqueRuns, 1);
    const manifestPath = path.join(dir, "checksums.json"),
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const missing = structuredClone(manifest);
    delete missing[`${folder}/notebook.json`];
    fs.writeFileSync(manifestPath, JSON.stringify(missing));
    assert.throws(() => verifyPairedDirectory(dir), /Missing paired notebook/);
    note.notebook.conclusion = "FORGED";
    note.notebookHash = hashOf(note.notebook);
    const encoded = JSON.stringify(note);
    fs.writeFileSync(noteFile, encoded);
    manifest[`${folder}/notebook.json`] = hashOf(encoded);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => verifyPairedDirectory(dir), /differs from frozen memory/);
    manifest["../outside"] = "bad";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => verifyPairedDirectory(dir), /Unsafe paired archive path/);
  } finally {
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
