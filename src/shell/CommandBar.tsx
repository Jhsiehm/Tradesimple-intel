import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { matchMembers } from "../../shared/memberMatch.mjs";
import { districtName, parseDistrict } from "../../shared/districts.mjs";
import { Icon } from "../ui/icons/Icon";
import { commandIcon } from "../ui/icons/commandIcon";
import { filterChats, orderChats } from "../ask/chats";
import type { SavedChat } from "../ask/types";
import "./commandBar.css";

export type TrailEntry = { label: string; action: string };
type Seat = { bioguide: string; name: string; first?: string; last?: string; nickname?: string; party: string; state: string; district: string; chamber: string };
type Ticker = { symbol: string; name: string; core?: boolean };
type Command = { code: string; label: string; hint: string; action: string };

/** Static destinations, Bloomberg-style mnemonics on the left. Actions route through App.go(). */
const STATIC: Command[] = [
  { code: "WEEK", label: "Today · filings and watchlist", hint: "This week in Congress trading, newest filings and biggest trades", action: "today:week" },
  { code: "LEAD", label: "Today · leaderboards", hint: "Buys vs S&P 500, most active, late filers", action: "today:leaders" },
  { code: "CONG", label: "Congress", hint: "Votes, bills, members, committees", action: "section:congress" },
  { code: "VOTE", label: "Congress · roll calls", hint: "Close votes first", action: "mode:votes" },
  { code: "BILL", label: "Congress · bills", hint: "By latest action", action: "mode:bills" },
  { code: "MEMB", label: "Congress · members", hint: "Every seat", action: "mode:members" },
  { code: "CMTE", label: "Congress · committees", hint: "Members, bills, meetings", action: "mode:committees" },
  { code: "MKTS", label: "Markets · S&P board", hint: "Sector heat, breadth", action: "view:board" },
  { code: "WEI", label: "Markets · global indices", hint: "Indices, ADR premiums, ETFs", action: "view:globals" },
  { code: "FXIP", label: "Markets · FX", hint: "Major and EM pairs", action: "view:fx" },
  { code: "CRYP", label: "Markets · crypto", hint: "Spot board", action: "view:crypto" },
  { code: "POSN", label: "Markets · positions", hint: "Congress, insiders, funds, shorts", action: "view:positions" },
  { code: "PTRS", label: "Congress trades", hint: "Every disclosed House and Senate trade", action: "layer:politicians" },
  { code: "FRM4", label: "Insider trades", hint: "SEC Form 4", action: "layer:insiders" },
  { code: "CTR", label: "Contracts · all agencies", hint: "Largest federal contract actions", action: "contracts:all" },
  { code: "NEWS", label: "News · board", hint: "Wires and X", action: "section:news" },
  { code: "DIST", label: "Districts", hint: "Plants and HQs on the map", action: "section:districts" },
  { code: "NAV", label: "Nav", hint: "Regional ships, aircraft, news and satellite imagery", action: "section:strait" },
  { code: "MAP", label: "Map", hint: "Records in a window, lines you draw", action: "section:map" },
  { code: "CAL", label: "Calendar", hint: "Earnings, macro, lobbying, PAC", action: "calendar:" },
  { code: "ALRT", label: "Alerts", hint: "Watched members and tickers", action: "alerts:" },
  { code: "BT", label: "Ask the chat to backtest…", hint: "Say what to replay in plain words; the chat states the spec, runs it, and shows the result inline", action: "ask:draft:Backtest " },
  { code: "ASK", label: "Ask about what's on screen", hint: "This chat, tool lines, a theory you can accept", action: "ask:" }
];

const TICKER_FN: { code: string; label: string; action: (s: string) => string }[] = [
  { code: "DES", label: "dossier", action: (s) => `ticker:${s}` },
  { code: "GP", label: "chart with trades and filings", action: (s) => `chart:${s}` },
  { code: "POS", label: "positions · every filer", action: (s) => `pos:${s}` },
  { code: "CTR", label: "federal contract actions", action: (s) => `contracts:symbol:${s}` },
  { code: "SPLC", label: "supply chain", action: (s) => `supply:${s}` },
  { code: "HQ", label: "headquarters district on the map", action: (s) => `hq:${s}` },
  { code: "BT", label: "backtest · Congress and insider buys, entered after filing", action: (s) => `bt:ticker:${s}` }
];
const MEMBER_FN: { code: string; label: string; action: (id: string) => string }[] = [
  { code: "DES", label: "member card", action: (id) => `member:${id}` },
  { code: "TL", label: "timeline · trades vs hearings and votes", action: (id) => `timeline:${id}` },
  { code: "CTR", label: "contracts in their district", action: (id) => `contracts:member:${id}` },
  { code: "BT", label: "backtest · their buys, entered after each filing", action: (id) => `bt:member:${id}` }
];

