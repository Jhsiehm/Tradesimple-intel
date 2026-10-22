import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ResearchFigure } from "../../../shared/researchFigures.mjs";
import { categoricalRows, figureDateMs, formatValue, type FigureRow } from "./model";

type Props = {
  figure: ResearchFigure;
  rows: FigureRow[];
  selected: string;
  view: "bar" | "dot" | "line" | "scatter";
  onSelect: (key: string) => void;
};

const extent = (values: number[], zero = false): [number, number] => {
  let lo = Math.min(...values, ...(zero ? [0] : []));
  let hi = Math.max(...values, ...(zero ? [0] : []));
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  return [lo, hi];
};
const scale = (value: number, [lo, hi]: [number, number], a: number, b: number) =>
  a + ((value - lo) / (hi - lo)) * (b - a);
const short = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** SVG exposes selectable data points; table below carries exact values and provenance. */
export function FigurePlot({ figure, rows, selected, view, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const title = useId();
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(260, Math.round(element.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const categorical = view === "bar" || view === "dot";
  const shown = categorical ? categoricalRows(rows).slice(0, 80) : rows;
  const finite = shown.filter((row) => row.point.y != null && Number.isFinite(row.point.y));
  const [left, right, top, bottom] = categorical
    ? [Math.min(142, width * 0.35), width - 24, 16, 36]
    : [58, width - 22, 18, 44];
  const height = categorical ? Math.max(150, shown.length * 28 + top + bottom) : 240;
  const base = height - bottom;
  const yDomain = finite.length
    ? extent(
        finite.map((r) => r.point.y!),
        categorical,
      )
    : ([0, 1] as [number, number]);
  const xValue = (row: FigureRow) => (view === "line" ? (figureDateMs(row.point.x) ?? NaN) : Number(row.point.x));
  const numericX = finite.filter((row) => Number.isFinite(xValue(row)));
  const xDomain = numericX.length ? extent(numericX.map(xValue)) : ([0, 1] as [number, number]);
  const x = (row: FigureRow) =>
    categorical ? scale(row.point.y ?? 0, yDomain, left, right) : scale(xValue(row), xDomain, left, right);
  const y = (row: FigureRow, index: number) =>
    categorical ? top + index * 28 + 12 : scale(row.point.y ?? 0, yDomain, base, top);
  const zero = scale(0, yDomain, left, right);
  const selectable = shown.filter((r) => r.point.y != null && (categorical || Number.isFinite(xValue(r))));
  const active = selectable.some((r) => r.key === selected) ? selected : selectable[0]?.key;
  const keyboard = (event: KeyboardEvent<SVGGElement>, key: string) => {
    const index = selectable.findIndex((r) => r.key === key);
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? selectable.length - 1
          : direction
            ? Math.max(0, Math.min(selectable.length - 1, index + direction))
            : -1;
    if (next >= 0) {
      event.preventDefault();
      onSelect(selectable[next].key);
      svg.current?.querySelector<SVGElement>(`[data-point="${selectable[next].key}"]`)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(key);
    }
  };
  const ticks = Array.from({ length: 5 }, (_, i) => yDomain[0] + ((yDomain[1] - yDomain[0]) * i) / 4);
  const series = [...new Set(shown.map((r) => r.seriesId))];
  const linePath = (id: string) => {
    let start = true;
    return shown
      .filter((r) => r.seriesId === id)
      .sort((a, b) => xValue(a) - xValue(b))
      .map((row) => {
        if (row.point.y == null || !Number.isFinite(xValue(row))) {
          start = true;
          return "";
        }
        const command = `${start ? "M" : "L"}${x(row)},${y(row, 0)}`;
        start = false;
        return command;
      })
      .join(" ");
  };

  return (
    <div className="rf-plot" ref={host}>
      <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={title}>
        <title id={title}>
          {figure.title}. {figure.yLabel}. Use arrow keys to inspect data points.
        </title>
        {ticks.map((tick, i) => {
          const at = categorical ? scale(tick, yDomain, left, right) : scale(tick, yDomain, base, top);
          return (
            <g key={i} className="rf-grid">
              <line
                x1={categorical ? at : left}
                x2={categorical ? at : right}
                y1={categorical ? top : at}
                y2={categorical ? base : at}
              />
              <text
                x={categorical ? at : left - 8}
                y={categorical ? base + 18 : at + 4}
                textAnchor={categorical ? "middle" : "end"}
              >
                {formatValue(tick, figure, true)}
              </text>
            </g>
          );
        })}
        {categorical ? <line className="rf-zero" x1={zero} x2={zero} y1={top} y2={base} /> : null}
        {view === "line"
          ? series.map((id) => (
              <path
                key={id}
                d={linePath(id)}
                stroke={shown.find((r) => r.seriesId === id)?.color}
                className="rf-line"
              />
            ))
          : null}
        {shown.map((row, index) => {
          const p = row.point;
          const valid = p.y != null && Number.isFinite(p.y) && (categorical || Number.isFinite(xValue(row)));
          const px = x(row),
            py = y(row, index);
          const label = `${row.series}: ${p.label}, ${formatValue(p.y, figure)}${p.detail ? `. ${p.detail}` : ""}`;
          return (
            <g key={row.key}>
              {categorical ? (
                <text className="rf-category" x={left - 10} y={py + 4} textAnchor="end">
                  <title>
                    {p.label} · {row.series}
                  </title>
                  {short(p.label, width < 420 ? 15 : 21)}
                </text>
              ) : null}
              {valid ? (
                <g
                  role="button"
                  tabIndex={row.key === active ? 0 : -1}
                  data-point={row.key}
                  aria-label={label}
                  aria-pressed={selected === row.key}
                  className={`rf-point${selected === row.key ? " is-selected" : ""}`}
                  onFocus={() => onSelect(row.key)}
                  onPointerEnter={() => onSelect(row.key)}
                  onClick={() => onSelect(row.key)}
                  onKeyDown={(event) => keyboard(event, row.key)}
                >
                  <title>{label}</title>
                  {view === "bar" ? (
                    <rect
                      x={Math.min(px, zero)}
                      y={py - 5}
                      width={Math.max(1, Math.abs(px - zero))}
                      height={10}
                      fill={row.color}
                      className="rf-bar"
                    />
                  ) : (
                    <circle cx={px} cy={py} r={selected === row.key ? 5 : 3.5} fill={row.color} />
                  )}
                  <rect
                    className="rf-hit"
                    x={categorical ? left : px - 13}
                    y={py - 13}
                    width={categorical ? right - left : 26}
                    height={26}
                    rx={2}
                  />
                </g>
              ) : categorical ? (
                <text className="rf-missing" x={left + 8} y={py + 4}>
                  Missing
                </text>
              ) : null}
            </g>
          );
        })}
        {!categorical
          ? [xDomain[0], xDomain[1]].map((value, i) => (
              <text className="rf-axis" key={i} x={i ? right : left} y={base + 20} textAnchor={i ? "end" : "start"}>
                {view === "line"
                  ? new Date(value).toISOString().slice(0, 10)
                  : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)}
              </text>
            ))
          : null}
      </svg>
      {categorical && shown.length < rows.length ? (
        <p className="rf-notice">
          Plot limited to {shown.length} of {rows.length} displayed rows. The data table and CSV include all displayed
          rows.
        </p>
      ) : null}
    </div>
  );
}
