import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { modelOptions } from "../shared/agent.mjs";
import { AUTO, heavyReason, modelShort, nudgeToAuto, routeModel, turnModel } from "../shared/modelRoute.mjs";
import { askConfig } from "../server/ai/config.mjs";
import { askStatus, makeAskHandler } from "../server/routes/ask.mjs";

const OR = { provider: "openrouter", model: "openai/gpt-4o-mini", strong: "anthropic/claude-sonnet-4.6" };

test("heavy work: backtests, web research and several sources; greetings and one-source lookups are not", () => {
  assert.equal(heavyReason({ question: "anything", backtest: true }), "backtest");
  assert.equal(heavyReason({ question: "How is the Nikkei?", web: true }), "web research");
  assert.equal(heavyReason({ question: "Which senators traded LMT before the contract awards?" }), "multi-source");
  assert.equal(heavyReason({ question: "Cross-reference everything on NVDA" }), "multi-source");
  assert.equal(heavyReason({ question: "What did Nancy Pelosi file most recently?" }), "");
  assert.equal(heavyReason({ question: "hi" }), "");
});

test("routeModel: auto, empty, or an unknown model is Auto; an allowed model is pinned", () => {
  assert.deepEqual(routeModel(AUTO, OR), { model: "openai/gpt-4o-mini", auto: true, pinned: false });
  assert.deepEqual(routeModel("", OR), { model: "openai/gpt-4o-mini", auto: true, pinned: false });
  assert.deepEqual(routeModel("evil/model", OR), { model: "openai/gpt-4o-mini", auto: true, pinned: false });
  assert.deepEqual(routeModel("openai/gpt-4.1", OR), { model: "openai/gpt-4.1", auto: false, pinned: true });
  assert.equal(turnModel(routeModel(AUTO, OR), OR.strong, "backtest"), OR.strong);
  assert.equal(turnModel(routeModel(AUTO, OR), OR.strong, ""), OR.model);
  assert.equal(turnModel(routeModel("openai/gpt-4.1", OR), OR.strong, "backtest"), "openai/gpt-4.1");
});

test("the strong model is an allowed option; ASK_STRONG_MODEL overrides the provider default", () => {
  assert.ok(modelOptions(OR).includes(OR.strong));
  assert.deepEqual(modelOptions({ provider: "compat", model: "m", strong: "big" }), ["m", "big"]);
  assert.equal(askConfig({ OPENROUTER_API_KEY: "k", ASK_MODEL: "openai/gpt-4o-mini" }).strong, "anthropic/claude-sonnet-4.6");
  assert.equal(askConfig({ OPENROUTER_API_KEY: "k", ASK_STRONG_MODEL: "openai/gpt-5.4" }).strong, "openai/gpt-5.4");
  assert.equal(askConfig({ ASK_PROVIDER: "compat", ASK_BASE_URL: "https://gw/v1", ASK_API_KEY: "k", ASK_MODEL: "m" }).strong, "m");
  assert.equal(askStatus({ OPENROUTER_API_KEY: "k", ASK_MODEL: "openai/gpt-4o-mini" }).strong, "anthropic/claude-sonnet-4.6");
});

test("the nudge is for a saved small model only, and model names read short", () => {
  assert.equal(nudgeToAuto("openai/gpt-4o-mini"), true);
  assert.equal(nudgeToAuto("anthropic/claude-haiku-4.5"), true);
  assert.equal(nudgeToAuto("openai/gpt-4.1"), false);
  assert.equal(nudgeToAuto(AUTO), false);
  assert.equal(nudgeToAuto(""), false);
  assert.equal(modelShort("anthropic/claude-sonnet-4.6"), "Sonnet 4.6");
  assert.equal(modelShort("claude-sonnet-4-5"), "Sonnet 4.5");
  assert.equal(modelShort("anthropic/claude-haiku-4.5"), "Haiku 4.5");
  assert.equal(modelShort("openai/gpt-4.1-mini"), "GPT-4.1 mini");
  assert.equal(modelShort("openai/gpt-5.4"), "GPT-5.4");
  assert.equal(modelShort("google/gemini-2.5-pro"), "Gemini 2.5 Pro");
});

