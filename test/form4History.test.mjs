import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../server/lib/db.mjs";
import { form4Picks, form4Rows, insiderHistory } from "../server/domain/positions/insiders.mjs";
import { slimSubmissions } from "../server/domain/positions/submissions.mjs";
import { form4Source } from "../server/domain/backtest/sources.mjs";
import { cleanFilters } from "../shared/backtestSpec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRK = { symbol: "BRK-B", cik: "0001067983" };
const ORCL = { symbol: "ORCL", cik: "0001341439" };
const line = (over = {}) => ({ date: "2025-03-03", code: "P", shares: 100, price: 80, ad: "A", owned: 1000, plan: false, ...over });
const pick = (accession, filed) => ({ accession, filed, doc: `xslF345X06/${accession}.xml` });

/** Berkshire's submissions list its own insiders' forms and the forms it files as an owner of Lennar shares. */
const SUBS = {
  "0001067983": { listStarts: "2024-11-01", complete: false, filings: { recent: {
    form: ["4", "8-K", "4", "4", "4"],
    accessionNumber: ["a-len-2", "x", "a-brk-1", "a-len-1", "a-old"],
    filingDate: ["2026-09-30", "2026-09-01", "2026-03-05", "2025-08-13", "2024-11-01"],
    primaryDocument: ["d", "d", "d", "d", "d"]
  } } },
  "0001341439": { listStarts: "2025-06-02", complete: true, filings: { recent: { form: ["4"], accessionNumber: ["a-orcl"], filingDate: ["2025-06-02"], primaryDocument: ["d"] } } }
};
const PARSED = {
  "a-len-2": { owner: "Berkshire Hathaway INC", title: "", issuerCik: "0000920760", issuerSymbol: "LEN", lines: [line(), line()] },
  "a-len-1": { owner: "Berkshire Hathaway INC", title: "", issuerCik: "0000920760", issuerSymbol: "LEN", lines: [line()] },
  "a-brk-1": { owner: "O'Sullivan Michael J.", title: "Director", issuerCik: "1067983", issuerSymbol: "BRK.B", lines: [line({ date: "2026-03-03", price: 480 })] },
  "a-orcl": { owner: "Rusckowski Stephen H", title: "Director", issuerCik: "0001341439", issuerSymbol: "ORCL", lines: [line({ date: "2025-05-30", price: 139 })] }
};

test("a Form 4 whose issuer is another company is not the filer's trade (Berkshire buying Lennar is not BRK-B)", () => {
  const other = form4Rows(BRK, pick("a-len-2", "2026-09-30"), PARSED["a-len-2"]);
  assert.equal(other.other, true);
  assert.deepEqual(other.rows, []);
  const own = form4Rows(BRK, pick("a-brk-1", "2026-03-05"), PARSED["a-brk-1"]);
  assert.equal(own.other, false, "the issuer CIK matches the filer whatever its zero padding");
  assert.equal(own.rows[0].symbol, "BRK-B", "the symbol comes from data/tickers.json, not the form's BRK.B");
  assert.equal(own.rows[0].side, "buy");
  assert.equal(own.rows[0].filed, "2026-03-05");
  const legacy = form4Rows(BRK, pick("a-brk-1", "2026-03-05"), { ...PARSED["a-brk-1"], issuerCik: "" });
  assert.equal(legacy.rows.length, 1, "a form with no issuer CIK is read as the filer's own");
});

test("form4Picks takes the window newest first, caps per issuer, and says where the SEC list starts", () => {
  const all = form4Picks(SUBS["0001067983"], { from: "2025-01-01", max: 60 });
  assert.deepEqual(all.picks.map((p) => p.accession), ["a-len-2", "a-brk-1", "a-len-1"]);
  assert.equal(all.listed, 3);
  assert.equal(all.listStarts, "2024-11-01");
  const capped = form4Picks(SUBS["0001067983"], { from: "2025-01-01", max: 1 });
  assert.equal(capped.picks.length, 1);
  assert.equal(capped.listed, 3);
  assert.deepEqual(form4Picks(SUBS["0001067983"], { from: "2025-01-01", to: "2026-06-30" }).picks.map((p) => p.accession), ["a-brk-1", "a-len-1"]);
  assert.equal(form4Picks(SUBS["0001067983"]).picks.length, 4, "the board's default: latest eight, any date");
});

