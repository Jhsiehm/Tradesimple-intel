import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_LIMITS, evidenceOf } from "../shared/ask.mjs";
import { acceptRevision, cleanRevision, excerptRefs, flaggedItems, revisionBudget, revisionChanges, revisionMessages, revisionSummary } from "../shared/revise.mjs";
import { runAsk } from "../server/ai/run.mjs";
import { toolDefs } from "../server/ai/tools.mjs";

const LEADERS = { ok: true, source: "House Clerk PTRs · Senate eFD", asOf: "2026-10-09T13:37:00Z", latency: "PTRs up to 45 days after the trade", leaders: [{ symbol: "NVDA", ret: 0.1234, spy: 0.0311 }, { symbol: "MSFT", ret: 0.0512, spy: 0.0311 }] };
const INSIDERS = { ok: true, source: "SEC EDGAR Form 4", asOf: "2026-10-09T12:00:00Z", latency: "2 business days", items: [{ symbol: "LMT", value: 4_250_000 }, { symbol: "RTX", value: 980_000 }] };
const EV = [evidenceOf("t1", "congress_leaders", {}, LEADERS), evidenceOf("t2", "insiders", {}, INSIDERS)];

function scripted(...rounds) {
  const seen = [];
  return {
    seen,
    async *chat(messages, tools, opts) {
      seen.push({ messages: messages.map((m) => ({ ...m })), tools: tools.length, opts });
      for (const e of rounds.shift() || [{ type: "text", delta: "done" }]) yield e;
    }
  };
}
const TOOL = (name, args, id) => ({ type: "tool_call", id, name, args });
const TEXT = (t) => [{ type: "text", delta: t }];
const execute = async (name) => (name === "congress_leaders" ? LEADERS : name === "insiders" ? INSIDERS : { ok: false, error: "no" });

async function ask(provider, extra = {}) {
  const events = [];
  await runAsk({ question: "Leaders and insider buys", provider, tools: toolDefs(), execute, labelOf: (n) => n, emit: (e) => events.push(e), today: "2026-10-09", heartbeatMs: 60_000, ...extra });
  return events;
}

const MISCITED = "NVDA returned 12.34% [t2]. Insiders bought LMT for $4.25M [t2].";
const FIXED = "NVDA returned 12.34% [t1]. Insiders bought LMT for $4.25M [t2].";

/* ---------- pure ---------- */

test("flaggedItems turns every grounding flag into one item with a note", () => {
  const items = flaggedItems({
    grounding: { unmatched: ["61"], miscited: [{ raw: "12.34%", cited: ["t2"], foundIn: ["t1"] }], mislabeled: [{ raw: "117 tickers", value: 117, unit: "tickers", foundAs: ["unparsedPaperFilings"] }], scope: [{ kind: "window", raw: "last 30 days", refs: ["t1"], note: "window note" }], uncitedRows: ["| NVDA | 12% |"] },
    unknown: ["t9"],
    uncited: false
  });
  assert.deepEqual(items.map((i) => i.kind), ["unmatched", "miscited", "mislabeled", "scope", "uncitedRow", "unknownRef"]);
  assert.deepEqual(items[1].refs, ["t2", "t1"]);
  assert.match(items[1].note, /12\.34% is cited to t2, but only t1 returned it/);
  assert.deepEqual(flaggedItems({ grounding: { unmatched: [], miscited: [] }, unknown: [], uncited: false }), []);
});

test("revisionBudget skips when under 15 s are left or the call would pass the token budget", () => {
  assert.deepEqual(revisionBudget({ spent: 1000, tokenBudget: 80_000, msLeft: 60_000, need: 4000 }), { ok: true, reason: "" });
  assert.deepEqual(revisionBudget({ spent: 1000, tokenBudget: 80_000, msLeft: 9_400, need: 4000 }), { ok: false, reason: "time budget nearly spent (9 s left)" });
  assert.deepEqual(revisionBudget({ spent: 78_000, tokenBudget: 80_000, msLeft: 60_000, need: 4000 }), { ok: false, reason: "token budget nearly spent (78,000 of 80,000 tokens used)" });
});

