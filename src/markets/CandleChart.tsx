import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { api } from "../lib/api";
import { when } from "../lib/format";
import type { ChartMark, MarkTone } from "../types";

export type ChartSpan = "1m" | "5m" | "15m" | "1h" | "1d" | "6mo" | "1y" | "5y";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

type ChartPayload = {
  ok: boolean;
  error?: string;
  source?: string;
  asOf?: string;
  latency?: string;
  symbol: string;
  code?: string;
  kind?: "equity" | "fx" | "crypto";
  digits?: number;
  name: string;
  range: string;
  interval?: string;
  exchange?: string;
  last: number;
  previousClose: number;
  dayHigh?: number | null;
  dayLow?: number | null;
  dayVolume?: number | null;
  yearHigh?: number | null;
  yearLow?: number | null;
  bars: Bar[];
};

type Layer = "trades" | "earn" | "lobby" | "pac" | "gov" | "fomc" | "cpi" | "macro";

const SPANS: { id: ChartSpan; label: string }[] = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1H" },
  { id: "1d", label: "1D" },
  { id: "6mo", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "5y", label: "5Y" }
];

const MARK_COLOR: Record<MarkTone, string> = {
  buy: "#8fbf6a",
  sell: "#e07a72",
  file: "#d6a84a",
  earn: "#b48ee8",
  lobby: "#5fb8c2",
  pac: "#e8955a",
  gov: "#c7cf6e",
  fomc: "#e7e2d6",
  cpi: "#e86f9c",
  macro: "#8e9488"
};

const LAYERS: { id: Layer; label: string; color: string; equityOnly?: boolean; source: string }[] = [
  { id: "trades", label: "Trades", color: MARK_COLOR.buy, equityOnly: true, source: "Disclosed trades and filing dates" },
  { id: "earn", label: "Earnings", color: MARK_COLOR.earn, equityOnly: true, source: "SEC 8-K item 2.02 · Nasdaq schedule" },
  { id: "lobby", label: "Lobbying", color: MARK_COLOR.lobby, equityOnly: true, source: "LDA.gov filings by post date" },
  { id: "pac", label: "PAC", color: MARK_COLOR.pac, equityOnly: true, source: "FEC committee-to-candidate gifts, monthly" },
  { id: "gov", label: "Contracts", color: MARK_COLOR.gov, equityOnly: true, source: "USAspending largest prime awards" },
  { id: "fomc", label: "Fed / CB", color: MARK_COLOR.fomc, source: "FOMC decisions and central-bank rate prints" },
  { id: "cpi", label: "CPI / PCE", color: MARK_COLOR.cpi, source: "Inflation prints (Nasdaq calendar)" },
  { id: "macro", label: "Macro", color: MARK_COLOR.macro, source: "Jobs, GDP, activity prints" }
];

const COMPARE: { symbol: string; label: string }[] = [
  { symbol: "DX-Y.NYB", label: "DXY" },
  { symbol: "EURUSD=X", label: "EUR/USD" },
  { symbol: "USDJPY=X", label: "USD/JPY" },
  { symbol: "GBPUSD=X", label: "GBP/USD" },
  { symbol: "USDCNY=X", label: "USD/CNY" },
  { symbol: "BTC-USD", label: "BTC" },
  { symbol: "ETH-USD", label: "ETH" },
  { symbol: "AAPL", label: "AAPL" },
  { symbol: "MSFT", label: "MSFT" },
  { symbol: "NVDA", label: "NVDA" },
  { symbol: "LMT", label: "LMT" }
];

const DEFAULT_LAYERS: Layer[] = ["trades", "earn", "lobby", "pac", "gov", "fomc", "cpi"];
const COMPARE_COLOR = "#a3b8ff";
const DAY = 86400000;

function layerOf(tone?: MarkTone): Layer {
  if (!tone || tone === "buy" || tone === "sell" || tone === "file") return "trades";
  return tone;
}

