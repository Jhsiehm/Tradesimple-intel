import { test } from "node:test";
import assert from "node:assert/strict";
import { benchmarkClaims, hasBenchmarkFigures, scopeCheck, windowClaims, windowOf } from "../shared/claimScope.mjs";
import { evidenceOf, systemPrompt } from "../shared/ask.mjs";
import { applyWindow, benchmarkStatus, WINDOW_MIN_BUYS } from "../server/returns.mjs";
import { TOOLS, leadersForModel, windowItems } from "../server/ai/tools.mjs";
import { buildFeed } from "../server/feed.mjs";
import { runAsk } from "../server/ai/run.mjs";

/* ---------- the real case: an all-time board with no priced buys, answered as "last 30 days vs SPY" ---------- */

const ALL_TIME_UNPRICED = leadersForModel({
  ok: true, source: "Disclosures: House Clerk PTRs · Senate eFD. Prices: Yahoo Finance daily adjusted closes.", asOf: "2026-10-09T13:43:38Z",
  latency: "Pricing in progress: 0 of 300 symbols priced so far.",
  basis: "Disclosed buys, equal-weighted. The S&P 500 is SPY over the same days.",
  window: { all: true, from: "2025-06-02", to: "2026-10-08", basis: "disclosure date (filed)", note: "No window requested." },
  benchmarkComparison: null, benchmarkComparisonReason: "Prices are still loading after a server start (0 of 300 symbols read so far), so no buy has an SPY comparison yet.",
  minBuys: 10, scoredMembers: 0, excessTop: [], excessBottom: [],
  active: [{ person: "Ro Khanna", trades: 412, buys: 230, lastFiled: "2025-06-20" }], tickers: [{ symbol: "NVDA", members: 14, trades: 31 }], late: []
});
const BAD = [
  "**Top disclosed buys vs SPY, last 30 days**",
  "| Member | Trades | Last filed | Ref |",
  "|---|---|---|---|",
  "| Ro Khanna | 412 | 2025-06-20 | [t1] |"
].join("\n");

