import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../server/lib/db.mjs";
import { equityEvents } from "../server/domain/corporate/events.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a hanging upstream does not hold the chart: the kind is pending, the rest answer, every feed is labeled", async () => {
  const prev = { cache: process.env.INTEL_CACHE, key: process.env.LDA_API_KEY, fetch: globalThis.fetch };
  process.env.INTEL_CACHE = ":memory:";
  process.env.LDA_API_KEY = "test";
  globalThis.fetch = () => new Promise((_, reject) => setTimeout(() => reject(new TypeError("fetch failed (slow test upstream)")), 300));
  try {
    const db = openDb(root);
    const t0 = Date.now();
    const res = await equityEvents(db, "AAPL", ["lobby", "earn"], { waitMs: 50 });
    assert.ok(Date.now() - t0 < 2000, "answered at the budget");
    assert.deepEqual(res.pending.sort(), ["earn", "lobby", "next"]);
    assert.deepEqual(res.marks, []);
    for (const f of res.feeds) {
      assert.ok(f.source && f.latency, `${f.id} has source and latency`);
      assert.match(f.note, /Still loading/);
    }
  } finally {
    if (prev.cache === undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE = prev.cache;
    if (prev.key === undefined) delete process.env.LDA_API_KEY; else process.env.LDA_API_KEY = prev.key;
    globalThis.fetch = prev.fetch;
  }
});
