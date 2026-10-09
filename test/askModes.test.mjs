import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterToolDefs, isModeStatement, layerPrompts, modeSystemNote, parseSourcing, parseStyle, resolveModes,
  sourcingClarify, stylePrompt, toolsForSourcing, wantsOutsideWorld, WEB_TOOLS
} from "../shared/askModes.mjs";
import { summarizeNews, summarizeSatellite } from "../server/ai/signals.mjs";
import { privateAddress, webPage } from "../server/feeds/web.mjs";
import { TOOLS, runTool, toolDefs } from "../server/ai/tools.mjs";
import { systemPrompt } from "../shared/ask.mjs";

test("parseSourcing: platform / web / both from plain words", () => {
  assert.equal(parseSourcing("use only TradeSimple data"), "platform");
  assert.equal(parseSourcing("isolate to platform"), "platform");
  assert.equal(parseSourcing("web only please"), "web");
  assert.equal(parseSourcing("use TradeSimple and the web"), "both");
  assert.equal(parseSourcing("also search the web"), "both");
  assert.equal(parseSourcing("what did Pelosi file?"), "");
});

test("parseStyle: professional / simplified / terminal", () => {
  assert.equal(parseStyle("professional brief on LMT"), "professional");
  assert.equal(parseStyle("explain in plain language"), "simplified");
  assert.equal(parseStyle("figures first, terminal style"), "terminal");
  assert.equal(parseStyle("NVDA contracts"), "");
});

test("isModeStatement: short toggles save prefs; research questions do not", () => {
  assert.equal(isModeStatement("use only TradeSimple"), true);
  assert.equal(isModeStatement("switch to professional"), true);
  assert.equal(isModeStatement("use TradeSimple and the web from now on"), true);
  assert.equal(isModeStatement("use TradeSimple and the web: what is moving NVDA today?"), false);
  assert.equal(isModeStatement("simplified: latest headlines on semis"), false);
});

test("resolveModes: answers beat question beat session beat default", () => {
  assert.deepEqual(resolveModes({}).sourcing, "platform");
  assert.deepEqual(resolveModes({}).style, "terminal");
  assert.equal(resolveModes({ question: "use the web only" }).sourcing, "web");
  assert.equal(resolveModes({ session: { v: 1, sourcing: "both", style: "simplified" } }).style, "simplified");
  assert.equal(resolveModes({ question: "TradeSimple only", session: { v: 1, sourcing: "web" } }).sourcing, "platform");
  assert.equal(resolveModes({ answers: { sourcing: "both" }, question: "TradeSimple only" }).sourcing, "both");
});

test("sourcingClarify only when open web is wanted and mode is still platform", () => {
  assert.equal(sourcingClarify({ question: "latest NVDA headlines" }).length, 0, "in-app news needs no chip");
  assert.equal(sourcingClarify({ question: "parse GOES satellite frames" }).length, 0);
  assert.equal(sourcingClarify({ question: "search the web for NVDA guidance" }).length, 1);
  assert.equal(sourcingClarify({ question: "search the web", answers: { sourcing: "both" } }).length, 0);
  assert.equal(sourcingClarify({ question: "search the web", acceptDefaults: true }).length, 0);
  assert.ok(wantsOutsideWorld("https://example.com/story"));
  assert.ok(!wantsOutsideWorld("what's on the news wire"));
});

test("toolsForSourcing gates web tools; platform keeps news and satellite", () => {
  const plat = toolsForSourcing("platform");
  assert.ok(plat.has("news") && plat.has("satellite") && plat.has("x_pulse"));
  assert.ok(!plat.has("web_search") && !plat.has("web_fetch"));
  const web = toolsForSourcing("web");
  assert.ok(web.has("web_search") && web.has("web_fetch"));
  assert.ok(!web.has("news") && !web.has("run_backtest"));
  const both = toolsForSourcing("both");
  assert.ok(both.has("news") && both.has("web_search"));
  const defs = toolDefs("platform");
  assert.ok(defs.every((t) => !WEB_TOOLS.has(t.name)));
  assert.ok(filterToolDefs(TOOLS.map((t) => ({ name: t.name })), "web").every((t) => WEB_TOOLS.has(t.name) || t.name === "propose_theory"));
});

