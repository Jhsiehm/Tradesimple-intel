import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, writeCache } from "../server/lib/db.mjs";
import { KEY } from "../server/lib/cacheKeys.mjs";
import { parseBars } from "../server/parsers/bars.mjs";
import { loadBars } from "../server/domain/backtest/bars.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { congressSignals, contractSignals, form4Signals, hearingsByLane, lobbySignals, matchCommittees, nearestHearing } from "../server/domain/backtest/signals.mjs";
import { cleanFilters } from "../shared/backtestSpec.mjs";
import { dayOf, isoOf } from "../shared/backtest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = (over = {}) => cleanFilters(over);
const sector = (s) => ({ LMT: "Industrials", AAPL: "Information Technology" })[s] || "";

function trade(over = {}) {
  return { id: "t1", chamber: "house", person: "Ann Ames", bioguide: "A000001", party: "D", state: "CA", symbol: "LMT", side: "buy", amount: "$15,001 - $50,000", amountLow: 15001, traded: "2025-03-03", filed: "2025-03-20", lag: 17, inJoin: true, ...over };
}

test("parseBars adjusts the open with the close's factor, skips holes, and keeps one bar per day", () => {
  const body = { chart: { result: [{
    timestamp: [1_740_000_000, 1_740_086_400, 1_740_086_500, 1_740_172_800],
    indicators: {
      quote: [{ open: [100, 50, 51, null], close: [100, 50, 52, null] }],
      adjclose: [{ adjclose: [90, 45, 46.8, null] }]
    }
  }] } };
  const bars = parseBars(body);
  assert.equal(bars.length, 2, "duplicate day collapsed, null close dropped");
  assert.deepEqual(bars[0], [Math.floor(1_740_000_000 / 86400), 90, 90]);
  assert.equal(bars[1][2], 46.8);
  assert.ok(Math.abs(bars[1][1] - 51 * (46.8 / 52)) < 1e-4);
  assert.throws(() => parseBars({ chart: { result: null, error: { description: "No data found" } } }), /No data found/);
});

test("congress signals: public date is the filing date; filters apply; unjoined tickers are not guessed", () => {
  const trades = [
    trade(),
    trade({ id: "t2", party: "R", bioguide: "B000002" }),
    trade({ id: "t3", symbol: "ZZZZ", inJoin: false }),
    trade({ id: "t4", side: "exchange" }),
    trade({ id: "t5", amount: "$1,001 - $15,000", amountLow: 1001 }),
    trade({ id: "t6", symbol: "AAPL", filed: "2024-12-01" })
  ];
  const all = congressSignals({ trades, filters: F(), sectorOf: sector });
  assert.equal(all.signals.length, 4);
  assert.equal(all.dropped.notJoined, 1);
  assert.equal(all.dropped.notBuyOrSell, 1);
  const s = all.signals.find((x) => x.id === "t1");
  assert.equal(s.signalDate, "2025-03-20");
  assert.equal(s.tradeDate, "2025-03-03");
  assert.equal(s.sizeHint, 32500.5);
  assert.equal(s.sizeIsRange, true);
  assert.equal(s.sector, "Industrials");
  const amended = congressSignals({ trades: [trade({ id: "am", chamber: "senate", filed: "2025-03-20", amended: "2025-05-02" })], filters: F(), sectorOf: sector });
  assert.equal(amended.signals[0].signalDate, "2025-05-02", "an amendment's rows are public on the amendment date");
  assert.equal(amended.dropped.amendedLater, 1);
  assert.equal(amended.signals[0].filedDate, "2025-03-20", "the original filing date travels with the signal for lag stats");
  const folded = congressSignals({ trades: [trade({ id: "fo", chamber: "senate", filed: "2025-03-20", amended: "2025-05-02", public: "2025-03-20", revised: ["type"] })], filters: F(), sectorOf: sector });
  assert.equal(folded.signals[0].signalDate, "2025-03-20", "a trade also in the original report is public at the original filing");
  assert.equal(folded.dropped.amendedLater, undefined);
  assert.equal(folded.dropped.revised, 1);
  assert.equal(congressSignals({ trades, filters: F({ party: "R" }), sectorOf: sector }).signals.length, 1);
  assert.equal(congressSignals({ trades, filters: F({ minAmount: 15000 }), sectorOf: sector }).signals.length, 3);
  assert.equal(congressSignals({ trades, filters: F({ from: "2025-01-01" }), sectorOf: sector }).signals.length, 3, "date range is on the filing date");
  assert.equal(congressSignals({ trades, filters: F({ sector: "Information Technology" }), sectorOf: sector }).signals.length, 1);
  assert.equal(congressSignals({ trades, filters: F({ member: "ames" }), sectorOf: sector }).signals.length, 4);
  const committee = matchCommittees([
    { id: "HSAS", name: "House Committee on Armed Services", members: [{ bioguide: "A000001" }], subcommittees: [{ members: [{ bioguide: "C000003" }] }] },
    { id: "HSAG", name: "House Committee on Agriculture", members: [{ bioguide: "B000002" }], subcommittees: [] }
  ], "armed services");
  assert.deepEqual([...committee.members].sort(), ["A000001", "C000003"]);
  const gated = congressSignals({ trades, filters: F({ committee: "armed services" }), sectorOf: sector, committee });
  assert.deepEqual(gated.signals.map((x) => x.id).sort(), ["t1", "t5", "t6"]);
});

