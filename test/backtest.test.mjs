import { test } from "node:test";
import assert from "node:assert/strict";
import { amountMid, dayOf, firstAfter, isoOf, maxDrawdown, median, runBacktest, simulateTrade } from "../shared/backtest.mjs";
import { cleanSpec, decodeSpec, describeSpec, encodeSpec, specHash, specKey } from "../shared/backtestSpec.mjs";

const START = dayOf("2025-03-03"); // a Monday

/** Daily bars from `START`. `days` is how many calendar days; open and close come from the functions. */
function bars(n, close, open = close, skip = () => false) {
  const out = [];
  for (let i = 0; i < n; i += 1) if (!skip(i)) out.push([START + i, open(i), close(i)]);
  return out;
}
const flat = (n, v = 100, skip) => bars(n, () => v, () => v, skip);
const sig = (over = {}) => ({ id: "s1", symbol: "AAA", signalDate: isoOf(START + 2), side: "buy", ...over });
const run = (over) => runBacktest({ rules: { holdDays: 10, slippageBps: 0, benchmark: "SPY" }, benchBars: { SPY: flat(60) }, ...over });

test("entry is strictly after the public date, even when that day has a bar", () => {
  const stock = bars(60, (i) => 100 + i, (i) => 1000 + i);
  const out = run({ signals: [sig()], bars: { AAA: stock } });
  const t = out.trades[0];
  assert.equal(t.signal, isoOf(START + 2));
  assert.equal(t.entry, isoOf(START + 3));
  assert.ok(t.entry > t.signal);
  assert.equal(t.entryPrice, 1003, "open of the day after, not the open of the filing day");
});

test("nextClose enters at the close of the day after the filing", () => {
  const stock = bars(60, (i) => 100 + i, (i) => 500);
  const out = run({ rules: { entry: "nextClose", holdDays: 10, slippageBps: 0, benchmark: "SPY" }, signals: [sig()], bars: { AAA: stock } });
  assert.equal(out.trades[0].entry, isoOf(START + 3));
  assert.equal(out.trades[0].entryPrice, 103);
  assert.equal(out.trades[0].exit, isoOf(START + 13));
  assert.equal(out.trades[0].exitPrice, 113);
  assert.equal(out.trades[0].ret, Math.round((113 / 103 - 1) * 1e4) / 1e4);
});

test("known answer: +10% over the hold against a flat benchmark", () => {
  // open 100 on the entry day, close 110 on the exit day, linear in between
  const stock = bars(60, (i) => (i >= 3 ? 100 + (i - 3) : 100), () => 100);
  const out = run({ signals: [sig()], bars: { AAA: stock } });
  const t = out.trades[0];
  assert.equal(t.entryPrice, 100);
  assert.equal(t.exitPrice, 110);
  assert.equal(t.days, 10);
  assert.equal(t.ret, 0.1);
  assert.equal(t.bench, 0);
  assert.equal(t.excess, 0.1);
  assert.ok(Math.abs(out.stats.total - 0.1) < 1e-3, "daily compounding of one position equals the trade return");
  assert.equal(out.stats.benchmarkTotal, 0);
  assert.equal(out.stats.hitRate, 1);
  assert.equal(out.stats.beatRate, 1);
});

test("drawdown is peak to trough on the curve", () => {
  assert.equal(maxDrawdown([1, 1.2, 0.9, 1.1]).depth, 0.9 / 1.2 - 1);
  assert.equal(maxDrawdown([1, 1.1, 1.2]).depth, 0);
  const d = maxDrawdown([1, 2, 1, 1.5, 0.75, 1], ["a", "b", "c", "d", "e", "f"]);
  assert.equal(d.depth, 0.75 / 2 - 1);
  assert.equal(d.from, "b");
  assert.equal(d.to, "e");
});

