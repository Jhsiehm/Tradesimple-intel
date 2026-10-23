import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runAsk } from "../server/ai/run.mjs";
import { runTool, toolDefs } from "../server/ai/tools.mjs";
import { studyAuditFixture } from "./fixtures/studyAuditFixture.mjs";
import { normalizeChats } from "../src/ask/chats.ts";

test("a saved-study answer includes exact interactive figure data without another calculation", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    studyAuditFixture(db, { name: "LMT saved evidence", partial: true, symbols: ["LMT"], cooldown: 30 });
    studyAuditFixture(db, { name: "HII saved evidence", symbols: ["HII"] });
    const events = [],
      calls = [];
    await runAsk({
      question: "Compare my saved LMT and HII studies with interactive graphs and explain coverage and timing.",
      provider: {
        async *chat() {
          yield {
            type: "text",
            delta:
              "LMT collection is partial; publication timing is assumed. HII is reconciled only within its saved scope [t1].",
          };
        },
      },
      tools: toolDefs(),
      acceptDefaults: true,
      execute: async (name, args, hooks) => {
        calls.push(name);
        return runTool(db, name, args, undefined, null, hooks.sourcing);
      },
      emit: (event) => events.push(event),
    });
    const done = events.findLast((event) => event.type === "done");
    assert.deepEqual(calls, ["research_audit_saved_studies"]);
    assert.ok(done.figures.length >= 3);
    assert.ok(
      done.figures.every((figure) => figure.kind !== "line"),
      "summary returns cannot become a daily curve",
    );
    const points = done.figures.flatMap((figure) => figure.series.flatMap((series) => series.points));
    assert.ok(points.some((point) => point.y === 0.0829));
    assert.ok(points.some((point) => point.y === 2163));
    assert.ok(points.every((point) => point.ref === "t1" && point.path.startsWith("/")));
    assert.ok(done.figures.some((figure) => figure.review?.studies.some((study) => /partial/i.test(study.coverage))));
    assert.ok(!done.figures.some((figure) => /live performance|verified strategy/i.test(figure.title)));
  } finally {
    db.close();
  }
});

test("saved chat loading retains bounded figures and rejects malformed graph specifications", () => {
  const figure = {
    id: "f",
    title: "Recorded values",
    kind: "bar",
    xLabel: "Company",
    yLabel: "Revenue",
    unit: "USD million",
    format: "number",
    totalPoints: 2,
    notes: ["Saved records"],
    sourceRefs: ["t1"],
    series: [
      {
        id: "revenue",
        label: "Revenue",
        points: [
          { label: "A", x: "A", y: 12, ref: "t1", path: "/rows/0/value" },
          { label: "B", x: "B", y: null, ref: "t1", path: "/rows/1/value" },
        ],
      },
    ],
  };
  const raw = [
    {
      id: "chat",
      title: "Saved evidence",
      updated: "2026-10-22",
      turns: [
        {
          question: "Describe revenue",
          done: { answer: "Saved records [t1].", figures: [figure, { kind: "html", script: "alert(1)" }] },
        },
      ],
    },
  ];
  const chats = normalizeChats(raw);
  assert.equal(chats[0].turns[0].done.figures.length, 1);
  assert.equal(chats[0].turns[0].done.figures[0].series[0].points[0].y, 12);
  assert.equal(chats[0].turns[0].done.figures[0].series[0].points[1].y, null);
  assert.equal(chats[0].turns[0].done.answer, "Saved records [t1].");
});
