import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { nyDaysAgo } from "../../shared/dates.mjs";
import { ALERT_LEVELS, countAlertLevels, triageAlerts, type AlertLevel } from "../../shared/intel.mjs";
import { api, DEMO, when } from "../lib/api";
import { memberShareUrl } from "../lib/share";
import { toggleMember, toggleSymbol, useWatch } from "../lib/useWatch";
import { LiveToasts, SEEN_EVENT } from "../live/LiveToasts";
import { onLivePush } from "../live/stream";
import { useLiveSync } from "../live/useLiveSync";
import { Icon, IconLabel } from "../ui/icons/Icon";
import { AgeLine } from "../ui/AgeLine";
import { type TradeAge } from "../../shared/tradeAge.mjs";
import { PhoneNotify } from "./PhoneNotify";
import { AlertsGuide, type AlertSource } from "./AlertsGuide";
import "./alerts.css";

type Pin = { kind: "member" | "symbol"; id: string; label: string; chamber?: string };
type Live = { detectedAt: string; detection: string; filingLag: string };
type Alert = { id: string; kind: string; date: string; title: string; detail: string; link?: string; action: string; late: boolean; severity?: AlertLevel; source?: string; asOf?: string; latency?: string; pins?: Pin[]; live?: Live };
type AlertsRes = { ok: boolean; asOf?: string; items: Alert[]; sources?: AlertSource[] };

const SEEN = "intel:alerts:seen:v1";
const DISMISSED = "intel:alerts:dismissed:v1";
const LATE = "intel:alerts:late:v1";
const NOTIFY = "intel:alerts:notify:v1";
const POLL_MS = 5 * 60 * 1000;
const KIND: Record<string, string> = { "member-trade": "MEMBER", "symbol-trade": "CONGRESS", form4: "FORM 4", lobbying: "LDA", "late-filing": "LATE", research: "RESEARCH" };
const FEED: Record<string, string> = { "member-trade": "Congress trades", "symbol-trade": "Congress trades", "late-filing": "Congress trades", form4: "Form 4", lobbying: "Lobbying", research: "Research tasks" };
const WATCH_KIND: Record<string, string> = { contract: "CONTRACT", stake: "13D/G", whale: "13F", "8-k": "8-K", news: "NEWS" };
const LEVEL_LABEL: Record<AlertLevel, string> = { high: "High", elevated: "Elevated", routine: "Routine" };
const LEVEL_HINT: Record<AlertLevel, string> = { high: "Review first", elevated: "Notable activity", routine: "Other updates" };
const VIEWS = ["inbox", "settings", "guide"] as const;
type AlertsView = typeof VIEWS[number];
const VIEW_LABEL: Record<AlertsView, string> = { inbox: "Inbox", settings: "Settings", guide: "Guide" };
/** Trade-age fields the server adds to every row (shared/tradeAge.mjs ageAlert). */
type Aged = { age?: TradeAge; baseSeverity?: string };

const readSet = (key: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set<string>(); } };
const writeSet = (key: string, set: Set<string>) => { const keep = [...set].slice(-800); localStorage.setItem(key, JSON.stringify(keep)); return new Set(keep); };
const levelOf = (a: Alert): AlertLevel => (a.severity && ALERT_LEVELS.includes(a.severity) ? a.severity : "routine");