let tickerCache: Ticker[] | null = null;

export function commandsFor(text: string, tickers: Ticker[], roster: Seat[]): Command[] {
  const raw = text.trim().toUpperCase();
  if (!raw) return [];
  const asked = /^ask\s+(\S.{2,})$/i.exec(text.trim());
  if (asked) return [{ code: "ASK", label: `Ask: ${asked[1]}`, hint: "answered from the app's own data, with sources", action: `ask:q:${encodeURIComponent(asked[1])}` }];
  const [head, fn = ""] = raw.split(/\s+/);
  const out: Command[] = [];
  const dfn = /\s(DES|CTR|REP)$/.exec(raw)?.[1] || "";
  const district = parseDistrict(dfn ? raw.slice(0, -dfn.length) : raw);
  if (district) {
    const [state, num] = district.split("-");
    const rep = roster.find((m) => m.chamber === "house" && m.state === state && String(Number(m.district) || 0) === (num === "AL" ? "0" : String(Number(num))));
    if (!dfn || dfn === "DES") out.push({ code: `${district} DES`, label: `${districtName(district)} · district dossier`, hint: "Map, representative, senators, sites", action: `district:${district}` });
    if (!dfn || dfn === "CTR") out.push({ code: `${district} CTR`, label: `Contracts performed in ${district}`, hint: "USAspending place of performance", action: `contracts:place:${district}` });
    if (rep && (!dfn || dfn === "REP")) out.push({ code: `${district} REP`, label: `${rep.name} · ${rep.party}`, hint: "Representative", action: `member:${rep.bioguide}` });
  }
  const t = tickers.find((x) => x.symbol === head);
  if (t) {
    for (const f of TICKER_FN) if (!fn || f.code.startsWith(fn)) out.push({ code: `${t.symbol} ${f.code}`, label: `${t.name} · ${f.label}`, hint: t.core === false ? "quotes-only join" : "", action: f.action(t.symbol) });
  }
  if (raw.length >= 3) {
    const words = raw.replace(/\s+(DES|TL|CTR|BT)$/, "");
    const mfn = /\s(DES|TL|CTR|BT)$/.exec(raw)?.[1] || "";
    const hits = district ? [] : matchMembers(roster, words, 4);
    for (const m of hits) {
      for (const f of MEMBER_FN) {
        if (mfn && f.code !== mfn) continue;
        out.push({ code: `${m.bioguide} ${f.code}`, label: `${m.name} · ${f.label}`, hint: `${m.party}-${m.state}${m.chamber === "house" && m.district ? `-${m.district}` : ""} · ${m.chamber}`, action: f.action(m.bioguide) });
      }
    }
  }
  if (!t) {
    for (const x of tickers.filter((x) => x.symbol.startsWith(head) || x.name.toUpperCase().includes(raw)).slice(0, 4)) {
      out.push({ code: `${x.symbol} DES`, label: `${x.name} · dossier`, hint: "type a function: GP POS CTR SPLC", action: `ticker:${x.symbol}` });
    }
  }
  for (const c of STATIC) if (c.code.startsWith(head) || (c.label + " " + c.hint).toUpperCase().includes(raw)) out.push(c);
  return out.slice(0, 14);
}