test("engine drawdown matches a hand-built path", () => {
  const closes = [100, 100, 100, 100, 120, 90, 110, 110, 110, 110, 110, 110, 110];
  const stock = bars(closes.length, (i) => closes[i], () => 100);
  const out = runBacktest({
    rules: { holdDays: 9, slippageBps: 0, benchmark: "SPY", entry: "nextClose" },
    signals: [sig({ signalDate: isoOf(START + 2) })],
    bars: { AAA: stock },
    benchBars: { SPY: flat(30) }
  });
  // entry close at day 3 (100); closes 120, 90, 110 → peak 1.2, trough 0.9
  assert.ok(Math.abs(out.stats.maxDrawdown - (0.9 / 1.2 - 1)) < 1e-3);
  assert.equal(out.stats.drawdownTo, isoOf(START + 5));
});

test("benchmark stays aligned over a holiday it does not trade", () => {
  // stock trades every day; the benchmark has no bar on day 8 (a holiday there). Benchmark rises 1/day otherwise.
  const bench = bars(60, (i) => 100 + i, (i) => 100 + i, (i) => i === 8);
  const stock = flat(60);
  const out = run({ signals: [sig()], bars: { AAA: stock }, benchBars: { SPY: bench } });
  const t = out.trades[0];
  // entry open day 3 → bench open 103; exit close day 13 → bench close 113
  assert.equal(t.bench, Math.round((113 / 103 - 1) * 1e4) / 1e4);
  const holiday = out.curve.find((p) => p.d === isoOf(START + 8));
  const before = out.curve.find((p) => p.d === isoOf(START + 7));
  assert.equal(holiday.b, before.b, "no benchmark move on its closed day");
  assert.ok(Math.abs(out.curve.at(-1).b - 1 - t.bench) < 2e-4);
});

test("benchmark with no history before the entry excludes the trade instead of inventing a return", () => {
  const bench = bars(60, () => 100).filter((b) => b[0] > START + 5);
  const out = run({ signals: [sig()], bars: { AAA: flat(60) }, benchBars: { SPY: bench } });
  assert.equal(out.counts.used, 0);
  assert.equal(out.caveats.exclusions.noBenchmark, 1);
});

test("amountMid reads a disclosed range", () => {
  assert.equal(amountMid("$15,001 - $50,000"), 32500.5);
  assert.equal(amountMid("$1,000,001 - $5,000,000"), 3000000.5);
  assert.equal(amountMid("Over $50,000,000"), 50000000);
  assert.equal(amountMid("", 1001), 1001);
});

test("range-midpoint sizing weights positions by disclosed size", () => {
  const winner = bars(60, (i) => (i === 4 ? 110 : 100), () => 100);
  const flatter = flat(60);
  const signals = [
    sig({ id: "a", symbol: "WIN", sizeHint: 10000, sizeIsRange: true }),
    sig({ id: "b", symbol: "FLT", sizeHint: 30000, sizeIsRange: true })
  ];
  const input = { signals, bars: { WIN: winner, FLT: flatter }, benchBars: { SPY: flat(60) } };
  const equal = runBacktest({ ...input, rules: { holdDays: 1, entry: "nextClose", slippageBps: 0, benchmark: "SPY", sizing: "equal" } });
  const sized = runBacktest({ ...input, rules: { holdDays: 1, entry: "nextClose", slippageBps: 0, benchmark: "SPY", sizing: "amountMid" } });
  assert.ok(Math.abs(equal.stats.total - 0.05) < 1e-3);
  assert.ok(Math.abs(sized.stats.total - 0.025) < 1e-3);
  assert.ok(sized.caveats.items.some((c) => c.id === "ranges" && /estimate/.test(c.text)));
  assert.equal(equal.stats.avgTrade, 0.05, "trade stats ignore weights");
});

test("costs and slippage come off every trade, entry and exit", () => {
  const stock = bars(60, (i) => (i >= 3 ? 100 + (i - 3) : 100), () => 100);
  const out = runBacktest({ rules: { holdDays: 10, costBps: 10, slippageBps: 15, benchmark: "SPY" }, signals: [sig()], bars: { AAA: stock }, benchBars: { SPY: flat(60) } });
  assert.equal(out.trades[0].ret, Math.round((0.1 - 0.005) * 1e4) / 1e4);
  assert.ok(Math.abs(out.stats.total - 0.095) < 2e-3);
});

