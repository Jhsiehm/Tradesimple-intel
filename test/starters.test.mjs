import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutContext, askAction, itemStarters, parseAskAction, selectionKey, starters } from "../src/agent/starters.ts";
import { contextLine, screenContext } from "../src/agent/context.ts";
import { cleanContext, contextNote } from "../shared/agent.mjs";

const none = (section) => ({ section, node: null, theory: null });

test("a member card attaches its case key and name; the prefill asks about that member", () => {
  const ctx = aboutContext({ title: "Nancy Pelosi", caseKey: "member:P000197" }, "congress");
  assert.deepEqual(ctx, { section: "congress", node: "member:P000197", theory: null, label: "Nancy Pelosi" });
  assert.equal(itemStarters(ctx)[0], "How have Nancy Pelosi’s buys done after filing?");
  assert.ok(itemStarters(ctx).includes("Which committees and trades overlap?"));
  assert.equal(itemStarters({ ...ctx, label: "James Comers" })[0], "How have James Comers’ buys done after filing?");
});

test("ticker, bill, vote, committee, edge and generic cards each get their own question", () => {
  const t = aboutContext({ title: "NVDA · NVIDIA", caseKey: "ticker:NVDA" }, "markets");
  assert.deepEqual(itemStarters(t).slice(0, 2), ["Who in Congress traded NVDA in the last 90 days?", "Insider buys in NVDA since 2025 — backtest"]);
  assert.equal(aboutContext({ title: "Apple", watch: "AAPL" }, "markets").node, "ticker:AAPL");
  assert.equal(itemStarters(aboutContext({ title: "NDAA", askKey: "bill:hr1234-119" }, "congress"))[0], "Who traded related stocks around this vote?");
  assert.equal(itemStarters(aboutContext({ title: "Roll 312", askKey: "vote:house-2026-312" }, "congress"))[0], "Who traded related stocks around this vote?");
  assert.match(itemStarters(aboutContext({ title: "Armed Services", askKey: "committee:HSAS" }, "congress"))[0], /committee traded stocks it oversees/);
  assert.equal(itemStarters(aboutContext({ title: "Pelosi → NVDA", askKey: "edge:trade|member:P000197|ticker:NVDA" }, "map"))[0], "Explain this link and its timing: Pelosi → NVDA");
  const meeting = aboutContext({ title: "Hearing: AI and   defense" }, "calendar");
  assert.equal(meeting.node, "item:hearing-ai-and-defense");
  assert.equal(itemStarters(meeting)[0], "Tell me more about Hearing: AI and defense");
  const long = aboutContext({ title: "Hearings to examine protecting Americans from global scam operations", askKey: "rel:hearing:x" }, "map");
  assert.equal(itemStarters(long)[0], "What links this to Congress trades, lobbying, and contracts?");
});

test("the Ask button's follow action round-trips its card; junk parses to null", () => {
  const action = askAction({ title: "One  Big: Bill / 100%", askKey: "bill:hr1-119", rows: [] });
  assert.ok(action.startsWith("ask:about:"));
  assert.deepEqual(parseAskAction(action), { title: "One Big: Bill / 100%", caseKey: undefined, askKey: "bill:hr1-119", watch: undefined });
  assert.equal(parseAskAction("ask:about:%7Bnope"), null);
  assert.equal(parseAskAction("ask:q:hello"), null);
});

test("selection keys: bills, roll calls, committees, map nodes and links; theories stay with the theory context", () => {
  assert.equal(selectionKey("congress", "bills", "hr1-119"), "bill:hr1-119");
  assert.equal(selectionKey("congress", "votes", "house-2026-1"), "vote:house-2026-1");
  assert.equal(selectionKey("congress", "committees", "HSAS"), "committee:HSAS");
  assert.equal(selectionKey("map", "votes", "edge:x"), "edge:x");
  assert.equal(selectionKey("map", "votes", "agency:DOD"), "rel:agency:DOD");
  assert.equal(selectionKey("map", "votes", "ticker:NVDA"), "ticker:NVDA");
  assert.equal(selectionKey("map", "votes", "theory:t1"), null);
  assert.equal(selectionKey("news", "votes", null), null);
});

