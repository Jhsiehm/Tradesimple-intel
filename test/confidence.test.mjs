import { test } from "node:test";
import assert from "node:assert/strict";
import { asOfText, confidenceLine } from "../shared/confidence.mjs";

const NOW = Date.parse("2026-10-09T14:10:00Z");
const clean = { checked: 4, unmatched: [], miscited: [], mislabeled: [], scope: [], uncitedRows: [] };
const done = (over = {}) => ({ greeting: false, clarify: false, noTools: false, uncited: false, unknown: [], model: "anthropic/claude-sonnet-4.6", grounding: clean, backtests: [], ...over });
const step = (tool, asOf, state = "ok") => ({ tool, asOf, state });

test("the example line: priced signals, unverified figures, web sources, oldest data as-of in ET, and the model", () => {
  const c = confidenceLine({
    steps: [step("run_backtest", "2026-10-09T13:46:00Z"), step("congress_feed", "2026-10-09T14:01:00Z"), step("web_result", "2026-10-09T08:00:00Z"), step("web_result", "2026-10-09T14:05:00Z"), step("web_fetch", "2026-10-09T14:06:00Z"), step("insiders", "2026-10-08T12:00:00Z", "error")],
    done: done({ grounding: { ...clean, unmatched: ["61"], miscited: [{ raw: "12%", cited: ["t1"], foundIn: ["t2"] }] }, backtests: [{ ok: true, counts: { signalsOnChosenSides: 37, tradesPriced: 30 } }] }),
    now: NOW
  });
  assert.equal(c.text, "Priced 30/37 signals · 2 figures unverified · 3 web sources · data as of 09:46 ET · model Sonnet 4.6");
  assert.equal(c.tone, "amber");
});

test("a clean answer is neutral and says how many figures matched", () => {
  const c = confidenceLine({ steps: [step("congress_leaders", "2026-10-09T13:37:00Z")], done: done(), now: NOW });
  assert.equal(c.text, "4 figures matched · data as of 09:37 ET · model Sonnet 4.6");
  assert.equal(c.tone, "neutral");
});

test("partial pricing alone turns it amber; full pricing does not; several backtests add up", () => {
  const partial = confidenceLine({ steps: [], done: done({ backtests: [{ ok: true, counts: { signalsOnChosenSides: 10, tradesPriced: 9 } }, { ok: true, counts: { matchedSignals: 5, tradesPriced: 5 } }, { ok: false, counts: { signalsOnChosenSides: 99, tradesPriced: 0 } }] }) });
  assert.equal(partial.parts[0], "Priced 14/15 signals");
  assert.equal(partial.tone, "amber");
  const full = confidenceLine({ steps: [], done: done({ backtests: [{ ok: true, counts: { signalsOnChosenSides: 4, tradesPriced: 4 } }] }) });
  assert.equal(full.parts[0], "Priced 4/4 signals");
  assert.equal(full.tone, "neutral");
});

test("unsupported claims, rows without refs, unknown refs, and no tool data are named and amber", () => {
  const c = confidenceLine({ steps: [], done: done({ unknown: ["t9"], grounding: { ...clean, scope: [{}], uncitedRows: ["| a |", "| b |"] } }) });
  assert.deepEqual(c.parts.slice(0, 3), ["1 figure unverified", "1 claim unsupported", "2 rows without a ref"]);
  assert.equal(c.tone, "amber");
  const none = confidenceLine({ steps: [], done: done({ noTools: true, grounding: { ...clean, checked: 0 } }), model: "x" });
  assert.equal(none.text, "no tool data · model Sonnet 4.6");
  assert.equal(none.tone, "amber");
});

test("an answer revised by another model says so; a kept or same-model revision does not", () => {
  const steps = [step("congress_leaders", "2026-10-09T14:18:40Z")];
  const mini = { model: "openai/gpt-4o-mini" };
  assert.equal(confidenceLine({ steps, done: done({ ...mini, revision: { status: "applied", model: "anthropic/claude-sonnet-4.6" } }), now: NOW }).text, "4 figures matched · data as of 10:18 ET · model GPT-4o mini, revised by Sonnet 4.6");
  assert.match(confidenceLine({ steps, done: done({ ...mini, revision: { status: "kept", model: "anthropic/claude-sonnet-4.6" } }), now: NOW }).text, /model GPT-4o mini$/);
  assert.match(confidenceLine({ steps, done: done({ revision: { status: "applied", model: "anthropic/claude-sonnet-4.6" } }), now: NOW }).text, /model Sonnet 4\.6$/);
});

test("no line for greetings, clarifying questions, or unfinished turns; the turn's model is the fallback", () => {
  assert.equal(confidenceLine({ done: null }), null);
  assert.equal(confidenceLine({ done: done({ greeting: true }) }), null);
  assert.equal(confidenceLine({ done: done({ clarify: true }) }), null);
  assert.equal(confidenceLine({ steps: [], done: done({ model: "", grounding: { ...clean, checked: 0 } }), model: "openai/gpt-4.1" }).text, "model GPT-4.1");
});

test("as-of reads as ET time today, date and time before today, and the date alone for a day stamp", () => {
  assert.equal(asOfText("2026-10-09T13:46:00Z", NOW), "09:46 ET");
  assert.equal(asOfText("2026-10-08T20:00:00Z", NOW), "Oct 8 16:00 ET");
  assert.equal(asOfText("2026-10-08", NOW), "Oct 8");
  assert.equal(asOfText("not a time", NOW), "");
});
