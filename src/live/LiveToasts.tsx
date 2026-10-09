import { useEffect, useRef, useState } from "react";
import { IconLabel } from "../ui/icons/Icon";
import { AgeLine } from "../ui/AgeLine";
import { ageAlert } from "../../shared/tradeAge.mjs";
import { onLivePush, type LivePush } from "./stream";
import "./live.css";

const SEEN = "intel:alerts:seen:v1";
export const SEEN_EVENT = "intel:alerts:seen";
const MAX = 4;
/** Routine toasts fade on their own; HIGH and ELEVATED stay until dismissed or opened. */
const ROUTINE_MS = 20_000;
const KIND: Record<string, string> = { "symbol-trade": "CONGRESS", form4: "FORM 4", whale: "13F", stake: "13D/G", contract: "CONTRACT", lobbying: "LDA", "8-k": "8-K", news: "NEWS" };

const readSeen = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(SEEN) || "[]")); } catch { return new Set<string>(); } };

/** Mark alert ids read in the same store the Alerts menu uses, and tell it to re-read. */
export function markAlertsRead(ids: string[]) {
  const keep = [...new Set([...readSeen(), ...ids])].slice(-800);
  localStorage.setItem(SEEN, JSON.stringify(keep));
  window.dispatchEvent(new Event(SEEN_EVENT));
}

function Toast({ row, onClose, onOpen }: { row: LivePush; onClose: () => void; onOpen: () => void }) {
  const l = row.live;
  const detail = [l?.filingLag, l?.detection].reduce((d, part) => (part ? d.replace(` · ${part}`, "") : d), row.detail || "");
  useEffect(() => {
    if (row.severity !== "routine") return;
    const t = window.setTimeout(onClose, ROUTINE_MS);
    return () => window.clearTimeout(t);
  }, [row, onClose]);
  return (
    <article className={`live-toast sev-${row.severity}`} role="status">
      <header>
        <span className="live-toast-kind">{KIND[row.kind] || row.kind.toUpperCase()}</span>
        <span className="live-toast-sev">{row.severity.toUpperCase()}</span>
        {row.replay ? <span className="live-toast-replay" title="Pushed while this tab was disconnected">missed</span> : null}
        <button className="live-toast-x" onClick={onClose} title="Dismiss" aria-label="Dismiss alert">×</button>
      </header>
      <button className="live-toast-title" onClick={onOpen} title="Open the dossier">{row.title}</button>
      {detail ? <p className="live-toast-detail">{detail}</p> : null}
      <p className="live-toast-lag">
        {l?.detection ? <span title="Detected − published by the source">{l.detection}</span> : null}
        {l?.filingLag ? <span title="Published − event date">{l.filingLag}</span> : null}
      </p>
      <AgeLine kind={row.kind} eventAt={l?.eventAt} filedAt={l?.publishedAt || row.date} baseSeverity={(row as { baseSeverity?: string }).baseSeverity} />
      <footer>
        <span>{row.source}</span>
        {row.link ? <a href={row.link} target="_blank" rel="noreferrer" onClick={() => markAlertsRead([row.id])}><IconLabel icon="external">Source</IconLabel></a> : null}
      </footer>
    </article>
  );
}

/** Top-right toasts for detections pushed by the live poller. Opening one marks the matching Alerts row read. */
export function LiveToasts({ onFollow }: { onFollow: (action: string) => void }) {
  const [rows, setRows] = useState<LivePush[]>([]);
  const closers = useRef(new Map<string, () => void>());
  useEffect(() => onLivePush((row) => {
    if (readSeen().has(row.id)) return;
    setRows((list) => (list.some((r) => r.id === row.id) ? list : [ageAlert(row), ...list].slice(0, MAX)));
  }), []);

  const closeOf = (id: string) => {
    let fn = closers.current.get(id);
    if (!fn) { fn = () => { closers.current.delete(id); setRows((list) => list.filter((r) => r.id !== id)); }; closers.current.set(id, fn); }
    return fn;
  };
  if (!rows.length) return null;
  return (
    <div className="live-toasts" aria-live="polite" aria-label="Live watchlist alerts">
      {rows.map((r) => (
        <Toast key={r.id} row={r} onClose={closeOf(r.id)} onOpen={() => { markAlertsRead([r.id]); closeOf(r.id)(); onFollow(r.action); }} />
      ))}
      {rows.length > 1 ? <button className="live-toasts-clear" onClick={() => setRows([])}>Dismiss all</button> : null}
    </div>
  );
}
