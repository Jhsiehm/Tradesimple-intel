import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { openDb } from "../server/lib/db.mjs";
import { zipEntries, zipEntryLines } from "../server/lib/zip.mjs";
import { nextQuarter, parseDatasetLinks, parseFormIdx, parsedOf, quarterBounds, quarterOf, secDay, submissionOf, transLineOf, tsvReader } from "../server/parsers/form345.mjs";
import { ingestDailyIdx, ingestDatasetZip } from "../server/domain/positions/insiderIngest.mjs";
import { dropLease, joinsByCik, storeRows, storeStatus, takeLease } from "../server/domain/positions/insiderStore.mjs";
import { updateInsiderHistory } from "../server/jobs/insidersBackfill.mjs";
import { insiderHistory } from "../server/domain/positions/insiders.mjs";
import { form4Source } from "../server/domain/backtest/sources.mjs";
import { cleanFilters } from "../shared/backtestSpec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(root, "test", "fixtures", "form345");
const TABLES = ["SUBMISSION.tsv", "REPORTINGOWNER.tsv", "FOOTNOTES.tsv", "NONDERIV_TRANS.tsv"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "insider-store-test-"));

/** A zip of the given { name: text } entries; `stored` names are written uncompressed, the rest deflated. */
function writeZip(file, entries, stored = []) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text);
    const method = stored.includes(name) ? 0 : 8;
    const data = method ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cdBuf, end]));
  return file;
}

const fixture = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const headerOnly = (name) => `${fixture(name).split("\n")[0]}\n`;
const quarterZip = writeZip(path.join(tmp, "2025q1.zip"), Object.fromEntries(TABLES.map((t) => [t, fixture(t)])), ["FOOTNOTES.tsv"]);
const emptyZip = writeZip(path.join(tmp, "2024q4.zip"), Object.fromEntries(TABLES.map((t) => [t, headerOnly(t)])));

function freshDb() {
  process.env.INTEL_CACHE = ":memory:";
  return openDb(root);
}

const T = (symbol, cik) => ({ symbol, cik });
const JPM = T("JPM", "0000019617");
const GOOG = T("GOOG", "0001652044");
const GOOGL = T("GOOGL", "0001652044");
const line = (over = {}) => ({ date: "2025-03-31", code: "P", shares: 10, price: 100, ad: "A", owned: 10, plan: false, ...over });
/** What the live Form 4 reader returns for the daily-index accessions (and the tail after the store's coverage). */
const PARSED = {
  "0000019617-25-000011": { owner: "Dimon James", title: "Chairman and CEO", issuerCik: "19617", issuerSymbol: "JPM", lines: [line({ date: "2025-03-28" })] },
  "0001193125-25-000012": { owner: "Berkshire Hathaway INC", title: "10% owner", issuerCik: "0000920760", issuerSymbol: "LEN", lines: [line({ price: 81 })] },
  "0001652044-25-000013": { owner: "Pichai Sundar", title: "Director", issuerCik: "1652044", issuerSymbol: "GOOGL", lines: [line({ code: "S", plan: true })] },
  "0000019617-25-000020": { owner: "Smith Jane", title: "CFO", issuerCik: "19617", issuerSymbol: "JPM", lines: [line({ date: "2025-04-03", price: 240 })] }
};
const read = async (_db, _cik, pick) => {
  if (!PARSED[pick.accession]) throw new Error(`unexpected read ${pick.accession}`);
  return PARSED[pick.accession];
};

test("form345 parser: dates, quarters, links on both SEC paths, header-keyed rows, form.idx", () => {
  assert.equal(secDay("28-SEP-2026"), "2026-09-28");
  assert.equal(secDay("20261001"), "2026-10-01");
  assert.equal(secDay("2026-10-01"), "2026-10-01");
  assert.equal(secDay("Sept 1"), "");
  assert.equal(quarterOf("2026-10-09"), "2026q4");
  assert.deepEqual(quarterBounds("2024q1"), { from: "2024-01-01", to: "2024-03-31" });
  assert.equal(nextQuarter("2025q4"), "2026q1");
  const links = parseDatasetLinks(`<a href="/files/datastandardsinnovation/data/insider-transactions-data-sets/2026q2_form345.zip">x</a>
    <a href="/files/structureddata/data/insider-transactions-data-sets/2026q1_form345.zip">y</a>
    <a href="/files/datastandardsinnovation/data/insider-transactions-data-sets/2026q2_form345.zip">dup</a>`);
  assert.deepEqual(links, [
    { quarter: "2026q1", url: "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/2026q1_form345.zip" },
    { quarter: "2026q2", url: "https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets/2026q2_form345.zip" }
  ]);
  const [head, ...rows] = fixture("SUBMISSION.tsv").trim().split("\n");
  const subs = rows.map(tsvReader(head)).map(submissionOf);
  assert.deepEqual(subs[0], { accession: "0000019617-25-000001", filed: "2025-03-03", form: "4", issuerCik: 19617, issuerSymbol: "JPM", checked: false });
  assert.equal(subs[1].checked, true, "AFF10B5ONE = 1");
  assert.equal(subs[2].checked, false, "blank AFF10B5ONE (before 2023) is unchecked");
  assert.equal(subs[4].form, "4/A");
  const idx = parseFormIdx(fixture("form.20250401.idx"));
  assert.deepEqual(idx.map((e) => `${e.form}:${e.cik}:${e.accession}`), [
    "4:19617:0000019617-25-000002", "4:19617:0000019617-25-000011", "4:1195345:0000019617-25-000011",
    "4:1067983:0001193125-25-000012", "4/A:1652044:0001652044-25-000013", "4:99999:0000099999-25-000014"
  ], "Form 3 and SC 13G/A are skipped; a form listed under owner and issuer appears twice");
  assert.equal(idx[0].filed, "2025-04-01");
});