test("near-hearing uses the member's committee lanes and, when asked, only hearings known by the filing date", () => {
  const hearings = hearingsByLane([
    { id: "m1", date: "2025-03-10", codes: ["hsas00", "hsas02"], status: "" },
    { id: "m2", date: "2025-03-12", codes: ["hsag00"], status: "" },
    { id: "m3", date: "2025-03-05", codes: ["hsas00"], status: "Canceled" },
    { id: "m4", date: "2025-03-25", codes: ["hsas00"], status: "" }
  ]);
  const lanes = new Map([["A000001", new Set(["HSAS"])]]);
  const day = dayOf("2025-03-03");
  assert.equal(nearestHearing(lanes.get("A000001"), hearings, day, 10), 7, "cancelled and other-lane meetings are ignored");
  assert.equal(nearestHearing(lanes.get("A000001"), hearings, day, 5), null);
  const filed = dayOf("2025-03-20");
  assert.equal(nearestHearing(lanes.get("A000001"), hearings, dayOf("2025-03-24"), 3, filed), null, "the 25th had not happened by the filing");
  assert.equal(nearestHearing(lanes.get("A000001"), hearings, dayOf("2025-03-24"), 3), 1);
  const out = congressSignals({ trades: [trade(), trade({ id: "far", traded: "2025-02-01", filed: "2025-02-10" })], filters: F({ nearHearingDays: 10 }), sectorOf: sector, lanes, hearings });
  assert.deepEqual(out.signals.map((x) => x.id), ["t1"]);
  assert.equal(out.signals[0].meta.hearingGap, 7);
  assert.equal(out.dropped.noNearbyHearing, 1);
});

