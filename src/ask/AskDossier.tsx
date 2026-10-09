import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, IconLabel } from "../ui/icons/Icon";
import type { AskApi } from "./useAsk";
import type { Evidence, Turn } from "./types";
import "./qa.css";

const EXAMPLES = [
  "Armed Services members' buys, hold 90 days vs ^GSPC, filing-date entry",
  "What did Nancy Pelosi file most recently?",
  "Largest federal contract actions for LMT in the last 90 days",
  "Which tickers do the most Congress members trade this week?"
];

const REF = /\[(t\d+(?:\s*,\s*t\d+)*)\]/g;

function plain(turn: Turn) {
  const lines = [`Q: ${turn.question}`, "", turn.text.replace(REF, (_, r) => `[${r}]`), "", "Sources:"];
  for (const e of turn.evidence) lines.push(`[${e.id}] ${e.label} — ${e.source || "no source"}${e.asOf ? ` · as of ${e.asOf}` : ""}`);
  lines.push("", "Research only. Not investment advice.");
  return lines.join("\n");
}

/** One paragraph with its [t3] refs turned into chips. A ref with no tool result behind it is shown as unverified. */
function Prose({ text, byId, onChip }: { text: string; byId: Map<string, Evidence>; onChip: (e: Evidence) => void }) {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(REF)) {
    out.push(text.slice(last, m.index));
    for (const id of m[1].split(/\s*,\s*/)) {
      const ev = byId.get(id);
      out.push(ev ? (
        <button key={k++} className={ev.ok ? "qa-chip" : "qa-chip fail"} title={`${ev.label} · ${ev.source || "no source"}${ev.asOf ? ` · as of ${ev.asOf}` : ""}${ev.open ? " · opens the board" : " · shows how"}`} onClick={() => onChip(ev)}>{id.slice(1)}</button>
      ) : (
        <span key={k++} className="qa-chip bad" title="No tool result has this ref, so it is not a source">{id.slice(1)}?</span>
      ));
    }
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

function Trace({ evidence, running, open, onOpen, onFollow }: { evidence: Evidence[]; running: Turn["running"]; open: boolean; onOpen: (v: boolean) => void; onFollow: (e: Evidence) => void }) {
  if (!evidence.length && !running.length) return null;
  return (
    <details className="qa-trace" open={open} onToggle={(e) => onOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>How I got this <small>{evidence.length} tool call{evidence.length === 1 ? "" : "s"}</small></summary>
      <ol>
        {evidence.map((e) => (
          <li key={e.id} id={`qa-${e.id}`} className={e.ok ? undefined : "fail"}>
            <span className="qa-ref">{e.id.slice(1)}</span>
            <div>
              <b>{e.label}</b>{" "}
              {e.ok ? null : <em>failed: {e.note}</em>}
              <small>{e.source || "no source reported"}{e.asOf ? ` · as of ${e.asOf}` : ""} · {e.ms} ms here</small>
              {e.latency ? <small>{e.latency}</small> : null}
              {e.open ? <button className="link" onClick={() => onFollow(e)}>Open on the board</button> : null}
            </div>
          </li>
        ))}
        {running.map((r) => <li key={r.id} className="run"><span className="qa-ref">{r.id.slice(1)}</span><div><b>{r.label}</b><small>running…</small></div></li>)}
      </ol>
    </details>
  );
}

export function AskDossier({ ask, onFollow }: { ask: AskApi; onFollow: (action: string) => void }) {
  const { turn, status, saved } = ask;
  const [draft, setDraft] = useState("");
  const [traceOpen, setTraceOpen] = useState(false);
  const [note, setNote] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const byId = new Map((turn?.evidence || []).map((e) => [e.id, e]));

  useEffect(() => { if (ask.full) input.current?.focus(); }, [ask.full]);
  useEffect(() => { setDraft(""); setTraceOpen(false); setNote(""); }, [turn?.question]);
  useEffect(() => { if (turn?.phase !== "done") body.current?.scrollTo({ top: body.current.scrollHeight }); }, [turn?.text, turn?.evidence.length, turn?.phase]);

  if (!ask.open) return null;
  if (ask.collapsed) {
    return <button className="qa-return" onClick={() => ask.setCollapsed(false)} title="Back to the answer"><Icon name="ask" size={13} /> <span>{turn?.question || "Ask"}</span> <b>back to answer</b></button>;
  }

  const follow = (action: string) => { ask.setCollapsed(true); onFollow(action); };
  const chip = (e: Evidence) => {
    if (e.open) follow(e.open);
    else { setTraceOpen(true); window.setTimeout(() => document.getElementById(`qa-${e.id}`)?.scrollIntoView({ block: "nearest" }), 30); }
  };
  const submit = (q: string) => { if (q.trim()) { ask.run(q); setDraft(""); } };
  const done = turn?.done || null;
  const running = turn && (turn.phase === "thinking" || turn.phase === "answering");
  const backtest = turn?.evidence.find((e) => e.open.startsWith("bt:"));
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setNote(`${what} copied`); } catch { setNote("Copy was blocked by the browser"); }
  };
  const link = turn ? `${location.origin}${location.pathname}#ask=${encodeURIComponent(turn.question)}` : "";
  const share = async () => {
    if (!turn) return;
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: "TradeSimple Intel", text: plain(turn), url: link }); return; } catch { /* cancelled: fall back to copy */ }
    }
    await copy(plain(turn), "Answer with sources");
  };

  return (
    <aside className="drawer qa" role="dialog" aria-label="Ask">
      <div className="drawer-bar">
        <span>ASK</span>
        <span className="drawer-actions">
          {turn ? <button className="ghost" onClick={ask.newChat} title="Start over; forget this chat's earlier turns"><IconLabel icon="reset" hide>New chat</IconLabel></button> : null}
          <button className="ghost" onClick={ask.close} title="Close (Esc)"><IconLabel icon="close" hide>Close</IconLabel></button>
        </span>
      </div>
      <div className="qa-body" ref={body}>
        <form className="qa-form" onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
          <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={turn && !turn.error ? "Ask a follow-up" : "Ask about members, tickers, contracts, or a backtest"} aria-label="Question" maxLength={800} onKeyDown={(e) => { if (e.key === "Escape") ask.close(); }} />
          <button type="submit" disabled={!draft.trim()}>Ask</button>
        </form>

        {status && !status.configured && !turn ? (
          <p className="qa-note off" role="status"><b>Ask is not configured — add a key to .env.local</b><span>Set <code>ASK_PROVIDER</code> and its key{status.missing.length ? ` (missing: ${status.missing.join(", ")})` : ""}. The Backtest board and every other board still work.</span><button className="link" onClick={() => follow("today:bt")}>Open Backtest</button></p>
        ) : null}

        {!turn ? (
          <>
            <p className="qa-hint">Answers use only this app's own feeds, with every claim tied to the tool result it came from. Research only.</p>
            <h3 className="qa-h">Try</h3>
            <ul className="qa-list">{EXAMPLES.map((x) => <li key={x}><button className="link" onClick={() => submit(x)}>{x}</button></li>)}</ul>
            {saved.length ? (
              <>
                <h3 className="qa-h">Recent <button className="link" onClick={ask.forget}>clear</button></h3>
                <ul className="qa-list">{saved.slice(0, 8).map((s) => <li key={s.at + s.question}><button className="link" onClick={() => ask.reopen(s)} title={`Saved ${s.at.slice(0, 16).replace("T", " ")} UTC · ${s.model}`}>{s.question}</button></li>)}</ul>
                <p className="qa-hint">Kept in this browser only. Last {saved.length} of 20.</p>
              </>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="qa-q">{turn.question}</h2>
            {turn.notConfigured ? (
              <p className="qa-note off" role="status"><b>Ask is not configured — add a key to .env.local</b><span>Set <code>ASK_PROVIDER</code> and its key{turn.missing ? ` (missing: ${turn.missing})` : ""}. The Backtest board still works.</span><button className="link" onClick={() => follow("today:bt")}>Open Backtest</button></p>
            ) : null}
            {turn.phase === "error" && !turn.notConfigured ? <p className="qa-note err" role="alert">{turn.error}</p> : null}
            {running ? (
              <p className="qa-status" role="status"><span className="qa-spin" aria-hidden />{turn.running.length ? `Calling ${turn.running.map((r) => r.label).join(", ")}` : turn.phase === "answering" ? "Writing the answer" : turn.evidence.length ? "Reading the results" : "Thinking"}…</p>
            ) : null}
            {turn.text ? (
              <div className="qa-answer" aria-live="polite">
                {turn.text.split(/\n+/).filter(Boolean).map((p, i) => <p key={i}><Prose text={p} byId={byId} onChip={chip} /></p>)}
              </div>
            ) : null}
            {done ? (
              <>
                {done.grounding.unmatched.length ? <p className="qa-note warn" role="alert"><b>Not found in any tool result:</b> {done.grounding.unmatched.join(", ")}. Treat {done.grounding.unmatched.length === 1 ? "it" : "them"} as unverified.</p> : null}
                {done.unknown.length ? <p className="qa-note warn" role="alert">Cites results that were never fetched: {done.unknown.join(", ")}.</p> : null}
                {done.noTools ? <p className="qa-note warn" role="alert">No tool was called, so nothing in this answer comes from the app's data.</p> : done.uncited ? <p className="qa-note warn">No claim cites a tool result.</p> : null}
                {done.stopped ? <p className="qa-note warn">Stopped at the {done.stopped}; the answer may be incomplete.</p> : null}
              </>
            ) : null}
            <Trace evidence={turn.evidence} running={turn.running} open={traceOpen} onOpen={setTraceOpen} onFollow={(e) => follow(e.open)} />
            {done?.caveats.length ? (
              <section className="qa-caveats" aria-label="Data caveats">
                <h3 className="qa-h">Data caveats</h3>
                <ul>{done.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
              </section>
            ) : null}
            {done ? (
              <div className="qa-actions">
                {backtest ? <button onClick={() => follow(backtest.open)}><IconLabel icon="backtest">Open backtest</IconLabel></button> : null}
                <button onClick={() => copy(link, "Link")}><IconLabel icon="link">Copy link</IconLabel></button>
                <button onClick={share}><IconLabel icon="share">Share</IconLabel></button>
                <span className="qa-note-inline" role="status">{note}</span>
              </div>
            ) : null}
            {done ? <p className="qa-hint">{status?.model ? `${status.model} · ` : ""}{done.usage.toolCalls} tool call{done.usage.toolCalls === 1 ? "" : "s"} · {(done.ms / 1000).toFixed(1)} s · {done.grounding.checked} number{done.grounding.checked === 1 ? "" : "s"} checked against the results</p> : null}
          </>
        )}
      </div>
    </aside>
  );
}

