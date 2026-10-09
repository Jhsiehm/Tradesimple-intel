import { test } from "node:test";
import assert from "node:assert/strict";
import { asksAboutResult, buildSpec, planFollowUps } from "../shared/backtestAsk.mjs";
import { followUpOutcome, handOffNote } from "../shared/followUpReply.mjs";
import { cleanAsk } from "../shared/ask.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";

const TODAY = "2026-10-09";
const FIRST = "Backtest the last 30 days from all data sources";
const SOURCES = ["congress", "form4", "contracts"];
const ALL = SOURCES.map((source) => ({ ...buildSpec({ question: FIRST, today: TODAY }).spec, source }));

/** localStorage for the browser chat store, so the test reloads a saved chat the way the app does. */
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { blankTurn, lastBacktests, loadChats, saveChats } = await import("../src/ask/chats.ts");

function scripted(...rounds) {
  const seen = [];
  return { seen, async *chat(messages) { seen.push(messages.map((m) => ({ ...m }))); for (const e of rounds.shift() || [{ type: "text", delta: "done" }]) yield e; } };
}

/** What the browser sends after reloading the chat: the saved turn's backtests as priors, cleaned like the route does. */
function bodyAfterReload(question) {
  store.clear();
  const turn = blankTurn(FIRST, { phase: "done", done: { answer: "Three runs [t1] [t2] [t3].", backtests: ALL.map((spec, i) => ({ id: `t${i + 1}`, spec, from: {}, diff: [], prior: null, using: "", note: "", ok: true, open: "", stats: null, description: "" })) } });
  saveChats([{ id: "c1", title: FIRST, turns: [turn], updated: "2026-10-09T12:06:00Z" }]);
  const [chat] = loadChats();
  const bts = lastBacktests(chat.turns);
  return cleanAsk({ question, prior: bts.at(-1)?.spec || null, priors: bts.map((b) => b.spec) });
}

async function ask(body, provider) {
  const events = [];
  const ran = [];
  await runAsk({
    ...body, provider, tools: toolDefs(), labelOf: (n) => n, emit: (e) => events.push(e), today: TODAY, heartbeatMs: 60_000,
    execute: async (_n, args) => { ran.push(args.spec); return { ok: true, source: "s", asOf: "a", latency: "l", spec: args.spec, stats: { trades: 12, totalReturn: 0.0123 } }; }
  });
  return { events, ran, done: events.find((e) => e.type === "done") };
}

test("root cause: 'Backtest the last 30 days' already holds 30 days, so 'hold 30 days instead' changes no run", () => {
  for (const spec of ALL) assert.equal(spec.rules.holdDays, 30);
  const out = planFollowUps({ question: "hold 30 days instead", today: TODAY, priors: ALL });
  assert.deepEqual(out.runs.map((r) => r.unchanged), [true, true, true]);
  assert.deepEqual(out.runs.map((r) => r.spec.filters.from), ["2026-09-09", "2026-09-09", "2026-09-09"], "'30 days' is not read as a new window");
});

test("the no-op reply names the value that already matched, why, and what to try instead", () => {
  const o = followUpOutcome(planFollowUps({ question: "hold 30 days instead", today: TODAY, priors: ALL }));
  assert.equal(o.understood, true);
  assert.equal(o.unchanged, true);
  assert.equal(o.text, "Hold 30 days is already what all 3 previous runs (Congressional trades, Form 4 insider trades, Contract awards) used (a \"last 30 days\" backtest holds each trade for the window's 30 days unless told otherwise), so nothing changed and nothing was re-run. To see a different result, try \"hold 60 days instead\", \"hold 90 days instead\", \"hold 180 days instead\".");
  assert.doesNotMatch(o.text, /nothing in the follow-up applies/);
});

test("a follow-up that sets no spec field is not understood, so the model answers it", () => {
  const o = followUpOutcome(planFollowUps({ question: "and why did contracts do better?", today: TODAY, priors: ALL }));
  assert.equal(o.understood, false);
  assert.match(handOffNote(ALL), /previous turn ran 3 backtests/);
});

