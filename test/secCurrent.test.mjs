import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT_FEEDS, cikIndex, currentUrl, groupFilings, headerPeriod, latencyNote, latencyStats, matchFilings, needsNextPage, newestAccepted, parseCurrentAtom } from "../shared/secCurrent.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (f) => fs.readFileSync(path.join(dir, f), "latin1");
const ATOM = { "4": read("edgar-current-4.atom"), "8-K": read("edgar-current-8k.atom"), "SCHEDULE 13D": "<feed></feed>", "SCHEDULE 13G": read("edgar-current-13g.atom") };
const feed = (id) => CURRENT_FEEDS.find((f) => f.id === id);

test("currentUrl asks for the Atom output, with paging", () => {
  const u = new URL(currentUrl("SCHEDULE 13D", { start: 100 }));
  assert.equal(u.host, "www.sec.gov");
  assert.equal(u.searchParams.get("action"), "getcurrent");
  assert.equal(u.searchParams.get("type"), "SCHEDULE 13D");
  assert.equal(u.searchParams.get("owner"), "include");
  assert.equal(u.searchParams.get("output"), "atom");
  assert.equal(u.searchParams.get("start"), "100");
  assert.equal(u.searchParams.get("count"), "100");
});

test("parses a real getcurrent page: form, party, CIK, accession, acceptance time to the second", () => {
  const { entries, updated, skipped } = parseCurrentAtom(ATOM["4"]);
  assert.equal(skipped, 0);
  assert.equal(updated, "2026-10-09T14:29:59.000Z");
  const prothena = entries.find((e) => e.name.startsWith("PROTHENA"));
  assert.deepEqual(prothena, {
    form: "4",
    name: "PROTHENA CORP PUBLIC LTD CO",
    cik: "0001559053",
    role: "Issuer",
    accession: "0001045463-26-000020",
    acceptedAt: "2026-10-09T13:43:09.000Z",
    filed: "2026-10-09",
    link: "https://www.sec.gov/Archives/edgar/data/1559053/000104546326000020/0001045463-26-000020-index.htm",
    items: []
  });
  // type=4 is a prefix match upstream; 424B2 rows are in the page but not in the Form 4 filings.
  assert.ok(entries.some((e) => e.form === "424B2"));
  assert.ok(groupFilings(entries, feed("form4").forms).every((f) => f.form === "4"));
});

test("8-K items come from the summary; entities decode", () => {
  const { entries } = parseCurrentAtom(ATOM["8-K"]);
  const it = entries.find((e) => e.name === "IT TECH PACKAGING, INC.");
  assert.deepEqual(it.items, ["3.01", "9.01"]);
  assert.equal(it.role, "Filer");
});

test("issuer matching: Form 4 on the Issuer entry, 13G on the Subject, never the filer side", () => {
  const index = cikIndex([{ symbol: "PRTA", cik: "0001559053" }, { symbol: "SABA", cik: "0001510281" }, { symbol: "UHS", cik: "0000352915" }, { symbol: "DIM", cik: "0000354204" }]);
  const f4 = matchFilings(groupFilings(parseCurrentAtom(ATOM["4"]).entries, feed("form4").forms), feed("form4"), index);
  assert.deepEqual(f4.map((m) => [m.symbol, m.filing.accession, m.filer?.name]), [["PRTA", "0001045463-26-000020", "SCULLY WILLIAM P"]], "Saba is only ever the reporting owner");
  const g = matchFilings(groupFilings(parseCurrentAtom(ATOM["SCHEDULE 13G"]).entries, feed("13g").forms), feed("13g"), index);
  assert.deepEqual(g.map((m) => [m.symbol, m.filer?.name]), [["UHS", "DIMENSIONAL FUND ADVISORS LP"]], "Dimensional filed it; UHS is the subject");
});

test("paging: only when the page is full and still newer than the last poll", () => {
  const e = (t) => ({ acceptedAt: new Date(t).toISOString() });
  const page = Array.from({ length: 100 }, (_, i) => e(1_000_000 + i * 1000));
  assert.equal(needsNextPage(page, 0), false, "first poll reads one page");
  assert.equal(needsNextPage(page, 999_000), true);
  assert.equal(needsNextPage(page, 1_050_000), false);
  assert.equal(needsNextPage(page.slice(0, 40), 999_000), false, "a short page is the whole feed");
  assert.equal(newestAccepted(page), 1_099_000);
});

test("latency stats and label", () => {
  const s = latencyStats([30_000, 40_000, 50_000, 60_000, 300_000]);
  assert.equal(s.n, 5);
  assert.equal(s.medianMs, 50_000);
  assert.equal(s.p90Ms, 300_000);
  assert.equal(latencyNote(s), "detected a median 50 s after EDGAR acceptance (p90 5 min, 5 filings)");
  assert.equal(latencyNote(latencyStats([])), "");
  assert.equal(headerPeriod("<SEC-HEADER>\n<PERIOD>20261008\n<ITEMS>5.02"), "2026-10-08");
  assert.equal(headerPeriod("CONFORMED PERIOD OF REPORT:\t20261007"), "2026-10-07");
});