test("the revision call sees the flagged items and the cited results, flagged refs first", () => {
  const items = flaggedItems({ grounding: { miscited: [{ raw: "12.34%", cited: ["t2"], foundIn: ["t1"] }] } });
  assert.deepEqual(excerptRefs(items, ["t2"], EV), ["t2", "t1"]);
  const [sys, user] = revisionMessages({ question: "q", answer: MISCITED, items, excerpts: [{ id: "t1", label: "Leaders", text: JSON.stringify(LEADERS) }] });
  assert.match(sys.content, /No tool calls/);
  assert.match(user.content, /\[t1\] Leaders\n\{"ok":true/);
  assert.match(user.content, /<<<\nNVDA returned 12\.34% \[t2\]/);
  assert.match(user.content, /Flagged:\n- 12\.34% is cited to t2/);
});

test("a revision is kept only when it clears a flag and is still a cited answer", () => {
  const one = [{ key: "a" }];
  assert.equal(acceptRevision([...one, { key: "b" }], one, FIXED, MISCITED), true);
  assert.equal(acceptRevision(one, one, FIXED, MISCITED), false);
  assert.equal(acceptRevision([...one, { key: "b" }], [], "done", MISCITED), false);
  assert.equal(acceptRevision([...one, { key: "b" }], [], "Short [t1].", MISCITED), false);
  assert.equal(cleanRevision("Corrected answer:\n<<<\nA [t1].\n>>>"), "A [t1].");
});

test("revisionChanges says what was corrected, removed, or still flagged, and which lines changed", () => {
  const before = flaggedItems({ grounding: { unmatched: ["61"], miscited: [{ raw: "12.34%", cited: ["t2"], foundIn: ["t1"] }] } });
  const after = [];
  const ch = revisionChanges("NVDA 12.34% [t2].\n61 late filings [t1].", "NVDA 12.34% [t1].", before, after);
  assert.equal(ch.fixed, 2);
  assert.deepEqual(ch.changes.map((c) => [c.raw, c.status]), [["61", "removed"], ["12.34%", "corrected"]]);
  assert.deepEqual(ch.removed, ["NVDA 12.34% [t2].", "61 late filings [t1]."]);
  assert.deepEqual(ch.added, ["NVDA 12.34% [t1]."]);
  assert.equal(revisionSummary({ status: "applied", ...ch }), "Revised: fixed 2 figures");
  assert.equal(revisionSummary({ status: "skipped", reason: "time budget nearly spent (9 s left)" }), "Not revised: time budget nearly spent (9 s left).");
});

/* ---------- runAsk ---------- */

test("runAsk: a miscited figure is revised once with no tools, re-grounded, and the revised answer is shown", async () => {
  const p = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")], TEXT(MISCITED), TEXT(FIXED));
  const events = await ask(p);
  const done = events.at(-1);
  assert.equal(p.seen.length, 3);
  assert.equal(p.seen[2].tools, 0);
  assert.match(p.seen[2].messages[1].content, /12\.34% is cited to t2, but only t1 returned it/);
  assert.match(p.seen[2].messages[1].content, /\[t1\] congress_leaders/);
  assert.deepEqual(events.filter((e) => e.type === "revise").map((e) => e.state), ["start", "end"]);
  assert.match(events.find((e) => e.type === "revise").note, /Checking figures/);
  assert.equal(done.answer, FIXED);
  assert.deepEqual(done.grounding.miscited, []);
  assert.equal(done.revision.status, "applied");
  assert.equal(done.revision.fixed, 1);
  assert.deepEqual(done.revision.changes.map((c) => [c.raw, c.status]), [["12.34%", "corrected"]]);
  assert.ok(events.findIndex((e) => e.type === "revise") > events.findLastIndex((e) => e.type === "token"));
});

test("runAsk: a clean answer gets no revision call", async () => {
  const p = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")], TEXT(FIXED));
  const done = (await ask(p)).at(-1);
  assert.equal(p.seen.length, 2);
  assert.equal(done.revision, null);
});

test("runAsk: a revision that clears nothing keeps the original answer and its warnings", async () => {
  const p = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")], TEXT(MISCITED), TEXT(MISCITED));
  const done = (await ask(p)).at(-1);
  assert.equal(done.answer, MISCITED);
  assert.equal(done.revision.status, "kept");
  assert.equal(done.grounding.miscited.length, 1);
});

test("runAsk: revision is skipped, and says so, when the time budget is nearly spent", async () => {
  let clock = 1_000_000;
  const p = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")], TEXT(MISCITED));
  const late = { async *chat(messages, tools, opts) { clock += ASK_LIMITS.totalMs - 10_000; yield* p.chat(messages, tools, opts); } };
  let n = 0;
  const provider = { async *chat(m, t, o) { n += 1; yield* (n === 2 ? late : p).chat(m, t, o); } };
  const done = (await ask(provider, { now: () => clock })).at(-1);
  assert.equal(n, 2);
  assert.equal(done.answer, MISCITED);
  assert.equal(done.revision.status, "skipped");
  assert.match(done.revision.reason, /^time budget nearly spent \(\d+ s left\)$/);
  assert.equal(done.grounding.miscited.length, 1);
});

test("runAsk: revision is skipped when the token budget is nearly spent", async () => {
  const usage = (input) => ({ type: "usage", input, output: 0 });
  const p = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b"), usage(10)], [...TEXT(MISCITED), usage(ASK_LIMITS.tokenBudget - 500)]);
  const done = (await ask(p)).at(-1);
  assert.equal(p.seen.length, 2);
  assert.equal(done.revision.status, "skipped");
  assert.match(done.revision.reason, /^token budget nearly spent/);
});

test("runAsk: under Auto the revision pass runs on the strong model; a pinned model revises itself", async () => {
  const main = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")], TEXT(MISCITED));
  const strong = scripted(TEXT(FIXED));
  const done = (await ask(main, { auto: true, model: "small/mini", strong: { model: "big/strong", provider: strong } })).at(-1);
  assert.equal(main.seen.length, 2);
  assert.equal(strong.seen.length, 1);
  assert.equal(done.revision.model, "big/strong");
  assert.equal(done.model, "small/mini");

  const pinned = scripted([TOOL("congress_leaders", {}, "a"), TOOL("insiders", {}, "b")], TEXT(MISCITED), TEXT(FIXED));
  const never = { async *chat() { assert.fail("strong model used while pinned"); } };
  const out = (await ask(pinned, { auto: false, model: "openai/gpt-4.1", strong: { model: "big/strong", provider: never } })).at(-1);
  assert.equal(out.revision.model, "openai/gpt-4.1");
  assert.equal(out.answer, FIXED);
});
