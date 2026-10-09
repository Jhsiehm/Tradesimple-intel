import { test } from "node:test";
import assert from "node:assert/strict";
import { ageAlert, ageLine, agoLabel, ageSeverity, calendarDays, freshness, tradeAge } from "../shared/tradeAge.mjs";
import { triageAlerts } from "../shared/intel.mjs";

const NOW = Date.parse("2026-10-09T14:30:00Z"); // 10:30 ET

test("freshness tiers on whole days", () => {
  assert.equal(freshness(0), "fresh");
  assert.equal(freshness(3), "fresh");
  assert.equal(freshness(4), "recent");
  assert.equal(freshness(14), "recent");
  assert.equal(freshness(15), "stale");
  assert.equal(freshness(45), "stale");
  assert.equal(freshness(46), "old");
  assert.equal(freshness(null), null);
});

test("calendar days use the New York date, not UTC", () => {
  // 02:00 UTC on the 9th is still the 8th in New York.
  assert.equal(calendarDays("2026-10-08", "2026-10-09T02:00:00Z"), 0);
  assert.equal(calendarDays("2026-10-08", NOW), 1);
  assert.equal(calendarDays("2026-09-01", "2026-10-09"), 38);
  assert.equal(calendarDays("", NOW), null);
});

test("ago labels: exact with a time, calendar days with a date", () => {
  assert.equal(agoLabel("2026-10-09T14:29:40Z", NOW), "just now");
  assert.equal(agoLabel("2026-10-09T14:18:00Z", NOW), "12m ago");
  assert.equal(agoLabel("2026-10-09T09:00:00Z", NOW), "5h ago");
  assert.equal(agoLabel("2026-10-09", NOW), "today");
  assert.equal(agoLabel("2026-10-08", NOW), "yesterday");
  assert.equal(agoLabel("2026-09-01", NOW), "38d ago");
  assert.equal(agoLabel("2026-01-09", NOW), "9mo ago");
  assert.equal(agoLabel("", NOW), "");
});

test("tradeAge: filed today, traded 38 days ago, 38-day lag, stale", () => {
  const a = tradeAge({ kind: "symbol-trade", eventAt: "2026-09-01", filedAt: "2026-10-09" }, NOW);
  assert.equal(a.eventDays, 38);
  assert.equal(a.lagDays, 38);
  assert.equal(a.tier, "stale");
  assert.equal(a.word, "traded");
  assert.equal(ageLine(a, NOW), "filed today · traded 38d ago · 38d filing lag");
});

test("tradeAge: kinds without an event date show only the filed age", () => {
  const a = tradeAge({ kind: "news", eventAt: "2026-10-09T13:00:00Z", filedAt: "2026-10-09T13:00:00Z" }, NOW);
  assert.equal(a.word, "");
  assert.equal(a.tier, null);
  assert.equal(ageLine(a, NOW), "filed 1h ago");
  const c = tradeAge({ kind: "contract", eventAt: "2026-07-01", filedAt: "" }, NOW);
  assert.equal(ageLine(c, NOW), "awarded 3mo ago");
});

test("severity: stale trades drop one level, old two; other kinds keep theirs", () => {
  assert.equal(ageSeverity("elevated", "symbol-trade", "fresh"), "elevated");
  assert.equal(ageSeverity("elevated", "symbol-trade", "recent"), "elevated");
  assert.equal(ageSeverity("elevated", "symbol-trade", "stale"), "routine");
  assert.equal(ageSeverity("high", "form4", "stale"), "elevated");
  assert.equal(ageSeverity("high", "member-trade", "old"), "routine");
  assert.equal(ageSeverity("high", "late-filing", "old"), "high");
  assert.equal(ageSeverity("high", "8-k", "old"), "high");
  assert.equal(ageSeverity("high", "whale", "old"), "high");
});

test("a Congress buy traded 38 days ago ranks below an insider buy from yesterday", () => {
  const congress = ageAlert({ id: "trade:1", kind: "symbol-trade", date: "2026-10-09", eventAt: "2026-09-01", filedAt: "2026-10-09", severity: "elevated" }, NOW);
  const insider = ageAlert({ id: "f4:X:1", kind: "form4", date: "2026-10-09", eventAt: "2026-10-08", filedAt: "2026-10-09T13:05:00Z", severity: "elevated" }, NOW);
  assert.equal(congress.severity, "routine");
  assert.equal(congress.baseSeverity, "elevated");
  assert.equal(insider.severity, "elevated");
  assert.equal(insider.baseSeverity, undefined);
  assert.deepEqual(triageAlerts([congress, insider]).map((a) => a.id), ["f4:X:1", "trade:1"]);
});

test("ageAlert reads live times, and ageing twice does not downgrade twice", () => {
  const row = { id: "f4:A:1", kind: "form4", date: "2026-10-09", severity: "high", live: { eventAt: "2026-09-20", publishedAt: "2026-10-09T13:00:00Z" } };
  const once = ageAlert(row, NOW);
  assert.equal(once.age.eventDays, 19);
  assert.equal(once.age.filedAt, "2026-10-09T13:00:00Z");
  assert.equal(once.severity, "elevated");
  const twice = ageAlert(once, NOW);
  assert.equal(twice.severity, "elevated");
  assert.equal(twice.baseSeverity, "high");
});

test("ageAlert without an event date leaves severity alone", () => {
  const r = ageAlert({ id: "x", kind: "form4", date: "2026-10-09", severity: "high" }, NOW);
  assert.equal(r.severity, "high");
  assert.equal(r.age.tier, null);
});
