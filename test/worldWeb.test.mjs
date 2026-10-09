import { test } from "node:test";
import assert from "node:assert/strict";
import { REGIONS, sessionOf, worldDisclaimer, worldRegions, worldSymbols, worldTail } from "../shared/worldMarkets.mjs";
import { COVERAGE_NOTE, WEB_CAPS, domainOf, htmlToText, splitWebResults, wantsWeb, webQuery } from "../shared/webAsk.mjs";
import { wantsMarkets } from "../shared/marketAsk.mjs";
import { quoteOf, runWorldMarkets, worldOf } from "../server/ai/worldTool.mjs";
import { openrouterResults, privateAddress, webConfig, webPage, webSearch } from "../server/feeds/web.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";

const NOW = Date.parse("2026-10-09T13:58:00Z"); // 09:58 ET; 21:58 in Taipei, exchange closed (and a holiday)
const day = (d, h = 1) => Date.parse(`${d}T0${h}:00:00Z`) / 1000;

/** Yahoo v8 chart for ^TWII: last session Oct 8, closed now. */
const TWII = {
  chart: {
    result: [{
      meta: { symbol: "^TWII", currency: "TWD", exchangeName: "TAI", fullExchangeName: "Taiwan", exchangeTimezoneName: "Asia/Taipei", regularMarketPrice: 49313.44, regularMarketTime: Date.parse("2026-10-08T05:31:15Z") / 1000, regularMarketDayHigh: 49783.06, regularMarketDayLow: 49189.77, chartPreviousClose: 49100, currentTradingPeriod: { regular: { start: day("2026-10-08"), end: Date.parse("2026-10-08T05:30:00Z") / 1000 } } },
      timestamp: [day("2026-10-06"), day("2026-10-07"), day("2026-10-08")],
      indicators: { quote: [{ close: [49500.1, 49822.6, 49313.44] }] }
    }]
  }
};
const NO_SUCH = { chart: { result: null, error: { code: "Not Found" } } };

/** OpenRouter web plugin response: the model's text is ignored, the url_citation annotations are the results. */
const OR_BODY = {
  choices: [{ message: { content: "ignored model text 99,999", annotations: [
    { type: "url_citation", url_citation: { url: "https://www.taiwannews.com.tw/news/6455061", title: "TAIEX logs fourth straight weekly gain", content: "The TAIEX closed down 492.93 points, or 0.99%, at 49,313.44. Turnover totaled NT$869.7 billion. For the week, the index gained 1.73%." } },
    { type: "url_citation", url_citation: { url: "https://www.investing.com/indices/taiwan-weighted", title: "Taiwan Weighted Index Today", content: "49,313.44 -492.93(-0.99%) ... range 49,189.77 to 49,783.06" } },
    { type: "url_citation", url_citation: { url: "https://www.taiwannews.com.tw/news/6455061", title: "dup", content: "dup" } }
  ] } }]
};
const ENV = { OPENROUTER_API_KEY: "test-key-not-real" };
const fakeSearch = (query) => webSearch(query, { env: ENV, fetcher: async () => OR_BODY, now: () => NOW });

/* ---------- routing ---------- */

test("international market phrasings route to world_markets (and the web), US and non-market ones do not", () => {
  const cases = {
    "tell me about the taiwanese market today": ["taiwan"],
    "tell me about the taiwanese market todau": ["taiwan"],
    "Japan stocks": ["japan"],
    "how is the Nikkei": ["japan"],
    "Europe markets": ["europe"],
    "how are European stocks doing": ["europe"],
    "how did the DAX and the FTSE close": ["uk", "germany"],
    "what's the Hang Seng doing": ["hongkong"],
    "Indian market this week": ["india"],
    "KOSPI": ["korea"],
    "global markets today": ["global"],
    "how are the markets today": [],
    "ships in the Taiwan Strait": [],
    "Backtest the last 30 days from all data sources": [],
    "senators on Armed Services": []
  };
  for (const [q, want] of Object.entries(cases)) assert.deepEqual(worldRegions(q), want, q);
  for (const q of ["tell me about the taiwanese market today", "Japan stocks", "what's the latest news on the ECB rate decision", "search the web for TSMC guidance"]) assert.equal(wantsWeb(q), true, q);
  for (const q of ["how are the markets today", "news on Pelosi trades", "backtest insiders"]) assert.equal(wantsWeb(q), false, q);
  assert.equal(webQuery("tell me about the taiwanese market today", "2026-10-09"), "Taiwan stock market TAIEX 2026-10-09 close and main movers");
  assert.equal(wantsMarkets("how are the markets today"), true, "US overview routing unchanged");
});

