import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKET_NOTE, etStamp, hasDisclaimer, marketDisclaimer, marketTail, wantsMarkets } from "../shared/marketAsk.mjs";
import { runMarketSnapshot, snapshotOf } from "../server/ai/marketTool.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { TOOLS, runTool, toolDefs } from "../server/ai/tools.mjs";

const NOW = Date.parse("2026-10-09T13:45:00Z");
const AT = "2026-10-09T13:27:00Z";
const q = (symbol, name, last, changePct, extra = {}) => ({ symbol, name, last, changePct, previousClose: last / (1 + changePct / 100), asOf: AT, ok: true, ...extra });
const GLOBALS = {
  ok: true,
  source: "Yahoo Finance chart (indices, ETFs, ADRs, local lines, USD FX legs)",
  asOf: "2026-10-09T13:44:00Z",
  indices: [
    q("^GSPC", "S&P 500", 6712.345, 0.4321, { open: true }),
    q("^DJI", "Dow Jones Industrial Average", 46210.5, -0.1234),
    q("^IXIC", "Nasdaq Composite", 22987.1, 0.8765),
    q("^RUT", "Russell 2000", 2410.2, 1.1111),
    q("^VIX", "CBOE Volatility Index", 16.42, -3.21),
    q("^FTSE", "FTSE 100", 9400, 0.2)
  ],
  etfs: [q("SPY", "SPDR S&P 500", 669.12, 0.41), q("XLE", "Energy Select Sector SPDR", 88.5, -1.75), { symbol: "XLF", name: "Financial Select Sector SPDR", ok: false }]
};
const MACRO = { ok: true, source: "FRED", items: [{ id: "10y", label: "UST 10Y", value: "4.12%", asOf: "2026-10-08" }, { id: "2y", label: "UST 2Y", value: "3.58%", asOf: "2026-10-08" }] };

/* ---------- routing ---------- */

test("wantsMarkets: market-overview questions route to market_snapshot; backtests, single tickers, and market cap do not", () => {
  for (const s of ["how are the markets today", "How's the market doing?", "how is the stock market", "market overview please", "what is the S&P doing right now", "where is the 10-year yield today", "thoughts on the current markets given recent congress trades"]) {
    assert.equal(wantsMarkets(s), true, s);
  }
  for (const s of ["Backtest the last 30 days from all data sources", "how did NVDA stock do after Pelosi's buy", "what is NVDA's market cap", "Top disclosed buys vs SPY in the last 30 days", "hi", "How did Armed Services members' buys do?"]) {
    assert.equal(wantsMarkets(s), false, s);
  }
});

test("the market note tells the model to use the snapshot, never refuse, and quote the disclaimer", () => {
  assert.match(MARKET_NOTE, /market_snapshot has already run/);
  assert.match(MARKET_NOTE, /Never say you cannot provide market data/);
  assert.match(MARKET_NOTE, /disclaimer/);
  assert.ok(TOOLS.some((t) => t.name === "market_snapshot"));
  assert.match(toolDefs().find((t) => t.name === "market_snapshot").description, /Delayed Yahoo Finance/);
});

/* ---------- tool output ---------- */

