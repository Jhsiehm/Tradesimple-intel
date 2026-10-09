import { useEffect, useRef, useState } from "react";
import { describeValue } from "../../shared/backtestAsk.mjs";
import { cleanTheory } from "../../shared/theories.mjs";
import { DEMO } from "../lib/api";
import { Icon } from "../ui/icons/Icon";
import { THEORY_LOOK } from "../relations/palette";
import { saveTheory } from "../relations/store";
import { miscitedNote } from "../../shared/citations.mjs";
import { Answer, Chip, ToolTable } from "../ask/Answer";
import { AnswerMeta } from "../ask/AnswerMeta";
import { ModelPick } from "../ask/ModelPick";
import { ReuseNote, SpendLine } from "../ask/Spend";
import { BacktestCard } from "../ask/BacktestCard";
import { Clarify } from "../ask/Clarify";
import { ScheduleControl } from "../tasks/ScheduleControl";
import { ScheduledTasks } from "../tasks/ScheduledTasks";
import { revealStep, Steps } from "../ask/Steps";
import { hasContext, type AskApi } from "../ask/useAsk";
import { SavedChats } from "../ask/SavedChats";
import type { Step, Turn } from "../ask/types";
import { contextLine, type AgentContext } from "./context";
import { starters } from "./starters";
import { EDGES, useAskSize } from "./useAskSize";
import "./ask.css";
import "../ask/chat.css";

/**
 * The one Ask. Screen context goes along only when something is selected (shown, and removable, in the header).
 * Each answer streams its steps; backtests render inline; Keep stores the chat with its trace in this browser.
 * Accept writes a proposed theory to your theory document. Dismiss writes nothing.
 */
