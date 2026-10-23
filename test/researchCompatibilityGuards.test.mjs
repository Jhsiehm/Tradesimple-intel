import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../server/lib/db.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { getRun, saveExperiment } from "../server/domain/research-store.mjs";
import { studyFacts } from "../server/domain/study-audit-facts.mjs";
import { auditSavedStudies } from "../server/domain/study-audit.mjs";
import { studyAuditFixture } from "./fixtures/studyAuditFixture.mjs";
import { studyAuditClaims } from "../shared/studyAuditClaims.mjs";
import { scopeCheck } from "../shared/claimScope.mjs";
import { dayOf } from "../shared/backtest.mjs";
import { checkAnswerEvidence, guardedStudyReport } from "../server/ai/answerChecks.mjs";
import { trimForModel } from "../shared/ask.mjs";

const evidenceOf = (body, id = "t1") => ({
  id,
  tool: "research_audit_saved_studies",
  ok: true,
  json: JSON.stringify(body),
});
function database() {
  const previous = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ":memory:";
  try {
    return openDb(decodeURIComponent(new URL("..", import.meta.url).pathname));
  } finally {
    if (previous === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = previous;
  }
}
function mixedEvidence() {
  const db = new DatabaseSync(":memory:");
  try {
    const first = studyAuditFixture(db, {
      name: "LMT procurement",
      symbols: ["LMT"],
      resultPatch: {
        reality: {
          inference: { status: "withheld", basis: "entry-week", blocks: 2, reasons: ["Overlapping holdings."] },
        },
      },
    });
    const second = studyAuditFixture(db, {
      name: "HII procurement",
      symbols: ["HII"],
      resultPatch: {
        reality: { inference: { status: "exploratory", basis: "entry-week", blocks: 12, reasons: [] } },
      },
    });
    return [evidenceOf(auditSavedStudies(db, { experimentIds: [first.experiment.id, second.experiment.id] }))];
  } finally {
    db.close();
  }
}

test("saved inspection retains hardened run receipts and routes withheld claims to the conservative report without changing archives", async () => {
  const db = database();
  try {
    const series = Array.from({ length: 60 }, (_, i) => [dayOf("2025-01-01") + i, 100 + i, 101 + i]);
    const out = await runSpec(
      db,
      {
        source: "form4",
        filters: { from: "2025-01-01", to: "2025-02-01", tickers: ["AAPL"] },
        rules: { holdDays: 10 },
      },
      {
        sourceFn: async () => ({
          signals: [{ id: "one", symbol: "AAPL", side: "buy", signalDate: "2025-01-06", tradeDate: "2025-01-02" }],
          records: [],
          context: {},
          coverage: {},
          feeds: [],
        }),
        loadBarsFn: async () => ({
          bars: { AAPL: series, SPY: series },
          pending: [],
          missing: [],
          stale: [],
          cached: 2,
          fetched: 0,
        }),
      },
    );
    const experiment = saveExperiment(db, { runId: out.runId, title: "Hardened AAPL" });
    const frozen = JSON.stringify(getRun(db, out.runId));
    const changes = db.prepare("SELECT total_changes() AS n").get().n;
    db.exec("PRAGMA query_only=ON");
    const report = auditSavedStudies(db, { experimentIds: [experiment.id] });
    const study = report.studies[0];
    assert.deepEqual(study.inference.reasons, out.reality.inference.reasons);
    assert.equal(study.inference.status, "withheld");
    assert.equal(study.stats.excessT, out.stats.excessT);
    assert.equal(study.dataValidity.claimScope, out.dataValidity.claimScope);
    assert.equal(study.dataValidity.strictHistoricalTradability.eligible, false);
    assert.equal(study.dataValidity.priceCoverage.loaded, 2);
    assert.equal(study.dataValidity.priceCoverage.series, undefined);
    assert.equal(study.executionAssessment.executablePortfolio, false);
    assert.equal(study.trial.id, out.trial.id);
    assert.equal(study.trial.priorOverlappingAttempts, out.trial.priorOverlappingAttempts);
    assert.match(study.inference.origin, new RegExp(out.runId));
    assert.equal(JSON.stringify(getRun(db, out.runId)), frozen);
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n, changes);
    const evidence = [evidenceOf(report)];
    const four = trimForModel(
      { ...report, studies: Array.from({ length: 4 }, () => study) },
      { resultItems: 10, resultChars: 24_000 },
    );
    assert.equal(four.studies.length, 4);
    assert.ok(
      four.studies.every((saved) => saved.inference.status === "withheld" && saved.stats.excessT === out.stats.excessT),
      "all four inference statuses and diagnostic values survive the model context budget",
    );
    const check = (answer) => checkAnswerEvidence(answer, evidence);
    assert.ok(
      check("The saved result is statistically significant [t1].").grounding.scope.some((flag) =>
        /withheld/.test(flag.note),
      ),
    );
    const fallback = guardedStudyReport("The saved result proves an edge [t1].", evidence, check);
    assert.match(fallback, /recorded evidence and its limits/);
    assert.deepEqual(studyAuditClaims(fallback, evidence), []);
  } finally {
    db.close();
  }
});

