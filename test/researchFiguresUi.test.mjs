import test from "node:test";
import assert from "node:assert/strict";
import {
  categoricalRows,
  displayUnit,
  figureCsv,
  figureGroups,
  figureRows,
  formatValue,
  isFigureDate,
  reviewStatus,
} from "../src/ask/figures/model.ts";

const figure = {
  id: "fixture",
  title: "Recorded excess",
  kind: "bar",
  xLabel: "Company",
  yLabel: "Excess",
  unit: "difference of return fractions",
  format: "percentage-points",
  totalPoints: 3,
  notes: ["Saved evidence only; timing is assumed."],
  sourceRefs: ["t1"],
  series: [
    {
      id: "excess",
      label: "Excess",
      points: [
        { label: "LMT", x: "LMT", y: -0.0742, ref: "t1", path: "/studies/0/stats/excessTotal" },
        {
          label: '=HYPERLINK("https://example.com")',
          x: "@source",
          y: 0.0138,
          ref: "t1",
          path: "/studies/1/stats/excessTotal",
          detail: "first line\nsecond line",
        },
        { label: "Missing", x: "Missing", y: null, ref: "t1", path: "/studies/2/stats/excessTotal" },
      ],
    },
  ],
};

test("figure presentation preserves raw fractions and separates percent, points and numbers", () => {
  assert.equal(formatValue(0.0138, figure), "1.38 pp");
  assert.equal(formatValue(-0.0742, figure), "-7.42 pp");
  assert.equal(formatValue(0.0138, { ...figure, format: "percent" }), "1.38%");
  assert.equal(formatValue(0.0138, { ...figure, format: "number" }), "0.0138");
  assert.equal(formatValue(null, figure), "Missing");
  assert.equal(displayUnit(figure), "percentage points");
  assert.equal(displayUnit({ ...figure, format: "percent" }), "%");
  assert.equal(displayUnit({ ...figure, format: "number", unit: "USD million" }), "USD million");
});

test("displayed CSV keeps provenance, missingness and numeric signs while neutralizing text formulas", () => {
  const csv = figureCsv(figure, figureRows(figure));
  assert.ok(csv.includes('"-0.0742"'));
  assert.ok(csv.includes('"\'-7.42 pp"'));
  assert.ok(csv.includes("\"'=HYPERLINK"));
  assert.ok(csv.includes('"\'@source"'));
  assert.ok(csv.includes('"","Missing"'));
  assert.ok(csv.includes("/studies/0/stats/excessTotal"));
  assert.ok(csv.includes('"t1"'));
  assert.ok(csv.includes("Saved evidence only; timing is assumed."));
  assert.ok(csv.includes("not the full underlying dataset"));
  assert.ok(csv.includes('"first line\nsecond line"'));
});

test("time axes accept real dates and refuse calendar normalization or invalid timestamps", () => {
  for (const value of ["2024-02-29", "2025-02-28", "2025-02-28T09:30:00Z", "2025-02-28T09:30:00.123Z"])
    assert.equal(isFigureDate(value), true, value);
  for (const value of [
    "2025-02-29",
    "2025-02-30",
    "2025-13-01",
    "2025-02-28T24:00:00Z",
    "March 2 2025",
    1740873600000,
    null,
  ])
    assert.equal(isFigureDate(value), false, String(value));
});

test("category comparisons put each study's series together while preserving distinct observations", () => {
  const sample = {
    ...figure,
    series: [
      { id: "portfolio", label: "Portfolio", points: figure.series[0].points },
      { id: "benchmark", label: "Benchmark", points: figure.series[0].points.map((point) => ({ ...point, y: null })) },
    ],
  };
  const original = figureRows(sample);
  const grouped = categoricalRows(original);
  assert.deepEqual(
    grouped.map((row) => row.key),
    ["0:0", "1:0", "0:1", "1:1", "0:2", "1:2"],
  );
  assert.equal(new Set(grouped.map((row) => row.key)).size, original.length);
  assert.equal(grouped[0].point.y, -0.0742);
  assert.equal(grouped[1].point.y, null);
  assert.deepEqual(
    original.map((row) => row.key),
    ["0:0", "0:1", "0:2", "1:0", "1:1", "1:2"],
  );
});

test("CSV carries recorded comparison limits and exact study provenance alongside displayed values", () => {
  const reviewed = {
    ...figure,
    review: {
      status: "not-directly-comparable",
      summary: "Different windows and incomplete collection prevent a direct ranking.",
      studies: [
        {
          id: "exp_full_study_identifier",
          label: "LMT",
          coverage: "Partial: 0 of 1 collection requests complete",
          timing: "Publication dates assumed; historical public availability unverified",
          window: "2025-01-09 to 2025-06-02",
          rules: "30 day cooldown",
          ref: "t1",
          path: "/studies/0",
        },
      ],
      reasons: [{ label: "Recorded windows differ", ref: "t1", path: "/studies/0/window" }],
      missingEvidence: [{ label: "No news timestamps", ref: "t1", path: "/studies/0/caveats" }],
    },
  };
  const csv = figureCsv(reviewed, figureRows(reviewed));
  for (const value of [
    "Not directly comparable",
    "exp_full_study_identifier",
    "0 of 1",
    "public availability unverified",
    "30 day cooldown",
    "/studies/0/window",
    "No news timestamps",
    '"-0.0742"',
  ])
    assert.ok(csv.includes(value), value);
  assert.equal(reviewStatus("listed-fields-match-only"), "Listed fields match only");
  assert.equal(reviewStatus("single-study"), "Single saved study");
  assert.equal(reviewStatus("unrecognized"), "Comparison status unavailable");
});

test("mixed saved audits retain their own comparison review when selected alone or shown together", () => {
  const auditFigure = (id, ref) => ({
    ...figure,
    id,
    sourceRefs: [ref],
    review: {
      status: "single-study",
      summary: "A recorded review of one study.",
      studies: [
        {
          id: "exp_same_id",
          label: "LMT",
          coverage: "Partial",
          timing: "Assumed",
          window: "2025",
          rules: "Recorded",
          ref,
          path: "/studies/0",
        },
      ],
      reasons: [],
      missingEvidence: [{ label: "News timing unavailable", ref, path: "/studies/0/timing" }],
    },
  });
  const newest = auditFigure("newest-returns", "t2");
  const older = auditFigure("older-returns", "t1");
  const newestCounts = auditFigure("newest-counts", "t2");
  const unreviewed = { ...figure, id: "unreviewed" };
  const selected = figureGroups([older]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].review.studies[0].ref, "t1");
  assert.equal(selected[0].figures[0].id, "older-returns");
  const all = figureGroups([newest, older, newestCounts, unreviewed]);
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((group) => group.figures.map((item) => item.id)),
    [["newest-returns", "newest-counts"], ["older-returns"], ["unreviewed"]],
  );
  for (const group of all) {
    if (!group.review) continue;
    for (const item of group.figures) assert.ok(item.sourceRefs.includes(group.review.studies[0].ref));
  }
  assert.equal(all[2].review, undefined);
});
