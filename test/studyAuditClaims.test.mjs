import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { studyAuditFixture } from "./fixtures/studyAuditFixture.mjs";
import { auditSavedStudies } from "../server/domain/study-audit.mjs";
import { studyAuditClaims } from "../shared/studyAuditClaims.mjs";
import { studyAuditReport } from "../shared/studyAuditReport.mjs";
import { groundingCheck } from "../shared/ask.mjs";
import { citationCheck } from "../shared/citations.mjs";

function savedEvidence() {
  const db = new DatabaseSync(":memory:");
  try {
    const first = studyAuditFixture(db, {
      name: "LMT procurement",
      symbols: ["LMT"],
      partial: true,
      cooldown: 30,
      from: "2025-01-09",
      resultPatch: {
        stats: { total: 0.0222, benchmarkTotal: 0.0963, excessTotal: -0.0742, from: "2025-01-09", to: "2025-06-02" },
      },
    });
    const second = studyAuditFixture(db, { name: "HII procurement", symbols: ["HII"] });
    const report = auditSavedStudies(db, { experimentIds: [first.experiment.id, second.experiment.id] });
    return [{ id: "t1", tool: "research_audit_saved_studies", ok: true, json: JSON.stringify(report) }];
  } finally {
    db.close();
  }
}
const question = "Compare saved LMT/HII studies: coverage, exclusions and publication timing.";
test("conservative fallback preserves high-count ledgers and passes all three verification checks", () => {
  const evidence = savedEvidence();
  const answer = studyAuditReport(evidence);
  assert.match(answer, /2804/);
  assert.match(answer, /2799/);
  assert.match(answer, /ambiguousIdentity: 44/);
  assert.match(answer, /cooldown: 2163/);
  assert.match(answer, /nonPositiveObligation: 589/);
  assert.match(answer, /cooldown: 130/);
  assert.match(answer, /nonPositiveObligation: 65/);
  assert.match(answer, /-7\.42 percentage points/);
  assert.deepEqual(groundingCheck(answer, evidence).unmatched, []);
  assert.deepEqual(groundingCheck(answer, evidence).mislabeled, []);
  assert.deepEqual(citationCheck(answer, evidence), { miscited: [], uncitedRows: [] });
  assert.deepEqual(studyAuditClaims(answer, evidence, question), []);
});
test("an unrelated uncertainty statement cannot hide positive verification overclaims", () => {
  const evidence = savedEvidence();
  for (const answer of [
    "Publication timing is not established and LMT has no look-ahead bias. [t1]",
    "LMT is partial and both datasets are complete. [t1]",
    "Ownership is wrong but arithmetic is verified. [t1]",
    "The unknown trade count cannot be verified, yet calculations were confirmed. [t1]",
    "Both collections are count-reconciled although timing is unverified. [t1]",
    "LMT collection\n| Measure | Status |\n|---|---|\n| Collection | complete [t1] |",
  ])
    assert.ok(studyAuditClaims(answer, evidence).length > 0, answer);
});
test("negative statements and source-correct rejections are not treated as positive claims", () => {
  const evidence = savedEvidence();
  for (const answer of [
    "We cannot establish no look-ahead bias. [t1]",
    "Absence of look-ahead bias is not established. [t1]",
    "Arithmetic was not independently verified. [t1]",
    "The claim of no look-ahead bias is unsupported. [t1]",
    "Both datasets are not complete. [t1]",
    "HII is count-reconciled within its scope and LMT is partial. [t1]",
    "The 45-day filing deadline is inapplicable to procurement. [t1]",
  ])
    assert.deepEqual(studyAuditClaims(answer, evidence), [], answer);
});
test("exclusion requests require available reason/count pairs rather than generic mention", () => {
  const evidence = savedEvidence();
  const generic =
    "Exclusions were reviewed, including cooldown and ambiguous identity. Publication timing is assumed. LMT is partial. [t1]";
  assert.ok(studyAuditClaims(generic, evidence, question).some((flag) => /589/.test(flag.note)));
  const complete = studyAuditReport(evidence);
  const missing = complete.replace("ambiguousIdentity: 44", "ambiguous identity was considered");
  assert.ok(studyAuditClaims(missing, evidence, question).some((flag) => /ambiguousIdentity = 44/.test(flag.note)));
  const swapped = complete
    .replace("nonPositiveObligation: 589", "NONPOS_FIRST")
    .replace("nonPositiveObligation: 65", "nonPositiveObligation: 589")
    .replace("NONPOS_FIRST", "nonPositiveObligation: 65");
  assert.ok(studyAuditClaims(swapped, evidence, question).some((flag) => /exclusion reason and count/.test(flag.note)));
});
test("publication assumptions must concern publication, not an unrelated modeling assumption", () => {
  const evidence = savedEvidence();
  const flags = studyAuditClaims("Equal weighting is assumed. [t1]", evidence, "Explain publication timing.");
  assert.ok(flags.some((flag) => /publication timing uses assumed/.test(flag.note)));
});
test("automatic inventory fallback discloses unmatched names without claiming a requested comparison", () => {
  const evidence = savedEvidence();
  const body = JSON.parse(evidence[0].json);
  body.selection = "latest-per-dataset";
  body.discovery = { scanLimit: 500, omittedCandidates: 3 };
  evidence[0].json = JSON.stringify(body);
  const answer = studyAuditReport(evidence);
  assert.match(answer, /selection did not verify the requested study names/);
  assert.match(answer, /cannot resolve a named-study comparison/);
  assert.deepEqual(groundingCheck(answer, evidence).unmatched, []);
  assert.deepEqual(citationCheck(answer, evidence), { miscited: [], uncitedRows: [] });
  assert.deepEqual(studyAuditClaims(answer, evidence, question), []);
});
