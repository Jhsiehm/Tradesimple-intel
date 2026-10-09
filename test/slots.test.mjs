import { test } from "node:test";
import assert from "node:assert/strict";
import { MISSING, SLOT_NOTE, formatValue, lookup, parsePath, renderSlots, slotEvidence, slotStream, missingNote, columnLabel } from "../shared/slots.mjs";
import { groundingCheck, ASK_LIMITS } from "../shared/ask.mjs";
import { citationCheck } from "../shared/citations.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";

const RAW = {
  ok: true,
  source: "House Clerk PTRs + Yahoo prices",
  asOf: "2026-10-09",
  rows: Array.from({ length: 14 }, (_, i) => ({ member: `Member ${i}`, ticker: ["NVDA", "MSFT", "AAPL"][i % 3], excessReturn: (i - 4) / 100 + 0.0034, amount: 15000 * (i + 1), filed: `2026-09-${String(i + 10).padStart(2, "0")}` })),
  stats: { excess: 0.0412, n: 52, hitRate: 0.583, medianPct: 3.1 },
  benchmarkComparison: null
};
// What the model saw: lists cut to 10 rows with their true total.
const BODY = { ...RAW, rows: { items: RAW.rows.slice(0, 10), total: 14, truncated: true } };
const SRC = { evidence: [{ id: "t1", ok: true }, { id: "t2", ok: false }], bodies: new Map([["t1", BODY], ["t2", { ok: false, error: "down" }]]), raws: new Map([["t1", RAW]]) };

test("slot paths: dots, brackets, negative and quoted indices; junk is not a path", () => {
  assert.deepEqual(parsePath("t1.rows[0].excessReturn"), { ref: "t1", keys: ["rows", 0, "excessReturn"] });
  assert.deepEqual(parsePath("t12.rows.3.member"), { ref: "t12", keys: ["rows", 3, "member"] });
  assert.deepEqual(parsePath("t1.rows[-1]['ticker']"), { ref: "t1", keys: ["rows", -1, "ticker"] });
  assert.equal(parsePath("rows[0]"), null);
  assert.equal(parsePath("t1.rows[0"), null);
  assert.equal(parsePath("t1..x"), null);
});

test("lookup walks a cut list as the list it stands for; length is its true total", () => {
  assert.equal(lookup(BODY, ["rows", 2, "member"]).value, "Member 2");
  assert.equal(lookup(BODY, ["rows", "length"]).value, 14);
  assert.equal(lookup(RAW, ["rows", -1, "member"]).value, "Member 13");
  assert.equal(lookup(BODY, ["rows", 12]).found, false);
  assert.equal(lookup(BODY, ["nope"]).found, false);
  assert.equal(lookup([1, 2], ["result", 1]).value, 2);
});

test("formatting: percent of a fraction, signed, points, dollars, numbers, dates, text", () => {
  const f = (v, fmt, key) => formatValue(v, fmt, key).text;
  assert.equal(f(0.0834, "pct"), "8.3%");
  assert.equal(f(0.0834, "pct:2"), "8.34%");
  assert.equal(f(0.0834, "spct"), "+8.3%");
  assert.equal(f(-0.05, "spct"), "−5.0%");
  assert.equal(f(3.14, "pp"), "3.1%");
  assert.equal(f(15000, "usd"), "$15,000");
  assert.equal(f(1_234_567, "usd"), "$1.2M");
  assert.equal(f(2.5e9, "usd"), "$2.5B");
  assert.equal(f(-450_000, "usd"), "−$450,000");
  assert.equal(f(12.5, "usd:2"), "$12.50");
  assert.equal(f(1234.5678, "num"), "1,234.57");
  assert.equal(f(52, "int"), "52");
  assert.equal(f("0.25", "pct"), "25.0%");
  assert.equal(f("2026-10-09T13:00:00Z", "date"), "2026-10-09");
  assert.equal(f(true, "text"), "yes");
  // No format: picked from the field name.
  assert.equal(f(0.0412, "auto", "excess"), "4.1%");
  assert.equal(f(3.1, "auto", "medianPct"), "3.1%");
  assert.equal(f(15000, "auto", "amount"), "$15,000");
  assert.equal(f(52, "auto", "n"), "52");
  assert.equal(f(23, "auto", "priced"), "23", "a count named 'priced' is not dollars");
  assert.equal(f(0.609, "auto", "hitRate"), "60.9%");
  assert.equal(f(0.375, "auto", "excessSince"), "37.5%");
  assert.equal(f(1_500_000, "auto", "totalObligated"), "$1.5M");
  assert.equal(f("2026-09-10", "auto", "filed"), "2026-09-10");
});

test("formatted figures pass the numeric grounding check against the raw value", () => {
  const ev = [{ id: "t1", ok: true, json: JSON.stringify({ a: 0.0834, b: 1234567, c: 1234.5678, d: -0.05 }) }];
  const text = ["8.3%", "+8.3%", "8.34%", "$1.2M", "1,234.57", "−5.0%"].join(" and ");
  assert.deepEqual(groundingCheck(text, ev).unmatched, []);
});