test("Form 4 signals keep open-market P and S only and drop 10b5-1 plan lines", () => {
  const rows = [
    { id: "a", symbol: "AAPL", person: "Cook", title: "CEO", code: "P", side: "buy", value: 500000, plan: false, traded: "2025-03-01", filed: "2025-03-04" },
    { id: "b", symbol: "AAPL", person: "Cook", code: "S", side: "sell", value: 900000, plan: true, traded: "2025-03-01", filed: "2025-03-04" },
    { id: "c", symbol: "AAPL", person: "Cook", code: "A", side: "award", value: 0, plan: false, traded: "2025-03-01", filed: "2025-03-04" },
    { id: "d", symbol: "LMT", person: "Taiclet", code: "S", side: "sell", value: 2_000_000, plan: false, traded: "2025-03-01", filed: "2025-03-05" }
  ];
  const out = form4Signals({ rows, filters: F(), sectorOf: sector });
  assert.deepEqual(out.signals.map((s) => s.id), ["a", "d"]);
  assert.equal(out.dropped.plan10b5, 1);
  assert.equal(out.dropped.notOpenMarket, 1);
  assert.equal(out.signals[0].signalDate, "2025-03-04");
  assert.equal(form4Signals({ rows, filters: F({ minAmount: 1_000_000 }), sectorOf: sector }).signals.length, 1);
});

test("contract signals wait for publication: Defense +90 days, civilian +7, one per ticker per 30 days", () => {
  const rows = [
    { id: "1", symbol: "LMT", date: "2025-03-01", amount: 5e8, agency: "Department of Defense", subAgency: "Navy" },
    { id: "2", symbol: "LMT", date: "2025-03-20", amount: 5e8, agency: "Department of Defense", subAgency: "Navy" },
    { id: "3", symbol: "AAPL", date: "2025-03-01", amount: 1e6, agency: "General Services Administration" },
    { id: "4", symbol: "AAPL", date: "2025-06-01", amount: -1e6, agency: "General Services Administration" },
    { id: "5", symbol: null, date: "2025-03-01", amount: 1e6, agency: "NASA" }
  ];
  const out = contractSignals({ rows, filters: F(), sectorOf: sector });
  assert.deepEqual(out.signals.map((s) => [s.id, s.signalDate]), [["1", isoOf(dayOf("2025-03-01") + 90)], ["3", "2025-03-08"]]);
  assert.equal(out.dropped.cooldown, 1);
  assert.equal(out.dropped.deobligation, 1);
  assert.equal(out.dropped.noJoin, 1);
});

test("lobbying spike is public on the quarter's last posting and compares with filings posted by then", () => {
  const q = (year, type, posted, amount) => ({ year, type, posted, amount, periodEnd: `${year}-03-31` });
  const filings = [
    q(2025, "Q1", "2025-04-10", 100_000),
    q(2025, "Q2", "2025-07-10", 150_000),
    q(2025, "Q2", "2025-07-18", 100_000),
    q(2025, "Q3", "2025-10-12", 120_000),
    q(2025, "Q3A", "2025-11-01", 999_999)
  ];
  const out = lobbySignals({ filingsBySymbol: { LMT: filings }, filters: F({ spikePct: 50 }), sectorOf: sector });
  assert.equal(out.signals.length, 1);
  assert.equal(out.signals[0].signalDate, "2025-07-18");
  assert.equal(out.signals[0].sizeHint, 250_000);
});

test("loadBars: cache first, 404 is missing, failures fall back to stale, the deadline leaves symbols pending", async () => {
  process.env.INTEL_CACHE = ":memory:";
  const db = openDb(root);
  const series = (n) => Array.from({ length: n }, (_, i) => [20000 + i, 10, 11]);
  writeCache(db, KEY.bars("CACHED"), series(3), 60_000);
  writeCache(db, KEY.bars("STALE"), series(4), -1);
  const calls = [];
  const fetchBars = async (symbol) => {
    calls.push(symbol);
    if (symbol === "GONE") { const e = new Error("HTTP 404"); e.status = 404; throw e; }
    if (symbol === "STALE") throw new Error("HTTP 500");
    if (symbol === "SLOW") await new Promise((r) => setTimeout(r, 400));
    return series(5);
  };
  const t0 = Date.now();
  const out = await loadBars(db, ["CACHED", "NEW", "GONE", "STALE", "SLOW"], { deadline: t0 + 100, fetchBars });
  assert.ok(Date.now() - t0 < 350, "returned at the deadline");
  assert.equal(out.cached, 1);
  assert.deepEqual(out.missing, ["GONE"]);
  assert.deepEqual(out.stale, ["STALE"]);
  assert.deepEqual(out.pending, ["SLOW"]);
  assert.equal(out.bars.CACHED.length, 3);
  assert.equal(out.bars.NEW.length, 5);
  assert.equal(out.bars.STALE.length, 4);
  assert.equal(calls.includes("CACHED"), false);
  await new Promise((r) => setTimeout(r, 450));
  const again = await loadBars(db, ["SLOW"], { fetchBars });
  assert.equal(again.cached, 1, "the slow fetch finished in the background and filled the cache");
});

