import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeBars,
  windowStart,
  intervalReason,
  defaultInterval,
  sma,
  ema,
  rsi,
  indicators,
  cleanLayout,
  requestGuard,
  DAY,
} from "../shared/chartWorkspace.mjs";
import { parseWindow } from "../server/chartWindow.mjs";
const bar = (t, c = 10) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 100 });
test("chart windows distinguish range from interval and reject unsupported coverage", () => {
  const now = Date.UTC(2026, 9, 20);
  assert.equal(windowStart("ytd", now), Date.UTC(2026, 0, 1));
  assert.equal(windowStart("max", now), 0);
  assert.ok(intervalReason("1m", "1mo", now));
  assert.ok(intervalReason("4h", "1d", now));
  assert.equal(intervalReason("1h", "1mo", now), "");
  assert.equal(defaultInterval("5y"), "1wk");
});
test("window merge sorts and deduplicates without creating missing sessions or accepting invalid OHLC", () => {
  const a = bar(1000),
    b = bar(3000);
  assert.deepEqual(
    mergeBars([b, a], [{ ...a, c: 10.5 }, bar(2000, NaN)]).map((v) => [v.t, v.c]),
    [
      [1000, 10.5],
      [3000, 10],
    ],
  );
  assert.equal(mergeBars([{ ...a, v: null }])[0].v, null);
  assert.equal(mergeBars([{ ...a, h: 0 }]).length, 0);
});
test("Yahoo parser preserves timestamp and precision, adjusts all OHLC consistently, never fabricates absent prices", () => {
  const body = {
    chart: {
      result: [
        {
          timestamp: [30, 10, 20, 30],
          meta: {},
          indicators: {
            quote: [
              {
                open: [100.123456, 2, null, 101],
                high: [110, 3, 5, 110],
                low: [90, 1, 2, 95],
                close: [105, 2, 4, 105],
                volume: [4, 3, 9, 7],
              },
            ],
            adjclose: [{ adjclose: [52.5, 1, 2, 52.5] }],
          },
        },
      ],
    },
  };
  const raw = parseWindow(body).bars,
    adj = parseWindow(body, { adjusted: true }).bars;
  assert.deepEqual(
    raw.map((b) => b.t),
    [10000, 30000],
  );
  assert.equal(raw[1].o, 101);
  assert.equal(adj[1].o, 50.5);
  assert.equal(adj[1].h, 55);
  assert.equal(adj[1].v, 7);
  assert.throws(() => parseWindow({ chart: { error: { description: "Unavailable" } } }), /Unavailable/);
});
test("indicator warmup, EMA seeding, RSI flat/rising/falling, and MACD signal alignment", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assert.deepEqual(ema([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assert.equal(rsi(Array(20).fill(10))[19], 50);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i))[19], 100);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => 30 - i))[19], 0);
  const out = indicators(Array.from({ length: 50 }, (_, i) => bar(1700000000000 + i * DAY, 10)));
  assert.equal(out.macd[24], null);
  assert.equal(out.signal[32], null);
  assert.equal(out.signal[33], 0);
});
test("session VWAP uses exchange-local dates at timezone boundaries", () => {
  const a = bar(Date.parse("2026-10-20T23:55:00Z"), 10),
    b = bar(Date.parse("2026-10-21T00:05:00Z"), 20);
  assert.equal(indicators([a, b], "America/New_York").vwap[1], 15);
  assert.equal(indicators([a, b], "UTC").vwap[1], 20);
});
test("saved layouts whitelist fields and reject corrupted persistence without storing credentials", () => {
  const l = cleanLayout({
    mode: "four",
    active: 999,
    secret: "token",
    panels: [
      { symbol: "NVDA", group: "A", credential: "x" },
      { symbol: "<script>", group: "secret" },
    ],
  });
  assert.equal(l.active, 3);
  assert.equal(cleanLayout({ active: 1.5 }).active, 1);
  assert.equal(l.panels[1].symbol, "AAPL");
  assert.equal(l.panels[0].group, "A");
  assert.equal(JSON.stringify(l).includes("token"), false);
  assert.equal(cleanLayout(null).panels.length, 4);
});
test("obsolete responses cannot write after rapid instrument changes", async () => {
  const g = requestGuard();
  const old = g.next();
  const next = g.next();
  let value = "MSFT";
  await Promise.resolve().then(() => {
    if (g.current(old)) value = "AAPL";
  });
  assert.equal(value, "MSFT");
  assert.ok(g.current(next));
  g.next();
  assert.equal(g.current(next), false);
});
test("large available-style dataset stays sorted, lossless, and finite", () => {
  const bars = Array.from({ length: 20000 }, (_, i) => bar(1000000000000 + i * 60000, 100 + i / 100));
  const out = mergeBars(bars.slice().reverse(), bars.slice(-50));
  assert.equal(out.length, 20000);
  assert.equal(out.at(-1).c, bars.at(-1).c);
  assert.equal(indicators(out).rsi.length, 20000);
});
import { aggregateCalendar, mergeTrailingQuote, cleanChartContext } from "../shared/chartWorkspace.mjs";
import { cleanAsk } from "../shared/ask.mjs";
import { contextNote } from "../shared/agent.mjs";
test("weekly aggregation uses actual session bars through holiday gaps, including DST, and sums volume once", () => {
  const a = bar(Date.parse("2026-03-06T14:30:00Z"), 10),
    b = bar(Date.parse("2026-03-09T13:30:00Z"), 20),
    c = bar(Date.parse("2026-03-11T13:30:00Z"), 30);
  const out = aggregateCalendar([c, a, b], "1wk", "America/New_York");
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { t: Date.parse("2026-03-09T00:00:00Z"), o: 20, h: 31, l: 19, c: 30, v: 200 });
});
test("monthly OHLC aggregation keeps unknown volume unknown and does not create missing months", () => {
  const a = bar(Date.parse("2026-01-02T14:30:00Z")),
    b = { ...bar(Date.parse("2026-03-02T14:30:00Z")), v: null };
  const out = aggregateCalendar([a, b], "1mo", "America/New_York");
  assert.equal(out.length, 2);
  assert.equal(out[1].v, null);
});
test("trailing intraday quote updates the forming candle without adding a second candle or volume", () => {
  const a = bar(100000, 10),
    q = { t: 150000, o: 12, h: 12, l: 12, c: 12, v: 0 };
  const out = mergeTrailingQuote([a, q], "1m");
  assert.deepEqual(out, [{ ...a, h: 12, c: 12 }]);
  assert.equal(mergeTrailingQuote([a, { ...q, t: 160000 }], "1m").length, 2);
});
test("reviewed handoff retains long evidence as explicit context without question truncation", () => {
  const chart = {
    symbol: "AAPL",
    interval: "1d",
    from: "2026-01-01",
    to: "2026-02-01",
    events: [
      {
        label: "Event",
        eventDate: "2026-01-02",
        publicationDate: null,
        ingestedAt: null,
        datasetVersion: "v1",
        amount: "$1,001–$15,000",
        source: "https://example.org/filing",
        dateBasis: "Transaction",
        limitation: "x".repeat(1000),
      },
    ],
  };
  const clean = cleanChartContext(chart);
  assert.equal(clean.events[0].limitation.length, 1000);
  assert.equal(clean.events[0].publicationDate, null);
  assert.equal(cleanChartContext({ ...chart, events: Array(21).fill(chart.events[0]) }), null);
  const asked = cleanAsk({ question: "Review attached chart.", context: { node: "item:chart-AAPL", chart } });
  assert.equal(asked.context.chart.events[0].datasetVersion, "v1");
  assert.match(contextNote(asked.context), /Exclude unknown publication dates/);
});
