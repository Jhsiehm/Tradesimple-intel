import { useMemo, useRef, useState } from "react";

type Point = { d: string; s: number | null; b: number | null };

const W = 760;
const H = 260;
const PAD = { l: 52, r: 12, t: 12, b: 24 };

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;

/** Strategy and benchmark as growth of 1, in percent. Hover reads both on a day. */
export function EquityChart({ curve, benchmark }: { curve: Point[]; benchmark: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<number | null>(null);
  const geo = useMemo(() => {
    const pts = curve.filter((p) => p.s != null && p.b != null) as { d: string; s: number; b: number }[];
    if (pts.length < 2) return null;
    const vals = pts.flatMap((p) => [p.s - 1, p.b - 1, 0]);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const span = Math.max(0.02, hi - lo);
    lo -= span * 0.06;
    hi += span * 0.06;
    const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const line = (key: "s" | "b") => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[key] - 1).toFixed(1)}`).join("");
    const step = niceStep(hi - lo);
    const ticks: number[] = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
    const months = pts.flatMap((p, i) => (p.d.slice(8, 10) === "01" || i === 0 ? [{ i, label: p.d.slice(0, 7) }] : [])).filter((_, k, all) => all.length <= 8 || k % Math.ceil(all.length / 8) === 0);
    return { pts, x, y, s: line("s"), b: line("b"), ticks, months };
  }, [curve]);

  if (!geo) return <p className="bt-empty">Not enough days to draw a curve.</p>;
  const hover = at == null ? null : geo.pts[at];
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (geo.pts.length - 1));
    setAt(Math.max(0, Math.min(geo.pts.length - 1, i)));
  };
  return (
    <figure className="bt-chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Strategy against ${benchmark}, growth since the first entry`} onPointerMove={move} onPointerLeave={() => setAt(null)}>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} className={t === 0 ? "zero" : "grid"} />
            <text x={PAD.l - 6} y={geo.y(t) + 3} textAnchor="end">{pct(t)}</text>
          </g>
        ))}
        {geo.months.map((m) => <text key={m.label} x={geo.x(m.i)} y={H - 6} textAnchor="middle">{m.label}</text>)}
        <path d={geo.b} className="bench" />
        <path d={geo.s} className="strat" />
        {hover && at != null ? (
          <g>
            <line x1={geo.x(at)} x2={geo.x(at)} y1={PAD.t} y2={H - PAD.b} className="cross" />
            <circle cx={geo.x(at)} cy={geo.y(hover.s - 1)} r={3} className="dot-s" />
            <circle cx={geo.x(at)} cy={geo.y(hover.b - 1)} r={3} className="dot-b" />
          </g>
        ) : null}
      </svg>
      <figcaption>
        <span className="key s">Strategy{hover ? ` ${pct(hover.s - 1)}` : ""}</span>
        <span className="key b">{benchmark === "SECTOR" ? "Sector ETFs" : benchmark}{hover ? ` ${pct(hover.b - 1)}` : ""}</span>
        <span className="when">{hover ? hover.d : `${geo.pts[0].d} → ${geo.pts.at(-1)!.d}`}</span>
      </figcaption>
    </figure>
  );
}

function niceStep(range: number) {
  const raw = range / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
}