test("region symbols cover the requested indices; user-named Yahoo symbols pass through, junk does not", () => {
  const all = Object.values(REGIONS).flatMap((r) => r.symbols.map(([s]) => s));
  for (const s of ["^TWII", "^N225", "^HSI", "000001.SS", "^KS11", "^NSEI", "^BSESN", "^FTSE", "^GDAXI", "^FCHI", "^STOXX50E", "^AXJO", "^GSPTSE", "^BVSP", "^MXX"]) assert.ok(all.includes(s), s);
  assert.deepEqual(worldSymbols({ regions: ["taiwan"], symbols: ["2330.tw", "rm -rf /", "^TWII"] }), ["^TWII", "2330.TW"]);
});

/* ---------- world_markets ---------- */

test("a closed exchange reports the last close in exchange time and ET, and says it is not today's trading", () => {
  const q = quoteOf("^TWII", TWII, NOW);
  assert.equal(q.last, 49313.44);
  assert.equal(q.previousClose, 49822.6);
  assert.equal(q.changePct, -1.02);
  assert.equal(q.session, "closed");
  assert.equal(q.asOfLocal, "Oct 8, 13:31 GMT+8");
  assert.equal(q.asOfEt, "01:31 ET, Oct 8");
  assert.equal(q.sessionNote, "Exchange closed now; figures are the last session (last trade Oct 8, 13:31 GMT+8 = 01:31 ET, Oct 8), not today's trading.");
  assert.equal(sessionOf({ asOf: "2026-10-08T05:00:00Z", tz: "Asia/Taipei", period: { start: day("2026-10-08"), end: day("2026-10-08", 5) }, now: Date.parse("2026-10-08T03:00:00Z") }).session, "open");
});

test("world_markets labels source, as-of, latency and disclaimer, and reports a symbol Yahoo does not have", async () => {
  const out = await runWorldMarkets({ regions: ["taiwan"], symbols: ["NOPE.XX"] }, { now: () => NOW, chart: async (s) => (s === "^TWII" ? TWII : NO_SUCH) });
  assert.equal(out.ok, true);
  assert.equal(out.source, "Yahoo Finance chart (international indices, delayed)");
  assert.equal(out.asOf, "2026-10-08T05:31:15.000Z");
  assert.match(out.latency, /delayed/);
  assert.match(out.latency, /Every exchange asked about is closed now/);
  assert.deepEqual(out.missing.map((m) => m.symbol), ["NOPE.XX"]);
  assert.equal(out.disclaimer, "Delayed data from Yahoo Finance as of 01:31 ET, Oct 8. Research only, not investment advice.");
  assert.equal(out.rows[0].name, "TAIEX (Taiwan Weighted)");
  const fail = worldOf({ regions: ["taiwan"], outcomes: [{ symbol: "^TWII", error: "HTTP 429" }], now: NOW });
  assert.equal(fail.ok, false);
  assert.match(fail.error, /HTTP 429/);
  assert.equal(worldTail("", fail), "International quotes did not load: " + fail.error + " Yahoo Finance quotes did not load. Research only, not investment advice.");
  assert.equal(worldDisclaimer({ asOf: out.asOf, web: true }), "Delayed data from Yahoo Finance as of 01:31 ET, Oct 8; web results are third-party pages, not a TradeSimple feed. Research only, not investment advice.");
});

/* ---------- web adapter ---------- */

test("web config: OpenRouter's key is enough; none configured says which env vars to set; off turns it off", () => {
  assert.equal(webConfig(ENV).provider, "openrouter");
  assert.equal(webConfig({ TAVILY_API_KEY: "x" }).provider, "tavily");
  assert.equal(webConfig({ WEB_SEARCH_PROVIDER: "brave", BRAVE_API_KEY: "x", OPENROUTER_API_KEY: "y" }).provider, "brave");
  assert.match(webConfig({}).error, /OPENROUTER_API_KEY .* TAVILY_API_KEY, or BRAVE_API_KEY/);
  assert.equal(webConfig({ ...ENV, WEB_SEARCH_PROVIDER: "off" }).provider, "");
  assert.ok(!JSON.stringify(webConfig(ENV)).includes("test-key-not-real"), "the key is never in the config");
});

