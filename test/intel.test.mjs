import { test } from "node:test";
import assert from "node:assert/strict";
import { activitySignal, alertSeverity, binCounts, bucketDays, bundleArcs, countAlertLevels, dayIso, dayNum, greatCircle, severity, triageAlerts, windowSum } from "../shared/intel.mjs";
import { buildLinks, centroidOf, memberAnchor, proximityPhrase, seatCode } from "../server/intel.mjs";
import { buildAlerts } from "../server/alerts.mjs";

test("bucketDays counts per kind per day and drops out-of-range or undated events", () => {
  const out = bucketDays([
    { kind: "trade", date: "2026-01-01" },
    { kind: "trade", date: "2026-01-01" },
    { kind: "trade", date: "2026-01-03" },
    { kind: "hearing", date: "2026-01-02T15:00:00Z" },
    { kind: "trade", date: "2025-12-31" },
    { kind: "roll", date: "" }
  ], "2026-01-01", "2026-01-03");
  assert.equal(out.len, 3);
  assert.deepEqual(out.days.trade, [2, 0, 1]);
  assert.deepEqual(out.days.hearing, [0, 1, 0]);
  assert.equal(out.days.roll, undefined);
  assert.equal(out.dropped, 2);
  assert.equal(dayIso(out.start), "2026-01-01");
});

test("windowSum clamps, binCounts conserves the total", () => {
  const counts = [1, 2, 3, 4, 5, 6, 7];
  assert.equal(windowSum(counts, 2, 4), 12);
  assert.equal(windowSum(counts, -5, 100), 28);
  assert.equal(windowSum(undefined, 0, 3), 0);
  const bins = binCounts(counts, 3);
  assert.equal(bins.length, 3);
  assert.equal(bins.reduce((a, b) => a + b, 0), 28);
  assert.deepEqual(binCounts(counts, 7), counts);
});

test("greatCircle ends on both endpoints and bows north between US points", () => {
  const sf = [-122.4, 37.8];
  const ny = [-74.0, 40.7];
  const pts = greatCircle(sf, ny, 16);
  assert.equal(pts.length, 17);
  assert.ok(Math.abs(pts[0][0] - sf[0]) < 1e-6 && Math.abs(pts[16][1] - ny[1]) < 1e-6);
  assert.ok(pts[8][1] > (sf[1] + ny[1]) / 2, "great circle midpoint sits north of the straight line");
  assert.deepEqual(greatCircle(sf, sf), []);
});

test("bundleArcs groups by kind and endpoints inside the window, caps, and counts same-place links", () => {
  const links = [
    [10, 0, 1, 2, 1000, 0],
    [12, 0, 1, 2, 15000, 0],
    [40, 0, 1, 2, 1000, 0],
    [11, 1, 3, 2, 5e6, 1],
    [11, 0, 4, 4, 1000, 2],
    [13, 2, 2, 1, 5000, 3]
  ];
  const all = bundleArcs(links, { from: 0, to: 20 });
  assert.equal(all.links, 5);
  assert.equal(all.local, 1);
  assert.equal(all.bundles, 3);
  const trade = all.arcs.find((a) => a.kind === "trade");
  assert.deepEqual([trade.n, trade.amount, trade.first, trade.last], [2, 16000, 10, 12]);
  assert.equal(all.arcs[0].kind, "trade", "most links first");
  const capped = bundleArcs(links, { from: 0, to: 20, cap: 1 });
  assert.equal(capped.arcs.length, 1);
  assert.equal(capped.hidden, 2);
  const onlyContracts = bundleArcs(links, { kinds: new Set(["contract"]) });
  assert.deepEqual(onlyContracts.arcs.map((a) => a.kind), ["contract"]);
});

test("severity compares the trade-day share with the calendar baseline", () => {
  assert.equal(severity(null).level, "thin");
  assert.equal(severity({ tradeDays: 10, nearTradeDays: 0, dayShare: 0, baseline: 0 }).label, "NO HEARINGS", "no committee meetings is not a baseline reading");
  assert.equal(severity({ tradeDays: 2, nearTradeDays: 2, dayShare: 1, baseline: 0.3 }).level, "thin");
  assert.equal(severity({ tradeDays: 10, nearTradeDays: 8, dayShare: 0.8, baseline: 0.5 }).level, "high");
  assert.equal(severity({ tradeDays: 10, nearTradeDays: 3, dayShare: 0.6, baseline: 0.45 }).level, "elevated");
  assert.equal(severity({ tradeDays: 10, nearTradeDays: 5, dayShare: 0.5, baseline: 0.45 }).level, "baseline");
  assert.equal(severity({ tradeDays: 10, nearTradeDays: 2, dayShare: 0.2, baseline: 0.45 }).level, "low");
  assert.match(severity({ tradeDays: 10, nearTradeDays: 8, dayShare: 0.8, baseline: 0.5 }).why, /80% of 10 trade days .* 50% of all days/);
});

