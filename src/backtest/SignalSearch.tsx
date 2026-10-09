import { useCallback, useEffect, useRef, useState } from "react";
import type { BacktestSpec } from "../../shared/backtestSpec.mjs";
import { pTxt } from "../../shared/backtestStats.mjs";
import type { SearchFinding, SearchOutcome } from "../../shared/signalSearch.mjs";
import { api, post, when } from "../lib/api";
import type { BtFeed } from "./types";

type SearchBody = Omit<Partial<SearchOutcome>, "findings"> & {
  ok: boolean; id?: string; state: "idle" | "running" | "done" | "error"; error?: string; phase?: string;
  progress?: { done: number; total: number }; opts?: { holdDays: number; benchmark: string; minTrades: number };
  findings?: (SearchFinding & { open: string; description: string })[]; notes?: string[]; feeds?: BtFeed[];
  source?: string; asOf?: string; latency?: string; ranAt?: string; cache?: string;
};

const pts = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "up" : "down");
const POLL_MS = 2_000;
const SHOWN = 25;

/** "Search": many variants at once, ranked by excess with Benjamini–Hochberg q-values and the count tested up front. */
export function SignalSearch({ holdDays, benchmark, onOpen }: { holdDays: number; benchmark: string; onOpen: (spec: BacktestSpec) => void }) {
  const [body, setBody] = useState<SearchBody | null>(null);
  const [minTrades, setMinTrades] = useState(30);
  const [error, setError] = useState("");
  const timer = useRef(0);

  const poll = useCallback((id: string) => {
    window.clearTimeout(timer.current);
    api<SearchBody>(`/api/backtest/search?id=${encodeURIComponent(id)}`).then((b) => {
      setBody(b);
      if (b.state === "running") timer.current = window.setTimeout(() => poll(id), POLL_MS);
    }).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    api<SearchBody>("/api/backtest/search").then((b) => { setBody(b); if (b.state === "running" && b.id) poll(b.id); }).catch(() => null);
    return () => window.clearTimeout(timer.current);
  }, [poll]);

  const start = (fresh = false) => {
    setError("");
    post<SearchBody>("/api/backtest/search", { holdDays, benchmark, minTrades, fresh }).then((b) => {
      if (!b.ok) { setError(b.error || "Search failed."); return; }
      setBody(b);
      if (b.state === "running" && b.id) poll(b.id);
    }).catch((e: Error) => setError(e.message));
  };

  const running = body?.state === "running";
  const done = body?.state === "done" ? body : null;
  return (
    <section className="bt-search" aria-label="Signal search">
      <h3>Search <small>many variants at once, corrected for multiple testing</small></h3>
      <div className="bt-search-bar">
        <span>Hold {holdDays} d vs {benchmark} · buys only · at least</span>
        <select value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value))} aria-label="Minimum trades">{[20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <span>trades per variant</span>
        <button className="panels-btn" disabled={running} onClick={() => start(Boolean(done))}>{running ? "Searching…" : done ? "Run again" : "Run search"}</button>
      </div>
      {error ? <p className="bt-note warn" role="alert">{error}</p> : null}
      {running ? <p className="bt-note"><span className="st-spin" aria-hidden /> {body?.phase === "testing" ? `Testing variants: ${body.progress?.done ?? 0} of ${body.progress?.total ?? "?"}` : body?.phase === "prices" ? "Loading prices for every ticker…" : "Reading disclosures and Form 4 history…"} (worker thread, keeps running if you leave)</p> : null}
      {body?.state === "error" ? <p className="bt-note warn">{body.error}</p> : null}
      {done ? (
        <>
          <p className="bt-search-count"><strong>{done.tested}</strong> variants tested <small>of {done.built} built · {done.passing} pass FDR {Math.round((done.fdr ?? 0.1) * 100)}% · hold {done.opts?.holdDays} d vs {done.opts?.benchmark} · min {done.minTrades} trades</small></p>
          <p className="bt-note warn">{done.warning}</p>
          <div className="bt-scroll">
            <table className="bt-search-table">
              <thead><tr><th>Variant</th><th>Trades</th><th title="Mean excess return per trade vs the benchmark over the same days">Excess / trade</th><th title="Block bootstrap by entry week">95% CI</th><th title="One-sided, t-test clustered by member (by week when under 5 members)">p</th><th title="Benjamini–Hochberg across every tested variant">q</th><th title="Same tickers, random public dates (top rows only)">vs random</th><th /></tr></thead>
              <tbody>
                {(done.findings || []).slice(0, SHOWN).map((f) => (
                  <tr key={f.id} className={f.passes ? "pass" : ""} title={f.verdict?.text || f.description}>
                    <td className="board-name">{f.label}{f.passes ? <small className="tag">q ≤ {done.fdr}</small> : null}</td>
                    <td>{f.n}</td>
                    <td className={tone(f.stats?.avgExcess)}>{pts(f.stats?.avgExcess)}</td>
                    <td>{f.ci ? `${pts(f.ci.lo, 1)} to ${pts(f.ci.hi, 1)}` : "—"}</td>
                    <td>{pTxt(f.p).replace("p=", "").replace("p<", "<")}</td>
                    <td><b>{f.q == null ? "—" : f.q.toFixed(3)}</b></td>
                    <td>{f.placebo ? `${Math.floor((f.placebo.pct ?? 0) * 100)}% · ${pTxt(f.placebo.p)}` : "—"}</td>
                    <td><button className="link" onClick={() => onOpen(f.spec)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(done.findings?.length || 0) > SHOWN ? <p className="bt-basis">Top {SHOWN} of {done.findings?.length} tested, by excess per trade. q-values count all {done.tested}.</p> : null}
          {done.notes?.length ? <ul className="bt-basis">{done.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
          <p className="bt-basis">{done.source} · as of {done.asOf ? when(done.asOf) : "—"} · {done.latency}{done.cache === "hit" || done.cache === "snapshot" ? " Served from the search cache (same data snapshot)." : ""}</p>
        </>
      ) : null}
    </section>
  );
}
