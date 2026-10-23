import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runTool } from "../server/ai/tools.mjs";
import { INVESTIGATION_TOOLS } from "../server/ai/investigationTools.mjs";
import { investigationFixture } from "./fixtures/investigationAskFixture.mjs";
import { createInvestigation, runInvestigation } from "../server/domain/workflow/investigations.mjs";

const tool = (name) => INVESTIGATION_TOOLS.find((entry) => entry.name === name);

test("amendment tool preserves the original question and records the actual user request", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const fixture = investigationFixture(db);
    const parent = createInvestigation(db, fixture.protocol);
    const args = {
      id: parent.id,
      revision: parent.revision,
      protocol: { ...fixture.protocol, title: "Revised study" },
    };
    const amend = tool("research_amend_investigation");
    assert.throws(() => amend.run(db, args), /user amendment/);
    assert.throws(
      () =>
        amend.run(db, args, null, {
          question: "Establish causation now",
          intent: { route: "assessment", family: "causal" },
        }),
      /cannot silently replace/,
    );
    const result = amend.run(db, args, null, {
      question: "Rename this study",
      intent: { route: "assessment", family: "descriptive" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.investigation.parentId, parent.id);
    assert.equal(result.investigation.protocol.question, parent.protocol.question);
    assert.equal(result.investigation.amendment, "Rename this study");
    assert.equal(result.downloads.archive, null);
  } finally {
    db.close();
  }
});

test("replay tool retains the same investigation envelope and exposes deterministic verification", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const fixture = investigationFixture(db);
    const parent = createInvestigation(db, fixture.protocol);
    const frozen = await runInvestigation(db, parent.id, { revision: 1 });
    const result = await tool("research_replay_investigation").run(db, { id: parent.id });
    assert.equal(result.ok, true);
    assert.equal(result.replay.matches, true);
    assert.deepEqual(result.investigation, frozen);
    assert.ok(result.downloads.archive);
  } finally {
    db.close();
  }
});

test("direct dispatch prevents replay calculations during design/inspection and amendments during inspection", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const fixture = investigationFixture(db);
    const parent = createInvestigation(db, fixture.protocol);
    const args = { id: parent.id, revision: 1, protocol: fixture.protocol };
    for (const name of ["research_amend_investigation", "research_replay_investigation"]) {
      const denied = await runTool(db, name, args, undefined, null, "platform", {
        question: "Inspect the saved study",
        intent: { inspectionOnly: true },
      });
      assert.equal(denied.ok, false);
      assert.match(denied.error, /inspection/);
    }
    const denied = await runTool(db, "research_replay_investigation", args, undefined, null, "platform", {
      question: "Design only",
      intent: { designOnly: true },
    });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /design/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM research.workflow_revisions").get().n, 1);
  } finally {
    db.close();
  }
});
