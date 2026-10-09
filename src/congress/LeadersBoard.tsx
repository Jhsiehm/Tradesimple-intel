import { useEffect, useState } from "react";
import { api, when } from "../lib/api";
import type { StageList } from "../types";
import { Icon } from "../ui/icons/Icon";

type Seat = { bioguide: string; person: string; party: string; state: string; chamber: string };
type Scored = Seat & {
  buys: number; priced: number; excessSince: number | null; medianSince: number | null; excess30: number | null; n30: number;
  excess90: number | null; n90: number; hitRate: number | null; excessMid: number | null;
  best: { symbol: string; excess: number }; worst: { symbol: string; excess: number };
};
type Activity = Seat & {
  trades: number; buys: number; sells: number; low: number; symbols: number; lastFiled: string; reports: number;
  late: number; lateReports: number; maxLag: number | null; maxLagLink: string; maxLagSymbol: string; medianLag: number | null;
};
type TickerRow = { symbol: string; asset: string; inJoin: boolean; trades: number; buys: number; sells: number; members: number; low: number };
export type LeadersRes = {
  ok: boolean; error?: string; building?: boolean; source?: string; asOf?: string; latency?: string; basis?: string;
  progress?: { done: number; total: number; priced: number; scored: number; lastClose: string | null; running: boolean };
  minBuys?: number; scoredMembers?: number;
  excessTop?: Scored[]; excessBottom?: Scored[]; active?: Activity[]; late?: Activity[]; longest?: Activity[]; tickers?: TickerRow[];
};

export const pts = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const tone = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "up" : "down");
const seat = (m: Seat) => `${m.party || "—"}-${m.state || "—"}`;

function Who({ m, onFollow }: { m: Seat; onFollow: (a: string) => void }) {
  return (
    <td className="board-name">
      <button className="link" onClick={(e) => { e.stopPropagation(); onFollow(`timeline:${m.bioguide}`); }}>{m.person}</button>
      <small> {seat(m)}{m.chamber === "senate" ? " · Sen." : ""}</small>
    </td>
  );
}

const LEAD_BLURB = "Disclosed buys versus the S&P 500.";

