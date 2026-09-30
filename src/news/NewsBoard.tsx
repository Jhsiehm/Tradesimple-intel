import { useMemo, type ReactNode } from "react";
import { when } from "../lib/api";
import { age, type Headline, type Wire } from "./useNews";

type Props = {
  wire: Wire | null;
  x: Wire | null;
  items: Headline[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTicker: (symbol: string) => void;
};

export function NewsBoard({ wire, x, items, selectedId, onSelect, onTicker }: Props) {
  const columns = useMemo(() => ({
    world: items.filter((h) => h.desk === "world").slice(0, 80),
    markets: items.filter((h) => h.desk === "markets").slice(0, 80),
    x: items.filter((h) => h.desk === "x").slice(0, 80)
  }), [items]);

  const mentions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of items) for (const s of h.symbols) counts.set(s, (counts.get(s) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [items]);

  return (
    <div className="board wire">
      <header className="board-head">
        <div className="board-title">
          <strong>WIRE</strong>
          <span>{items.length} headlines · {when(wire?.asOf)}</span>
        </div>
        <p className="feeds">
          {(wire?.feeds || []).map((feed) => (
            <span key={feed.id} className={feed.ok ? undefined : "down"} title={`${feed.desk} · fetched in ${feed.ms} ms`}>
              <em>{feed.name}</em>{feed.ok ? `${feed.count} · ${feed.ms}ms` : "down"}
            </span>
          ))}
          <span className={x?.ok ? undefined : "down"} title={x?.latency}><em>X</em>{x?.ok ? `${x.items.length}${x.mode === "social" ? " · via Bluesky + Truth Social" : ""}` : x?.missing ? "no token" : "—"}</span>
        </p>
        {mentions.length ? (
          <p className="chips">
            <em>MENTIONS</em>
            {mentions.map(([symbol, count]) => (
              <button key={symbol} className="chip" onClick={() => onTicker(symbol)}>{symbol} <b>{count}</b></button>
            ))}
          </p>
        ) : null}
      </header>
      <div className="wire-cols">
        <Column title="World" rows={columns.world} selectedId={selectedId} onSelect={onSelect} />
        <Column title="Markets" rows={columns.markets} selectedId={selectedId} onSelect={onSelect} />
        <Column
          title={x?.mode === "social" ? "X · accounts via Bluesky / Truth" : "X"}
          rows={columns.x}
          selectedId={selectedId}
          onSelect={onSelect}
          empty={x?.missing ? `Set ${x.missing} in .env.local. ${x.detail || ""}` : x?.error || "No posts."}
          lead={x?.trends?.length ? (
            <div className="x-trends">
              <p><em>TRENDING ON X · US</em> {x.trendsAsOf ? `${when(x.trendsAsOf).slice(11)} UTC · trends24` : ""}</p>
              <p className="chips">
                {x.trends.slice(0, 14).map((t) => (
                  t.symbol
                    ? <button key={t.name} className="chip on" onClick={() => onTicker(t.symbol)}>{t.name} <b>{t.symbol}</b></button>
                    : <a key={t.name} className={t.fresh ? "chip fresh-chip" : "chip"} href={t.url} target="_blank" rel="noreferrer">{t.name}</a>
                ))}
              </p>
              {x.mode === "social" ? <p className="x-note">No {x.tokenMissing} yet: posts below are these accounts on Bluesky and Trump on Truth Social.</p> : null}
            </div>
          ) : null}
        />
      </div>
      <p className="tape-src">
        <em>SOURCE</em> {wire?.source || "RSS wires"}{x?.ok ? ` · ${x.mode === "social" ? "Bluesky, Truth Social (trumpstruth.org), X trends (trends24)" : "X API v2"}` : ""}
        <em>AS OF</em> {when(wire?.asOf)}
        <em>NOTE</em> {wire?.latency || "Publisher RSS."}
      </p>
    </div>
  );
}

function Column({ title, rows, selectedId, onSelect, empty, lead }: { title: string; rows: Headline[]; selectedId: string | null; onSelect: (id: string) => void; empty?: string; lead?: ReactNode }) {
  return (
    <section className="wire-col">
      <h3>{title} <small>{rows.length}</small></h3>
      <div className="wire-list">
        {lead}
        {rows.length ? rows.map((h) => (
          <button key={h.id} className="wire-row" aria-selected={h.id === selectedId} onClick={() => onSelect(h.id)}>
            <time>{h.published ? new Date(h.published).toISOString().slice(11, 16) : "--:--"}</time>
            <span className={h.via ? "wire-src handle" : "wire-src"}>{h.source}{h.via ? <i> · {h.via}</i> : null}</span>
            <span className="wire-title">{h.title}</span>
            <small>{age(h.published)}{h.symbols.length ? ` · ${h.symbols.join(" ")}` : ""}</small>
          </button>
        )) : <p className="note">{empty || "No headlines."}</p>}
      </div>
    </section>
  );
}
