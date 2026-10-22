import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { auditSavedStudies } from "../server/domain/study-audit.mjs";
import { savedStudyAuditArgs } from "../server/ai/studyAuditPlanning.mjs";
import { studyAuditFixture as fixture } from "./fixtures/studyAuditFixture.mjs";
import { compareAuditStudies } from "../server/domain/study-audit-comparison.mjs";
import { studyAuditReport } from "../shared/studyAuditReport.mjs";
import { studyAuditClaims } from "../shared/studyAuditClaims.mjs";
import { buildQuestionDraft, exampleQuestionBrief } from "../src/research/questionDraft.ts";

function withDb(fn) {
  const db = new DatabaseSync(":memory:");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
test("named resolution selects exact tickers in requested order without an unrelated replacement", () =>
  withDb((db) => {
    const lmt = fixture(db, { name: "LMT evidence", symbols: ["LMT"] });
    const hii = fixture(db, { name: "HII evidence", symbols: ["HII"] });
    fixture(db, { name: "Unrelated winner", symbols: ["NVDA"], resultPatch: { stats: { total: 99 } } });
    db.exec("PRAGMA query_only=ON");
    const body = auditSavedStudies(db, { studyNames: ["LMT", "HII", "BA"] });
    assert.deepEqual(body.selectedIds, [lmt.experiment.id, hii.experiment.id]);
    assert.deepEqual(
      body.discovery.requestedNames.map((r) => r.status),
      ["matched", "matched", "unmatched"],
    );
    assert.deepEqual(body.discovery.unresolvedNames, ["BA"]);
    assert.equal(body.comparison.readiness.status, "not-directly-comparable");
    assert.ok(body.comparison.readiness.reasons.some((item) => /BA/.test(item.label)));
    assert.ok(!body.studies.some((study) => study.symbols.includes("NVDA")));
  }));
test("an ambiguous ticker requires IDs while an exact title and an exact ID preserve selection", () =>
  withDb((db) => {
    const one = fixture(db, { name: "First LMT window", symbols: ["LMT"] });
    const two = fixture(db, { name: "Second LMT window", symbols: ["LMT"], from: "2025-02-01" });
    const ambiguous = auditSavedStudies(db, { studyNames: ["LMT"] });
    assert.deepEqual(ambiguous.selectedIds, []);
    assert.equal(ambiguous.discovery.requestedNames[0].status, "ambiguous");
    assert.equal(ambiguous.discovery.requestedNames[0].candidateCount, 2);
    assert.equal(ambiguous.comparison.readiness.status, "not-directly-comparable");
    assert.deepEqual(auditSavedStudies(db, { studyNames: ["first lmt window"] }).selectedIds, [one.experiment.id]);
    assert.deepEqual(auditSavedStudies(db, { experimentIds: [two.experiment.id] }).selectedIds, [two.experiment.id]);
    for (const args of [
      { studyNames: [""] },
      { studyNames: ["LMT", "lmt"] },
      { studyNames: ["a".repeat(121)] },
      { studyNames: ["LMT\nHII"] },
      { studyNames: ["LMT"], experimentIds: [one.experiment.id] },
    ])
      assert.throws(() => auditSavedStudies(db, args));
  }));
test("no named match remains an explicit empty report with a selection gap, never a chartable substitute", () =>
  withDb((db) => {
    fixture(db, { name: "Unrelated", symbols: ["AAA"] });
    const body = auditSavedStudies(db, { studyNames: ["LMT", "HII"] });
    const evidence = [{ id: "t1", ok: true, tool: "research_audit_saved_studies", json: JSON.stringify(body) }];
    assert.deepEqual(body.studies, []);
    assert.equal(body.comparison.readiness.status, "not-directly-comparable");
    const report = studyAuditReport(evidence);
    assert.match(report, /LMT: unmatched/);
    assert.match(report, /HII: unmatched/);
    assert.match(report, /No unrelated studies were substituted/);
    assert.ok(
      studyAuditClaims("The records show a return advantage [t1].", evidence).some((flag) =>
        /selection/.test(flag.raw),
      ),
    );
    assert.equal(studyAuditClaims("LMT is unmatched and HII is unmatched in this inventory [t1].", evidence).length, 0);
  }));
test("study-name parser is contextual, respects punctuation and exact IDs take precedence", () => {
  for (const [question, expected] of [
    [
      "Compare my saved LMT and HII procurement studies. Use SPY as benchmark; export CSV in UTC with AI.",
      ["LMT", "HII"],
    ],
    ["Inspect my saved studies for LMT, HII. Explain SPY benchmark returns.", ["LMT", "HII"]],
    ['Review my saved "LMT January window" and “HII pilot” studies.', ["LMT January window", "HII pilot"]],
    ["Compare my saved AI CSV UTC studies; use SPY as a benchmark.", []],
    ["Inspect my saved studies. Compare SPY benchmark and CSV exports.", []],
    ["Compare my saved $LMT/$HII studies.", ["LMT", "HII"]],
    ["Inspect my saved BRK.B studies.", ["BRK.B"]],
    ["Compare my saved lmt and hii studies.", ["LMT", "HII"]],
    ["Compare my saved LMT studies with my saved HII studies.", ["LMT", "HII"]],
    ["Compare my saved Missing Window Name studies.", ["Missing Window Name"]],
  ])
    assert.deepEqual(savedStudyAuditArgs(question), expected.length ? { studyNames: expected } : {}, question);
  const experimentId = `exp_${"a".repeat(32)}`,
    datasetId = `ds_${"b".repeat(32)}`;
  assert.deepEqual(savedStudyAuditArgs(`Compare my saved LMT and HII studies ${experimentId} ${datasetId}`), {
    experimentIds: [experimentId],
  });
  assert.deepEqual(savedStudyAuditArgs(`Compare my saved LMT studies ${datasetId}`), { datasetIds: [datasetId] });
});
test("negated execution commands preserve inspection while a later explicit execution keeps precedence", () => {
  assert.deepEqual(savedStudyAuditArgs(buildQuestionDraft("inspect", exampleQuestionBrief("inspect"))), {
    studyNames: ["LMT", "HII"],
  });
  for (const question of [
    "Review my saved LMT studies, but do not run a new analysis.",
    "Inspect my saved LMT studies; don't execute a new backtest.",
    "Compare my saved LMT studies without performing a new analysis.",
    "Review my saved LMT studies; never perform a new study.",
    "Compare my saved LMT studies; do not run a backtest or replay them.",
  ])
    assert.deepEqual(savedStudyAuditArgs(question), { studyNames: ["LMT"] }, question);
  for (const question of [
    "Review my saved LMT studies; do not replay them and then run a new backtest.",
    "Review my saved LMT studies; do not run a replay; also execute a new analysis.",
    "Inspect my saved LMT studies and then perform a new analysis.",
  ])
    assert.equal(savedStudyAuditArgs(question), null, question);
});
test("readiness rejects unknown or mismatched designs and partial coverage without certifying matching records", () =>
  withDb((db) => {
    const a = fixture(db),
      b = fixture(db, { name: "B" });
    const body = auditSavedStudies(db, { experimentIds: [a.experiment.id, b.experiment.id] });
    assert.equal(body.comparison.readiness.status, "listed-fields-match-only");
    assert.match(body.comparison.readiness.summary, /descriptive comparison only/);
    assert.ok(body.comparison.readiness.missingEvidence.some((item) => /public-availability/.test(item.label)));
    assert.ok(body.comparison.readiness.missingEvidence.some((item) => /Replay/.test(item.label)));
    for (const change of [
      (s) => {
        s.parameters.benchmark = "QQQ";
      },
      (s) => {
        s.parameters.holdDays = null;
      },
      (s) => {
        s.window.resultFrom = null;
      },
      (s) => {
        s.coverage.partitionStatus = "partial";
      },
      (s) => {
        s.timing.mode = "unknown";
      },
      (s) => {
        s.stats.benchmarkTotal = null;
      },
    ]) {
      const studies = structuredClone(body.studies);
      change(studies[1]);
      assert.equal(compareAuditStudies(studies, null).readiness.status, "not-directly-comparable");
    }
  }));