test("the real answer: 'last 30 days' and 'vs SPY' on an all-time board with no priced buys are both flagged, with the reason", () => {
  const flags = scopeCheck(BAD, [evidenceOf("t1", "congress_leaders", {}, ALL_TIME_UNPRICED)]);
  assert.deepEqual(flags.map((f) => [f.kind, f.raw]), [["window", "last 30 days"], ["benchmark", "vs SPY"]]);
  assert.match(flags[0].note, /^The answer says “last 30 days”, but t1 covers every record the app holds \(disclosure date \(filed\), 2025-06-02 to 2026-10-08\)\./);
  assert.match(flags[1].note, /t1 has no SPY or benchmark figures \(Prices are still loading after a server start/);
});

test("runAsk puts window and benchmark flags in grounding.scope and at the top of the caveats", async () => {
  const events = [];
  const turns = [[{ type: "tool_call", id: "c1", name: "congress_leaders", args: {} }], [{ type: "text", delta: BAD }]];
  let i = 0;
  const provider = { async *chat() { for (const ev of turns[i++] || []) yield ev; } };
  await runAsk({ question: "Top disclosed buys vs SPY in the last 30 days", provider, tools: [{ name: "congress_leaders", description: "x", parameters: {} }], execute: async () => ALL_TIME_UNPRICED, emit: (e) => events.push(e), today: "2026-10-09", heartbeatMs: 60_000 });
  const done = events.find((e) => e.type === "done");
  assert.deepEqual(done.grounding.scope.map((s) => s.kind), ["window", "benchmark"]);
  assert.match(done.caveats[0], /^The answer says “last 30 days”/);
  assert.match(done.caveats[1], /^The answer says “vs SPY”/);
});

/* ---------- no false positives ---------- */

const WINDOWED = leadersForModel({
  ok: true, source: "s", asOf: "a", latency: "l",
  window: { all: false, from: "2026-09-09", to: "2026-10-09", days: 30, basis: "disclosure date (filed)", rows: 120 },
  benchmarkComparison: { benchmark: "SPY", buysInWindow: 60, pricedBuys: 41, membersRanked: 4, minPricedBuysToRank: 3, through: "2026-10-08" },
  excessTop: [{ person: "Ann", excessSince: 0.0412, priced: 5 }]
});

test("a windowed board with SPY figures supports 'last 30 days' and 'vs SPY'", () => {
  const ev = [evidenceOf("t1", "congress_leaders", { days: 30 }, WINDOWED)];
  assert.deepEqual(scopeCheck("In the last 30 days Ann's buys beat SPY by 4.12% [t1].", ev), []);
  assert.deepEqual(scopeCheck("Over the past month, Ann led vs the S&P 500 [t1].", ev), [], "30 days ≈ a month");
});

test("a sentence that says the data is NOT the asked window, or that no comparison exists, is not flagged", () => {
  const ev = [evidenceOf("t1", "congress_leaders", {}, ALL_TIME_UNPRICED)];
  assert.deepEqual(scopeCheck("This board covers all disclosures since 2025-06-02, not the last 30 days [t1]. There is no comparison against SPY yet [t1].", ev), []);
  assert.deepEqual(scopeCheck("Ro Khanna has 412 trades [t1].", ev), [], "no window or benchmark words, nothing to judge");
});

test("tools that state no window are never judged on windows, and an uncited answer is left to the uncited warning", () => {
  const dossier = evidenceOf("t2", "ticker_dossier", { symbol: "NVDA" }, { ok: true, source: "s", quote: { last: 120 } });
  assert.deepEqual(scopeCheck("Over the last 30 days NVDA moved [t2].", [dossier]), []);
  const both = [evidenceOf("t1", "congress_leaders", {}, ALL_TIME_UNPRICED), dossier];
  assert.deepEqual(scopeCheck("Last 30 days: Khanna traded most and NVDA was busy [t1, t2].", both).filter((f) => f.kind === "window"), [], "one cited tool with no stated window: benefit of the doubt");
  assert.deepEqual(scopeCheck("Last 30 days vs SPY.", [evidenceOf("t1", "congress_leaders", {}, ALL_TIME_UNPRICED)]), []);
});

test("backtests: a 30-day spec window and benchmark stats support the claims; a 90-day window does not support 'last 30 days'", () => {
  const bt = (from) => evidenceOf("t1", "run_backtest", {}, { ok: true, spec: { source: "congress", filters: { from, to: "2026-10-09" } }, stats: { totalReturn: 0.02, benchmarkReturn: 0.01, excessReturn: 0.01 }, asOf: "2026-10-09" });
  assert.deepEqual(scopeCheck("Last 30 days: 2% vs SPY's 1% [t1].", [bt("2026-09-09")]), []);
  const flags = scopeCheck("Last 30 days: 2% vs SPY's 1% [t1].", [bt("2026-07-11")]);
  assert.deepEqual(flags.map((f) => f.kind), ["window"]);
  assert.match(flags[0].note, /2026-07-11 to 2026-10-09, 90 days/);
});

test("congress_feed's widened window does not support 'this week'", () => {
  const feed = { ok: true, window: { from: "2026-09-25", to: "2026-10-09", days: 14, fallback: true, basis: "disclosure date (filed)" }, counts: { filings: 40 } };
  assert.deepEqual(scopeCheck("This week 40 filings came in [t1].", [evidenceOf("t1", "congress_feed", {}, feed)]).map((f) => f.raw), ["This week"]);
  assert.deepEqual(scopeCheck("In the last two weeks 40 filings came in [t1].", [evidenceOf("t1", "congress_feed", {}, feed)]), []);
});

/* ---------- parsers ---------- */

test("windowClaims reads windows, not hold periods or 'the last day'", () => {
  assert.deepEqual(windowClaims("the last 30 days, past two weeks, this month, a 90-day window, trailing year").map((c) => c.days), [30, 14, 365, 30, 90]);
  assert.deepEqual(windowClaims("held 30 days, a 90-day hold, excess30, the last day of trading"), []);
});

test("benchmarkClaims reads comparisons with SPY, the S&P 500, the market, or a benchmark", () => {
  assert.deepEqual(benchmarkClaims("vs SPY; versus the S&P 500; beat the market; outperformed the benchmark; against S&P").map((c) => c.target), ["SPY", "S&P 500", "market", "benchmark", "S&P"]);
  assert.deepEqual(benchmarkClaims("Prices could not be compared against SPY."), [], "negated");
});

test("hasBenchmarkFigures needs a number, not the word SPY in a basis sentence", () => {
  assert.equal(hasBenchmarkFigures(ALL_TIME_UNPRICED), false);
  assert.equal(hasBenchmarkFigures({ basis: "against SPY over the same days" }), false);
  assert.equal(hasBenchmarkFigures({ stats: { benchmarkReturn: 0.05 } }), true);
  assert.equal(hasBenchmarkFigures({ items: [{ symbol: "SPY", changePct: 0.4 }] }), true, "market_snapshot's SPY row");
  assert.equal(hasBenchmarkFigures(WINDOWED), true);
});

test("windowOf reads a result's window, or a backtest's spec dates", () => {
  assert.deepEqual(windowOf("congress_leaders", ALL_TIME_UNPRICED), { all: true, from: "2025-06-02", to: "2026-10-08", days: null, basis: "disclosure date (filed)" });
  assert.equal(windowOf("contracts", { window: { from: "2026-09-09", to: "2026-10-09" } }).days, 30);
  assert.equal(windowOf("ticker_dossier", { quote: {} }), null);
});

/* ---------- the leaderboard window and benchmark status ---------- */

const TRADES = [
  { id: "a", side: "buy", traded: "2026-08-01", filed: "2026-09-20" },
  { id: "b", side: "buy", traded: "2026-09-25", filed: "2026-10-01" },
  { id: "c", side: "sell", traded: "2025-06-01", filed: "2025-06-02" }
];

test("applyWindow keeps rows by disclosure date by default, by trade date on request, and says what it covered", () => {
  const all = applyWindow(TRADES, { today: "2026-10-09" });
  assert.equal(all.trades.length, 3);
  assert.deepEqual(all.window, { all: true, from: "2025-06-02", to: "2026-10-01", basis: "disclosure date (filed)", note: "No window requested: every disclosure the app holds, disclosure date (filed) 2025-06-02 to 2026-10-01." });
  const filed = applyWindow(TRADES, { days: 30, today: "2026-10-09" });
  assert.deepEqual(filed.trades.map((t) => t.id), ["a", "b"]);
  assert.deepEqual(filed.window, { all: false, from: "2026-09-09", to: "2026-10-09", days: 30, basis: "disclosure date (filed)", rows: 2 });
  const traded = applyWindow(TRADES, { days: 30, basis: "traded", today: "2026-10-09" });
  assert.deepEqual(traded.trades.map((t) => t.id), ["b"]);
  assert.equal(traded.window.basis, "trade date");
  assert.deepEqual(applyWindow(TRADES, { from: "2025-01-01", to: "2025-12-31", today: "2026-10-09" }).trades.map((t) => t.id), ["c"]);
});

test("benchmarkStatus is null with a reason whenever there is no SPY figure, never a bare 0", () => {
  const loading = benchmarkStatus({ lastClose: null, buys: 60, pricedBuys: 0, scoredMembers: 0, minBuys: 10, progress: { running: true, total: 301, priced: 0 } });
  assert.equal(loading.benchmarkComparison, null);
  assert.match(loading.benchmarkComparisonReason, /still loading after a server start \(0 of 300 symbols/);
  assert.match(benchmarkStatus({ lastClose: null, buys: 1, pricedBuys: 0, scoredMembers: 0, minBuys: 10, warm: false }).benchmarkComparisonReason, /INTEL_NO_WARM/);
  assert.match(benchmarkStatus({ lastClose: "2026-10-08", buys: 9, pricedBuys: 0, scoredMembers: 0, minBuys: 3 }).benchmarkComparisonReason, /None of the 9 disclosed buys in this window has a priced entry/);
  assert.match(benchmarkStatus({ lastClose: "2026-10-08", buys: 9, pricedBuys: 4, scoredMembers: 0, minBuys: 3 }).benchmarkComparisonReason, /no member has the 3 priced buys/);
  const ok = benchmarkStatus({ lastClose: "2026-10-08", buys: 60, pricedBuys: 41, scoredMembers: 4, minBuys: WINDOW_MIN_BUYS });
  assert.equal(ok.benchmarkComparison.benchmark, "SPY");
  assert.equal(ok.benchmarkComparison.pricedBuys, 41);
  assert.equal(ok.benchmarkComparisonReason, "");
});

/* ---------- tools ---------- */

test("congress_leaders passes the window and waits for prices; its result leads with window and benchmark status", async () => {
  const seen = [];
  const call = async (_db, id, _p, query) => { seen.push([id, query]); return { ok: true, source: "s", window: { all: false, days: 30 }, benchmarkComparison: null, benchmarkComparisonReason: "r", excessTop: Array(25).fill({}), longest: [1], progress: {} }; };
  const out = await TOOLS.find((t) => t.name === "congress_leaders").run({}, { days: 30, basis: "traded" }, call);
  assert.deepEqual(seen, [["congress.leaders", "days=30&basis=traded&wait=1"]]);
  assert.deepEqual(Object.keys(out).slice(0, 7), ["ok", "source", "asOf", "latency", "window", "benchmarkComparison", "benchmarkComparisonReason"]);
  assert.equal(out.excessTop.length, 10);
  assert.equal(out.longest, undefined);
  await TOOLS.find((t) => t.name === "congress_leaders").run({}, { from: "nope" }, call);
  assert.deepEqual(seen[1], ["congress.leaders", "wait=1"], "no window: all available");
});

test("congress_feed takes a starting window; insiders are cut to a filing-date window and say what they cover", async () => {
  const seen = [];
  await TOOLS.find((t) => t.name === "congress_feed").run({}, { days: 30 }, async (_d, id, _p, q) => { seen.push([id, q]); return { ok: true }; });
  assert.deepEqual(seen, [["congress.feed", "days=30"]]);
  const body = { ok: true, source: "SEC", items: [{ filed: "2026-10-05" }, { filed: "2026-08-01" }] };
  const cut = windowItems(body, { days: 30, today: "2026-10-09", basis: "Form 4 filing date" });
  assert.equal(cut.items.length, 1);
  assert.equal(cut.itemsBeforeWindow, 2);
  assert.deepEqual(cut.window, { all: false, from: "2026-09-09", to: "2026-10-09", days: 30, basis: "Form 4 filing date", rows: 1 });
  assert.deepEqual(windowItems(body, { basis: "Form 4 filing date", coverage: "latest eight" }).window, { all: true, from: "2026-08-01", to: "2026-10-05", basis: "Form 4 filing date", coverage: "latest eight" });
});

test("buildFeed starts at the requested window and labels its basis", () => {
  const rows = ["A", "B", "C", "D", "E"].map((p, i) => ({ id: p, bioguide: `${p}000001`, person: p, filed: `2026-09-1${i}`, traded: "2026-09-01", symbol: "NVDA", side: "buy" }));
  const f = buildFeed(rows, { today: "2026-09-30", days: 30 });
  assert.equal(f.window.days, 30);
  assert.equal(f.window.fallback, false);
  assert.equal(f.window.basis, "disclosure date (filed)");
});

test("the system prompt forbids windows and comparisons the tools did not return", () => {
  const p = systemPrompt("2026-10-09");
  assert.match(p, /Never state a time window or a comparison/);
  assert.match(p, /If `benchmarkComparison` is null, say there is no SPY comparison/);
  assert.match(p, /pass days \(or from\/to\) to congress_leaders, congress_feed, insiders, and contracts/);
});
