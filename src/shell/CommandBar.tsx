import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

export type TrailEntry = { label: string; action: string };
type Seat = { bioguide: string; name: string; party: string; state: string; district: string; chamber: string };
type Ticker = { symbol: string; name: string; core?: boolean };
type Command = { code: string; label: string; hint: string; action: string };

/** Static destinations, Bloomberg-style mnemonics on the left. Actions route through App.go(). */
const STATIC: Command[] = [
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
  { code: "STRT", label: "Strait", hint: "Ships, aircraft, imagery", action: "section:strait" },
  { code: "CAL", label: "Calendar", hint: "Earnings, macro, lobbying, PAC", action: "calendar:" },
  { code: "ALRT", label: "Alerts", hint: "Watched members and tickers", action: "alerts:" }
];

const TICKER_FN: { code: string; label: string; action: (s: string) => string }[] = [
  { code: "DES", label: "dossier", action: (s) => `ticker:${s}` },
  { code: "GP", label: "chart with trades and filings", action: (s) => `chart:${s}` },
  { code: "POS", label: "positions · every filer", action: (s) => `pos:${s}` },
  { code: "CTR", label: "federal contract actions", action: (s) => `contracts:symbol:${s}` },
  { code: "SPLC", label: "supply chain", action: (s) => `supply:${s}` }
];
const MEMBER_FN: { code: string; label: string; action: (id: string) => string }[] = [
  { code: "DES", label: "member card", action: (id) => `member:${id}` },
  { code: "TL", label: "timeline · trades vs hearings and votes", action: (id) => `timeline:${id}` },
  { code: "CTR", label: "contracts in their district", action: (id) => `contracts:member:${id}` }
];

let tickerCache: Ticker[] | null = null;

export function commandsFor(text: string, tickers: Ticker[], roster: Seat[]): Command[] {
  const raw = text.trim().toUpperCase();
  if (!raw) return [];
  const [head, fn = ""] = raw.split(/\s+/);
  const out: Command[] = [];
  const district = /^([A-Z]{2})-?(\d{1,2})$/.exec(head);
  if (district) {
    const code = `${district[1]}-${district[2].padStart(2, "0")}`;
    out.push({ code: `${code} CTR`, label: `Contracts performed in ${code}`, hint: "USAspending place of performance", action: `contracts:place:${code}` });
    const rep = roster.find((m) => m.chamber === "house" && m.state === district[1] && String(Number(m.district) || 0) === String(Number(district[2])));
    if (rep) out.push({ code: `${code} DES`, label: `${rep.name} · ${rep.party}`, hint: "Representative", action: `member:${rep.bioguide}` });
  }
  const t = tickers.find((x) => x.symbol === head);
  if (t) {
    for (const f of TICKER_FN) if (!fn || f.code.startsWith(fn)) out.push({ code: `${t.symbol} ${f.code}`, label: `${t.name} · ${f.label}`, hint: t.core === false ? "quotes-only join" : "", action: f.action(t.symbol) });
  }
  if (raw.length >= 3) {
    const words = raw.replace(/\s+(DES|TL|CTR)$/, "").toLowerCase();
    const mfn = /\s(DES|TL|CTR)$/.exec(raw)?.[1] || "";
    const hits = roster.filter((m) => m.name.toLowerCase().includes(words) || m.bioguide === head).slice(0, 4);
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
  for (const c of STATIC) if (c.code.startsWith(head) || c.label.toUpperCase().includes(raw)) out.push(c);
  return out.slice(0, 14);
}

/** ⌘K / Ctrl+K / ":" command line. Type a mnemonic, a ticker and function (LMT CTR), a district (TX-12), or a member name. */
export function CommandBar({ open, onClose, go, roster, trail }: { open: boolean; onClose: () => void; go: (action: string, label: string) => void; roster: Seat[]; trail: TrailEntry[] }) {
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const [tickers, setTickers] = useState<Ticker[]>(tickerCache || []);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setText("");
    setAt(0);
    window.setTimeout(() => input.current?.focus(), 0);
    if (!tickerCache) api<{ items: Ticker[] }>("/api/tickers").then((res) => { tickerCache = res.items || []; setTickers(tickerCache); }).catch(() => null);
  }, [open]);

  const list = useMemo(() => {
    if (text.trim()) return commandsFor(text, tickers, roster);
    return [
      ...trail.slice(1, 7).map((e, i) => ({ code: i === 0 ? "BACK" : "RCNT", label: e.label, hint: i === 0 ? "Alt+← also goes back" : "", action: e.action })),
      ...STATIC
    ];
  }, [text, tickers, roster, trail]);

  if (!open) return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    go(c.action, c.label);
  };

  return (
    <div className="cmd-scrim" onMouseDown={onClose}>
      <div className="cmd" role="dialog" aria-label="Command line" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-input">
          <b>GO</b>
          <input
            ref={input}
            value={text}
            placeholder="LMT CTR · TX-12 · Pelosi TL · WEI · CAL"
            spellCheck={false}
            onChange={(e) => { setText(e.target.value); setAt(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(list.length - 1, i + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
              if (e.key === "Enter") run(list[at]);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="cmd-list" role="listbox">
          {list.map((c, i) => (
            <li key={`${c.code}:${c.action}:${i}`} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onClick={() => run(c)}>
              <code>{c.code}</code>
              <span>{c.label}</span>
              <em>{c.hint}</em>
            </li>
          ))}
          {!list.length ? <li className="cmd-empty">No match. Try a ticker, a district like TX-12, a member name, or a code like CTR.</li> : null}
        </ul>
        <p className="cmd-foot">↑↓ choose · enter go · functions: DES dossier · GP chart · POS positions · CTR contracts · SPLC supply · TL timeline</p>
      </div>
    </div>
  );
}