test("activitySignal flags a 30-day spike against the trailing rate", () => {
  const today = "2026-10-01";
  const back = (n) => dayIso(dayNum(today) - n);
  const quiet = Array.from({ length: 11 }, (_, i) => back(40 + i * 30));
  assert.equal(activitySignal(quiet, today).level, "baseline");
  const spike = [...quiet, back(1), back(2), back(3), back(5), back(8), back(13)];
  const s = activitySignal(spike, today);
  assert.equal(s.recent, 6);
  assert.equal(s.level, "high");
  assert.equal(activitySignal([back(2)], today).level, "thin");
  assert.equal(activitySignal([back(400), back(2), back(3)], today).level, "thin", "the 400-day-old trade is outside 12 months");
  assert.equal(activitySignal([back(1), back(2), back(3)], today).level, "elevated", "nothing in the prior 11 months, 3 recent");
});

test("alertSeverity triages lateness, size, and Form 4 value", () => {
  assert.equal(alertSeverity({ kind: "member-trade", lag: 12, amountLow: 1001 }), "routine");
  assert.equal(alertSeverity({ kind: "member-trade", lag: 50, late: true, amountLow: 1001 }), "elevated");
  assert.equal(alertSeverity({ kind: "late-filing", lag: 120, late: true }), "high");
  assert.equal(alertSeverity({ kind: "symbol-trade", lag: 5, amountLow: 250001 }), "high");
  assert.equal(alertSeverity({ kind: "form4", value: 150000 }), "elevated");
  assert.equal(alertSeverity({ kind: "form4", value: 2e6 }), "high");
  assert.equal(alertSeverity({ kind: "lobbying", amount: 60000 }), "routine");
});

test("buildAlerts rows carry severity, source, and what a pin would watch", () => {
  const out = buildAlerts({
    trades: [{ id: "t1", chamber: "senate", person: "Sen. B", bioguide: "B000002", symbol: "AMD", side: "buy", amount: "$250,001 - $500,000", amountLow: 250001, traded: "2026-08-01", filed: "2026-08-20", lag: 19 }],
    insiders: [{ id: "f1", symbol: "AMD", person: "X", code: "S", side: "sell", shares: 1000, price: 200, traded: "2026-09-01", filed: "2026-09-03" }],
    symbols: ["AMD"],
    members: []
  });
  const trade = out.find((a) => a.id === "trade:t1");
  assert.deepEqual([trade.severity, trade.source], ["high", "Senate eFD PTR"]);
  assert.deepEqual(trade.pins.map((p) => `${p.kind}:${p.id}`), ["member:B000002", "symbol:AMD"]);
  const f4 = out.find((a) => a.id === "f4:f1");
  assert.deepEqual([f4.severity, f4.source], ["elevated", "SEC EDGAR Form 4"]);
});

test("triageAlerts orders by severity then newest, filters by level, and hides dismissed", () => {
  const rows = [
    { id: "a", date: "2026-09-01", severity: "routine" },
    { id: "b", date: "2026-08-01", severity: "high" },
    { id: "c", date: "2026-09-05", severity: "elevated" },
    { id: "d", date: "2026-09-10", severity: "high" },
    { id: "e", date: "2026-09-20" }
  ];
  assert.deepEqual(triageAlerts(rows).map((a) => a.id), ["d", "b", "c", "e", "a"]);
  assert.deepEqual(triageAlerts(rows, { level: "routine" }).map((a) => a.id), ["e", "a"], "rows without severity count as routine");
  assert.deepEqual(triageAlerts(rows, { hide: new Set(["d"]) }).map((a) => a.id), ["b", "c", "e", "a"]);
  assert.deepEqual(countAlertLevels(rows, new Set(["a"])), { high: 2, elevated: 1, routine: 1 });
  assert.deepEqual(rows.map((a) => a.id), ["a", "b", "c", "d", "e"], "input is not reordered");
});