test("runSpec end to end on seeded caches: filing-date entry, committee filter, labeled feeds, cached by spec hash", async () => {
  process.env.INTEL_CACHE = ":memory:";
  const db = openDb(root);
  const start = dayOf("2025-01-06");
  const bars = (f) => Array.from({ length: 400 }, (_, i) => [start + i, f(i), f(i)]);
  writeCache(db, KEY.bars("LMT"), bars((i) => 100 + i * 0.1), 3_600_000);
  writeCache(db, KEY.bars("SPY"), bars(() => 100), 3_600_000);
  const trades = [
    trade({ id: "h1", filed: "2025-03-20", traded: "2025-03-03" }),
    trade({ id: "h2", filed: "2025-04-20", traded: "2025-04-01", bioguide: "B000002", person: "Bob Bell" }),
    trade({ id: "h3", filed: "2025-05-20", traded: "2025-05-01", symbol: "MSFT", inJoin: false })
  ];
  writeCache(db, KEY.posCongress, {
    ok: true, source: "House Clerk PTR PDFs · Senate eFD PTRs", asOf: "2026-10-01T00:00:00.000Z", building: false, from: "2025-01-03",
    latency: "test latency", progress: { house: { paper: 3, failed: 1 }, senate: { paper: 0, failed: 0 } }, items: trades
  }, 3_600_000);
  writeCache(db, KEY.committees, {
    ok: true, source: "unitedstates/congress-legislators", asOf: "2026-10-01T00:00:00.000Z", latency: "roster",
    items: [{ id: "HSAS", name: "House Committee on Armed Services", chamber: "house", members: [{ bioguide: "A000001" }], subcommittees: [] }]
  }, 3_600_000);

  const raw = { source: "congress", filters: { committee: "Armed Services" }, rules: { holdDays: 30, benchmark: "SPY", slippageBps: 0 } };
  const first = await runSpec(db, raw);
  assert.equal(first.ok, true);
  assert.equal(first.cache, "miss");
  assert.equal(first.counts.signals, 1);
  assert.equal(first.counts.used, 1);
  const t = first.trades[0];
  assert.equal(t.signal, "2025-03-20");
  assert.equal(t.entry, "2025-03-21");
  assert.ok(t.entry > t.signal);
  assert.ok(first.stats.total > 0);
  assert.equal(first.stats.benchmarkTotal, 0);
  for (const f of first.feeds) assert.ok(f.label && f.source && f.asOf && f.latency, `feed ${f.label} is labeled`);
  assert.deepEqual(first.feeds.map((f) => f.label), ["Signals", "Committees", "Prices"]);
  assert.match(first.caveats.items.find((c) => c.id === "paper").text, /^3 scanned paper filings/);
  assert.match(first.caveats.items.map((c) => c.text).join("\n"), /1 electronic reports could not be read/);
  assert.ok(first.timing.totalMs >= 0);
  const second = await runSpec(db, raw);
  assert.equal(second.cache, "hit");
  assert.equal(second.stats.total, first.stats.total);

  const bad = await runSpec(db, { source: "congress", filters: { committee: "Underwater Basket Weaving" } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /No committee matches/);
  const none = await runSpec(db, { source: "nope" });
  assert.equal(none.ok, false);
});
