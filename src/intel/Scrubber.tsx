import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { binCounts, dayIso, dayNum, missedIn, windowSum, EVENT_KINDS, type ArcKind, type EventKind } from "../../shared/intel.mjs";
import { when } from "../lib/api";
import { ARC_CAP, ARC_COLOR, ARC_LABEL, type ArcView } from "./arcs";
import { LANE_COLOR, presetWindow, type DayWindow } from "./lanes";
import type { IntelData, IntelScope } from "./useIntel";
import { Icon, IconLabel, type IconName } from "../ui/icons/Icon";

const LANE_SHORT: Record<EventKind, string> = { trade: "TRADES", hearing: "HEARINGS", roll: "ROLL CALLS", contract: "CONTRACTS", form4: "FORM 4" };
const LANE_ICON: Record<EventKind, IconName> = { trade: "trade", hearing: "hearing", roll: "roll", contract: "contracts", form4: "form4" };
const ARC_ICON: Record<ArcKind, IconName> = { trade: "trade", contract: "contracts", pac: "pac" };
const PRESETS: [string, number][] = [["30D", 30], ["90D", 90], ["1Y", 365], ["ALL", 0]];
const MAX_BINS = 220;
const EDGE_PX = 8;
/** Pointer travel before a press on the track becomes a new window instead of a click. */
const DRAG_PX = 4;

type Props = {
  /** The scope asked for; `data.scope` lags it while loading and is absent on errors. */
  scope: IntelScope;
  data: IntelData | null;
  loading: boolean;
  window: DayWindow | null;
  onWindow: (w: DayWindow) => void;
  kinds: Set<ArcKind>;
  onKinds: (next: Set<ArcKind>) => void;
  /** Null on phones, where the map is not mounted. */
  arcs: ArcView | null;
  /** Arcs are drawn on the map. A member or ticker scope always draws them. */
  mapArcs: boolean;
  /** The relationship board always draws its links, so the map toggle stays off that bar. */
  board?: boolean;
  onMapArcs: (on: boolean) => void;
  onClearScope: () => void;
  collapsed: boolean;
  onCollapsed: (v: boolean) => void;
  phone: boolean;
  onFollow: (action: string) => void;
};

/**
 * Bottom-of-map time scrubber. One tick lane per feed, a draggable window that filters the map arcs,
 * and each lane's source, as-of, and latency on hover and under "Feeds".
 */
