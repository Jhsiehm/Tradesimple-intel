import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { when } from "../lib/format";
import { compact } from "./useMarkets";
import { Icon } from "../ui/icons/Icon";

type Buyer = { person: string; bioguide: string; party: string; role: string; amount: string; traded: string; filed: string; lag: number | null; link: string };

type PositionRow = {
  symbol: string;
  name: string;
  inJoin: boolean;
  congress: { trades: number; buys: number; sells: number; buyers: number; sellers: number; members: number; dem: number; rep: number; lastFiled: string; filedAgo: number | null; lastTraded: string; avgLag: number | null; lastBuy: string; lastSell: string; buyTrades: number; sellTrades: number; lastBuyer?: Buyer | null; recentBuyers?: Buyer[] };
  insiders: { filings: number; buys: number; sells: number; other: number; people: number; netShares: number; lastFiled: string; filedAgo: number | null; lastBuy: string; lastSell: string; avgLag: number | null; lastBuyer?: Buyer | null; recentBuyers?: Buyer[] };
  whales: { holders: number; buyers: number; sellers: number; shares: number; value: number; lastFiled: string; filedAgo: number | null; avgLag: number | null };
  short: { shares: number | null; change: string; prior: number | null; date: string } | null;
};

type FeedNote = { source?: string; asOf?: string; latency?: string; count: number; errors: string[] };

type Board = {
  ok: boolean;
  source?: string;
  asOf?: string;
  latency?: string;
  feeds?: Record<"congress" | "insiders" | "whales" | "shorts", FeedNote>;
  items?: PositionRow[];
};

type Column = { id: string; label: string; group: string; get: (row: PositionRow) => number | string | null; show?: (row: PositionRow) => string; tone?: (row: PositionRow) => string };