test("a line's 10b5-1 flag follows a plan footnote it cites, else the form's checkbox", () => {
  const [head, ...rows] = fixture("NONDERIV_TRANS.tsv").trim().split("\n");
  const lines = rows.map(tsvReader(head)).map(transLineOf);
  const goog = lines.filter((l) => l.sk === 40 || l.sk === 41);
  const byNote = parsedOf({ checked: true, issuerCik: 1652044, issuerSymbol: "GOOGL" }, { owner: "Pichai Sundar", title: "Director" }, goog, new Set(["F2"]));
  assert.deepEqual(byNote.lines.map((l) => l.plan), [true, false], "F2 names the plan; the F3 line is not a plan trade even with the box checked");
  assert.equal(byNote.plan10b5, true);
  const byBox = parsedOf({ checked: true, issuerCik: 19617 }, null, [lines[2]]);
  assert.deepEqual(byBox.lines.map((l) => l.plan), [true]);
  const jpm = parsedOf({ checked: false, issuerCik: 19617 }, null, lines.filter((l) => l.sk === 11 || l.sk === 12));
  assert.deepEqual(jpm.lines.map((l) => l.code), ["A", "P"], "document order by surrogate key");
  assert.equal(jpm.lines[1].price, 250.12);
});

test("zip reader streams stored and deflated entries line by line", async () => {
  assert.deepEqual(zipEntries(quarterZip).map((e) => `${e.name}:${e.method}`), ["SUBMISSION.tsv:8", "REPORTINGOWNER.tsv:8", "FOOTNOTES.tsv:0", "NONDERIV_TRANS.tsv:8"]);
  const got = [];
  for await (const l of zipEntryLines(quarterZip, "FOOTNOTES.tsv")) got.push(l);
  assert.equal(got.length, 5);
  assert.match(got[3], /^0001652044-25-000004\tF3\t/);
});

test("ingesting a quarter joins issuers through data/tickers.json, keeps 4/A apart, drops Form 3 and unjoined issuers", async () => {
  const db = freshDb();
  const got = await ingestDatasetZip(db, quarterZip, joinsByCik(db));
  assert.deepEqual(got, { forms: 5, amendments: 1, lines: 7, rows: 9 });
  const all = storeRows(db, { amendments: true }).items;
  assert.ok(!all.some((r) => r.accession.startsWith("0000099999")), "an issuer outside tickers.json is not stored");
  assert.ok(!all.some((r) => r.accession === "0000019617-25-000007"), "Form 3 is not stored");
  const len = all.find((r) => r.symbol === "LEN");
  assert.equal(len.person, "Berkshire Hathaway INC", "the first reporting owner names the row");
  assert.equal(len.title, "10% owner");
  assert.equal(len.side, "buy");
  assert.equal(len.value, 805000);
  assert.equal(len.link, "https://www.sec.gov/Archives/edgar/data/920760/000119312525000003/0001193125-25-000003-index.htm");
  const goog = all.filter((r) => r.accession === "0001652044-25-000004");
  assert.deepEqual(goog.map((r) => `${r.symbol}:${r.plan}`).sort(), ["GOOG:false", "GOOG:true", "GOOGL:false", "GOOGL:true"], "one CIK, two join-table tickers");
  const dimon = all.filter((r) => r.accession === "0000019617-25-000001");
  assert.deepEqual(dimon.map((r) => r.id), ["f4-JPM-0000019617-25-000001-0", "f4-JPM-0000019617-25-000001-1"]);
  assert.equal(dimon[1].title, "Chairman and CEO");
  assert.equal(dimon[1].lag, 3);
  const plain = storeRows(db, { symbols: ["JPM"] });
  assert.equal(plain.amended, 1);
  assert.ok(plain.items.every((r) => r.form === "4"), "4/A lines are left out unless asked for");
  assert.deepEqual(storeRows(db, { from: "2025-03-04", to: "2025-03-10", symbols: ["JPM", "LEN"] }).items.map((r) => r.accession), ["0001193125-25-000003", "0000019617-25-000002"]);
  const again = await ingestDatasetZip(db, quarterZip, joinsByCik(db));
  assert.equal(again.rows, 9);
  assert.equal(storeRows(db, { amendments: true }).items.length, 9, "re-reading a quarter replaces its forms, never duplicates them");
});