export function AskSheet({ ask, context: ctx, region, onFollow }: { ask: AskApi; context: AgentContext; region?: string | null; onFollow: (action: string) => void }) {
  const { open, turns, busy, status } = ask;
  const [wrote, setWrote] = useState("");
  const [fault, setFault] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const { box, snap, applySnap, drag } = useAskSize();

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, ask.shown]);

  useEffect(() => {
    if (ask.shown && ask.snapTo) applySnap(ask.snapTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.shown]);

  useEffect(() => {
    if ((ask.shown || busy) && snap === "peek") applySnap("half");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.shown, busy]);

  useEffect(() => {
    if (open && (ask.snapTo || snap)) applySnap(ask.snapTo || snap!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const docked = open && snap === "peek";
  useEffect(() => {
    if (!docked) return;
    const root = document.documentElement;
    root.dataset.askDock = "peek";
    root.style.setProperty("--ask-dock", `${box.h}px`);
    return () => {
      delete root.dataset.askDock;
      root.style.removeProperty("--ask-dock");
    };
  }, [docked, box.h]);

  const last = turns.at(-1);
  useEffect(() => {
    if (open && last?.phase !== "done") log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [open, last?.text, last?.steps.length, last?.phase]);

  if (!open) return null;

  const attachedCtx = hasContext(ctx) && !ask.detached;
  const theory = [...turns].reverse().find((t) => t.done?.theory)?.done?.theory || null;
  const writable = theory ? cleanTheory(theory) : null;
  const others = ask.chats.filter((c) => c.id !== ask.chatId);
  const prefs = Object.entries(ask.prefs.values);
  const title = (ask.kept && ask.chats.find((c) => c.id === ask.chatId)?.title) || (turns.length ? turns[0].question.slice(0, 80) : "New chat");
  const prompts = starters({ ctx, attached: attachedCtx, today: ctx.section === "today", section: ctx.section, region });

  const follow = (action: string) => {
    if (!action) return;
    applySnap("peek");
    onFollow(action);
  };
  const submit = () => { if (ask.draft.trim() && !busy) void ask.run(ask.draft); };
  const accept = () => {
    if (!theory) return;
    const result = saveTheory(theory);
    setWrote(result === "saved" ? "Saved in this browser only. Never mixed into data counts or case files." : result === "refused" ? "This browser refused to save the theory." : "This proposal is not a theory this terminal can save.");
  };
  const keep = () => setFault(ask.keep() ? "" : "This browser refused to store the chat.");

  return (
    <div className="ask-scrim" data-snap={snap || undefined} onMouseDown={ask.close}>
      <div
        className="ask"
        role="dialog"
        aria-modal={!docked}
        data-snap={snap || undefined}
        aria-label="Ask"
        aria-busy={busy}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); ask.close(); } }}
      >
        <div className="ask-frame">
          <header className="ask-head">
            <b className="ask-mark">ASK</b>
            <div className="ask-context">
              {attachedCtx ? (
                <span className="ask-ctx-chip" title="Sent with the next question so it can say 'this one'">
                  <span className="ask-ctx-text">Attached · {contextLine(ctx).split(" · ").slice(1).join(" · ")}</span>
                  <button type="button" aria-label="Do not send what is on screen" onClick={() => ask.setDetached(true)}>×</button>
                </span>
              ) : (
                <strong>{hasContext(ctx) ? <>Screen not attached <button type="button" className="link" onClick={() => ask.setDetached(false)}>attach</button></> : "Nothing attached"}</strong>
              )}
              <small title={ask.model}>
                {DEMO ? "needs the local server" : ask.model === "auto" ? "Auto" : ask.model || status?.notice || "…"}
                {ask.small ? <span className="ask-small" title="A small model may skip tools or numbers. Pick a larger one, or set ASK_MODEL.">small model</span> : null}
                <SpendLine status={status} />
              </small>
            </div>
            <div className="ask-sizes" role="group" aria-label="Sheet size">
              <button type="button" className="panels-btn" aria-pressed={snap === "peek"} title="Short peek" onClick={() => applySnap("peek")}>Peek</button>
              <button type="button" className="panels-btn" aria-pressed={snap === "half"} title="About half the screen" onClick={() => applySnap("half")}>Half</button>
              <button type="button" className="panels-btn" aria-pressed={snap === "most"} title="Most of the screen" onClick={() => applySnap("most")}>Most</button>
            </div>
            <button className="ghost" onClick={ask.close} aria-label="Close"><Icon name="close" /></button>
            <kbd>esc</kbd>
          </header>
          <div className="ask-now">
            <button type="button" className="panels-btn" onClick={() => { ask.newChat(); setWrote(""); input.current?.focus(); }}>New</button>
            <p className="ask-title">
              <em className="ask-kicker">This chat</em>
              <strong>{title}</strong>
            </p>
            <ModelPick ask={ask} busy={busy} />
          </div>
          <section className="ask-saved" aria-label="Saved chats">
            <SavedChats ask={ask} />
            <ScheduledTasks openTurns={ask.openTurns} active={open} />
            <details className="ask-prefs" open>
              <summary>Sourcing &amp; style</summary>
              <div className="ask-modes" role="group" aria-label="Sourcing">
                {(status?.sourcing || [
                  { id: "platform", label: "In-app feeds" },
                  { id: "both", label: "In-app + web" },
                  { id: "web", label: "Web only" }
                ]).map((m) => (
                  <button key={m.id} type="button" className="chip" aria-pressed={(ask.session.sourcing || "platform") === m.id} disabled={busy} onClick={() => ask.setSourcing(m.id)}>{m.label}</button>
                ))}
              </div>
              <div className="ask-modes" role="group" aria-label="Style">
                {(status?.styles || [
                  { id: "terminal", label: "Terminal" },
                  { id: "professional", label: "Professional" },
                  { id: "simplified", label: "Simplified" }
                ]).map((m) => (
                  <button key={m.id} type="button" className="chip" aria-pressed={(ask.session.style || "terminal") === m.id} disabled={busy} onClick={() => ask.setStyle(m.id)}>{m.label}</button>
                ))}
              </div>
              <p className="ask-note">
                Default: in-app feeds only — Records (filings, contracts, prices) and Signals (wires, X, satellite status). Answers cite tool steps; unmatched numbers are unverified. Not advice. Say “use in-app and the web” or pick a chip to add open-web search.
                {status?.web ? (status.web.configured ? ` Web search via ${status.web.note}.` : ` ${status.web.note}`) : ""}
              </p>
              {(ask.session.sourcing || ask.session.style) ? <button type="button" className="link" onClick={ask.resetSession}>Reset to in-app · terminal</button> : null}
            </details>
            <details className="ask-prefs">
              <summary>Backtest preferences <small>{prefs.length ? `${prefs.length} saved` : "none"}</small></summary>
              {prefs.length ? (
                <ul>
                  {prefs.map(([p, v]) => <li key={p}>{describeValue(p, v)} <button type="button" className="link" aria-label={`Remove ${describeValue(p, v)}`} onClick={() => ask.removePref(p)}>×</button></li>)}
                </ul>
              ) : null}
              <p className="ask-note">Say “I usually want 90-day holds vs SPY” to save defaults for new backtests. A question that says otherwise wins.</p>
              {prefs.length ? <button type="button" className="link" onClick={ask.clearPrefs}>Clear all</button> : null}
            </details>
          </section>
          <label className="ask-q">
            <input
              ref={input}
              value={ask.draft}
              maxLength={800}
              placeholder={turns.length ? "Follow up: “use the web too”, “simplified”, “hold 30 days”" : "Ask about members, tickers, news, satellite, or a backtest"}
              spellCheck={false}
              aria-label="Question"
              disabled={DEMO}
              onChange={(e) => ask.setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            />
            {busy ? <button type="button" className="panels-btn" onClick={ask.stop}>Stop</button> : <button type="button" className="panels-btn" disabled={!ask.draft.trim() || DEMO} onClick={submit}>Ask</button>}
          </label>
          <div className="ask-log" ref={log}>
            {DEMO ? <p className="ask-note">Ask needs the local server.</p> : null}
            {fault ? <p className="ask-fault">{fault}</p> : null}
            {status && !status.configured && !DEMO ? <p className="ask-fault">{status.notice || "Ask is not configured — add a key to .env.local"}</p> : null}
            {!turns.length && !DEMO ? (
              <div className="ask-empty">
                <p className="ask-note">Default: TradeSimple-only feeds with citations. Flip sourcing to add the open web; pick a writing style for professional or simplified briefs.</p>
                <div className="ask-examples">{prompts.map((q) => <button key={q} type="button" className="chip" onClick={() => void ask.run(q)}>{q}</button>)}</div>
              </div>
            ) : null}
            {turns.map((t) => <TurnView key={t.id} turn={t} busy={busy} ask={ask} prompts={prompts} onFollow={follow} />)}
          </div>
          <footer className="ask-foot">
            <button type="button" className="panels-btn" disabled={!turns.length} onClick={keep}>{ask.kept ? "Kept" : "Keep"}</button>
            <label className="ask-pick">
              Attach
              <select value={ask.attachId} onChange={(e) => ask.setAttachId(e.target.value)} aria-label="Attach a saved chat">
                <option value="">None</option>
                {others.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <span className="ask-gap" />
            <button type="button" className="panels-btn" onClick={ask.close}>Dismiss</button>
            <button type="button" className="panels-btn ask-accept" disabled={!writable} onClick={accept} title={writable ? `${writable.a.label} ↔ ${writable.b.label}` : "No theory proposed in this chat"}>Accept</button>
            {wrote ? <p className="ask-wrote">{wrote}</p> : null}
          </footer>
        </div>
        {EDGES.map((edge) => (
          <span
            key={edge}
            className={edge === "se" ? "ask-edge se grip" : `ask-edge ${edge}`}
            title="Drag to resize"
            aria-hidden="true"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => drag(event, edge)}
          />
        ))}
      </div>
    </div>
  );
}

function TurnView({ turn, busy, ask, prompts, onFollow }: { turn: Turn; busy: boolean; ask: AskApi; prompts: string[]; onFollow: (action: string) => void }) {
  const done = turn.done;
  const chip = (s: Step) => {
    revealStep(turn.id, s.id);
    if (s.open) onFollow(s.open);
  };
  const byId = new Map(turn.steps.map((s) => [s.id, s]));
  const theory = done?.theory ? cleanTheory(done.theory) : null;
  return (
    <>
      <p className="ask-user"><em className="ask-kicker">You{turn.context ? ` · with ${turn.context}` : ""}</em>{turn.question}</p>
      <article className="ask-turn">
        <Steps turn={turn} />
        {turn.clarify ? <Clarify ask={turn.clarify} disabled={busy} onRun={(answers, acceptDefaults) => void ask.run(turn.question, { answers, acceptDefaults, turnId: turn.id })} /> : null}
        {turn.text ? <Answer text={done?.greeting ? turn.text.split("\n\n")[0] : turn.text} steps={turn.steps} onChip={chip} /> : null}
        {done?.greeting ? <div className="ask-examples">{prompts.map((q) => <button key={q} type="button" className="chip" onClick={() => void ask.run(q)}>{q}</button>)}</div> : null}
        <AnswerMeta turn={turn} />
        <ReuseNote turn={turn} busy={busy} onReask={() => void ask.run(turn.question, { turnId: turn.id, fresh: true })} />
        {done?.table ? <ToolTable table={done.table} steps={turn.steps} onChip={chip} /> : null}
        {done?.backtests?.filter((b) => b.ok).map((b) => <BacktestCard key={b.id} bt={b} onFollow={onFollow} cite={<Chip id={b.id} steps={byId} onChip={chip} />} />)}
        <ScheduleControl turn={turn} />
        {theory ? (
          <section className="ask-theory" style={{ ["--tint" as string]: THEORY_LOOK.color }}>
            <h3>Proposed theory</h3>
            <p>{theory.a.label} ↔ {theory.b.label}{theory.label ? ` · ${theory.label}` : ""}</p>
            {theory.note ? <p>{theory.note}</p> : null}
            <p className="ask-meta">{theory.confidence} confidence · yours, not a filing · Accept saves it in this browser</p>
          </section>
        ) : null}
        {done && !done.greeting && !done.clarify ? (
          <>
            {done.modes?.label ? <p className="ask-meta">Mode · {done.modes.label}</p> : null}
            {done.grounding.unmatched.length ? <p className="ask-warn">Not found in any tool result: {done.grounding.unmatched.join(", ")}. Treat as unverified.</p> : null}
            {done.grounding.mislabeled?.length ? <p className="ask-warn">Counted as something else in the tool results: {done.grounding.mislabeled.map((m) => `“${m.raw}” is ${m.foundAs[0]}`).join("; ")}. Treat as mislabeled.</p> : null}
            {done.grounding.scope?.length ? <p className="ask-warn">Not what the cited data covers: {done.grounding.scope.map((s) => `“${s.raw}”`).join(", ")}. See the caveats.</p> : null}
            {done.grounding.miscited?.length ? <p className="ask-warn">Cited to the wrong step: {done.grounding.miscited.map(miscitedNote).join(" ")}</p> : null}
            {done.grounding.uncitedRows?.length ? <p className="ask-warn">{done.grounding.uncitedRows.length} table row{done.grounding.uncitedRows.length === 1 ? " has" : "s have"} figures and no ref. Treat as unverified.</p> : null}
            {done.uncited ? <p className="ask-warn">Tools ran, but the answer cites none of them. Treat its figures as unverified.</p> : null}
            {done.unknown.length ? <p className="ask-warn">Cites results that were never fetched: {done.unknown.join(", ")}.</p> : null}
            {done.noTools && !done.prefs ? <p className="ask-warn">No tool was called, so nothing here comes from the app's data.</p> : null}
            {done.stopped ? <p className="ask-warn">Stopped at the {done.stopped}; the answer may be incomplete.</p> : null}
            {done.caveats.length ? (
              <details className="ask-cav"><summary>Data caveats ({done.caveats.length})</summary><ul>{done.caveats.map((c) => <li key={c}>{c}</li>)}</ul></details>
            ) : null}
          </>
        ) : null}
        {turn.phase === "error" ? <p className="ask-fault">{turn.error}</p> : null}
        {turn.phase === "error" && !busy ? <button type="button" className="panels-btn ask-retry" onClick={() => void ask.run(turn.question, { turnId: turn.id })}>Retry</button> : null}
      </article>
    </>
  );
}