const COLUMNS: Column[] = [
  { id: "symbol", label: "Symbol", group: "", get: (r) => r.symbol },
  { id: "name", label: "Name", group: "", get: (r) => r.name },
  { id: "members", label: "Mbrs", group: "Congress", get: (r) => r.congress.members },
  { id: "buyers", label: "Buyers", group: "Congress", get: (r) => r.congress.buyers, tone: (r) => (r.congress.buyers ? "up" : "") },
  { id: "sellers", label: "Sellers", group: "Congress", get: (r) => r.congress.sellers, tone: (r) => (r.congress.sellers ? "down" : "") },
  { id: "bs", label: "B / S", group: "Congress", get: (r) => r.congress.buyTrades - r.congress.sellTrades, show: (r) => (r.congress.trades ? `${r.congress.buyTrades} / ${r.congress.sellTrades}` : "—"), tone: (r) => (r.congress.buyTrades > r.congress.sellTrades ? "up" : r.congress.sellTrades > r.congress.buyTrades ? "down" : "") },
  { id: "lastbuy", label: "Last buy", group: "Congress", get: (r) => r.congress.lastBuy || "", show: (r) => r.congress.lastBuy || "—" },
  { id: "lastbuyer", label: "Last buyer", group: "Congress", get: (r) => r.congress.lastBuyer?.person || "", show: (r) => (r.congress.lastBuyer ? `${r.congress.lastBuyer.person}${r.congress.lastBuyer.party ? ` (${r.congress.lastBuyer.party})` : ""}` : "—") },
  { id: "dr", label: "D / R", group: "Congress", get: (r) => r.congress.dem - r.congress.rep, show: (r) => (r.congress.members ? `${r.congress.dem} / ${r.congress.rep}` : "—") },
  { id: "filed", label: "Last filed", group: "Congress", get: (r) => r.congress.lastFiled || "", show: (r) => r.congress.lastFiled || "—" },
  { id: "ago", label: "Ago", group: "Congress", get: (r) => (r.congress.filedAgo == null ? null : -r.congress.filedAgo), show: (r) => (r.congress.filedAgo == null ? "—" : `${r.congress.filedAgo}d`) },
  { id: "lag", label: "Avg lag", group: "Congress", get: (r) => r.congress.avgLag, show: (r) => (r.congress.avgLag == null ? "—" : `${r.congress.avgLag}d`) },
  { id: "f4buy", label: "Buys", group: "Insiders", get: (r) => r.insiders.buys, tone: (r) => (r.insiders.buys ? "up" : "") },
  { id: "f4sell", label: "Sales", group: "Insiders", get: (r) => r.insiders.sells, tone: (r) => (r.insiders.sells ? "down" : "") },
  { id: "f4last", label: "Last buy", group: "Insiders", get: (r) => r.insiders.lastBuy || "", show: (r) => r.insiders.lastBuy || "—" },
  { id: "f4buyer", label: "Last buyer", group: "Insiders", get: (r) => r.insiders.lastBuyer?.person || "", show: (r) => r.insiders.lastBuyer?.person || "—" },
  { id: "f4lag", label: "Lag", group: "Insiders", get: (r) => r.insiders.avgLag, show: (r) => (r.insiders.avgLag == null ? "—" : `${r.insiders.avgLag}d`) },
  { id: "f4ago", label: "Ago", group: "Insiders", get: (r) => (r.insiders.filedAgo == null ? null : -r.insiders.filedAgo), show: (r) => (r.insiders.filedAgo == null ? "—" : `${r.insiders.filedAgo}d`) },
  { id: "holders", label: "Funds", group: "13F", get: (r) => r.whales.holders },
  { id: "adds", label: "Added", group: "13F", get: (r) => r.whales.buyers, tone: (r) => (r.whales.buyers ? "up" : "") },
  { id: "cuts", label: "Cut", group: "13F", get: (r) => r.whales.sellers, tone: (r) => (r.whales.sellers ? "down" : "") },
  { id: "13flag", label: "Lag", group: "13F", get: (r) => r.whales.avgLag, show: (r) => (r.whales.avgLag == null ? "—" : `${r.whales.avgLag}d`) },
  { id: "si", label: "Short", group: "FINRA", get: (r) => r.short?.shares ?? null, show: (r) => (r.short?.shares == null ? "—" : compact(r.short.shares)) },
  { id: "sichg", label: "Chg", group: "FINRA", get: (r) => (r.short ? Number(r.short.change) : null), show: (r) => (r.short && r.short.change !== "" ? `${Number(r.short.change) >= 0 ? "+" : ""}${Number(r.short.change).toFixed(1)}%` : "—"), tone: (r) => (r.short && Number(r.short.change) > 0 ? "down" : r.short && Number(r.short.change) < 0 ? "up" : "") }
];

const GROUPS = ["", "Congress", "Insiders", "13F", "FINRA"];