test("web search: results are the cited pages (deduped), labeled web, with retrieval time; not configured degrades", async () => {
  assert.equal(openrouterResults(OR_BODY).length, 2);
  const out = await fakeSearch("Taiwan stock market");
  assert.equal(out.ok, true);
  assert.equal(out.via, "OpenRouter web search");
  assert.match(out.source, /web, not a TradeSimple feed/);
  assert.equal(out.retrievedAt, "2026-10-09T13:58:00.000Z");
  assert.ok(!JSON.stringify(out).includes("99,999"), "the search model's own text is not a result");
  const off = await webSearch("x", { env: {} });
  assert.equal(off.ok, false);
  assert.equal(off.notConfigured, true);
  assert.match(off.error, /Web search is not configured/);
});

test("each search result becomes its own ref with domain, title and 'retrieved HH:MM ET'", async () => {
  let n = 4;
  const { children, parent } = splitWebResults(await fakeSearch("q"), () => `t${++n}`);
  assert.deepEqual(children.map((c) => c.id), ["t5", "t6"]);
  assert.equal(children[0].step.label, "web · taiwannews.com.tw · retrieved 09:58 ET");
  assert.match(children[0].step.source, /^TAIEX logs fourth straight weekly gain — https:\/\/www\.taiwannews\.com\.tw\/news\/6455061 \(web, not a TradeSimple feed\)$/);
  assert.match(children[0].step.latency, /Retrieved 09:58 ET, Oct 9 via OpenRouter web search/);
  assert.deepEqual(parent.results.map((r) => r.ref), ["t5", "t6"]);
  assert.equal(domainOf("https://www.investing.com/x"), "investing.com");
});