test("slimSubmissions keeps the newest 200 filings plus every listed Form 4, and says whether older pages exist", () => {
  const n = 600;
  const form = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? "4" : "8-K"));
  const filingDate = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 8, 30) - i * 86_400_000).toISOString().slice(0, 10));
  const body = { name: "X", filings: { recent: { form, filingDate, accessionNumber: form.map((_, i) => `a${i}`), primaryDocument: form.map(() => "d") }, files: [{ name: "page2.json" }] } };
  const slim = slimSubmissions(body);
  assert.equal(slim.filings.recent.form.length, 333);
  assert.ok(slim.filings.recent.form.slice(200).every((f) => f === "4"));
  assert.equal(slim.listStarts, filingDate.at(-1));
  assert.equal(slim.complete, false);
  assert.equal(slimSubmissions({ filings: { recent: { form: ["4"], filingDate: ["2026-01-02"] }, files: [] } }).complete, true);
});

const subsOf = async (_db, cik) => SUBS[cik];
const read = async (_db, _cik, p) => PARSED[p.accession];

test("insiderHistory reads the window for every issuer and counts owner filings it does not attribute", async () => {
  const out = await insiderHistory(null, { from: "2025-01-01", tickers: [BRK, ORCL], subsOf, read });
  assert.deepEqual(out.items.map((r) => `${r.symbol}:${r.filed}`), ["BRK-B:2026-03-05", "ORCL:2025-06-02"]);
  assert.equal(out.otherIssuer, 2);
  assert.deepEqual(out.filings, { wanted: 4, read: 4, failed: 0, pending: 0, listingIncomplete: false });
  assert.equal(out.building, false);
  assert.deepEqual(out.coverage, { shortList: [], capped: [] });
  const late = await insiderHistory(null, { from: "2024-01-01", tickers: [BRK], subsOf, read, perIssuer: 2 });
  assert.deepEqual(late.coverage, { shortList: ["BRK-B"], capped: ["BRK-B"] });
});

test("insiderHistory at its deadline returns what it has and counts the rest as pending", async () => {
  const slow = (_db, _cik, p) => (p.accession === "a-orcl" ? new Promise((r) => setTimeout(() => r(PARSED[p.accession]), 200)) : Promise.resolve(PARSED[p.accession]));
  const out = await insiderHistory(null, { from: "2025-01-01", tickers: [BRK, ORCL], subsOf, read: slow, deadline: Date.now() + 40 });
  assert.equal(out.building, true);
  assert.equal(out.filings.pending, 1);
  assert.deepEqual(out.items.map((r) => r.symbol), ["BRK-B"]);
});

test("form4Source: owner filings, pending reads and coverage gaps become caveats; the run is not complete", async () => {
  process.env.INTEL_CACHE = ":memory:";
  const db = openDb(root);
  const history = (d, opts) => insiderHistory(d, { ...opts, tickers: [BRK, ORCL], subsOf, read, perIssuer: 2 });
  const src = await form4Source(db, cleanFilters({ from: "2024-01-01" }), { history });
  assert.deepEqual(src.signals.map((s) => s.symbol).sort(), ["BRK-B", "ORCL"]);
  assert.equal(src.building, false);
  const ids = src.context.notes.map((n) => n.id);
  for (const id of ["f4cover", "f4owner", "f4capped", "f4short", "f4plan"]) assert.ok(ids.includes(id), id);
  assert.match(src.context.notes.find((n) => n.id === "f4owner").text, /^1 Form 4s listed under a join-table company were filed by it as the owner/);
  const none = await form4Source(db, cleanFilters({ from: "2025-01-01" }), { history: async () => ({ items: [], errors: [], filings: { wanted: 9, read: 2, failed: 0, pending: 7 }, coverage: { shortList: [], capped: [] }, building: true }) });
  assert.match(none.error, /still being read from SEC EDGAR \(2 of 9 so far\)/);
  assert.equal(none.building, true);
});
