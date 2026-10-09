import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceOf } from "../shared/ask.mjs";
import { chipTitle, citationCheck, citationUnits, miscitedNote, refsIn, splitRefs, stepAnchor, stripRefs } from "../shared/citations.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";

function scripted(...rounds) {
  const seen = [];
  return {
    seen,
    async *chat(messages) {
      seen.push(messages.map((m) => ({ ...m })));
      for (const e of rounds.shift() || [{ type: "text", delta: "done" }]) yield e;
    }
  };
}
const TOOL = (name, args, id) => ({ type: "tool_call", id, name, args });
const TEXT = (t) => [{ type: "text", delta: t }];

async function ask(provider, execute, extra = {}) {
  const events = [];
  await runAsk({ question: "q", provider, tools: toolDefs(), execute, labelOf: (n) => n, emit: (e) => events.push(e), today: "2026-10-09", ...extra });
  return events;
}

const LEADERS = { ok: true, source: "House Clerk PTRs · Senate eFD", asOf: "2026-10-09T13:37:00Z", latency: "PTRs up to 45 days after the trade", leaders: [{ symbol: "NVDA", ret: 0.1234, spy: 0.0311 }, { symbol: "MSFT", ret: 0.0512, spy: 0.0311 }] };
const INSIDERS = { ok: true, source: "SEC EDGAR Form 4", asOf: "2026-10-09T12:00:00Z", latency: "2 business days", items: [{ symbol: "LMT", value: 4_250_000 }, { symbol: "RTX", value: 980_000 }] };
const EV = [evidenceOf("t1", "congress_leaders", {}, LEADERS), evidenceOf("t2", "insiders", {}, INSIDERS)];

/* ---------- ref grammar ---------- */

test("refsIn, splitRefs, and stripRefs share one grammar: [t1] and [t1, t2]", () => {
  assert.deepEqual(refsIn("A [t2]. B [t1, t3] and [t2]."), ["t2", "t1", "t3"]);
  assert.deepEqual(splitRefs("NVDA 12.3% [t1, t2] up"), [{ text: "NVDA 12.3% " }, { ref: "t1" }, { ref: "t2" }, { text: " up" }]);
  assert.deepEqual(splitRefs("[t1]"), [{ ref: "t1" }]);
  assert.deepEqual(splitRefs("no refs, (t1) or [T1]"), [{ text: "no refs, (t1) or [T1]" }]);
  assert.equal(stripRefs("NVDA rose 12.3% [t1]. LMT fell [t2, t3].\n| NVDA | 12.3% | [t1] |"), "NVDA rose 12.3%. LMT fell.\n| NVDA | 12.3% | |");
});

test("step anchors keep two turns' t1 apart", () => {
  assert.notEqual(stepAnchor("cA", "t1"), stepAnchor("cB", "t1"));
  assert.equal(stepAnchor("cA", "t1"), "st-cA-t1");
});

test("a chip title names the tool's source, as-of time, and latency, and says so when one is missing", () => {
  const ok = chipTitle({ label: "Leaders", source: LEADERS.source, asOf: LEADERS.asOf, latency: LEADERS.latency, state: "ok", open: "today:leaders" });
  assert.equal(ok, "Leaders · House Clerk PTRs · Senate eFD · as of 2026-10-09T13:37:00Z · PTRs up to 45 days after the trade · click to show the step and open the board");
  const bare = chipTitle({ label: "Search", state: "error", note: "timeout" });
  assert.match(bare, /no source reported · as-of time not reported · latency not reported · failed: timeout · click to show the step$/);
});

/* ---------- units ---------- */

test("citationUnits: each table row is a unit; a sentence's trailing refs after the period stay with it", () => {
  const u = citationUnits("Leaders beat SPY 12.34%. [t1] Insiders bought $4.25M [t2].\n\n| Ticker | Return | Ref |\n|---|---|---|\n| NVDA | 12.34% | [t1] |\n| LMT | $4.25M | [t2] |\n- MSFT 5.12% [t1]");
  assert.deepEqual(u.map((x) => [x.kind, x.refs]), [["sentence", ["t1"]], ["sentence", ["t2"]], ["row", []], ["row", ["t1"]], ["row", ["t2"]], ["sentence", ["t1"]]]);
  assert.equal(u[0].text, "Leaders beat SPY 12.34%. [t1]");
});

/* ---------- per-citation grounding ---------- */

test("a table merged from two tools with every row cited t1 is flagged row by row", () => {
  const answer = "| Ticker | Figure | Ref |\n|---|---|---|\n| NVDA | 12.34% | [t1] |\n| LMT | $4.25M | [t1] |\n| RTX | $980K | [t1] |";
  const { miscited, uncitedRows } = citationCheck(answer, EV);
  assert.deepEqual(miscited.map((m) => [m.raw, m.cited, m.foundIn]), [["$4.25M", ["t1"], ["t2"]], ["LMT", ["t1"], ["t2"]], ["$980K", ["t1"], ["t2"]], ["RTX", ["t1"], ["t2"]]]);
  assert.deepEqual(uncitedRows, []);
  assert.equal(miscitedNote(miscited[0]), "$4.25M is cited to t1, but only t2 returned it.");
});

test("the same merged table with each row citing its own tool passes", () => {
  const answer = "| Ticker | Figure | Ref |\n|---|---|---|\n| NVDA | 12.34% vs SPY 3.11% | [t1] |\n| LMT | $4.25M | [t2] |\n| RTX | $980K | [t2] |\nNVDA led at 12.34% [t1], and LMT insiders bought $4.25M [t2].";
  assert.deepEqual(citationCheck(answer, EV), { miscited: [], uncitedRows: [] });
});

