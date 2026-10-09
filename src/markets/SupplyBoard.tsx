import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { signed, tone, when } from "../lib/format";

type Node = {
  symbol: string;
  name: string;
  what: string;
  basis: string;
  role: "supplier" | "customer" | "subsidiary";
  market: string;
  index: string;
  etf: string;
  joined?: boolean;
  corr: number | null;
  beta: number | null;
  ret: number | null;
  priced: boolean;
};
type Chain = {
  ok: boolean;
  error?: string;
  available?: string[];
  symbol: string;
  name: string;
  source: string;
  asOf: string;
  latency: string;
  focus: { market: string; index: string; etf: string; ret: number | null };
  segments: { name: string; inputs: string[] }[];
  nodes: Node[];
  indices: { symbol: string; corr: number | null; beta: number | null; ret: number | null }[];
  series: Record<string, [string, number][]>;
};

const PALETTE = ["#6fb6c8", "#d98c5f", "#9fc36a", "#c78ad6", "#e0c45c", "#6f8fd8", "#d86f7a", "#7fd1b0"];

function corrColor(c: number | null) {
  if (c == null) return "#3a4650";
  if (c >= 0.5) return "#e8a33d";
  if (c >= 0.25) return "#b48a4a";
  if (c <= -0.1) return "#6fb6c8";
  return "#56626c";
}

