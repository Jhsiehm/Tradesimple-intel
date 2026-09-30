import { useEffect, useMemo, useState } from "react";
import { api, when } from "../lib/api";
import { num, signed, tone } from "./format";

type Quote = {
  symbol: string;
  name: string;
  ok: boolean;
  last?: number;
  changePct?: number | null;
  currency?: string;
  exchange?: string;
  open?: boolean | null;
  asOf?: string | null;
};
type Index = Quote & { group: string; country: string; etf?: string };
type Etf = Quote & { tracks: string };
type Adr = {
  adr: string;
  local: string;
  ratio: number;
  name: string;
  venue: string;
  ok: boolean;
  adrLast?: number;
  adrChangePct?: number | null;
  adrOpen?: boolean | null;
  localLast?: number;
  localCurrency?: string;
  localChangePct?: number | null;
  localOpen?: boolean | null;
  localAsOf?: string;
  fx?: number | null;
  fxPair?: string;
  implied?: number | null;
  premium?: number | null;
  gapHours?: number | null;
};
type Board = {
  ok: boolean;
  source: string;
  asOf: string;
  latency: string;
  arbNote: string;
  ratioNote: string;
  indices: Index[];
  etfs: Etf[];
  adrs: Adr[];
};

const GROUPS = ["Americas", "Europe", "Asia-Pacific", "Middle East & Africa"];

function age(iso?: string | null) {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

function Session({ open }: { open?: boolean | null }) {
  if (open == null) return <span className="sess">—</span>;
  return <span className={open ? "sess on" : "sess"}>{open ? "● open" : "○ closed"}</span>;
}

export function useGlobals() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancel = false;
    const load = () => api<Board>("/api/markets/globals")
      .then((res) => { if (!cancel) { setBoard(res); setError(""); } })
      .catch((err: Error) => { if (!cancel) setError(err.message); });
    void load();
    const timer = window.setInterval(load, 2 * 60 * 1000);
    return () => { cancel = true; window.clearInterval(timer); };
  }, []);
  return { board, error };
}

export function GlobalBoard({ onOpen, compact }: { onOpen: (symbol: string) => void; compact?: boolean }) {
  const { board, error } = useGlobals();
  const [tab, setTab] = useState<"indices" | "arb" | "etfs">("indices");
  const openCount = useMemo(() => (board?.indices || []).filter((r) => r.open).length, [board]);

  const indices = (
    <table>
      <thead>
        <tr><th>Index</th><th>Market</th><th>Last</th><th>Chg%</th><th>Ccy</th><th>Session</th><th>Age</th>{compact ? null : <th>US ETF</th>}</tr>
      </thead>
      {GROUPS.map((group) => {
        const rows = (board?.indices || []).filter((r) => r.group === group);
        if (!rows.length) return null;
        return (
          <tbody key={group}>
            <tr className="group-row"><td colSpan={compact ? 7 : 8}>{group}</td></tr>
            {rows.map((r) => (
              <tr key={r.symbol} onClick={() => onOpen(r.symbol)} title={`${r.symbol} · ${r.exchange || ""} · as of ${when(r.asOf)} UTC`}>
                <td className="board-name">{r.name}</td>
                <td className="board-name">{r.country}</td>
                <td>{r.ok ? num(r.last, 2) : "—"}</td>
                <td className={tone(r.changePct)}>{signed(r.changePct, 2, "%")}</td>
                <td>{r.currency || "—"}</td>
                <td><Session open={r.open} /></td>
                <td>{age(r.asOf)}</td>
                {compact ? null : (
                  <td>{r.etf ? <button className="linkish" onClick={(e) => { e.stopPropagation(); onOpen(r.etf!); }}>{r.etf}</button> : "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        );
      })}
    </table>
  );

  const arb = (
    <table>
      <thead>
        <tr><th>Name</th><th>ADR</th><th>Last</th><th>Local line</th><th>Local</th><th>FX</th><th>Implied</th><th>Prem</th><th>Sessions</th><th>Gap</th></tr>
      </thead>
      <tbody>
        {(board?.adrs || []).map((a) => (
          <tr key={a.adr} onClick={() => onOpen(a.adr)} title={`${a.ratio} local shares per ADR · ${a.venue}`}>
            <td className="board-name">{a.name}</td>
            <td>{a.adr}</td>
            <td>{num(a.adrLast, 2)}</td>
            <td><button className="linkish" onClick={(e) => { e.stopPropagation(); onOpen(a.local); }}>{a.local}</button></td>
            <td>{a.localLast == null ? "—" : `${num(a.localLast, 2)} ${a.localCurrency || ""}`}</td>
            <td>{a.fx == null ? "—" : `${a.fxPair} ${num(a.fx, 3)}`}</td>
            <td>{num(a.implied ?? null, 2)}</td>
            <td className={a.premium == null ? "" : Math.abs(a.premium) >= 2 ? "stale" : tone(a.premium)}>{signed(a.premium ?? null, 2, "%")}</td>
            <td>{a.adrOpen && a.localOpen ? <span className="sess on">both open</span> : a.adrOpen ? <span className="sess">local closed</span> : a.localOpen ? <span className="sess">ADR closed</span> : <span className="sess">both closed</span>}</td>
            <td>{a.gapHours == null ? "—" : `${a.gapHours.toFixed(1)}h`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const etfs = (
    <table>
      <thead><tr><th>ETF</th><th>Name</th><th>Tracks</th><th>Last</th><th>Chg%</th><th>Age</th></tr></thead>
      <tbody>
        {(board?.etfs || []).map((r) => (
          <tr key={r.symbol} onClick={() => onOpen(r.symbol)}>
            <td>{r.symbol}</td>
            <td className="board-name">{r.name}</td>
            <td className="board-name">{r.tracks}</td>
            <td>{num(r.last, 2)}</td>
            <td className={tone(r.changePct)}>{signed(r.changePct, 2, "%")}</td>
            <td>{age(r.asOf)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className={compact ? "board globals compact" : "board globals"}>
      <header className="board-head">
        <div className="board-title">
          <strong>GLOBAL</strong>
          <span>{board ? `${board.indices.length} indices · ${openCount} in session · ${board.adrs.length} ADR pairs · ${board.etfs.length} ETFs` : "Loading exchanges…"}</span>
          <span className="scope toggle">
            <button aria-pressed={tab === "indices"} onClick={() => setTab("indices")}>Indices</button>
            <button aria-pressed={tab === "arb"} onClick={() => setTab("arb")}>ADR arb</button>
            <button aria-pressed={tab === "etfs"} onClick={() => setTab("etfs")}>ETFs & funds</button>
          </span>
        </div>
        <p className="arb-note"><em>NOT FRESH ENOUGH FOR ARBITRAGE</em> {board?.arbNote || "Delayed snapshots, not an execution feed."}</p>
        {tab === "arb" && board ? <p><em>MATH</em> {board.ratioNote}</p> : null}
        <p><em>SOURCE</em> {board?.source || "Yahoo Finance"} · <em>AS OF</em> {when(board?.asOf)} UTC · <em>NOTE</em> {board?.latency || "—"}</p>
      </header>
      {error ? <p className="tape-empty">{error}</p> : null}
      <div className="board-scroll">{tab === "indices" ? indices : tab === "arb" ? arb : etfs}</div>
    </div>
  );
}