test("one tool producing the whole table makes every row t1, and that is correct", () => {
  const answer = "| Ticker | Return | SPY | Ref |\n|---|---|---|---|\n| NVDA | +12.34% | 3.11% | [t1] |\n| MSFT | +5.12% | 3.11% | [t1] |";
  assert.deepEqual(citationCheck(answer, [EV[0]]), { miscited: [], uncitedRows: [] });
});

test("rows with figures and no ref are listed; a header row is not", () => {
  const answer = "| Ticker | Return |\n|---|---|\n| NVDA | 12.34% |";
  assert.deepEqual(citationCheck(answer, EV).uncitedRows, ["| NVDA | 12.34% |"]);
});

test("a figure cited to a failed step is miscited when another step returned it; unknown refs are left to citationRefs", () => {
  const failed = evidenceOf("t3", "alerts", {}, { ok: false, error: "timeout" });
  const ev = [...EV, failed];
  assert.deepEqual(citationCheck("LMT insiders bought $4.25M [t3].", ev).miscited.map((m) => m.foundIn), [["t2"]]);
  assert.deepEqual(citationCheck("LMT insiders bought $4.25M [t9].", ev).miscited, []);
});

/* ---------- through runAsk ---------- */

test("runAsk: refs from earlier turns and attached chats never reach the model, so a new t1 cannot inherit an old figure", async () => {
  const p = scripted(TEXT("Nothing new."));
  await ask(p, async () => LEADERS, {
    history: [{ role: "user", content: "leaders?" }, { role: "assistant", content: "NVDA 12.34% [t1], LMT $4.25M [t2]." }],
    attached: { title: "Old", turns: [{ role: "assistant", content: "RTX $980K [t3]." }] }
  });
  const sent = p.seen[0].slice(1).map((m) => m.content).join("\n");
  assert.doesNotMatch(sent, /\[t\d/);
  assert.match(sent, /NVDA 12\.34%, LMT \$4\.25M\./);
  assert.match(sent, /RTX \$980K\./);
});

test("runAsk: ids follow call order even when t2 finishes first; done.grounding checks each figure against its cited tool", async () => {
  const p = scripted(
    [TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")],
    TEXT("| Ticker | Figure | Ref |\n|---|---|---|\n| NVDA | 12.34% | [t1] |\n| LMT | $4.25M | [t1] |\nBoth are filings [t1].")
  );
  const events = await ask(p, async (name) => {
    if (name === "congress_leaders") await new Promise((r) => setTimeout(r, 25));
    return name === "congress_leaders" ? LEADERS : INSIDERS;
  });
  const ends = events.filter((e) => e.type === "step_end");
  assert.deepEqual(ends.map((e) => [e.id, e.tool]), [["t2", "insiders"], ["t1", "congress_leaders"]]);
  const t1 = ends.find((e) => e.id === "t1");
  assert.deepEqual([t1.source, t1.asOf, t1.latency], [LEADERS.source, LEADERS.asOf, LEADERS.latency]);
  const done = events.at(-1);
  assert.deepEqual(done.grounding.unmatched, [], "the pooled check passes: some tool has every number");
  assert.deepEqual(done.grounding.miscited.map((m) => [m.raw, m.foundIn]), [["$4.25M", ["t2"]], ["LMT", ["t2"]]]);
  assert.deepEqual(done.cited, ["t1"]);
});

test("runAsk: a multi-source backtest turn gives each run its own ref, and a figure cited to the wrong run is flagged", async () => {
  const stats = { congress: { trades: 64, totalReturn: 0.0412, excess: 0.0101 }, form4: { trades: 12, totalReturn: -0.0233, excess: -0.0544 }, contracts: { trades: 9, totalReturn: 0.0877, excess: 0.0566 } };
  const p = scripted(
    ["congress", "form4", "contracts"].map((src, i) => TOOL("run_backtest", { spec: { source: src } }, `b${i}`)),
    TEXT("Congress returned 4.12% [t1], Form 4 −2.33% [t2], contracts 8.77% [t3]. Form 4 trailed by 5.44% [t1].")
  );
  const events = await ask(p, async (_n, args) => ({ ok: true, source: `${args.spec.source} feed`, asOf: "2026-10-09", latency: "daily", spec: args.spec, stats: stats[args.spec.source], description: args.spec.source }));
  const done = events.at(-1);
  assert.deepEqual(done.backtests.map((b) => [b.id, b.spec.source]), [["t1", "congress"], ["t2", "form4"], ["t3", "contracts"]]);
  assert.deepEqual(done.grounding.miscited.map((m) => [m.raw, m.cited, m.foundIn]), [["5.44%", ["t1"], ["t2"]]]);
  assert.deepEqual(done.unknown, []);
});

test("runAsk: the fallback table cites the tool whose rows it shows", async () => {
  const p = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")], TEXT("Here they are [t1]."), TEXT("Still here [t1]."));
  const big = { ...INSIDERS, items: [...INSIDERS.items, { symbol: "GD", value: 1 }, { symbol: "BA", value: 2 }] };
  const done = (await ask(p, async (name) => (name === "insiders" ? big : LEADERS))).at(-1);
  assert.deepEqual([done.table.ref, done.table.label, done.table.source, done.table.asOf], ["t2", "insiders", INSIDERS.source, INSIDERS.asOf]);
});
