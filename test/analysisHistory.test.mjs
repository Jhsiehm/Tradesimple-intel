import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { prepareAskMemory } from "../server/ai/researchContext.mjs";
import { startAnalysis, getAnalysis } from "../server/domain/research-analysis.mjs";
import { describeAnalysis, analysisEventLabel } from "../src/research/analysis-records.ts";

test("history summarizes a stored incomplete journal without inventing completion or losing partial text", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const memory = prepareAskMemory(db, { mode: "isolated" });
    const journal = startAnalysis(db, {
      memory,
      request: { question: "Synthetic investigation" },
      provider: "fixture",
      model: "fixture-v1",
    });
    journal.append("model_input", { messages: [] });
    journal.append("tool_input", { name: "search", args: {} });
    journal.append("tool_output", { name: "search", result: { rows: [] } });
    journal.append("event", { type: "token", delta: "Partial answer" });
    const saved = getAnalysis(db, journal.id),
      view = describeAnalysis(saved);
    assert.equal(saved.status, "incomplete");
    assert.equal(view.answer, "Partial answer");
    assert.equal(view.question, "Synthetic investigation");
    assert.equal(view.modelCalls, 1);
    assert.equal(view.toolCalls, 1);
    assert.equal(view.snapshotId, memory.snapshotId);
    assert.equal(view.records.length, 0);
    assert.equal(analysisEventLabel(saved.events[2]), "Tool request · search");
    journal.append("event", { type: "error", error: "Provider disconnected" });
    journal.finish("failed");
    const failed = describeAnalysis(getAnalysis(db, journal.id));
    assert.equal(failed.answer, "Partial answer");
    assert.equal(failed.error, "Provider disconnected");
  } finally {
    db.close();
  }
});

test("history follows stream resets and terminal answers, while recovered provider errors remain only in the trail", () => {
  const events = [
    { kind: "model_output", data: { error: "Retryable failure" } },
    { kind: "event", data: { type: "token", delta: "discarded draft" } },
    { kind: "event", data: { type: "step_progress", reset: true } },
    { kind: "event", data: { type: "token", delta: "new draft" } },
    { kind: "model_output", data: { error: null } },
    { kind: "event", data: { type: "done", answer: "Recorded final answer" } },
  ];
  const view = describeAnalysis({ events });
  assert.equal(view.answer, "Recorded final answer");
  assert.equal(view.error, "");
  assert.equal(events[0].data.error, "Retryable failure");
  const paired = describeAnalysis({
    events: [{ kind: "event", data: { type: "error", answer: "Partial paired text", error: "Output truncated" } }],
  });
  assert.equal(paired.answer, "Partial paired text");
  assert.equal(paired.error, "Output truncated");
});