test("stop loss and take profit exit on the first qualifying close", () => {
  const down = bars(60, (i) => (i < 5 ? 100 : 90), () => 100);
  const stopped = run({ rules: { holdDays: 30, stopLossPct: 8, slippageBps: 0, benchmark: "SPY" }, signals: [sig()], bars: { AAA: down } });
  assert.equal(stopped.trades[0].why, "stop");
  assert.equal(stopped.trades[0].exit, isoOf(START + 5));
  assert.equal(stopped.trades[0].ret, -0.1);
  const up = bars(60, (i) => (i < 6 ? 100 : 130), () => 100);
  const took = run({ rules: { holdDays: 30, takeProfitPct: 20, slippageBps: 0, benchmark: "SPY" }, signals: [sig()], bars: { AAA: up } });
  assert.equal(took.trades[0].why, "take");
  assert.equal(took.trades[0].ret, 0.3);
});

test("a short sells the stock and mirrors the benchmark", () => {
  const stock = bars(60, (i) => (i >= 13 ? 90 : 100), () => 100);
  const bench = bars(60, (i) => (i >= 13 ? 95 : 100));
  const out = runBacktest({
    rules: { holdDays: 10, sides: "sell", slippageBps: 0, benchmark: "SPY" },
    signals: [sig({ side: "sell" }), sig({ id: "b", side: "buy" })],
    bars: { AAA: stock },
    benchBars: { SPY: bench }
  });
  assert.equal(out.counts.used, 1);
  assert.equal(out.trades[0].ret, 0.1);
  assert.equal(out.trades[0].bench, 0.05);
  assert.equal(out.trades[0].excess, 0.05);
  assert.ok(out.caveats.items.some((c) => c.id === "short"));
  assert.equal(out.counts.offeredSignals, 2);
  assert.equal(out.counts.signals, 1, "only the selected side is counted");
});

test("signals that cannot be priced are excluded and counted, never zeroed", () => {
  const out = run({
    signals: [
      sig({ id: "ok" }),
      sig({ id: "gone", symbol: "DEAD" }),
      sig({ id: "late", signalDate: isoOf(START + 59) }),
      sig({ id: "open", signalDate: isoOf(START + 55) }),
      sig({ id: "bad", signalDate: "" })
    ],
    bars: { AAA: flat(60) }
  });
  assert.equal(out.counts.used, 1);
  assert.equal(out.caveats.exclusions.noPrice, 1);
  assert.deepEqual(out.caveats.excludedSymbols.noPrice, ["DEAD"]);
  assert.equal(out.caveats.exclusions.noBarAfterSignal, 1);
  assert.equal(out.caveats.exclusions.stillOpen, 1);
  assert.equal(out.caveats.exclusions.badDate, 1);
  assert.equal(out.counts.skipped, 4);
  const text = out.caveats.items.map((c) => c.text).join("\n");
  assert.match(text, /DEAD/);
  assert.match(text, /Survivorship/);
});

test("open trades are marked at the last close only when asked", () => {
  const stock = bars(60, (i) => 100 + i, () => 100);
  const marked = run({ rules: { holdDays: 90, openTrades: "mark", slippageBps: 0, benchmark: "SPY" }, signals: [sig()], bars: { AAA: stock } });
  assert.equal(marked.trades[0].open, true);
  assert.equal(marked.trades[0].why, "open");
  assert.equal(marked.trades[0].exit, isoOf(START + 59));
});

test("disclosure lag statistics come from the filing and trade dates", () => {
  const out = run({
    signals: [
      sig({ id: "1", tradeDate: isoOf(START - 10) }),
      sig({ id: "2", symbol: "BBB", tradeDate: isoOf(START - 48) })
    ],
    bars: { AAA: flat(60), BBB: flat(60) }
  });
  assert.equal(out.caveats.lag.n, 2);
  assert.equal(out.caveats.lag.max, 50);
  assert.equal(out.caveats.lag.over45, 1);
});

test("a tiny sample says so", () => {
  const out = run({ signals: [sig()], bars: { AAA: flat(60) } });
  assert.ok(out.caveats.items.some((c) => c.id === "sample" && c.level === "warn"));
});

