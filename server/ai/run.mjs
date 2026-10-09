import { ASK_LIMITS, caveatsFor, citationRefs, evidenceOf, groundingCheck, systemPrompt, toolMessage, trimForModel } from "../../shared/ask.mjs";
import { attachedNote, contextNote, fallbackTable, figureCount, greetingText, isGreeting, retryReason } from "../../shared/agent.mjs";
import { buildSpec, clarifyQuestions, describeValue, isFollowUp, isPrefClear, isPrefStatement, mergeModelSpec, parsePrefs, planNote, provenanceLine, specDiff, wantsBacktest } from "../../shared/backtestAsk.mjs";
import { describeSpec } from "../../shared/backtestSpec.mjs";
import {
  SOURCING_LABEL, STYLE_LABEL, describeModes, isModeClear, isModeStatement, mergeSession, parseSourcing, parseStyle,
  resolveModes, sourcingClarify, toolsForSourcing
} from "../../shared/askModes.mjs";

const estimate = (messages) => Math.ceil(messages.reduce((n, m) => n + String(m.content || "").length + JSON.stringify(m.toolCalls || "").length, 0) / 4);
const COMPUTE = new Set(["run_backtest", "web_search", "web_fetch", "satellite", "news", "x_pulse"]);
const REF = /\[(t\d+(?:\s*,\s*t\d+)*)\]/g;

/**
 * One question, start to finish. `provider.chat` and `execute` are injected, so tests never touch the network.
 * Progress goes to `emit` as plain objects (the route sends each as one SSE event):
 *   step_progress { phase }                                  planning | fetching | computing | writing
 *   step_progress { id, ms } / { id, request }               a running tool's clock and the routes it called
 *   step_progress { phase: "writing", reset, note }          the answer is being rewritten; drop the streamed text
 *   step_start    { id, tool, label, args, phase, at }       a tool call, the moment the model asks for it
 *   step_end      { id, tool, label, args, ok, ms, rows, source, asOf, latency, note, open, requests, preview, caveats }
 *   token         { delta }                                  answer text
 *   citation      { id, tool, label, source, asOf, ok }     the first time the answer cites a ref
 *   clarify       { questions, spec, from, sentence, sources }  chips to settle before a backtest runs (no model call)
 *   done          { answer, cited, unknown, grounding, caveats, usage, ms, stopped, model, theory, table, retried, greeting,
 *                   backtests, clarify, prefs, session, modes }
 *   error         { code, error }
 * Limits (tool calls, rounds, wall clock, tokens) end the loop with a last answer-only round, never a silent cut.
 * A finished answer with no figures after a data tool returned rows (or a backtest question with no backtest) is
 * rewritten once; if it still has no figures, `done.table` carries the tool's own rows.
 * Backtest questions are planned first (shared/backtestAsk.mjs): preferences, the previous run (`prior`), chip
 * `answers`; ambiguous result-changing fields end the turn with `clarify`, and every run_backtest call runs the plan.
 * Sourcing (platform / both / web) and style (terminal / professional / simplified) come from answers, the
 * question text, or the session prefs; tools are filtered to match.
 */