test("invalid slots render as [missing] and are reported with a reason", () => {
  const out = renderSlots("A {{t1.stats.nope}} B {{t9.x}} C {{t2.x}} D {{t1.stats|pct}} E {{t1.rows[0].member|pct}} F {{t1.stats.n|bogus}} G {{t1.benchmarkComparison|pct}} H {{nonsense}}", SRC);
  assert.equal(out.count, 8);
  assert.equal(out.text.split(MISSING).length - 1, 8);
  assert.deepEqual(out.missing.map((m) => m.reason), [
    "no such field",
    "no tool result t9",
    "t2 failed",
    "an object, not one value",
    "\"Member 0\" is not a number",
    "unknown format \"bogus\"",
    "the tool returned null",
    "not a slot path (expected tN.field)"
  ]);
  assert.match(missingNote(out.missing), /^8 figures could not be filled .* \[missing\]/);
  assert.equal(missingNote([]), "");
});

test("value slots fill from what the model saw and record the values they printed", () => {
  const out = renderSlots("Beat SPY by {{t1.stats.excess|spct}} over {{t1.stats.n}} trades; {{t1.rows.length}} rows; first {{t1.rows[0].member}} [t1].", SRC);
  assert.equal(out.text, "Beat SPY by +4.1% over 52 trades; 14 rows; first Member 0 [t1].");
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.used.get("t1"), [0.0412, 52, 14]);
});

test("table directive: columns, formats, sort, limit, ref column, row count line; reads every row of the full result", () => {
  const out = renderSlots("Top buys:\n{{table t1.rows cols=member,ticker,excessReturn:spct,amount:usd sort=-excessReturn limit=3}}\nDone [t1].", SRC);
  const lines = out.text.split("\n");
  assert.deepEqual(lines.slice(0, 3), ["Top buys:", "", "| Member | Ticker | Excess return | Amount | Ref |"]);
  assert.deepEqual(lines.slice(-2), ["", "Done [t1]."]);
  assert.equal(lines[3], "|---|---|---|---|---|");
  // Member 13 is past the 10 rows the model saw; the table still finds it because it reads the full result.
  assert.equal(lines[4], "| Member 13 | MSFT | +9.3% | $210,000 | [t1] |");
  assert.equal(lines.filter((l) => l.endsWith("| [t1] |")).length, 3);
  assert.match(out.text, /3 of 14 rows shown \[t1\]\./);
  assert.equal(columnLabel("returnPct"), "Return %");
  // A column the rows do not have is flagged; the rest of the table still renders.
  const bad = renderSlots("{{table t1.rows cols=member,alpha}}", SRC);
  assert.match(bad.text, /\| Member 0 \| \[missing\] \| \[t1\] \|/);
  assert.deepEqual(bad.missing.map((m) => m.reason), ["unknown column alpha"]);
  // No path: the largest list in the result; no cols: its first scalar fields.
  const auto = renderSlots("{{table t1}}", SRC);
  assert.match(auto.text, /^\n\| Member \| Ticker \| Excess return \| Amount \| Filed \| Ref \|/);
  assert.equal(renderSlots("{{table t1.stats}}", SRC).missing[0].reason, "t1.stats is not a list");
  assert.equal(renderSlots("{{table t1.rows[0].filed}}", SRC).missing[0].reason, "t1.rows[0].filed is not a list");
});

test("a table directive sharing a line with prose gets lines of its own", () => {
  const out = renderSlots("Here: {{table t1.rows cols=member limit=1}} after.", SRC);
  assert.equal(out.text, "Here: \n| Member | Ref |\n|---|---|\n| Member 0 | [t1] |\n1 of 14 rows shown [t1].\n after.");
});

test("slot values join their ref's grounding pool, so code-filled rows past the model's view are not flagged", () => {
  const out = renderSlots("{{table t1.rows cols=member,amount:usd sort=-amount limit=2}}", SRC);
  const ev = [{ id: "t1", ok: true, json: JSON.stringify(BODY) }];
  assert.notDeepEqual(groundingCheck(out.text, ev).unmatched, []);
  assert.deepEqual(groundingCheck(out.text, slotEvidence(ev, out.used)).unmatched, []);
});

test("a slot filled from t1 in a sentence cited to t2 is flagged as miscited; cited to t1 it is clean", () => {
  const two = { evidence: [{ id: "t1", ok: true }, { id: "t2", ok: true }], bodies: new Map([["t1", BODY], ["t2", { ok: true, count: 7 }]]), raws: new Map([["t1", RAW]]) };
  const ev = [{ id: "t1", ok: true, json: JSON.stringify(BODY) }, { id: "t2", ok: true, json: JSON.stringify({ ok: true, count: 7 }) }];
  const wrong = renderSlots("Buys beat SPY by {{t1.stats.excess|spct}} [t2].", two);
  assert.equal(wrong.text, "Buys beat SPY by +4.1% [t2].");
  const flagged = citationCheck(wrong.text, slotEvidence(ev, wrong.used)).miscited;
  assert.equal(flagged.length, 1);
  assert.deepEqual([flagged[0].cited, flagged[0].foundIn], [["t2"], ["t1"]]);
  const right = renderSlots("Buys beat SPY by {{t1.stats.excess|spct}} [t1].", two);
  assert.deepEqual(citationCheck(right.text, slotEvidence(ev, right.used)).miscited, []);
});

