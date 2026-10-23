import test from "node:test";
import assert from "node:assert/strict";
import { researchFigures, cleanResearchFigures } from "../shared/researchFigures.mjs";

const evidence = (tool, body, id = "t1", ok = true) => ({ id, tool, ok, json: JSON.stringify(body) });
const study = (partial = false) => ({
  id: partial ? "exp_partial" : "exp_complete",
  title: partial ? "Study A" : "Study B",
  symbols: [partial ? "AAA" : "BBB"],
  calculation: { status: "completed-as-recorded", replayPerformed: false },
  coverage: {
    partitionStatus: partial ? "partial" : "count-reconciled-within-declared-scope",
    partitions: 1,
    completed: partial ? 0 : 1,
    providerReceived: partial ? 2804 : 204,
    normalizedReceived: partial ? 2799 : 204,
    normalizedValid: partial ? 2799 : 204,
    historicalOwnership: "unverified",
  },
  timing: { mode: "assumed" },
  counts: { signals: partial ? 3 : 9 },
  stats: {
    total: partial ? -0.0222 : 0.0829,
    benchmarkTotal: partial ? 0.0963 : 0.0691,
    excessTotal: partial ? -0.1185 : 0.0138,
  },
  window: { resultFrom: partial ? "2025-01-09" : "2025-01-14", resultTo: "2025-06-02" },
  parameters: { cooldownDays: partial ? 30 : 7 },
  exclusions: partial
    ? { recorded: true, nonPositiveObligation: 589, ambiguousIdentity: 44, cooldown: 2163, omittedFields: 0 }
    : { recorded: true, nonPositiveObligation: 65, cooldown: 130, omittedFields: 0 },
});
const audit = () => ({
  ok: true,
  studies: [study(true), study(false)],
  comparison: { fields: { "parameters.cooldownDays": {}, "window.resultFrom": {} }, missingFields: [] },
  claimLimits: { replayPerformed: false },
});

test("saved-study figures preserve actual negative returns, raw fractions, excess units and JSON origins", () => {
  const figures = researchFigures([evidence("research_audit_saved_studies", audit())]);
  assert.equal(figures.length, 4);
  const returns = figures.find((f) => f.id.endsWith("recorded-returns"));
  assert.equal(returns.format, "percent");
  assert.deepEqual(
    returns.series[0].points.map((p) => p.y),
    [-0.0222, 0.0829],
  );
  assert.equal(returns.series[0].points[0].path, "/studies/0/stats/total");
  assert.deepEqual(returns.sourceRefs, ["t1"]);
  const excess = figures.find((f) => f.id.endsWith("recorded-excess"));
  assert.equal(excess.format, "percentage-points");
  assert.deepEqual(
    excess.series[0].points.map((p) => p.y),
    [-0.1185, 0.0138],
  );
  assert.match(returns.notes.join(" "), /partial.*0 of 1/);
  assert.match(returns.notes.join(" "), /Unequal designs\/windows/);
  assert.match(returns.notes.join(" "), /delays are assumed/);
  assert.match(returns.notes.join(" "), /did not.*replay arithmetic/);
  assert.match(returns.notes.join(" "), /historical ownership is unverified/);
});

test("count stages and exact exclusion counters are separate; an absent counter is missing, not zero", () => {
  const figures = researchFigures([evidence("research_audit_saved_studies", audit())]);
  const collection = figures.find((f) => f.id.endsWith("collection-counts"));
  assert.equal(collection.series[0].points[0].y, 2804);
  assert.equal(collection.series[1].points[0].y, 2799);
  assert.equal(collection.series[3].points[0].y, 3);
  assert.match(collection.notes.join(" "), /not additive/);
  const exclusions = figures.find((f) => f.id.endsWith("exclusions"));
  const missing = exclusions.series[1].points.find((p) => p.path.endsWith("ambiguousIdentity"));
  assert.equal(missing.y, null);
  assert.equal(exclusions.series[0].points.find((p) => p.path.endsWith("cooldown")).y, 2163);
  assert.match(exclusions.notes.join(" "), /Missing values remain missing/);
});