test("sector benchmark uses each ticker's ETF and falls back to SPY", () => {
  const out = runBacktest({
    rules: { holdDays: 10, slippageBps: 0, benchmark: "SECTOR" },
    signals: [sig({ id: "1", sector: "Energy" }), sig({ id: "2", symbol: "BBB", sector: "Unknown" })],
    bars: { AAA: flat(60), BBB: flat(60) },
    benchBars: { XLE: bars(60, (i) => 100 + i, (i) => 100 + i), SPY: flat(60) }
  });
  const a = out.trades.find((t) => t.symbol === "AAA");
  const b = out.trades.find((t) => t.symbol === "BBB");
  assert.equal(a.benchmark, "XLE");
  assert.ok(a.bench > 0);
  assert.equal(b.benchmark, "SPY");
  assert.equal(b.bench, 0);
});

test("breakdowns group by member and ticker", () => {
  const out = run({
    signals: [
      sig({ id: "1", actor: "A1", actorLabel: "Ann" }),
      sig({ id: "2", actor: "A1", actorLabel: "Ann" }),
      sig({ id: "3", symbol: "BBB", actor: "B1", actorLabel: "Bob" })
    ],
    bars: { AAA: flat(60), BBB: flat(60) }
  });
  assert.equal(out.byMember.rows[0].label, "Ann");
  assert.equal(out.byMember.rows[0].n, 2);
  assert.equal(out.byTicker.total, 2);
});

test("firstAfter and median helpers", () => {
  const b = [[10, 1, 1], [12, 1, 1], [15, 1, 1]];
  assert.equal(firstAfter(b, 9), 0);
  assert.equal(firstAfter(b, 10), 1);
  assert.equal(firstAfter(b, 15), -1);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const lone = simulateTrade({}, [[START, 100, 100]], flat(5), { entry: "nextOpen", holdDays: 3, openTrades: "exclude", costBps: 0, slippageBps: 0 }, START - 1, 1);
  assert.equal(lone.skip, "stillOpen");
});

test("spec cleaning clamps, drops unknowns, and round-trips through the share token", () => {
  const bad = cleanSpec({ source: "nope" });
  assert.equal(bad.ok, false);
  assert.equal(cleanSpec({ source: "lobbying" }).ok, false, "lobbying needs tickers");
  const { spec } = cleanSpec({
    source: "congress",
    filters: { committee: "Armed Services", tickers: "lmt, rtx lmt $$$", party: "x", minAmount: -5, evil: 1 },
    rules: { holdDays: 99999, benchmark: "NOPE", entry: "magic", costBps: 5000 }
  });
  assert.deepEqual(spec.filters.tickers, ["LMT", "RTX"]);
  assert.equal(spec.filters.party, "");
  assert.equal(spec.filters.minAmount, 0);
  assert.equal(spec.filters.evil, undefined);
  assert.equal(spec.rules.holdDays, 730);
  assert.equal(spec.rules.benchmark, "SPY");
  assert.equal(spec.rules.entry, "nextOpen");
  assert.equal(spec.rules.costBps, 300);
  assert.deepEqual(decodeSpec(encodeSpec(spec)), spec);
  assert.equal(decodeSpec("not a token"), null);
  assert.equal(specHash(spec), specHash(JSON.parse(JSON.stringify(spec))));
  assert.notEqual(specHash(spec), specHash({ ...spec, rules: { ...spec.rules, holdDays: 30 } }));
  assert.equal(specKey({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
  assert.match(describeSpec(spec), /Armed Services members/);
  assert.match(describeSpec(spec), /open after the public date/);
});

test("a one-name sample and a price-index benchmark are called out", () => {
  const many = Array.from({ length: 6 }, (_, i) => sig({ id: `a${i}`, actor: "A", actorLabel: "Heavy Trader" }));
  const out = runBacktest({
    rules: { holdDays: 10, slippageBps: 0, benchmark: "^GSPC" },
    signals: [...many, sig({ id: "b", actor: "B", actorLabel: "Light" })],
    bars: { AAA: flat(60) },
    benchBars: { "^GSPC": flat(60) }
  });
  const text = out.caveats.items.map((c) => c.id);
  assert.ok(text.includes("concentration"));
  assert.ok(text.includes("priceIndex"));
  assert.match(out.caveats.items.find((c) => c.id === "concentration").text, /Heavy Trader accounts for 6 of 7/);
});
