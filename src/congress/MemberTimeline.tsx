import { useEffect, useMemo, useRef, useState } from "react";
import { api, when } from "../lib/api";

type Near = { id: string; date: string; title: string; lane: string; laneName: string; link: string; gap: number };
type Trade = {
  id: string; symbol: string; asset: string; side: string; type: string; owner: string;
  amount: string; amountLow: number; traded: string; filed: string; lag: number | null; link: string; near: Near | null;
};
type Hearing = { id: string; date: string; title: string; type: string; status: string; link: string; mine: boolean };
type Lane = { id: string; name: string; title: string; subs: { id: string; name: string; title: string }[]; hearings: Hearing[] };
type Vote = { id: string; date: string; question: string; result: string; bill: string; vote: string };
export type TimelineRes = {
  ok: boolean; error?: string; missing?: string;
  member?: { bioguide: string; name: string; party: string; state: string; district: string; chamber: string };
  range?: { from: string; to: string };
  trades?: Trade[]; committees?: Lane[]; votes?: Vote[]; nearDays?: number;
  building?: boolean;
  coverage?: { meetings: { done: number; total: number }; votes: { done: number; total: number }; builtAt: string | null };
  sources?: { label: string; source: string; latency: string }[];
  asOf?: string;
};

type Span = "trades" | "all" | "1y" | "6m" | "90d";
type Tip = { x: number; y: number; lines: string[] } | null;

const DAY = 86_400_000;
const LABEL_W = 196;
const AXIS_H = 26;
const TRADE_H = 112;
const LANE_H = 30;
const VOTE_H = 46;
const PAD_R = 18;
const CONGRESS_START = "2025-01-03";

const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const radius = (low: number) => (low >= 1_000_000 ? 8 : low >= 250_000 ? 7 : low >= 100_000 ? 6 : low >= 50_000 ? 5 : low >= 15_000 ? 4 : 3);

