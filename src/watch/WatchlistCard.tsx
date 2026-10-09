import { useEffect, useMemo, useState } from "react";
import { BADGE_DAYS, WATCH_MAX, WATCH_SOURCES, matchTickers, normSymbol, type WatchSourceKey } from "../../shared/watchlist.mjs";
import { askAction } from "../agent/starters";
import { api, when } from "../lib/api";
import { signed } from "../lib/format";
import { addWatchSymbol, moveWatchSymbol, removeWatchSymbol, useWatch } from "../lib/useWatch";
import { Icon, IconLabel } from "../ui/icons/Icon";
import { ActivityFeed } from "./ActivityFeed";
import { useWatchSummary, type WatchRow } from "./useWatchActivity";
import "./watch.css";

type Ticker = { symbol: string; name: string };
const DAYS_KEY = "intel:watch:days:v1";
const SHORT = Object.fromEntries(WATCH_SOURCES.map((s) => [s.key, s.short])) as Record<WatchSourceKey, string>;
const LABEL = Object.fromEntries(WATCH_SOURCES.map((s) => [s.key, s.label])) as Record<WatchSourceKey, string>;

let tickerList: Promise<Ticker[]> | null = null;
const loadTickers = () => (tickerList ||= api<{ items?: Ticker[] }>("/api/tickers").then((r) => (r.items || []).map((t) => ({ symbol: t.symbol, name: t.name })), () => { tickerList = null; return []; }));

