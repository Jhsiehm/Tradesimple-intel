/**
 * Answer reuse, pure. The same question (normalized), with the same chat, attachments, preferences and model choice,
 * may reuse an answer from the last few minutes when every tool it called returns the same data again. This module
 * builds the identity and the data fingerprint text; the server hashes them and keeps the store.
 */
import { etParts } from "./taskSchedule.mjs";

export const ANSWER_CACHE_DEFAULT_MIN = 15;
/** Tools whose output is the open web or changes by the second; an answer that used them is never reused. */
export const NO_REUSE_TOOLS = new Set(["web_search", "web_fetch", "web_result", "propose_theory"]);
/** Fields that change on every call without the data changing: timings, request traces, cache flags. */
const VOLATILE = /^(ms|latency|elapsed|took|tookMs|durationMs|fetchedAt|generatedAt|servedAt|now|requestId|requests|cached|cacheHit|stale|age|ageMs)$/i;

/** "  What   did NVDA do?? " → "what did nvda do". */
export function normalizeQuestion(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s?.!]+$/, "");
}

/** JSON with object keys sorted, `drop` keys left out at every depth. */
export function stableJson(value, drop = null) {
  const walk = (v) => {
    if (v == null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) if (!(drop && drop.test(k)) && v[k] !== undefined) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value)) ?? "null";
}

/** The data a tool returned, minus timings and request traces: equal text means the data did not change. */
export const dataText = (raw) => stableJson(raw, VOLATILE);

/**
 * What must match for reuse. Under Auto the model is "auto"; a pinned model is part of the identity, so an answer
 * from one pinned model is never reused for another.
 */
export function answerIdentity(asked, { model = "", pinned = false } = {}) {
  const a = asked || {};
  return stableJson({
    v: 1,
    q: normalizeQuestion(a.question),
    history: (a.history || []).map((t) => [t.role, String(t.content || "").replace(/\s+/g, " ").trim()]),
    context: a.context || null,
    attached: a.attached || null,
    prefs: a.prefs || null,
    prior: a.prior || null,
    priors: a.priors || [],
    answers: a.answers || {},
    acceptDefaults: Boolean(a.acceptDefaults),
    model: pinned ? String(model) : "auto"
  });
}

/**
 * Why a finished turn may not be stored, or "". `events` are everything the turn emitted; `calls` the tool calls
 * it ran ({ tool }).
 */
export function noReuseReason(events, calls) {
  const done = events.find((e) => e.type === "done");
  if (!done) return "not finished";
  if (events.some((e) => e.type === "error")) return "error";
  if (done.clarify || done.greeting || done.prefs || done.task) return "not a model answer";
  if (!done.usage?.tokens) return "no model call";
  if (done.stopped) return "stopped early";
  if (!calls.length) return "no tool data";
  if (calls.some((c) => NO_REUSE_TOOLS.has(c.tool))) return "web or theory tools";
  return "";
}

/**
 * The events to send again for a reused answer: steps, notes and citations as they were, the answer text in one
 * token, and `done.reused`. Heartbeats and the original revision progress are dropped.
 */
export function replayEvents(events, reused) {
  const out = [];
  let text = "";
  for (const e of events) {
    if (e.type === "step_progress" || e.type === "revise" || e.type === "budget" || e.type === "spend") continue;
    if (e.type === "token") { text += String(e.delta || ""); continue; }
    if (e.type === "done") {
      if (text) out.push({ type: "token", delta: e.answer || text });
      out.push({ ...e, reused });
      continue;
    }
    out.push(e);
  }
  return out;
}

/** "Reused answer from 10:31 ET — data unchanged". */
export function reusedLabel(at) {
  const p = etParts(Number(at) || 0);
  return `Reused answer from ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")} ET — data unchanged`;
}
