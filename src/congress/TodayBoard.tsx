import { lazy, Suspense, useEffect, useState } from "react";
import { api, when } from "../lib/api";
import { amountShort, dayLabel, honorific, partyTag, verbOf } from "../../shared/sentences.mjs";

const LeadersBoard = lazy(() => import("./LeadersBoard").then((m) => ({ default: m.LeadersBoard })));

export type TodayTab = "week" | "leaders";

export type FeedRow = {
  id: string; bioguide: string; person: string; chamber: string; party: string; state: string; district: string;
  symbol: string; asset: string; side: string; type: string; amount: string; amountLow: number;
  traded: string; filed: string; lag: number | null; link: string; inJoin: boolean; text: string; more?: number;
};
type TickerRow = { symbol: string; asset: string; inJoin: boolean; trades: number; buys: number; sells: number; members: number; low: number; last: string };
type FeedRes = {
  ok: boolean; error?: string; source?: string; asOf?: string; latency?: string; building?: boolean;
  window?: { from: string; to: string; days: number; fallback: boolean };
  counts?: { filings: number; members: number; lateThisWindow: number };
  latest?: FeedRow[]; late?: FeedRow[]; biggest?: FeedRow[]; tickers?: TickerRow[];
};

const LATE = 45;

/** One disclosed trade in plain words. Name → timeline, ticker → chart, ↗ → the filing itself. */
export function TradeLine({ t, refYear, onFollow }: { t: FeedRow; refYear: number; onFollow: (action: string) => void }) {
  const late = t.lag != null && t.lag > LATE;
  return (
    <li className="trade-line">
      <span>
        {honorific(t)}{" "}
        {t.bioguide ? <button className="link" onClick={() => onFollow(`timeline:${t.bioguide}`)} title="Open their timeline">{t.person}</button> : t.person}
        <small> ({partyTag(t)})</small>{" "}
        <b className={t.side === "buy" ? "up" : t.side === "sell" ? "down" : ""}>{verbOf(t)}</b> {amountShort(t.amount)}{" "}
        {t.symbol && t.inJoin ? (
          <button className="link sym" onClick={() => onFollow(`chart:${t.symbol}`)} title={`${t.asset} · chart with trades marked`}>{t.symbol}</button>
        ) : (
          <span className="sym" title={t.asset}>{t.symbol || t.asset}</span>
        )}
      </span>
      <small className="when">
        traded {dayLabel(t.traded, refYear)}, filed {dayLabel(t.filed, refYear)}
        {t.lag != null ? <> (<b className={late ? "late" : ""}>{t.lag}d</b>)</> : null}
        {late ? <b className="late"> · filed {t.lag! - LATE} days past the {LATE}-day limit</b> : null}
        {t.more ? <> · +{t.more} more in this filing</> : null}
      </small>
      {t.link ? <a href={t.link} target="_blank" rel="noopener noreferrer" title="Open the original filing">filing ↗</a> : null}
    </li>
  );
}

/** Center-stage landing view: what Congress disclosed this week, in sentences, plus leaderboards. */
export function TodayBoard({ tab, onTab, onFollow, onClose }: { tab: TodayTab; onTab: (t: TodayTab) => void; onFollow: (action: string) => void; onClose: () => void }) {
  const [res, setRes] = useState<FeedRes | null>(null);

  useEffect(() => {
    if (tab !== "week") return;
    let cancel = false;
    let timer = 0;
    const load = () => api<FeedRes>("/api/congress/feed")
      .then((body) => { if (cancel) return; setRes(body); if (body.building) timer = window.setTimeout(load, 30_000); })
      .catch((err: Error) => { if (!cancel) setRes({ ok: false, error: err.message }); });
    void load();
    return () => { cancel = true; window.clearTimeout(timer); };
  }, [tab]);

  const refYear = Number((res?.window?.to || new Date().toISOString()).slice(0, 4));
  const w = res?.window;

  return (
    <div className="board today">
      <header className="board-head">
        <div className="board-title">
          <strong>{tab === "week" ? "THIS WEEK IN CONGRESS TRADING" : "LEADERBOARDS"}</strong>
          <span className="scope">
            <button className={tab === "week" ? "on" : ""} onClick={() => onTab("week")}>This week</button>
            <button className={tab === "leaders" ? "on" : ""} onClick={() => onTab("leaders")}>Leaderboards</button>
          </span>
          <button className="tl-close" onClick={onClose} aria-label="Close" title="Close (esc)">×</button>
        </div>
        {tab === "week" ? (
          <>
            <p className="today-explain">Members of Congress must report each stock trade within {LATE} days. These are the newest reports, in plain words. Click a name for their timeline, a ticker for its chart, or <i>filing ↗</i> for the source document.</p>
            <p>
              <em>SOURCE</em>{res?.source || "House Clerk · Senate eFD"}
              <em>AS OF</em>{res?.asOf ? when(res.asOf) : "—"}
              <em>WINDOW</em>{w ? `filed ${dayLabel(w.from, refYear)} – ${dayLabel(w.to, refYear)}${w.fallback ? ` (widened to ${w.days} days: fewer than 5 members filed in the last 7)` : ""}` : "—"}
              <em>LATENCY</em>{res?.latency || "—"}
            </p>
          </>
        ) : null}
      </header>
      {tab === "leaders" ? (
        <Suspense fallback={<p className="stage-loading">Loading…</p>}><LeadersBoard onFollow={onFollow} /></Suspense>
      ) : !res ? (
        <p className="stage-loading">Loading this week's filings…</p>
      ) : !res.ok ? (
        <p className="stage-loading">{res.error || "No disclosures loaded yet. The first backfill takes a few minutes."}</p>
      ) : (
        <div className="board-scroll today-grid">
          <section className="today-card">
            <h3>Latest filings <small>{res.counts?.filings ?? 0} trades from {res.counts?.members ?? 0} members · one row per report</small></h3>
            <ol>{(res.latest || []).map((t) => <TradeLine key={t.id} t={t} refYear={refYear} onFollow={onFollow} />)}</ol>
          </section>
          <section className="today-card">
            <h3>Filed more than {LATE} days late <small>newest first · any trade date</small></h3>
            <ol>{(res.late || []).map((t) => <TradeLine key={t.id} t={t} refYear={refYear} onFollow={onFollow} />)}</ol>
            {!res.late?.length ? <p className="today-empty">No late filings on record.</p> : null}
          </section>
          <section className="today-card">
            <h3>Biggest trades <small>by the low end of the disclosed range · same window</small></h3>
            <ol>{(res.biggest || []).map((t) => <TradeLine key={t.id} t={t} refYear={refYear} onFollow={onFollow} />)}</ol>
          </section>
          <section className="today-card">
            <h3>Most-traded tickers <small>by members trading it · same window</small></h3>
            <table>
              <thead><tr><th>Ticker</th><th>Members</th><th>Trades</th><th>Buys</th><th>Sells</th><th>Disclosed ≥</th></tr></thead>
              <tbody>
                {(res.tickers || []).map((s) => (
                  <tr key={s.symbol} onClick={() => s.inJoin && onFollow(`pos:${s.symbol}`)} title={s.inJoin ? `${s.asset} · every filer in this ticker` : `${s.asset} · not in the ticker join table`} style={s.inJoin ? undefined : { cursor: "default" }}>
                    <td>{s.symbol}</td>
                    <td>{s.members}</td>
                    <td>{s.trades}</td>
                    <td className="up">{s.buys}</td>
                    <td className="down">{s.sells}</td>
                    <td>${Math.round(s.low / 1000).toLocaleString("en-US")}k</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
