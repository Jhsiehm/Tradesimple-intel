import { toolMessage } from "../../shared/ask.mjs";
import { REVISE, acceptRevision, cleanRevision, excerptRefs, flaggedItems, revisionBudget, revisionChanges, revisionMessages } from "../../shared/revise.mjs";

const estimate = (messages) => Math.ceil(messages.reduce((n, m) => n + String(m.content || "").length, 0) / 4);

/**
 * One revision call for an answer the grounding checks flagged. `check(answer)` → `{ grounding, cited, unknown, uncited }`.
 * Returns null when nothing was flagged (or no tool returned data), else `{ answer, revision, spent }`; `answer` is the
 * revised text only when the revision cleared at least one flag. Emits `revise {state:"start"|"end", note}`.
 * The call has no tools; when the turn's budget is nearly spent it is skipped and `revision.reason` says why.
 */
export async function revisePass({ question, answer, evidence, bodies, check, provider, model, limits, spent, msLeft, signal, emit, log = () => {} }) {
  if (!evidence.some((e) => e.ok)) return null;
  const before = check(answer);
  const items = flaggedItems(before);
  if (!items.length) return null;
  const excerpts = excerptRefs(items, before.cited, evidence).map((id) => {
    const e = evidence.find((x) => x.id === id);
    return { id, label: e.label, text: toolMessage(e, bodies.get(id)) };
  });
  const messages = revisionMessages({ question, answer, items, excerpts });
  const need = estimate(messages) + REVISE.outputTokens;
  const base = { items: items.length, model, fixed: 0, remaining: items.length, changes: [], removed: [], added: [] };
  const budget = revisionBudget({ spent, tokenBudget: limits.tokenBudget, msLeft: msLeft(), need });
  if (!budget.ok) {
    log({ event: "revise", status: "skipped", reason: budget.reason });
    return { answer, revision: { ...base, status: "skipped", reason: budget.reason }, spent: 0 };
  }

  emit({ type: "revise", state: "start", note: `Checking figures… ${items.length} flagged` });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(1_000, Math.min(limits.roundMs, msLeft() - 2_000)));
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  let text = "";
  let usage = null;
  try {
    for await (const ev of provider.chat(messages, [], { signal: ctl.signal, maxTokens: limits.maxOutputTokens, noTools: true })) {
      if (ev.type === "text") text += ev.delta;
      else if (ev.type === "usage") usage = ev;
    }
  } catch (err) {
    if (signal?.aborted) return null;
    const reason = ctl.signal.aborted ? "the model did not finish the revision in time." : `${err?.message || "the model request failed."}`;
    log({ event: "revise", status: "failed", reason: reason.slice(0, 120) });
    return { answer, revision: { ...base, status: "failed", reason }, spent: need };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    emit({ type: "revise", state: "end" });
  }
  const used = usage ? usage.input + usage.output : need - REVISE.outputTokens + Math.ceil(text.length / 4);
  const revised = cleanRevision(text);
  const afterItems = flaggedItems(check(revised));
  if (!acceptRevision(items, afterItems, revised, answer)) {
    log({ event: "revise", status: "kept", before: items.length, after: afterItems.length });
    return { answer, revision: { ...base, status: "kept", reason: "the revision cleared no flag" }, spent: used };
  }
  const changes = revisionChanges(answer, revised, items, afterItems);
  log({ event: "revise", status: "applied", before: items.length, after: afterItems.length, model });
  return { answer: revised, revision: { ...base, status: "applied", ...changes }, spent: used };
}