/** One keyboard-accessible entry to destinations, records, and locally saved research. */
export function CommandBar({ open, onClose, go, roster, trail, chats }: { open: boolean; onClose: () => void; go: (action: string, label: string) => void; roster: Seat[]; trail: TrailEntry[]; chats: SavedChat[] }) {
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const [tickers, setTickers] = useState<Ticker[]>(tickerCache || []);
  const [tickerState, setTickerState] = useState<"loading" | "ready" | "error">(tickerCache ? "ready" : "loading");
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    let active = true;
    const previous = document.activeElement as HTMLElement | null;
    setText("");
    setAt(0);
    const modal = dialog.current;
    modal?.showModal();
    input.current?.focus();
    if (!tickerCache) {
      setTickerState("loading");
      api<{ items: Ticker[] }>("/api/tickers").then((res) => {
        if (!Array.isArray(res.items)) throw new Error("Ticker search unavailable");
        tickerCache = res.items;
        if (active) { setTickers(tickerCache); setTickerState("ready"); }
      }).catch(() => { if (active) setTickerState("error"); });
    } else { setTickers(tickerCache); setTickerState("ready"); }
    return () => { active = false; modal?.close(); previous?.focus(); };
  }, [open]);

  const groups = useMemo(() => {
    const query = text.trim().toLowerCase();
    const recent = trail.slice(1).filter((e) => !query || e.label.toLowerCase().includes(query))
      .slice(0, query ? 3 : 5).map((e) => ({ code: "RCNT", label: e.label, hint: "Previously opened", action: e.action }));
    const saved = filterChats(orderChats(chats), text).slice(0, query ? 5 : 3)
      .map((c) => ({ code: "ASK", label: c.title, hint: c.pinned ? "Pinned · saved in this browser" : "Saved in this browser", action: `ask:saved:${c.id}` }));
    const matches = query ? commandsFor(text, tickers, roster) : STATIC;
    const seen = new Set<string>();
    const destinations = { label: query ? "Results" : "Go to", items: matches };
    const history = [{ label: "Recent research", items: recent }, { label: "Saved research", items: saved }];
    return (query ? [destinations, ...history] : [...history, destinations])
      .map((g) => ({ ...g, items: g.items.filter((c) => { if (seen.has(c.action)) return false; seen.add(c.action); return true; }) }))
      .filter((g) => g.items.length);
  }, [text, tickers, roster, trail, chats]);
  const list = groups.flatMap((g) => g.items);
  const selected = Math.max(0, Math.min(at, list.length - 1));

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [open, selected, text, listId]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    go(c.action, c.label);
  };
  if (!open) return null;

  return (
    <dialog ref={dialog} className="cmd research-command" aria-label="Search TradeSimple" onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onClose(); }
      }} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
      <div className="cmd-input">
        <Icon name="search" />
        <input ref={input} value={text} autoFocus role="combobox" aria-label="Search companies, members, destinations and saved research"
          aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={list.length ? `${listId}-${selected}` : undefined}
          placeholder="Search companies, members, or research…" spellCheck={false}
          onChange={(e) => { setText(e.target.value); setAt(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(list.length - 1, selected + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, selected - 1)); }
            if (e.key === "Enter") { e.preventDefault(); run(list[selected]); }
          }} />
        <button className="cmd-close" onClick={onClose} aria-label="Close search"><Icon name="close" /></button>
      </div>
      <div className="cmd-results" id={listId} role="listbox" aria-label="Search results">
        {groups.map((g) => (
          <div key={g.label} role="group" aria-label={g.label}>
            <h2 className="cmd-group" role="presentation">{g.label}</h2>
            {g.items.map((c) => {
              const i = list.indexOf(c);
              return <div key={c.action} id={`${listId}-${i}`} className="cmd-result" role="option" aria-selected={i === selected}
                onMouseDown={(e) => e.preventDefault()} onClick={() => run(c)}>
                <Icon name={commandIcon(c.code)} />
                <span className="cmd-copy"><strong>{c.label}</strong><small>{c.hint}</small></span>
                <span className="cmd-type">{commandType(c.action)}</span>
                <code>{c.code === "RCNT" ? "" : c.code}</code>
              </div>;
            })}
          </div>
        ))}
        {!list.length ? <p className="cmd-empty">No matches. Try a company, member name, or “watchlist”. Start with ASK to ask a research question.</p> : null}
      </div>
      {tickerState !== "ready" ? <p className="cmd-notice" role="status">{tickerState === "loading" ? "Loading company search…" : "Company search is unavailable. Close and reopen to retry; destinations and saved research still work."}</p> : null}
      <p className="cmd-foot"><span>↑↓ navigate · Enter open · Esc close</span><span>Shortcuts still work: LMT CTR · Pelosi TL · ASK</span></p>
    </dialog>
  );
}

function commandType(action: string): string {
  if (action.startsWith("ask:saved:")) return "Research";
  return ({ ticker: "Company", member: "Member", timeline: "Timeline", chart: "Chart", pos: "Positions", contracts: "Contracts", district: "District", supply: "Supply chain", bt: "Backtest", ask: "Ask" } as Record<string, string>)[action.split(":")[0]] || "View";
}
