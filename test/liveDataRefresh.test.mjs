import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../server/lib/db.mjs";
import { straitNews } from "../server/strait.mjs";

test("failed registry refresh leaves the previous complete registry visible", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intel-registry-"));
  const previous = process.env.INTEL_CACHE;
  delete process.env.INTEL_CACHE;
  fs.mkdirSync(path.join(root, "data"));
  const row = {
    symbol: "AAA",
    name: "Original",
    cik: null,
    ldaClients: [],
    recipients: [],
    districts: [],
    state: null,
    lat: null,
    lon: null,
  };
  const file = path.join(root, "data/tickers.json");
  fs.writeFileSync(file, JSON.stringify([row]));
  const reader = openDb(root);
  try {
    fs.writeFileSync(
      file,
      JSON.stringify([
        { ...row, symbol: "BBB" },
        { ...row, symbol: "CCC", name: null },
      ]),
    );
    assert.throws(() => openDb(root));
    assert.deepEqual(
      reader
        .prepare("SELECT symbol FROM tickers ORDER BY symbol")
        .all()
        .map((x) => x.symbol),
      ["AAA"],
    );
  } finally {
    reader.close();
    if (previous === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GDELT network failure falls back to labeled RSS and caches the result", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, stored_at INTEGER NOT NULL, ttl_ms INTEGER NOT NULL)",
  );
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("gdeltproject")) throw new TypeError("fetch failed");
    return new Response(
      "<rss><channel><item><title>Live headline</title><link>https://example.org/story</link><pubDate>Fri, 16 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>",
    );
  };
  try {
    const result = await straitNews(db);
    assert.equal(result.source, "Google News RSS");
    assert.equal(result.items[0].title, "Live headline");
    assert.deepEqual(await straitNews(db), result);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test("quote refresh failure keeps original timestamps and explicitly marks the cached snapshot stale", async () => {
  const { quoteBoard } = await import("../server/chart.mjs");
  const { KEY } = await import("../server/lib/cacheKeys.mjs");
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE tickers (symbol TEXT, name TEXT, cik TEXT, lda_clients TEXT, recipients TEXT, districts TEXT, state TEXT, lat REAL, lon REAL); CREATE TABLE cache (key TEXT PRIMARY KEY, body TEXT, stored_at INTEGER, ttl_ms INTEGER)",
  );
  const old = { ok: true, asOf: "2026-10-15T12:00:00Z", items: [{ symbol: "OLD", last: 10 }], latency: "old" };
  db.prepare("INSERT INTO cache VALUES (?, ?, ?, ?)").run(KEY.screener, JSON.stringify(old), 1, 1);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider down");
  };
  try {
    const out = await quoteBoard(db);
    assert.equal(out.stale, true);
    assert.equal(out.asOf, old.asOf);
    assert.deepEqual(out.items, old.items);
    assert.match(out.latency, /REFRESHING QUOTES/);
    await new Promise((resolve) => setImmediate(resolve));
    const failed = await quoteBoard(db);
    assert.equal(failed.refreshing, false);
    assert.match(failed.latency, /provider down/);
    assert.equal(failed.asOf, old.asOf);
  } finally {
    globalThis.fetch = previousFetch;
    db.close();
  }
});

test("an expired quote snapshot transitions from refreshing to fresh without waiting for the next expiry", async () => {
  const { quoteBoard } = await import("../server/chart.mjs");
  const { KEY } = await import("../server/lib/cacheKeys.mjs");
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE tickers (symbol TEXT, name TEXT, cik TEXT, lda_clients TEXT, recipients TEXT, districts TEXT, state TEXT, lat REAL, lon REAL); CREATE TABLE cache (key TEXT PRIMARY KEY, body TEXT, stored_at INTEGER, ttl_ms INTEGER); INSERT INTO tickers VALUES ('AAA', 'Company', NULL, '[]', '[]', '[]', NULL, NULL, NULL)",
  );
  db.prepare("INSERT INTO cache VALUES (?, ?, ?, ?)").run(
    KEY.screener,
    JSON.stringify({ ok: true, asOf: "2020-01-01T00:00:00Z", items: [{ symbol: "AAA", last: 1 }], missing: [] }),
    1,
    1,
  );
  const original = globalThis.fetch;
  let release,
    calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((r) => {
      release = r;
    });
    return Response.json({ data: { rows: [{ symbol: "AAA", lastsale: "$2.00", marketCap: "10" }] } });
  };
  try {
    const before = await quoteBoard(db);
    assert.equal(before.refreshing, true);
    assert.equal(before.items[0].last, 1);
    await quoteBoard(db);
    assert.equal(calls, 1, "refresh shared while in flight");
    release();
    await new Promise((r) => setImmediate(r));
    const after = await quoteBoard(db);
    assert.equal(after.stale, undefined);
    assert.equal(after.items[0].last, 2);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});
