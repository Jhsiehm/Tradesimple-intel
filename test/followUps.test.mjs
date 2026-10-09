import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpec, followUpsNote, namedSources, planFollowUps } from "../shared/backtestAsk.mjs";
import { cleanAsk } from "../shared/ask.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";

const TODAY = "2026-10-09";
/** The three runs "Backtest the last 30 days from all data sources" makes. */
const ALL = ["congress", "form4", "contracts"].map((source) => ({ ...buildSpec({ question: "backtest the last 30 days from all data sources", today: TODAY }).spec, source }));

test("a follow-up on an all-sources turn changes every run, each with its own diff against its own previous run", () => {
  const out = planFollowUps({ question: "hold 60 days instead", today: TODAY, priors: ALL });
  assert.equal(out.targeted, false);
  assert.deepEqual(out.runs.map((r) => r.spec.source), ["congress", "form4", "contracts"]);
  for (const r of out.runs) {
    assert.equal(r.spec.rules.holdDays, 60);
    assert.equal(r.prior.source, r.spec.source);
    assert.deepEqual(r.diff, ["hold 30 d → hold 60 d"]);
    assert.equal(r.followUp, true);
    assert.equal(r.unchanged, false);
  }
  assert.deepEqual(out.notes, []);
});

test("naming a source re-runs only that one and says the rest are kept", () => {
  assert.deepEqual(namedSources("only for insiders"), ["form4"]);
  assert.deepEqual(namedSources("hold 60 days instead"), []);
  const out = planFollowUps({ question: "only for insiders, hold 60 days", today: TODAY, priors: ALL });
  assert.equal(out.targeted, true);
  assert.deepEqual(out.runs.map((r) => r.spec.source), ["form4"]);
  assert.equal(out.runs[0].spec.rules.holdDays, 60);
  assert.match(out.notes[0], /^Only Form 4 insider trades re-run, as asked; Congressional trades and Contract awards kept as before\.$/);
});

test("an exclusion that means nothing for a source is skipped there with a note, not an error", () => {
  const out = planFollowUps({ question: "exclude Pelosi", today: TODAY, priors: ALL });
  const by = Object.fromEntries(out.runs.map((r) => [r.spec.source, r]));
  assert.deepEqual(by.congress.spec.filters.excludeMembers, ["Pelosi"]);
  assert.deepEqual(by.form4.spec.filters.excludeMembers, ["Pelosi"], "insider names can be excluded too");
  assert.deepEqual(by.contracts.spec.filters.excludeMembers, [], "contracts keep their previous filters");
  assert.equal(by.contracts.unchanged, true);
  assert.ok(out.notes.some((n) => /^Excluding Pelosi does not apply to .*contract.*skipped for that run\.$/i.test(n)), out.notes.join("\n"));
  assert.ok(out.notes.some((n) => /nothing in the follow-up applies, so the previous run stands/.test(n)));
  assert.ok(!by.contracts.locked.includes("filters.excludeMembers"));
});

test("cleanAsk keeps up to four previous specs and drops bad ones", () => {
  const out = cleanAsk({ question: "hold 60 days instead", priors: [...ALL, { source: "nope" }, null] });
  assert.deepEqual(out.priors.map((p) => p.source), ["congress", "form4", "contracts"]);
  assert.deepEqual(cleanAsk({ question: "q" }).priors, []);
});

test("followUpsNote tells the model the runs are done and to compare each source", () => {
  const { runs, notes } = planFollowUps({ question: "exclude Pelosi", today: TODAY, priors: ALL });
  const live = runs.filter((r) => !r.unchanged);
  const note = followUpsNote(live, ["t1", "t2"], notes);
  assert.match(note, /already re-ran them; their results are below as tool results t1, t2\. Do not call run_backtest again/);
  assert.match(note, /Note for the user: Excluding Pelosi does not apply/);
  assert.match(note, /one small table per source/);
});

function scripted(...rounds) {
  const seen = [];
  return { seen, async *chat(messages) { seen.push(messages.map((m) => ({ ...m }))); for (const e of rounds.shift() || [{ type: "text", delta: "done" }]) yield e; } };
}

async function ask(question, priors, provider) {
  const events = [];
  const ran = [];
  await runAsk({
    question, prior: priors.at(-1), priors, provider, tools: toolDefs(), labelOf: (n) => n, emit: (e) => events.push(e), today: TODAY, heartbeatMs: 60_000,
    execute: async (_n, args) => { ran.push(args.spec); return { ok: true, source: "s", asOf: "a", latency: "l", spec: args.spec, stats: { trades: 12, totalReturn: 0.0123 } }; }
  });
  return { events, ran, done: events.find((e) => e.type === "done") };
}

test("runAsk re-runs every source of the previous turn before the model writes, each card with its previous run", async () => {
  const p = scripted([{ type: "text", delta: "Using: hold 60 d. Congress 1.23% [t1], insiders 1.23% [t2], contracts 1.23% [t3]." }]);
  const { ran, done, events } = await ask("hold 60 days instead", ALL, p);
  assert.deepEqual(ran.map((s) => [s.source, s.rules.holdDays]), [["congress", 60], ["form4", 60], ["contracts", 60]]);
  assert.equal(done.backtests.length, 3);
  for (const bt of done.backtests) {
    assert.equal(bt.prior.source, bt.spec.source, "each run compares with its own previous run");
    assert.equal(bt.prior.rules.holdDays, 30);
    assert.deepEqual(bt.diff, ["hold 30 d → hold 60 d"]);
  }
  assert.deepEqual(events.filter((e) => e.type === "step_start").map((e) => e.id), ["t1", "t2", "t3"]);
  const first = p.seen[0];
  assert.match(first[0].content, /The app already re-ran them/);
  assert.ok(first.some((m) => m.role === "assistant" && m.toolCalls?.length === 3), "the model sees the three runs as its own tool calls");
  assert.equal(first.filter((m) => m.role === "tool").length, 3);
});

test("runAsk: an exclusion skips the source it does not apply to and says so", async () => {
  const p = scripted([{ type: "text", delta: "Using: excluding Pelosi. 1.23% [t1], 1.23% [t2]." }]);
  const { ran, done, events } = await ask("exclude Pelosi", ALL, p);
  assert.deepEqual(ran.map((s) => s.source), ["congress", "form4"]);
  assert.equal(done.backtests.length, 2);
  const notes = events.filter((e) => e.type === "plan_note").map((e) => e.note);
  assert.ok(notes.some((n) => /does not apply to .*contract/i.test(n)));
});

test("runAsk: a follow-up naming one source runs only it, model-driven, against that source's previous run", async () => {
  const p = scripted([{ type: "tool_call", id: "c1", name: "run_backtest", args: { spec: { source: "form4" } } }], [{ type: "text", delta: "Using: insiders, hold 60 d. 1.23% [t1]." }]);
  const { ran, done } = await ask("only for insiders, hold 60 days", ALL, p);
  assert.deepEqual(ran.map((s) => [s.source, s.rules.holdDays]), [["form4", 60]]);
  assert.equal(done.backtests[0].prior.source, "form4");
  assert.deepEqual(done.backtests[0].diff, ["hold 30 d → hold 60 d"]);
});
