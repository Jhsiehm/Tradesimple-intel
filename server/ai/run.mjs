import { ASK_LIMITS, caveatsFor, citationRefs, evidenceOf, groundingCheck, systemPrompt, toolMessage, trimForModel } from "../../shared/ask.mjs";

const estimate = (messages) => Math.ceil(messages.reduce((n, m) => n + String(m.content || "").length + JSON.stringify(m.toolCalls || "").length, 0) / 4);

/**
 * One question, start to finish. `provider.chat` and `execute` are injected, so tests never touch the network.
 * Progress goes to `emit` as plain objects (the route sends each as one SSE event):
 *   status  { phase }                        text  { delta }
 *   tool    { id, tool, label, args }        evidence { id, tool, label, ok, source, asOf, latency, ms, note, open }
 *   done    { answer, cited, unknown, grounding, caveats, usage, ms, stopped }
 *   error   { code, error }
 * Limits (tool calls, rounds, wall clock, tokens) end the loop with a last answer-only round, never a silent cut.
 */
export async function runAsk({ question, history = [], provider, tools, execute, labelOf = (n) => n, emit, limits = ASK_LIMITS, now = () => Date.now(), today = new Date(now()).toISOString().slice(0, 10), signal, log = () => {} }) {
  const t0 = now();
  const evidence = [];
  const messages = [{ role: "system", content: systemPrompt(today) }, ...history, { role: "user", content: question }];
  let calls = 0;
  let spent = 0;
  let answer = "";
  let stopped = "";

  const timeLeft = () => limits.totalMs - (now() - t0);
  const abort = () => signal?.aborted;

  for (let round = 0; round < limits.rounds + 1; round++) {
    if (abort()) return;
    const last = round === limits.rounds || calls >= limits.toolCalls || spent >= limits.tokenBudget || timeLeft() < 8_000;
    if (last && !stopped && round > 0) {
      stopped = calls >= limits.toolCalls ? "tool-call limit" : spent >= limits.tokenBudget ? "token budget" : timeLeft() < 8_000 ? "time limit" : "round limit";
    }
    if (last && round > 0) messages.push({ role: "user", content: `Limit reached (${stopped}). Answer now from the tool results above only. If they do not cover the question, say what is missing. No more tool calls.` });
    emit({ type: "status", phase: round === 0 ? "thinking" : last ? "answering" : "thinking" });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(1_000, Math.min(limits.roundMs, timeLeft())));
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    let text = "";
    const pending = [];
    let usage = null;
    try {
      for await (const ev of provider.chat(messages, tools, { signal: ctl.signal, maxTokens: limits.maxOutputTokens, noTools: last && round > 0 })) {
        if (ev.type === "text") { text += ev.delta; emit({ type: "text", delta: ev.delta }); }
        else if (ev.type === "tool_call") pending.push(ev);
        else if (ev.type === "usage") usage = ev;
      }
    } catch (err) {
      if (abort()) return;
      const timedOut = ctl.signal.aborted;
      emit({ type: "error", code: timedOut ? "timeout" : "provider", error: timedOut ? "The model did not finish in time." : err?.message || "The model request failed." });
      log({ event: "error", round, error: err?.message || "failed" });
      return;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    spent += usage ? usage.input + usage.output : estimate(messages) + Math.ceil(text.length / 4);
    if (!pending.length || (last && round > 0)) { answer = text; break; }

    messages.push({ role: "assistant", content: text, toolCalls: pending.map((c) => ({ id: c.id, name: c.name, args: c.args || {} })) });
    for (const call of pending) {
      const known = tools.some((t) => t.name === call.name);
      const label = known ? labelOf(call.name, call.args || {}) : call.name;
      if (calls >= limits.toolCalls || !known || call.args == null) {
        const refused = !known ? `No such tool ${call.name}.` : call.args == null ? "Arguments were not valid JSON." : "Tool-call limit reached for this question.";
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: refused }) });
        continue;
      }
      calls += 1;
      const id = `t${calls}`;
      emit({ type: "tool", id, tool: call.name, label, args: call.args });
      const started = now();
      const raw = await execute(call.name, call.args);
      const body = trimForModel(raw, limits);
      const ms = now() - started;
      const ev = evidenceOf(id, call.name, call.args, body, { ms, label });
      evidence.push(ev);
      log({ event: "tool", id, tool: call.name, args: call.args, ok: ev.ok, ms, source: ev.source });
      const { json, ...pub } = ev;
      emit({ type: "evidence", ...pub });
      const content = toolMessage(ev, body);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    }
  }

  if (!answer.trim()) {
    answer = "I ran out of room before I could write an answer. The tool results are listed under How I got this.";
    emit({ type: "text", delta: answer });
  }
  const { cited, unknown } = citationRefs(answer, evidence);
  const grounding = groundingCheck(answer, evidence);
  emit({
    type: "done",
    answer,
    cited,
    unknown,
    grounding,
    uncited: evidence.length > 0 && cited.length === 0 && answer.length > 0,
    noTools: evidence.length === 0,
    caveats: caveatsFor(evidence),
    usage: { tokens: spent, toolCalls: calls },
    ms: now() - t0,
    stopped
  });
}
