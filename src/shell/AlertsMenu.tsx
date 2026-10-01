import { useEffect, useMemo, useRef, useState } from "react";
import { api, DEMO, when } from "../lib/api";
import { useWatch } from "../lib/useWatch";

type Alert = { id: string; kind: string; date: string; title: string; detail: string; link?: string; action: string; late: boolean };
type AlertsRes = { ok: boolean; asOf?: string; items: Alert[]; sources?: { label: string; source: string; asOf?: string; latency: string }[] };

const SEEN = "intel:alerts:seen:v1";
const LATE = "intel:alerts:late:v1";
const NOTIFY = "intel:alerts:notify:v1";
const POLL_MS = 5 * 60 * 1000;
const KIND: Record<string, string> = { "member-trade": "MEMBER", "symbol-trade": "CONGRESS", form4: "FORM 4", lobbying: "LDA", "late-filing": "LATE" };

const readSeen = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(SEEN) || "[]")); } catch { return new Set<string>(); } };

/** Watchlist alerts. Research only: rows link to filings and dossiers, never to an order ticket. */
export function AlertsMenu({ open, onOpen, onFollow }: { open: boolean; onOpen: (open: boolean) => void; onFollow: (action: string) => void }) {
  const { watch } = useWatch();
  const [res, setRes] = useState<AlertsRes | null>(null);
  const [seen, setSeen] = useState(readSeen);
  const [allLate, setAllLate] = useState(() => localStorage.getItem(LATE) === "1");
  const [notify, setNotify] = useState(() => localStorage.getItem(NOTIFY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted");
  const notified = useRef(new Set<string>());

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (watch.symbols.length) p.set("symbols", watch.symbols.join(","));
    if (watch.members.length) p.set("members", watch.members.map((m) => m.bioguide).join(","));
    if (allLate) p.set("late", "all");
    p.set("since", new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10));
    return p.toString();
  }, [watch, allLate]);
  const empty = !watch.symbols.length && !watch.members.length && !allLate;

  useEffect(() => {
    if (empty) { setRes({ ok: true, items: [] }); return; }
    let cancel = false;
    const load = () => api<AlertsRes>(DEMO ? "/api/alerts?late=all" : `/api/alerts?${query}`)
      .then((body) => { if (!cancel) setRes(body); })
      .catch(() => { if (!cancel) setRes({ ok: false, items: [] }); });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { cancel = true; window.clearInterval(timer); };
  }, [query, empty]);

  const items = res?.items || [];
  const unread = items.filter((a) => !seen.has(a.id));

  useEffect(() => {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const a of unread.slice(0, 3)) {
      if (notified.current.has(a.id)) continue;
      notified.current.add(a.id);
      new Notification(`TradeSimple · ${a.title}`, { body: a.detail, tag: a.id });
    }
  }, [unread, notify]);

  useEffect(() => {
    if (!open || !unread.length) return;
    const next = new Set([...seen, ...items.map((a) => a.id)]);
    const keep = [...next].slice(-800);
    localStorage.setItem(SEEN, JSON.stringify(keep));
    const timer = window.setTimeout(() => setSeen(new Set(keep)), 1500);
    return () => window.clearTimeout(timer);
  }, [open, items.length]);

  const toggleLate = () => { const v = !allLate; setAllLate(v); localStorage.setItem(LATE, v ? "1" : "0"); };
  const toggleNotify = async () => {
    if (notify) { setNotify(false); localStorage.setItem(NOTIFY, "0"); return; }
    if (typeof Notification === "undefined") return;
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm === "granted") { setNotify(true); localStorage.setItem(NOTIFY, "1"); }
  };

  return (
    <>
      <button className={`ghost panels-btn alerts-btn${unread.length ? " hot" : ""}`} aria-expanded={open} onClick={() => onOpen(!open)}>
        Alerts{unread.length ? ` · ${unread.length}` : ""}
      </button>
      {open ? (
        <div className="panels-menu alerts-menu" role="menu">
          <h4>
            Alerts
            <small>
              {watch.symbols.length} tickers · {watch.members.length} members watched · last 90 days by filed date · checks every 5 min while open
            </small>
          </h4>
          <div className="alerts-opts">
            <label><input type="checkbox" checked={allLate} onChange={toggleLate} /> All late filings (&gt;45 days)</label>
            <label><input type="checkbox" checked={notify} onChange={() => void toggleNotify()} disabled={typeof Notification === "undefined"} /> Browser notifications</label>
          </div>
          {empty ? <p className="note">Star a ticker (☆ in a dossier) or a member (☆ on their card) to get alerts for new trades, Form 4s, and lobbying filings.</p> : null}
          {!empty && res && !items.length ? <p className="note">{res.ok ? "Nothing new in the last 90 days for this watchlist." : "Alerts feed unavailable."}</p> : null}
          {items.slice(0, 80).map((a) => (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              className={`panels-row alert-row${seen.has(a.id) ? "" : " unread"}${a.late ? " late" : ""}`}
              onClick={() => { onOpen(false); onFollow(a.action); }}
              onKeyDown={(e) => { if (e.key === "Enter") { onOpen(false); onFollow(a.action); } }}
            >
              <strong><em>{KIND[a.kind] || a.kind}</em>{a.title}</strong>
              <span>{a.date} · {a.detail}</span>
              {a.link ? <a className="dt-filing" href={a.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Filing ↗</a> : null}
            </div>
          ))}
          {res?.sources ? (
            <p className="note alerts-src">
              {res.sources.map((s) => <span key={s.label} title={s.latency}>{s.label}: {s.source}{s.asOf ? ` · ${when(s.asOf)}` : ""}</span>)}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