test("streaming: text before an open slot goes at once, the slot when it closes, an unclosed one as typed", () => {
  const s = slotStream((slot) => renderSlots(slot, SRC).text);
  const parts = ["Excess ", "{", "{t1.stats.", "excess|spct}", "} [t1]. and {{ never"].map((d) => s.push(d));
  assert.deepEqual(parts, ["Excess ", "", "", "", "+4.1% [t1]. and "]);
  assert.equal(s.flush(), "{{ never");
});

test("the prompt note teaches slots and tables with a worked example", () => {
  assert.match(SLOT_NOTE, /\{\{t1\.stats\.excess\|spct\}\}/);
  assert.match(SLOT_NOTE, /\{\{table t1\.rows cols=/);
  assert.match(SLOT_NOTE, /\[missing\]/);
});

/* ---------- end to end with a fake model ---------- */

function scripted(...rounds) {
  const seen = [];
  return {
    seen,
    name: "fake",
    model: "fake",
    async *chat(messages, tools, opts) {
      seen.push({ messages: messages.map((m) => ({ ...m })), opts });
      for (const e of rounds.shift() || [{ type: "text", delta: "done" }, { type: "end", reason: "stop" }]) yield e;
    }
  };
}
const split = (s, n = 7) => Array.from({ length: Math.ceil(s.length / n) }, (_, i) => ({ type: "text", delta: s.slice(i * n, i * n + n) }));

test("runAsk: the model writes slots, the stream and done.answer carry the data's values, grounding stays clean", async () => {
  const answer = "Disclosed buys beat SPY by {{t1.stats.excess|spct}} on average over {{t1.stats.n}} trades [t1]. Hit rate {{t1.stats.hitRate|pct}} [t1].\n{{table t1.rows cols=member,ticker,excessReturn:spct sort=-excessReturn limit=3}}\nBenchmark {{t1.benchmarkComparison|pct}} [t1].";
  const p = scripted(
    [{ type: "tool_call", id: "c1", name: "congress_leaders", args: {} }, { type: "end", reason: "tool_calls" }],
    [...split(answer), { type: "usage", input: 100, output: 40 }, { type: "end", reason: "stop" }]
  );
  const events = [];
  await runAsk({ question: "Who beat SPY?", provider: p, tools: toolDefs(), execute: async () => structuredClone(RAW), labelOf: (n) => n, emit: (e) => events.push(e), limits: ASK_LIMITS, today: "2026-10-09" });
  const done = events.at(-1);
  assert.equal(done.type, "done");
  assert.match(p.seen[0].messages[0].content, /Figures come from code/);
  assert.match(done.answer, /beat SPY by \+4\.1% on average over 52 trades \[t1\]\. Hit rate 58\.3% \[t1\]\./);
  assert.match(done.answer, /\| Member 13 \| MSFT \| \+9\.3% \| \[t1\] \|/);
  assert.doesNotMatch(done.answer, /\{\{/);
  assert.equal(events.filter((e) => e.type === "token").map((e) => e.delta).join(""), done.answer);
  assert.equal(done.slots.count, 5);
  assert.deepEqual(done.slots.missing.map((m) => m.reason), ["the tool returned null"]);
  assert.deepEqual(done.grounding.unmatched, []);
  assert.deepEqual(done.grounding.miscited, []);
  assert.deepEqual(done.cited, ["t1"]);
  assert.equal(done.retried, false, "slot figures count as figures, so the no-figures retry does not fire");
});

test("runAsk: plain numbers stay allowed and are still grounded as a second layer", async () => {
  const p = scripted(
    [{ type: "tool_call", id: "c1", name: "congress_leaders", args: {} }, { type: "end", reason: "tool_calls" }],
    [{ type: "text", delta: "Excess {{t1.stats.excess|pct}} over 52 trades, and 77 losers [t1]." }, { type: "end", reason: "stop" }]
  );
  const events = [];
  const fixed = { name: "rev", model: "rev", async *chat() { yield { type: "text", delta: "Excess 4.1% over 52 trades [t1]." }; } };
  await runAsk({ question: "How did they do?", provider: p, strong: { model: "rev", provider: fixed }, auto: true, tools: toolDefs(), execute: async () => structuredClone(RAW), labelOf: (n) => n, emit: (e) => events.push(e), limits: ASK_LIMITS, today: "2026-10-09" });
  const done = events.at(-1);
  assert.equal(done.revision.status, "applied");
  assert.equal(done.answer, "Excess 4.1% over 52 trades [t1].");
  assert.deepEqual(done.grounding.unmatched, []);
});