test("reload from a saved chat: priors survive, 'hold 30 days instead' replies with the matched value and runs nothing", async () => {
  const body = bodyAfterReload("hold 30 days instead");
  assert.equal(body.ok, true);
  assert.deepEqual(body.priors.map((p) => [p.source, p.rules.holdDays]), [["congress", 30], ["form4", 30], ["contracts", 30]]);
  const p = scripted();
  const { ran, done } = await ask(body, p);
  assert.deepEqual(ran, []);
  assert.equal(p.seen.length, 0, "no model call for a true no-op");
  assert.match(done.answer, /^Hold 30 days is already what all 3 previous runs/);
  assert.doesNotMatch(done.answer, /Nothing to re-run|nothing in the follow-up applies/);
});

test("reload from a saved chat: 'hold 60 days instead' re-runs all three sources against their previous runs", async () => {
  const body = bodyAfterReload("hold 60 days instead");
  const { ran, done } = await ask(body, scripted([{ type: "text", delta: "Using: hold 60 d. 1.23% [t1], 1.23% [t2], 1.23% [t3]." }]));
  assert.deepEqual(ran.map((s) => [s.source, s.rules.holdDays]), [["congress", 60], ["form4", 60], ["contracts", 60]]);
  assert.deepEqual(done.backtests.map((b) => b.diff), [["hold 30 d → hold 60 d"], ["hold 30 d → hold 60 d"], ["hold 30 d → hold 60 d"]]);
});

test("reload from a saved chat: a follow-up with no spec change goes to the model with tools instead of a canned no-op", async () => {
  const body = bodyAfterReload("and why did contracts do better?");
  const p = scripted([{ type: "text", delta: "Contract awards returned 1.23% [t1] over 12 trades [t1]." }]);
  const { ran, done } = await ask(body, p);
  assert.deepEqual(ran.map((s) => [s.source, s.rules.holdDays]), [["contracts", 30]], "the named source's previous run, unchanged, so its figures have a ref");
  assert.equal(p.seen.length, 1, "the model was called");
  assert.match(p.seen[0][0].content, /did not find a spec change/);
  assert.match(p.seen[0][0].content, /re-ran it unchanged .* t1/);
  assert.deepEqual(done.cited, ["t1"]);
  assert.deepEqual(done.backtests[0].diff, []);
  assert.doesNotMatch(done.answer, /Nothing to re-run/);
});

test("a question about one previous run re-runs it unchanged, so the answer's figures cite this turn", async () => {
  const jpm = buildSpec({ question: "Backtest Congress buys of JPM since 2020, hold 30 days, vs SPY", today: TODAY }).spec;
  const q = "Which of those members had the best average excess?";
  assert.equal(asksAboutResult(q, jpm), true);
  const p = scripted([{ type: "text", delta: "The run had 12 trades [t1] returning 1.23% [t1]." }]);
  const { ran, done } = await ask(cleanAsk({ question: q, prior: jpm, priors: [jpm] }), p);
  assert.deepEqual(ran, [jpm]);
  assert.match(p.seen[0][0].content, /previous turn ran 1 backtest: .*re-ran it unchanged .* t1/s);
  assert.deepEqual(done.cited, ["t1"]);
  assert.deepEqual(done.grounding.miscited, []);
});

test("asksAboutResult: needs a previous run, and leaves new backtests and spec changes to their own paths", () => {
  const prior = ALL[0];
  assert.equal(asksAboutResult("Which of those members had the best average excess?", null), false);
  assert.equal(asksAboutResult("why did that run lose money?", prior), true);
  assert.equal(asksAboutResult("Backtest insider buys since 2025", prior), false);
  assert.equal(asksAboutResult("hold 60 days instead", prior), false);
  assert.equal(asksAboutResult("What did Nancy Pelosi file most recently?", prior), false);
});