export function PositionsBoard({ onOpen, onMember }: { onOpen: (symbol: string) => void; onMember: (bioguide: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>({ id: "members", dir: -1 });
  const [scope, setScope] = useState<"join" | "active" | "all">("join");

  useEffect(() => {
    let cancel = false;
    const load = () => api<Board>("/api/markets/positions")
      .then((res) => { if (!cancel) setBoard(res); })
      .catch((err: Error) => { if (!cancel) setError(err.message); });
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => { cancel = true; window.clearInterval(timer); };
  }, []);

  const rows = useMemo(() => {
    const all = board?.items || [];
    const scoped = scope === "join" ? all.filter((r) => r.inJoin) : scope === "active" ? all.filter((r) => r.congress.trades > 0) : all;
    const col = COLUMNS.find((c) => c.id === sort.id) || COLUMNS[2];
    return [...scoped].sort((a, b) => {
      const x = col.get(a);
      const y = col.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "string" || typeof y === "string") return String(x).localeCompare(String(y)) * sort.dir;
      return (x - y) * sort.dir;
    });
  }, [board, sort, scope]);

  const feeds = board?.feeds;

  return (
    <div className="board positions">
      <header className="board-head">
        <div className="board-title">
          <strong>POSITIONS</strong>
          <span>{board ? `${rows.length} symbols` : "Joining filings. First build parses PDFs and SEC tables, about a minute."}</span>
          <span className="scope toggle">
            <button aria-pressed={scope === "join"} onClick={() => setScope("join")}>Join table</button>
            <button aria-pressed={scope === "active"} onClick={() => setScope("active")}>Congress traded</button>
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>All</button>
          </span>
        </div>
        {feeds ? (
          <p className="feeds">
            {(["congress", "insiders", "whales", "shorts"] as const).map((key) => (
              <span key={key} title={feeds[key].latency}>
                <em>{key.toUpperCase()}</em>{feeds[key].count} rows · {when(feeds[key].asOf)}
                {feeds[key].errors.length ? <b title={feeds[key].errors.join("\n")}> · {feeds[key].errors.length} note</b> : null}
              </span>
            ))}
          </p>
        ) : null}
        <p><em>NOTE</em> {board?.latency || "Each column keeps its own filing lag."}</p>
      </header>
      {error ? <p className="tape-empty">{error}</p> : null}
      <div className="board-scroll">
        <table>
          <thead>
            <tr className="groups">
              {GROUPS.map((group) => (
                <th key={group || "id"} colSpan={COLUMNS.filter((c) => c.group === group).length}>{group}</th>
              ))}
            </tr>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.id} className={sort.id === col.id ? "sorted" : undefined}>
                  <button onClick={() => setSort((s) => ({ id: col.id, dir: s.id === col.id ? (s.dir === 1 ? -1 : 1) : col.id === "symbol" || col.id === "name" ? 1 : -1 }))}>
                    {col.label}{sort.id === col.id ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = open.has(row.symbol);
              const buyers = [
                ...(row.congress.recentBuyers || []).map((b) => ({ ...b, who: "Congress" })),
                ...(row.insiders.recentBuyers || []).map((b) => ({ ...b, who: "Insider" }))
              ].sort((a, b) => String(b.traded).localeCompare(String(a.traded)));
              return [
                <tr key={row.symbol} onClick={() => onOpen(row.symbol)} className={expanded ? "expanded" : undefined}>
                  {COLUMNS.map((col) => {
                    const value = col.show ? col.show(row) : col.get(row);
                    const buyer = col.id === "lastbuyer" ? row.congress.lastBuyer : null;
                    return (
                      <td key={col.id} className={[col.id === "name" || col.id === "lastbuyer" || col.id === "f4buyer" ? "board-name" : "", col.tone?.(row) || ""].join(" ").trim() || undefined}>
                        {col.id === "symbol" ? (
                          <button className="expander" aria-expanded={expanded} title="Show recent buyers" onClick={(e) => {
                            e.stopPropagation();
                            setOpen((cur) => { const next = new Set(cur); if (next.has(row.symbol)) next.delete(row.symbol); else next.add(row.symbol); return next; });
                          }}><Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} /></button>
                        ) : null}
                        {buyer?.bioguide ? (
                          <button className="linkish" title={`${buyer.amount} · traded ${buyer.traded} · filed ${buyer.filed}`} onClick={(e) => { e.stopPropagation(); onMember(buyer.bioguide); }}>{String(value)}</button>
                        ) : value === 0 ? "·" : value == null || value === "" ? "—" : String(value)}
                      </td>
                    );
                  })}
                </tr>,
                expanded ? (
                  <tr key={`${row.symbol}-buyers`} className="buyers-row">
                    <td colSpan={COLUMNS.length}>
                      {buyers.length ? (
                        <table className="dt">
                          <thead><tr><th>Who</th><th>Buyer</th><th>Amount</th><th>Traded</th><th>Filed</th><th>Lag</th></tr></thead>
                          <tbody>
                            {buyers.map((b, i) => (
                              <tr key={i} className="live" onClick={(e) => { e.stopPropagation(); if (b.bioguide) onMember(b.bioguide); else if (b.link) window.open(b.link, "_blank"); }}>
                                <td>{b.who}{i === 0 ? <small className="tag"> most recent</small> : null}</td>
                                <td>{b.person}{b.party ? ` (${b.party})` : ""}{b.role ? ` · ${b.role}` : ""}</td>
                                <td>{b.amount || "—"}</td>
                                <td>{b.traded || "—"}</td>
                                <td>{b.filed || "—"}</td>
                                <td>{b.lag == null ? "—" : `${b.lag}d`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <p className="note">No disclosed buys on this symbol in the current windows.</p>}
                    </td>
                  </tr>
                ) : null
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
