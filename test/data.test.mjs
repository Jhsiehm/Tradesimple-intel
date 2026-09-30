// Integrity of the hand-edited and derived data files. These fail when a bad edit would put a wrong join on screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const tickers = read("tickers.json");
const chain = read("supplychain.json");

test("tickers.json: unique symbols with SEC CIKs", () => {
  const seen = new Set();
  for (const t of tickers) {
    assert.ok(!seen.has(t.symbol), `duplicate ${t.symbol}`);
    seen.add(t.symbol);
    assert.match(t.symbol, /^[A-Z][A-Z.\-]{0,6}$/, `${t.symbol} symbol format`);
    if (t.cik) assert.match(t.cik, /^\d{10}$/, `${t.symbol} CIK must be 10 digits`);
  }
});

test("tickers.json: district codes use ST-NN and coordinates are in range", () => {
  for (const t of tickers) {
    for (const d of t.districts) assert.match(d, /^[A-Z]{2}-\d{2}$/, `${t.symbol} district ${d}`);
    if (t.lat != null) assert.ok(t.lat > 17 && t.lat < 72 && t.lon > -180 && t.lon < -60, `${t.symbol} lat/lon outside the US`);
  }
});

test("tickers.json: quotes-only rows carry no joins; derived rows say how they were joined", () => {
  for (const t of tickers) {
    if (t.core === false) {
      assert.deepEqual([t.ldaClients, t.pacs, t.districts, t.recipients], [[], [], [], []], `${t.symbol} is quotes-only but has joins`);
    }
    if (t.joinBasis?.auto) {
      assert.equal(t.core, true, `${t.symbol} derived but not full-join`);
      for (const k of ["district", "lda", "pacs", "recipients", "derived"]) assert.ok(t.joinBasis[k], `${t.symbol} joinBasis.${k} missing`);
    }
    for (const id of t.pacs) assert.match(id, /^C\d{8}$/, `${t.symbol} PAC id ${id}`);
  }
});

test("supplychain.json: every edge cites its basis and every segment input is a listed supplier", () => {
  for (const [symbol, entry] of Object.entries(chain)) {
    if (symbol.startsWith("_")) continue;
    const suppliers = new Set(entry.suppliers.map((s) => s.symbol));
    for (const edge of [...entry.suppliers, ...entry.customers]) {
      assert.ok(edge.symbol && edge.name && edge.what, `${symbol}: incomplete edge ${JSON.stringify(edge)}`);
      assert.ok(edge.basis?.trim(), `${symbol} → ${edge.symbol}: missing basis`);
    }
    for (const seg of entry.segments) {
      for (const input of seg.inputs) assert.ok(suppliers.has(input), `${symbol} segment "${seg.name}" uses ${input}, which is not in its suppliers`);
    }
  }
});
