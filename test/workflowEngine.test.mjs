import test from "node:test";
import assert from "node:assert/strict";
import { cleanWorkflowProtocol, evaluateWorkflow, WORKFLOW_LIMITS } from "../shared/workflow.mjs";
import { protocol, source, observation, macroExample } from "./fixtures/workflowExamples.mjs";

const run = (nodes, rows, extra = {}) =>
  evaluateWorkflow(protocol(nodes, extra), { observed: source("obs_actual", rows) });
const sourceNode = { id: "observed", op: "source", snapshotId: "obs_actual", mode: "first-publication" };
const summary = { id: "summary", op: "summarize", input: "observed", value: "value", groupBy: [] };
const blocked = (result, expression) => {
  assert.equal(result.status, "blocked");
  assert.equal(result.executed, false);
  assert.deepEqual(result.outputs, {});
  assert.match(result.gaps.join(" "), expression);
};

test("generic graph composes exact join, direction-preserving difference and hand-worked mean", () => {
  const fixture = macroExample(),
    result = evaluateWorkflow(fixture.protocol, fixture.sources);
  assert.equal(result.status, "completed");
  assert.equal(result.claimScope, "descriptive");
  const row = result.outputs.summary.rows[0];
  assert.equal(row.n, 3);
  assert.ok(Math.abs(row.mean - 2 / 3) < Number.EPSILON);
  assert.equal(row.min, -1);
  assert.equal(row.max, 2);
  assert.equal(row.unit, "percent");
  assert.equal(row.metric, JSON.stringify(["difference", "inflation", "consensus"]));
  assert.equal(row.lineage.length, 6);
  assert.deepEqual(row.memberIds, ["a1", "a2", "a3"]);
  assert.deepEqual(
    evaluateWorkflow(JSON.parse(JSON.stringify(fixture.protocol)), JSON.parse(JSON.stringify(fixture.sources))),
    result,
  );
});
test("same operators address company earnings without a question-specific handler", () => {
  const fixture = macroExample();
  fixture.protocol.question = "How did reported earnings compare with the paired estimate?";
  fixture.protocol.population = "Explicit synthetic company releases";
  for (const descriptor of Object.values(fixture.sources))
    for (const row of descriptor.rows) {
      row.entityId = "company:EXAMPLE";
      row.unit = "USD_per_share";
      row.metric = descriptor.snapshotId === "obs_actual" ? "reported_EPS" : "estimated_EPS";
    }
  const result = evaluateWorkflow(fixture.protocol, fixture.sources);
  assert.equal(result.status, "completed");
  assert.equal(result.outputs.summary.rows[0].unit, "USD_per_share");
  assert.match(result.outputs.summary.rows[0].metric, /reported_EPS/);
});
test("explicit operating revenue minus cost uses different metrics with matching units", () => {
  const fixture = macroExample();
  fixture.sources.actual.rows = [
    observation("r1", 12, { releaseId: "a", metric: "revenue", unit: "USDmillion" }),
    observation("r2", 20, { releaseId: "b", metric: "revenue", unit: "USDmillion" }),
  ];
  fixture.sources.consensus.rows = [
    observation("c1", 5, { releaseId: "a", metric: "cost", unit: "USDmillion" }),
    observation("c2", 8, { releaseId: "b", metric: "cost", unit: "USDmillion" }),
  ];
  const result = evaluateWorkflow(fixture.protocol, fixture.sources),
    summaryRow = result.outputs.summary.rows[0];
  assert.equal(summaryRow.mean, 9.5);
  assert.equal(summaryRow.n, 2);
  assert.equal(summaryRow.metric, '["difference","revenue","cost"]');
});
test("null is missing for arithmetic and zero stays an observation", () => {
  const result = run(
    [sourceNode, summary],
    [observation("zero", 0), observation("null", null), observation("positive", 2)],
  );
  assert.equal(result.outputs.summary.rows[0].mean, 1);
  assert.equal(result.outputs.summary.rows[0].n, 2);
  assert.deepEqual(result.steps[1].ledger.excludedRows, [{ rowId: "null", reason: "missing-summary-value" }]);
});
test("empty sources and empty filtered results execute honestly without a fabricated mean", () => {
  const result = run([sourceNode, summary], []);
  assert.equal(result.status, "empty");
  assert.equal(result.executed, true);
  assert.deepEqual(result.outputs.summary.rows, []);
  const filtered = run(
    [sourceNode, { id: "none", op: "filter", input: "observed", field: "value", operator: "gt", value: 9 }],
    [observation("one", 1)],
  );
  assert.equal(filtered.status, "empty");
  assert.deepEqual(filtered.steps[1].ledger.excludedRows, [{ rowId: "one", reason: "filter-condition-false" }]);
});
test("strict filters retain explicit null equality and do not coerce numeric strings", () => {
  const filter = { id: "selected", op: "filter", input: "observed", field: "category", operator: "eq", value: null };
  const result = run([sourceNode, filter], [observation("null", 0, { category: null }), observation("missing", 0)]);
  assert.deepEqual(
    result.outputs.selected.rows.map((row) => row.id),
    ["null"],
  );
  assert.equal(result.steps[1].ledger.excludedRows[0].reason, "missing-filter-field");
  blocked(
    run([sourceNode, { ...filter, operator: "gt", value: 2 }], [observation("string", 0, { category: "3" })]),
    /nonnumeric/,
  );
});
test("mixed units and metrics cannot be pooled, but explicit grouping can separate them", () => {
  const rows = [observation("a", 1), observation("b", 2, { unit: "USD", metric: "revenue" })];
  blocked(run([sourceNode, summary], rows), /mixed metrics, units/);
  const result = run([sourceNode, { ...summary, groupBy: ["metric", "unit"] }], rows);
  assert.equal(result.status, "completed");
  assert.equal(result.outputs.summary.rows.length, 2);
});
test("forecast/realized types and forecast targets cannot be silently pooled", () => {
  const rows = [
    observation("realized", 1),
    observation("forecast", 2, { observationType: "forecast", targetAt: "2024-02-01" }),
  ];
  blocked(run([sourceNode, summary], rows), /observation semantics/);
  const targets = rows
    .slice(1)
    .concat(observation("forecast2", 3, { observationType: "forecast", targetAt: "2024-03-01" }));
  blocked(run([sourceNode, summary], targets), /observation semantics/);
});
test("source eligibility records unknown, future, out-of-period and retracted IDs", () => {
  const rows = [
    observation("valid", 0),
    observation("unknown", 1, { availableAt: null }),
    observation("future", 2, { availableAt: "2025-01-01" }),
    observation("old", 3, { eventAt: "2023-12-31" }),
    observation("retracted", null, { status: "retracted" }),
  ];
  const result = run([sourceNode], rows);
  assert.deepEqual(
    result.outputs.observed.rows.map((row) => row.id),
    ["valid"],
  );
  assert.deepEqual(
    result.steps[0].ledger.excludedRows.map((row) => row.rowId),
    ["unknown", "future", "old", "retracted"],
  );
  assert.equal(result.steps[0].ledger.received, 5);
});
test("date-only availability is not silently known at midnight or midday", () => {
  const rows = [observation("day", 1, { availableAt: "2024-01-10" }), observation("instant", 2)];
  const result = run([sourceNode], rows, { knownAt: "2024-01-10T14:00:00Z" });
  assert.deepEqual(
    result.outputs.observed.rows.map((row) => row.id),
    ["instant"],
  );
  assert.equal(run([sourceNode], rows, { knownAt: "2024-01-10" }).outputs.observed.count, 2);
});
test("non-descriptive and unresolved designs save without invented source nodes, then block", () => {
  for (const family of ["predictive", "causal", "strategy", "document"]) {
    const design = protocol([], { family, outputs: [] });
    assert.equal(cleanWorkflowProtocol(design).family, family);
    blocked(evaluateWorkflow(design, {}), /saved as a design only/);
  }
  const unresolved = protocol([], { unresolved: ["Need historical consensus"], outputs: [] });
  blocked(evaluateWorkflow(unresolved, {}), /Need historical consensus/);
  assert.throws(() => cleanWorkflowProtocol(protocol([], { outputs: [] })), /executable descriptive plan/);
});
test("unknown periods and cutoffs remain explicitly null only in blocked designs", () => {
  for (const extra of [{ family: "causal" }, { unresolved: ["The requested research period is not specified"] }]) {
    const design = protocol([], { ...extra, outputs: [], from: null, to: null, knownAt: null });
    const cleaned = cleanWorkflowProtocol(design);
    assert.equal(cleaned.from, null);
    assert.equal(cleaned.to, null);
    assert.equal(cleaned.knownAt, null);
    const result = evaluateWorkflow(design, {});
    blocked(result, /from has not been specified/);
    assert.deepEqual(result.steps, []);
  }
  const partial = protocol([], { family: "document", outputs: [], from: null, knownAt: null });
  assert.equal(cleanWorkflowProtocol(partial).to, "2024-12-31");
  assert.throws(() => cleanWorkflowProtocol(protocol([sourceNode], { knownAt: null })), /only blocked designs/);
  assert.throws(
    () => cleanWorkflowProtocol(protocol([], { family: "causal", outputs: [], from: "2024-02-30" })),
    /valid from/,
  );
  assert.throws(
    () => cleanWorkflowProtocol(protocol([], { family: "causal", outputs: [], from: "2025-01-01" })),
    /dates in order/,
  );
});
test("unknown or absent material fields, invalid periods and unsafe operation names fail closed", () => {
  for (const key of ["hypothesis", "unitOfAnalysis", "comparison", "knownAt"]) {
    const p = protocol();
    delete p[key];
    assert.throws(() => cleanWorkflowProtocol(p), new RegExp(key));
  }
  assert.throws(() => cleanWorkflowProtocol({ ...protocol(), shell: "arbitrary" }), /unknown fields/);
  assert.throws(
    () => cleanWorkflowProtocol(protocol([sourceNode, { id: "code", op: "eval", input: "observed" }])),
    /Unknown workflow operation/,
  );
  assert.throws(() => cleanWorkflowProtocol(protocol([sourceNode], { from: "2024-02-30" })), /valid from/);
  assert.throws(
    () => cleanWorkflowProtocol(protocol([sourceNode], { knownAt: "2024-01-10T25:00:00Z" })),
    /UTC knownAt/,
  );
});
test("forward/cyclic references, duplicate nodes and undeclared outputs are rejected", () => {
  assert.throws(() => cleanWorkflowProtocol(protocol([summary, sourceNode])), /earlier node/);
  assert.throws(() => cleanWorkflowProtocol(protocol([sourceNode, sourceNode])), /unique safe/);
  assert.throws(() => cleanWorkflowProtocol(protocol([sourceNode], { outputs: ["absent"] })), /existing nodes/);
});
test("prototype keys, inherited fields and getters are not interpreted or executed", () => {
  const dangerous = JSON.parse(JSON.stringify(protocol()).slice(0, -1) + ',"__proto__":{"polluted":true}}');
  assert.throws(() => cleanWorkflowProtocol(dangerous), /unsafe property/);
  const inherited = Object.create({ value: 3 });
  Object.assign(inherited, observation("inherited", 0));
  blocked(run([sourceNode], [inherited]), /plain object/);
  let called = false;
  const getter = observation("getter", 0);
  Object.defineProperty(getter, "secret", {
    enumerable: true,
    get() {
      called = true;
      return 42;
    },
  });
  blocked(run([sourceNode], [getter]), /unsafe property/);
  assert.equal(called, false);
  assert.equal({}.polluted, undefined);
  const p = protocol();
  Object.defineProperty(p.nodes, "0", {
    enumerable: true,
    get() {
      called = true;
      return sourceNode;
    },
  });
  blocked(evaluateWorkflow(p, {}), /unsafe array property/);
  assert.equal(called, false);
});
test("source snapshot/mode and source-map membership are checked", () => {
  blocked(evaluateWorkflow(protocol(), { observed: source("wrong", []) }), /pinned snapshot/);
  blocked(evaluateWorkflow(protocol(), { observed: source("obs_actual", [], "latest-known") }), /revision mode/);
  blocked(evaluateWorkflow(protocol(), {}), /missing/);
  blocked(
    evaluateWorkflow(protocol(), { observed: source("obs_actual", []), extra: source("obs_extra", []) }),
    /undeclared sources/,
  );
});
test("one-to-one joins reject duplicate keys on either side without a Cartesian product", () => {
  for (const side of ["actual", "consensus"]) {
    const fixture = macroExample();
    fixture.sources[side].rows.push({ ...fixture.sources[side].rows[0], id: "duplicate" });
    blocked(
      evaluateWorkflow(fixture.protocol, fixture.sources),
      new RegExp(`duplicate ${side === "actual" ? "left" : "right"} keys`),
    );
  }
});
test("left joins retain null right IDs, unmatched ledgers and both matched row lineages", () => {
  const fixture = macroExample();
  fixture.protocol.nodes = fixture.protocol.nodes.slice(0, 3);
  fixture.protocol.nodes[2].how = "left";
  fixture.protocol.outputs = ["paired"];
  fixture.sources.actual.rows[2].releaseId = null;
  fixture.sources.consensus.rows[1].releaseId = "different";
  const result = evaluateWorkflow(fixture.protocol, fixture.sources),
    rows = result.outputs.paired.rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].right_id, "f1");
  assert.equal(rows[1].right_id, null);
  assert.equal(rows[2].right_id, null);
  assert.equal(rows[0].lineage.length, 2);
  assert.equal(rows[1].lineage.length, 1);
  assert.deepEqual(result.steps[2].ledger.unmatchedLeft, ["a2", "a3"]);
  assert.deepEqual(result.steps[2].ledger.unmatchedRight, ["f2", "f3"]);
});
test("join keys are typed and null keys never match each other", () => {
  const fixture = macroExample();
  fixture.protocol.nodes = fixture.protocol.nodes.slice(0, 3);
  fixture.protocol.outputs = ["paired"];
  fixture.sources.actual.rows = [observation("a", 1, { releaseId: 1 }), observation("null_a", 1, { releaseId: null })];
  fixture.sources.consensus.rows = [
    observation("f", 1, { releaseId: "1" }),
    observation("null_f", 1, { releaseId: null }),
  ];
  const result = evaluateWorkflow(fixture.protocol, fixture.sources);
  assert.equal(result.status, "empty");
  assert.equal(result.steps[2].ledger.unmatchedRight.length, 2);
});
test("different date precision is not equated by an exact join", () => {
  const fixture = macroExample();
  fixture.protocol.nodes = fixture.protocol.nodes.slice(0, 3);
  fixture.protocol.outputs = ["paired"];
  fixture.protocol.nodes[2].keys = [{ left: "eventAt", right: "eventAt" }];
  fixture.sources.actual.rows = [observation("a", 1)];
  fixture.sources.consensus.rows = [observation("f", 1, { eventAt: "2024-01-10T00:00:00Z" })];
  assert.equal(evaluateWorkflow(fixture.protocol, fixture.sources).status, "empty");
});
test("difference rejects units, overwrite, nonnumeric values and overflow", () => {
  const fixture = macroExample();
  fixture.sources.consensus.rows[0].unit = "basis_points";
  blocked(evaluateWorkflow(fixture.protocol, fixture.sources), /incompatible units/);
  const difference = {
    id: "spread",
    op: "difference",
    input: "observed",
    left: "value",
    right: "estimate",
    output: "spread",
  };
  const row = observation("a", 3, { estimate: 1, estimate_unit: "percent", estimate_metric: "estimate" });
  blocked(run([sourceNode, difference], [{ ...row, spread: 9 }]), /overwrite/);
  blocked(run([sourceNode, difference], [{ ...row, estimate: "1" }]), /numeric operands/);
  blocked(
    run([sourceNode, difference], [{ ...row, value: Number.MAX_VALUE, estimate: -Number.MAX_VALUE }]),
    /nonfinite/,
  );
});
test("difference missing operands and summary missing groups retain exact exclusion IDs", () => {
  const difference = {
    id: "spread",
    op: "difference",
    input: "observed",
    left: "value",
    right: "estimate",
    output: "spread",
  };
  const result = run([sourceNode, difference], [observation("missing", 2)]);
  assert.equal(result.status, "empty");
  assert.deepEqual(result.steps[1].ledger.excludedRows[0].fields, ["estimate"]);
  const grouped = run([sourceNode, { ...summary, groupBy: ["region"] }], [observation("missing_group", 2)]);
  assert.equal(grouped.status, "empty");
  assert.equal(grouped.steps[1].ledger.excludedRows[0].reason, "missing-group-field");
});
test("derived availability never precedes the later operand or any summary member", () => {
  const fixture = macroExample();
  fixture.sources.consensus.rows[2].availableAt = "2024-03-01";
  const result = evaluateWorkflow(fixture.protocol, fixture.sources);
  assert.equal(result.outputs.summary.rows[0].derivedAvailableAt, "2024-03-01T23:59:59.999Z");
  fixture.protocol.outputs = ["paired", "surprises"];
  const rows = evaluateWorkflow(fixture.protocol, fixture.sources).outputs;
  assert.equal(rows.paired.rows[2].availableAt, "2024-01-10T13:30:00Z");
  assert.equal(rows.paired.rows[2].derivedAvailableAt, "2024-03-01T23:59:59.999Z");
  assert.equal(rows.surprises.rows[2].derivedAvailableAt, "2024-03-01T23:59:59.999Z");
});
test("derived availability is reserved and derived output names ending in value remain summarizable", () => {
  const fixture = macroExample();
  fixture.protocol.nodes[3].output = "derivedAvailableAt";
  assert.throws(() => cleanWorkflowProtocol(fixture.protocol), /new output fields/);
  fixture.protocol.nodes[3].output = "surprise_value";
  fixture.protocol.nodes[4].value = "surprise_value";
  assert.equal(evaluateWorkflow(fixture.protocol, fixture.sources).status, "completed");
});
test("summary retains actual group values even when derived metric metadata has the same field name", () => {
  const fixture = macroExample();
  fixture.protocol.nodes[4].groupBy = ["metric"];
  const row = evaluateWorkflow(fixture.protocol, fixture.sources).outputs.summary.rows[0];
  assert.equal(row.groupValues.metric, "inflation");
  assert.match(row.metric, /difference/);
});
test("compensated means retain cancellation residuals and avoid finite-mean sum overflow", () => {
  const residual = run([sourceNode, summary], [observation("a", 1e16), observation("b", 1), observation("c", -1e16)]);
  assert.equal(residual.outputs.summary.rows[0].mean, 1 / 3);
  const large = run([sourceNode, summary], [observation("a", Number.MAX_VALUE), observation("b", Number.MAX_VALUE)]);
  assert.equal(large.status, "completed");
  assert.equal(large.outputs.summary.rows[0].mean, Number.MAX_VALUE);
});
test("bounds cover source rows, nodes, outputs and numeric input validity", () => {
  blocked(
    run(
      [sourceNode],
      Array.from({ length: WORKFLOW_LIMITS.rows + 1 }, (_, i) => observation(`r${i}`, 1)),
    ),
    /5,000/,
  );
  assert.throws(
    () => cleanWorkflowProtocol(protocol(Array.from({ length: 17 }, (_, i) => ({ ...sourceNode, id: `s${i}` })))),
    /1–16/,
  );
  blocked(run([sourceNode], [observation("infinite", Infinity)]), /scalar|finite/);
  blocked(run([sourceNode], [observation("a", 1), observation("a", 2)]), /distinct row IDs/);
});
test("source and protocol objects remain unchanged by evaluation", () => {
  const fixture = macroExample(),
    before = JSON.stringify(fixture);
  evaluateWorkflow(fixture.protocol, fixture.sources);
  assert.equal(JSON.stringify(fixture), before);
});
test("maximum-size summary unions provenance once without losing member IDs", () => {
  const rows = Array.from({ length: WORKFLOW_LIMITS.rows }, (_, i) => observation(`r${i}`, i));
  const result = run([sourceNode, summary], rows);
  assert.equal(result.status, "completed");
  assert.equal(result.outputs.summary.rows[0].n, 5000);
  assert.equal(result.outputs.summary.rows[0].lineage.length, 5000);
  assert.equal(result.outputs.summary.rows[0].memberIds.length, 5000);
  assert.ok(Math.abs(result.outputs.summary.rows[0].mean - 2499.5) < 1e-9);
});

test("descriptive summaries include a finite total and preserve compensated cancellation", () => {
  const fixture = macroExample();
  const row = evaluateWorkflow(fixture.protocol, fixture.sources).outputs.summary.rows[0];
  assert.equal(row.sum, 2);
  assert.equal(row.sum_unit, "percent");
  assert.equal(row.sumReason, null);
});
