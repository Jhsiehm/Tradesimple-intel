import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { POLICY_TOOLS, policyInvestigationSummary } from "../server/ai/policyTools.mjs";
import { interpretResearch } from "../shared/researchIntent.mjs";
import { researchExecutionRefusal } from "../shared/researchExecutionScope.mjs";
import { readFileSync } from "node:fs";
import { policyStudyProtocolInput } from "./fixtures/policyStudy.mjs";
const run = (name, db, args, context) =>
  POLICY_TOOLS.find((t) => t.name === `research_policy_${name}`).run(db, args, null, context);
const context = {
  question: "Describe paired legislative event returns versus news entry returns for these bills.",
  intent: { family: "descriptive" },
};

test("policy chat lifecycle preserves question, rejects stale revisions, freezes gaps and verifies replay", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const created = await run(
      "create",
      db,
      { protocol: { ...policyStudyProtocolInput(), question: "Invented question" } },
      context,
    );
    const saved = created.policyInvestigation;
    assert.equal(saved.protocol.question, context.question);
    assert.equal(saved.revision, 1);
    assert.equal(created.downloads.archive, null);
    assert.equal(run("inspect", db, { id: saved.id }).policyInvestigation.id, saved.id);
    assert.equal(run("inspect", db, {}).items.length, 1);
    await assert.rejects(run("evaluate", db, { id: saved.id }, context), /exact inspected revision/);
    const evaluated = await run("evaluate", db, { id: saved.id, revision: 1 }, context);
    assert.equal(evaluated.policyInvestigation.result.executed, false);
    assert.equal(evaluated.policyInvestigation.result.status, "insufficient-evidence");
    assert.ok(evaluated.downloads.archive.endsWith("/archive"));
    await assert.rejects(run("collect", db, { id: saved.id, revision: 1 }, context), /changed/);
    const replay = await run("replay", db, { id: saved.id, revision: evaluated.policyInvestigation.revision }, context);
    assert.equal(replay.replay.matches, true);
  } finally {
    db.close();
  }
});

test("policy tools enforce scope internally even if selected by a model", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const action of ["create", "collect", "evaluate", "replay"]) {
      await assert.rejects(
        run(action, db, { protocol: policyStudyProtocolInput() }, { ...context, intent: { inspectionOnly: true } }),
        /inspection/,
      );
    }
    for (const action of ["collect", "evaluate", "replay"]) {
      await assert.rejects(run(action, db, {}, { ...context, intent: { designOnly: true } }), /design only/);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(run(action, db, {}, { ...context, signal: controller.signal }), /abort/i);
    }
    const saved = (
      await run("create", db, { protocol: policyStudyProtocolInput() }, { ...context, intent: { designOnly: true } })
    ).policyInvestigation;
    for (const family of ["causal", "predictive", "strategy"]) {
      await assert.rejects(
        run("evaluate", db, { id: saved.id, revision: saved.revision }, { ...context, intent: { family } }),
        /narrower descriptive/,
      );
    }
    assert.equal(run("inspect", db, {}).items.length, 1);
    assert.ok(!POLICY_TOOLS.some((tool) => /import/.test(tool.name)));
  } finally {
    db.close();
  }
});

test("chat summaries bound evidence/results and exclude minute bars and raw payloads", () => {
  const rows = Array.from({ length: 100 }, (_, id) => ({ id }));
  const summary = policyInvestigationSummary({
    evidence: { events: rows, news: rows, bars: rows, sources: rows.map((row) => ({ ...row, payload: "raw" })) },
    readiness: { gaps: rows },
    result: { rows, exclusions: rows, gaps: rows },
  });
  assert.equal(summary.evidence.bars, undefined);
  assert.equal(summary.evidence.counts.bars, 100);
  assert.equal(summary.evidence.events.length, 10);
  assert.equal(summary.evidence.sources.length, 20);
  assert.equal(summary.evidence.sources[0].payload, undefined);
  assert.equal(summary.result.rows.length, 20);
  assert.equal(summary.result.totalRows, 100);
  assert.equal(summary.result.totalExclusions, 100);
});

