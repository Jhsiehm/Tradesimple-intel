import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTimeline, clerkCasts, laneOf, proximity } from "../server/timeline.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("clerkCasts reads House Clerk roll 2026-200 (motion to discharge, 218-204, 8 not voting)", () => {
  const casts = clerkCasts(fixture("house-roll-2026-200.xml"));
  const values = Object.values(casts);
  assert.equal(values.length, 430);
  assert.equal(values.filter((v) => v === "Y").length, 218);
  assert.equal(values.filter((v) => v === "N").length, 204);
  assert.equal(values.filter((v) => v === "-").length, 8);
  assert.equal(casts.A000370, "Y");
  assert.equal(casts.D000032, "N");
});

test("laneOf folds subcommittee system codes onto the parent committee", () => {
  assert.equal(laneOf("hsba00"), "HSBA");
  assert.equal(laneOf("hsba16"), "HSBA");
  assert.equal(laneOf("HSBA"), "HSBA");
});

const seats = [
  { id: "HSBA", name: "House Committee on Financial Services", title: "", side: "majority" },
  { id: "HSBA16", name: "House Committee on Financial Services · Digital Assets", title: "Vice Chair", side: "majority" }
];
const meetings = [
  { id: "1", date: "2026-03-10", title: "Full committee markup", type: "Markup", status: "Scheduled", codes: ["hsba00"], link: "l1" },
  { id: "2", date: "2026-03-20", title: "Digital assets hearing", type: "Hearing", status: "Scheduled", codes: ["hsba16"], link: "l2" },
  { id: "3", date: "2026-03-21", title: "Housing subcommittee", type: "Hearing", status: "Scheduled", codes: ["hsba04"], link: "l3" },
  { id: "4", date: "2026-03-15", title: "Cancelled hearing", type: "Hearing", status: "Cancelled", codes: ["hsba00"], link: "l4" },
  { id: "5", date: "2026-03-18", title: "Agriculture", type: "Hearing", status: "Scheduled", codes: ["hsag00"], link: "l5" }
];
const votes = [
  { id: "house-119-2-1", date: "2026-03-11", question: "On Passage", result: "Passed", bill: "HR 1", casts: { X000001: "Y" } },
  { id: "house-119-2-2", date: "2026-03-12", question: "On Motion", result: "Failed", bill: "", casts: { X000001: "-", Y000002: "N" } },
  { id: "house-119-2-3", date: "2026-03-13", question: "Other member only", result: "Passed", bill: "", casts: { Y000002: "Y" } }
];
const trade = (id, traded) => ({ id, symbol: "COIN", asset: "Coinbase", side: "buy", type: "Purchase", owner: "Self", amount: "$1,001 - $15,000", amountLow: 1001, traded, filed: "2026-04-20", lag: 40, link: "x" });

test("buildTimeline lanes committees, marks own subcommittees, and picks the nearest non-cancelled hearing", () => {
  const out = buildTimeline({
    trades: [trade("a", "2026-03-16"), trade("b", "2026-01-01")],
    seats, meetings, votes, bioguide: "X000001", today: "2026-09-30"
  });
  assert.equal(out.committees.length, 1);
  const lane = out.committees[0];
  assert.equal(lane.id, "HSBA");
  assert.equal(lane.hearings.length, 4, "agriculture hearing is not on this member's lanes");
  assert.deepEqual(lane.hearings.map((h) => [h.id, h.mine]), [["1", true], ["2", true], ["3", false], ["4", true]]);
  assert.equal(lane.subs[0].id, "HSBA16");

  const [early, near] = out.trades;
  assert.equal(early.id, "b");
  assert.equal(early.near, null, "no hearing within 14 days of Jan 1");
  assert.equal(near.near.id, "2", "Mar 15 is cancelled, so the Mar 20 hearing (4 days after) is nearest");
  assert.equal(near.near.gap, 4);
  assert.equal(out.range.from, "2025-01-03");
});

test("proximity compares trade days near a hearing with the share of all calendar days near one", () => {
  const hearings = [{ date: "2025-01-20", status: "Scheduled" }, { date: "2025-03-01", status: "Cancelled" }];
  const trades = [
    { traded: "2025-01-10", near: { id: "h" } },
    { traded: "2025-01-10", near: { id: "h" } },
    { traded: "2025-02-20", near: null },
    { traded: "2024-12-01", near: null }
  ];
  const out = proximity(trades, hearings, "2025-02-21");
  assert.equal(out.trades, 3, "pre-Congress trades are excluded");
  assert.equal(out.tradeDays, 2);
  assert.equal(out.nearTradeDays, 1);
  assert.equal(out.dayShare, 0.5);
  assert.equal(out.baseline, 29 / 50, "Jan 6–Feb 3 covered out of Jan 3–Feb 21; the cancelled hearing does not count");
});

test("buildTimeline keeps only roll calls the member was on, decoding casts", () => {
  const out = buildTimeline({ trades: [], seats, meetings, votes, bioguide: "X000001", today: "2026-09-30" });
  assert.deepEqual(out.votes.map((v) => [v.id, v.vote]), [["house-119-2-1", "Yea"], ["house-119-2-2", "Not voting"]]);
});