test("legacy metadata remains unknown while archived diagnostics and certification limits are preserved", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const saved = studyAuditFixture(db, { resultPatch: { stats: { total: 0.2, excessT: 9 } } });
    const report = auditSavedStudies(db, { experimentIds: [saved.experiment.id] });
    const study = report.studies[0],
      evidence = [evidenceOf(report)];
    for (const field of ["inference", "dataValidity", "executionAssessment", "trial"]) assert.equal(study[field], null);
    assert.equal(study.stats.excessT, 9);
    assert.deepEqual(studyAuditClaims("The recorded t statistic is 9 [t1].", evidence), []);
    assert.ok(studyAuditClaims("This is a verified predictive strategy [t1].", evidence).length);
    assert.ok(studyAuditClaims("This is an executable portfolio [t1].", evidence).length);
    assert.ok(
      !studyAuditClaims("The result is statistically significant [t1].", evidence).some((flag) =>
        /withheld/.test(flag.note),
      ),
      "missing legacy metadata must not be invented as withheld",
    );
  } finally {
    db.close();
  }
});

test("withheld significance checks follow study names, headings, identifiers and collective claims", () => {
  const evidence = mixedEvidence();
  const studies = JSON.parse(evidence[0].json).studies;
  for (const answer of [
    "LMT is statistically significant [t1].",
    "LMT\nThe result is statistically significant [t1].",
    `${studies[0].id} establishes an edge [t1].`,
    `${studies[0].datasetId} proves alpha [t1].`,
    "Both LMT and HII are statistically significant [t1].",
    "All studies are statistically significant [t1].",
    "HII has recorded returns, but LMT is statistically significant [t1].",
  ])
    assert.ok(
      studyAuditClaims(answer, evidence).some((flag) => /withheld/.test(flag.note)),
      answer,
    );
  for (const answer of [
    "HII is statistically significant [t1].",
    "LMT has withheld inference, and HII is statistically significant [t1].",
    "HII\nThe result is statistically significant [t1].",
  ])
    assert.deepEqual(studyAuditClaims(answer, evidence), [], answer);
});

test("saved certification and significance guards respect local negations without suppressing another positive clause", () => {
  const evidence = mixedEvidence();
  for (const answer of [
    "LMT is not statistically significant [t1].",
    "LMT does not establish an edge [t1].",
    "LMT is not a verified predictive strategy [t1].",
    "LMT is not an executable portfolio [t1].",
    "The claim that LMT is statistically significant is unsupported [t1].",
    "LMT's executable portfolio is not independently verified [t1].",
    "LMT has no evidence of an edge; an executable portfolio is not established [t1].",
    "LMT is without evidence of a verified trading edge [t1].",
  ])
    assert.deepEqual(studyAuditClaims(answer, evidence), [], answer);
  for (const answer of [
    "LMT has no verified timing, but it is statistically significant [t1].",
    "LMT is not complete, yet it is a verified executable portfolio [t1].",
    "LMT is not statistically significant, and it is execution-ready [t1].",
    "LMT is not execution-ready, but it establishes an edge [t1].",
  ])
    assert.ok(studyAuditClaims(answer, evidence).length, answer);
  assert.ok(
    scopeCheck("This is a verified executable portfolio [t1].", [
      { id: "t1", tool: "run_backtest", ok: true, json: "{}" },
    ]).length,
    "fresh calculations use the same certification vocabulary",
  );
});

test("a citation to a different eligible audit cannot trigger another study's withheld status", () => {
  const body = JSON.parse(mixedEvidence()[0].json);
  const evidence = [
    evidenceOf({ ok: true, studies: [body.studies[0]] }),
    evidenceOf({ ok: true, studies: [body.studies[1]] }, "t2"),
  ];
  assert.deepEqual(studyAuditClaims("HII is statistically significant [t2].", evidence), []);
  assert.ok(
    studyAuditClaims("LMT is statistically significant [t1].", evidence).some((flag) => /withheld/.test(flag.note)),
  );
});

test("receipt projections are bounded and preserve recorded booleans without treating them as certification", () => {
  const reasons = Array.from({ length: 50 }, (_, i) => `Reason ${i}`);
  const run = {
    id: "run_frozen",
    result: {
      stats: { excessT: 7.25 },
      reality: { inference: { status: "withheld", basis: "entry-week", blocks: 2, reasons } },
      executionAssessment: {
        executablePortfolio: true,
        liveTradingValidated: false,
        gates: reasons.map((id) => ({ id, status: "unverified", detail: "x".repeat(10000) })),
      },
    },
    provenance: {
      dataValidity: {
        claimScope: "exploratory-only",
        strictHistoricalTradability: { eligible: false, status: "not-established", blockers: reasons },
        sourceCoverage: { gaps: reasons.map((code) => ({ code, count: 4 })) },
      },
      trial: { id: "trial_frozen", priorOverlappingAttempts: 0, priorOverlappingVariants: 12 },
    },
  };
  const frozen = JSON.stringify(run);
  const study = studyFacts({ experiment: { id: "exp_frozen" }, run, dataset: null });
  assert.equal(study.inference.reasons.length, 8);
  assert.equal(study.inference.omittedReasons, 42);
  assert.equal(study.dataValidity.strictHistoricalTradability.omittedBlockers, 42);
  assert.equal(study.dataValidity.sourceCoverage.omittedGaps, 42);
  assert.equal(study.executionAssessment.gates.length, 8);
  assert.equal(study.executionAssessment.omittedGates, 42);
  assert.equal(study.executionAssessment.executablePortfolio, true);
  assert.equal(study.executionAssessment.liveTradingValidated, false);
  assert.equal(study.trial.priorOverlappingAttempts, 0);
  assert.equal(study.trial.priorOverlappingVariants, 12);
  assert.match(study.dataValidity.origin, /provenance\/dataValidity$/);
  assert.match(study.trial.origin, /provenance\/trial$/);
  assert.equal(JSON.stringify(run), frozen);
  assert.ok(JSON.stringify(study).length < 8000);
  assert.ok(
    studyAuditClaims("This is an executable portfolio [t1].", [evidenceOf({ ok: true, studies: [study] })]).length,
  );
});
