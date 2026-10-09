import { test } from "node:test";
import assert from "node:assert/strict";
import { countClaims, labelsFor, mislabelNote, mislabeledCounts } from "../shared/countLabels.mjs";
import { evidenceOf, groundingCheck, systemPrompt } from "../shared/ask.mjs";
import { countsForModel, summarizeBacktest } from "../server/ai/tools.mjs";
import { runAsk } from "../server/ai/run.mjs";

/** What run_backtest returned in the real answer that said "117 tickers": 117 was the paper filings the app cannot read. */
const BACKTEST = summarizeBacktest({
  ok: true, description: "Congress buys", spec: { source: "congress" },
  counts: { signals: 412, offeredSignals: 650, used: 388, skipped: 24, matched: 650, tickers: 143, priced: 139, unparsedPaperFilings: 117, unreadElectronicReports: 3 },
  stats: { trades: 388, total: 0.081, benchmarkTotal: 0.066, excessTotal: 0.015 },
  byMember: { rows: [] }, byTicker: { rows: [] },
  caveats: { items: [{ level: "warn", text: "117 scanned paper filings in the window (images the app cannot read; a count of filings, not of tickers or trades) are not parsed, so their trades are missing from the signal set." }] },
  feeds: [{ label: "Signals", source: "House Clerk", asOf: "2026-10-09" }], asOf: "2026-10-09", latency: "l"
});
const EV = [evidenceOf("t1", "run_backtest", {}, BACKTEST)];

test("backtest counts reach the model under names that say what they count", () => {
  assert.deepEqual(BACKTEST.counts, {
    matchedSignals: 650, signalsOnChosenSides: 412, tradesPriced: 388, signalsNotPriced: 24,
    distinctTickersMatched: 143, tickersWithPriceHistory: 139, unparsedPaperFilings: 117, unreadElectronicReports: 3
  });
  assert.deepEqual(countsForModel({ used: 2 }), { tradesPriced: 2 }, "absent counts are left out, not zeroed");
});

test("countClaims reads a count and its unit in prose and in tables", () => {
  assert.deepEqual(countClaims("It covered 117 tickers [t1] and 388 trades.").map((c) => [c.value, c.unit, c.family]), [[117, "tickers", "tickers"], [388, "trades", "trades"]]);
  assert.deepEqual(countClaims("across 143 distinct tickers").map((c) => c.value), [143]);
  assert.deepEqual(countClaims("| Tickers | 143 |").map((c) => [c.value, c.family]), [[143, "tickers"]]);
  assert.deepEqual(countClaims("Up 8.1% with 1.5% excess over 90 days, $117 million."), [], "percents, money and days are not counts of things");
});

test("labelsFor finds a number under its key and beside the words that follow it in text", () => {
  const labels = labelsFor(JSON.parse(EV[0].json), 117);
  assert.ok(labels.includes("counts.unparsedPaperFilings"));
  assert.ok(labels.some((l) => /scanned paper filings/.test(l)));
});

test("the 117 tickers case: 117 is in the tool output, but only as paper filings, so the answer is flagged", () => {
  const answer = "Using: Congress buys. The run covered 117 tickers [t1] and 388 trades [t1], 8.1% vs 6.6% for SPY [t1].";
  const g = groundingCheck(answer, EV);
  assert.deepEqual(g.unmatched, [], "the plain number check passes: 117 does appear in the tool output");
  assert.equal(g.mislabeled.length, 1);
  assert.equal(g.mislabeled[0].raw, "117 tickers");
  assert.ok(g.mislabeled[0].foundAs.includes("counts.unparsedPaperFilings"));
  assert.match(mislabelNote(g.mislabeled[0]), /^The answer says “117 tickers”, but 117 in the tool results is .*unparsedPaperFilings.*not a count of tickers\./);
});

test("correctly labeled counts pass, including generic list totals", () => {
  for (const ok of ["117 paper filings could not be read [t1].", "143 distinct tickers matched [t1].", "388 trades [t1].", "650 signals matched [t1]."]) {
    assert.deepEqual(groundingCheck(ok, EV).mislabeled, [], ok);
  }
  const list = [evidenceOf("t2", "congress_feed", {}, { ok: true, items: { items: [], total: 55, truncated: true } })];
  assert.deepEqual(groundingCheck("55 members filed this week [t2].", list).mislabeled, [], "a bare total says nothing, so it is not called a mislabel");
  assert.deepEqual(mislabeledCounts("There were 999 tickers.", [{ n: 5 }]), [], "a number found nowhere is the plain check's job");
});

test("a named count beats a generic list total: '1015 Form 4 filings' when 1015 is transaction lines is flagged", () => {
  const insiders = [evidenceOf("t3", "insiders", { days: 30 }, { ok: true, counts: { transactionLines: 1015, forms: 212, issuers: 88 }, items: { items: [], total: 1015, truncated: true } })];
  const g = groundingCheck("There were 1015 Form 4 filings in the period [t3].", insiders);
  assert.deepEqual(g.mislabeled.map((m) => [m.raw, m.foundAs[0]]), [["1015 Form", "counts.transactionLines"]]);
  assert.doesNotMatch(mislabelNote(g.mislabeled[0]), /“\?/, "the generic-key marker is not shown to the user");
  assert.deepEqual(groundingCheck("1015 transaction lines on 212 Form 4 filings [t3].", insiders).mislabeled, []);
  const feed = [evidenceOf("t2", "congress_feed", { days: 30 }, { ok: true, counts: { trades: 354, reports: 61, members: 21 } })];
  assert.deepEqual(groundingCheck("354 congressional filings from 21 members [t2].", feed).mislabeled.map((m) => m.raw), ["354 congressional filings"]);
  assert.deepEqual(groundingCheck("354 trades in 61 reports from 21 members [t2].", feed).mislabeled, []);
});

test("the system prompt tells the model to name what each count measures", () => {
  assert.match(systemPrompt("2026-10-09"), /Every count you quote must name what it counts/);
  assert.match(systemPrompt("2026-10-09"), /unparsedPaperFilings are paper filings the app cannot read, not tickers/);
});

test("runAsk puts a mislabeled count at the top of the answer's caveats", async () => {
  const events = [];
  const turns = [
    [{ type: "tool_call", id: "c1", name: "run_backtest", args: { spec: { source: "congress" } } }],
    [{ type: "text", delta: "Using: Congress buys. It covered 117 tickers [t1] over 388 trades [t1], 8.1% vs 6.6% [t1]." }]
  ];
  let i = 0;
  const provider = { async *chat() { for (const ev of turns[i++] || []) yield ev; } };
  await runAsk({
    question: "How did congress buys do?", provider, tools: [{ name: "run_backtest", description: "x", parameters: {} }],
    execute: async () => BACKTEST, emit: (e) => events.push(e), today: "2026-10-09", heartbeatMs: 60_000
  });
  const done = events.find((e) => e.type === "done");
  assert.equal(done.grounding.mislabeled[0].raw, "117 tickers");
  assert.match(done.caveats[0], /^The answer says “117 tickers”/);
});
