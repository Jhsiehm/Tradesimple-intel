import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { makeAskHandler } from "../server/routes/ask.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { runTool, toolDefs } from "../server/ai/tools.mjs";
import { listInvestigations } from "../server/domain/workflow/investigations.mjs";
import { noReuseReason } from "../shared/answerCache.mjs";
import { sameData } from "../server/ai/answerCache.mjs";
import { INVESTIGATION_TOOL_NAMES, OWNER_RESEARCH_TOOL_NAMES } from "../shared/investigationAccess.mjs";
import { investigationFixture } from "./fixtures/investigationAskFixture.mjs";
import { DESCRIPTIVE_QUESTION } from "./fixtures/descriptiveQuestion.mjs";

const ENV = { ASK_PROVIDER: "openrouter", OPENROUTER_API_KEY: "synthetic-key", ASK_MONTHLY_BUDGET_USD: "0" };
const tool = (name, args) => ({ type: "tool_call", id: name, name, args });
const text = (delta) => ({ type: "text", delta });
function setup(script, { seed = true } = {}) {
  const db = new DatabaseSync(":memory:"),
    fixture = seed ? investigationFixture(db) : null,
    calls = [],
    seen = [];
  const state = { fixture, saved: null };
  const handler = makeAskHandler({
    env: ENV,
    log() {},
    makeProvider: (cfg) => {
      let round = 0;
      return {
        name: "openrouter",
        model: cfg.model,
        async *chat(messages, tools) {
          seen.push({ messages: structuredClone(messages), tools: tools.map((t) => t.name) });
          for (const chunk of script(round++, state, messages)) yield chunk;
          yield { type: "usage", input: 20, output: 20, cost: 0 };
        },
      };
    },
    execute: async (db, name, args, hooks) => {
      calls.push({ name, args });
      const result = await runTool(db, name, args, undefined, null, hooks?.sourcing || "platform", hooks?.research);
      if (result.investigation) state.saved = result.investigation;
      return result;
    },
  });
  const ask = async (body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: "POST", headers: {}, socket: { remoteAddress: "127.0.0.1" } });
    const chunks = [],
      res = {
        writableEnded: false,
        destroyed: false,
        on() {},
        writeHead() {},
        write(chunk) {
          chunks.push(chunk);
          return true;
        },
        end() {
          this.writableEnded = true;
        },
      };
    await handler({ db, req, res });
    return chunks
      .join("")
      .split("\n\n")
      .filter(Boolean)
      .map((item) => JSON.parse(item.slice(6)));
  };
  return { db, fixture, ask, state, calls, seen };
}

test("Ask composes and executes a new multi-source study with the original question retained", async () => {
  const s = setup((round, state) => {
    if (!round) return [tool("research_sources", {})];
    if (round === 1)
      return [
        tool("research_create_investigation", {
          protocol: { ...state.fixture.protocol, question: "Do not preserve this model paraphrase." },
        }),
      ];
    if (round === 2)
      return [tool("research_run_investigation", { id: state.saved.id, revision: state.saved.revision })];
    return [
      text(
        "Mean operating surplus is 9.5 USD million across 2 paired observations [t3]. These synthetic inputs establish no investment finding.",
      ),
    ];
  });
  try {
    const events = await s.ask({ question: s.fixture.question });
    assert.equal(s.state.saved.protocol.question, s.fixture.question);
    assert.equal(s.state.saved.result.executed, true);
    assert.equal(s.state.saved.result.claimScope, "descriptive");
    assert.deepEqual(
      s.calls.map((call) => call.name),
      ["research_sources", "research_create_investigation", "research_run_investigation"],
    );
    assert.equal(s.state.saved.result.outputs.summary.preview[0].mean, 9.5);
    assert.equal(s.state.saved.result.outputs.summary.preview[0].n, 2);
    assert.ok(events.find((event) => event.type === "done").answer.includes("9.5"));
    assert.equal(listInvestigations(s.db).items.length, 1);
  } finally {
    s.db.close();
  }
});

test("the same tools execute a different graph without a question-specific route", async () => {
  const s = setup((round, state) => {
    const p = state.fixture.protocol;
    if (!round)
      return [
        tool("research_create_investigation", {
          protocol: {
            ...p,
            title: "Revenue over threshold",
            nodes: [
              p.nodes[0],
              { id: "large", op: "filter", input: "revenue", field: "value", operator: "gt", value: 14 },
              { id: "summary", op: "summarize", input: "large", value: "value", groupBy: [] },
            ],
            outputs: ["summary"],
          },
        }),
      ];
    if (round === 1)
      return [tool("research_run_investigation", { id: state.saved.id, revision: state.saved.revision })];
    return [
      text(
        "The selected revenue mean is 20 USD million across 1 observation [t2]. Coverage is only the saved fixture.",
      ),
    ];
  });
  try {
    await s.ask({ question: "Describe revenue above 14 USD million in the saved company observations." });
    assert.equal(s.state.saved.result.outputs.summary.preview[0].mean, 20);
    assert.equal(s.state.saved.result.outputs.summary.preview[0].n, 1);
    assert.equal(s.state.saved.result.steps.find((step) => step.id === "large").ledger.excluded, 1);
  } finally {
    s.db.close();
  }
});

