import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capChats, filterChats, normalizeChats, orderChats, pinChat, removeChat, renameChat, restoreChat, shortTitle, upsertChat
} from "../src/ask/chats.ts";

test("short titles drop lead-ins and tails, tidy spacing, capitalize", () => {
  assert.equal(shortTitle("can you backtest the last 30 days from all data sources?"), "Backtest the last 30 days from all data sources");
  assert.equal(shortTitle("  hey,   could you please   show me Pelosi's trades , thanks!! "), "Pelosi's trades");
  assert.equal(shortTitle("how are the markets today"), "How are the markets today");
  assert.equal(shortTitle("I want to know who traded NVDA in the last 90 days ?"), "Who traded NVDA in the last 90 days");
  assert.equal(shortTitle("tell me about the Taiwan market today please"), "About the Taiwan market today");
  assert.equal(shortTitle("insider buys in LMT,RTX since 2025 — backtest"), "Insider buys in LMT, RTX since 2025 — backtest");
  assert.equal(shortTitle("“What did Nancy Pelosi file most recently?”"), "What did Nancy Pelosi file most recently");
  assert.equal(shortTitle("returns of 10 %"), "Returns of 10%");
});

test("short titles stay under 48 characters, cut on a word with an ellipsis", () => {
  const t = shortTitle("Which members of the House Armed Services Committee bought defense contractors before the NDAA vote");
  assert.ok(t.length <= 48, t);
  assert.ok(t.endsWith("…"));
  assert.equal(t, "Which members of the House Armed Services…");
  assert.equal(shortTitle(""), "Untitled");
  assert.equal(shortTitle("please?"), "Untitled");
  assert.equal(shortTitle("ok"), "Untitled");
});

const turn = (question) => ({ id: `t-${question}`, question, at: "", text: "x", steps: [], phase: "done", notes: [], done: null, clarify: null, error: "", model: "", context: "" });

test("stored chats migrate on read: auto titles recomputed, renamed titles and pins kept, junk dropped", () => {
  const raw = [
    { id: "a", title: "can you backtest the last 30 days from all data sources and compare it against SPY over the same window", turns: [turn("can you backtest the last 30 days from all data sources and compare it against SPY over the same window")], updated: "2026-10-09T10:00:00Z" },
    { id: "b", title: "My NVDA notes", named: true, pinned: true, turns: [turn("who traded nvda")], updated: "2026-10-08T10:00:00Z" },
    { id: "c", title: "   ", named: true, turns: [turn("how are the markets today")], updated: "" },
    { id: "d", turns: [] },
    null,
    { id: 4, turns: [turn("x")] }
  ];
  const out = normalizeChats(raw);
  assert.deepEqual(out.map((c) => c.id), ["a", "b", "c"]);
  assert.equal(out[0].title, "Backtest the last 30 days from all data sources…");
  assert.equal(out[0].named, undefined);
  assert.equal(out[1].title, "My NVDA notes");
  assert.equal(out[1].named, true);
  assert.equal(out[1].pinned, true);
  assert.equal(out[2].title, "How are the markets today");
  assert.equal(out[2].named, undefined);
  assert.equal(out[0].turns[0].question.length > 48, true, "the question itself is untouched");
  assert.deepEqual(normalizeChats(null), []);
});

test("rename, pin, order, delete and undo", () => {
  const list = normalizeChats([
    { id: "a", turns: [turn("first question")], updated: "3" },
    { id: "b", turns: [turn("second question")], updated: "2" },
    { id: "c", turns: [turn("third question")], updated: "1" }
  ]);
  const named = renameChat(list, "b", "  Defense   watch ");
  assert.equal(named[1].title, "Defense watch");
  assert.equal(named[1].named, true);
  const reverted = renameChat(named, "b", " ");
  assert.equal(reverted[1].title, "Second question");
  assert.equal(reverted[1].named, undefined);

  const pinned = pinChat(list, "c", true);
  assert.deepEqual(orderChats(pinned).map((c) => c.id), ["c", "a", "b"]);
  assert.equal(pinChat(pinned, "c", false)[2].pinned, undefined);

  const gone = removeChat(list, "b");
  assert.deepEqual(restoreChat(gone, list[1], 1).map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(filterChats(list, "THIRD").map((c) => c.id), ["c"]);
  assert.equal(filterChats(list, " ").length, 3);
});

test("saving a turn keeps the user's name and pin; the cap drops the oldest unpinned chat", () => {
  const list = pinChat(renameChat(normalizeChats([{ id: "a", turns: [turn("q")], updated: "1" }]), "a", "Mine"), "a", true);
  const next = upsertChat(list, { id: "a", title: "Q", turns: [turn("q"), turn("follow up")], updated: "2" });
  assert.equal(next[0].title, "Mine");
  assert.equal(next[0].pinned, true);
  assert.equal(next[0].turns.length, 2);

  const many = Array.from({ length: 31 }, (_, i) => ({ id: `c${i}`, title: "t", turns: [turn("q")], updated: "", ...(i === 30 ? { pinned: true } : {}) }));
  const capped = capChats(many);
  assert.equal(capped.length, 30);
  assert.ok(capped.some((c) => c.id === "c30"), "the pinned oldest chat stays");
  assert.ok(!capped.some((c) => c.id === "c29"), "the oldest unpinned chat goes");
});
