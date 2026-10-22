import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { auditSavedStudies } from "../server/domain/study-audit.mjs";
import { studyAuditFixture } from "./fixtures/studyAuditFixture.mjs";
import { researchFigures, cleanResearchFigures } from "../shared/researchFigures.mjs";

function figures() {
  const db = new DatabaseSync(":memory:");
  try {
    const a = studyAuditFixture(db, { name: "LMT partial", symbols: ["LMT"], partial: true, cooldown: 30 });
    const b = studyAuditFixture(db, { name: "HII recorded", symbols: ["HII"] });
    const body = auditSavedStudies(db, { experimentIds: [a.experiment.id, b.experiment.id] });
    return {
      ids: [a.experiment.id, b.experiment.id],
      figures: researchFigures([
        { id: "t1", tool: "research_audit_saved_studies", ok: true, json: JSON.stringify(body) },
      ]),
    };
  } finally {
    db.close();
  }
}
test("audit figures shorten labels, retain exact IDs and carry deterministic source-linked review metadata", () => {
  const { ids, figures: result } = figures();
  assert.equal(result.length, 4);
  const first = result[0];
  assert.deepEqual(
    first.series[0].points.map((p) => p.label),
    ["LMT", "HII"],
  );
  assert.deepEqual(
    first.series[1].points.map((p) => p.x),
    ["LMT", "HII"],
  );
  assert.equal(first.series[0].points[0].y, 0.0829);
  for (const figure of result) {
    assert.equal(figure.review.status, "not-directly-comparable");
    assert.deepEqual(
      figure.review.studies.map((s) => s.id),
      ids,
    );
    assert.match(figure.review.studies[0].coverage, /partial/);
    assert.match(figure.review.studies[0].timing, /assumed/);
    assert.match(figure.review.studies[0].rules, /cooldown 30d/);
    assert.ok(figure.review.reasons.length > 0);
    assert.ok(figure.review.missingEvidence.some((item) => /public-availability/.test(item.label)));
    assert.ok(
      figure.series.every((series) => series.points.every((point) => ids.some((id) => point.detail.includes(id)))),
    );
    assert.ok(
      [...figure.review.studies, ...figure.review.reasons, ...figure.review.missingEvidence].every(
        (row) => row.ref === "t1" && row.path.startsWith("/"),
      ),
    );
  }
  assert.deepEqual(cleanResearchFigures(JSON.parse(JSON.stringify(result))), result);
});
test("optional metadata remains backward compatible and every saved field has explicit bounds", () => {
  const {
      figures: [figure],
    } = figures(),
    huge = "text".repeat(1000);
  const old = structuredClone(figure);
  delete old.review;
  assert.equal(cleanResearchFigures([old])[0].review, undefined);
  const row = figure.review.studies[0],
    item = figure.review.reasons[0];
  const raw = {
    ...figure,
    review: {
      ...figure.review,
      summary: huge,
      extra: "discard",
      studies: Array.from({ length: 20 }, () => ({ ...row, label: huge, coverage: huge, id: huge, extra: "discard" })),
      reasons: Array.from({ length: 100 }, () => ({ ...item, label: huge, extra: "discard" })),
      missingEvidence: Array.from({ length: 100 }, () => ({ ...item, label: huge })),
    },
  };
  const clean = cleanResearchFigures([raw])[0].review;
  assert.equal(clean.summary.length, 240);
  assert.equal(clean.studies.length, 4);
  assert.equal(clean.studies[0].id.length, 240);
  assert.equal(clean.studies[0].label.length, 240);
  assert.equal(clean.reasons.length, 8);
  assert.equal(clean.missingEvidence.length, 8);
  assert.equal(clean.reasons[0].label.length, 240);
  assert.equal(clean.extra, undefined);
  assert.equal(clean.studies[0].extra, undefined);
  assert.equal(clean.reasons[0].extra, undefined);
  assert.equal(
    cleanResearchFigures([{ ...raw, review: { ...raw.review, status: "scientifically-validated" } }])[0].review,
    undefined,
  );
});
test("review provenance rejects oversized, unrelated refs and invalid source paths without changing chart data", () => {
  const {
    figures: [figure],
  } = figures();
  for (const bad of [
    { ref: "t999" },
    { ref: "t" + "9".repeat(50000) },
    { path: "javascript:run()" },
    { path: "/" + "x".repeat(1024) },
    { path: "/studies/0\n" },
  ]) {
    const raw = {
      ...figure,
      review: {
        ...figure.review,
        studies: [{ ...figure.review.studies[0], ...bad }],
        reasons: [{ ...figure.review.reasons[0], ...bad }],
        missingEvidence: [],
      },
    };
    const [clean] = cleanResearchFigures([raw]);
    assert.equal(clean.review.studies.length, 0);
    assert.equal(clean.review.reasons.length, 0);
    assert.deepEqual(clean.series, figure.series);
  }
});