export function Scrubber({ scope, data, loading, window: win, onWindow, kinds, onKinds, arcs, mapArcs, onMapArcs, board, onClearScope, collapsed, onCollapsed, phone, onFollow }: Props) {
  const [feeds, setFeeds] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const len = data?.ok ? data.len : 0;
  const w: DayWindow = win || presetWindow(len, 90);
  const start = data?.ok ? dayNum(data.from) : 0;
  const bins = Math.max(1, Math.min(len, MAX_BINS));

  const lanes = useMemo(() => {
    if (!data?.ok) return [];
    return EVENT_KINDS.map((k) => {
      const counts = data.days[k];
      const binned = binCounts(counts, bins);
      const max = Math.max(1, ...binned);
      const meta = data.kinds.find((x) => x.id === k);
      return { k, counts, binned, max, meta };
    });
  }, [data, bins]);

  const inWindow = useMemo(() => Object.fromEntries(lanes.map((l) => [l.k, windowSum(l.counts, w[0], w[1])])) as Record<EventKind, number>, [lanes, w[0], w[1]]);
  const latest = useMemo(() => {
    if (!data?.ok || !phone) return [];
    return data.events.filter((e) => e.d >= w[0] && e.d <= w[1]).slice(0, 5);
  }, [data, phone, w[0], w[1]]);

  const dayAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !len) return 0;
    return Math.max(0, Math.min(len - 1, Math.round(((clientX - box.left) / box.width) * (len - 1))));
  };
  const pxPerDay = () => (track.current ? track.current.getBoundingClientRect().width / Math.max(1, len - 1) : 1);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (!len) return;
    event.preventDefault();
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    const at = dayAt(event.clientX);
    const edge = EDGE_PX / pxPerDay();
    const mode = Math.abs(at - w[0]) <= edge ? "a" : Math.abs(at - w[1]) <= edge ? "b" : at > w[0] && at < w[1] ? "move" : "new";
    const origin = { at, w, x: event.clientX };
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - origin.x) < DRAG_PX) return;
      dragged = true;
      const d = dayAt(ev.clientX);
      if (mode === "move") {
        const span = origin.w[1] - origin.w[0];
        const a = Math.max(0, Math.min(len - 1 - span, origin.w[0] + d - origin.at));
        onWindow([a, a + span]);
      } else if (mode === "a") onWindow([Math.min(d, origin.w[1]), origin.w[1]]);
      else if (mode === "b") onWindow([origin.w[0], Math.max(d, origin.w[0])]);
      else onWindow([Math.min(origin.at, d), Math.max(origin.at, d)]);
    };
    const up = () => {
      if (!dragged && mode === "new") {
        const span = origin.w[1] - origin.w[0];
        const a = Math.max(0, Math.min(len - 1 - span, origin.at - Math.round(span / 2)));
        onWindow([a, a + span]);
      }
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function key(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 7 : 1;
    const span = w[1] - w[0];
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      const a = Math.max(0, Math.min(len - 1 - span, w[0] + (event.key === "ArrowLeft" ? -step : step)));
      onWindow([a, a + span]);
    }
  }

  const toggleKind = (k: ArcKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onKinds(next);
  };

  const span = w[1] - w[0] + 1;
  const range = len ? `${dayIso(start + w[0])} → ${dayIso(start + w[1])}` : "—";
  const preset = len ? PRESETS.find(([, d]) => { const p = presetWindow(len, d); return p[0] === w[0] && p[1] === w[1]; })?.[0] : undefined;
  const scoped = scope.kind !== "all";
  const scopeText = data?.ok ? data.scope.label : scoped ? (scope.kind === "member" ? `Member ${scope.id}` : scope.id) : "All Congress";
  const cov = data?.ok ? data.arcs.coverage : null;
  const unplaced = cov ? (["trade", "contract", "pac"] as ArcKind[]).map((k) => `${ARC_LABEL[k]}: ${cov[k].placed.toLocaleString("en-US")} of ${cov[k].total.toLocaleString("en-US")} placed (${cov[k].noFrom} no origin, ${cov[k].noTo} no SEC HQ or ticker join)`).join("\n") : "";
  const missed = data?.ok && data.arcs.misses ? missedIn(data.arcs.misses, w[0], w[1], kinds) : null;

  return (
    <section className={`scrub${collapsed ? " min" : ""}`} aria-label="Time scrubber">
      <header className="scrub-head">
        <button className="scrub-fold" aria-expanded={!collapsed} onClick={() => onCollapsed(!collapsed)} title={collapsed ? "Show the time scrubber" : "Collapse to one line"}>
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} /> <em>RECORDS WINDOW</em>
        </button>
        <span className="scrub-scope" title="Scope of the lanes and arcs. Opening a member or ticker dossier scopes it.">
          <span>{loading && !data ? "Loading…" : scopeText}</span>
          {scoped ? <button className="scrub-x" onClick={onClearScope} title="Back to all of Congress"><IconLabel icon="reset">All Congress</IconLabel></button> : null}
        </span>
        <strong className="scrub-range">{range}<small>{len ? ` · ${span} d` : ""}</small></strong>
        {collapsed ? (
          <span className="scrub-sum">
            {lanes.map((l) => <span key={l.k} title={l.meta?.label}><i style={{ background: LANE_COLOR[l.k] }} />{(inWindow[l.k] || 0).toLocaleString("en-US")}</span>)}
          </span>
        ) : (
          <span className="seg scrub-presets" title="Window">
            {PRESETS.map(([label, d]) => (
              <button key={label} aria-pressed={preset === label} disabled={!len} onClick={() => onWindow(presetWindow(len, d))}>{label}</button>
            ))}
          </span>
        )}
        {!collapsed ? (
          <span className="scrub-arcs" title="Arcs on the map. Hover an arc for its source and as-of.">
            <em>ARCS</em>
            {arcs && !board ? (
              <button className="scrub-onmap" style={{ ["--arc" as string]: "var(--amber)" }} aria-pressed={mapArcs} disabled={scoped} onClick={() => onMapArcs(!mapArcs)} title={scoped ? "A member or ticker scope always draws its arcs. Clear the scope to hide them." : "Draw trade, contract, and PAC arcs over the map"}><IconLabel icon="arc">On map</IconLabel></button>
            ) : null}
            {(["trade", "contract", "pac"] as ArcKind[]).map((k) => (
              <button key={k} aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)} style={{ ["--arc" as string]: ARC_COLOR[k] }}><IconLabel icon={ARC_ICON[k]}>{ARC_LABEL[k]}</IconLabel></button>
            ))}
          </span>
        ) : null}
      </header>
      {collapsed ? null : !data ? (
        <p className="scrub-note">Loading lanes: trades, hearings, roll calls, contracts, Form 4…</p>
      ) : !data.ok ? (
        <p className="scrub-note">{data.error || "Timeline unavailable."}</p>
      ) : (
        <>
          <div className="scrub-body">
            <div className="scrub-labels">
              {lanes.map((l) => (
                <span key={l.k} title={feedTitle(l.meta)}><i style={{ background: LANE_COLOR[l.k] }} /><Icon name={LANE_ICON[l.k]} className="scrub-lane-ic" />{LANE_SHORT[l.k]}<b>{(inWindow[l.k] || 0).toLocaleString("en-US")}</b></span>
              ))}
            </div>
            <div
              ref={track}
              className="scrub-track"
              role="slider"
              tabIndex={0}
              aria-label="Time window. Click to center it, drag to select, drag inside to move, drag an edge to resize, arrow keys shift by a day."
              aria-valuemin={0}
              aria-valuemax={len - 1}
              aria-valuenow={w[0]}
              aria-valuetext={range}
              onPointerDown={down}
              onKeyDown={key}
            >
              {lanes.map((l) => (
                <svg key={l.k} className="scrub-lane" viewBox={`0 0 ${bins} 1`} preserveAspectRatio="none" aria-hidden="true">
                  {l.binned.map((n, i) => n ? (
                    <rect key={i} x={i + 0.12} width={0.76} y={1 - Math.max(0.18, Math.sqrt(n / l.max))} height={Math.max(0.18, Math.sqrt(n / l.max))} fill={LANE_COLOR[l.k]} />
                  ) : null)}
                </svg>
              ))}
              <div className="scrub-shade" style={{ left: 0, width: `${(w[0] / Math.max(1, len - 1)) * 100}%` }} />
              <div className="scrub-shade" style={{ right: 0, width: `${((len - 1 - w[1]) / Math.max(1, len - 1)) * 100}%` }} />
              <div className="scrub-win" style={{ left: `${(w[0] / Math.max(1, len - 1)) * 100}%`, width: `${(Math.max(0.4, w[1] - w[0]) / Math.max(1, len - 1)) * 100}%` }}>
                <span className="scrub-grip a" />
                <span className="scrub-grip b" />
              </div>
            </div>
          </div>
          <div className="scrub-scale">
            <span>{data.from}</span>
            <span className="scrub-cov" title={`Whole scope since ${data.from}:\n${unplaced}\n\nHQs: ${data.arcs.hq.source}, as of ${when(data.arcs.hq.asOf)}. ${data.arcs.hq.placed} of ${data.arcs.hq.total} index companies placed; the rest stay off the map.`}>
              {!arcs ? "Map arcs show on wider screens" : !mapArcs ? `Arcs hidden · ${arcs.shown} bundles ready · ARCS › On map draws them` : arcs.shown ? `${arcs.shown} arc bundles${arcs.hidden ? ` (top ${arcs.shown} of ${arcs.shown + arcs.hidden})` : ""} · ${arcs.links.toLocaleString("en-US")} links${arcs.local ? ` · ${arcs.local} same-place` : ""}` : kinds.size ? "No placeable links in this window" : "Arcs off"}
              {arcs && missed ? ` · ${missed.toLocaleString("en-US")} link${missed === 1 ? "" : "s"} in this window couldn't be placed` : ""}
            </span>
            <button className="scrub-feeds-btn" aria-expanded={feeds} onClick={() => setFeeds((v) => !v)}><IconLabel icon="feed">Feeds</IconLabel> <Icon name={feeds ? "chevron-down" : "chevron-right"} /></button>
            <span>{data.to}</span>
          </div>
          {feeds ? (
            <ul className="scrub-feeds">
              {data.kinds.map((k) => (
                <li key={k.id}>
                  <i style={{ background: LANE_COLOR[k.id] }} />
                  <b>{k.label}</b>
                  <span>{k.source} · as of {k.asOf ? when(k.asOf) : "—"} · {k.total.toLocaleString("en-US")} events</span>
                  <small>{k.latency}{k.note ? ` ${k.note}` : ""}{k.error ? ` · ${k.error}` : ""}</small>
                </li>
              ))}
              <li>
                <i style={{ background: "transparent" }} />
                <b>Arcs</b>
                <span>{Object.values(data.arcs.sources).join(" · ")}</span>
                <small>Bundled by origin and destination inside the window; at most {ARC_CAP} heaviest bundles drawn. Companies without an SEC HQ or ticker join stay unplaced.</small>
              </li>
            </ul>
          ) : null}
          {latest.length && data.scope.kind === "all" ? (
            <p className="scrub-note">Latest contract awards in the window. Open a member or ticker to list its trades and hearings here.</p>
          ) : null}
          {latest.length ? (
            <ul className="scrub-events">
              {latest.map((e, i) => (
                <li key={`${e.d}:${i}`}>
                  <button disabled={!e.action && !e.link} onClick={() => (e.action ? onFollow(e.action) : e.link && window.open(e.link, "_blank", "noreferrer"))}>
                    <i style={{ background: LANE_COLOR[e.k] }} />
                    <time>{dayIso(start + e.d)}</time>
                    <span>{e.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

function feedTitle(meta: IntelData["kinds"][number] | undefined) {
  if (!meta) return "";
  return `${meta.label}\n${meta.source}\nAs of ${meta.asOf ? when(meta.asOf) : "—"}\n${meta.latency}${meta.note ? `\n${meta.note}` : ""}`;
}
