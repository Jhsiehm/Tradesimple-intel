import { test } from "node:test";
import assert from "node:assert/strict";
import { contractParentMatch, districtCode, ldaMatches, norm, pacsByOrg } from "../shared/names.mjs";
import { matchSeats } from "../server/congress.mjs";
import { coverage } from "../server/positions.mjs";

test("norm strips corporate suffixes, SEC state tags, share classes, and '&'", () => {
  assert.equal(norm("PROCTER & GAMBLE Co"), "PROCTER AND GAMBLE");
  assert.equal(norm("Procter and Gamble Company"), "PROCTER AND GAMBLE");
  assert.equal(norm("BANK OF AMERICA CORP /DE/"), "BANK OF AMERICA");
  assert.equal(norm("VERTEX PHARMACEUTICALS INC / MA"), "VERTEX PHARMACEUTICALS");
  assert.equal(norm("WELLS FARGO & COMPANY/MN"), "WELLS FARGO");
  assert.equal(norm("Alphabet Inc. (Class C)"), "ALPHABET");
  assert.equal(norm("The Walt Disney Company"), "WALT DISNEY");
  assert.equal(norm("JPMORGAN CHASE & CO"), "JPMORGAN CHASE");
});

test("norm keeps distinct companies distinct", () => {
  assert.notEqual(norm("General Motors Company"), norm("General Mills, Inc."));
  assert.notEqual(norm("American Express Co"), norm("American Electric Power Co"));
  assert.equal(norm("Group"), "GROUP", "a one-word name is never stripped to nothing");
});

test("ldaMatches accepts only exact normalized names and collapses variants", () => {
  const names = ["AGILENT TECHNOLOGIES", "Agilent Technologies, Inc.", "AGILENT TECHNOLOGIES FOUNDATION", "Keysight (formerly Agilent)"];
  assert.deepEqual(ldaMatches(names, ["AGILENT TECHNOLOGIES"]), ["AGILENT TECHNOLOGIES"]);
  assert.deepEqual(ldaMatches(["Oracle America"], ["ORACLE"]), [], "a subsidiary name is not the parent");
});

test("districtCode pads numbered seats and refuses at-large or delegate seats", () => {
  assert.equal(districtCode("CA", { BASENAME: "17" }), "CA-17");
  assert.equal(districtCode("ID", { BASENAME: "2" }), "ID-02");
  assert.equal(districtCode("DC", { BASENAME: "Delegate District (at Large)" }), null);
  assert.equal(districtCode("", { BASENAME: "5" }), null);
  assert.equal(districtCode("CA", null), null);
});

test("pacsByOrg keeps corporate PACs whose connected organization is the company", () => {
  const row = (id, name, type, orgType, org) => [id, name, "", "", "", "", "", "", "U", type, "", "Q", orgType, org, ""].join("|");
  const map = pacsByOrg([
    row("C00000001", "ACME CORP PAC", "Q", "C", "ACME CORPORATION"),
    row("C00000002", "ACME WORKERS UNION", "Q", "L", "ACME CORPORATION"),
    row("C00000003", "FRIENDS OF ACME", "O", "C", "ACME CORPORATION"),
    row("C00000004", "ACME INC EMPLOYEES", "N", "W", "Acme, Inc."),
    row("C00000005", "XY PAC", "Q", "C", "XY")
  ]);
  assert.deepEqual([...map.get("ACME")].sort(), ["C00000001", "C00000004"], "labor PACs and super PACs are excluded");
  assert.equal(map.has("XY"), false, "names under four letters are too ambiguous to join");
});

test("matchSeats finds the House member for a district code, never a senator", () => {
  const index = new Map([
    ["K000389", { name: "Khanna, Ro", state: "California", district: "17", party: "Democratic" }],
    ["S000033", { name: "Simpson, Mike", state: "Idaho", district: "2", party: "Republican" }],
    ["P000145", { name: "Padilla, Alex", state: "California", district: "", party: "Democratic" }]
  ]);
  assert.deepEqual(matchSeats(["CA-17", "ID-02", "CA-99", "junk"], index), [
    { code: "CA-17", members: [{ bioguide: "K000389", name: "Khanna, Ro", party: "Democratic", district: "CA-17" }] },
    { code: "ID-2", members: [{ bioguide: "S000033", name: "Simpson, Mike", party: "Republican", district: "ID-2" }] },
    { code: "CA-99", members: [] }
  ]);
});

test("coverage separates 'filed nothing' from 'never scanned'", () => {
  const scan = { scanned: ["AAPL", "AMD"], items: [] };
  const joined = { symbol: "AMD", core: true };
  assert.deepEqual(coverage(scan, "AMD", joined, "Form 4 scan"), { scanned: true, note: "" });
  assert.equal(coverage(scan, "MU", { symbol: "MU", core: true }, "Form 4 scan").scanned, false);
  assert.equal(coverage({ items: [] }, "AMD", joined, "Form 4 scan").scanned, false, "a failed or old-format scan cannot vouch for zero");
  assert.match(coverage(scan, "A", { symbol: "A", core: false }, "Form 4 scan").note, /quotes-only/);
  assert.match(coverage(scan, "ZZZZ", undefined, "Form 4 scan").note, /not in data\/tickers\.json/);
});

test("contractParentMatch: exact parent names, or a division suffix on multi-word names only", () => {
  assert.equal(contractParentMatch("LOCKHEED MARTIN", "LOCKHEED MARTIN CORPORATION"), true);
  assert.equal(contractParentMatch("LOCKHEED MARTIN", "LOCKHEED MARTIN SPACE"), true);
  assert.equal(contractParentMatch("APPLE", "APPLE INC."), true);
  assert.equal(contractParentMatch("APPLE", "APPLETON MARINE INC"), false);
  assert.equal(contractParentMatch("APPLE", "APPLE TEN ALABAMA SERVICES"), false);
  assert.equal(contractParentMatch("APPLE", "APPLE SERVICES"), false);
  assert.equal(contractParentMatch("GENERAL DYNAMICS", "GENERAL DYNAMICS LAND SYSTEMS"), false);
});