function loadLayers(): Set<Layer> {
  try {
    const raw = JSON.parse(localStorage.getItem("intel:chart-layers") || "null");
    if (Array.isArray(raw)) return new Set(raw as Layer[]);
  } catch {
    /* ignore */
  }
  return new Set(DEFAULT_LAYERS);
}

export function CandleChart({
  symbol,
  span,
  onSpan,
  onBack,
  marks = []
}: {
  symbol: string;
  span: ChartSpan;
  onSpan: (span: ChartSpan) => void;
  onBack: () => void;
  marks?: ChartMark[];
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [chart, setChart] = useState<ChartPayload | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [events, setEvents] = useState<ChartMark[]>([]);
  const [eventSource, setEventSource] = useState("");
  const [layers, setLayers] = useState<Set<Layer>>(loadLayers);
  const [compare, setCompare] = useState("");
  const [compareChart, setCompareChart] = useState<ChartPayload | null>(null);

  useEffect(() => {
    let cancel = false;
    setError("");
    api<ChartPayload>(`/api/markets/chart?symbol=${encodeURIComponent(symbol)}&span=${span}`)
      .then((res) => {
        if (cancel) return;
        if (!res.ok) {
          setChart(null);
          setError(res.error || "No chart");
          return;
        }
        setChart(res);
      })
      .catch((err: Error) => {
        if (!cancel) {
          setChart(null);
          setError(err.message);
        }
      });
    return () => {
      cancel = true;
    };
  }, [symbol, span]);

  useEffect(() => {
    let cancel = false;
    setEvents([]);
    api<{ ok: boolean; source?: string; marks: ChartMark[] }>(`/api/markets/events?symbol=${encodeURIComponent(symbol)}`)
      .then((res) => {
        if (cancel || !res.ok) return;
        setEvents(res.marks || []);
        setEventSource(res.source || "");
      })
      .catch(() => null);
    return () => {
      cancel = true;
    };
  }, [symbol]);

  useEffect(() => {
    if (!compare || compare === symbol) {
      setCompareChart(null);
      return;
    }
    let cancel = false;
    api<ChartPayload>(`/api/markets/chart?symbol=${encodeURIComponent(compare)}&span=${span}`)
      .then((res) => { if (!cancel) setCompareChart(res.ok ? res : null); })
      .catch(() => { if (!cancel) setCompareChart(null); });
    return () => {
      cancel = true;
    };
  }, [compare, symbol, span]);

  useEffect(() => {
    localStorage.setItem("intel:chart-layers", JSON.stringify([...layers]));
  }, [layers]);

  const bars = chart?.bars || [];
  const interval = chart?.interval || "1d";
  const daily = interval === "1d";
  const digits = chart?.digits ?? 2;
  const kind = chart?.kind || (/=X$|^DX-Y/.test(symbol) ? "fx" : /-USD$/.test(symbol) ? "crypto" : "equity");
  const p = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits));
  const stats = useMemo(() => summarize(bars, daily), [bars, daily]);

  const available = LAYERS.filter((l) => kind === "equity" || !l.equityOnly || (l.id === "trades" && marks.length));
  const allMarks = useMemo(
    () => [...marks, ...events].filter((m) => layers.has(layerOf(m.tone))).sort((a, b) => a.t - b.t),
    [marks, events, layers]
  );
  const placed = useMemo(() => place(bars, allMarks, daily), [bars, allMarks, daily]);
  const compareLine = useMemo(() => rebase(bars, compareChart?.bars || [], daily), [bars, compareChart, daily]);
  const counts = useMemo(() => {
    const c: Partial<Record<Layer, number>> = {};
    for (const m of [...marks, ...events]) c[layerOf(m.tone)] = (c[layerOf(m.tone)] || 0) + 1;
    return c;
  }, [marks, events]);

  useEffect(() => {
    const plot = plotRef.current;
    const canvas = canvasRef.current;
    if (!plot || !canvas || !bars.length) return;

    const draw = () => {
      const width = plot.clientWidth;
      const height = plot.clientHeight;
      if (width < 10 || height < 10) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, width, height, bars, hover, interval, placed, stats.overlays, compareLine, digits);
    };

    draw();
    const frame = requestAnimationFrame(draw);
    const observer = new ResizeObserver(draw);
    observer.observe(plot);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [bars, hover, interval, placed, stats, compareLine, digits]);

  const last = chart?.last ?? bars[bars.length - 1]?.c;
  const prev = stats.prevClose ?? chart?.previousClose;
  const change = last != null && prev ? last - prev : 0;
  const pct = prev ? (change / prev) * 100 : 0;
  const up = change >= 0;
  const first = bars[0]?.c;
  const spanChange = last != null && first ? ((last - first) / first) * 100 : null;
  const hovered = hover != null ? bars[hover] : null;
  const hoverMarks = hover != null ? placed.filter((m) => m.index === hover).map((m) => m.mark) : [];
  const inSpan = placed.map((m) => m.mark);
  const recent = [...inSpan].reverse().slice(0, 14);
  const outside = allMarks.length - inSpan.length;
  const compareLabel = COMPARE.find((c) => c.symbol === compare)?.label || compare;
  const compareFirst = compareChart?.bars[0]?.c;
  const compareLast = compareChart?.bars[compareChart.bars.length - 1]?.c;
  const compareChange = compareFirst && compareLast ? ((compareLast - compareFirst) / compareFirst) * 100 : null;

  function onMove(event: MouseEvent<HTMLDivElement>) {
    const plot = plotRef.current;
    if (!bars.length || !plot) return;
    const rect = plot.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const { left, right } = pad(rect.width);
    const slot = (right - left) / bars.length;
    const index = Math.min(bars.length - 1, Math.max(0, Math.floor((x - left) / slot)));
    setHover(index);
  }

  function toggle(layer: Layer) {
    setLayers((current) => {
      const next = new Set(current);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }

  const cells: [string, string][] = [
    ["Open", p(stats.open)],
    ["High", p(chart?.dayHigh ?? stats.dayHigh)],
    ["Low", p(chart?.dayLow ?? stats.dayLow)],
    ["Prev", p(prev)],
    ...(kind === "fx" ? [] : ([["Volume", compact(chart?.dayVolume ?? stats.dayVolume)], ["Avg vol", compact(stats.avgVolume)]] as [string, string][])),
    [`${span.toUpperCase()} hi`, p(stats.spanHigh)],
    [`${span.toUpperCase()} lo`, p(stats.spanLow)],
    ["52w", chart?.yearLow != null && chart?.yearHigh != null ? `${p(chart.yearLow)}–${p(chart.yearHigh)}` : "—"],
    ...(daily
      ? ([["MA20", p(stats.ma20)], ["MA50", p(stats.ma50)]] as [string, string][])
      : kind === "fx"
        ? ([["Bars", String(bars.length || "—")]] as [string, string][])
        : ([["VWAP", p(stats.vwap)], ["Bars", String(bars.length || "—")]] as [string, string][]))
  ];

  return (
    <div className="tape">
      <header className="tape-head">
        <div>
          <button className="ghost" onClick={onBack}>Board</button>
          <strong>{chart?.code || chart?.symbol || symbol}</strong>
          <span>{chart?.name || "Loading tape"}{chart?.exchange ? ` · ${chart.exchange}` : ""}{kind !== "equity" ? ` · ${kind === "fx" ? "FX" : "Crypto"}` : ""}</span>
        </div>
        <div className="tape-px">
          <b>{last != null ? p(last) : "—"}</b>
          <em className={up ? "up" : "down"}>{last != null ? `${up ? "+" : ""}${change.toFixed(digits)}  ${up ? "+" : ""}${pct.toFixed(2)}% day` : ""}</em>
          {spanChange != null ? <small>{span.toUpperCase()} {spanChange >= 0 ? "+" : ""}{spanChange.toFixed(1)}%</small> : null}
        </div>
        <div className="tape-ranges">
          {SPANS.map((item) => (
            <button key={item.id} aria-pressed={span === item.id} onClick={() => onSpan(item.id)}>{item.label}</button>
          ))}
        </div>
      </header>
      <dl className="tape-stats">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="tape-layers">
        <em>OVERLAYS</em>
        {available.map((l) => (
          <button key={l.id} aria-pressed={layers.has(l.id)} onClick={() => toggle(l.id)} title={l.source}>
            <i style={{ background: l.color }} />
            {l.label}
            <small>{l.id === "trades" ? marks.length || "" : counts[l.id] || ""}</small>
          </button>
        ))}
        <label className="tape-compare">
          <em>VS</em>
          <select value={compare} onChange={(e) => setCompare(e.target.value)} aria-label="Compare with">
            <option value="">None</option>
            {COMPARE.filter((c) => c.symbol !== symbol).map((c) => <option key={c.symbol} value={c.symbol}>{c.label}</option>)}
          </select>
        </label>
      </div>
      <div
        className="tape-plot"
        ref={plotRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} />
        {hovered ? (
          <div className="tape-readout">
            <p>
              <span>{axisStamp(hovered.t, interval)}</span>
              <span>O {p(hovered.o)}</span>
              <span>H {p(hovered.h)}</span>
              <span>L {p(hovered.l)}</span>
              <span>C {p(hovered.c)}</span>
              {kind === "fx" ? null : <span>V {compact(hovered.v)}</span>}
              {compareLine[hover!] != null && compareChart ? <span style={{ color: COMPARE_COLOR }}>{compareLabel} {compareRaw(compareChart.bars, hovered.t, daily)}</span> : null}
            </p>
            {hoverMarks.slice(0, 5).map((m, i) => (
              <p key={i} className="readout-mark" style={{ color: MARK_COLOR[m.tone || "file"] }}>
                {m.label}{m.detail ? <small> · {m.detail}</small> : null}
              </p>
            ))}
          </div>
        ) : (
          <p className="tape-readout legend-line">
            {daily ? (
              <>
                <span><i style={{ background: "#d6a84a" }} />MA20</span>
                <span><i style={{ background: "#7fa3c4" }} />MA50</span>
              </>
            ) : kind === "fx" ? null : (
              <span><i style={{ background: "#7fa3c4" }} />VWAP by session</span>
            )}
            {compareChart ? <span><i style={{ background: COMPARE_COLOR }} />{compareLabel} rebased {compareChange != null ? `${compareChange >= 0 ? "+" : ""}${compareChange.toFixed(1)}%` : ""}</span> : null}
            <span className="dim">hover a bar for events</span>
          </p>
        )}
        {error ? <p className="tape-empty">{error}</p> : null}
      </div>
      {allMarks.length ? (
        <p className="tape-marks">
          <em>EVENTS</em>
          {recent.map((m, i) => {
            const text = `${new Date(m.t).toISOString().slice(0, 10)} ${m.label}`;
            return m.href ? (
              <a key={`${m.t}-${i}`} href={m.href} target="_blank" rel="noreferrer" title={m.detail} style={{ color: MARK_COLOR[m.tone || "file"] }}>{text}</a>
            ) : (
              <span key={`${m.t}-${i}`} title={m.detail} style={{ color: MARK_COLOR[m.tone || "file"] }}>{text}</span>
            );
          })}
          {outside > 0 ? <span className="dim">{outside} outside this span{span === "5y" ? " (older or scheduled)" : span === "1y" ? " · try 5Y" : daily ? " · try 1Y or 5Y" : " · try 6M+"}</span> : null}
        </p>
      ) : null}
      <p className="tape-src">
        <em>SOURCE</em> {chart?.source || "Yahoo Finance chart"}{eventSource ? ` · events: ${eventSource}` : ""}
        <em>AS OF</em> {when(chart?.asOf)}
        <em>NOTE</em> {chart?.latency || "Daily bars, delayed."}
      </p>
    </div>
  );
}

type Overlay = { color: string; values: (number | null)[] };
type Placed = { mark: ChartMark; index: number };

function place(bars: Bar[], marks: ChartMark[], daily: boolean): Placed[] {
  if (!bars.length) return [];
  const slack = daily ? 4 * DAY : DAY;
  const out: Placed[] = [];
  const first = bars[0].t - slack;
  const lastT = bars[bars.length - 1].t + slack;
  let j = 0;
  for (const mark of marks) {
    if (mark.t < first || mark.t > lastT) continue;
    while (j < bars.length - 1 && Math.abs(bars[j + 1].t - mark.t) <= Math.abs(bars[j].t - mark.t)) j += 1;
    if (Math.abs(bars[j].t - mark.t) > slack) continue;
    out.push({ mark, index: j });
  }
  return out;
}

function rebase(bars: Bar[], other: Bar[], daily: boolean): (number | null)[] {
  if (!bars.length || !other.length) return [];
  const slack = daily ? 4 * DAY : 30 * 60000;
  const aligned: (number | null)[] = [];
  let j = 0;
  for (const bar of bars) {
    while (j < other.length - 1 && other[j + 1].t <= bar.t) j += 1;
    aligned.push(Math.abs(other[j].t - bar.t) <= slack || (other[j].t <= bar.t && bar.t - other[j].t <= slack) ? other[j].c : null);
  }
  const startIdx = aligned.findIndex((v) => v != null);
  if (startIdx < 0) return [];
  const base = aligned[startIdx] as number;
  const anchor = bars[startIdx].c;
  return aligned.map((v) => (v == null ? null : (v / base) * anchor));
}

function compareRaw(other: Bar[], t: number, daily: boolean) {
  let best: Bar | null = null;
  for (const bar of other) {
    if (bar.t > t + (daily ? DAY : 0)) break;
    best = bar;
  }
  if (!best) return "—";
  const v = best.c;
  return v >= 1000 ? v.toFixed(2) : v >= 10 ? v.toFixed(3) : v.toFixed(4);
}

function summarize(bars: Bar[], daily: boolean) {
  const empty = { open: null, dayHigh: null, dayLow: null, dayVolume: null, avgVolume: null, spanHigh: null, spanLow: null, ma20: null, ma50: null, vwap: null, prevClose: null, overlays: [] as Overlay[] };
  if (!bars.length) return empty;
  const closes = bars.map((b) => b.c);
  const sma = (n: number) => closes.map((_, i) => (i + 1 < n ? null : closes.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
  const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const lastDay = dayKey(bars[bars.length - 1].t);
  const session = daily ? [bars[bars.length - 1]] : bars.filter((b) => dayKey(b.t) === lastDay);
  const before = daily ? bars[bars.length - 2] : [...bars].reverse().find((b) => dayKey(b.t) !== lastDay);
  const vwap: (number | null)[] = [];
  let pv = 0;
  let vol = 0;
  let current = "";
  for (const bar of bars) {
    const key = dayKey(bar.t);
    if (key !== current) {
      current = key;
      pv = 0;
      vol = 0;
    }
    pv += ((bar.h + bar.l + bar.c) / 3) * bar.v;
    vol += bar.v;
    vwap.push(vol ? pv / vol : null);
  }
  const hasVolume = bars.some((b) => b.v > 0);
  const ma20 = sma(20);
  const ma50 = sma(50);
  const volumes = bars.map((b) => b.v).filter((v) => v > 0);
  return {
    open: session[0]?.o ?? null,
    dayHigh: Math.max(...session.map((b) => b.h)),
    dayLow: Math.min(...session.map((b) => b.l)),
    dayVolume: session.reduce((sum, b) => sum + b.v, 0),
    avgVolume: volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null,
    spanHigh: Math.max(...bars.map((b) => b.h)),
    spanLow: Math.min(...bars.map((b) => b.l)),
    ma20: ma20[ma20.length - 1],
    ma50: ma50[ma50.length - 1],
    vwap: hasVolume ? vwap[vwap.length - 1] : null,
    prevClose: before?.c ?? null,
    overlays: daily
      ? [{ color: "#d6a84a", values: ma20 }, { color: "#7fa3c4", values: ma50 }]
      : hasVolume ? [{ color: "#7fa3c4", values: vwap }] : []
  };
}

function pad(width: number) {
  const left = 28;
  const rightPad = 86;
  return { left, right: Math.max(left + 40, width - rightPad), top: 26, bottom: 36 };
}

function paint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bars: Bar[],
  hover: number | null,
  interval: string,
  placed: Placed[],
  overlays: Overlay[],
  compare: (number | null)[],
  digits: number
) {
  const { left, right, top, bottom } = pad(width);
  const plotW = Math.max(1, right - left);
  const plotH = Math.max(1, height - top - bottom);
  const hasVolume = bars.some((b) => b.v > 0);
  const volH = hasVolume ? Math.max(28, plotH * 0.18) : 0;
  const gap = hasVolume ? 10 : 0;
  const priceH = plotH - volH - gap;

  ctx.clearRect(0, 0, width, height);
  const compareVals = compare.filter((v): v is number => v != null);
  const max = Math.max(...bars.map((b) => b.h), ...compareVals);
  const min = Math.min(...bars.map((b) => b.l), ...compareVals);
  const span = max - min || 1;
  const yOf = (price: number) => top + ((max - price) / span) * priceH;
  const slot = plotW / bars.length;
  const bodyW = Math.max(1.25, Math.min(7, slot * 0.62));
  const maxVol = Math.max(...bars.map((b) => b.v), 1);
  const daily = interval === "1d";

  ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#232c34";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, height - bottom);
  ctx.lineTo(right, height - bottom);
  ctx.stroke();
  ctx.fillStyle = "#5c645c";
  ctx.textAlign = "right";
  ctx.fillText("TIME", right, height - 8);
  ctx.textAlign = "left";
  ctx.fillText("PRICE", right + 8, top - 14);

  const ticks = Math.max(3, Math.min(7, Math.floor(priceH / 48)));
  ctx.strokeStyle = "rgba(44, 53, 47, 0.75)";
  ctx.fillStyle = "#8e9488";
  for (let i = 0; i <= ticks; i += 1) {
    const y = top + (priceH * i) / ticks;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillText((max - (span * i) / ticks).toFixed(digits), right + 8, y);
  }
  if (hasVolume) {
    ctx.fillStyle = "#5c645c";
    ctx.fillText(`VOL ${compact(maxVol)}`, right + 8, height - bottom - volH + 6);
  }

  const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (!daily) {
    ctx.save();
    ctx.strokeStyle = "rgba(142, 148, 136, 0.22)";
    ctx.setLineDash([1, 4]);
    ctx.fillStyle = "#5c645c";
    ctx.textBaseline = "top";
    let prevKey = dayKey(bars[0].t);
    for (let i = 1; i < bars.length; i += 1) {
      const key = dayKey(bars[i].t);
      if (key === prevKey) continue;
      prevKey = key;
      const x = left + slot * i;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, height - bottom);
      ctx.stroke();
      ctx.fillText(key.slice(5), x + 3, top + 2);
    }
    ctx.restore();
  }

  const markStep = placed.length > 60 ? 0.18 : placed.length > 25 ? 0.3 : 0.5;
  for (const { mark, index } of placed) {
    const x = left + slot * index + slot / 2;
    ctx.save();
    ctx.globalAlpha = markStep;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = MARK_COLOR[mark.tone || "file"];
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + priceH);
    ctx.stroke();
    ctx.restore();
  }

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const x = left + slot * i + slot / 2;
    const rising = bar.c >= bar.o;
    const color = rising ? "#8fbf6a" : "#e07a72";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (hasVolume) {
      ctx.globalAlpha = 0.28;
      const vh = (bar.v / maxVol) * volH;
      ctx.fillRect(x - bodyW / 2, height - bottom - vh, bodyW, vh);
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x, yOf(bar.h));
    ctx.lineTo(x, yOf(bar.l));
    ctx.stroke();
    const y1 = yOf(Math.max(bar.o, bar.c));
    const y2 = yOf(Math.min(bar.o, bar.c));
    const h = Math.max(1, y2 - y1);
    if (rising) {
      ctx.strokeRect(x - bodyW / 2, y1, bodyW, h);
    } else {
      ctx.fillRect(x - bodyW / 2, y1, bodyW, h);
    }
  }

  const lines: Overlay[] = [...overlays, ...(compare.length ? [{ color: COMPARE_COLOR, values: compare }] : [])];
  for (const overlay of lines) {
    ctx.save();
    ctx.strokeStyle = overlay.color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = overlay.color === COMPARE_COLOR ? 1.5 : 1.25;
    ctx.beginPath();
    let started = false;
    let prevKey = "";
    const breaks = overlay.color !== COMPARE_COLOR && !daily;
    overlay.values.forEach((value, i) => {
      if (value == null) {
        started = false;
        return;
      }
      const key = breaks ? dayKey(bars[i].t) : "";
      const x = left + slot * i + slot / 2;
      const y = yOf(value);
      if (!started || key !== prevKey) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
      prevKey = key;
    });
    ctx.stroke();
    ctx.restore();
  }

  const last = bars[bars.length - 1];
  const lastY = yOf(last.c);
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "rgba(226, 182, 87, 0.85)";
  ctx.beginPath();
  ctx.moveTo(left, lastY);
  ctx.lineTo(right, lastY);
  ctx.stroke();
  ctx.restore();
  const tag = last.c.toFixed(digits);
  ctx.textBaseline = "middle";
  const tagW = ctx.measureText(tag).width + 10;
  ctx.fillStyle = "#e2b657";
  ctx.fillRect(right + 4, lastY - 8, tagW, 16);
  ctx.fillStyle = "#06080b";
  ctx.fillText(tag, right + 9, lastY);

  const labels = Math.max(2, Math.min(7, Math.floor(plotW / 120)));
  ctx.fillStyle = "#8e9488";
  ctx.textBaseline = "top";
  for (let i = 0; i <= labels; i += 1) {
    const index = Math.round(((bars.length - 1) * i) / labels);
    const x = left + slot * index + slot / 2;
    ctx.textAlign = i === 0 ? "left" : i === labels ? "right" : "center";
    ctx.fillText(axisStamp(bars[index].t, interval), i === 0 ? left : i === labels ? right : x, height - bottom + 8);
    ctx.strokeStyle = "#232c34";
    ctx.beginPath();
    ctx.moveTo(x, height - bottom);
    ctx.lineTo(x, height - bottom + 4);
    ctx.stroke();
  }
  ctx.textAlign = "left";

  const base = top + priceH;
  const stack = new Map<number, number>();
  for (const { mark, index } of placed) {
    const x = left + slot * index + slot / 2;
    const level = stack.get(index) || 0;
    stack.set(index, level + 1);
    if (level > 5) continue;
    const y = base - 4 - level * 7;
    ctx.fillStyle = MARK_COLOR[mark.tone || "file"];
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x - 3.5, y + 1);
    ctx.lineTo(x + 3.5, y + 1);
    ctx.closePath();
    ctx.fill();
  }

  const lanes: number[] = [];
  const maxLanes = placed.length > 40 ? 2 : 4;
  for (const { mark, index } of placed) {
    const x = left + slot * index + slot / 2;
    const text = mark.label.slice(0, 16);
    const w = ctx.measureText(text).width + 10;
    const lx = Math.min(x + 4, right - w);
    let lane = 0;
    while (lane < maxLanes && lanes[lane] != null && lx < lanes[lane]) lane += 1;
    if (lane >= maxLanes) continue;
    lanes[lane] = lx + w;
    ctx.fillStyle = MARK_COLOR[mark.tone || "file"];
    ctx.textBaseline = "top";
    ctx.fillText(text, lx, top + 16 + lane * 14);
  }

  if (hover != null && bars[hover]) {
    const bar = bars[hover];
    const x = left + slot * hover + slot / 2;
    ctx.strokeStyle = "rgba(226, 182, 87, 0.55)";
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, height - bottom);
    ctx.moveTo(left, yOf(bar.c));
    ctx.lineTo(right, yOf(bar.c));
    ctx.stroke();
  }
}

function axisStamp(time: number, interval: string) {
  const date = new Date(time);
  if (interval === "1d") return date.toLocaleDateString("en-CA");
  return date.toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function compact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}