test("starters follow the screen: member, ticker, Today, region, section, then the generic examples", () => {
  const member = starters({ ctx: { section: "congress", node: "member:P000197", theory: null, label: "Nancy Pelosi" }, attached: true, today: false, section: "congress" });
  assert.equal(member.length, 4);
  assert.equal(member[0], "How have Nancy Pelosi’s buys done after filing?");
  assert.equal(member[1], "Which committees and trades overlap?");

  const ticker = starters({ ctx: { section: "markets", node: "ticker:LMT", theory: null }, attached: true, today: false, section: "markets" });
  assert.equal(ticker[0], "Who in Congress traded LMT in the last 90 days?");
  assert.equal(ticker[1], "Insider buys in LMT since 2025 — backtest");

  const today = starters({ ctx: none("today"), attached: false, today: true, section: "congress" });
  assert.deepEqual(today.slice(0, 2), ["How are the markets today?", "Backtest the last 30 days from all data sources"]);

  const region = starters({ ctx: none("news"), attached: false, today: false, section: "news", region: "Asia-Pacific" });
  assert.equal(region[0], "Tell me about the Asia-Pacific market today");
  assert.equal(starters({ ctx: none("news"), attached: false, today: false, section: "news", region: "all" })[0], "How are the markets today?");

  const detached = starters({ ctx: { section: "congress", node: "member:P000197", theory: null, label: "Nancy Pelosi" }, attached: false, today: false, section: "congress" });
  assert.ok(!detached.some((q) => q.includes("Pelosi’s") || q.includes("overlap")), "a removed attachment is not named");

  const unknown = starters({ ctx: none("strait"), attached: false, today: false, section: "strait" });
  assert.equal(unknown.length, 4);
  assert.equal(new Set(unknown).size, unknown.length);
});

test("the screen context carries the dossier title as its label; the header line names keyed cards", () => {
  const base = { section: "congress", mode: "members", marketView: "board", selectedId: null, timelineId: null, today: false, calendar: false, chartSymbol: "", supplySymbol: "", rowSymbol: null, watch: null, theory: null };
  const ctx = screenContext({ ...base, caseKey: "member:P000197", label: "Nancy Pelosi" });
  assert.equal(ctx.label, "Nancy Pelosi");
  assert.equal(contextLine(ctx), "CONGRESS · Nancy Pelosi");
  assert.equal(screenContext({ ...base, caseKey: null }).label, undefined);
  const bill = screenContext({ ...base, mode: "bills", caseKey: null, askKey: "bill:hr1-119", label: "One Big Bill" });
  assert.deepEqual([bill.node, bill.label], ["bill:hr1-119", "One Big Bill"]);
  assert.equal(screenContext({ ...base, caseKey: null, askKey: "item:hq:LMT" }).node, null, "generic cards are not attached by default");
  assert.equal(contextLine({ section: "congress", node: "bill:hr1-119", theory: null, label: "One Big Bill" }), "CONGRESS · bill · One Big Bill");
});

test("the server accepts keyed cards and names them; unknown kinds stay out", () => {
  const bill = cleanContext({ node: "bill:hr1-119", label: "One Big Bill" });
  assert.equal(bill.node, "bill:hr1-119");
  assert.match(contextNote(bill), /Bill hr1-119 \(One Big Bill\)/);
  const edge = cleanContext({ node: "edge:trade|member:P000197|ticker:NVDA", label: "Pelosi → NVDA" });
  assert.match(contextNote(edge), /Relationship-map link: Pelosi → NVDA/);
  assert.equal(cleanContext({ node: "strait:hormuz", label: "x" }), null);
  assert.equal(cleanContext({ node: "bill:", label: "x" }), null);
});
