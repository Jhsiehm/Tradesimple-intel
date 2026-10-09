import { useEffect, useMemo, useRef, useState } from "react";
import { nyDaysAgo } from "../../shared/dates.mjs";
import { ALERT_LEVELS, ALERT_RULE, countAlertLevels, triageAlerts, type AlertLevel } from "../../shared/intel.mjs";
import { RESEARCH_RULE } from "../../shared/taskSchedule.mjs";
import { api, DEMO, when } from "../lib/api";
import { memberShareUrl } from "../lib/share";
import { toggleMember, toggleSymbol, useWatch } from "../lib/useWatch";
import { LiveToasts, SEEN_EVENT } from "../live/LiveToasts";
import { onLivePush } from "../live/stream";
import { useLiveSync } from "../live/useLiveSync";
import { Icon, IconLabel } from "../ui/icons/Icon";
import { AgeLine } from "../ui/AgeLine";
import { AGE_RULE, type TradeAge } from "../../shared/tradeAge.mjs";
import { PhoneNotify } from "./PhoneNotify";

type Pin = { kind: "member" | "symbol"; id: string; label: string; chamber?: string };
type Live = { detectedAt: string; detection: string; filingLag: string };
type Alert = { id: string; kind: string; date: string; title: string; detail: string; link?: string; action: string; late: boolean; severity?: AlertLevel; source?: string; asOf?: string; latency?: string; pins?: Pin[]; live?: Live };
type Source = { label: string; source: string; asOf?: string; latency: string };
type AlertsRes = { ok: boolean; asOf?: string; items: Alert[]; sources?: Source[] };

