import { useMemo, useState } from "react";
import { when } from "../lib/api";
import { usd } from "../markets/format";
import type { Board, Dod } from "./useContracts";

type Sort = "obligations" | "share";

/** S&P 500 contractor dependence plus the same-day DoD announcement index. */
export function ContractsBoard({ board, dod, onSymbol }: { board: Board | null; dod: Dod | null; onSymbol: (symbol: string) => void }) {
  const [sort, setSort] = useState<Sort>("obligations");
  const [sector, setSector] = useState("");
  const rows = useMemo(() => {
    const list = (board?.items || []).filter((r) => !sector || r.sector === sector);
    return sort === "share"
      ? [...list].filter((r) => r.share != null).sort((a, b) => (b.share || 0) - (a.share || 0))
      : list;
  }, [board, sort, sector]);
  const maxSector = Math.max(1, ...(board?.sectors || []).map((s) => s.obligations));
  const idx = board?.index;

  return (
    <div className="board contracts">
      <header className="board-head">
        <div className="board-title">
          <strong>FEDERAL CONTRACTORS</strong>
          <span>
            {idx ? `${idx.name} · ${idx.joined} of ${idx.constituents} joined to USAspending parents · FY${idx.fy || "—"} obligations ${usd(idx.obligations)}` : "Loading contractors…"}
            {board?.building ? ` · building ${board.progress?.done || 0}/${board.progress?.total || "?"}` : ""}
          </span>
          <span className="scope toggle">
            <button aria-pressed={sort === "obligations"} onClick={() => setSort("obligations")}>Largest</button>
            <button aria-pressed={sort === "share"} onClick={() => setSort("share")}>Most dependent</button>
          </span>
        </div>
        <p><em>SOURCE</em> {board?.source || "USAspending.gov · SEC XBRL"} · <em>AS OF</em> {when(board?.asOf)} UTC · <em>NOTE</em> {board?.latency || "—"}</p>
      </header>
      <div className="ct-grid">
        <div className="ct-main">
          {board?.sectors?.length ? (
            <div className="ct-sectors" role="group" aria-label="Filter by sector">
              {board.sectors.slice(0, 11).map((s) => (
                <button key={s.sector} aria-pressed={sector === s.sector} onClick={() => setSector(sector === s.sector ? "" : s.sector)} title={`${s.names} joined names`}>
                  <span>{s.sector}</span>
                  <i style={{ width: `${(s.obligations / maxSector) * 100}%` }} />
                  <b>{usd(s.obligations)}</b>
                </button>
              ))}
            </div>
          ) : null}
          <div className="board-scroll">
            <table>
              <thead>
                <tr><th>#</th><th>Ticker</th><th>Company</th><th className="ct-sector">Sector</th><th>FY obligations</th><th>Revenue</th><th>Share of revenue</th><th className="ct-trend">5-yr trend</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const peak = Math.max(1, ...r.byYear.map((y) => y.amount));
                  return (
                    <tr key={r.symbol} onClick={() => onSymbol(r.symbol)} title={`${r.parents} USAspending parent records · click for ${r.symbol} contract actions`}>
                      <td>{i + 1}</td>
                      <td>{r.symbol}</td>
                      <td className="board-name">{r.name}</td>
                      <td className="board-name ct-sector">{r.sector}</td>
                      <td>{usd(r.obligations)}{r.fy ? <small> FY{String(r.fy).slice(2)}</small> : null}</td>
                      <td>{r.revenue ? <>{usd(r.revenue)}<small> {r.revenueFy}</small></> : "—"}</td>
                      <td className="ct-share">
                        {r.share == null ? "—" : (
                          <>
                            <i style={{ width: `${Math.min(100, r.share * 100)}%` }} className={r.share >= 0.5 ? "hot" : ""} />
                            <span>{(r.share * 100).toFixed(r.share < 0.01 ? 2 : 1)}%</span>
                          </>
                        )}
                      </td>
                      <td className="ct-spark ct-trend">
                        {r.byYear.slice(-5).map((y) => (
                          <i key={y.fy} title={`FY${y.fy} ${usd(y.amount)}`} style={{ height: `${Math.max(2, (Math.max(0, y.amount) / peak) * 18)}px` }} />
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length ? <p className="tape-empty">{board?.building ? "Pulling fiscal-year obligations for each joined contractor…" : "No joined contractors."}</p> : null}
          </div>
        </div>
        <aside className="ct-dod">
          <h3>DoD DAILY AWARDS</h3>
          <p className="ct-note">{dod?.latency || "Awards of $7.5M or more, posted each business day."}</p>
          <ul>
            {(dod?.items || []).map((d) => (
              <li key={d.id}>
                <a href={d.link} target="_blank" rel="noreferrer">{d.title.replace(/^Contracts for /, "")} ↗</a>
                <span>{when(d.published)} UTC</span>
              </li>
            ))}
          </ul>
          <p className="ct-note">{dod?.source || "War.gov"} · full text opens on War.gov; it is not machine-readable here.</p>
        </aside>
      </div>
    </div>
  );
}
