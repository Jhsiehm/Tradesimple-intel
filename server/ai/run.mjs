import { ASK_LIMITS, caveatsFor, citationRefs, evidenceOf, groundingCheck, systemPrompt, toolMessage, trimForModel } from "../../shared/ask.mjs";
import { attachedNote, contextNote, fallbackTable, figureCount, greetingText, isGreeting, retryReason } from "../../shared/agent.mjs";
import { buildSpec, clarifyQuestions, describeValue, followUpsNote, isFollowUp, isPrefClear, isPrefStatement, mergeModelSpec, parsePrefs, planFollowUps, planNote, provenanceLine, specDiff, wantsBacktest } from "../../shared/backtestAsk.mjs";
import { describeSpec } from "../../shared/backtestSpec.mjs";
import { mislabelNote } from "../../shared/countLabels.mjs";
import { citationCheck, stripRefs } from "../../shared/citations.mjs";
import { scopeCheck } from "../../shared/claimScope.mjs";
import { MARKET_NOTE, marketTail, wantsMarkets } from "../../shared/marketAsk.mjs";
import { WORLD_NOTE, worldRegions, worldTail } from "../../shared/worldMarkets.mjs";
import { COVERAGE_NOTE, WEB_CAPS, WEB_CAVEAT, WEB_NOTE, splitWebResults, wantsWeb, webCallLabel, webQuery, webTail } from "../../shared/webAsk.mjs";
import { followUpOutcome, handOffNote } from "../../shared/followUpReply.mjs";
import { heavyReason } from "../../shared/modelRoute.mjs";
import { SLOT_NOTE, renderSlots, slotEvidence, slotStream } from "../../shared/slots.mjs";
import { revisePass } from "./revise.mjs";

const estimate = (messages) => Math.ceil(messages.reduce((n, m) => n + String(m.content || "").length + JSON.stringify(m.toolCalls || "").length, 0) / 4);
const COMPUTE = new Set(["run_backtest"]);
const WEB = new Set(["web_search", "web_fetch"]);
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
 *                   backtests, clarify, prefs }
 *   error         { code, error }
 * Limits (tool calls, rounds, wall clock, tokens) end the loop with a last answer-only round, never a silent cut.
 * A finished answer with no figures after a data tool returned rows (or a backtest question with no backtest) is
 * rewritten once; if it still has no figures, `done.table` carries the tool's own rows.
 * Backtest questions are planned first (shared/backtestAsk.mjs): preferences, the previous run (`prior`; `priors` when the
 * previous turn ran several sources, which a follow-up re-runs before the model writes), chip
 * `answers`; ambiguous result-changing fields end the turn with `clarify`, and every run_backtest call runs the plan.
 * Under Auto (`auto`, the user pinned no model) a heavy turn and the revision pass use `strong` ({ model, provider });
 * `model { model, auto, reason }` says which model answers. A flagged answer gets one revision pass (server/ai/revise.mjs):
 *   revise        { state: "start", note } / { state: "end" }    the answer is being checked; done.answer replaces it
 *   done.revision { status, reason, fixed, changes, removed, added, model } or null
 * The model may write figures as slots (`{{t1.stats.excess|spct}}`, `{{table t1.rows cols=…}}`, shared/slots.mjs): tokens
 * stream with slots filled from the tool results, `done.answer` is filled, and `done.slots { count, missing }` lists the
 * ones that did not resolve (shown as "[missing]"). Filled values count as their ref's for the grounding checks.
 */
