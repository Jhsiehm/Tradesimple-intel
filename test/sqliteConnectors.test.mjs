import { createResearchBackup, verifyResearchBackup } from "../server/domain/research-backup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSqliteConnector } from "../server/domain/sqlite-connectors.mjs";
import { readConnector, listConnectors } from "../server/domain/research-connectors.mjs";
import { prepareObservations, importObservations, getObservations } from "../server/domain/research-observations.mjs";
import { prepareDataset } from "../server/domain/research-events.mjs";
import { verifyConnectorEvidence } from "../server/domain/research-connector-evidence.mjs";
const envFor = (file, query) => ({ RESEARCH_SQLITE_CONNECTORS: JSON.stringify({ measurements: { file, query } }) });
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-sqlite-connector-")),
    file = path.join(dir, "private.sqlite"),
    db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE observations(id TEXT,entityId TEXT,metric TEXT,unit TEXT,value REAL,eventAt TEXT,availableAt TEXT,sourceUrl TEXT); INSERT INTO observations VALUES ('a','facility:one','temperature','C',-4,'2025-01-01','2025-01-02','https://example.org/source');",
  );
  db.close();
  return { dir, file };
}
test("SQLite connector feeds normal observation validation with bounded provenance and no paths or SQL", async () => {
  const { dir, file } = fixture(),
    db = new DatabaseSync(path.join(dir, "cache.sqlite"));
  try {
    const env = envFor(file, "SELECT * FROM observations ORDER BY id");
    assert.deepEqual(listConnectors(env), [
      { id: "measurements", label: "measurements", kind: "sqlite", resumable: false },
    ]);
    const result = await readConnector("measurements", {
      env,
      lookup: () => assert.fail("database reads must not resolve DNS"),
      request: () => assert.fail("database reads must not use HTTP"),
    });
    assert.ok(!JSON.stringify(result).includes(file));
    assert.ok(!result.content.includes("SELECT"));
    const json = JSON.parse(result.content);
    assert.equal(json.items[0].value, -4);
    assert.equal(json.databaseEvidence.rows, 1);
    assert.doesNotThrow(() => verifyConnectorEvidence(json));
    for (const patch of [
      { retrievedAt: "2025-02-30T00:00:00.000Z" },
      { retrievedAt: 0 },
      { completedAt: "2025-01-01" },
      { retrievedAt: "2025-01-02T00:00:00.000Z", completedAt: "2025-01-01T00:00:00.000Z" },
    ]) {
      const altered = structuredClone(json);
      Object.assign(altered.databaseEvidence, patch);
      assert.throws(() => verifyConnectorEvidence(altered), /Database evidence/);
    }
    const body = { name: "Database observations", ownership: "Local owner", license: "Synthetic only", ...result };
    assert.ok(prepareObservations(body).ok);
    const saved = importObservations(db, body).snapshot;
    assert.equal(getObservations(db, saved.id).rawContent, result.content);
    const source = db
      .prepare("PRAGMA database_list")
      .all()
      .find((r) => r.name === "research").file;
    createResearchBackup(source, path.join(dir, "backup"));
    verifyResearchBackup(path.join(dir, "backup"));
    const edited = new DatabaseSync(file);
    edited.exec("UPDATE observations SET value=99");
    edited.close();
    assert.equal(getObservations(db, saved.id).rawContent, result.content);
    assert.equal(JSON.parse((await readConnector("measurements", { env })).content).items[0].value, 99);
    json.items[0].value = 100;
    assert.throws(() => prepareObservations({ ...body, content: JSON.stringify(json) }), /Database evidence/);
    assert.throws(
      () => prepareDataset(db, { name: "Bad database evidence", ...result, content: JSON.stringify(json) }),
      /Database evidence/,
    );
    const duplicate = {
      ...env,
      RESEARCH_API_CONNECTORS: JSON.stringify({ measurements: { url: "https://example.org/data" } }),
    };
    assert.throws(() => listConnectors(duplicate), /unique/);
    await assert.rejects(readConnector("measurements", { env: duplicate }), /unique/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("SQLite connector preserves large integers and refuses binary data, missing files and mutations", async () => {
  const { dir, file } = fixture();
  try {
    const large = await readSqliteConnector("measurements", {
      env: envFor(file, "SELECT 9223372036854775807 AS id, 42 AS value"),
    });
    assert.deepEqual(JSON.parse(large.content).items, [{ id: "9223372036854775807", value: 42 }]);
    for (const query of [
      "DELETE FROM observations",
      "SELECT 1; DROP TABLE observations",
      "SELECT load_extension('unknown')",
      "SELECT zeroblob(10) AS payload",
    ])
      await assert.rejects(readSqliteConnector("measurements", { env: envFor(file, query) }), /Database connector/);
    const missing = path.join(dir, "missing.sqlite");
    await assert.rejects(
      readSqliteConnector("measurements", { env: envFor(missing, "SELECT 1") }),
      /Database connector query failed/,
    );
    assert.equal(fs.existsSync(missing), false);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT count(*) AS n FROM observations").get().n, 1);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("SQLite connector rejects truncated results and terminates excessive computation", async () => {
  const { dir, file } = fixture();
  try {
    await assert.rejects(
      readSqliteConnector("measurements", {
        env: envFor(file, "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5001) SELECT x FROM n"),
      }),
      /5,000 rows/,
    );
    await assert.rejects(
      readSqliteConnector("measurements", { env: envFor(file, "SELECT printf('%03000000d',1) AS oversized") }),
      /2 MiB/,
    );
    const started = Date.now();
    await assert.rejects(
      readSqliteConnector("measurements", {
        timeoutMs: 100,
        env: envFor(
          file,
          "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n",
        ),
      }),
      /time or output limit/,
    );
    assert.ok(Date.now() - started < 5000);
    const normal = await readSqliteConnector("measurements", { env: envFor(file, "SELECT * FROM observations") });
    assert.equal(JSON.parse(normal.content).items.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
