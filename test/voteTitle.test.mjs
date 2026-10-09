import { test } from "node:test";
import assert from "node:assert/strict";
import { voteTitle } from "../src/congress/voteTitle.ts";
import { when } from "../src/lib/format.ts";

test("a roll call takes the first real question, skipping the Clerk's bare 'Roll call' and the bill number", () => {
  assert.equal(voteTitle(308, "HR 5334", "Roll call", "On motion that the House agree to the Senate amendments"), "On motion that the House agree to the Senate amendments");
  assert.equal(voteTitle(314, "S 2403", "S 2403"), "S 2403 · Roll call #314");
  assert.equal(voteTitle(300, "", "roll call", ""), "Roll call #300");
});

test("date-only values show the date with no invented time", () => {
  assert.equal(when("2026-10-09"), "2026-10-09");
  assert.equal(when("2026-09-16T19:05:00-04:00"), "2026-09-16 23:05");
});