function workflow(
  rows,
  { op = "source", field = "value", rowCount = rows.length, status = "completed", preview = true } = {},
) {
  return {
    ok: true,
    investigation: {
      id: "inv_example",
      status,
      protocol: {
        title: "Water use study",
        family: "descriptive",
        knownAt: "2025-03-01",
        nodes: [{ id: "out", op, output: field }],
      },
      result: {
        status,
        executed: status === "completed",
        claimScope: "descriptive",
        limitations: ["Imported municipal sample only."],
        outputs: { out: preview ? { rowCount, preview: rows } : { count: rowCount, rows } },
        steps: [{ id: "source", ledger: { excluded: 2 } }],
      },
    },
  };
}
const observation = (id, value, unit = "litres", metric = "water use") => ({
  id,
  entityId: id,
  eventAt: "2025-02-01",
  value,
  unit,
  metric,
});

test("arbitrary descriptive observations visualize only explicit compatible units and preserve preview missingness", () => {
  const body = workflow([observation("city-A", 12), observation("city-B", null), observation("city-C", 7, "gallons")], {
    rowCount: 83,
  });
  const figures = researchFigures([evidence("research_inspect_investigation", body)]);
  assert.equal(figures.length, 2);
  const litres = figures.find((f) => f.unit === "litres");
  assert.deepEqual(
    litres.series[0].points.map((p) => p.y),
    [12, null],
  );
  assert.equal(litres.totalPoints, 83);
  assert.equal(litres.series[0].points[1].path, "/investigation/result/outputs/out/preview/1/value");
  assert.match(litres.notes.join(" "), /Preview: 2 of 83/);
  assert.match(litres.notes.join(" "), /2 rows excluded/);
  assert.equal(figures.find((f) => f.unit === "gallons").series[0].points[0].y, 7);
});

test("group summaries and calculated fields retain their own explicit metric/unit instead of return assumptions", () => {
  const row = {
    id: "summary-1",
    groupValues: { region: "North" },
    n: 4,
    mean: -3.5,
    mean_unit: "USD millions",
    mean_metric: "mean operating surplus",
    mean_semantics: "realized",
  };
  const summary = researchFigures([evidence("research_run_investigation", workflow([row], { op: "summarize" }))])[0];
  assert.equal(summary.series[0].points[0].y, -3.5);
  assert.equal(summary.format, "number");
  assert.equal(summary.unit, "USD millions");
  assert.match(summary.series[0].points[0].label, /region: North/);
  assert.match(summary.series[0].points[0].detail, /n=4/);
  const difference = { id: "x", margin: 8, margin_unit: "USD", margin_metric: "revenue less cost" };
  const derived = researchFigures([
    evidence(
      "research_run_investigation",
      workflow([difference], { op: "difference", field: "margin", preview: false }),
    ),
  ])[0];
  assert.equal(derived.unit, "USD");
  assert.equal(derived.series[0].points[0].path, "/investigation/result/outputs/out/rows/0/margin");
});

test("unknown, malformed, blocked, failed, empty and unsupported model text never produce imagined observations", () => {
  assert.deepEqual(
    researchFigures([
      evidence("research_inspect_investigation", workflow([observation("A", 5)], { status: "blocked" })),
    ]),
    [],
  );
  assert.deepEqual(researchFigures([evidence("research_inspect_investigation", workflow([]))]), []);
  assert.deepEqual(
    researchFigures([evidence("research_inspect_investigation", workflow([{ id: "A", value: 1 }]))]),
    [],
  );
  assert.deepEqual(researchFigures([evidence("research_audit_saved_studies", { ok: true, studies: [{}] })]), []);
  assert.deepEqual(researchFigures([evidence("run_backtest", { ok: true, stats: { total: 1 } })]), []);
  assert.deepEqual(researchFigures([evidence("web_result", { ok: true, ...audit() })]), []);
  assert.deepEqual(
    researchFigures([evidence("research_sources", { ok: false, snapshot: { preview: [observation("A", 1)] } })]),
    [],
  );
  assert.deepEqual(researchFigures([evidence("research_sources", { ok: true }, "t1", false)]), []);
  assert.deepEqual(researchFigures([{ id: "t1", tool: "research_sources", ok: true, json: "bad json" }]), []);
});

