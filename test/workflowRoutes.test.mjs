import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { router } from "../server/routes/index.mjs";
import { importObservations } from "../server/domain/research-observations.mjs";

let db, server, base, plan, id;
before(async () => {
  db = new DatabaseSync(":memory:");
  const source = importObservations(db, {
    name: "API observations",
    source: "Fixture",
    ownership: "local",
    license: "fixture",
    format: "json",
    content: JSON.stringify([
      {
        id: "one",
        entityId: "sector:one",
        metric: "count",
        unit: "count",
        value: 2,
        eventAt: "2020-01-01",
        availableAt: "2020-01-02",
        sourceUrl: "https://example.org/one",
      },
    ]),
  }).snapshot;
  plan = {
    title: "API descriptive workflow",
    question: "What is the observed count?",
    hypothesis: "Describe the frozen observations.",
    family: "descriptive",
    population: "Imported fixture",
    unitOfAnalysis: "Observation",
    outcome: "count",
    comparison: "none",
    from: "2020-01-01",
    to: "2020-01-31",
    knownAt: "2020-02-01",
    assumptions: [],
    unresolved: [],
    nodes: [{ id: "source", op: "source", snapshotId: source.id, mode: "first-publication" }],
    outputs: ["source"],
  };
  const routes = router();
  server = http.createServer((req, res) => routes.handle(req, res, { db }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});
async function call(method, suffix = "", body, origin = "http://localhost:5173") {
  const response = await fetch(`${base}/api/research/investigations${suffix}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test("workflow API validates methods, origins and protocols, with no partial or duplicate creation", async () => {
  assert.equal((await call("POST", "", { protocol: plan }, "https://untrusted.example")).status, 403);
  assert.equal((await call("DELETE")).status, 405);
  assert.equal((await call("POST", "", [])).status, 400);
  assert.equal((await call("POST", "", { protocol: { ...plan, knownAt: "yesterday" } })).status, 400);
  assert.equal((await call("GET")).body.items.length, 0);
  const created = await call("POST", "", { protocol: plan });
  assert.equal(created.status, 200, created.body.error);
  id = created.body.investigation.id;
  assert.equal(created.body.investigation.status, "draft");
  assert.equal((await call("POST", "", { protocol: plan })).body.investigation.id, id);
  assert.equal((await call("GET")).body.items.length, 1);
  assert.equal((await call("GET", "/inv_0000")).status, 404);
});

test("workflow API exposes bounded inspect data, a reproducible run, JSON inputs and executable ZIP", async () => {
  assert.equal((await call("GET", `/${id}/archive`)).status, 400);
  assert.equal((await call("POST", `/${id}/run`, { revision: 99 })).status, 409);
  const executed = await call("POST", `/${id}/run`, { revision: 1 });
  assert.equal(executed.status, 200, executed.body.error);
  assert.equal(executed.body.investigation.status, "completed");
  assert.equal(executed.body.investigation.result.outputs.source.preview[0].value, 2);
  assert.equal(executed.body.investigation.result.steps[0].ledger.excluded, 0);
  assert.equal(executed.body.investigation.evaluation.inputs, undefined);
  assert.equal((await call("POST", `/${id}/run`, { revision: 1 })).body.investigation.revision, 2);
  const inspected = await call("GET", `/${id}`);
  assert.equal(inspected.body.investigation.archiveAvailable, true);
  assert.equal(inspected.headers.get("cache-control"), "no-store");
  const exported = await call("GET", `/${id}/export`);
  assert.equal(exported.body.format, "tradesimple-workflow-v1");
  assert.ok(exported.body.record.evaluation.engineFiles["workflow.mjs"]);
  assert.equal(Object.values(exported.body.record.evaluation.originals)[0].license, "fixture");
  assert.equal(exported.body.record.evaluation.inputs.sources.source.rows.length, 1);
  const zip = await fetch(`${base}/api/research/investigations/${id}/archive`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get("content-type"), "application/zip");
  assert.equal(zip.headers.get("cache-control"), "no-store");
  assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(0), 0x04034b50);
  assert.equal((await call("PUT", `/${id}`)).status, 405);
});

test("workflow API saves unsupported research designs as blocked and never reports an executed study", async () => {
  const created = await call("POST", "", { protocol: { ...plan, family: "strategy" } });
  const result = await call("POST", `/${created.body.investigation.id}/run`, { revision: 1 });
  assert.equal(result.status, 200);
  assert.equal(result.body.investigation.status, "blocked");
  assert.equal(result.body.investigation.result.executed, false);
  assert.deepEqual(result.body.investigation.result.outputs, {});
});