test("page fetch: scripts and markup stripped, text capped, private and local addresses refused", async () => {
  const html = `<html><head><title>Hi &amp; bye</title><script>alert(1)</script><style>p{}</style></head><body><p>TAIEX 49,313.44</p><script>steal()</script>${"x".repeat(9000)}</body></html>`;
  assert.equal(htmlToText("<p>a<script>evil()</script>b</p>"), "a b");
  const ok = await webPage("https://example.com/a", { lookup: async () => [{ address: "93.184.216.34" }], now: () => NOW, fetcher: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.title, "Hi & bye");
  assert.ok(!/alert|steal|<p>/.test(ok.text));
  assert.ok(ok.text.length <= WEB_CAPS.pageChars + 1);
  for (const url of ["http://localhost:8787/api/status", "http://127.0.0.1/", "http://[::1]/", "file:///etc/passwd", "http://user:pw@example.com/"]) {
    const r = await webPage(url, { lookup: async () => [{ address: "93.184.216.34" }], fetcher: async () => { throw new Error("must not fetch"); } });
    assert.equal(r.ok, false, url);
  }
  const rebound = await webPage("https://evil.example/", { lookup: async () => [{ address: "10.0.0.5" }], fetcher: async () => { throw new Error("must not fetch"); } });
  assert.match(rebound.error, /Private/);
  const redirect = await webPage("https://example.com/", { lookup: async (h) => [{ address: h === "example.com" ? "93.184.216.34" : "127.0.0.1" }], fetcher: async () => new Response("", { status: 302, headers: { location: "http://internal.test/" } }) });
  assert.equal(redirect.ok, false, "a redirect to a private address is refused");
  assert.equal(privateAddress("169.254.169.254"), true);
  assert.equal(privateAddress("8.8.8.8"), false);
});

/* ---------- through runAsk ---------- */

function scripted(...rounds) {
  const seen = [];
  return { seen, async *chat(messages) { seen.push(messages.map((m) => ({ ...m }))); for (const e of rounds.shift() || [{ type: "text", delta: "done" }]) yield e; } };
}

async function ask(question, provider, { execute } = {}) {
  const events = [];
  const ran = [];
  await runAsk({
    question, provider, tools: toolDefs("both"), session: { v: 1, sourcing: "both" }, labelOf: (n) => n, emit: (e) => events.push(e), today: "2026-10-09", heartbeatMs: 60_000, now: () => NOW,
    execute: execute || (async (name, args) => {
      ran.push([name, args]);
      if (name === "world_markets") return runWorldMarkets(args, { now: () => NOW, chart: async () => TWII });
      if (name === "web_search") return fakeSearch(args.query);
      return { ok: false, error: "unexpected" };
    })
  });
  return { events, ran, done: events.find((e) => e.type === "done"), errors: events.filter((e) => e.type === "error") };
}

test("runAsk: 'tell me about the taiwanese market today' fetches TAIEX and the web first; each web result is a cited step; disclaimer added", async () => {
  const p = scripted([{ type: "text", delta: "TAIEX last closed at 49313.44, -1.02% from the previous close [t1]; the exchange is closed now, so this is the Oct 8 session. Taiwan News reports turnover of NT$869.7 billion [t3]." }]);
  const { done, errors, ran, events } = await ask("tell me about the taiwanese market today", p);
  assert.deepEqual(errors, []);
  assert.deepEqual(ran.map(([n]) => n), ["world_markets", "web_search"]);
  assert.deepEqual(ran[0][1], { regions: ["taiwan"] });
  const sys = p.seen[0][0].content;
  assert.match(sys, /world_markets has already run/);
  assert.match(sys, /web_search has already run/);
  assert.match(sys, /Never say you can only cover US data/);
  const starts = events.filter((e) => e.type === "step_start");
  assert.deepEqual(starts.map((e) => [e.id, e.tool]), [["t1", "world_markets"], ["t2", "web_search"], ["t3", "web_result"], ["t4", "web_result"]]);
  assert.equal(starts[2].label, "web · taiwannews.com.tw · retrieved 09:58 ET");
  const tool = p.seen[0].filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
  assert.deepEqual(tool[1].results.map((r) => r.ref), ["t3", "t4"]);
  assert.deepEqual(done.cited, ["t1", "t3"]);
  assert.deepEqual(done.grounding.unmatched, []);
  assert.deepEqual(done.grounding.miscited, []);
  assert.ok(done.answer.endsWith("Delayed data from Yahoo Finance as of 01:31 ET, Oct 8; web results are third-party pages, not a TradeSimple feed. Research only, not investment advice."));
  assert.ok(done.caveats.some((c) => /third-party pages/.test(c)));
});

test("runAsk: a web figure is grounded against the cited result's excerpt; one it does not contain is flagged", async () => {
  const p = scripted([{ type: "text", delta: "TAIEX turnover was NT$912.4 billion [t3]. The index fell 0.99% [t4]." }]);
  const { done } = await ask("tell me about the taiwanese market today", p);
  assert.deepEqual(done.grounding.unmatched, ["912.4 billion"], JSON.stringify(done.grounding));
});

test("runAsk: web calls are capped per question; the fourth search is refused with a reason", async () => {
  const call = (i) => ({ type: "tool_call", id: `c${i}`, name: "web_search", args: { query: `q${i}` } });
  const p = scripted([call(1), call(2), call(3), call(4)], [{ type: "text", delta: "From the web: 0.99% [t2]." }]);
  const { events } = await ask("what's the latest news on the ECB rate decision", p, { execute: async (_name, args) => fakeSearch(args.query) });
  const ran2 = events.filter((e) => e.type === "step_start" && e.tool === "web_search");
  assert.equal(ran2.length, WEB_CAPS.web_search, "the pre-run search plus two of the model's");
  const refused = p.seen[1].filter((m) => m.role === "tool").map((m) => JSON.parse(m.content)).filter((b) => b.ok === false);
  assert.ok(refused.some((b) => /web_search limit reached \(3 per question\)/.test(b.error)), JSON.stringify(refused));
});

test("runAsk: with no web provider the step fails with the setup message and the answer still uses Yahoo", async () => {
  const p = scripted([{ type: "text", delta: "TAIEX 49313.44 [t1]." }]);
  const { done, events } = await ask("Japan stocks", p, {
    execute: async (name, args) => (name === "world_markets" ? runWorldMarkets(args, { now: () => NOW, chart: async () => TWII }) : webSearch(args.query, { env: {} }))
  });
  const web = events.find((e) => e.type === "step_end" && e.tool === "web_search");
  assert.equal(web.ok, false);
  assert.match(web.note, /Web search is not configured/);
  assert.match(done.answer, /Research only, not investment advice\.$/);
});

test("the standing coverage rule forbids 'limited to U.S. data' refusals and keeps the disclaimer", () => {
  assert.match(COVERAGE_NOTE, /Never say you can only cover US data/);
  assert.match(COVERAGE_NOTE, /Research only, not investment advice/);
  const names = toolDefs("both").map((t) => t.name);
  for (const n of ["world_markets", "web_search", "web_fetch", "market_snapshot"]) assert.ok(names.includes(n), n);
});
