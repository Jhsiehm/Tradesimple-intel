import test from "node:test";
import assert from "node:assert/strict";
import { displayUnit, figureCsv, figureRows, formatValue, isFigureDate } from "../src/ask/figures/model.ts";

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