test("layer and style prompts inject into the system note", () => {
  assert.match(stylePrompt("professional"), /professional brief/i);
  assert.match(stylePrompt("simplified"), /plain language/i);
  assert.ok(layerPrompts("platform").some((p) => /News\/X/.test(p)));
  assert.ok(layerPrompts("both").some((p) => /Web layer/.test(p)));
  assert.ok(!layerPrompts("platform").some((p) => /Web layer/.test(p)));
  const sys = systemPrompt("2026-10-09", { sourcing: "both", style: "simplified" });
  assert.match(sys, /in-app feeds and the open web/i);
  assert.match(sys, /simplified plain language/);
  assert.match(sys, /at least two of news/);
  assert.match(modeSystemNote({ sourcing: "platform", style: "terminal" }), /in-app feeds only/i);
  assert.match(modeSystemNote({ sourcing: "platform", style: "terminal" }), /Records.*Signals|Signals.*Records/s);
});

test("SSRF helpers refuse loopback, link-local, private, mapped and non-IP hosts", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "not-an-ip", ""]) assert.equal(privateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "::ffff:8.8.8.8"]) assert.equal(privateAddress(ip), false, ip);
  const never = { lookup: async () => [{ address: "93.184.216.34" }], fetcher: async () => { throw new Error("must not fetch"); } };
  for (const url of ["http://127.0.0.1/secret", "http://localhost/x", `https://example.com/${"a".repeat(2100)}`]) {
    assert.ok((await webPage(url, never)).error, url);
  }
});

test("runTool refuses web tools when sourcing is platform", async () => {
  const out = await runTool({}, "web_search", { query: "nvda" }, async () => ({ ok: true }), null, "platform");
  assert.equal(out.ok, false);
  assert.match(out.error, /not available/);
});

test("summarizeNews filters and caps; summarizeSatellite drops tile templates", () => {
  const wire = {
    ok: true, source: "2 RSS wires", asOf: "2026-10-09T12:00:00Z", latency: "5 min",
    feeds: [{ id: "reuters", name: "Reuters", desk: "world", region: "global", ok: true, count: 2 }],
    items: [
      { title: "NVDA rises", source: "Reuters", desk: "markets", region: "", published: "2026-10-09", link: "https://r.example/1", symbols: ["NVDA"], summary: "chip demand" },
      { title: "Oil sinks", source: "Reuters", desk: "world", region: "mena", published: "2026-10-08", link: "https://r.example/2", symbols: [], summary: "glut" }
    ]
  };
  const hit = summarizeNews(wire, { q: "nvda", limit: 5 });
  assert.equal(hit.items.length, 1);
  assert.equal(hit.items[0].title, "NVDA rises");
  const desk = summarizeNews(wire, { desk: "world" });
  assert.equal(desk.items.length, 1);
  const sat = summarizeSatellite({
    ok: true, source: "NASA GIBS", asOf: "2026-10-09T12:00:00Z", latency: "1h", gap: "No Meteosat",
    layers: [{ id: "GOES-East", name: "GOES-East", covers: "Americas", ranges: [{ end: Date.parse("2026-10-09T11:00:00Z") }], template: "https://gibs/…/{z}/{y}/{x}.png" }],
    daily: { name: "VIIRS", complete: "2026-10-08", end: "2026-10-09" }
  }, { layers: { sat: { source: "Esri", asOf: "mixed" }, daily: { source: "VIIRS", asOf: "2026-10-08" } } });
  assert.equal(sat.live[0].name, "GOES-East");
  assert.ok(!JSON.stringify(sat).includes("{z}/{y}/{x}"));
  assert.match(sat.gap, /Meteosat/);
});