test("daily index: forms already stored are not read, owner-listed forms go to their issuer, the data set replaces daily rows", async () => {
  const db = freshDb();
  const { byCik } = joinsByCik(db);
  await ingestDatasetZip(db, quarterZip, { byCik });
  const reads = [];
  const out = await ingestDailyIdx(db, fixture("form.20250401.idx"), { byCik, read: async (d, c, p) => { reads.push(p); return read(d, c, p); } });
  assert.deepEqual(out, { listed: 4, known: 1, read: 3, failed: 0, forms: 3, rows: 4 });
  assert.deepEqual(reads.map((p) => p.doc).sort(), ["0000019617-25-000011.txt", "0001193125-25-000012.txt", "0001652044-25-000013.txt"]);
  const daily = storeRows(db, { amendments: true }).items.filter((r) => r.source === "daily");
  assert.deepEqual(daily.map((r) => `${r.symbol}:${r.form}`).sort(), ["GOOG:4/A", "GOOGL:4/A", "JPM:4", "LEN:4"], "Berkshire's form lands on LEN, not BRK-B");
  const later = writeZip(path.join(tmp, "2025q2.zip"), {
    "SUBMISSION.tsv": `${headerOnly("SUBMISSION.tsv")}0000019617-25-000011\t01-APR-2025\t28-MAR-2025\t4\t0000019617\tJPMORGAN CHASE & CO\tJPM\t0\n`,
    "REPORTINGOWNER.tsv": `${headerOnly("REPORTINGOWNER.tsv")}0000019617-25-000011\t0001195345\tDIMON JAMES\tDirector,Officer\tChairman and CEO\n`,
    "FOOTNOTES.tsv": headerOnly("FOOTNOTES.tsv"),
    "NONDERIV_TRANS.tsv": `${headerOnly("NONDERIV_TRANS.tsv")}0000019617-25-000011\t70\tCommon Stock\t28-MAR-2025\tP\t10.0\t\t100.0\t\tA\t10.0\n`
  });
  await ingestDatasetZip(db, later, { byCik });
  const acc = storeRows(db).items.filter((r) => r.accession === "0000019617-25-000011");
  assert.deepEqual(acc.map((r) => `${r.symbol}:${r.source}`), ["JPM:dataset"], "same form once, now from the data set");
  const rerun = await ingestDailyIdx(db, fixture("form.20250401.idx"), { byCik, read });
  assert.equal(rerun.read, 0, "a second pass over the same day reads nothing");
});

test("backfill job: resumable by quarter, then daily days after the newest quarter; a held lease skips the pass", async () => {
  const db = freshDb();
  const calls = { download: [], dailyIdx: 0 };
  let failOnce = true;
  const io = {
    page: async () => `<a href="/files/structureddata/data/insider-transactions-data-sets/2024q4_form345.zip"></a><a href="/files/structureddata/data/insider-transactions-data-sets/2025q1_form345.zip"></a><a href="/files/structureddata/data/insider-transactions-data-sets/2019q4_form345.zip"></a>`,
    download: async (url, file) => {
      const q = /(\d{4}q\d)_form345/.exec(url)[1];
      calls.download.push(q);
      if (q === "2024q4" && failOnce) { failOnce = false; throw new Error("HTTP 503"); }
      fs.copyFileSync(q === "2024q4" ? emptyZip : quarterZip, file);
      return fs.statSync(file).size;
    },
    dailyNames: async (year, n) => (year === "2025" && n === "2" ? ["form.20250401.idx"] : []),
    dailyIdx: async () => { calls.dailyIdx += 1; return fixture("form.20250401.idx"); },
    read
  };
  const opts = { since: "2024q4", io, dir: tmp, today: "2025-04-02", owner: "test-a" };
  const first = await updateInsiderHistory(db, opts);
  assert.deepEqual(calls.download, ["2024q4", "2025q1"]);
  assert.match(first.errors[0], /2024q4: HTTP 503/);
  assert.equal(storeStatus(db).coveredFrom, null, "a gap at the start means no covered span yet");
  assert.equal(calls.dailyIdx, 0);
  const second = await updateInsiderHistory(db, opts);
  assert.deepEqual(calls.download, ["2024q4", "2025q1", "2024q4"], "only the failed quarter is fetched again");
  assert.deepEqual(second.errors, []);
  assert.equal(second.coveredFrom, "2024-10-01");
  assert.equal(second.coveredThrough, "2025-04-01");
  const s = storeStatus(db);
  assert.equal(s.quarters.count, 2);
  assert.equal(s.days.count, 1);
  assert.equal(s.datasetThrough, "2025-03-31");
  assert.equal(s.rows, 13);
  assert.deepEqual(s.bySource, { dataset: 9, daily: 4 });
  await updateInsiderHistory(db, opts);
  assert.equal(calls.download.length, 3, "nothing new: no download");
  assert.equal(calls.dailyIdx, 1, "nothing new: no daily read");
  assert.ok(fs.readdirSync(tmp).every((f) => !f.startsWith("tradesimple-")), "downloaded zips are deleted");
  assert.ok(takeLease(db, "test-b", 60_000));
  assert.match((await updateInsiderHistory(db, opts)).skipped, /another insider-history update/);
  dropLease(db, "test-b");
});

