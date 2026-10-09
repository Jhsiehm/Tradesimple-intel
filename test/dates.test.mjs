import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, nyDate, nyDaysAgo } from "../shared/dates.mjs";

test("nyDate is the Washington calendar date, not UTC", () => {
  assert.equal(nyDate(Date.parse("2026-10-09T03:30:00Z")), "2026-10-08", "11:30 PM EDT is still the 8th");
  assert.equal(nyDate(Date.parse("2026-10-09T04:30:00Z")), "2026-10-09");
  assert.equal(nyDate(Date.parse("2026-01-15T04:59:00Z")), "2026-01-14", "EST is UTC-5");
  assert.equal(nyDate(Date.parse("2026-01-15T05:00:00Z")), "2026-01-15");
  assert.equal(nyDate(new Date("2026-03-08T07:30:00Z")), "2026-03-08", "DST start");
});

test("addDays and nyDaysAgo cross months, years, and leap days", () => {
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2025-01-01", -1), "2024-12-31");
  assert.equal(addDays("2026-03-31", 0), "2026-03-31");
  assert.equal(nyDaysAgo(2, Date.parse("2026-10-09T03:30:00Z")), "2026-10-06");
});
