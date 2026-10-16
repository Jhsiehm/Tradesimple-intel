import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../server/lib/db.mjs";
import { preserveSourceDocument, getSourceDocument } from "../server/domain/source-documents.mjs";
import { form4, form4Rows } from "../server/domain/positions/insiders.mjs";
import { writeForms, storeRows } from "../server/domain/positions/insiderStore.mjs";
import { archiveEvidence } from "../server/domain/research-archive.mjs";
import { putRun, getRun, hashOf } from "../server/domain/research-store.mjs";
test("source documents are immutable, versioned by content and independently checked", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const a = preserveSourceDocument(db, {
      url: "https://example.org/filing.xml",
      content: "<original/>",
      mediaType: "application/xml",
    });
    const same = preserveSourceDocument(db, { url: a.url, content: "<original/>", mediaType: "application/xml" });
    assert.deepEqual(a, same);
    const revision = preserveSourceDocument(db, { url: a.url, content: "<corrected/>", mediaType: "application/xml" });
    assert.notEqual(revision.hash, a.hash);
    assert.equal(getSourceDocument(db, a.hash).content, "<original/>");
    assert.throws(() => db.prepare("UPDATE research.source_documents SET body=?").run("bad"), /immutable/);
    assert.throws(() => getSourceDocument(db, "missing"), /missing/);
    assert.throws(
      () => preserveSourceDocument(db, { url: "https://user:password@example.org", content: "secret" }),
      /credentials/,
    );
  } finally {
    db.close();
  }
});
test("Form 4 original survives cache deletion, stored-row ingestion and portable evidence export", async () => {
  const prior = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ":memory:";
  const db = openDb(decodeURIComponent(new URL("..", import.meta.url).pathname));
  if (prior === undefined) delete process.env.INTEL_CACHE;
  else process.env.INTEL_CACHE = prior;
  try {
    const content = fs.readFileSync(new URL("./fixtures/form4-0000002488-26-000165.xml", import.meta.url), "utf8");
    const pick = { accession: "0000002488-26-000165", filed: "2026-01-05", doc: "form4.xml" };
    const parsed = await form4(db, "2488", pick, { read: async () => content });
    const ticker = { symbol: "AMD", cik: parsed.issuerCik };
    const rows = form4Rows(ticker, pick, parsed).rows;
    assert.ok(rows.length);
    writeForms(db, [{ accession: pick.accession, issuerCik: parsed.issuerCik, form: "4", rows }], "daily");
    const stored = storeRows(db, { symbols: ["AMD"] }).items;
    assert.deepEqual(stored[0].sourceDocument, parsed.sourceDocument);
    db.prepare("DELETE FROM cache").run();
    assert.equal(getSourceDocument(db, parsed.sourceDocument.hash).content, content);
    const files = { "fixture.mjs": "fixture" },
      engine = { id: hashOf(files), files };
    const run = getRun(db, putRun(db, { inputs: {}, result: { ok: true }, provenance: { records: stored }, engine }));
    const archive = archiveEvidence(db, run);
    assert.equal(archive.documents[parsed.sourceDocument.hash].content, content);
    assert.match(parsed.sourceDocument.availabilityBasis, /not original publication/);
  } finally {
    db.close();
  }
});
test("House PDF and Senate HTML originals are preserved with parsed lines", async () => {
  const { ptrLines, efdLines } = await import("../server/domain/positions/congress.mjs");
  const prior = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ":memory:";
  const db = openDb(decodeURIComponent(new URL("..", import.meta.url).pathname));
  if (prior === undefined) delete process.env.INTEL_CACHE;
  else process.env.INTEL_CACHE = prior;
  try {
    const pdf = fs.readFileSync(new URL("./fixtures/house-20035420.pdf", import.meta.url));
    const house = await ptrLines(db, { year: 2026, docId: "20035420" }, { read: async () => pdf });
    assert.ok(house.length);
    const original = getSourceDocument(db, house[0].sourceDocument.hash);
    assert.equal(original.encoding, "base64");
    assert.deepEqual(Buffer.from(original.content, "base64"), pdf);
    const html = fs.readFileSync(new URL("./fixtures/senate-6298991b.html", import.meta.url), "utf8");
    const senate = await efdLines(
      db,
      "/search/view/ptr/fixture/",
      { cookie: "test-cookie" },
      { read: async () => html },
    );
    assert.ok(senate.length);
    assert.equal(getSourceDocument(db, senate[0].sourceDocument.hash).content, html);
    db.prepare("DELETE FROM cache").run();
    assert.deepEqual(Buffer.from(getSourceDocument(db, house[0].sourceDocument.hash).content, "base64"), pdf);
  } finally {
    db.close();
  }
});
test("lobbying original response and symbol-grouped records are included in evidence export", async () => {
  const { fetchClientYear } = await import("../server/domain/corporate/lobbying.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    const response = {
      results: [
        {
          filing_uuid: "fixture",
          client: { name: "Example Co" },
          filing_year: 2025,
          filing_type: "Q1",
          dt_posted: "2025-04-01",
          expenses: 5000,
        },
      ],
      next: null,
    };
    const rows = await fetchClientYear(db, "Example Co", 2025, { read: async () => response });
    assert.equal(rows.length, 1);
    const files = { "fixture.mjs": "fixture" },
      engine = { id: hashOf(files), files };
    const run = getRun(
      db,
      putRun(db, { inputs: {}, result: { ok: true }, provenance: { records: { AAPL: rows } }, engine }),
    );
    const archive = archiveEvidence(db, run);
    assert.deepEqual(JSON.parse(archive.documents[rows[0].sourceDocument.hash].content), response);
    assert.equal(archive.documents[rows[0].sourceDocument.hash].mediaType, "application/json");
  } finally {
    db.close();
  }
});
test("contract signal feed archives its exact request and parsed response", async () => {
  const { contractFeed } = await import("../server/contracts.mjs");
  const prior = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = ":memory:";
  const db = openDb(decodeURIComponent(new URL("..", import.meta.url).pathname));
  if (prior === undefined) delete process.env.INTEL_CACHE;
  else process.env.INTEL_CACHE = prior;
  try {
    const response = {
      results: [
        { "Award ID": "fixture", "Recipient Name": "Example", "Action Date": "2025-01-01", "Transaction Amount": 5000 },
      ],
    };
    let requested;
    const result = await contractFeed(
      db,
      { days: 365, sort: "largest", fresh: true },
      {
        search: async (endpoint, request) => {
          assert.equal(endpoint, "spending_by_transaction");
          requested = request;
          return response;
        },
      },
    );
    assert.equal(result.ok, true);
    const original = JSON.parse(getSourceDocument(db, result.items[0].sourceDocument.hash).content);
    assert.deepEqual(original, { request: requested, response });
  } finally {
    db.close();
  }
});