test("insiderHistory reads the store through its coverage, live submissions after it, with no per-issuer cap", async () => {
  const db = freshDb();
  const io = {
    page: async () => `<a href="/x/2025q1_form345.zip"></a>`,
    download: async (_u, file) => { fs.copyFileSync(quarterZip, file); return 1; },
    dailyNames: async (y, n) => (y === "2025" && n === "2" ? ["form.20250401.idx"] : []),
    dailyIdx: async () => fixture("form.20250401.idx"),
    read
  };
  await updateInsiderHistory(db, { since: "2025q1", io, dir: tmp, today: "2025-04-02", owner: "test-c" });
  const subs = { filings: { recent: { form: ["4", "4"], accessionNumber: ["0000019617-25-000020", "0000019617-25-000002"], filingDate: ["2025-04-05", "2025-03-05"], primaryDocument: ["d", "d"] } } };
  const subsOf = async (_db, cik) => (Number(cik) === 19617 ? subs : { filings: { recent: { form: [], accessionNumber: [], filingDate: [], primaryDocument: [] } } });
  const out = await insiderHistory(db, { from: "2025-01-01", tickers: [JPM, GOOG, GOOGL], subsOf, read, perIssuer: 1 });
  assert.deepEqual([...new Set(out.items.map((r) => r.accession))], ["0000019617-25-000020", "0000019617-25-000011", "0001652044-25-000004", "0000019617-25-000002", "0000019617-25-000001"]);
  assert.equal(out.items.find((r) => r.accession === "0000019617-25-000020").source, undefined, "the tail row comes from the live path");
  assert.deepEqual(out.coverage, { shortList: [], capped: [] });
  assert.equal(out.store.amended, 3, "the JPM 4/A line and the GOOG/GOOGL 4/A lines are counted, not listed");
  assert.equal(out.store.windowForms, 4, "forms read from the store for this window");
  assert.equal(out.store.forms, 8, "the store's own total (5 data-set forms + 3 daily) is not replaced by the window's");
  assert.match(out.source, /^SEC Insider Transactions Data Sets \(quarterly\) \+ EDGAR daily index \+ SEC EDGAR Form 4/);
  assert.match(out.coverageNote, /No per-issuer cap; 3 lines on 4\/A amendments are left out/);
  const jpmOnly = await insiderHistory(db, { from: "2025-01-01", to: "2025-03-31", symbols: ["JPM"], tickers: [JPM, GOOG], subsOf: async () => { throw new Error("no live read for a window inside the store"); }, read });
  assert.deepEqual([...new Set(jpmOnly.items.map((r) => r.symbol))], ["JPM"]);
  assert.equal(jpmOnly.source, "SEC Insider Transactions Data Sets (quarterly) + EDGAR daily index");
  const early = await insiderHistory(db, { from: "2019-06-01", to: "2025-03-31", tickers: [JPM], subsOf, read });
  assert.match(early.coverageNote, /The store starts 2025-01-01; Form 4s filed before that are not here\./);
  const src = await form4Source(db, cleanFilters({ from: "2025-01-01", to: "2025-03-31" }), { history: (d, o) => insiderHistory(d, { ...o, tickers: [JPM, GOOG, GOOGL], subsOf, read }) });
  const ids = src.context.notes.map((n) => n.id);
  assert.ok(!ids.includes("f4capped") && !ids.includes("f4short"));
  assert.match(src.context.notes.find((n) => n.id === "f4cover").text, /^Form 4 history: every Form 4 filed 2025-01-01 to 2025-03-31 for 3 join-table issuers/);
  assert.deepEqual(src.signals.map((s) => `${s.symbol}:${s.side}`).sort(), ["GOOG:sell", "GOOGL:sell", "JPM:buy"], "10b5-1 lines and the grant are excluded; the 4/A is not a second JPM buy");
});
