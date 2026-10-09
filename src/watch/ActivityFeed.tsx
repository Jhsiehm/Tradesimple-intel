import { useMemo, useState } from "react";
import { WATCH_SOURCES, ageLabel, type WatchEvent, type WatchSourceKey } from "../../shared/watchlist.mjs";
import { when } from "../lib/api";
import { AgeLine } from "../ui/AgeLine";
import { Lag } from "../ui/Lag";
import { Icon } from "../ui/icons/Icon";
import { useTickerActivity, type WatchSection } from "./useWatchActivity";

/** Days from event to disclosure each source is allowed (or normally takes), for the lag colour. */
const DUE: Partial<Record<WatchSourceKey, number>> = { congress: 45, insiders: 2, whales: 45, stakes: 10, lobbying: 20, filings: 4 };
const SHORT = Object.fromEntries(WATCH_SOURCES.map((s) => [s.key, s.short])) as Record<WatchSourceKey, string>;
const STATUS: Record<WatchSection["status"], string> = { ok: "", empty: "none in window", loading: "loading…", error: "unavailable", "not-configured": "not configured", "not-covered": "not covered" };

const day = (iso: string) => String(iso || "").slice(0, 10);
/** Alert kind of each source, for the trade-age words and tiers (shared/tradeAge.mjs). */
const AGE_KIND: Record<WatchSourceKey, string> = { congress: "symbol-trade", insiders: "form4", whales: "whale", stakes: "stake", contracts: "contract", lobbying: "lobbying", filings: "8-k", news: "news" };

function Times({ e }: { e: WatchEvent }) {
  if (e.source === "news") return <small className="watch-when">published {when(e.publishedAt)} · {ageLabel(e.publishedAt)} ago</small>;
  if (e.source === "contracts") return <small className="watch-when">action {day(e.eventAt)} · USAspending gives no publish date</small>;
  return (
    <small className="watch-when">
      {e.source === "whales" ? "quarter end" : e.source === "lobbying" ? "period end" : "event"} {day(e.eventAt) || "—"} · disclosed {e.publishedAt.length > 10 ? when(e.publishedAt) : day(e.publishedAt) || "—"}
      {" · lag "}<Lag days={e.lag} due={DUE[e.source] || 45} />
      {e.late ? <b className="late"> · late (over 45 days)</b> : null}
    </small>
  );
}

function F4Lines({ e }: { e: WatchEvent }) {
  if (!e.lines?.length) return null;
  return (
    <ul className="watch-lines">
      {e.lines.slice(0, 4).map((l, i) => (
        <li key={i}>
          <b className={l.code === "P" ? "up" : l.code === "S" ? "down" : ""}>{l.code}</b> {l.shares != null ? Math.round(l.shares).toLocaleString("en-US") : "—"} sh
          {l.price ? ` @ $${l.price}` : ""}{l.value ? ` · $${Math.round(l.value).toLocaleString("en-US")}` : ""} · {l.traded}{l.plan ? " · 10b5-1" : ""}
        </li>
      ))}
      {e.lines.length > 4 ? <li className="dim">+{e.lines.length - 4} more lines in the filing</li> : null}
    </ul>
  );
}

function EventRow({ e, onFollow }: { e: WatchEvent; onFollow: (action: string) => void }) {
  return (
    <li className={`watch-event src-${e.source}`}>
      <span className="watch-src" title={e.feed}>{SHORT[e.source]}</span>
      <div>
        <p className="watch-title">
          {e.source === "congress" && e.bioguide ? <button className="link" onClick={() => onFollow(`timeline:${e.bioguide}`)} title="Open their timeline">{e.title}</button> : e.title}
          {e.side ? <b className={e.side === "buy" ? "up" : "down"}> · {e.side}</b> : null}
        </p>
        {e.detail && e.detail !== e.title ? <p className="watch-detail">{e.detail}</p> : null}
        <F4Lines e={e} />
        <Times e={e} />
        {e.source === "news" ? null : <AgeLine kind={AGE_KIND[e.source]} eventAt={e.eventAt} filedAt={e.publishedAt} />}
      </div>
      {e.link ? <a href={e.link} target="_blank" rel="noopener noreferrer" title={`Open the source (${e.feed})`}><Icon name="external" size={12} /></a> : <span />}
    </li>
  );
}

/** Unified, newest-first activity for one watched ticker. Every row names its feed; every section its as-of and lag rule. */
export function ActivityFeed({ symbol, days, onFollow }: { symbol: string; days: number; onFollow: (action: string) => void }) {
  const res = useTickerActivity(symbol, days);
  const [only, setOnly] = useState<WatchSourceKey | null>(null);
  const events = useMemo(() => (res?.events || []).filter((e) => !only || e.source === only), [res, only]);
  if (!res) return <p className="watch-note">Loading {symbol} activity…</p>;
  if (!res.ok) return <p className="watch-note">{res.error || "Activity unavailable."}</p>;
  const sections = res.sections || [];
  return (
    <div className="watch-feed">
      <div className="watch-sections" role="group" aria-label="Filter by source">
        <button aria-pressed={!only} onClick={() => setOnly(null)}>All <b>{res.events.length}</b></button>
        {sections.map((s) => (
          <button
            key={s.key}
            aria-pressed={only === s.key}
            className={`st-${s.status}`}
            disabled={!s.count}
            onClick={() => setOnly(only === s.key ? null : s.key)}
            title={[s.source, s.asOf ? `as of ${when(s.asOf)}` : "", s.latency, s.note].filter(Boolean).join("\n")}
          >
            {s.label} <b>{s.count || STATUS[s.status] || 0}</b>
          </button>
        ))}
      </div>
      {sections.filter((s) => s.status === "not-configured" || s.status === "error" || s.status === "loading" || s.status === "not-covered").map((s) => (
        <p key={s.key} className={`watch-note st-${s.status}`}><b>{s.label}:</b> {s.status === "not-configured" ? "lobbying feed not configured" : STATUS[s.status]}{s.note ? ` — ${s.note}` : ""}</p>
      ))}
      {events.length ? <ol className="watch-events">{events.map((e) => <EventRow key={e.id} e={e} onFollow={onFollow} />)}</ol> : <p className="watch-note">No events in the feed window.</p>}
      <details className="watch-srcs">
        <summary>Sources, as-of and latency</summary>
        <ul>
          {sections.map((s) => (
            <li key={s.key}><b>{s.label}</b> {s.source || "—"}{s.asOf ? ` · as of ${when(s.asOf)}` : ""}{s.latency ? ` · ${s.latency}` : ""}{s.note ? ` · ${s.note}` : ""}</li>
          ))}
          {res.quote ? <li><b>Price</b> {res.quote.source}{res.quote.asOf ? ` · last trade ${when(res.quote.asOf)}` : ""} · {res.quote.latency || res.quote.error}</li> : null}
        </ul>
      </details>
    </div>
  );
}
