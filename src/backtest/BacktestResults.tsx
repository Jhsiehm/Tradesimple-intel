import { useMemo, useState } from "react";
import { when } from "../lib/api";
import { Icon } from "../ui/icons/Icon";
import { backtestFormulas } from "../../shared/formulas.mjs";
import { EquityChart } from "./EquityChart";
import { Formulas } from "./Formulas";
import { IsItReal } from "./IsItReal";
import { Replicate } from "./Replicate";
import type { BtRun } from "./types";

const pts = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`);
const pc = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const tone = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "up" : "down");

function Tile({ label, value, sub, cls, title }: { label: string; value: string; sub?: string; cls?: string; title?: string }) {
  return (
    <div className="bt-tile" title={title}>
      <em>{label}</em>
      <strong className={cls}>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

type Tab = "trades" | "members" | "tickers";
type Sort = "entry" | "ret" | "excess";

export function BacktestResults({ run, onFollow, onCopy, copied }: { run: BtRun; onFollow: (action: string) => void; onCopy: () => void; copied: boolean }) {
  const [tab, setTab] = useState<Tab>("trades");
  const [sort, setSort] = useState<Sort>("entry");
  const [shown, setShown] = useState(100);
  const s = run.stats;
  const bench = run.rules.benchmark;
  const trades = useMemo(() => {
    const rows = [...run.trades];
    if (sort === "ret") rows.sort((a, b) => (b.ret ?? 0) - (a.ret ?? 0));
    else if (sort === "excess") rows.sort((a, b) => (b.excess ?? 0) - (a.excess ?? 0));
    else rows.sort((a, b) => b.entry.localeCompare(a.entry));
    return rows;
  }, [run.trades, sort]);
  const warn = run.caveats.items.filter((c) => c.level === "warn");
  const info = run.caveats.items.filter((c) => c.level !== "warn");

  return (
    <div className="bt-results">
      {run.building ? <p className="bt-note warn">Partial run: {run.pending.length ? `${run.pending.length} tickers were still loading prices` : "disclosures are still being read"}. Asking again every few seconds until it settles.</p> : null}
      {!s ? (
        <p className="bt-empty">{run.counts.matched === 0 || run.counts.signals === 0 ? "No signals matched these filters." : `${run.counts.signals} signals matched but none could be priced and held to an exit. See the notes below.`}</p>
      ) : (
        <>
          <div className="bt-tiles">
            <Tile label="Strategy" value={pts(s.total)} sub={`${pts(s.annualized)} /yr · ${s.from} → ${s.to}`} cls={tone(s.total)} title="Calendar-time portfolio: open positions at equal (or range-midpoint) weight, idle days earn 0." />
            <Tile label={bench === "SECTOR" ? "Sector ETFs" : bench} value={pts(s.benchmarkTotal)} sub={`${pts(s.benchmarkAnnualized)} /yr · same days, same weights`} title="The benchmark holds exactly the same positions on exactly the same days." />
            <Tile label="Excess" value={pts(s.excessTotal)} sub={s.excessAnnualized == null ? "span under 90 days" : `${pts(s.excessAnnualized)} /yr`} cls={tone(s.excessTotal)} />
            <Tile label="Trades" value={String(s.trades)} sub={`${run.counts.signals} signals · ${run.counts.skipped} left out`} />
            <Tile label="Hit rate" value={pc(s.hitRate)} sub={`${pc(s.beatRate)} beat the benchmark`} title="Share of trades with a positive net return, and share that beat the benchmark on the same days." />
            <Tile label="Avg / median trade" value={`${pts(s.avgTrade)} / ${pts(s.medianTrade)}`} sub={`excess ${pts(s.avgExcess)} / ${pts(s.medianExcess)}`} />
            <Tile label="Max drawdown" value={pts(s.maxDrawdown)} sub={`${bench}: ${pts(s.benchmarkMaxDrawdown)} · ${s.drawdownFrom} → ${s.drawdownTo}`} cls="down" />
            <Tile label="Sharpe-ish" value={s.sharpeish == null ? "—" : s.sharpeish.toFixed(2)} sub={`vol ${pc(s.volatility)} · IR-ish ${s.infoRatioish ?? "—"}`} title={s.sharpeNote} />
          </div>
          <IsItReal reality={run.reality} />
          <EquityChart curve={run.curve} benchmark={bench} />
          <Formulas formulas={backtestFormulas(run)} />
          <p className="bt-basis">{s.weighting} Average {s.avgConcurrent ?? "—"} positions open (max {s.maxConcurrent}); average hold {s.avgHoldDays} days. Excess t-statistic {s.excessT ?? "—"} assumes independent trades, which these are not; the clustered t above does not.</p>
        </>
      )}

      <section className={warn.length ? "bt-caveats has-warn" : "bt-caveats"} aria-label="Data caveats">
        <h3>Data caveats <small>read before trusting any number above</small></h3>
        <ul>{warn.map((c) => <li key={c.id} className="warn">{c.text}</li>)}{info.map((c) => <li key={c.id}>{c.text}</li>)}</ul>
      </section>

      {s ? (
        <section className="bt-table-wrap">
          <div className="bt-tabs" role="tablist">
            {(["trades", "members", "tickers"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "trades" ? `Trades (${run.trades.length})` : t === "members" ? `By ${run.spec.source === "contracts" ? "agency" : run.spec.source === "form4" ? "insider" : "member"} (${run.byMember.total})` : `By ticker (${run.byTicker.total})`}
              </button>
            ))}
            {tab === "trades" ? (
              <label className="bt-sort">Sort <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="entry">newest entry</option><option value="ret">best return</option><option value="excess">best excess</option></select></label>
            ) : null}
          </div>
          <div className="bt-scroll">
            {tab === "trades" ? (
              <table>
                <thead><tr><th>Ticker</th><th>Who</th><th title="Public date: filing or posting">Public</th><th>Entry</th><th>Exit</th><th>Days</th><th>Return</th><th>{bench === "SECTOR" ? "ETF" : bench}</th><th>Excess</th></tr></thead>
                <tbody>
                  {trades.slice(0, shown).map((t) => (
                    <tr key={t.id} onClick={() => onFollow(`ticker:${t.symbol}`)} title={`${t.side === "sell" ? "Short" : "Long"} ${t.symbol}: ${t.entryPrice} → ${t.exitPrice} · exit by ${t.why}${t.traded ? ` · traded ${t.traded}` : ""}`}>
                      <td>{t.symbol}{t.side === "sell" ? <small> short</small> : null}</td>
                      <td className="board-name">{t.actorLabel}</td>
                      <td>{t.signal}</td><td>{t.entry}</td><td>{t.exit}{t.open ? <small> open</small> : t.why !== "hold" ? <small> {t.why}</small> : null}</td><td>{t.days}</td>
                      <td className={tone(t.ret)}>{pts(t.ret)}</td><td className={tone(t.bench)}>{pts(t.bench)}</td><td className={tone(t.excess)}>{pts(t.excess)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <thead><tr><th>{tab === "members" ? "Name" : "Ticker"}</th><th>Trades</th><th>Hit rate</th><th>Avg</th><th>Median</th><th>Avg excess</th><th>Beat {bench === "SECTOR" ? "ETF" : bench}</th></tr></thead>
                <tbody>
                  {(tab === "members" ? run.byMember : run.byTicker).rows.map((r) => (
                    <tr key={r.key} onClick={() => onFollow(tab === "tickers" ? `ticker:${r.key}` : /^[A-Z]\d{6}$/.test(r.key) ? `timeline:${r.key}` : "")}>
                      <td className="board-name">{r.label}</td><td>{r.n}</td><td>{pc(r.hitRate)}</td>
                      <td className={tone(r.avg)}>{pts(r.avg)}</td><td className={tone(r.median)}>{pts(r.median)}</td><td className={tone(r.avgExcess)}>{pts(r.avgExcess)}</td><td>{pc(r.beatRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {tab === "trades" && trades.length > shown ? <button className="bt-more" onClick={() => setShown((n) => n + 200)}>Show {Math.min(200, trades.length - shown)} more of {trades.length - shown}</button> : null}
          {tab !== "trades" && (tab === "members" ? run.byMember : run.byTicker).total > 30 ? <p className="bt-basis">Top 30 by trade count of {(tab === "members" ? run.byMember : run.byTicker).total}.</p> : null}
        </section>
      ) : null}

      <section className="bt-feeds" aria-label="Sources">
        <h3>Sources <small>every feed with its own as-of and latency</small></h3>
        <dl>
          {run.feeds.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd><b>{f.source}</b><span>as of {f.asOf ? when(f.asOf) : "—"}</span><span>{f.latency}</span></dd>
            </div>
          ))}
          <div><dt>Run</dt><dd><span>{run.cache === "hit" ? "Served from the 30-minute result cache. " : ""}{(run.timing.totalMs / 1000).toFixed(1)} s total: signals {run.timing.signalsMs} ms, prices {(run.timing.pricesMs / 1000).toFixed(1)} s, engine {run.timing.engineMs} ms.</span></dd></div>
        </dl>
        <button className="bt-copy" onClick={onCopy}><Icon name="link" /> {copied ? "Link copied" : "Copy link to this backtest"}</button>
        {s ? <Replicate spec={run.spec} /> : null}
      </section>
    </div>
  );
}