export async function runAsk({ question, history = [], context = null, attached = null, model = "", auto = false, strong = null, prefs = null, prior = null, priors = null, answers = {}, acceptDefaults = false, provider, tools, execute, labelOf = (n) => n, emit, limits = ASK_LIMITS, now = () => Date.now(), today = new Date(now()).toISOString().slice(0, 10), signal, log = () => {}, heartbeatMs = 1_500 }) {
  const t0 = now();
  const evidence = [];
  const bodies = new Map();
  const raws = new Map();
  const slotSrc = { evidence, bodies, raws };
  const fill = (t) => renderSlots(t, slotSrc);
  let filled = null;
  let theory = null;

  const quick = (answer, extra = {}) => {
    emit({ type: "step_progress", phase: "writing" });
    if (answer) emit({ type: "token", delta: answer });
    emit({ type: "done", answer, cited: [], unknown: [], grounding: { checked: 0, unmatched: [], mislabeled: [], miscited: [], uncitedRows: [], scope: [] }, uncited: false, noTools: false, greeting: false, caveats: [], usage: { tokens: 0, toolCalls: 0 }, ms: now() - t0, stopped: "", model, theory: null, table: null, retried: false, backtests: [], clarify: false, prefs: null, revision: null, ...extra });
    return { modelCalled: false };
  };
  if (isGreeting(question) && !history.length && !attached) return quick(greetingText(), { greeting: true });
  if (isPrefClear(question)) return quick("Cleared your backtest preferences. New backtests use the app defaults until you set new ones.", { prefs: { clear: true } });
  if (isPrefStatement(question)) {
    const values = parsePrefs(question);
    const list = Object.entries(values).map(([p, v]) => `- ${describeValue(p, v)}`).join("\n");
    return quick(`Saved as your backtest defaults:\n${list}\n\nThey apply to new backtests unless a question says otherwise. Edit or clear them under Preferences in this panel.`, { prefs: { set: values } });
  }

  // A follow-up on a turn that ran several sources changes each of them (or only the ones it names), all re-run here.
  const priorList = priors?.length ? priors : prior ? [prior] : [];
  const lastPrior = priorList.at(-1) || null;
  const follow = isFollowUp(question, lastPrior);
  const planned = follow && priorList.length > 1 ? planFollowUps({ question, today, priors: priorList, answers }) : null;
  // A follow-up that sets no spec field ("why did contracts do better?") goes to the model; one that changes nothing says which value already matched.
  const outcome = planned ? followUpOutcome(planned) : null;
  const handOff = Boolean(outcome && !outcome.understood);
  const multi = handOff ? null : planned;
  // A hand-off re-runs the previous specs unchanged, so a "why did X do better" answer has the figures with refs.
  const reruns = multi ? multi.runs.filter((r) => !r.unchanged) : handOff ? planned.runs : [];
  if (multi && !reruns.length) return quick(outcome.text);
  for (const note of multi?.notes || []) emit({ type: "plan_note", note });
  const plan = handOff ? null : multi ? (reruns.length === 1 ? reruns[0] : null) : wantsBacktest(question) || follow ? buildSpec({ question, today, prefs, prior: lastPrior, answers }) : null;
  if (plan && !multi) {
    const questions = clarifyQuestions({ question, today, prefs, prior: lastPrior, answers, acceptDefaults });
    if (questions.length) {
      emit({ type: "clarify", questions, spec: plan.spec, from: plan.from, sentence: describeSpec(plan.spec), sources: plan.sources, note: provenanceLine(plan.from) });
      log({ event: "clarify", fields: questions.map((q) => q.path) });
      return quick("", { clarify: true });
    }
  }
  const backtests = [];

  const rerunNote = reruns.length > 1 && !handOff ? followUpsNote(reruns, reruns.map((_, i) => `t${i + 1}`), multi.notes) : "";
  // Market overviews fetch market_snapshot before the model writes, so a small model cannot answer without the data.
  const has = (name) => tools.some((t) => t.name === name);
  const free = !plan && !reruns.length && !handOff;
  // Non-US market questions fetch world_markets (and the web for context) first, so a small model answers from data.
  const regions = free && has("world_markets") ? worldRegions(question) : [];
  const webFirst = free && has("web_search") && wantsWeb(question);
  const market = free && !regions.length && wantsMarkets(question) && has("market_snapshot");
  const heavy = heavyReason({ question, backtest: Boolean(plan || reruns.length), web: Boolean(regions.length || webFirst) });
  const strongProvider = strong ? strong.provider || provider : null;
  if (auto && heavy && strong) { provider = strongProvider; model = strong.model; }
  const reviser = auto && strong ? { provider: strongProvider, model: strong.model } : { provider, model };
  if (auto) emit({ type: "model", model, auto, reason: strong ? heavy : "" });
  const system = [systemPrompt(today), SLOT_NOTE, COVERAGE_NOTE, contextNote(context), plan ? planNote(plan, plan.followUp ? plan.prior : null) : rerunNote, handOff ? handOffNote(priorList, reruns.map((_, i) => `t${i + 1}`)) : "", market ? MARKET_NOTE : "", regions.length ? WORLD_NOTE : "", webFirst ? WEB_NOTE : ""].filter(Boolean).join("\n");
  const messages = [{ role: "system", content: system }];
  const unref = (turns) => turns.map((t) => ({ ...t, content: stripRefs(t.content) }));
  if (attached) messages.push({ role: "user", content: attachedNote({ ...attached, turns: unref(attached.turns || []) }) }, { role: "assistant", content: "Noted. I will treat that chat as context, not as data." });
  messages.push(...unref(history), { role: "user", content: question });
  let calls = 0;
  let seq = 0;
  const webUsed = { web_search: 0, web_fetch: 0 };
  let spent = 0;
  let answer = "";
  let stopped = "";
  let retried = false;

  const timeLeft = () => limits.totalMs - (now() - t0);
  const abort = () => signal?.aborted;

  if (reruns.length > 1 || (handOff && reruns.length)) {
    emit({ type: "step_progress", phase: "computing" });
    const pending = reruns.map((r, i) => ({ id: `rerun_${i + 1}`, name: "run_backtest", args: { spec: r.spec } }));
    await runCalls("", pending, Object.fromEntries(pending.map((c, i) => [c.id, reruns[i]])));
    if (abort()) return;
  }
  if (market) {
    emit({ type: "step_progress", phase: "fetching" });
    await runCalls("", [{ id: "market_1", name: "market_snapshot", args: {} }]);
    if (abort()) return;
  }
  if (regions.length || webFirst) {
    emit({ type: "step_progress", phase: "fetching" });
    await runCalls("", [
      ...(regions.length ? [{ id: "world_1", name: "world_markets", args: { regions } }] : []),
      ...(webFirst ? [{ id: "web_1", name: "web_search", args: { query: webQuery(question, today) } }] : [])
    ]);
    if (abort()) return;
  }

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
    let shown = "";
    const live = slotStream((slot) => fill(slot).text);
    const pending = [];
    const citedNow = new Set();
    let usage = null;
    const show = (delta) => {
      if (!delta) return;
      shown += delta;
      emit({ type: "token", delta });
      for (const m of shown.matchAll(REF)) {
        for (const id of m[1].split(/\s*,\s*/)) {
          const e = evidence.find((x) => x.id === id);
          if (e && !citedNow.has(id)) { citedNow.add(id); emit({ type: "citation", id, tool: e.tool, label: e.label, source: e.source, asOf: e.asOf, ok: e.ok }); }
        }
      }
    };
    try {
      for await (const ev of provider.chat(messages, tools, { signal: ctl.signal, maxTokens: limits.maxOutputTokens, noTools: last && round > 0 })) {
        if (ev.type === "text") {
          if (!text) emit({ type: "step_progress", phase: "writing" });
          text += ev.delta;
          show(live.push(ev.delta));
        } else if (ev.type === "tool_call") pending.push(ev);
        else if (ev.type === "usage") usage = ev;
      }
      show(live.flush());
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
      const why = !retried && !last && round < limits.rounds ? retryReason(question, fill(text).text, evidence) : "";
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

    await runCalls(text, pending);
  }

  /**
   * One round of tool calls, run in parallel and added to the conversation. `presets` maps a call id to a follow-up
   * run planned in full (its spec and previous run), so the model's spec is not merged into it.
   */
  async function runCalls(text, pending, presets = {}) {
    messages.push({ role: "assistant", content: text, toolCalls: pending.map((c) => ({ id: c.id, name: c.name, args: c.args || {} })) });
    const jobs = pending.map((call) => {
      const known = tools.some((t) => t.name === call.name);
      const webCapped = WEB.has(call.name) && webUsed[call.name] >= WEB_CAPS[call.name];
      if (calls >= limits.toolCalls || !known || call.args == null || webCapped) {
        const refused = !known ? `No such tool ${call.name}.` : call.args == null ? "Arguments were not valid JSON." : webCapped ? `${call.name} limit reached (${WEB_CAPS[call.name]} per question); answer from the results you have.` : "Tool-call limit reached for this question.";
        return { call, refused };
      }
      calls += 1;
      if (WEB.has(call.name)) webUsed[call.name] += 1;
      return { call, id: `t${++seq}`, label: webCallLabel(call.name, call.args || {}) || labelOf(call.name, call.args || {}) };
    });
    const results = await Promise.all(jobs.map(async (job) => {
      if (job.refused) return { job, content: JSON.stringify({ ok: false, error: job.refused }) };
      const { call, id, label } = job;
      const phase = COMPUTE.has(call.name) ? "computing" : "fetching";
      const started = now();
      let bt = null;
      const preset = presets[call.id];
      if (call.name === "run_backtest" && (preset || plan)) {
        const p = preset || plan;
        const spec = preset ? preset.spec : mergeModelSpec(plan, call.args?.spec);
        call.args = { ...call.args, spec };
        const base = p.followUp ? p.prior : null;
        bt = { id, spec, from: p.from, diff: base ? specDiff(base, spec) : [], prior: base, using: describeSpec(spec), note: provenanceLine(p.from) };
      }
      emit({ type: "step_start", id, tool: call.name, label, args: call.args, phase, at: new Date(started).toISOString(), ...(bt ? { spec: bt.spec, from: bt.from, diff: bt.diff } : {}) });
      emit({ type: "step_progress", phase });
      if (bt) emit({ type: "step_progress", id, note: `Using: ${bt.using}${bt.note ? ` (${bt.note})` : ""}` });
      const beat = setInterval(() => emit({ type: "step_progress", id, ms: now() - started }), heartbeatMs);
      beat.unref?.();
      const requests = [];
      let raw;
      try {
        raw = await execute(call.name, call.args, { onRoute: (r) => { requests.push(r); emit({ type: "step_progress", id, request: r }); } });
      } finally {
        clearInterval(beat);
      }
      // A search becomes one cited step per result page; web text is already capped, so it is not cut to 320 characters.
      const split = call.name === "web_search" ? splitWebResults(raw, () => `t${++seq}`) : null;
      const body = WEB.has(call.name) ? (split ? split.parent : raw) : trimForModel(raw, limits);
      const ms = now() - started;
      const ev = evidenceOf(id, call.name, call.args, body, { ms, label, raw, requests });
      evidence.push(ev);
      bodies.set(id, body);
      if (!WEB.has(call.name)) raws.set(id, raw);
      if (call.name === "propose_theory" && ev.ok && raw?.theory) theory = raw.theory;
      if (call.name === "run_backtest") backtests.push({ ...(bt || { id, spec: raw?.spec || call.args?.spec, from: {}, diff: [], prior: null, using: raw?.description || "", note: "" }), ok: ev.ok, open: ev.open, stats: raw?.stats || null, counts: raw?.counts || null, description: raw?.description || "" });
      log({ event: "tool", id, tool: call.name, args: call.args, ok: ev.ok, ms, rows: ev.rows, source: ev.source });
      const { json, ...pub } = ev;
      emit({ type: "step_end", ...pub });
      for (const child of split?.children || []) {
        const cev = evidenceOf(child.id, "web_result", { url: child.body.url }, child.body, { ms: 0, label: child.step.label });
        evidence.push(cev);
        bodies.set(child.id, child.body);
        emit({ type: "step_start", id: child.id, tool: "web_result", label: child.step.label, args: { url: child.body.url }, phase: "fetching", at: child.step.asOf });
        const { json: _j, ...cpub } = cev;
        emit({ type: "step_end", ...cpub });
      }
      return { job, content: toolMessage(ev, body) };
    }));
    evidence.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    for (const { job, content } of results) messages.push({ role: "tool", toolCallId: job.call.id, name: job.call.name, content });
  }

  filled = fill(answer);
  answer = filled.text;
  if (!answer.trim()) {
    answer = "I ran out of room before I could write an answer. The tool results are listed in the steps above.";
    emit({ type: "token", delta: answer });
  }
  const checkAnswer = (a) => {
    const { cited, unknown } = citationRefs(a, evidence);
    const pool = slotEvidence(evidence, filled.used);
    const grounding = { ...groundingCheck(a, pool), ...citationCheck(a, pool), scope: scopeCheck(a, evidence) };
    return { cited, unknown, grounding, uncited: evidence.length > 0 && cited.length === 0 && a.length > 0 };
  };
  const revised = await revisePass({ question, answer, evidence, bodies, check: checkAnswer, provider: reviser.provider, model: reviser.model, limits, spent, msLeft: timeLeft, signal, emit, log });
  if (abort()) return;
  if (revised) {
    answer = revised.answer;
    spent += revised.spent;
    if (revised.answer.includes("{{")) {
      const again = fill(revised.answer);
      answer = again.text;
      filled = { ...again, count: filled.count + again.count, missing: [...filled.missing, ...again.missing], used: new Map([...filled.used, ...again.used]) };
    }
  }
  const snap = evidence.find((e) => e.tool === "market_snapshot");
  const world = evidence.find((e) => e.tool === "world_markets");
  const webbed = evidence.some((e) => e.ok && (e.tool === "web_result" || e.tool === "web_fetch"));
  const tail = snap ? marketTail(answer, bodies.get(snap.id)) : world ? worldTail(answer, bodies.get(world.id), { web: webbed }) : webbed ? webTail(answer) : "";
  if (tail) {
    answer += tail;
    emit({ type: "token", delta: tail });
  }
  const { cited, unknown, grounding, uncited } = checkAnswer(answer);
  let table = null;
  const data = evidence.filter((e) => e.ok && e.rows > 0 && e.tool !== "propose_theory");
  if (data.length && figureCount(answer) < 2) {
    const best = [...data].sort((a, b) => b.rows - a.rows)[0];
    const t = fallbackTable(bodies.get(best.id));
    if (t) table = { ...t, ref: best.id, label: best.label, source: best.source, asOf: best.asOf };
  }
  log({ event: "done", ms: now() - t0, toolCalls: calls, retried, table: Boolean(table) });
  emit({
    type: "done",
    answer,
    cited,
    unknown,
    grounding,
    uncited,
    noTools: evidence.length === 0,
    greeting: false,
    caveats: [...grounding.mislabeled.map(mislabelNote), ...grounding.scope.map((s) => s.note), ...caveatsFor(evidence), ...(webbed ? [WEB_CAVEAT] : [])],
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
    revision: revised?.revision || null,
    slots: { count: filled.count, missing: filled.missing }
  });
}
