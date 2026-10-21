import { useEffect, useRef, useState } from "react";
import { cleanLayout, type Layout } from "../../shared/chartWorkspace.mjs";
import { api } from "../lib/api";
import type { ChartMark, DrawerModel } from "../types";
import type { Headline } from "../news/useNews";
import { loadDossier } from "./useMarkets";
import { ChartPanel } from "./ChartPanel";
import { EVENT_TYPES, eventKind, describeEvent, handoffText, type EvidenceMark } from "./chartEvents";
import "./chartWorkspace.css";
export type ChartSpan = "1m" | "5m" | "15m" | "1h" | "1d" | "6mo" | "1y" | "5y";
type Trade = {
  traded: string;
  filed: string;
  person: string;
  side: string;
  amount: string;
  link: string;
  code?: string;
};
function restore(): Layout {
  try {
    return cleanLayout(JSON.parse(localStorage.getItem("intel:chart-workspace:v1") || "null"));
  } catch {
    return cleanLayout(null);
  }
}
export function CandleChart({
  symbol,
  span,
  onBack,
  marks = [],
  onFollow,
  onDossier,
}: {
  symbol: string;
  span: ChartSpan;
  onSpan: (s: ChartSpan) => void;
  onBack: () => void;
  marks?: ChartMark[];
  onFollow: (action: string) => void;
  onDossier: (model: DrawerModel) => void;
}) {
  const [restoreKey, setRestoreKey] = useState(0);
  const [layout, setLayout] = useState<Layout>(() => {
      const l = restore();
      l.panels[0].symbol = symbol;
      return l;
    }),
    [notice, setNotice] = useState(""),
    [wide, setWide] = useState(() => window.innerWidth >= 1100),
    [filters, setFilters] = useState(() => new Set(EVENT_TYPES.map((v) => v[0] as string))),
    [basis, setBasis] = useState("disclosure"),
    [contextPin, setContextPin] = useState<string | null>(null),
    [syncTime, setSyncTime] = useState(false);
  const [events, setEvents] = useState<EvidenceMark[]>([]),
    [trades, setTrades] = useState<Trade[]>([]),
    [news, setNews] = useState<Headline[]>([]),
    [eventStatus, setEventStatus] = useState(""),
    [selected, setSelected] = useState<EvidenceMark[]>([]),
    [review, setReview] = useState(false),
    [windowSpec, setWindowSpec] = useState({ symbol, interval: "1d", from: "", to: "" }),
    [contextWidth, setContextWidth] = useState(310);
  const active = wide ? Math.min(layout.active, layout.mode === "two" ? 1 : layout.mode === "four" ? 3 : 0) : 0,
    activeSymbol = layout.panels[active].symbol,
    contextSymbol = contextPin || activeSymbol;
  const previousSymbol = useRef(symbol),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (previousSymbol.current !== symbol) {
      setLayout((l) => ({ ...l, active: 0, panels: l.panels.map((p, i) => (i === 0 ? { ...p, symbol } : p)) }));
      previousSymbol.current = symbol;
    }
  }, [symbol]);
  useEffect(() => {
    const mq = matchMedia("(min-width:1100px)"),
      listener = () => setWide(mq.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    if (!review) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = root.current?.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
        ) || [],
      );
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setReview(false);
      }
      if (e.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    dialog?.addEventListener("keydown", key);
    return () => {
      dialog?.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [review]);
  const changeSymbol = (index: number, next: string) =>
    setLayout((l) => ({
      ...l,
      panels: l.panels.map((p, i) =>
        i === index || (l.panels[index].group !== "Independent" && p.group === l.panels[index].group)
          ? { ...p, symbol: next }
          : p,
      ),
    }));
  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    setTrades([]);
    setNews([]);
    setSelected([]);
    setEventStatus("Loading evidence…");
    const jobs = [
      api<{ ok: boolean; marks: EvidenceMark[]; pending?: string[]; failed?: string[]; source?: string }>(
        `/api/markets/events?symbol=${encodeURIComponent(contextSymbol)}`,
      ).then((r) => {
        if (cancelled) return;
        setEvents(r.marks || []);
        setEventStatus(
          r.ok
            ? `${r.pending?.length ? `Pending: ${r.pending.join(", ")}. ` : ""}${r.failed?.length ? `Failed: ${r.failed.join(", ")}. ` : ""}Coverage varies by source; not a complete event history.`
            : "Event provider unavailable.",
        );
      }),
      api<{ congress: Trade[]; insiders: Trade[] }>(`/api/markets/positions/${encodeURIComponent(contextSymbol)}`).then(
        (r) => {
          if (!cancelled) setTrades([...(r.congress || []), ...(r.insiders || [])]);
        },
      ),
      api<{ items: Headline[] }>("/api/news").then((r) => {
        if (!cancelled) setNews((r.items || []).filter((n) => n.symbols?.includes(contextSymbol)).slice(0, 15));
      }),
    ];
    void Promise.allSettled(jobs).then((results) => {
      if (!cancelled && results.some((r) => r.status === "rejected"))
        setEventStatus(
          "Some evidence feeds failed. Available evidence remains visible; switch context or reopen to retry.",
        );
    });
    return () => {
      cancelled = true;
    };
  }, [contextSymbol]);
  const tradeMarks: EvidenceMark[] = trades.flatMap((t) => {
    const date = basis === "disclosure" ? t.filed : t.traded;
    if (!date) return [];
    const time = Date.parse(`${date.slice(0, 10)}T12:00:00Z`);
    if (!Number.isFinite(time)) return [];
    return [
      {
        t: time,
        label: `${t.person} · ${basis === "disclosure" ? "filed" : t.side || t.code || "trade"}`,
        tone: basis === "disclosure" ? "file" : t.side === "sell" || t.code === "S" ? "sell" : "buy",
        detail: `${t.amount || ""} · traded ${t.traded || "unknown"} · filed ${t.filed || "unknown"}`,
        href: t.link,
        eventDate: t.traded,
        publicationDate: t.filed,
        dateBasis: basis === "disclosure" ? "Filing date (date only)" : "Transaction date (date only)",
        actor: t.person,
        amount: t.amount,
        limitation:
          "Date-only record. Noon UTC is a plotting coordinate, not the time of execution or public availability. Use next regular session after filing for a conservative test, subject to venue calendar review.",
      },
    ];
  });
  const all = [
    ...events,
    ...tradeMarks,
    ...(contextSymbol === symbol
      ? marks.filter((m) => (basis === "disclosure" ? m.tone === "file" : m.tone !== "file"))
      : []),
  ].filter((m) => Number.isFinite(m.t));
  const visible = all.filter((m) => filters.has(eventKind(m))).sort((a, b) => a.t - b.t);
  const count = wide ? (layout.mode === "two" ? 2 : layout.mode === "four" ? 4 : 1) : 1;
  const save = () => {
    try {
      localStorage.setItem("intel:chart-workspace:v1", JSON.stringify(cleanLayout(layout)));
      localStorage.setItem("intel:chart-context-width", String(contextWidth));
      localStorage.setItem(
        "intel:chart-saved-settings",
        JSON.stringify({
          syncTime,
          panels: Array.from({ length: 4 }, (_, i) => localStorage.getItem(`intel:chart-settings:${i}`)),
        }),
      );
      setNotice("Layout saved in this browser.");
    } catch {
      setNotice("Browser storage unavailable.");
    }
  };
  const restoreSaved = () => {
    try {
      const s = JSON.parse(localStorage.getItem("intel:chart-saved-settings") || "null");
      if (s) {
        setSyncTime(s.syncTime === true);
        for (let i = 0; i < 4; i++)
          if (typeof s.panels?.[i] === "string") localStorage.setItem(`intel:chart-settings:${i}`, s.panels[i]);
      }
    } catch {
      /* settings fall back to validated defaults */
    }
    setLayout(restore());
    setRestoreKey((k) => k + 1);
    setNotice("Saved arrangement and settings restored.");
  };
  const resize = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = e.clientX,
      width = contextWidth;
    const move = (v: PointerEvent) => setContextWidth(Math.max(240, Math.min(520, width + start - v.clientX)));
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end, { once: true });
  };
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("intel:chart-context-width"));
      if (w >= 240 && w <= 520) setContextWidth(w);
    } catch {
      /* optional */
    }
  }, []);
  return (
    <div className="chart-workspace" ref={root}>
      <header className="chart-workspace-bar">
        <button onClick={onBack}>← Board</button>
        <strong>Chart workspace</strong>
        <label>
          Layout{" "}
          <select
            aria-label="Chart workspace layout"
            value={!wide && ["two", "four"].includes(layout.mode) ? "evidence" : layout.mode}
            onChange={(e) => setLayout((l) => ({ ...l, mode: e.target.value, active: 0 }))}
          >
            <option value="single">Single chart</option>
            <option value="evidence">Chart + evidence</option>
            <option value="two" disabled={!wide}>
              Two charts
            </option>
            <option value="four" disabled={!wide}>
              Four charts
            </option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={syncTime} onChange={(e) => setSyncTime(e.target.checked)} /> Link time ranges
        </label>
        <button onClick={save}>Save layout</button>
        <button onClick={restoreSaved}>Restore</button>
        <button disabled={windowSpec.symbol !== activeSymbol || !windowSpec.from} onClick={() => setReview(true)}>
          Review research window
        </button>
        <span role="status">{notice}</span>
      </header>
      <div
        className="chart-workspace-body"
        style={{ "--chart-context-width": `${contextWidth}px` } as React.CSSProperties}
      >
        <div className="chart-grid" data-count={count}>
          {layout.panels.slice(0, count).map((panel, i) => (
            <ChartPanel
              key={`${restoreKey}:${i}`}
              id={i}
              {...panel}
              active={i === active}
              linkedWindow={
                syncTime && panel.group !== "Independent" && panel.group === layout.panels[active].group && i !== active
                  ? windowSpec
                  : undefined
              }
              initialSpan={i === 0 ? span : undefined}
              marks={panel.symbol === contextSymbol ? visible : []}
              onActive={() => setLayout((l) => (l.active === i ? l : { ...l, active: i }))}
              onSymbol={(s) => changeSymbol(i, s)}
              onGroup={(group) =>
                setLayout((l) => ({ ...l, panels: l.panels.map((p, j) => (i === j ? { ...p, group } : p)) }))
              }
              onSelect={(ms) => {
                setSelected(ms);
                setLayout((l) => ({ ...l, mode: count === 1 ? "evidence" : l.mode }));
              }}
              onWindow={(v) => {
                if (i === active)
                  setWindowSpec((old) =>
                    old.symbol === v.symbol && old.interval === v.interval && old.from === v.from && old.to === v.to
                      ? old
                      : v,
                  );
              }}
            />
          ))}
        </div>
        {layout.mode !== "single" ? (
          <>
            <div
              className="chart-divider"
              role="separator"
              aria-label="Resize chart evidence"
              aria-orientation="vertical"
              aria-valuenow={contextWidth}
              tabIndex={0}
              onPointerDown={resize}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setContextWidth((w) => Math.max(240, Math.min(520, w + (e.key === "ArrowLeft" ? 20 : -20))));
                }
              }}
            />
            <aside className="chart-evidence">
              <header>
                <h2>{contextSymbol} · evidence</h2>
                <button aria-pressed={!!contextPin} onClick={() => setContextPin(contextPin ? null : activeSymbol)}>
                  {contextPin ? "Pinned · unlink" : "Follow active chart"}
                </button>
              </header>
              <p>
                {contextPin ? "Independent context" : "Linked to active chart"} · selecting context never replaces a
                conversation.
              </p>
              <div className="chart-context-actions">
                <button onClick={() => onFollow(`pos:${contextSymbol}`)}>Trading activity</button>
                <button
                  onClick={() => {
                    void loadDossier(contextSymbol).then((d) => {
                      if (d) onDossier(d);
                    });
                  }}
                >
                  Company details
                </button>
                <button onClick={() => onFollow(`supply:${contextSymbol}`)}>Supply exposure</button>
              </div>
              <details open>
                <summary>Symbols</summary>
                <div className="chart-symbols">
                  {["AAPL", "MSFT", "NVDA", "LMT", "HII", "SPY", "BTC-USD", "EURUSD=X"].map((s) => (
                    <button key={s} onClick={() => changeSymbol(active, s)} aria-pressed={s === activeSymbol}>
                      {s}
                    </button>
                  ))}
                </div>
              </details>
              <details open>
                <summary>Political & market events</summary>
                <label>
                  Trade marker date{" "}
                  <select
                    aria-label="Trade event date basis"
                    value={basis}
                    onChange={(e) => {
                      setBasis(e.target.value);
                      setSelected([]);
                    }}
                  >
                    <option value="disclosure">Disclosure / filing</option>
                    <option value="transaction">Transaction · descriptive only</option>
                  </select>
                </label>
                <div className="chart-event-filters">
                  {EVENT_TYPES.map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={filters.has(key)}
                        onChange={() =>
                          setFilters((old) => {
                            const next = new Set(old);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="chart-help">
                  {eventStatus} Legislation milestones are not supplied by the current company-event feed.
                </p>
              </details>
              {selected.length ? (
                <section className="selected-evidence" aria-label="Selected chart evidence">
                  <h3>Selected evidence · {selected.length}</h3>
                  <button onClick={() => setSelected([])}>Clear selection</button>
                  {selected.map((m, i) => (
                    <article key={i}>
                      <strong>{m.label}</strong>
                      <p>{m.detail}</p>
                      <dl>
                        <dt>Date basis</dt>
                        <dd>{m.dateBasis || "Provider event marker"}</dd>
                        <dt>Event date</dt>
                        <dd>{m.eventDate || new Date(m.t).toISOString().slice(0, 10)}</dd>
                        <dt>Publication</dt>
                        <dd>{m.publicationDate || "Not supplied"}</dd>
                        <dt>Ingestion / version</dt>
                        <dd>
                          {m.ingestedAt || "Not supplied"} / {m.datasetVersion || "Not supplied"}
                        </dd>
                      </dl>
                      <p>{describeEvent(m)}</p>
                      {m.href ? (
                        <a href={m.href} target="_blank" rel="noreferrer">
                          Open original source ↗
                        </a>
                      ) : (
                        <span>Original source link not supplied</span>
                      )}
                    </article>
                  ))}
                </section>
              ) : null}
              <details open>
                <summary>Recent available events · {visible.length}</summary>
                <div className="chart-event-list">
                  {visible
                    .slice(-100)
                    .reverse()
                    .map((m, i) => (
                      <button key={`${m.t}-${i}`} onClick={() => setSelected([m])}>
                        <time>{new Date(m.t).toISOString().slice(0, 10)}</time>
                        <span>{m.label}</span>
                      </button>
                    ))}
                  {!visible.length ? <p>No matching events loaded. This is not evidence of no activity.</p> : null}
                </div>
              </details>
              <details>
                <summary>Linked company news · {news.length}</summary>
                {news.map((n) => (
                  <article key={n.id}>
                    <a href={n.link} target="_blank" rel="noreferrer">
                      {n.title}
                    </a>
                    <p>
                      {n.source} · {n.published}
                    </p>
                  </article>
                ))}
                {!news.length ? <p>No symbol-tagged headlines in the current wire snapshot.</p> : null}
              </details>
            </aside>
          </>
        ) : null}
      </div>
      <footer className="chart-workspace-footer">
        <span>
          Drag price / time axes to scale · drag chart to pan · wheel / pinch to zoom · arrow keys pan, +/− zoom
        </span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.
        </a>
      </footer>
      {review ? (
        <div className="chart-review-backdrop">
          <section role="dialog" aria-modal="true" aria-label="Review chart research handoff" className="chart-review">
            <h2>Review chart research window</h2>
            <p>
              Selected evidence context: {contextSymbol}. Chart context: {windowSpec.symbol}.
            </p>
            <p>
              This creates a draft in the existing assistant. It does not run a test or replace conversation history.
            </p>
            <label>
              Company
              <input value={windowSpec.symbol} readOnly />
            </label>
            <label>
              Interval
              <input value={windowSpec.interval} readOnly />
            </label>
            <label>
              From (UTC)
              <input
                type="date"
                value={windowSpec.from.slice(0, 10)}
                onChange={(e) => setWindowSpec((v) => ({ ...v, from: e.target.value }))}
              />
            </label>
            <label>
              Through (UTC)
              <input
                type="date"
                value={windowSpec.to.slice(0, 10)}
                onChange={(e) => setWindowSpec((v) => ({ ...v, to: e.target.value }))}
              />
            </label>
            {selected.length > 20 ? (
              <p role="alert">
                Select at most 20 events for one handoff. Choose an individual event from the evidence list to narrow
                the selection.
              </p>
            ) : null}
            <pre>{handoffText(windowSpec.symbol, windowSpec.interval, windowSpec.from, windowSpec.to, selected)}</pre>
            <div>
              <button onClick={() => setReview(false)}>Cancel</button>
              {[false, true].map((bt) => (
                <button
                  key={String(bt)}
                  disabled={
                    selected.length > 20 ||
                    !windowSpec.from ||
                    !windowSpec.to ||
                    Date.parse(windowSpec.from) > Date.parse(windowSpec.to)
                  }
                  onClick={() => {
                    onFollow(
                      `ask:chart:${encodeURIComponent(JSON.stringify({ backtest: bt, chart: { ...windowSpec, events: selected.map((m) => ({ symbol: contextSymbol, label: m.label, eventDate: m.eventDate || new Date(m.t).toISOString(), publicationDate: m.publicationDate || null, ingestedAt: m.ingestedAt || null, datasetVersion: m.datasetVersion || null, amount: m.amount || null, source: m.href || null, dateBasis: m.dateBasis || "Provider marker", limitation: describeEvent(m) })) } }))}`,
                    );
                    setReview(false);
                  }}
                >
                  {bt ? "Draft backtest review" : "Draft research question"}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
