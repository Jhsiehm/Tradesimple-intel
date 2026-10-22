import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runAsk } from "../server/ai/run.mjs";
import { runTool, toolDefs } from "../server/ai/tools.mjs";
import { savedStudyAuditArgs } from "../server/ai/studyAuditPlanning.mjs";
import { evidenceOf, groundingCheck } from "../shared/ask.mjs";
import { citationCheck } from "../shared/citations.mjs";
import { studyAuditFixture } from "./fixtures/studyAuditFixture.mjs";
import { DESCRIPTIVE_QUESTION } from "./fixtures/descriptiveQuestion.mjs";

const question =
  "Compare my saved LMT and HII procurement studies. Inspect their underlying datasets and results. Explain the records covered, exclusions, publication-timing assumptions, benchmark results, and coverage gaps. Which comparisons are supported, and which conclusions would overreach? Cite the saved evidence and distinguish completed calculations from complete data coverage.";
async function ask(db, answer, options = {}) {
  const calls = [],
    events = [],
    seen = [];
  const provider = {
    async *chat(messages, tools) {
      seen.push({ messages: structuredClone(messages), tools: tools.map((tool) => tool.name) });
      yield { type: "text", delta: answer };
    },
  };
  await runAsk({
    question,
    provider,
    tools: toolDefs(),
    acceptDefaults: true,
    execute: async (name, args, hooks) => {
      calls.push({ name, args });
      return runTool(db, name, args, undefined, null, hooks.sourcing);
    },
    emit: (event) => events.push(event),
    ...options,
  });
  return { calls, events, seen, done: events.findLast((event) => event.type === "done") };
}
function seed(db) {
  const lmt = studyAuditFixture(db, {
    name: "LMT partial test evidence",
    symbols: ["LMT"],
    partial: true,
    cooldown: 30,
    from: "2025-01-09",
  });
  const hii = studyAuditFixture(db, { name: "HII reconciled test evidence", symbols: ["HII"] });
  return { lmt, hii };
}

test("saved-study review is prefetched in one call and retains the evidence ledger", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    seed(db);
    const result = await ask(
      db,
      "LMT coverage is partial and HII is count-reconciled within its scope [t1]. Exclusions include cooldown and nonpositive obligations; publication timing is assumed, and arithmetic was not replayed [t1].",
    );
    assert.deepEqual(
      result.calls.map((call) => call.name),
      ["research_audit_saved_studies"],
    );
    assert.equal(result.done.stopped, "");
    const body = JSON.parse(result.seen[0].messages.find((message) => message.role === "tool").content);
    assert.equal(body.studies.length, 2);
    assert.equal(body.studies.find((study) => study.symbols.includes("LMT")).exclusions.cooldown, 2163);
    assert.equal(body.studies.find((study) => study.symbols.includes("HII")).coverage.providerReceived, 204);
    assert.equal(body.claimLimits.replayPerformed, false);
  } finally {
    db.close();
  }
});

test("unresolved saved-study overclaims fall back to a cited report that passes grounding", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    seed(db);
    const result = await ask(
      db,
      "Both collections are complete [t1]. No look-ahead bias was used [t1]. Calculation arithmetic was verified [t1].",
    );
    assert.match(result.done.answer, /narrative retained verification problems/);
    assert.match(result.done.answer, /partial/);
    for (const value of ["589", "44", "2163", "65", "130"]) assert.ok(result.done.answer.includes(value));
    assert.match(result.done.answer, /no new backtest or calculation replay was performed/);
    assert.match(result.done.answer, /(?:not matched to|did not verify) the requested study names/);
    assert.deepEqual(result.done.grounding.unmatched, []);
    assert.deepEqual(result.done.grounding.mislabeled, []);
    assert.deepEqual(result.done.grounding.miscited, []);
    assert.deepEqual(result.done.grounding.uncitedRows, []);
    assert.deepEqual(result.done.grounding.scope, []);
  } finally {
    db.close();
  }
});

test("four selected studies retain full statistics and exclusions in the model context", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of ["One", "Two", "Three", "Four"]) studyAuditFixture(db, { name, partial: true });
    const result = await ask(db, "The saved studies are partial and timing is assumed; exclusions are recorded [t1].");
    const body = JSON.parse(result.seen[0].messages.find((message) => message.role === "tool").content);
    assert.equal(body.studies.length, 4);
    assert.ok(body.studies.every((study) => study.exclusions.cooldown === 2163 && study.stats.total === 0.0829));
    assert.equal(body.claimLimits.replayPerformed, false);
  } finally {
    db.close();
  }
});

test("numeric descriptive designs are not mistaken for saved-result comparisons", () => {
  assert.equal(savedStudyAuditArgs(DESCRIPTIVE_QUESTION), null);
  assert.deepEqual(savedStudyAuditArgs(question), {});
  const id = `exp_${"a".repeat(32)}`;
  assert.deepEqual(savedStudyAuditArgs(`Inspect my saved study ${id}`), { experimentIds: [id] });
});

test("study audits obey memory, sourcing and scheduling boundaries", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    seed(db);
    const name = "research_audit_saved_studies";
    assert.ok(!toolDefs("web").some((tool) => tool.name === name));
    for (const context of [
      { memory: { mode: "isolated" } },
      { memory: { mode: "context-aware" } },
      { scheduled: true },
    ])
      assert.equal((await runTool(db, name, {}, undefined, null, "both", context)).ok, false);
    assert.equal((await runTool(db, name, {}, undefined, null, "web")).ok, false);
    const result = await ask(db, "Saved studies are outside this scope.", { memory: { mode: "isolated" } });
    assert.equal(result.calls.length, 0);
    assert.ok(result.seen.every((call) => !call.tools.includes(name)));
  } finally {
    db.close();
  }
});

test("percentage-point differences ground against saved fractional return differences", () => {
  const body = { ok: true, source: "Synthetic arithmetic evidence", excessTotal: -0.0742 };
  const evidence = [evidenceOf("t1", "fixture", {}, body)];
  const answer = "Recorded excess was -7.42 percentage points [t1].";
  assert.deepEqual(groundingCheck(answer, evidence).unmatched, []);
  assert.deepEqual(citationCheck(answer, evidence).miscited, []);
  assert.deepEqual(groundingCheck("Recorded excess was -8.42 percentage points [t1].", evidence).unmatched, [
    "-8.42 percentage points",
  ]);
});