test("numeric observation previews separate actual and forecast semantics and disclose full row count", () => {
  const rows = [observation("A", 4), { ...observation("B", 6), observationType: "forecast", targetAt: "2026-01-01" }];
  const figures = researchFigures([
    evidence("research_sources", {
      ok: true,
      snapshot: { name: "Population water consumption", preview: rows, totalRows: 53 },
    }),
  ]);
  assert.equal(figures.length, 2);
  assert.equal(figures[0].totalPoints, 53);
  assert.equal(figures[0].series[0].points[0].path, "/snapshot/preview/0/value");
  assert.match(figures[1].notes.join(" "), /forecast/);
});

test("actual daily curves keep source values and null gaps; malformed or invented summary paths are refused", () => {
  const body = {
    ok: true,
    rules: { benchmark: "Market" },
    curve: [
      { d: "2025-01-01", s: 1, b: 1 },
      { d: "2025-01-02", s: null, b: 0.98 },
      { d: "2025-01-03", s: 0.95, b: 1.02 },
    ],
  };
  const figure = researchFigures([evidence("run_backtest", body)])[0];
  assert.equal(figure.kind, "line");
  assert.equal(figure.unit, "index level");
  assert.deepEqual(
    figure.series[0].points.map((p) => p.y),
    [1, null, 0.95],
  );
  assert.equal(figure.series[1].points[2].path, "/curve/2/b");
  assert.deepEqual(researchFigures([evidence("run_backtest", { ...body, curve: [...body.curve].reverse() })]), []);
  assert.deepEqual(researchFigures([evidence("run_backtest", { ...body, building: true })]), []);
  assert.deepEqual(researchFigures([evidence("research_memory", { ok: true, record: body })]), []);
});

test("raw actual tool bodies take precedence over trimmed model bodies and figures stay bounded", () => {
  const body = {
    ok: true,
    snapshot: {
      name: "Bounded source",
      totalRows: 2000,
      preview: Array.from({ length: 2000 }, (_, i) => observation(`r${i}`, i)),
    },
  };
  const entries = Array.from({ length: 10 }, (_, i) =>
    evidence("research_sources", { ok: true, snapshot: {} }, `t${i + 1}`),
  );
  const figures = researchFigures(entries, new Map(entries.map((entry) => [entry.id, body])));
  assert.equal(figures.length, 6);
  assert.equal(figures[0].series[0].points.length, 120);
  assert.equal(figures[0].totalPoints, 2000);
  assert.equal(figures[0].series[0].points[119].y, 119);
});

test("saved figure cleaning strips executable specifications, refuses numeric coercion and retains exact data origins", () => {
  const [valid] = researchFigures([evidence("research_audit_saved_studies", audit())]);
  const hostile = {
    ...valid,
    html: "<script>run()</script>",
    onclick: "run()",
    series: [{ ...valid.series[0], points: [{ ...valid.series[0].points[0], y: "12" }, ...valid.series[0].points] }],
  };
  const [clean] = cleanResearchFigures([hostile]);
  assert.equal(clean.html, undefined);
  assert.equal(clean.onclick, undefined);
  assert.deepEqual(clean.series[0].points, valid.series[0].points);
  assert.deepEqual(cleanResearchFigures([{ ...valid, format: "eval" }]), []);
  assert.deepEqual(cleanResearchFigures([{ ...valid, unit: null }]), []);
  assert.deepEqual(
    cleanResearchFigures([
      {
        ...valid,
        series: [
          { id: "bad", label: "Bad", points: [{ label: "A", x: "A", y: 1, ref: "javascript:run()", path: "/x" }] },
        ],
      },
    ]),
    [],
  );
  const many = {
    ...valid,
    series: [{ id: "many", label: "many", points: Array.from({ length: 1000 }, () => valid.series[0].points[0]) }],
    totalPoints: 1000,
  };
  assert.equal(cleanResearchFigures([many])[0].series[0].points.length, 240);
});
