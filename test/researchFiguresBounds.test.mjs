import test from "node:test";
import assert from "node:assert/strict";
import { researchFigures, cleanResearchFigures } from "../shared/researchFigures.mjs";

const wrap = (tool, id, body) => ({ id, tool, ok: true, json: JSON.stringify(body) });
const row = (value, id = "A") => ({ id, entityId: id, value, metric: "real wage", unit: "USD/hour" });
const execution = (value = 17) => ({
  ok: true,
  investigation: {
    id: "inv_wages",
    revision: 2,
    status: "completed",
    protocol: { title: "Real wages by county", family: "descriptive", nodes: [{ id: "wages", op: "source" }] },
    result: {
      status: "completed",
      executed: true,
      claimScope: "descriptive",
      outputs: { wages: { preview: [row(value)], rowCount: 1 } },
    },
  },
});

test("executed outcomes retain chart budget ahead of many earlier source previews", () => {
  const entries = Array.from({ length: 8 }, (_, i) =>
    wrap("research_sources", `t${i + 1}`, {
      ok: true,
      snapshot: { name: `Source ${i}`, totalRows: 1, preview: [row(i)] },
    }),
  );
  entries.push(wrap("research_run_investigation", "t9", execution()));
  const figures = researchFigures(entries);
  assert.equal(figures.length, 6);
  assert.equal(figures[0].series[0].points[0].y, 17);
  assert.equal(figures[0].series[0].points[0].ref, "t9");
  assert.match(figures[0].title, /Real wages/);
});

test("same saved result inspected after execution is visualized once using execution provenance", () => {
  const figures = researchFigures([
    wrap("research_run_investigation", "t1", execution()),
    wrap("research_inspect_investigation", "t2", execution()),
  ]);
  assert.equal(figures.length, 1);
  assert.deepEqual(figures[0].sourceRefs, ["t1"]);
});

test("bounds never synthesize missing curve points or hide preview limits", () => {
  const body = {
    ok: true,
    curve: Array.from({ length: 360 }, (_, i) => ({
      d: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
      s: i === 3 ? null : 1 - i / 1000,
      b: 1 + i / 1000,
    })),
  };
  const [figure] = researchFigures([wrap("run_backtest", "t1", body)]);
  assert.equal(figure.totalPoints, 360);
  assert.equal(figure.series.flatMap((s) => s.points).length, 240);
  assert.equal(figure.series[0].points[3].y, null);
  assert.equal(figure.series[0].points.at(-1).path, "/curve/119/s");
  assert.match(figure.notes.join(" "), /later dates are omitted/);
});

test("saved figure payload rejects malformed types, strips extras and bounds every string and collection", () => {
  const [figure] = researchFigures([wrap("research_run_investigation", "t1", execution())]);
  const huge = "Long ".repeat(2000);
  const raw = {
    ...figure,
    title: huge,
    notes: Array.from({ length: 500 }, () => huge),
    series: Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      label: huge,
      points: Array.from({ length: 500 }, () => ({
        ...figure.series[0].points[0],
        label: huge,
        detail: huge,
        extra: "discard",
      })),
    })),
    totalPoints: 10000,
  };
  const clean = cleanResearchFigures(Array.from({ length: 20 }, (_, i) => ({ ...raw, id: String(i) })));
  assert.equal(clean.length, 6);
  assert.equal(clean[0].title.length, 240);
  assert.ok(clean[0].notes.length <= 16);
  assert.equal(clean[0].series.flatMap((s) => s.points).length, 240);
  assert.equal(clean[0].series[0].points[0].detail.length, 240);
  assert.equal(clean[0].series[0].points[0].extra, undefined);
  assert.deepEqual(cleanResearchFigures({ ...figure }), []);
  assert.deepEqual(cleanResearchFigures([{ ...figure, totalPoints: "100" }]), []);
  assert.deepEqual(
    cleanResearchFigures([
      {
        ...figure,
        series: [
          {
            id: "bad",
            label: "Bad",
            points: [
              { ...figure.series[0].points[0], y: Infinity },
              { ...figure.series[0].points[0], y: NaN },
            ],
          },
        ],
      },
    ]),
    [],
  );
});

test("canonical bounded citation refs reject huge and malformed IDs in evidence and saved payloads", () => {
  const [figure] = researchFigures([wrap("research_run_investigation", "t1", execution())]);
  for (const ref of ["t" + "1".repeat(500_000), "t0", "t01", "t-1", "t1.0", "t1e2", "t1000000", "t1\n"]) {
    assert.deepEqual(researchFigures([wrap("research_run_investigation", ref, execution())]), []);
    const forged = {
      ...figure,
      sourceRefs: [ref],
      series: [{ ...figure.series[0], points: [{ ...figure.series[0].points[0], ref }] }],
    };
    assert.deepEqual(cleanResearchFigures([forged]), []);
  }
  for (const ref of ["t1", "t999999"]) {
    const [accepted] = researchFigures([wrap("research_run_investigation", ref, execution())]);
    assert.deepEqual(accepted.sourceRefs, [ref]);
    assert.ok(JSON.stringify(accepted).length < 10_000);
  }
  const [clean] = cleanResearchFigures([{ ...figure, sourceRefs: ["t" + "9".repeat(500_000)] }]);
  assert.deepEqual(clean.sourceRefs, ["t1"], "saved sourceRefs are re-derived solely from validated points");
});

test("disjoint exclusion ledgers preserve the full known union and disclose upstream omitted fields", () => {
  const studies = ["alpha", "beta"].map((prefix, index) => ({
    id: `exp_${prefix}`,
    title: prefix,
    exclusions: {
      recorded: true,
      omittedFields: index === 0 ? 3 : 0,
      ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${prefix}${String(i).padStart(2, "0")}`, i + 1])),
    },
  }));
  const [figure] = researchFigures([wrap("research_audit_saved_studies", "t1", { ok: true, studies })]);
  assert.equal(figure.id, "t1-exclusions");
  assert.equal(figure.totalPoints, 40);
  assert.equal(figure.series[0].points.length, 20);
  assert.equal(figure.series[1].points.length, 20);
  assert.equal(figure.series[0].points.filter((p) => p.y !== null).length, 10);
  assert.equal(figure.series[1].points.filter((p) => p.y !== null).length, 10);
  assert.match(figure.notes.join(" "), /20 of 40 known categories displayed/);
  assert.match(figure.notes.join(" "), /omitted exclusion-counter fields: 3 \(exp_alpha\)/);
  assert.match(figure.notes.join(" "), /omitted exclusion-counter fields: 0 \(exp_beta\)/);
  assert.match(figure.notes.join(" "), /cannot be added to the known category count/);
  assert.equal(figure.series[1].points.find((p) => p.y === 1).path, "/studies/1/exclusions/beta00");
});

test("actual daily curves reject normalized, impossible and noncanonical dates", () => {
  for (const d of ["2025-02-30", "2025-13-01", "2025-00-01", "2025-1-01", "2025-01-01T00:00:00Z", "not-a-date"]) {
    assert.deepEqual(researchFigures([wrap("run_backtest", "t1", { ok: true, curve: [{ d, s: -0.5, b: null }] })]), []);
  }
  const [valid] = researchFigures([
    wrap("run_backtest", "t1", { ok: true, curve: [{ d: "2024-02-29", s: -0.5, b: null }] }),
  ]);
  assert.equal(valid.series[0].points[0].y, -0.5);
  assert.equal(valid.series[1].points[0].y, null);
});