test("saved unsupported claims cannot be laundered by a later run-it instruction", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const question of [
      "Estimate the causal effect of legislative votes on prices.",
      "Predict stock prices from legislative votes.",
      "Backtest a profitable trading strategy using legislative votes.",
    ]) {
      const saved = (await run("create", db, { protocol: policyStudyProtocolInput() }, { question }))
        .policyInvestigation;
      await assert.rejects(
        run(
          "evaluate",
          db,
          { id: saved.id, revision: saved.revision },
          { question: "Run it", intent: { family: "descriptive" } },
        ),
        /save a new narrower descriptive/,
      );
      assert.equal(run("inspect", db, { id: saved.id }).policyInvestigation.revision, saved.revision);
    }
  } finally {
    db.close();
  }
});

test("summaries explicitly exclude full frozen evaluation inputs and retain bounded provider failures", () => {
  const rows = Array.from({ length: 100 }, () => ({
    status: "failed",
    message: "Provider unavailable",
    payload: "raw",
  }));
  const summary = policyInvestigationSummary({
    id: "policy_example",
    revision: 3,
    evaluation: { inputHash: "hash", inputs: { evidence: { bars: rows } }, engineFiles: { code: "raw" } },
    evidence: {
      manifest: { status: "partial", legislation: rows, news: [{ status: "timeout" }] },
      newsCoverage: rows,
      sources: [{ body: "raw", payload: "raw", contentHash: "hash" }],
    },
  });
  assert.deepEqual(summary.evaluation, { inputHash: "hash" });
  assert.equal(summary.evidence.manifest.status, "partial");
  assert.equal(summary.evidence.manifest.news[0].status, "timeout");
  assert.equal(summary.evidence.manifest.legislation.length, 30);
  assert.equal(summary.evidence.manifest.legislation[0].payload, undefined);
  assert.equal(summary.evidence.newsCoverage.length, 10);
  assert.deepEqual(summary.evidence.sources[0], { contentHash: "hash" });
  assert.ok(!JSON.stringify(summary).includes('"raw"'));
});

test("policy replay cancellation reaches the calculation worker and preserves the saved revision", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const created = (await run("create", db, { protocol: policyStudyProtocolInput() }, context)).policyInvestigation;
    const saved = (await run("evaluate", db, { id: created.id, revision: created.revision }, context))
      .policyInvestigation;
    const controller = new AbortController();
    const pending = run(
      "replay",
      db,
      { id: saved.id, revision: saved.revision },
      { ...context, signal: controller.signal },
    );
    controller.abort();
    await assert.rejects(pending, /cancelled|abort/i);
    assert.equal(run("inspect", db, { id: saved.id }).policyInvestigation.revision, saved.revision);
  } finally {
    db.close();
  }
});

test("exact policy card action prompts release prior design-only scope and evaluate/replay a descriptive plan", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const initial = { question: "Design only: describe paired legislative event returns versus news entry returns." };
    const saved = (await run("create", db, { protocol: policyStudyProtocolInput() }, initial)).policyInvestigation;
    const history = [{ role: "user", content: initial.question }];
    const source = readFileSync(new URL("../src/ask/ResearchStudyCards.tsx", import.meta.url), "utf8");
    const cardPrompt = (prefix) => {
      const template = source.split("`").find((text) => text.startsWith(prefix));
      assert.ok(template, `Missing card action: ${prefix}`);
      return template.replace("${study.id}", saved.id);
    };
    const scoped = (question) => ({ question, intent: interpretResearch(question, { history }) });
    const collection = scoped(cardPrompt("Run evidence collection for policy investigation"));
    assert.equal(collection.intent.designOnly, undefined);
    assert.equal(researchExecutionRefusal(collection.intent, "research_policy_collect"), "");
    const evaluation = scoped(cardPrompt("Run evaluation of policy investigation"));
    assert.equal(evaluation.intent.designOnly, undefined);
    assert.equal(evaluation.intent.family, "descriptive");
    const evaluated = (await run("evaluate", db, { id: saved.id, revision: saved.revision }, evaluation))
      .policyInvestigation;
    assert.equal(evaluated.result.status, "insufficient-evidence");
    const replay = scoped(cardPrompt("Replay investigation"));
    assert.equal(replay.intent.designOnly, undefined);
    const verified = await run("replay", db, { id: saved.id, revision: evaluated.revision }, replay);
    assert.equal(verified.replay.matches, true);
  } finally {
    db.close();
  }
});
