import { useEffect, useMemo, useState, type ReactNode } from "react";
import { describeValue, PREF_FIELDS } from "../../shared/backtestAsk.mjs";
import type { BacktestSpec } from "../../shared/backtestSpec.mjs";
import { backtestFormulas } from "../../shared/formulas.mjs";
import { EquityChart } from "../backtest/EquityChart";
import { Formulas } from "../backtest/Formulas";
import { Replicate } from "../backtest/Replicate";
import type { BtRun } from "../backtest/types";
import type { BacktestRef } from "./types";
import "../backtest/backtest.css";

const pts = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const pc = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const tone = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "up" : "down");
const FROM_WORD: Record<string, string> = { preference: "your preference", "your pick": "your pick" };
const ONLY_FOR: Record<string, string> = { "filters.include10b51": "form4", "filters.contractLagDays": "contracts", "filters.nearHearingDays": "congress" };

type Load = { phase: "loading" } | { phase: "done"; run: BtRun } | { phase: "error"; error: string };

/** The full run behind a chat backtest. Two may run at once on the server; a third waits and asks again. */
async function fetchRun(spec: BacktestSpec, signal: AbortSignal): Promise<BtRun> {
  for (let n = 0; n < 8; n++) {
    const res = await fetch("/api/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec }), signal });
    const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (res.ok && body.ok) return body as BtRun;
    if (res.status !== 429 && res.status !== 503) throw new Error(body.error || `HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 3_000 + n * 1_000));
  }
  throw new Error("The server is busy with other backtests.");
}

function useRun(spec: BacktestSpec | null) {
  const [state, setState] = useState<Load>({ phase: "loading" });
  const key = spec ? JSON.stringify(spec) : "";
  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    setState({ phase: "loading" });
    fetchRun(JSON.parse(key), ctl.signal).then((run) => setState({ phase: "done", run })).catch((err) => { if (!ctl.signal.aborted) setState({ phase: "error", error: err.message }); });
    return () => ctl.abort();
  }, [key]);
  return spec ? state : null;
}

const ROWS: [string, (r: BtRun) => string][] = [
  ["Total", (r) => pts(r.stats?.total)],
  ["Benchmark", (r) => pts(r.stats?.benchmarkTotal)],
  ["Excess", (r) => pts(r.stats?.excessTotal)],
  ["Trades", (r) => String(r.stats?.trades ?? 0)],
  ["Hit rate", (r) => pc(r.stats?.hitRate)],
  ["Max drawdown", (r) => pts(r.stats?.maxDrawdown)],
  ["Sharpe-ish", (r) => (r.stats?.sharpeish == null ? "—" : r.stats.sharpeish.toFixed(2))]
];

/** A backtest result inside the chat: what ran and why, the headline, the curve, top trades, formulas, caveats, Replicate. */
export function BacktestCard({ bt, onFollow, cite }: { bt: BacktestRef; onFollow: (action: string) => void; cite?: ReactNode }) {
  const now = useRun(bt.spec);
  const before = useRun(bt.prior);
  const run = now?.phase === "done" ? now.run : null;
  const prev = before?.phase === "done" ? before.run : null;
  const s = run?.stats || null;
  const formulas = useMemo(() => (run ? backtestFormulas(run) : []), [run]);
  const top = useMemo(() => (run ? [...run.trades].filter((t) => t.ret != null).sort((a, b) => (b.ret ?? 0) - (a.ret ?? 0)).slice(0, 5) : []), [run]);
  const labeled = Object.entries(bt.from || {}).filter(([p, from]) => (from === "preference" || from === "your pick") && p in PREF_FIELDS && (!ONLY_FOR[p] || ONLY_FOR[p] === bt.spec.source));
  const bench = bt.spec.rules.benchmark;
  const warn = run ? run.caveats.items.filter((c) => c.level === "warn") : [];
  const info = run ? run.caveats.items.filter((c) => c.level !== "warn").slice(0, 3) : [];

  return (
    <article className="btc" aria-label="Backtest result">
      <header className="btc-head">
        <p className="btc-using">{cite}<em>Using</em> {bt.using || run?.description}</p>
        {labeled.length ? (
          <p className="btc-from">{labeled.map(([p, from]) => <span key={p} className="tag" title={`From ${FROM_WORD[from] || from}`}>{describeValue(p, p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], bt.spec))} · {FROM_WORD[from] || from}</span>)}</p>
        ) : null}
        {bt.diff.length ? <p className="btc-diff"><em>Changed</em> {bt.diff.join(" · ")}</p> : null}
      </header>
      {now?.phase === "loading" ? <p className="btc-note"><span className="st-spin" aria-hidden /> Loading the full run (cached on the server for 30 minutes)…</p> : null}
      {now?.phase === "error" ? <p className="btc-note warn">{now.error}</p> : null}
      {run && !s ? <p className="btc-note">{run.counts.signals ? run.caveats.items.find((c) => c.id === "unpriced")?.text || `${run.counts.signals} signals matched but none could be priced and held to an exit.` : "No signals matched this spec."}</p> : null}
      {run && !s && warn.length ? <ul className="btc-note">{warn.filter((c) => c.id !== "unpriced").map((c) => <li key={c.id} className="warn">{c.text}</li>)}</ul> : null}
      {run && s ? (
        <>
          {bt.prior ? (
            <div className="btc-compare"><table>
              <thead><tr><th /><th>Previous run</th><th>This run</th></tr></thead>
              <tbody>{ROWS.map(([label, f]) => <tr key={label}><th>{label}</th><td>{prev ? f(prev) : before?.phase === "error" ? "—" : "…"}</td><td>{f(run)}</td></tr>)}</tbody>
            </table></div>
          ) : (
            <div className="btc-tiles">
              <div><em>Strategy</em><strong className={tone(s.total)}>{pts(s.total)}</strong><small>{s.from} → {s.to}</small></div>
              <div><em>{bench === "SECTOR" ? "Sector ETFs" : bench}</em><strong>{pts(s.benchmarkTotal)}</strong><small>same days, same weights</small></div>
              <div><em>Excess</em><strong className={tone(s.excessTotal)}>{pts(s.excessTotal)}</strong><small>{s.excessAnnualized == null ? "under 90 days, not annualized" : `${pts(s.excessAnnualized)} /yr`}</small></div>
              <div><em>Trades</em><strong>{s.trades}</strong><small>hit {pc(s.hitRate)} · beat {pc(s.beatRate)}</small></div>
              <div><em>Max drawdown</em><strong className="down">{pts(s.maxDrawdown)}</strong><small>{bench}: {pts(s.benchmarkMaxDrawdown)}</small></div>
            </div>
          )}
          <EquityChart curve={run.curve} benchmark={bench} />
          {top.length ? (
            <div className="btc-trades"><table>
              <thead><tr><th>Top trades</th><th>Who</th><th>Entry</th><th>Exit</th><th>Return</th><th>Excess</th></tr></thead>
              <tbody>{top.map((t) => (
                <tr key={t.id} onClick={() => onFollow(`ticker:${t.symbol}`)}>
                  <td>{t.symbol}{t.side === "sell" ? " short" : ""}</td><td>{t.actorLabel}</td><td>{t.entry}</td><td>{t.exit}{t.open ? " (open)" : ""}</td>
                  <td className={tone(t.ret)}>{pts(t.ret)}</td><td className={tone(t.excess)}>{pts(t.excess)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : null}
          <Formulas formulas={formulas} />
          {warn.length || info.length ? (
            <details className="btc-cav" open={warn.length > 0}>
              <summary>Data caveats <small>{warn.length} warning{warn.length === 1 ? "" : "s"}</small></summary>
              <ul>{warn.map((c) => <li key={c.id} className="warn">{c.text}</li>)}{info.map((c) => <li key={c.id}>{c.text}</li>)}</ul>
            </details>
          ) : null}
          <p className="btc-src">{run.source} · as of {run.asOf?.slice(0, 16).replace("T", " ") || "—"} · {run.latency}</p>
          <div className="btc-actions">
            <Replicate spec={bt.spec} compact />
            {bt.open ? <button type="button" className="panels-btn" onClick={() => onFollow(bt.open)}>Open expanded view</button> : null}
          </div>
        </>
      ) : null}
    </article>
  );
}