/* ---------- through the route, with fake providers ---------- */

function fakeReq(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = "POST";
  req.headers = {};
  req.socket = { remoteAddress: `10.0.0.${Math.floor(Math.random() * 200)}` };
  return req;
}
function fakeRes() {
  const res = { chunks: [], writableEnded: false, destroyed: false };
  res.writeHead = () => {};
  res.write = (c) => { res.chunks.push(c); return true; };
  res.end = () => { res.writableEnded = true; };
  res.on = () => {};
  res.events = () => res.chunks.join("").split("\n\n").filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, "")));
  return res;
}

const ENV = { OPENROUTER_API_KEY: "sk-test", ASK_MODEL: "openai/gpt-4o-mini" };
const BACKTEST = { ok: true, source: "S", asOf: "2026-10-09T13:00:00Z", latency: "L", spec: {}, description: "d", counts: { signalsOnChosenSides: 37, tradesPriced: 30 }, stats: { trades: 30, totalReturn: 0.0834 } };

/** One provider per model; each records the questions it answered. */
function harness() {
  const used = [];
  const makeProvider = (cfg) => ({
    model: cfg.model,
    async *chat(messages, tools) {
      used.push(cfg.model);
      const ran = messages.some((m) => m.role === "tool");
      if (!ran && tools.some((t) => t.name === "run_backtest") && /backtest/i.test(messages.at(-1).content)) {
        yield { type: "tool_call", id: "c1", name: "run_backtest", args: { spec: {} } };
        return;
      }
      yield { type: "text", delta: ran ? "It made 8.34% over 30 trades [t1]." : "Hello there." };
    }
  });
  const execute = async (_db, name) => (name === "run_backtest" ? BACKTEST : { ok: true, source: "web", results: [] });
  return { used, handler: makeAskHandler({ env: ENV, makeProvider, execute, log: () => {} }) };
}

const run = async (body) => {
  const h = harness();
  const res = fakeRes();
  await h.handler({ req: fakeReq(body), res, db: {} });
  return { used: h.used, events: res.events() };
};

test("Auto: a backtest is answered by the strong model, and the turn says which model and why", async () => {
  const { used, events } = await run({ question: "Backtest congress buys over the last 90 days", model: AUTO, acceptDefaults: true });
  assert.ok(used.length >= 2);
  assert.ok(used.every((m) => m === "anthropic/claude-sonnet-4.6"), used.join());
  assert.deepEqual(events.find((e) => e.type === "model"), { type: "model", model: "anthropic/claude-sonnet-4.6", auto: true, reason: "backtest" });
  const done = events.at(-1);
  assert.equal(done.model, "anthropic/claude-sonnet-4.6");
  assert.deepEqual(done.backtests[0].counts, BACKTEST.counts);
});

test("Auto: web research goes to the strong model; a simple lookup stays on the server's model", async () => {
  const web = await run({ question: "What happened with the ECB rate decision?", model: AUTO, session: { v: 1, sourcing: "both" } });
  assert.ok(web.used.length && web.used.every((m) => m === "anthropic/claude-sonnet-4.6"), web.used.join());
  assert.equal(web.events.find((e) => e.type === "model").reason, "web research");
  const simple = await run({ question: "What did Nancy Pelosi file most recently?" });
  assert.deepEqual(simple.used, ["openai/gpt-4o-mini"]);
  assert.equal(simple.events.find((e) => e.type === "model").reason, "");
});

test("a pinned model answers a backtest itself; a model the server does not offer falls back to Auto", async () => {
  const pinned = await run({ question: "Backtest congress buys over the last 90 days", model: "openai/gpt-4.1", acceptDefaults: true });
  assert.ok(pinned.used.length && pinned.used.every((m) => m === "openai/gpt-4.1"), pinned.used.join());
  assert.equal(pinned.events.some((e) => e.type === "model"), false);
  assert.equal(pinned.events.at(-1).model, "openai/gpt-4.1");
  const evil = await run({ question: "Backtest congress buys over the last 90 days", model: "evil/model", acceptDefaults: true });
  assert.ok(evil.used.every((m) => m === "anthropic/claude-sonnet-4.6"), evil.used.join());
});