test("a broad causal request reaches planning while unsupported calculation and legacy substitution stay blocked", async () => {
  const question = "Did legislative appropriations cause larger government contract awards?";
  const s = setup((round, state) => {
    if (!round) return [tool("run_backtest", { spec: { source: "congress" } })];
    if (round === 1)
      return [
        tool("research_create_investigation", {
          protocol: {
            ...state.fixture.protocol,
            family: "causal",
            nodes: [],
            outputs: [],
            unresolved: ["Versioned legislation and procurement data plus a justified causal comparison are missing."],
          },
        }),
      ];
    if (round === 2)
      return [tool("research_run_investigation", { id: state.saved.id, revision: state.saved.revision })];
    return [
      text(
        "Saved the causal design, but no causal analysis executed. Source coverage and identification remain unresolved [t3].",
      ),
    ];
  });
  try {
    const events = await s.ask({ question });
    assert.ok(s.seen.length > 0);
    assert.ok(s.seen[0].messages[0].content.includes("Research investigation mode"));
    assert.ok(!s.calls.some((call) => call.name === "run_backtest"));
    assert.equal(s.state.saved.protocol.question, question);
    assert.equal(s.state.saved.result.executed, false);
    assert.equal(s.state.saved.result.status, "blocked");
    assert.deepEqual(events.find((event) => event.type === "done").backtests, []);
  } finally {
    s.db.close();
  }
});

test("model arguments cannot narrow a resolved family or discard inherited research context", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const f = investigationFixture(db),
      context = {
        question: "Now use one month",
        intent: {
          route: "assessment",
          family: "causal",
          contextQuestion: "Did changes in regulation cause later revenue growth?",
        },
      };
    const bad = await runTool(
      db,
      "research_create_investigation",
      { protocol: f.protocol },
      undefined,
      null,
      "platform",
      context,
    );
    assert.equal(bad.ok, false);
    assert.match(bad.error, /cannot silently replace/);
    const good = await runTool(
      db,
      "research_create_investigation",
      { protocol: { ...f.protocol, family: "causal", nodes: [], outputs: [], unresolved: ["Identification missing"] } },
      undefined,
      null,
      "platform",
      context,
    );
    assert.match(good.investigation.protocol.question, /Did changes in regulation.*\n\nFollow-up: Now use one month/);
    assert.equal(good.investigation.result, null);
    assert.equal(good.investigation.status, "blocked");
  } finally {
    db.close();
  }
});

test("controlled memory excludes study tools in definitions and dispatch", async () => {
  const s = setup((round) =>
    round ? [text("Saved datasets are outside the selected notebook scope.")] : [tool("research_sources", {})],
  );
  try {
    await s.ask({ question: "Describe saved numeric studies", memory: { mode: "isolated" } });
    assert.equal(s.calls.length, 0);
    assert.ok(s.seen.every((round) => round.tools.every((name) => !OWNER_RESEARCH_TOOL_NAMES.has(name))));
    for (const mode of ["isolated", "context-aware"]) {
      const denied = await runTool(s.db, "research_sources", {}, undefined, null, "both", { memory: { mode } });
      assert.equal(denied.ok, false);
      assert.match(denied.error, /controlled notebook-memory/);
    }
    assert.equal((await runTool(s.db, "research_sources", {}, undefined, null, "web")).ok, false);
    assert.equal((await runTool(s.db, "research_sources", {}, undefined, null, "both", { scheduled: true })).ok, false);
  } finally {
    s.db.close();
  }
});

test("the actual revenue/cost prompt can save a blocked descriptive design with no observations", async () => {
  const s = setup(
    (round, state) => {
      if (!round) return [tool("research_sources", {})];
      if (round === 1)
        return [
          tool("research_create_investigation", {
            protocol: {
              title: "Revenue less operating costs",
              question: DESCRIPTIVE_QUESTION,
              hypothesis: "Describe revenue minus operating costs and the matched-company average.",
              family: "descriptive",
              population: "Companies with compatible financial reports",
              unitOfAnalysis: "company-reporting period",
              outcome: "Revenue minus operating costs in common units",
              comparison: "Matched company and reporting period",
              from: null,
              to: null,
              knownAt: null,
              assumptions: [],
              unresolved: [
                "Import revenue and operating-cost observations with matching company IDs, periods, units and publication dates; define study period and knowledge cutoff.",
              ],
              nodes: [],
              outputs: [],
            },
          }),
        ];
      return [
        text(
          "Saved a blocked descriptive design; no calculation executed. Compatible revenue and operating-cost observations, period and cutoff are missing [t2].",
        ),
      ];
    },
    { seed: false },
  );
  try {
    const events = await s.ask({ question: DESCRIPTIVE_QUESTION });
    assert.equal(s.state.saved.protocol.question, DESCRIPTIVE_QUESTION);
    assert.equal(s.state.saved.protocol.family, "descriptive");
    assert.equal(s.state.saved.status, "blocked");
    assert.equal(s.state.saved.result, null);
    assert.deepEqual(
      s.calls.map((call) => call.name),
      ["research_sources", "research_create_investigation"],
    );
    assert.equal(listInvestigations(s.db).items.length, 1);
    assert.equal(events.findLast((event) => event.type === "done").backtests.length, 0);
  } finally {
    s.db.close();
  }
});

test("cache revalidation cannot replay stateful study tools", async () => {
  for (const tool of ["research_create_investigation", "research_run_investigation"]) {
    assert.ok(noReuseReason([{ type: "done", usage: { tokens: 10 } }], [{ tool }]));
    let executed = 0;
    assert.equal(
      await sameData([{ tool, args: {}, hash: "old" }], () => {
        executed++;
      }),
      false,
    );
    assert.equal(executed, 0);
  }
});

test("without a full compatible study toolchain the assessment fallback stays available", async () => {
  const events = [];
  await runAsk({
    question: "Does CPI predict next-month returns?",
    acceptDefaults: true,
    tools: toolDefs().filter((tool) => !INVESTIGATION_TOOL_NAMES.has(tool.name)),
    provider: {
      async *chat() {
        throw Error("Must not run");
      },
    },
    execute() {
      throw Error("Must not execute");
    },
    emit: (event) => events.push(event),
  });
  assert.equal(events.at(-1).research.executed, false);
});
