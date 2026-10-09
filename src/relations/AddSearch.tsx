import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "../ui/icons/Icon";
import { NODE_LOOK } from "./palette";
import type { NodeType } from "../../shared/relations.mjs";

type Hit = { id: string; type: NodeType; label: string; sub: string };
type Search = { tickers?: { symbol: string; name: string }[]; members?: { id: string; name: string; state: string; district: string; chamber: string; party: string }[] };
type Committee = { id: string; name: string; chamber: string; subcommittees?: { id: string; name: string }[] };

let committeeList: Promise<Committee[]> | null = null;
const loadCommittees = () => (committeeList ||= api<{ items?: Committee[] }>("/api/congress/committees").then((r) => r.items || []).catch(() => []));

/** Find a member, ticker, committee, or district and put it on the map. Joins only what the search API returns. */
export function AddSearch({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setHits([]); return; }
    const n = ++seq.current;
    const timer = window.setTimeout(async () => {
      const district = /^([A-Za-z]{2})-?(\d{1,2}|AL)$/.exec(query);
      const [res, comms] = await Promise.all([
        api<Search>(`/api/search?q=${encodeURIComponent(query)}`).catch(() => ({} as Search)),
        loadCommittees()
      ]);
      if (n !== seq.current) return;
      const low = query.toLowerCase();
      const out: Hit[] = [
        ...(district ? [{ id: `district:${district[1].toUpperCase()}-${district[2].toUpperCase() === "AL" ? "AL" : district[2].padStart(2, "0")}`, type: "district" as const, label: `${district[1].toUpperCase()}-${district[2].toUpperCase() === "AL" ? "AL" : district[2].padStart(2, "0")}`, sub: "Congressional district" }] : []),
        ...(res.members || []).slice(0, 6).map((m) => ({ id: `member:${m.id}`, type: "member" as const, label: m.name, sub: `${m.chamber === "senate" ? "Sen." : "Rep."} ${m.party}-${m.state}${m.district ? `-${m.district}` : ""}` })),
        ...(res.tickers || []).slice(0, 6).map((t) => ({ id: `ticker:${t.symbol}`, type: "ticker" as const, label: t.symbol, sub: t.name })),
        ...comms.flatMap((c) => [c, ...(c.subcommittees || []).map((s) => ({ ...s, chamber: c.chamber, name: `${c.name} · ${s.name}` }))]).filter((c) => c.name.toLowerCase().includes(low)).slice(0, 5).map((c) => ({ id: `committee:${c.id}`, type: "committee" as const, label: c.name, sub: `Committee · ${c.chamber}` }))
      ];
      setHits(out);
      setAt(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [q]);

  const pick = (h: Hit | undefined) => {
    if (!h) return;
    onPick(h.id);
    setQ("");
    setHits([]);
    setOpen(false);
  };

  return (
    <div className="relmap-search">
      <Icon name="search" />
      <input
        value={q}
        placeholder="Add member, ticker, committee, TX-12…"
        aria-label="Add a node to the map"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(hits.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(hits[at]); }
          else if (e.key === "Escape") { setQ(""); setHits([]); }
        }}
      />
      {open && hits.length ? (
        <ul role="listbox">
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === at} onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setAt(i)}>
              <span style={{ color: NODE_LOOK[h.type].color }}><Icon name={NODE_LOOK[h.type].icon} /></span>
              <b>{h.label}</b>
              <small>{h.sub}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
