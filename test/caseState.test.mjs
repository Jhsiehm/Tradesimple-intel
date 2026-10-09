import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpen, parseOpen, sectionId, withOpen } from "../shared/caseState.mjs";

test("sectionId slugs titles per subject kind and drops parenthetical sources", () => {
  assert.equal(sectionId("member", "PAC money"), "member:pac-money");
  assert.equal(sectionId("ticker", "Lobbying (LDA)"), "ticker:lobbying");
  assert.equal(sectionId("ticker", "Federal contracts, last 180 days (USAspending)"), "ticker:federal-contracts-last-180-days");
  assert.equal(sectionId(undefined, "!!"), "dossier:section");
});

test("parseOpen tolerates junk and keeps only booleans", () => {
  assert.deepEqual(parseOpen(null), {});
  assert.deepEqual(parseOpen("not json"), {});
  assert.deepEqual(parseOpen("[1,2]"), {});
  assert.deepEqual(parseOpen('{"a":false,"b":"x","c":true}'), { a: false, c: true });
});

test("isOpen defaults open; withOpen sets, moves to newest, and caps", () => {
  assert.equal(isOpen({}, "member:votes"), true);
  assert.equal(isOpen({}, "member:votes", false), false);
  assert.equal(isOpen({ "member:votes": false }, "member:votes"), false);
  const next = withOpen({ a: true, b: false }, "a", false);
  assert.deepEqual(Object.keys(next), ["b", "a"]);
  assert.equal(next.a, false);
  let big = {};
  for (let i = 0; i < 250; i += 1) big = withOpen(big, `k${i}`, false);
  assert.equal(Object.keys(big).length, 200);
  assert.equal(isOpen(big, "k0"), true, "oldest entries fall back to open");
  assert.equal(isOpen(big, "k249"), false);
});
