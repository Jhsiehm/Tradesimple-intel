import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { big, tone, when } from "../lib/format";
import { toggleSymbol, useWatch } from "../lib/useWatch";

type Quote = {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  core: boolean;
  index?: string[];
  last: number | null;
  change: number | null;
  changePct: number | null;
  volume: number;
  marketCap: number;
  asOf: string;
};

type Board = {
  ok: boolean;
  error?: string;
  source?: string;
  asOf?: string;
  latency?: string;
  items?: Quote[];
};

type SortKey = "symbol" | "name" | "sector" | "last" | "changePct" | "volume" | "marketCap" | "weight";
const POLL = 60 * 1000;

export function QuoteBoard({ onOpen, onMap }: { onOpen: (symbol: string) => void; onMap?: () => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [sector, setSector] = useState("All");
  const [scope, setScope] = useState<"all" | "core" | "watch">("all");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "marketCap", dir: -1 });
  const { hasSymbol } = useWatch();

  useEffect(() => {
    let cancel = false;
    const load = () => api<Board>("/api/markets/board")
      .then((res) => {
        if (cancel) return;
        if (!res.ok) setError(res.error || "No quotes");
        else { setError(""); setBoard(res); }
      })
      .catch((err: Error) => { if (!cancel) setError(err.message); });
    void load();
    const timer = window.setInterval(load, POLL);
    return () => { cancel = true; window.clearInterval(timer); };
  }, []);

  const universe = useMemo(() => board?.items || [], [board]);
  const all = useMemo(() => universe.filter((q) => q.index?.includes("SP500")), [universe]);
  const totalCap = useMemo(() => all.reduce((s, q) => s + (q.marketCap || 0), 0) || 1, [all]);

  const sectors = useMemo(() => {
    const map = new Map<string, { cap: number; weighted: number; up: number; down: number; n: number }>();
    for (const q of all) {
      const key = q.sector || "Other";
      const cur = map.get(key) || { cap: 0, weighted: 0, up: 0, down: 0, n: 0 };
      cur.cap += q.marketCap || 0;
      cur.weighted += (q.marketCap || 0) * (q.changePct || 0);
      cur.n += 1;
      if ((q.changePct || 0) > 0) cur.up += 1;
      if ((q.changePct || 0) < 0) cur.down += 1;
      map.set(key, cur);
    }
    return [...map.entries()].map(([name, v]) => ({ name, ...v, pct: v.cap ? v.weighted / v.cap : 0 })).sort((a, b) => b.cap - a.cap);
  }, [all]);

  const breadth = useMemo(() => {
    const up = all.filter((q) => (q.changePct || 0) > 0).length;
    const down = all.filter((q) => (q.changePct || 0) < 0).length;
    const weighted = all.reduce((s, q) => s + (q.marketCap || 0) * (q.changePct || 0), 0) / totalCap;
    return { up, down, flat: all.length - up - down, weighted };
  }, [all, totalCap]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (scope === "all" ? all : universe).filter((r) =>
      (scope === "all" || (scope === "core" ? r.core : hasSymbol(r.symbol)))
      && (sector === "All" || (r.sector || "Other") === sector)
      && (!q || `${r.symbol} ${r.name} ${r.industry}`.toLowerCase().includes(q))
    );
    const get = (r: Quote) => (sort.key === "weight" ? r.marketCap : r[sort.key]);
    return [...list].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y)) * sort.dir;
    });
  }, [all, universe, scope, sector, filter, sort, hasSymbol]);

  const head = (key: SortKey, label: string) => (
    <th className={sort.key === key ? "sorted" : undefined}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "symbol" || key === "name" || key === "sector" ? 1 : -1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  return (
    <div className="board positions sp-board">
      <header className="board-head">
        <div className="board-title">
          <strong>S&amp;P 500</strong>
          <span>{all.length ? `${rows.length} of ${all.length} names` : "Loading one screener call"}</span>
          <span className="scope toggle">
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>All 500</button>
            <button aria-pressed={scope === "core"} onClick={() => setScope("core")}>Curated joins</button>
            <button aria-pressed={scope === "watch"} onClick={() => setScope("watch")}>★ Watchlist</button>
          </span>
          {onMap ? <button className="go-btn" onClick={onMap} title="Every constituent's SEC business address on the district map, with counts per district">HQ map</button> : null}
          <input className="board-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter symbol, name, industry" aria-label="Filter" />
        </div>
        <p className="breadth">
          <span><em>ADV</em><b className="up">{breadth.up}</b></span>
          <span><em>DEC</em><b className="down">{breadth.down}</b></span>
          <span><em>FLAT</em>{breadth.flat}</span>
          <span title="Market-cap weighted average of the listed members. Not the official S&P 500 index level."><em>CAP-WTD</em><b className={tone(breadth.weighted)}>{breadth.weighted >= 0 ? "+" : ""}{breadth.weighted.toFixed(2)}%</b></span>
          <span className="breadth-bar" aria-hidden="true"><i className="up-bg" style={{ flex: breadth.up }} /><i style={{ flex: breadth.flat }} /><i className="down-bg" style={{ flex: breadth.down }} /></span>
        </p>
        <div className="sector-strip">
          <button aria-pressed={sector === "All"} onClick={() => setSector("All")}><span>All sectors</span><b className={tone(breadth.weighted)}>{breadth.weighted.toFixed(2)}%</b></button>
          {sectors.map((s) => (
            <button key={s.name} aria-pressed={sector === s.name} onClick={() => setSector(sector === s.name ? "All" : s.name)} style={{ ["--heat" as string]: heat(s.pct) }} title={`${s.n} names · ${s.up} up / ${s.down} down · ${(s.cap / totalCap * 100).toFixed(1)}% of cap`}>
              <span>{s.name}</span><b className={tone(s.pct)}>{s.pct >= 0 ? "+" : ""}{s.pct.toFixed(2)}%</b>
            </button>
          ))}
        </div>
        <p>
          <em>SOURCE</em> {board?.source || "Nasdaq screener"}
          <em>AS OF</em> {when(board?.asOf)}
          <em>NOTE</em> {board?.latency || "Delayed quotes."}
        </p>
      </header>
      {error ? <p className="tape-empty">{error}</p> : null}
      <div className="board-scroll">
        <table>
          <thead>
            <tr>
              {head("symbol", "Symbol")}
              {head("name", "Name")}
              {head("sector", "Sector")}
              {head("last", "Last")}
              {head("changePct", "Chg %")}
              {head("volume", "Volume")}
              {head("marketCap", "Mkt cap")}
              {head("weight", "Weight")}
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.symbol} onClick={() => onOpen(q.symbol)}>
                <td>
                  <button className={hasSymbol(q.symbol) ? "star on" : "star"} title={hasSymbol(q.symbol) ? "Remove from watchlist" : "Add to watchlist"} onClick={(e) => { e.stopPropagation(); toggleSymbol(q.symbol); }}>{hasSymbol(q.symbol) ? "★" : "☆"}</button>
                  {q.symbol}{q.core ? <small className="tag"> JOIN</small> : null}
                </td>
                <td className="board-name">{q.name}</td>
                <td className="board-name dim">{q.sector}</td>
                <td>{q.last == null ? "—" : q.last.toFixed(2)}</td>
                <td className={tone(q.changePct)}>{q.changePct == null ? "—" : `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%`}</td>
                <td>{q.volume ? big(q.volume) : "—"}</td>
                <td>{q.marketCap ? big(q.marketCap) : "—"}</td>
                <td className="dim">{q.marketCap ? `${(q.marketCap / totalCap * 100).toFixed(2)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function heat(pct: number) {
  const a = Math.min(0.5, Math.abs(pct) / 4);
  return pct >= 0 ? `rgba(143, 191, 106, ${a})` : `rgba(224, 122, 114, ${a})`;
}
