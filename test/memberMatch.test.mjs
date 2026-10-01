import { test } from "node:test";
import assert from "node:assert/strict";
import { matchMembers } from "../shared/memberMatch.mjs";

const roster = [
  { bioguide: "B001288", name: "Cory A. Booker", first: "Cory", last: "Booker", nickname: "", state: "NJ", district: "", chamber: "senate" },
  { bioguide: "K000394", name: "Andy Kim", first: "Andy", last: "Kim", nickname: "", state: "NJ", district: "", chamber: "senate" },
  { bioguide: "M001226", name: "Robert Menendez", first: "Robert", last: "Menendez", nickname: "Rob", state: "NJ", district: "8", chamber: "house" },
  { bioguide: "M001216", name: "Cory Mills", first: "Cory", last: "Mills", nickname: "", state: "FL", district: "7", chamber: "house" },
  { bioguide: "P000197", name: "Nancy Pelosi", first: "Nancy", last: "Pelosi", nickname: "", state: "CA", district: "11", chamber: "house" },
  { bioguide: "O000172", name: "Alexandria Ocasio-Cortez", first: "Alexandria", last: "Ocasio-Cortez", nickname: "", state: "NY", district: "14", chamber: "house" },
  { bioguide: "S000033", name: "Bernard Sanders", first: "Bernard", last: "Sanders", nickname: "Bernie", state: "VT", district: "", chamber: "senate" },
  { bioguide: "C000880", name: "Mike Crapo", first: "Michael", last: "Crapo", nickname: "Mike", state: "ID", district: "", chamber: "senate" },
  { bioguide: "S001217", name: "Rick Scott", first: "Richard", last: "Scott", nickname: "Rick", state: "FL", district: "", chamber: "senate" }
];

const ids = (q, limit) => matchMembers(roster, q, limit).map((m) => m.bioguide);

test("full name finds a senator even though the official name has a middle initial", () => {
  assert.equal(ids("cory booker")[0], "B001288");
  assert.equal(ids("Cory Booker")[0], "B001288");
  assert.equal(ids("booker cory")[0], "B001288");
  assert.equal(ids("cory a. booker")[0], "B001288");
  assert.deepEqual(ids("cory booker"), ["B001288"]);
});

test("last name, first name, and partial words", () => {
  assert.deepEqual(ids("booker"), ["B001288"]);
  assert.deepEqual(ids("book"), ["B001288"]);
  assert.deepEqual(ids("cory").sort(), ["B001288", "M001216"]);
  assert.equal(ids("cory")[0], "B001288", "senators break ties ahead of House members");
  assert.deepEqual(ids("pelosi"), ["P000197"]);
  assert.deepEqual(ids("nancy pel"), ["P000197"]);
});

test("hyphenated last names match either half or joined, and initials as a last resort", () => {
  assert.deepEqual(ids("ocasio"), ["O000172"]);
  assert.deepEqual(ids("cortez"), ["O000172"]);
  assert.deepEqual(ids("ocasio-cortez"), ["O000172"]);
  assert.deepEqual(ids("ocasiocortez"), ["O000172"]);
  assert.deepEqual(ids("aoc"), ["O000172"]);
});

test("nicknames and formal first names both match", () => {
  assert.deepEqual(ids("bernie sanders"), ["S000033"]);
  assert.deepEqual(ids("bernard"), ["S000033"]);
  assert.deepEqual(ids("michael crapo"), ["C000880"]);
  assert.deepEqual(ids("mike crapo"), ["C000880"]);
});

test("state codes list that delegation, senators first; district codes find the seat", () => {
  assert.deepEqual(ids("NJ"), ["B001288", "K000394", "M001226"]);
  assert.deepEqual(ids("nj"), ["B001288", "K000394", "M001226"]);
  assert.deepEqual(ids("NJ-08"), ["M001226"]);
  assert.deepEqual(ids("fl-7"), ["M001216"]);
  assert.deepEqual(ids("booker nj"), ["B001288"]);
  assert.deepEqual(ids("cory fl"), ["M001216"]);
});

test("bioguide ids, limits, and no-match queries", () => {
  assert.deepEqual(ids("B001288"), ["B001288"]);
  assert.equal(ids("cory", 1).length, 1);
  assert.deepEqual(ids("zzzz"), []);
  assert.deepEqual(ids("   "), []);
  assert.deepEqual(ids("booker smith"), []);
});

test("a lone short word needs three letters before prefix or initials matching", () => {
  assert.deepEqual(ids("am"), []);
  assert.deepEqual(ids("pe"), []);
  assert.deepEqual(ids("pel"), ["P000197"]);
  assert.deepEqual(ids("nancy pe"), ["P000197"]);
  assert.deepEqual(ids("cory bo"), ["B001288"]);
});