/** Leaderboards: disclosed buys vs the S&P 500, most active traders, late filers, most-traded tickers. */
export function LeadersBoard({ onFollow, onList }: { onFollow: (action: string) => void; onList?: (list: StageList) => void }) {
  const [res, setRes] = useState<LeadersRes | null>(null);
  const [side, setSide] = useState<"top" | "bottom">("top");

  useEffect(() => {
    let cancel = false;
    let timer = 0;
    const load = () => api<LeadersRes>("/api/congress/leaders")
      .then((body) => { if (cancel) return; setRes(body); if (body.building) timer = window.setTimeout(load, 20_000); })
      .catch((err: Error) => { if (!cancel) setRes({ ok: false, error: err.message }); });
    void load();
    return () => { cancel = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!onList) return;
    const status = { source: res?.source || "House Clerk · Senate eFD", asOf: res?.asOf ? when(res.asOf) : "", latency: res?.latency || "Disclosed buys of joined tickers, equal-weighted." };
    if (!res) {
      onList({ title: "Leaderboards", blurb: LEAD_BLURB, empty: "Loading leaderboards…", items: [], status });
      return;
    }
    if (!res.ok) {
      onList({ title: "Leaderboards", blurb: LEAD_BLURB, empty: res.error || "No disclosures loaded yet.", items: [], status });
      return;
    }
    const rows = side === "top" ? res.excessTop || [] : res.excessBottom || [];
    onList({
      title: "Leaderboards",
      blurb: LEAD_BLURB,
      empty: "No members with enough priced buys yet.",
      status,
      items: rows.map((m) => ({
        id: m.bioguide,
        title: m.person,
        meta: `${m.party || "—"}-${m.state || "—"} · ${m.priced} priced buys`,
        tone: m.excessSince == null ? "" : m.excessSince >= 0 ? "up" : "down",
        action: `timeline:${m.bioguide}`
      }))
    });
  }, [res, side, onList]);

  if (!res) return <p className="stage-loading">Loading leaderboards…</p>;
  if (!res.ok) return <p className="stage-loading">{res.error || "No disclosures loaded yet."}</p>;
  const p = res.progress;
  const scored = side === "top" ? res.excessTop || [] : res.excessBottom || [];

  return (
    <div className="board-scroll">
      <div className="leaders-meta">
        <p className="today-explain" title={res.basis}>Disclosed buys, equal-weighted, not their actual portfolio.</p>
        <p>
          <em>SOURCE</em>{res.source}
          <em>AS OF</em>{res.asOf ? when(res.asOf) : "—"}
          <em>LATENCY</em>{res.latency}
          {p?.running ? <><em>PRICING</em>{p.done}/{p.total} symbols · partial results</> : null}
        </p>
      </div>
      <div className="today-grid">
        <section className="today-card wide">
          <h3>
            Disclosed buys vs S&P 500
            <small>members with at least {res.minBuys} priced buys · {res.scoredMembers ?? 0} qualify · excess = stock return minus SPY, in percentage points</small>
            <span className="scope inline">
              <button className={side === "top" ? "on" : ""} onClick={() => setSide("top")}>Highest</button>
              <button className={side === "bottom" ? "on" : ""} onClick={() => setSide("bottom")}>Lowest</button>
            </span>
          </h3>
          {scored.length ? (
            <table>
              <thead><tr><th>Member</th><th title="Priced buys of all disclosed buys">Buys</th><th title="Average excess return since the trade, equal-weighted">Since trade</th><th title="Average excess return 30 days after the trade (buys at least 30 days old)">30d</th><th title="Average excess return 90 days after the trade (buys at least 90 days old)">90d</th><th title="Share of buys that beat SPY since the trade">Hit rate</th><th title="Since trade, weighted by the midpoint of each disclosed range">Mid-wtd</th></tr></thead>
              <tbody>
                {scored.map((m) => (
                  <tr key={m.bioguide} onClick={() => onFollow(`timeline:${m.bioguide}`)} title={`Best: ${m.best.symbol} ${pts(m.best.excess)} pts · worst: ${m.worst.symbol} ${pts(m.worst.excess)} pts · median ${pts(m.medianSince)} pts`}>
                    <Who m={m} onFollow={onFollow} />
                    <td>{m.priced}<small>/{m.buys}</small></td>
                    <td className={tone(m.excessSince)}>{pts(m.excessSince)}</td>
                    <td className={tone(m.excess30)} title={`${m.n30} buys`}>{pts(m.excess30)}</td>
                    <td className={tone(m.excess90)} title={`${m.n90} buys`}>{pts(m.excess90)}</td>
                    <td>{pct(m.hitRate)}</td>
                    <td className={tone(m.excessMid)}>{pts(m.excessMid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="today-empty">{p?.running ? `Pricing symbols (${p.done}/${p.total}); members appear once they have ${res.minBuys} priced buys.` : `No member has ${res.minBuys} priced buys yet.`}</p>
          )}
        </section>
        <section className="today-card">
          <h3>Most active traders <small>disclosed trades since Jan 3, 2025</small></h3>
          <table>
            <thead><tr><th>Member</th><th>Trades</th><th>Buys</th><th>Sells</th><th>Tickers</th><th title="Sum of the low ends of the disclosed ranges">Disclosed ≥</th><th>Last filed</th></tr></thead>
            <tbody>
              {(res.active || []).map((m) => (
                <tr key={m.bioguide} onClick={() => onFollow(`timeline:${m.bioguide}`)}>
                  <Who m={m} onFollow={onFollow} />
                  <td>{m.trades.toLocaleString("en-US")}</td>
                  <td className="up">{m.buys}</td>
                  <td className="down">{m.sells}</td>
                  <td>{m.symbols}</td>
                  <td>${(m.low / 1e6).toFixed(1)}M</td>
                  <td>{m.lastFiled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="today-card">
          <h3>Late filers <small>reports with a trade filed more than 45 days after it happened</small></h3>
          <table>
            <thead><tr><th>Member</th><th title="Reports containing at least one late trade">Late reports</th><th title="Trade lines filed late">Late trades</th><th>Longest lag</th><th>Median lag</th></tr></thead>
            <tbody>
              {(res.late || []).map((m) => (
                <tr key={m.bioguide} onClick={() => onFollow(`timeline:${m.bioguide}`)}>
                  <Who m={m} onFollow={onFollow} />
                  <td className="amber">{m.lateReports}</td>
                  <td>{m.late}<small>/{m.trades}</small></td>
                  <td>
                    {m.maxLagLink ? <a href={m.maxLagLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={`${m.maxLagSymbol} · open the filing`}>{m.maxLag}d <Icon name="external" size={12} /></a> : `${m.maxLag ?? "—"}d`}
                  </td>
                  <td>{m.medianLag == null ? "—" : `${Math.round(m.medianLag)}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="today-card">
          <h3>Most-traded tickers <small>by members trading it, since Jan 3, 2025</small></h3>
          <table>
            <thead><tr><th>Ticker</th><th>Members</th><th>Trades</th><th>Buys</th><th>Sells</th></tr></thead>
            <tbody>
              {(res.tickers || []).map((s) => (
                <tr key={s.symbol} onClick={() => s.inJoin && onFollow(`pos:${s.symbol}`)} title={s.inJoin ? `${s.asset} · every filer in this ticker` : `${s.asset} · not in the ticker join table`} style={s.inJoin ? undefined : { cursor: "default" }}>
                  <td>{s.symbol}</td>
                  <td>{s.members}</td>
                  <td>{s.trades}</td>
                  <td className="up">{s.buys}</td>
                  <td className="down">{s.sells}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
