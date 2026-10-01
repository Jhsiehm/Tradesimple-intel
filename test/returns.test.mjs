import { test } from "node:test";
import assert from "node:assert/strict";
import { amountMid, buildLeaders, buyReturns, dayNum, indexOnOrAfter, memberStats, pickSymbols, tradeReturn } from "../server/returns.mjs";

/** Weekday closes from `from` for `n` days, price = f(i). */
function series(from, n, f) {
  const out = [];
  let d = dayNum(from);
  for (let i = 0; out.length < n; d += 1) {
    const wd = new Date(d * 86_400_000).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push([d, f(i++)]);
  }
  return out;
}

const spy = series("2025-01-02", 300, (i) => 100 * (1 + i * 0.001));
const nvda = series("2025-01-02", 300, (i) => 50 * (1 + i * 0.004));

test("indexOnOrAfter finds the first close on or after a day", () => {
  const s = [[10, 1], [12, 2], [15, 3]];
  assert.equal(indexOnOrAfter(s, 9), 0);
  assert.equal(indexOnOrAfter(s, 12), 1);
  assert.equal(indexOnOrAfter(s, 13), 2);
  assert.equal(indexOnOrAfter(s, 16), -1);
});

test("amountMid uses the range midpoint", () => {
  assert.equal(amountMid("$15,001 - $50,000"), 32500.5);
  assert.equal(amountMid("Over $50,000,000"), 50_000_000);
  assert.equal(amountMid("", 1001), 1001);
});

test("tradeReturn measures since-trade, 30d and 90d against SPY, entering on the next trading day", () => {
  const r = tradeReturn("2025-01-04", nvda, spy);
  assert.equal(r.entry, "2025-01-06");
  const i = 2;
  const last = nvda.length - 1;
  const ret = nvda[last][1] / nvda[i][1] - 1;
  const sp = spy[last][1] / spy[i][1] - 1;
  assert.ok(Math.abs(r.since.ret - ret) < 1e-4);
  assert.ok(Math.abs(r.since.spy - sp) < 1e-4);
  assert.ok(Math.abs(r.since.excess - (ret - sp)) < 1e-4);
  assert.ok(r.d30.days >= 30 && r.d30.days <= 33);
  assert.ok(r.d90.days >= 90 && r.d90.days <= 93);
  assert.ok(r.d30.excess > 0);
});

test("tradeReturn is null without a close near the trade date, and skips horizons not yet reached", () => {
  assert.equal(tradeReturn("2024-06-01", nvda, spy), null);
  const late = tradeReturn(new Date((nvda.at(-1)[0] - 20) * 86_400_000).toISOString().slice(0, 10), nvda, spy);
  assert.ok(late.since);
  assert.equal(late.d30, null);
  assert.equal(late.d90, null);
});

const trades = [
  { id: "1", bioguide: "A000001", person: "Ann", side: "buy", symbol: "NVDA", inJoin: true, traded: "2025-01-06", amount: "$1,001 - $15,000", amountLow: 1001, lag: 10, filed: "2025-01-16", link: "r1" },
  { id: "2", bioguide: "A000001", person: "Ann", side: "buy", symbol: "SPYX", inJoin: true, traded: "2025-01-06", amount: "$15,001 - $50,000", amountLow: 15001, lag: 60, filed: "2025-03-07", link: "r2" },
  { id: "3", bioguide: "A000001", person: "Ann", side: "sell", symbol: "NVDA", inJoin: true, traded: "2025-02-03", amount: "$1,001 - $15,000", amountLow: 1001, lag: 400, filed: "2026-03-10", link: "r3" },
  { id: "4", bioguide: "B000001", person: "Bo", side: "buy", symbol: "NOPE", inJoin: false, traded: "2025-01-06", amount: "$1,001 - $15,000", amountLow: 1001, lag: 5, filed: "2025-01-11", link: "r4" }
];
const closes = new Map([["NVDA", nvda], ["SPYX", spy]]);

test("buyReturns scores joined buys only, and memberStats summarizes them equal- and mid-weighted", () => {
  const rows = buyReturns(trades, closes, spy);
  assert.deepEqual(rows.map((r) => r.id), ["1", "2"]);
  const s = memberStats(trades, rows).get("A000001");
  assert.equal(s.buys, 2);
  assert.equal(s.priced, 2);
  assert.equal(s.hitRate, 0.5);
  assert.ok(Math.abs(s.excessSince - rows[0].since.excess / 2) < 1e-3);
  assert.ok(s.excessMid < s.excessSince);
  assert.equal(s.best.symbol, "NVDA");
  assert.equal(s.worst.symbol, "SPYX");
});

test("buildLeaders applies the minimum, ranks active traders, late filers, and tickers", () => {
  const rows = buyReturns(trades, closes, spy);
  const stats = memberStats(trades, rows);
  const people = new Map([["A000001", { name: "Ann A.", party: "D", state: "NY", chamber: "house" }]]);
  const none = buildLeaders({ trades, stats, people, minBuys: 3 });
  assert.equal(none.excessTop.length, 0);
  const l = buildLeaders({ trades, stats, people, minBuys: 2 });
  assert.equal(l.excessTop[0].person, "Ann A.");
  assert.equal(l.active[0].bioguide, "A000001");
  assert.equal(l.active[0].trades, 3);
  assert.equal(l.late[0].late, 2);
  assert.equal(l.late[0].maxLag, 400);
  assert.equal(l.longest[0].maxLagLink, "r3");
  assert.equal(l.tickers[0].symbol, "NVDA");
});

test("pickSymbols takes joined buys, most bought first, capped", () => {
  assert.deepEqual(pickSymbols(trades, 5), ["NVDA", "SPYX"]);
  assert.deepEqual(pickSymbols(trades, 1), ["NVDA"]);
});