/** Watchlist alert triage. Research only: rows pin, share, and link to filings and dossiers, never to an order ticket. */
export function AlertsMenu({ open, onOpen, onFollow }: { open: boolean; onOpen: (open: boolean) => void; onFollow: (action: string) => void }) {
  const { watch, hasMember, hasSymbol } = useWatch();
  const [res, setRes] = useState<AlertsRes | null>(null);
  const [seen, setSeen] = useState(() => readSet(SEEN));
  const [dismissed, setDismissed] = useState(() => readSet(DISMISSED));
  const [level, setLevel] = useState<AlertLevel | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [view, setView] = useState<AlertsView>("inbox");
  const [collapsed, setCollapsed] = useState(new Set<AlertLevel>(["routine"]));
  const [retry, setRetry] = useState(0);
  const [notifyNote, setNotifyNote] = useState("");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const filters = useRef<HTMLDivElement>(null);
  const tabs = useRef<Partial<Record<AlertsView, HTMLButtonElement | null>>>({});
  const [allLate, setAllLate] = useState(() => localStorage.getItem(LATE) === "1");
  const [notify, setNotify] = useState(() => localStorage.getItem(NOTIFY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted");
  const notified = useRef(new Set<string>());

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (watch.symbols.length) p.set("symbols", watch.symbols.join(","));
    if (watch.members.length) p.set("members", watch.members.map((m) => m.bioguide).join(","));
    if (allLate) p.set("late", "all");
    p.set("since", nyDaysAgo(90));
    return p.toString();
  }, [watch, allLate]);
  const empty = !watch.symbols.length && !watch.members.length && !allLate;

  useEffect(() => {
    let cancel = false;
    const load = () => api<AlertsRes>(DEMO ? "/api/alerts?late=all" : `/api/alerts?${query}`)
      .then((body) => { if (!cancel) setRes(body); })
      .catch(() => { if (!cancel) setRes({ ok: false, items: [] }); });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    let soon = 0;
    const off = DEMO ? () => {} : onLivePush(() => { window.clearTimeout(soon); soon = window.setTimeout(load, 800); });
    return () => { cancel = true; window.clearInterval(timer); window.clearTimeout(soon); off(); };
  }, [query, retry]);

  useEffect(() => {
    if (open) tabs.current.inbox?.focus();
    if (!open) setView("inbox");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) onOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, onOpen]);

  useLiveSync(watch.symbols);
  useEffect(() => {
    const reread = () => setSeen(readSet(SEEN));
    window.addEventListener(SEEN_EVENT, reread);
    return () => window.removeEventListener(SEEN_EVENT, reread);
  }, []);

  const items = res?.items || [];
  const unread = items.filter((a) => !seen.has(a.id) && !dismissed.has(a.id));
  const hide = showDismissed ? null : dismissed;
  const counts = useMemo(() => countAlertLevels(items, hide), [items, hide]);
  const queue = useMemo(() => triageAlerts(items, { level, hide }), [items, level, hide]);
  const feeds = useMemo(() => new Map((res?.sources || []).map((s) => [s.label, s])), [res]);

  useEffect(() => {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const a of unread.slice(0, 3)) {
      if (notified.current.has(a.id)) continue;
      notified.current.add(a.id);
      new Notification(`TradeSimple · ${a.title}`, { body: a.detail, tag: a.id });
    }
  }, [unread, notify]);

  const focusFilter = () => filters.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  const markRead = (ids: string[]) => setSeen(writeSet(SEEN, new Set([...seen, ...ids])));
  const dismiss = (id: string) => {
    markRead([id]);
    setDismissed(writeSet(DISMISSED, new Set([...dismissed, id])));
    focusFilter();
  };
  const restore = (id: string) => { const next = new Set(dismissed); next.delete(id); setDismissed(writeSet(DISMISSED, next)); focusFilter(); };
  const follow = (a: Alert) => { markRead([a.id]); onOpen(false); onFollow(a.action); };
  const pin = (p: Pin) => (p.kind === "member" ? toggleMember({ bioguide: p.id, name: p.label, chamber: p.chamber }) : toggleSymbol(p.id));
  const share = (a: Alert) => {
    const member = a.pins?.find((p) => p.kind === "member");
    const url = member ? memberShareUrl(member.id, member.label) : a.link || "";
    const text = `${a.title} · ${a.date} · ${a.source || FEED[a.kind] || ""}${url ? `\n${url}` : ""}`;
    void navigator.clipboard?.writeText(text).then(() => { setCopied(a.id); window.setTimeout(() => setCopied((c) => (c === a.id ? null : c)), 1600); });
  };

  const toggleLate = () => { const v = !allLate; setAllLate(v); localStorage.setItem(LATE, v ? "1" : "0"); };
  const toggleNotify = async () => {
    setNotifyNote("");
    if (notify) { setNotify(false); localStorage.setItem(NOTIFY, "0"); return; }
    if (typeof Notification === "undefined") return;
    try {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm === "granted") { setNotify(true); localStorage.setItem(NOTIFY, "1"); }
      else setNotifyNote(perm === "denied" ? "Notifications are blocked. Enable them in your browser’s site settings." : "Notifications are still off. You can enable them here later.");
    } catch { setNotifyNote("Browser notifications are unavailable right now."); }
  };

  const close = () => { onOpen(false); trigger.current?.focus(); };
  const selectView = (next: AlertsView) => { setView(next); tabs.current[next]?.focus(); };
  const chooseLevel = (next: AlertLevel | null) => {
    setLevel(next);
    if (next) setCollapsed((previous) => { const updated = new Set(previous); updated.delete(next); return updated; });
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, current: AlertsView) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const index = VIEWS.indexOf(current);
    const next = event.key === "Home" ? VIEWS[0] : event.key === "End" ? VIEWS[2] : VIEWS[(index + (event.key === "ArrowRight" ? 1 : 2)) % VIEWS.length];
    selectView(next);
  };

  const row = (a: Alert) => {
    const lv = levelOf(a);
    const feed = feeds.get(FEED[a.kind] || (WATCH_KIND[a.kind] ? "Watchlist filings" : ""));
    const gone = dismissed.has(a.id);
    return (
      <article key={a.id} className={`alerts-row sev-${lv}${seen.has(a.id) ? "" : " unread"}${gone ? " dismissed" : ""}`}>
        <header className="alerts-row-head">
          <span className={`alerts-kind${a.late ? " late" : ""}`}>{KIND[a.kind] || WATCH_KIND[a.kind] || a.kind}</span>
          {!seen.has(a.id) && !gone ? <span className="alerts-unread">Unread</span> : null}
          <time className="alerts-date" dateTime={a.date} title={a.kind === "research" ? "Run date (ET)" : "Filed / posted date"}>{a.date}</time>
        </header>
        <button className="alerts-title" onClick={() => follow(a)} title={a.kind === "research" ? "Open the stored result in Ask" : "Open dossier"}>{a.title}</button>
        <p className="alerts-detail">{a.detail}</p>
        {a.kind === "research" ? null : <AgeLine age={(a as Aged).age} kind={a.kind} filedAt={a.date} baseSeverity={(a as Aged).baseSeverity} />}
        <details className="alerts-row-more">
          <summary>Source & actions</summary>
          <p className="alerts-meta">
          <span>{a.source || feed?.source || "Source unknown"}</span>
          {a.asOf || feed?.asOf ? <span>as of {when(a.asOf || feed?.asOf || "")}</span> : null}
          {a.live && !a.detail.includes(a.live.detection) ? <span className="alerts-live" title={`Pushed by the live poller at ${when(a.live.detectedAt)}${a.live.filingLag ? ` · ${a.live.filingLag}` : ""}`}>{a.live.detection}</span> : null}
        </p>
        {a.latency || feed?.latency ? <p className="alerts-latency">{a.latency || feed?.latency}</p> : null}
        <div className="alerts-actions">
          {(a.pins || []).map((p) => {
            const on = p.kind === "member" ? hasMember(p.id) : hasSymbol(p.id);
            return (
              <button key={`${p.kind}:${p.id}`} aria-pressed={on} onClick={() => pin(p)} title={on ? "Remove from watchlist" : "Add to watchlist"}>
                <IconLabel icon={on ? "star-on" : "star"}>{p.label}</IconLabel>
              </button>
            );
          })}
          <button onClick={() => share(a)} title="Copy a share line with the source link"><IconLabel icon={copied === a.id ? "check" : "share"} hide>{copied === a.id ? "Copied" : "Share"}</IconLabel></button>
          {a.link ? <a href={a.link} target="_blank" rel="noreferrer" onClick={() => markRead([a.id])} title="Open the original filing"><IconLabel icon="external" hide>Filing</IconLabel></a> : null}
          <span className="alerts-end">
            {!seen.has(a.id) && !gone ? <button onClick={() => { markRead([a.id]); focusFilter(); }} title="Mark read"><IconLabel icon="check" hide>Mark read</IconLabel></button> : null}
            {gone ? <button onClick={() => restore(a.id)} title="Restore"><IconLabel icon="restore" hide>Restore</IconLabel></button> : <button onClick={() => dismiss(a.id)} title="Dismiss"><IconLabel icon="dismiss" hide>Dismiss</IconLabel></button>}
          </span>
        </div>
        </details>
      </article>
    );
  };

  const total = counts.high + counts.elevated + counts.routine;
  const dismissedCount = items.filter((a) => dismissed.has(a.id)).length;
  const emptyState = () => {
    if (!res) return <p className="alerts-empty" role="status">Loading alerts…</p>;
    if (!res.ok) return (
      <div className="alerts-empty" role="status">
        <h3>Alerts are unavailable</h3>
        <p>We couldn’t load the feed. Your watchlist is saved.</p>
        <button onClick={() => { setRes(null); setRetry((value) => value + 1); }}>Try again</button>
      </div>
    );
    if (empty && !items.length) return (
      <div className="alerts-empty">
        <Icon name="bell" />
        <h3>Your watchlist, in one place</h3>
        <p>Star a ticker or member to see their new trades and filings here.</p>
        <button onClick={toggleLate}>Browse all late filings</button>
      </div>
    );
    if (!items.length) return (
      <div className="alerts-empty">
        <h3>You’re caught up</h3>
        <p>No alerts in the last 90 days for your current settings.</p>
        <button onClick={() => selectView("settings")}>Review alert settings</button>
      </div>
    );
    if (!queue.length) return (
      <div className="alerts-empty">
        <h3>No {level ? `${LEVEL_LABEL[level].toLowerCase()} ` : ""}alerts to show</h3>
        <p>{dismissedCount ? "Dismissed alerts are available below." : "Try another priority filter."}</p>
        {level ? <button onClick={() => chooseLevel(null)}>Show all priorities</button> : null}
      </div>
    );
    return null;
  };
  return (
    <>
      <button ref={trigger} className={`ghost panels-btn alerts-btn${unread.length ? " hot" : ""}`} aria-expanded={open} aria-haspopup="dialog" aria-controls={`${id}-panel`} onClick={() => onOpen(!open)} title="Watchlist alerts">
        <Icon name="bell" /><span className="ic-lbl">Alerts{unread.length ? ` · ${unread.length}` : ""}</span>
      </button>
      {DEMO ? null : <LiveToasts onFollow={onFollow} />}
      {open ? (
        <div ref={panel} id={`${id}-panel`} className="panels-menu alerts-menu" role="dialog" aria-labelledby={`${id}-title`} onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); close(); }
        }}>
          <header className="alerts-heading">
            <div><h2 id={`${id}-title`}>Alerts <span aria-live="polite">{unread.length} unread</span></h2><p>Watching {watch.symbols.length} tickers · {watch.members.length} members</p></div>
            <button className="alerts-close" onClick={close} aria-label="Close alerts"><Icon name="close" /></button>
          </header>
          <div className="alerts-tabs" role="tablist" aria-label="Alerts views">
            {VIEWS.map((key) => (
              <button key={key} ref={(element) => { tabs.current[key] = element; }}
                id={`${id}-tab-${key}`} role="tab" aria-selected={view === key}
                aria-controls={`${id}-${key}`} tabIndex={view === key ? 0 : -1}
                onClick={() => selectView(key)} onKeyDown={(event) => tabKey(event, key)}>
                {VIEW_LABEL[key]}
              </button>
            ))}
          </div>
          <div className="alerts-tabpanel" id={`${id}-inbox`} role="tabpanel" aria-labelledby={`${id}-tab-inbox`} hidden={view !== "inbox"}>
            <div className="alerts-inbox-top">
              <div ref={filters} className="alerts-filter" role="group" aria-label="Filter by severity">
                <button aria-pressed={level === null} onClick={() => chooseLevel(null)}>All <b>{total}</b></button>
                {ALERT_LEVELS.map((lv) => (
                  <button key={lv} className={`sev-${lv}`} aria-pressed={level === lv} onClick={() => chooseLevel(level === lv ? null : lv)}>
                    {LEVEL_LABEL[lv]} <b>{counts[lv]}</b>
                  </button>
                ))}
              </div>
              {items.length ? <div className="alerts-bulk"><span>Highest priority first</span><button disabled={!unread.length} onClick={() => { markRead(items.map((a) => a.id)); focusFilter(); }}><IconLabel icon="checks">Mark all read</IconLabel></button></div> : null}
            </div>
            <div className="alerts-queue">
              {emptyState()}
          {ALERT_LEVELS.map((lv) => {
            const group = queue.filter((a) => levelOf(a) === lv);
            if (!group.length) return null;
            return (
              <details key={lv} className="alerts-group" open={!collapsed.has(lv)} onToggle={(event) => {
                const expanded = event.currentTarget.open;
                setCollapsed((previous) => {
                  if (previous.has(lv) === !expanded) return previous;
                  const updated = new Set(previous);
                  if (expanded) updated.delete(lv); else updated.add(lv);
                  return updated;
                });
              }}>
                <summary><span className={`sev-${lv}`}>{LEVEL_LABEL[lv]} <b>{group.length}</b></span><small>{LEVEL_HINT[lv]}</small><Icon name="chevron-down" /></summary>
                {group.map(row)}
              </details>
            );
          })}
            </div>
            <footer className="alerts-footer"><span>Last 90 days{allLate ? " · includes all late filings" : ""}{res?.asOf ? <small>Updated {when(res.asOf)}</small> : null}</span>{dismissedCount ? <button aria-pressed={showDismissed} onClick={() => setShowDismissed(!showDismissed)}>{showDismissed ? "Hide dismissed" : `Dismissed · ${dismissedCount}`}</button> : null}</footer>
          </div>
          <div className="alerts-tabpanel alerts-settings" id={`${id}-settings`} role="tabpanel" aria-labelledby={`${id}-tab-settings`} hidden={view !== "settings"}>
            <h3>What appears in your inbox</h3>
            <p className="alerts-intro">Trades and filings for the tickers and members you star.</p>
            <label className="alerts-setting"><input type="checkbox" checked={allLate} onChange={toggleLate} /><span>Include all late filings<small>Add Congress filings more than 45 days late, even outside your watchlist.</small></span></label>
            <h3>Notification delivery</h3>
            <label className="alerts-setting"><input type="checkbox" checked={notify} onChange={() => void toggleNotify()} disabled={typeof Notification === "undefined"} /><span>Browser notifications<small>{typeof Notification === "undefined" ? "Not supported in this browser." : notify ? "On for this browser." : "Off. Alerts still appear in your inbox."}</small></span></label>
            {notifyNote ? <p className="alerts-intro" role="status">{notifyNote}</p> : null}
            <PhoneNotify />
          </div>
          <div className="alerts-tabpanel" id={`${id}-guide`} role="tabpanel" aria-labelledby={`${id}-tab-guide`} hidden={view !== "guide"}><AlertsGuide sources={res?.sources || []} /></div>
        </div>
      ) : null}
    </>
  );
}