function AddTicker({ count, onAdd }: { count: number; onAdd: (symbol: string) => void }) {
  const [q, setQ] = useState("");
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState("");
  const matches = useMemo(() => matchTickers(tickers, q, 8), [tickers, q]);
  const full = count >= WATCH_MAX;
  const add = (t?: Ticker) => {
    const exact = tickers.find((x) => x.symbol === normSymbol(q));
    const chosen = t || matches[pick] || exact;
    if (!chosen) { setErr(q.trim() ? `${normSymbol(q)} is not in the ticker join table (data/tickers.json).` : ""); return; }
    onAdd(chosen.symbol);
    setQ(""); setPick(0); setErr("");
  };
  return (
    <div className="watch-add">
      <input
        value={q}
        disabled={full}
        placeholder={full ? `Watchlist full (${WATCH_MAX})` : "Add ticker or company…"}
        aria-label="Add a ticker to the watchlist"
        aria-autocomplete="list"
        onFocus={() => void loadTickers().then(setTickers)}
        onChange={(e) => { setQ(e.target.value); setPick(0); setErr(""); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setPick((p) => Math.min(matches.length - 1, p + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setPick((p) => Math.max(0, p - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); add(); }
          else if (e.key === "Escape") setQ("");
        }}
      />
      {q && matches.length ? (
        <ul className="watch-suggest" role="listbox">
          {matches.map((t, i) => (
            <li key={t.symbol} role="option" aria-selected={i === pick}>
              <button onMouseDown={(e) => { e.preventDefault(); add(t); }}><b>{t.symbol}</b> {t.name}</button>
            </li>
          ))}
        </ul>
      ) : null}
      {err ? <p className="watch-err">{err}</p> : null}
    </div>
  );
}

function Badges({ row }: { row: WatchRow }) {
  const b = row.badges || {};
  const lobby = row.sections?.find((s) => s.key === "lobbying");
  const keys = WATCH_SOURCES.map((s) => s.key).filter((k) => b[k]?.count);
  return (
    <span className="watch-badges">
      {keys.map((k) => (
        <span key={k} className={`watch-badge src-${k}`} title={`${LABEL[k]}: ${b[k]!.count} made public in the window · newest ${when(b[k]!.newest)}`}>
          {SHORT[k]} <b>{b[k]!.count}</b> <small>{b[k]!.age}</small>
        </span>
      ))}
      {!keys.length && !row.building ? <span className="watch-badge quiet">no activity in window</span> : null}
      {row.building ? <span className="watch-badge quiet">loading…</span> : null}
      {lobby?.status === "not-configured" ? <span className="watch-badge quiet" title={lobby.note}>LDA not configured</span> : null}
    </span>
  );
}

/** Today watchlist: the starred tickers (shared with Alerts), their delayed price, and recent disclosure activity per source. */
export function WatchlistCard({ onFollow }: { onFollow: (action: string) => void }) {
  const { watch } = useWatch();
  const [days, setDays] = useState(() => { const v = Number(localStorage.getItem(DAYS_KEY)); return BADGE_DAYS.includes(v) ? v : 30; });
  const [open, setOpen] = useState<string | null>(null);
  const res = useWatchSummary(watch.symbols, days);
  const rows = new Map((res?.items || []).map((r) => [r.symbol, r]));
  const invalid = new Set(res?.invalid || []);
  useEffect(() => { localStorage.setItem(DAYS_KEY, String(days)); }, [days]);
  useEffect(() => { if (open && !watch.symbols.includes(open)) setOpen(null); }, [open, watch.symbols]);

  return (
    <section className="today-card watch-card">
      <h3>
        Watchlist
        <small>{watch.symbols.length} ticker{watch.symbols.length === 1 ? "" : "s"} · activity made public in the last {days} days · prices delayed (Yahoo){res?.asOf ? ` · fetched ${when(res.asOf)}` : ""}</small>
        <span className="scope inline" role="group" aria-label="Badge window">
          {BADGE_DAYS.map((d) => <button key={d} className={d === days ? "on" : ""} onClick={() => setDays(d)}>{d}d</button>)}
        </span>
      </h3>
      <AddTicker count={watch.symbols.length} onAdd={addWatchSymbol} />
      {!watch.symbols.length ? <p className="today-empty">Add a ticker to follow Congress trades, insider Form 4s, fund 13F/13D/13G filings, federal contracts, lobbying and news for it. Starred tickers also feed Alerts.</p> : null}
      {res && !res.ok ? <p className="watch-err">{res.error || "Watchlist feed unavailable."}</p> : null}
      <ol className="watch-rows">
        {watch.symbols.map((s, i) => {
          const row = rows.get(s);
          const q = row?.quote;
          const expanded = open === s;
          return (
            <li key={s} className={`watch-row${expanded ? " open" : ""}${invalid.has(s) ? " invalid" : ""}`}>
              <div className="watch-line">
                <button className="watch-sym" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s)} title="Show activity">
                  <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} /> <b>{s}</b> <span className="watch-name">{row?.name || (invalid.has(s) ? "not in data/tickers.json" : "")}</span>
                </button>
                <span className="watch-px" title={q?.ok ? `${q.source} · last trade ${when(q.asOf)} · ${q.latency}` : q?.error || ""}>
                  {q?.ok && q.last != null ? <>{q.last.toFixed(2)} <b className={(q.changePct || 0) > 0 ? "up" : (q.changePct || 0) < 0 ? "down" : ""}>{signed(q.changePct, 2, "%")}</b> <small>delayed</small></> : <small>{row ? "no quote" : invalid.has(s) ? "" : "…"}</small>}
                </span>
                {row ? <Badges row={row} /> : <span className="watch-badges" />}
                <span className="watch-acts">
                  <button onClick={() => moveWatchSymbol(s, -1)} disabled={i === 0} title="Move up" aria-label={`Move ${s} up`}><Icon name="chevron-down" size={12} className="flip" /></button>
                  <button onClick={() => moveWatchSymbol(s, 1)} disabled={i === watch.symbols.length - 1} title="Move down" aria-label={`Move ${s} down`}><Icon name="chevron-down" size={12} /></button>
                  {!invalid.has(s) ? <button onClick={() => onFollow(askAction({ title: row?.name ? `${s} · ${row.name}` : s, watch: s }))} title="Ask about this ticker"><IconLabel icon="ask" hide>Ask</IconLabel></button> : null}
                  {!invalid.has(s) ? <button onClick={() => onFollow(`pos:${s}`)} title="Open the ticker dossier"><IconLabel icon="dossier" hide>Dossier</IconLabel></button> : null}
                  <button onClick={() => removeWatchSymbol(s)} title="Remove from watchlist" aria-label={`Remove ${s}`}><Icon name="close" size={12} /></button>
                </span>
              </div>
              {expanded ? <ActivityFeed symbol={s} days={days} onFollow={onFollow} /> : null}
            </li>
          );
        })}
      </ol>
      {res?.latency ? <p className="watch-foot">{res.latency} Research only: no orders are placed from here.</p> : null}
    </section>
  );
}