export function SupplyBoard({ symbol, onSymbol, onOpen, compact }: { symbol: string; onSymbol: (s: string) => void; onOpen: (action: string) => void; compact?: boolean }) {
  const [chain, setChain] = useState<Chain | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(false);

  useEffect(() => {
    api<{ items: string[] }>("/api/markets/supply").then((r) => setList(r.items)).catch(() => null);
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api<Chain>(`/api/markets/supply/${encodeURIComponent(symbol)}`)
      .then((res) => {
        if (cancel) return;
        setChain(res);
        const top = (res.nodes || []).filter((n) => n.priced && n.corr != null).sort((a, b) => (b.corr || 0) - (a.corr || 0)).slice(0, 3).map((n) => n.symbol);
        setPicked([...top, res.focus?.index].filter(Boolean) as string[]);
      })
      .catch((err: Error) => { if (!cancel) setChain({ ok: false, error: err.message } as Chain); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [symbol]);

  const suppliers = (chain?.nodes || []).filter((n) => n.role === "supplier");
  const customers = (chain?.nodes || []).filter((n) => n.role !== "supplier");

  const chart = useMemo(() => {
    if (!chain?.ok) return null;
    const lines = [chain.symbol, ...picked].filter((s, i, a) => a.indexOf(s) === i && chain.series[s]?.length);
    const all = lines.flatMap((s) => chain.series[s].map((p) => p[1]));
    if (!all.length) return null;
    const lo = Math.min(...all, 0);
    const hi = Math.max(...all, 0);
    const days = [...new Set(lines.flatMap((s) => chain.series[s].map((p) => p[0])))].sort();
    const W = 640;
    const H = 180;
    const x = (d: string) => (days.indexOf(d) / Math.max(1, days.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / Math.max(1e-6, hi - lo)) * H;
    return {
      W, H, zero: y(0), lo, hi, first: days[0], last: days.at(-1),
      paths: lines.map((s, i) => ({
        s,
        color: s === chain.symbol ? "#f2efe6" : PALETTE[i % PALETTE.length],
        d: chain.series[s].map((p, j) => `${j ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(""),
        end: chain.series[s].at(-1)?.[1] ?? 0
      }))
    };
  }, [chain, picked]);

  function toggle(s: string) {
    setPicked((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  const graph = chain?.ok ? (() => {
    const rows = Math.max(suppliers.length, customers.length, 1);
    const H = Math.max(160, rows * 26 + 20);
    const W = 640;
    const cx = W / 2;
    const cy = H / 2;
    const at = (i: number, n: number) => 14 + ((i + 0.5) * (H - 28)) / Math.max(1, n);
    return (
      <svg className="sc-graph" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ height: H }} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Supply chain for ${chain.symbol}`}>
        {suppliers.map((n, i) => <line key={`l-${n.symbol}`} x1={150} y1={at(i, suppliers.length)} x2={cx - 44} y2={cy} stroke={corrColor(n.corr)} strokeWidth={picked.includes(n.symbol) ? 2 : 1} />)}
        {customers.map((n, i) => <line key={`r-${n.symbol}`} x1={cx + 44} y1={cy} x2={W - 150} y2={at(i, customers.length)} stroke={corrColor(n.corr)} strokeWidth={picked.includes(n.symbol) ? 2 : 1} strokeDasharray="4 3" />)}
        <rect x={cx - 44} y={cy - 18} width={88} height={36} className="sc-focus" />
        <text x={cx} y={cy - 2} textAnchor="middle" className="sc-focus-t">{chain.symbol}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="sc-sub">{signed(chain.focus.ret, 1, "%")} 6mo</text>
        {suppliers.map((n, i) => (
          <g key={n.symbol} className={picked.includes(n.symbol) ? "sc-node on" : "sc-node"} onClick={() => toggle(n.symbol)}>
            <title>{`${n.name} · ${n.what}\nBasis: ${n.basis}\nCorr ${n.corr?.toFixed(2) ?? "—"} · ${n.market} · ${n.index}`}</title>
            <text x={146} y={at(i, suppliers.length) + 4} textAnchor="end">{n.symbol} <tspan className="sc-sub">{n.corr == null ? "—" : n.corr.toFixed(2)}</tspan></text>
          </g>
        ))}
        {customers.map((n, i) => (
          <g key={n.symbol} className={picked.includes(n.symbol) ? "sc-node on" : "sc-node"} onClick={() => toggle(n.symbol)}>
            <title>{`${n.name} · ${n.what}\nBasis: ${n.basis}\nCorr ${n.corr?.toFixed(2) ?? "—"} · ${n.market} · ${n.index}`}</title>
            <text x={W - 146} y={at(i, customers.length) + 4}>{n.symbol} <tspan className="sc-sub">{n.corr == null ? "—" : n.corr.toFixed(2)}</tspan></text>
          </g>
        ))}
        <text x={8} y={12} className="sc-sub">SUPPLIERS</text>
        <text x={W - 8} y={12} textAnchor="end" className="sc-sub">CUSTOMERS / CHANNELS</text>
      </svg>
    );
  })() : null;

  return (
    <div className={compact ? "board supply compact" : "board supply"}>
      <header className="board-head">
        <div className="board-title">
          <strong>SUPPLY CHAIN</strong>
          <span>{chain?.ok ? `${chain.name} · ${suppliers.length} suppliers · ${customers.length} customers · home ${chain.focus.index}${chain.focus.etf ? ` / ${chain.focus.etf}` : ""}` : loading ? "Loading…" : chain?.error || ""}</span>
          <label className="theater">
            <select value={symbol} onChange={(e) => onSymbol(e.target.value)} aria-label="Supply chain symbol">
              {(list.includes(symbol) ? list : [symbol, ...list]).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {compact ? (
          <p className="sc-src1">
            <span title={chain?.source}><em>AS OF</em> {when(chain?.asOf)} UTC · <em>SOURCE</em> {chain?.source || "Curated filings"}</span>
            <button className="sc-info" aria-expanded={info} aria-label="Source and method notes" title="Source and method notes" onClick={() => setInfo((v) => !v)}>i</button>
          </p>
        ) : null}
        {!compact || info ? (
          <>
            <p><em>SOURCE</em> {chain?.source || "Curated filings"} · <em>AS OF</em> {when(chain?.asOf)} UTC</p>
            <p><em>NOTE</em> {chain?.latency || "Edges are curated from filings; prices are daily closes."}</p>
          </>
        ) : null}
      </header>
      {chain && !chain.ok ? <p className="tape-empty">{chain.error} {chain.available ? `Curated: ${chain.available.join(", ")}.` : ""}</p> : null}
      {chain?.ok ? (
        <div className="board-scroll sc-body">
          {graph}
          <section className="sc-segments">
            <h3>Revenue lines → inputs <small>segment names from the latest 10-K</small></h3>
            {chain.segments.map((seg) => (
              <p key={seg.name}>
                <b>{seg.name}</b>
                {seg.inputs.length ? seg.inputs.map((s) => (
                  <button key={s} className={picked.includes(s) ? "chip on" : "chip"} onClick={() => toggle(s)}>{s}</button>
                )) : <span className="sc-sub">no disclosed external input</span>}
              </p>
            ))}
          </section>
          {chart ? (
            <section className="sc-chart">
              <h3>Moving together · rebased % over 6 months <small>click symbols to add or remove</small></h3>
              <svg viewBox={`0 0 ${chart.W + 70} ${chart.H + 16}`} preserveAspectRatio="none" style={{ height: 200 }}>
                <line x1={0} x2={chart.W} y1={chart.zero} y2={chart.zero} className="sc-zero" />
                {chart.paths.map((p) => <path key={p.s} d={p.d} stroke={p.color} fill="none" strokeWidth={p.s === chain.symbol ? 2 : 1.2} vectorEffect="non-scaling-stroke" />)}
                {chart.paths.map((p, i) => <text key={`t-${p.s}`} x={chart.W + 4} y={12 + i * 12} fill={p.color} className="sc-legend">{p.s} {signed(p.end, 1, "%")}</text>)}
                <text x={0} y={chart.H + 14} className="sc-sub">{chart.first}</text>
                <text x={chart.W} y={chart.H + 14} textAnchor="end" className="sc-sub">{chart.last}</text>
              </svg>
              <p className="sc-strip">
                {chain.indices.map((ix) => (
                  <button key={ix.symbol} className={picked.includes(ix.symbol) ? "chip on" : "chip"} onClick={() => toggle(ix.symbol)} title={`Corr with ${chain.symbol}: ${ix.corr?.toFixed(2) ?? "—"}`}>
                    {ix.symbol} <small className={tone(ix.ret)}>{signed(ix.ret, 1, "%")}</small>
                  </button>
                ))}
              </p>
            </section>
          ) : null}
          <table>
            <thead>
              <tr><th>Sym</th><th>Company</th><th>Role</th><th>What</th><th>Market</th><th>Index</th><th>ETF</th><th>Corr</th><th>Beta</th><th>6mo</th><th>Basis</th></tr>
            </thead>
            <tbody>
              {chain.nodes.map((n) => (
                <tr key={`${n.role}-${n.symbol}`} onClick={() => (n.joined ? onOpen(`pos:${n.symbol}`) : toggle(n.symbol))} className={picked.includes(n.symbol) ? "picked" : undefined}>
                  <td>{n.symbol}</td>
                  <td className="board-name">{n.name}</td>
                  <td className="board-name">{n.role}</td>
                  <td className="board-name">{n.what}</td>
                  <td className="board-name">{n.market}</td>
                  <td><button className="linkish" onClick={(e) => { e.stopPropagation(); toggle(n.index); }}>{n.index}</button></td>
                  <td>{n.etf ? <button className="linkish" onClick={(e) => { e.stopPropagation(); toggle(n.etf); }}>{n.etf}</button> : "—"}</td>
                  <td style={{ color: corrColor(n.corr) }}>{n.corr == null ? "—" : n.corr.toFixed(2)}</td>
                  <td>{n.beta == null ? "—" : n.beta.toFixed(2)}</td>
                  <td className={tone(n.ret)}>{signed(n.ret, 1, "%")}</td>
                  <td className="board-name sc-basis">{n.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
