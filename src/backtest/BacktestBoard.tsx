import { useCallback, useEffect, useRef, useState } from "react";
import { describeSpec, type BacktestSpec } from "../../shared/backtestSpec.mjs";
import { when } from "../lib/api";
import type { StageList } from "../types";
import { Icon } from "../ui/icons/Icon";
import { BacktestForm } from "./BacktestForm";
import { BacktestResults } from "./BacktestResults";
import { btHash, recentSpecs, seedSpec } from "./seed";
import { useBacktest } from "./useBacktest";
import "./backtest.css";

const BLURB = "Replay public records as if you had acted the day after they became public.";

/** Center-stage backtest: settings, result, caveats, sources. The trade list goes to the list panel. */
export function BacktestBoard({ seed, onFollow, onClose, onList }: { seed: string; onFollow: (action: string) => void; onClose: () => void; onList: (list: StageList) => void }) {
  const [spec, setSpec] = useState<BacktestSpec>(() => seedSpec(seed));
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<BacktestSpec[]>(() => recentSpecs());
  const bt = useBacktest();
  const started = useRef(false);
  const run = bt.run;

  const go = useCallback((next: BacktestSpec) => {
    run(next);
    history.replaceState(null, "", btHash(next));
    setRecent(recentSpecs());
  }, [run]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (seed) go(spec);
  }, [seed, spec, go]);

  const done = bt.state.phase === "done" ? bt.state.run : null;
  useEffect(() => {
    const status = done
      ? { source: done.source, asOf: when(done.asOf), latency: done.latency }
      : { source: "House Clerk PTRs · Senate eFD · SEC Form 4 · USAspending · LDA.gov · Yahoo Finance", asOf: "", latency: "Entry is the first trading day after the public date. Prices are daily and delayed." };
    const trades = done?.trades || [];
    onList({
      title: "Backtest",
      blurb: done ? done.description : BLURB,
      empty: bt.state.phase === "running" ? "Running…" : bt.state.phase === "error" ? bt.state.error : "Run a backtest to list its trades here.",
      status,
      items: [...trades].reverse().slice(0, 400).map((t) => ({
        id: t.id,
        title: `${t.symbol}${t.side === "sell" ? " short" : ""} · ${t.ret == null ? "—" : `${t.ret >= 0 ? "+" : "−"}${Math.abs(t.ret * 100).toFixed(1)}%`}`,
        meta: `${t.actorLabel} · public ${t.signal} · in ${t.entry} · out ${t.exit}`,
        tone: t.ret == null ? "" : t.ret >= 0 ? "up" : "down",
        action: `ticker:${t.symbol}`
      }))
    });
  }, [done, bt.state, onList]);

  const copy = () => {
    const url = `${location.origin}${location.pathname}${location.search}${btHash(done?.spec || spec)}`;
    void navigator.clipboard?.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }).catch(() => null);
  };
  const running = bt.state.phase === "running";

  return (
    <div className="board bt">
      <header className="board-head">
        <div className="board-title">
          <strong>Backtest</strong>
          <span>{BLURB}</span>
          <button className="tl-close" onClick={onClose} aria-label="Close" title="Close (esc)"><Icon name="close" /></button>
        </div>
        <p className="bt-sentence" aria-live="polite">{describeSpec(spec)}</p>
      </header>
      <div className="board-scroll bt-body">
        <div className="bt-ask">
          <span>Backtests are asked in the chat; this board is the expanded view of a run.</span>
          <button className="panels-btn" onClick={() => onFollow("ask:draft:Backtest ")}>Ask the chat to backtest…</button>
        </div>
        <details className="bt-manual" open={!seed}>
          <summary>Edit the spec by hand</summary>
          <BacktestForm spec={spec} options={bt.options} onChange={setSpec} onRun={() => go(spec)} running={running} />
        </details>
        {recent.length > 1 ? (
          <div className="bt-recent"><em>Recent</em>{recent.slice(0, 5).map((r, i) => <button key={i} className="link" onClick={() => { setSpec(r); go(r); }} title={describeSpec(r)}>{describeSpec(r).split(" · enter")[0]}</button>)}</div>
        ) : null}
        {bt.state.phase === "running" ? <p className="bt-note">{bt.state.note}</p> : null}
        {bt.state.phase === "error" ? <p className="bt-note warn" role="alert">{bt.state.error}{bt.state.missing ? ` Set ${bt.state.missing} in .env.local.` : ""}</p> : null}
        {done ? <BacktestResults run={done} onFollow={(a) => { if (a) onFollow(a); }} onCopy={copy} copied={copied} /> : bt.state.phase === "idle" ? (
          <p className="bt-empty">Pick signals and rules, then run. Nothing here is an order, a recommendation, or a forecast.</p>
        ) : null}
      </div>
    </div>
  );
}