test("seatCode and memberAnchor place House seats on districts and senators on states", () => {
  assert.equal(seatCode("NJ-5"), "NJ-05");
  assert.equal(seatCode("AK-0"), "AK-AL");
  assert.equal(seatCode("ak-al"), "AK-AL");
  assert.equal(seatCode("DC"), "");
  const g = { districts: new Map([["NJ-05", [-74.1, 41.0]]]), states: new Map([["NJ", [-74.6, 40.1]], ["DC", [-77.0, 38.9]]]) };
  assert.deepEqual(memberAnchor({ chamber: "house", state: "NJ", district: "NJ-5" }, g), { at: [-74.1, 41.0], where: "NJ-05" });
  assert.deepEqual(memberAnchor({ chamber: "house", state: "NJ", district: "5" }, g), { at: [-74.1, 41.0], where: "NJ-05" }, "roster rows carry the bare number");
  assert.deepEqual(memberAnchor({ chamber: "senate", state: "NJ" }, g).where, "NJ");
  assert.equal(memberAnchor({ chamber: "house", state: "", district: "DC" }, g).where, "DC", "delegates fall back to the state");
  assert.equal(memberAnchor({ chamber: "senate", state: "" }, g), null);
});

test("centroidOf takes the largest polygon of a multipolygon", () => {
  const square = (x, y, s) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]];
  const c = centroidOf({ type: "MultiPolygon", coordinates: [square(0, 0, 1), square(10, 10, 4)] });
  assert.deepEqual(c, [12, 12]);
});

test("buildLinks joins only through real places and reports what it could not place", () => {
  const g = {
    districts: new Map([["NJ-05", [-74.1, 41.0]]]),
    states: new Map([["OK", [-97.5, 35.5]]]),
    agencyBy: new Map([["Department of Defense", { short: "DoD", address: "Pentagon", lon: -77.05, lat: 38.87 }]])
  };
  const hq = [
    { symbol: "MCD", city: "CHICAGO", state: "IL", lat: 41.88, lon: -87.63 },
    { symbol: "LMT", city: "BETHESDA", state: "MD", lat: 38.98, lon: -77.1 },
    { symbol: "SAP", foreign: true, city: "WALLDORF", state: "", lat: null, lon: null }
  ];
  const out = buildLinks({
    g,
    hq,
    people: [{ bioguide: "G000583", name: "Josh Gottheimer", party: "D", chamber: "house", state: "NJ", district: "5" }],
    trades: [
      { person: "Josh Gottheimer", bioguide: "G000583", party: "D", chamber: "house", state: "NJ", district: "NJ-5", symbol: "MCD", traded: "2026-09-25", amountLow: 1001 },
      { person: "Josh Gottheimer", bioguide: "G000583", party: "D", chamber: "house", state: "NJ", district: "NJ-5", symbol: "SAP", traded: "2026-09-25", amountLow: 1001 },
      { person: "Unknown", chamber: "senate", state: "", symbol: "MCD", traded: "2026-09-25", amountLow: 1001 }
    ],
    contracts: [
      { agency: "Department of Defense", symbol: "LMT", date: "2026-07-01", amount: 5e8 },
      { agency: "Smithsonian Institution", symbol: "LMT", date: "2026-07-01", amount: 1 },
      { agency: "Department of Defense", symbol: null, date: "2026-07-01", amount: 1 }
    ],
    pacs: [{ symbol: "LMT", bioguide: "G000583", date: "2026-03-01", amount: 5000 }]
  });
  assert.deepEqual(out.coverage.trade, { total: 3, placed: 1, noFrom: 1, noTo: 1 });
  assert.deepEqual(out.coverage.contract, { total: 2, placed: 1, noFrom: 1, noTo: 0 }, "unjoined recipients are not counted as arcs");
  assert.deepEqual(out.coverage.pac, { total: 1, placed: 1, noFrom: 0, noTo: 0 });
  assert.equal(out.links.length, 3);
  const [d, kind, f, t, amount, a] = out.links[0];
  assert.equal(d, dayNum("2026-09-25"));
  assert.equal(kind, 0);
  assert.match(out.places[f].label, /Rep\. Josh Gottheimer \(D-NJ-05\)/);
  assert.equal(out.places[t].label, "MCD HQ · Chicago, IL");
  assert.equal(out.actions[a], "pos:MCD");
  assert.equal(amount, 1001);
  const pac = out.links.find((l) => l[1] === 2);
  assert.equal(out.places[pac[2]].label.startsWith("LMT HQ"), true, "PAC arcs start at the joined company's HQ");
  assert.equal(out.places[pac[3]].kind, "member");
});

test("proximityPhrase counts the same in-window trades as proximity() and names a missing hearing baseline", () => {
  const trades = Array.from({ length: 32 }, (_, i) => ({ traded: "2025-02-01", id: i }));
  assert.equal(proximityPhrase(trades, { trades: 32, near: 0, baseline: 0 }), "32 trades, no committee hearings on file to compare");
  assert.equal(proximityPhrase(trades, { trades: 32, near: 10, baseline: 0.5 }), "10 of 32 trades within 14 days of a hearing (50% of all days are)");
  assert.equal(proximityPhrase([], null), "no disclosed trades since 2025-01-03");
});