const SEEN = "intel:alerts:seen:v1";
const DISMISSED = "intel:alerts:dismissed:v1";
const LATE = "intel:alerts:late:v1";
const NOTIFY = "intel:alerts:notify:v1";
const POLL_MS = 5 * 60 * 1000;
const KIND: Record<string, string> = { "member-trade": "MEMBER", "symbol-trade": "CONGRESS", form4: "FORM 4", lobbying: "LDA", "late-filing": "LATE", research: "RESEARCH" };
const FEED: Record<string, string> = { "member-trade": "Congress trades", "symbol-trade": "Congress trades", "late-filing": "Congress trades", form4: "Form 4", lobbying: "Lobbying", research: "Research tasks" };
const WATCH_KIND: Record<string, string> = { contract: "CONTRACT", stake: "13D/G", whale: "13F", "8-k": "8-K", news: "NEWS" };
const LEVEL_LABEL: Record<AlertLevel, string> = { high: "HIGH", elevated: "ELEVATED", routine: "ROUTINE" };
/** Trade-age fields the server adds to every row (shared/tradeAge.mjs ageAlert). */
type Aged = { age?: TradeAge; baseSeverity?: string };
const RULE_PARTS = ALERT_RULE.split(/(?<=\.)\s+(?=[A-Z]+:|Otherwise)/);
const LEVEL_RULE: Record<AlertLevel, string> = {
  high: RULE_PARTS.find((p) => p.startsWith("HIGH:")) || ALERT_RULE,
  elevated: RULE_PARTS.find((p) => p.startsWith("ELEVATED:")) || ALERT_RULE,
  routine: "ROUTINE: under every HIGH and ELEVATED threshold."
};

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
  }, [query]);

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

  const markRead = (ids: string[]) => setSeen(writeSet(SEEN, new Set([...seen, ...ids])));
  const dismiss = (id: string) => {
    markRead([id]);
    setDismissed(writeSet(DISMISSED, new Set([...dismissed, id])));
  };
  const restore = (id: string) => { const next = new Set(dismissed); next.delete(id); setDismissed(writeSet(DISMISSED, next)); };
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
    if (notify) { setNotify(false); localStorage.setItem(NOTIFY, "0"); return; }
    if (typeof Notification === "undefined") return;
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm === "granted") { setNotify(true); localStorage.setItem(NOTIFY, "1"); }
  };

  const row = (a: Alert) => {
    const lv = levelOf(a);
    const feed = feeds.get(FEED[a.kind] || (WATCH_KIND[a.kind] ? "Watchlist filings" : ""));
    const gone = dismissed.has(a.id);
    return (
      <article key={a.id} className={`alerts-row sev-${lv}${seen.has(a.id) ? "" : " unread"}${gone ? " dismissed" : ""}`}>
        <header className="alerts-row-head">
          <span className={`alerts-sev sev-${lv}`} title={LEVEL_RULE[lv]}>{LEVEL_LABEL[lv]}</span>
          <span className={`alerts-kind${a.late ? " late" : ""}`}>{KIND[a.kind] || WATCH_KIND[a.kind] || a.kind}</span>
          <time className="alerts-date" dateTime={a.date} title={a.kind === "research" ? "Run date (ET)" : "Filed / posted date"}>{a.date}</time>
        </header>
        <button className="alerts-title" onClick={() => follow(a)} title={a.kind === "research" ? "Open the stored result in Ask" : "Open dossier"}>{a.title}</button>
        <p className="alerts-detail">{a.detail}</p>
        {a.kind === "research" ? null : <AgeLine age={(a as Aged).age} kind={a.kind} filedAt={a.date} baseSeverity={(a as Aged).baseSeverity} />}
        <p className="alerts-meta" title={a.latency || feed?.latency}>
          <span>{a.source || feed?.source || "Source unknown"}</span>
          {a.asOf || feed?.asOf ? <span>as of {when(a.asOf || feed?.asOf || "")}</span> : null}
          {a.live && !a.detail.includes(a.live.detection) ? <span className="alerts-live" title={`Pushed by the live poller at ${when(a.live.detectedAt)}${a.live.filingLag ? ` · ${a.live.filingLag}` : ""}`}>{a.live.detection}</span> : null}
        </p>
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
            {!seen.has(a.id) && !gone ? <button onClick={() => markRead([a.id])} title="Mark read"><IconLabel icon="check" hide>Mark read</IconLabel></button> : null}
            {gone ? <button onClick={() => restore(a.id)} title="Restore"><IconLabel icon="restore" hide>Restore</IconLabel></button> : <button onClick={() => dismiss(a.id)} title="Dismiss"><IconLabel icon="dismiss" hide>Dismiss</IconLabel></button>}
          </span>
        </div>
      </article>
    );
  };

  const total = counts.high + counts.elevated + counts.routine;
  return (
    <>
      <button className={`ghost panels-btn alerts-btn${unread.length ? " hot" : ""}`} aria-expanded={open} onClick={() => onOpen(!open)} title="Watchlist alerts">
        <Icon name="bell" /><span className="ic-lbl">Alerts{unread.length ? ` · ${unread.length}` : ""}</span>
      </button>
      {DEMO ? null : <LiveToasts onFollow={onFollow} />}
      {open ? (
        <div className="panels-menu alerts-menu" role="dialog" aria-label="Alerts">
          <h4>
            Alerts · triage
            <small>
              {watch.symbols.length} tickers · {watch.members.length} members watched · last 90 days by filed date · refreshed every 5 min and on each live push
              {res?.asOf ? ` · fetched ${when(res.asOf)}` : ""}
            </small>
          </h4>
          <div className="alerts-opts">
            <label><input type="checkbox" checked={allLate} onChange={toggleLate} /> All late filings (&gt;45 days)</label>
            <label><input type="checkbox" checked={notify} onChange={() => void toggleNotify()} disabled={typeof Notification === "undefined"} /> Browser notifications</label>
          </div>
          <PhoneNotify />
          {items.length ? (
            <div className="alerts-bar">
              <div className="alerts-filter" role="group" aria-label="Filter by severity">
                <button aria-pressed={level === null} onClick={() => setLevel(null)}><Icon name="filter" /> All <b>{total}</b></button>
                {ALERT_LEVELS.map((lv) => (
                  <button key={lv} className={`sev-${lv}`} aria-pressed={level === lv} onClick={() => setLevel(level === lv ? null : lv)} title={LEVEL_RULE[lv]}>
                    {LEVEL_LABEL[lv]} <b>{counts[lv]}</b>
                  </button>
                ))}
              </div>
              <div className="alerts-bulk">
                <button disabled={!unread.length} onClick={() => markRead(items.map((a) => a.id))}><IconLabel icon="checks">Mark all read{unread.length ? ` · ${unread.length}` : ""}</IconLabel></button>
                {dismissed.size ? (
                  <button aria-pressed={showDismissed} onClick={() => setShowDismissed(!showDismissed)}>
                    {showDismissed ? "Hide dismissed" : "Show dismissed"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {empty && !items.length ? <p className="note">Star a ticker (☆ in a dossier) or a member (☆ on their card) to get alerts for new trades, Form 4s, and lobbying filings.</p> : null}
          {!empty && res && !items.length ? <p className="note">{res.ok ? "Nothing new in the last 90 days for this watchlist." : "Alerts feed unavailable."}</p> : null}
          {items.length && !queue.length ? <p className="note">No {level ? LEVEL_LABEL[level].toLowerCase() : ""} alerts left in the queue.</p> : null}
          {ALERT_LEVELS.map((lv) => {
            const group = queue.filter((a) => levelOf(a) === lv);
            if (!group.length) return null;
            return (
              <section key={lv} className="alerts-group">
                <h5 className={`sev-${lv}`}>{LEVEL_LABEL[lv]} <b>{group.length}</b><small>{LEVEL_RULE[lv]}</small></h5>
                {group.map(row)}
              </section>
            );
          })}
          {res?.sources ? (
            <p className="note alerts-src">
              {res.sources.map((s) => <span key={s.label}><b>{s.label}</b> {s.source}{s.asOf ? ` · as of ${when(s.asOf)}` : ""} · {s.latency}</span>)}
              <span className="alerts-rule">Severity: {ALERT_RULE}{feeds.has("Research tasks") ? ` ${RESEARCH_RULE}` : ""} {AGE_RULE}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
