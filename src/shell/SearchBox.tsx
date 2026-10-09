import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { districtName, parseDistrict } from "../../shared/districts.mjs";

export type SearchHit = { kind: "ticker" | "site" | "member" | "district" | "ask"; id: string; label: string; chamber?: "house" | "senate" };

type Props = { query: string; onQuery: (value: string) => void; onHit: (hit: SearchHit) => void; resetOn: string };

/** Top-bar search. Escape or a change of `resetOn` (the section) clears the hit list. */
export function SearchBox({ query, onQuery, onHit, resetOn }: Props) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const latest = useRef("");

  useEffect(() => setHits([]), [resetOn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHits([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function change(value: string) {
    onQuery(value);
    latest.current = value;
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    const code = parseDistrict(value);
    const seat: SearchHit[] = code ? [{ kind: "district", id: code, label: `${code} · ${districtName(code)} · district dossier` }] : [];
    if (seat.length) setHits(seat);
    const res = await api<{
      tickers: { symbol: string; name: string }[];
      sites: { id: string; name: string; district: string }[];
      members: { id: string; name: string; state: string; district: string; chamber: "house" | "senate"; party: string; geoid: string | null }[];
    }>(`/api/search?q=${encodeURIComponent(value)}`).catch(() => null);
    if (!res || latest.current !== value) return;
    const members = res.members.map((m) => ({
      kind: "member" as const,
      id: m.id,
      chamber: m.chamber,
      label: `${m.name} · ${m.party}-${m.state}${m.chamber === "house" ? `-${m.district}` : ""} · ${m.chamber === "senate" ? "Senator" : "Rep."}`
    }));
    const others = [
      ...res.tickers.map((t) => ({ kind: "ticker" as const, id: t.symbol, label: `${t.symbol} ${t.name}` })),
      ...res.sites.map((s) => ({ kind: "site" as const, id: s.id, label: `${s.district} ${s.name}` }))
    ];
    const asks: SearchHit[] = /\?\s*$/.test(value) || value.trim().split(/\s+/).length >= 4 ? [{ kind: "ask", id: value.trim(), label: `Ask: ${value.trim()}` }] : [];
    setHits([...[...seat, ...others.slice(0, Math.max(3, 8 - seat.length - members.length)), ...members].slice(0, 7), ...asks]);
  }

  return (
    <>
      <input
        id="search"
        className="search"
        placeholder="Ticker, bill, member, district"
        value={query}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { setHits([]); onHit(hits[0]); } }}
        aria-label="Search"
      />
      {hits.length ? (
        <div className="hits" role="listbox">
          {hits.map((hit) => (
            <button key={`${hit.kind}-${hit.id}`} onClick={() => { setHits([]); onHit(hit); }}>
              <span className="kind">{hit.kind}</span>
              <span>{hit.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
