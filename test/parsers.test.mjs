// Known filings, checked by hand against the original documents in test/fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseEfd, parseForm4, parsePtrPdf } from "../server/positions.mjs";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const pick = (line) => ({ symbol: line.symbol, owner: line.owner, type: line.type, side: line.side, traded: line.traded, amount: line.amount });

test("House PTR 20035420 (Byron Donalds, FL-19): self and spouse lines, partial sales", async () => {
  const lines = await parsePtrPdf(new Uint8Array(fs.readFileSync(fixture("house-20035420.pdf"))));
  const range = "$1,001 - $15,000";
  assert.deepEqual(lines.map(pick), [
    { symbol: "HWM", owner: "Self", type: "Sale (partial)", side: "sell", traded: "2026-08-11", amount: range },
    { symbol: "HWM", owner: "Spouse", type: "Sale (partial)", side: "sell", traded: "2026-08-11", amount: range },
    { symbol: "NFLX", owner: "Spouse", type: "Purchase", side: "buy", traded: "2026-08-12", amount: range },
    { symbol: "NFLX", owner: "Self", type: "Purchase", side: "buy", traded: "2026-08-12", amount: range },
    { symbol: "PH", owner: "Self", type: "Sale (partial)", side: "sell", traded: "2026-08-11", amount: range },
    { symbol: "PH", owner: "Spouse", type: "Sale (partial)", side: "sell", traded: "2026-08-11", amount: range }
  ]);
  assert.equal(lines[0].notified, "2026-09-01");
  assert.equal(lines[0].amountLow, 1001);
  assert.match(lines[2].asset, /^Netflix, Inc\. - Common Stock/);
  assert.equal(lines[0].assetType, "ST");
});

test("House PTR 20035432 (August Pfluger, TX-11): dependent-child exchanges, description lines ignored", async () => {
  const lines = await parsePtrPdf(new Uint8Array(fs.readFileSync(fixture("house-20035432.pdf"))));
  assert.deepEqual(lines.map((l) => [l.symbol, l.owner, l.type, l.side, l.traded]), [
    ["CHTR", "Dependent", "Exchange", "exchange", "2026-08-20"],
    ["CHTR", "Self", "Exchange", "exchange", "2026-08-20"],
    ["LBRDK", "Self", "Exchange", "exchange", "2026-08-20"],
    ["LBRDK", "Dependent", "Exchange", "exchange", "2026-08-20"]
  ]);
  for (const line of lines) assert.doesNotMatch(line.asset, /merger|:/, "filing-status and description rows must not leak into the asset name");
});

test("Senate eFD PTR 6298991b: joint sales, full vs partial, HTML entities decoded", () => {
  const lines = parseEfd(fs.readFileSync(fixture("senate-6298991b.html"), "utf8"));
  assert.deepEqual(lines.map((l) => [l.symbol, l.owner, l.type, l.side, l.traded, l.amount]), [
    ["IVV", "Joint", "Sale (Partial)", "sell", "2026-08-27", "$1,001 - $15,000"],
    ["JNJ", "Joint", "Sale (Partial)", "sell", "2026-08-20", "$1,001 - $15,000"],
    ["WWSYX", "Joint", "Sale (Full)", "sell", "2026-08-19", "$15,001 - $50,000"],
    ["CEG", "Joint", "Sale (Partial)", "sell", "2026-08-13", "$1,001 - $15,000"]
  ]);
  assert.equal(lines[0].asset, "iShares Core S&P 500 ETF");
  assert.equal(lines[1].asset, "Johnson & Johnson Common Stock");
  assert.equal(lines[2].amountLow, 15001);
});

test("Senate eFD page without a transaction table is an error, not an empty report", () => {
  assert.throws(() => parseEfd("<html><body>Session expired</body></html>"), /no table/);
});

test("Form 4 0000002488-26-000165 (AMD, Ava Hahn): 10b5-1 sale with footnoted shares", () => {
  const f = parseForm4(fs.readFileSync(fixture("form4-0000002488-26-000165.xml"), "utf8"));
  assert.equal(f.owner, "Hahn Ava");
  assert.equal(f.title, "SVP, GC & Corporate Secretary");
  assert.deepEqual(f.lines, [{ date: "2026-08-18", code: "S", shares: 2993, price: 488.69, ad: "D", owned: 26623, plan: true }]);
  assert.equal(f.plan10b5, true);
  assert.equal(f.issuerCik, "0000002488");
  assert.equal(f.issuerSymbol, "AMD");
});

test("Form 4 10b5-1: footnote references mark lines; the checkbox covers filings without a plan footnote", () => {
  const xml = fs.readFileSync(fixture("form4-0000002488-26-000165.xml"), "utf8");
  const block = /<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/.exec(xml)[0];
  const unfooted = block.replace(/<footnoteId id="F1"\/>/, "").replace("<value>2993</value>", "<value>100</value>");
  const two = parseForm4(xml.replace(block, block + unfooted));
  assert.deepEqual(two.lines.map((l) => l.plan), [true, false], "only the footnoted line is planned");
  const boxOnly = parseForm4(xml.replace(/<footnote id="F1">[^<]*<\/footnote>/, '<footnote id="F1">Weighted average price.</footnote>'));
  assert.equal(boxOnly.plan10b5, true);
  assert.equal(boxOnly.lines[0].plan, true, "aff10b5One with no plan footnote marks every line");
  const none = parseForm4(xml.replace("<aff10b5One>1</aff10b5One>", "<aff10b5One>0</aff10b5One>").replace(/<footnote id="F1">[^<]*<\/footnote>/, ""));
  assert.equal(none.plan10b5, false);
  assert.equal(none.lines[0].plan, false);
});
