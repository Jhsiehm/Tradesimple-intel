import { useEffect, useRef, useState } from "react";
import { EXAMPLES } from "../../shared/agent.mjs";
import { describeValue } from "../../shared/backtestAsk.mjs";
import { cleanTheory } from "../../shared/theories.mjs";
import { DEMO, when } from "../lib/api";
import { Icon } from "../ui/icons/Icon";
import { THEORY_LOOK } from "../relations/palette";
import { saveTheory } from "../relations/store";
import { Answer, ToolTable } from "../ask/Answer";
import { BacktestCard } from "../ask/BacktestCard";
import { Clarify } from "../ask/Clarify";
import { Steps } from "../ask/Steps";
import { hasContext, type AskApi } from "../ask/useAsk";
import type { Step, Turn } from "../ask/types";
import { contextLine, type AgentContext } from "./context";
import { EDGES, useAskSize } from "./useAskSize";
import "./ask.css";
import "../ask/chat.css";

/**
 * The one Ask. Screen context goes along only when something is selected (shown, and removable, in the header).
 * Each answer streams its steps; backtests render inline; Keep stores the chat with its trace in this browser.
 * Accept writes a proposed theory to your theory document. Dismiss writes nothing.
 */
export function AskSheet({ ask, context: ctx, onFollow }: { ask: AskApi; context: AgentContext; onFollow: (action: string) => void }) {
  const { open, turns, busy, status } = ask;
  const [wrote, setWrote] = useState("");
  const [fault, setFault] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const { box, snap, applySnap, drag } = useAskSize();

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => input.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if ((ask.shown || busy) && snap === "peek") applySnap("half");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.shown, busy]);

  useEffect(() => {
    if (open && snap) applySnap(snap);
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
  const title = turns.length ? turns[0].question.slice(0, 80) : "New chat";

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
                  Attached · {contextLine(ctx).split(" · ").slice(1).join(" · ")}
                  <button type="button" aria-label="Do not send what is on screen" onClick={() => ask.setDetached(true)}>×</button>
                </span>
              ) : (
                <strong>{hasContext(ctx) ? <>Screen not attached <button type="button" className="link" onClick={() => ask.setDetached(false)}>attach</button></> : "Nothing attached"}</strong>
              )}
              <small title={ask.model}>
                {DEMO ? "needs the local server" : ask.model || status?.notice || "…"}
                {ask.small ? <span className="ask-small" title="A small model may skip tools or numbers. Pick a larger one, or set ASK_MODEL.">small model</span> : null}
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
            {ask.models.length ? (
              <label className="ask-pick ask-model">
                Model
                <select aria-label="Model" value={ask.model} disabled={busy} onChange={(e) => ask.chooseModel(e.target.value)}>
                  {ask.models.map((m) => <option key={m.id} value={m.id}>{m.id}{m.id === status?.model ? " · default" : ""}{m.small ? " · small" : ""}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <section className="ask-saved" aria-label="Saved chats">
            <h2>Saved</h2>
            {ask.chats.length ? (
              <ul>
                {ask.chats.map((c) => (
                  <li key={c.id}>
                    <button type="button" aria-current={c.id === ask.chatId ? "true" : undefined} onClick={() => ask.openSaved(c.id)}>
                      <b>{c.title}</b>
                      <time dateTime={c.updated || undefined}>{when(c.updated)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="ask-note">None kept yet.</p>}
            <details className="ask-prefs">
              <summary>Preferences <small>{prefs.length ? `${prefs.length} saved` : "none"}</small></summary>
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
              placeholder={turns.length ? "Follow up: “hold 30 days instead”, “exclude Cisneros”" : "Ask about members, tickers, contracts, or a backtest"}
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
                <p className="ask-note">Answers come only from this terminal's feeds, each number tied to the step it came from. Research only.</p>
                <div className="ask-examples">{EXAMPLES.map((q) => <button key={q} type="button" className="chip" onClick={() => void ask.run(q)}>{q}</button>)}</div>
              </div>
            ) : null}
            {turns.map((t) => <TurnView key={t.id} turn={t} busy={busy} ask={ask} onFollow={follow} />)}
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

function TurnView({ turn, busy, ask, onFollow }: { turn: Turn; busy: boolean; ask: AskApi; onFollow: (action: string) => void }) {
  const done = turn.done;
  const chip = (s: Step) => {
    if (s.open) onFollow(s.open);
    else document.getElementById(`st-${turn.id}-${s.id}`)?.scrollIntoView({ block: "nearest" });
  };
  const theory = done?.theory ? cleanTheory(done.theory) : null;
  return (
    <>
      <p className="ask-user"><em className="ask-kicker">You{turn.context ? ` · with ${turn.context}` : ""}</em>{turn.question}</p>
      <article className="ask-turn">
        <Steps turn={turn} />
        {turn.clarify ? <Clarify ask={turn.clarify} disabled={busy} onRun={(answers, acceptDefaults) => void ask.run(turn.question, { answers, acceptDefaults, turnId: turn.id })} /> : null}
        {turn.text ? <Answer text={done?.greeting ? turn.text.split("\n\n")[0] : turn.text} steps={turn.steps} onChip={chip} /> : null}
        {done?.greeting ? <div className="ask-examples">{EXAMPLES.map((q) => <button key={q} type="button" className="chip" onClick={() => void ask.run(q)}>{q}</button>)}</div> : null}
        {done?.table ? <ToolTable table={done.table} /> : null}
        {done?.backtests?.filter((b) => b.ok).map((b) => <BacktestCard key={b.id} bt={b} onFollow={onFollow} />)}
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
            {done.grounding.unmatched.length ? <p className="ask-warn">Not found in any tool result: {done.grounding.unmatched.join(", ")}. Treat as unverified.</p> : null}
            {done.grounding.mislabeled?.length ? <p className="ask-warn">Counted as something else in the tool results: {done.grounding.mislabeled.map((m) => `“${m.raw}” is ${m.foundAs[0]}`).join("; ")}. Treat as mislabeled.</p> : null}
            {done.unknown.length ? <p className="ask-warn">Cites results that were never fetched: {done.unknown.join(", ")}.</p> : null}
            {done.noTools && !done.prefs ? <p className="ask-warn">No tool was called, so nothing here comes from the app's data.</p> : null}
            {done.stopped ? <p className="ask-warn">Stopped at the {done.stopped}; the answer may be incomplete.</p> : null}
            {done.caveats.length ? (
              <details className="ask-cav"><summary>Data caveats ({done.caveats.length})</summary><ul>{done.caveats.map((c) => <li key={c}>{c}</li>)}</ul></details>
            ) : null}
          </>
        ) : null}
        {turn.phase === "error" ? <p className="ask-fault">{turn.error}</p> : null}
      </article>
    </>
  );
}