test("snapshotOf: US benchmarks only from the board's real symbols, rounded, with source, as-of, delay, and the disclaimer", () => {
  const out = snapshotOf({ globals: GLOBALS, macro: MACRO, now: NOW, ms: 812 });
  assert.equal(out.ok, true);
  assert.equal(out.stale, false);
  assert.deepEqual(out.rows.map((r) => r.symbol), ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX", "SPY", "XLE", "DGS10", "DGS2"]);
  const spx = out.rows[0];
  assert.deepEqual([spx.name, spx.kind, spx.last, spx.changePct, spx.asOf], ["S&P 500", "index", 6712.35, 0.43, AT]);
  assert.deepEqual(out.rows.find((r) => r.symbol === "DGS10"), { symbol: "DGS10", name: "US 10-year Treasury yield", kind: "yield", last: 4.12, unit: "%", changePct: null, previousClose: null, asOf: "2026-10-08" });
  assert.match(out.source, /Yahoo Finance chart/);
  assert.match(out.source, /FRED DGS10/);
  assert.equal(out.asOf, AT);
  assert.equal(out.asOfEt, "09:27 ET, Oct 9");
  assert.equal(out.session, "open");
  assert.match(out.latency, /not a live feed and can trail the exchange by up to about 15–20 min/);
  assert.match(out.latency, /S&P 500 print 18 min before this fetch at 09:45 ET, Oct 9/);
  assert.match(out.latency, /one-day lag \(latest 2026-10-08\)/);
  assert.equal(out.disclaimer, "Delayed data from Yahoo Finance as of 09:27 ET, Oct 9; 10-year yield from FRED as of 2026-10-08. Research only, not investment advice.");
});

test("runMarketSnapshot: a failed live fetch falls back to the last cached board, labelled stale with what failed", async () => {
  const db = { prepare: () => ({ get: () => ({ body: JSON.stringify(GLOBALS), stored_at: Date.parse("2026-10-09T12:00:00Z") }) }) };
  const call = async (_db, id) => (id === "markets.globals" ? { ok: false, error: "Yahoo HTTP 429" } : MACRO);
  const out = await runMarketSnapshot(db, call, { now: () => NOW });
  assert.equal(out.ok, true);
  assert.equal(out.stale, true);
  assert.match(out.note, /Live Yahoo fetch failed \(Yahoo HTTP 429\); these are the last cached quotes, stored 08:00 ET, Oct 9/);
  assert.match(out.disclaimer, /^Last cached data from Yahoo Finance as of 09:27 ET/);
});

test("runMarketSnapshot: no live board and no cache is ok:false with the reason, and the answer tail says so", async () => {
  const out = await runMarketSnapshot({}, async (_db, id) => { if (id === "markets.globals") throw new Error("fetch failed"); return MACRO; }, { now: () => NOW });
  assert.equal(out.ok, false);
  assert.match(out.error, /Yahoo Globals board failed: fetch failed\. No cached board/);
  assert.match(marketTail("", out), /^Market data did not load: Yahoo Globals board failed/);
});

test("runTool runs market_snapshot through the in-process routes it names", async () => {
  const routes = [];
  const out = await runTool(null, "market_snapshot", {}, async (_db, id) => (id === "markets.globals" ? GLOBALS : MACRO), (r) => routes.push(r));
  assert.equal(out.ok, true);
  assert.deepEqual(routes.sort(), ["GET /api/macro/strip", "GET /api/markets/globals"]);
});

test("disclaimer helpers: stamp in ET, detect an existing disclaimer, append once", () => {
  assert.equal(etStamp("2026-10-09T20:05:00Z"), "16:05 ET, Oct 9");
  assert.equal(etStamp(""), "");
  assert.equal(marketDisclaimer({}), "Yahoo Finance quotes did not load. Research only, not investment advice.");
  const d = marketDisclaimer({ asOf: AT });
  assert.equal(hasDisclaimer(`S&P up 0.43% [t1]. ${d}`), true);
  assert.equal(marketTail(`S&P up 0.43% [t1]. ${d}`, { ok: true, disclaimer: d }), "");
  assert.equal(marketTail("S&P up 0.43% [t1].", { ok: true, disclaimer: d }), `\n\n${d}`);
});

/* ---------- through runAsk ---------- */

function scripted(...rounds) {
  const seen = [];
  return { seen, async *chat(messages) { seen.push(messages.map((m) => ({ ...m }))); for (const e of rounds.shift() || [{ type: "text", delta: "done" }]) yield e; } };
}
const TEXT = (t) => [{ type: "text", delta: t }];

async function ask(question, provider) {
  const events = [];
  const ran = [];
  await runAsk({
    question, provider, tools: toolDefs(), labelOf: (n) => n, emit: (e) => events.push(e), today: "2026-10-09", heartbeatMs: 60_000, now: () => NOW,
    execute: async (name) => { ran.push(name); return name === "market_snapshot" ? snapshotOf({ globals: GLOBALS, macro: MACRO, now: NOW }) : { ok: false, error: "unexpected" }; }
  });
  return { events, ran, done: events.find((e) => e.type === "done"), errors: events.filter((e) => e.type === "error") };
}

test("regression: a no-tool refusal answer ends the turn with done and no error event (was 'finish is not defined')", async () => {
  const { done, errors, ran } = await ask("what is the meaning of life", scripted(TEXT("I cannot answer that from the tools I have.")));
  assert.deepEqual(errors, []);
  assert.deepEqual(ran, []);
  assert.equal(done.answer, "I cannot answer that from the tools I have.");
  assert.equal(done.noTools, true);
});

test("runAsk: 'how are the markets today' fetches market_snapshot before the model, answers with grounded figures and the disclaimer", async () => {
  const p = scripted(TEXT("| Index | Last | Day |\n|---|---|---|\n| S&P 500 | 6712.35 | +0.43% [t1] |\n| Nasdaq | 22987.1 | +0.88% [t1] |\n| VIX | 16.42 | -3.21% [t1] |\n\nThe 10-year yield is 4.12% [t1]."));
  const { done, errors, ran, events } = await ask("how are the markets today", p);
  assert.deepEqual(errors, []);
  assert.deepEqual(ran, ["market_snapshot"]);
  const first = p.seen[0];
  assert.match(first[0].content, /market_snapshot has already run/);
  const toolMsg = first.find((m) => m.role === "tool");
  assert.equal(JSON.parse(toolMsg.content).ref, "t1");
  assert.equal(events.find((e) => e.type === "step_start").tool, "market_snapshot");
  assert.ok(done.answer.endsWith("Delayed data from Yahoo Finance as of 09:27 ET, Oct 9; 10-year yield from FRED as of 2026-10-08. Research only, not investment advice."));
  assert.deepEqual(done.cited, ["t1"]);
  assert.deepEqual(done.grounding.unmatched, []);
  assert.ok(done.caveats.some((c) => /Not investment advice/.test(c)));
});

test("runAsk: a small model that still refuses after the snapshot is asked once for the numbers", async () => {
  const p = scripted(TEXT("I cannot provide current market data. Please check a financial news website."), TEXT("S&P 500 6712.35, +0.43% [t1]; Dow 46210.5, -0.12% [t1]."));
  const { done, errors } = await ask("how are the markets today", p);
  assert.deepEqual(errors, []);
  assert.equal(done.retried, true);
  assert.doesNotMatch(done.answer, /cannot provide/);
  assert.ok(hasDisclaimer(done.answer));
  assert.deepEqual(done.grounding.unmatched, []);
});

test("runAsk: a model that already wrote the disclaimer does not get it twice", async () => {
  const d = snapshotOf({ globals: GLOBALS, macro: MACRO, now: NOW }).disclaimer;
  const { done } = await ask("how's the market doing", scripted(TEXT(`S&P 500 6712.35 (+0.43%) [t1]. ${d}`)));
  assert.equal(done.answer.split("not investment advice").length, 2);
});