/** Center-stage board: one member's disclosed trades against their committee hearings and roll calls. */
export function MemberTimeline({ bioguide, onClose, onFollow }: { bioguide: string; onClose: () => void; onFollow: (action: string) => void }) {
  const [res, setRes] = useState<TimelineRes | null>(null);
  const [span, setSpan] = useState<Span>("trades");
  const [width, setWidth] = useState(900);
  const [tip, setTip] = useState<Tip>(null);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [plot, setPlot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancel = false;
    let timer = 0;
    const load = () =>
      api<TimelineRes>(`/api/congress/member/${bioguide}/timeline`)
        .then((body) => {
          if (cancel) return;
          setRes(body);
          if (body.building) timer = window.setTimeout(load, 15_000);
        })
        .catch((err: Error) => { if (!cancel) setRes({ ok: false, error: err.message }); });
    setRes(null);
    void load();
    return () => { cancel = true; window.clearTimeout(timer); };
  }, [bioguide]);

  useEffect(() => {
    if (!plot) return;
    wrap.current = plot;
    const fit = () => setWidth(Math.max(340, Math.floor(plot.clientWidth)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(plot);
    return () => ro.disconnect();
  }, [plot]);

  const view = useMemo(() => {
    if (!res?.ok || !res.range) return null;
    const end = t(res.range.to);
    const first = res.trades?.[0]?.traded;
    const fit = first ? Math.max(120, Math.ceil((end - t(first)) / DAY) + 30) : 365;
    const back = { trades: fit, all: 0, "1y": 365, "6m": 183, "90d": 90 }[span];
    const start = back ? end - back * DAY : t(res.range.from);
    const inRange = (iso: string) => { const v = t(iso); return v >= start && v <= end; };
    const labelW = width < 640 ? 96 : LABEL_W;
    const plotW = width - labelW - PAD_R;
    const x = (iso: string) => labelW + ((t(iso) - start) / Math.max(DAY, end - start)) * plotW;
    const trades = (res.trades || []).filter((tr) => inRange(tr.traded));
    const lanes = (res.committees || []).map((l) => ({ ...l, hearings: l.hearings.filter((h) => inRange(h.date)) }));
    const votes = (res.votes || []).filter((v) => inRange(v.date));
    const months: { iso: string; label: string }[] = [];
    const cursor = new Date(start);
    cursor.setUTCDate(1);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const perMonth = plotW / Math.max(1, (end - start) / (30.4 * DAY));
    const every = perMonth >= 40 ? 1 : perMonth >= 20 ? 2 : 3;
    while (cursor.getTime() <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      const m = cursor.getUTCMonth();
      const label = m === 0 ? String(cursor.getUTCFullYear()) : m % every === 0 ? cursor.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase() : "";
      months.push({ iso, label });
      cursor.setUTCMonth(m + 1);
    }
    const slot = new Map<string, number>();
    const stacked = trades.map((tr) => {
      const key = `${tr.traded}:${tr.side === "sell" ? "s" : "b"}`;
      const n = slot.get(key) || 0;
      slot.set(key, n + 1);
      return { ...tr, slot: n };
    });
    const preCongress = start < t(CONGRESS_START) ? x(CONGRESS_START) : 0;
    return { x, trades: stacked, lanes, votes, months, plotW, labelW, narrow: width < 640, preCongress, dense: trades.length > 40 };
  }, [res, span, width]);

  if (!res) return <div className="board timeline"><p className="stage-loading">Loading timeline…</p></div>;
  if (!res.ok || !res.member || !view) {
    return (
      <div className="board timeline">
        <p className="stage-loading">{res.missing ? `Set ${res.missing} to build member timelines.` : res.error || "No timeline."}</p>
        <button className="tl-close" onClick={onClose} aria-label="Close timeline">×</button>
      </div>
    );
  }

  const m = res.member;
  const near = view.trades.filter((tr) => tr.near);
  const lags = view.trades.map((tr) => tr.lag).filter((v): v is number => v != null).sort((a, b) => a - b);
  const medianLag = lags.length ? lags[Math.floor(lags.length / 2)] : null;
  const missed = view.votes.filter((v) => v.vote === "Not voting").length;
  const laneTop = AXIS_H + TRADE_H;
  const voteTop = laneTop + view.lanes.length * LANE_H + 8;
  const height = voteTop + VOTE_H + 8;
  const tradeMid = AXIS_H + TRADE_H / 2;
  const cov = res.coverage;

  const show = (e: React.MouseEvent, lines: string[]) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, lines });
  };

  const share = () => {
    const url = `${location.origin}${location.pathname}#timeline/${m.bioguide}`;
    void navigator.clipboard?.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); });
  };

  return (
    <div className="board timeline">
      <header className="board-head tl-head">
        <div className="tl-title">
          <strong>MEMBER TIMELINE</strong>
          <span className="tl-name">{m.name}</span>
          <span className={`tl-party p-${m.party}`}>{m.party || "—"}-{m.state}{m.district && m.chamber === "house" ? `-${m.district}` : ""}</span>
          <span className="tl-chamber">{m.chamber}</span>
        </div>
        <div className="tl-tools">
          {(["trades", "all", "1y", "6m", "90d"] as Span[]).map((s) => (
            <button key={s} className={span === s ? "on" : ""} onClick={() => setSpan(s)}>{s.toUpperCase()}</button>
          ))}
          <button onClick={() => onFollow(`member:${m.bioguide}`)}>Card</button>
          <button onClick={share}>{copied ? "Copied" : "Copy link"}</button>
          <button className="tl-close" onClick={onClose} aria-label="Close timeline">×</button>
        </div>
        <p className="tl-stats">
          <b>{view.trades.length}</b> disclosed trades
          <i>·</i><b className={near.length ? "amber" : ""}>{near.length}</b> within {res.nearDays} days of a hearing on their committees
          <i>·</i>median filing lag <b>{medianLag == null ? "—" : `${medianLag}d`}</b>
          <i>·</i><b>{view.votes.length - missed}</b> roll calls cast, <b>{missed}</b> missed
        </p>
      </header>
      <div className="tl-plot" ref={setPlot} onMouseLeave={() => setTip(null)}>
        <svg width={width} height={height} role="img" aria-label={`${m.name} trades, hearings and votes`}>
          {view.months.map((mo) => (
            <g key={mo.iso}>
              <line x1={view.x(mo.iso)} x2={view.x(mo.iso)} y1={AXIS_H - 6} y2={height} className="tl-grid" />
              <text x={view.x(mo.iso) + 4} y={14} className={mo.label.length === 4 ? "tl-axis yr" : "tl-axis"}>{mo.label}</text>
            </g>
          ))}

          {view.preCongress > view.labelW + 2 ? (
            <g>
              <rect x={view.labelW} y={laneTop} width={view.preCongress - view.labelW} height={height - laneTop} className="tl-pre" />
              {(() => {
                const room = view.preCongress - view.labelW - 12;
                const label = [
                  "before the 119th Congress · hearings and votes not indexed",
                  "before the 119th Congress · not indexed",
                  "pre-2025 · not indexed",
                  "not indexed"
                ].find((s) => s.length * 6.2 <= room);
                return label ? <text x={view.labelW + 6} y={laneTop + 14} className="tl-lane-sub">{label}</text> : null;
              })()}
            </g>
          ) : null}
          <text x={12} y={tradeMid - 6} className="tl-lane-label">TRADES</text>
          {view.narrow ? null : <text x={12} y={tradeMid + 8} className="tl-lane-sub">▲ buy · ▼ sell · tail = filing lag</text>}
          <line x1={view.labelW} x2={width - PAD_R} y1={tradeMid} y2={tradeMid} className="tl-axisline" />

          {near.map((tr) => {
            const li = view.lanes.findIndex((l) => l.id === tr.near!.lane);
            if (li < 0) return null;
            const y2 = laneTop + li * LANE_H + LANE_H / 2;
            return <line key={`g-${tr.id}`} x1={view.x(tr.traded)} x2={view.x(tr.near!.date)} y1={tradeMid} y2={y2} className="tl-link" />;
          })}

          {view.trades.map((tr) => {
            const cx = view.x(tr.traded);
            const up = tr.side !== "sell";
            const stack = Math.min(tr.slot, 3) * 9;
            const cy = up ? tradeMid - 10 - stack : tradeMid + 10 + stack;
            const r = radius(tr.amountLow || 0);
            const fx = tr.filed ? view.x(tr.filed) : cx;
            return (
              <g
                key={tr.id}
                className={`tl-trade ${up ? "buy" : "sell"}${tr.near ? " near" : ""}`}
                onMouseMove={(e) => show(e, [
                  `${tr.symbol} · ${tr.type} · ${tr.owner}`,
                  `${tr.amount}`,
                  `Traded ${tr.traded} · filed ${tr.filed || "—"}${tr.lag != null ? ` (${tr.lag}d)` : ""}`,
                  tr.near ? `${Math.abs(tr.near.gap)}d ${tr.near.gap >= 0 ? "before" : "after"} ${tr.near.laneName} meeting: ${tr.near.title.slice(0, 90)}` : "No hearing on their committees within the window",
                  "Click: open the original filing"
                ])}
                onClick={() => tr.link ? window.open(tr.link, "_blank", "noopener") : onFollow(`pos:${tr.symbol}`)}
              >
                <line x1={cx} x2={fx} y1={cy} y2={cy} className="tl-tail" />
                <line x1={fx} x2={fx} y1={cy - 3} y2={cy + 3} className="tl-tail" />
                <path d={up ? `M${cx},${cy - r} L${cx + r},${cy + r * 0.8} L${cx - r},${cy + r * 0.8} Z` : `M${cx},${cy + r} L${cx + r},${cy - r * 0.8} L${cx - r},${cy - r * 0.8} Z`} />
                {!view.dense || tr.slot === 0 && r >= 5 ? <text x={fx + 4} y={cy + 3} className="tl-sym">{tr.symbol}</text> : null}
              </g>
            );
          })}

          {view.lanes.map((lane, li) => {
            const y = laneTop + li * LANE_H;
            return (
              <g key={lane.id}>
                <line x1={0} x2={width} y1={y} y2={y} className="tl-sep" />
                <text x={12} y={y + 13} className="tl-lane-label" onClick={() => onFollow(`committee:${lane.id}`)} style={{ cursor: "pointer" }}>
                  {lane.name.replace(/^(House|Senate|Joint) (Committee on )?(the )?/i, "").slice(0, view.narrow ? 11 : 24).toUpperCase()}
                </text>
                <text x={12} y={y + 24} className="tl-lane-sub">{view.narrow ? `${lane.hearings.length} mtgs` : `${[lane.title, lane.subs.length ? `${lane.subs.length} sub` : ""].filter(Boolean).join(" · ") || "Member"} · ${lane.hearings.length}`}</text>
                {lane.hearings.map((h) => {
                  const hx = view.x(h.date);
                  return (
                    <rect
                      key={`${lane.id}-${h.id}`}
                      x={hx - 1}
                      y={y + 8}
                      width={2}
                      height={LANE_H - 16}
                      className={`tl-hearing${h.mine ? " mine" : ""}${/cancel|postpon/i.test(h.status) ? " off" : ""}`}
                      onMouseMove={(e) => show(e, [`${h.date} · ${h.type || "Meeting"}${h.status && h.status !== "Scheduled" ? ` · ${h.status}` : ""}`, h.title.slice(0, 120), h.mine ? "Full committee or a subcommittee they sit on" : "Another subcommittee of this committee", "Click: Congress.gov event page"])}
                      onClick={() => window.open(h.link, "_blank", "noopener")}
                    />
                  );
                })}
              </g>
            );
          })}
          {!view.lanes.length ? <text x={view.labelW} y={laneTop + 18} className="tl-lane-sub">No current committee assignments on record.</text> : null}

          <line x1={0} x2={width} y1={voteTop - 4} y2={voteTop - 4} className="tl-sep" />
          <text x={12} y={voteTop + 16} className="tl-lane-label">ROLL CALLS</text>
          {view.narrow ? null : <text x={12} y={voteTop + 29} className="tl-lane-sub">↑ yea · ↓ nay · · missed</text>}
          <line x1={view.labelW} x2={width - PAD_R} y1={voteTop + VOTE_H / 2} y2={voteTop + VOTE_H / 2} className="tl-axisline" />
          {view.votes.map((v) => {
            const vx = view.x(v.date);
            const mid = voteTop + VOTE_H / 2;
            const cls = v.vote === "Yea" ? "yea" : v.vote === "Nay" ? "nay" : "miss";
            const [y1, y2] = cls === "yea" ? [mid - 14, mid] : cls === "nay" ? [mid, mid + 14] : [mid - 2, mid + 2];
            return (
              <line
                key={v.id}
                x1={vx} x2={vx} y1={y1} y2={y2}
                className={`tl-vote ${cls}`}
                onMouseMove={(e) => show(e, [`${v.date} · ${v.vote}`, v.question.slice(0, 120), [v.bill, v.result].filter(Boolean).join(" · "), "Click: open the roll call"])}
                onClick={() => onFollow(`vote:${v.id}`)}
              />
            );
          })}
        </svg>
        {tip ? (
          <div className="tl-tip" style={{ left: Math.min(tip.x + 14, width - 300), top: tip.y + 14 }}>
            {tip.lines.map((line, i) => <p key={i} className={i === 0 ? "h" : i === tip.lines.length - 1 ? "hint" : ""}>{line}</p>)}
          </div>
        ) : null}
      </div>
      <footer className="tl-foot">
        {(res.sources || []).map((s) => (
          <span key={s.label} title={s.latency}><em>{s.label.toUpperCase()}</em>{s.source}</span>
        ))}
        <span>
          <em>INDEX</em>
          {res.building ? "building · " : `as of ${when(cov?.builtAt || res.asOf)} · `}
          {cov?.meetings.done ?? 0}/{cov?.meetings.total || "?"} meetings · {cov?.votes.done ?? 0}/{cov?.votes.total || "?"} roll calls indexed
        </span>
        <span className="tl-mark">Calendar proximity only; it does not show what a hearing covered. Committees are current assignments.</span>
      </footer>
    </div>
  );
}
