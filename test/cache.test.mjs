import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { failureText, throughCache } from "../server/lib/cache.mjs";
import { writeCache } from "../server/lib/db.mjs";
import { KEY } from "../server/lib/cacheKeys.mjs";

function memDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, stored_at INTEGER NOT NULL, ttl_ms INTEGER NOT NULL)");
  return db;
}
const timeout = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

test("throughCache stores a success and serves it without calling load again", async () => {
  const db = memDb();
  let calls = 0;
  const load = async () => { calls += 1; return { n: calls }; };
  assert.deepEqual(await throughCache(db, "k", { ttlMs: 60000, downMs: 60000, load }), { value: { n: 1 } });
  assert.deepEqual(await throughCache(db, "k", { ttlMs: 60000, downMs: 60000, load }), { value: { n: 1 } });
  assert.equal(calls, 1);
});

test("a failure is remembered for downMs: later callers skip the wait and get no value without a stored copy", async () => {
  const db = memDb();
  let calls = 0;
  const load = async () => { calls += 1; throw timeout(); };
  const a = await throughCache(db, "k", { ttlMs: 60000, downMs: 6 * 3600000, timeoutMs: 45000, load });
  assert.equal(a.value, null);
  assert.equal(a.down.why, "timed out after 45 s");
  assert.equal(Date.parse(a.down.retryAt) - Date.parse(a.down.at), 6 * 3600000);
  const b = await throughCache(db, "k", { ttlMs: 60000, downMs: 6 * 3600000, load });
  assert.equal(calls, 1, "second caller did not hit the upstream");
  assert.deepEqual(b.down, a.down);
});

test("on failure an expired copy is served as stale with its stored time", async () => {
  const db = memDb();
  writeCache(db, "k", { filings: [1] }, -1);
  const res = await throughCache(db, "k", { ttlMs: 60000, downMs: 60000, load: async () => { throw Object.assign(new Error("HTTP 503"), { status: 503 }); } });
  assert.deepEqual(res.value, { filings: [1] });
  assert.ok(res.staleAt);
  assert.equal(res.down.why, "returned HTTP 503");
  assert.ok(db.prepare("SELECT 1 FROM cache WHERE key = ?").get(KEY.down("k")), "failure stored under KEY.down");
});

test("failureText names timeouts, statuses, and other errors", () => {
  assert.equal(failureText(timeout(), 30000), "timed out after 30 s");
  assert.equal(failureText(new Error("lda.gov did not answer within 45 s after 1 attempt")), "timed out");
  assert.equal(failureText({ status: 429 }), "returned HTTP 429");
  assert.equal(failureText(new TypeError("fetch failed")), "fetch failed");
});