export async function runAsk({ question, history = [], context = null, attached = null, model = "", prefs = null, session = null, prior = null, answers = {}, acceptDefaults = false, provider, tools, execute, labelOf = (n) => n, emit, limits = ASK_LIMITS, now = () => Date.now(), today = new Date(now()).toISOString().slice(0, 10), signal, log = () => {}, heartbeatMs = 1_500 }) {
  const t0 = now();
  const evidence = [];
  const bodies = new Map();
  let theory = null;
  const modes = resolveModes({ question, session, answers, acceptDefaults });
  const allow = toolsForSourcing(modes.sourcing);
  const activeTools = (tools || []).filter((t) => allow.has(t.name));

  const quick = (answer, extra = {}) => {
    emit({ type: "step_progress", phase: "writing" });
    if (answer) emit({ type: "token", delta: answer });
    emit({ type: "done", answer, cited: [], unknown: [], grounding: { checked: 0, unmatched: [] }, uncited: false, noTools: false, greeting: false, caveats: [], usage: { tokens: 0, toolCalls: 0 }, ms: now() - t0, stopped: "", model, theory: null, table: null, retried: false, backtests: [], clarify: false, prefs: null, session: null, modes: { sourcing: modes.sourcing, style: modes.style, label: describeModes(modes) }, ...extra });
    return { modelCalled: false };
  };
  if (isGreeting(question) && !history.length && !attached) return quick(greetingText(), { greeting: true });
  if (isModeClear(question)) {
    return quick("Cleared Ask sourcing and style. New answers default to TradeSimple only · terminal style until you change them.", { session: { clear: true } });
  }
  if (isModeStatement(question)) {
    const patch = { sourcing: parseSourcing(question) || undefined, style: parseStyle(question) || undefined };
    const next = mergeSession(session, patch, new Date(now()).toISOString());
    const bits = [];
    if (patch.sourcing) bits.push(`sourcing → ${SOURCING_LABEL[patch.sourcing]}`);
    if (patch.style) bits.push(`style → ${STYLE_LABEL[patch.style]}`);
    return quick(`Saved for this browser: ${bits.join("; ") || describeModes({ sourcing: next.sourcing || "platform", style: next.style || "terminal" })}.\n\nSay “TradeSimple only”, “use TradeSimple and the web”, or “simplified” any time — including as a follow-up.`, { session: { set: next } });
  }
  if (isPrefClear(question)) return quick("Cleared your backtest preferences. New backtests use the app defaults until you set new ones.", { prefs: { clear: true } });
  if (isPrefStatement(question)) {
    const values = parsePrefs(question);
    const list = Object.entries(values).map(([p, v]) => `- ${describeValue(p, v)}`).join("\n");
    return quick(`Saved as your backtest defaults:\n${list}\n\nThey apply to new backtests unless a question says otherwise. Edit or clear them under Preferences in this panel.`, { prefs: { set: values } });
  }

  const sourceQs = sourcingClarify({ question, session, answers, acceptDefaults });
  if (sourceQs.length) {
    emit({ type: "clarify", questions: sourceQs, spec: null, from: modes.from, sentence: "Pick where Ask may look for this answer.", sources: [], note: "Default is TradeSimple only." });
    log({ event: "clarify", fields: sourceQs.map((q) => q.path) });
    return quick("", { clarify: true, modes: { sourcing: modes.sourcing, style: modes.style, label: describeModes(modes) } });
  }

  const plan = wantsBacktest(question) || isFollowUp(question, prior) ? buildSpec({ question, today, prefs, prior, answers }) : null;
  if (plan) {
    const questions = clarifyQuestions({ question, today, prefs, prior, answers, acceptDefaults });
    if (questions.length) {
      emit({ type: "clarify", questions, spec: plan.spec, from: plan.from, sentence: describeSpec(plan.spec), sources: plan.sources, note: provenanceLine(plan.from) });
      log({ event: "clarify", fields: questions.map((q) => q.path) });
      return quick("", { clarify: true });
    }
  }
  const backtests = [];

  const system = [systemPrompt(today, modes), contextNote(context), plan ? planNote(plan, plan.followUp ? prior : null) : ""].filter(Boolean).join("\n");
  const messages = [{ role: "system", content: system }];
  if (attached) messages.push({ role: "user", content: attachedNote(attached) }, { role: "assistant", content: "Noted. I will treat that chat as context, not as data." });
  messages.push(...history, { role: "user", content: question });
  let calls = 0;
  let spent = 0;
  let answer = "";
  let stopped = "";
  let retried = false;
  tools = activeTools;

  const timeLeft = () => limits.totalMs - (now() - t0);
  const abort = () => signal?.aborted;

  for (let round = 0; round < limits.rounds + 1; round++) {
    if (abort()) return;
    const last = round === limits.rounds || calls >= limits.toolCalls || spent >= limits.tokenBudget || timeLeft() < 8_000;
    if (last && !stopped && round > 0) {
      stopped = calls >= limits.toolCalls ? "tool-call limit" : spent >= limits.tokenBudget ? "token budget" : timeLeft() < 8_000 ? "time limit" : "round limit";
    }
    if (last && round > 0) messages.push({ role: "user", content: `Limit reached (${stopped}). Answer now from the tool results above only, with their figures. If they do not cover the question, say what is missing. No more tool calls.` });
    emit({ type: "step_progress", phase: "planning" });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(1_000, Math.min(limits.roundMs, timeLeft())));
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    let text = "";
    const pending = [];
    const citedNow = new Set();
    let usage = null;
    try {
      for await (const ev of provider.chat(messages, tools, { signal: ctl.signal, maxTokens: limits.maxOutputTokens, noTools: last && round > 0 })) {
        if (ev.type === "text") {
          if (!text) emit({ type: "step_progress", phase: "writing" });
          text += ev.delta;
          emit({ type: "token", delta: ev.delta });
          for (const m of text.matchAll(REF)) {
            for (const id of m[1].split(/\s*,\s*/)) {
              const e = evidence.find((x) => x.id === id);
              if (e && !citedNow.has(id)) { citedNow.add(id); emit({ type: "citation", id, tool: e.tool, label: e.label, source: e.source, asOf: e.asOf, ok: e.ok }); }
            }
          }
        } else if (ev.type === "tool_call") pending.push(ev);
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

    if (!pending.length || (last && round > 0)) {
      const why = !retried && !last && round < limits.rounds ? retryReason(question, text, evidence) : "";
      if (why) {
        retried = true;
        messages.push({ role: "assistant", content: text || "(no answer)" }, { role: "user", content: why });
        emit({ type: "step_progress", phase: "writing", reset: true, note: /run_backtest/.test(why) ? "No backtest was run; asking the model to run one." : "The answer had no figures; asking for the numbers." });
        log({ event: "retry", reason: why.slice(0, 80) });
        continue;
      }
      answer = text;
      break;
    }

    messages.push({ role: "assistant", content: text, toolCalls: pending.map((c) => ({ id: c.id, name: c.name, args: c.args || {} })) });
    const jobs = pending.map((call) => {
      const known = tools.some((t) => t.name === call.name);
      if (calls >= limits.toolCalls || !known || call.args == null) {
        const refused = !known ? `No such tool ${call.name}.` : call.args == null ? "Arguments were not valid JSON." : "Tool-call limit reached for this question.";
        return { call, refused };
      }
      calls += 1;
      return { call, id: `t${calls}`, label: labelOf(call.name, call.args || {}) };
    });
    const results = await Promise.all(jobs.map(async (job) => {
      if (job.refused) return { job, content: JSON.stringify({ ok: false, error: job.refused }) };
      const { call, id, label } = job;
      const phase = COMPUTE.has(call.name) ? "computing" : "fetching";
      const started = now();
      let bt = null;
      if (call.name === "run_backtest" && plan) {
        const spec = mergeModelSpec(plan, call.args?.spec);
        call.args = { ...call.args, spec };
        const base = plan.followUp ? prior : null;
        bt = { id, spec, from: plan.from, diff: base ? specDiff(base, spec) : [], prior: base, using: describeSpec(spec), note: provenanceLine(plan.from) };
      }
      emit({ type: "step_start", id, tool: call.name, label, args: call.args, phase, at: new Date(started).toISOString(), ...(bt ? { spec: bt.spec, from: bt.from, diff: bt.diff } : {}) });
      emit({ type: "step_progress", phase });
      if (bt) emit({ type: "step_progress", id, note: `Using: ${bt.using}${bt.note ? ` (${bt.note})` : ""}` });
      const beat = setInterval(() => emit({ type: "step_progress", id, ms: now() - started }), heartbeatMs);
      beat.unref?.();
      const requests = [];
      let raw;
      try {
        raw = await execute(call.name, call.args, { onRoute: (r) => { requests.push(r); emit({ type: "step_progress", id, request: r }); }, sourcing: modes.sourcing });
      } finally {
        clearInterval(beat);
      }
      const body = trimForModel(raw, limits);
      const ms = now() - started;
      const ev = evidenceOf(id, call.name, call.args, body, { ms, label, raw, requests });
      evidence.push(ev);
      bodies.set(id, body);
      if (call.name === "propose_theory" && ev.ok && raw?.theory) theory = raw.theory;
      if (call.name === "run_backtest") backtests.push({ ...(bt || { id, spec: raw?.spec || call.args?.spec, from: {}, diff: [], prior: null, using: raw?.description || "", note: "" }), ok: ev.ok, open: ev.open, stats: raw?.stats || null, description: raw?.description || "" });
      log({ event: "tool", id, tool: call.name, args: call.args, ok: ev.ok, ms, rows: ev.rows, source: ev.source });
      const { json, ...pub } = ev;
      emit({ type: "step_end", ...pub });
      return { job, content: toolMessage(ev, body) };
    }));
    evidence.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    for (const { job, content } of results) messages.push({ role: "tool", toolCallId: job.call.id, name: job.call.name, content });
  }

  if (!answer.trim()) {
    answer = "I ran out of room before I could write an answer. The tool results are listed in the steps above.";
    emit({ type: "token", delta: answer });
  }
  const { cited, unknown } = citationRefs(answer, evidence);
  const grounding = groundingCheck(answer, evidence);
  let table = null;
  const data = evidence.filter((e) => e.ok && e.rows > 0 && e.tool !== "propose_theory");
  if (data.length && figureCount(answer) < 2) {
    const best = [...data].sort((a, b) => b.rows - a.rows)[0];
    const t = fallbackTable(bodies.get(best.id));
    if (t) table = { ...t, ref: best.id, label: best.label, source: best.source, asOf: best.asOf };
  }
  const sessionPatch = (parseSourcing(question) || parseStyle(question))
    ? { set: mergeSession(session, { sourcing: parseSourcing(question) || undefined, style: parseStyle(question) || undefined }, new Date(now()).toISOString()) }
    : null;
  log({ event: "done", ms: now() - t0, toolCalls: calls, retried, table: Boolean(table), sourcing: modes.sourcing, style: modes.style });
  emit({
    type: "done",
    answer,
    cited,
    unknown,
    grounding,
    uncited: evidence.length > 0 && cited.length === 0 && answer.length > 0,
    noTools: evidence.length === 0,
    greeting: false,
    caveats: caveatsFor(evidence),
    usage: { tokens: spent, toolCalls: calls },
    ms: now() - t0,
    stopped,
    model,
    theory,
    table,
    retried,
    backtests: backtests.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
    clarify: false,
    prefs: null,
    session: sessionPatch,
    modes: { sourcing: modes.sourcing, style: modes.style, label: describeModes(modes) }
  });
}
