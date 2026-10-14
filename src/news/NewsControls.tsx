import { useEffect, useMemo, useRef, useState } from "react";
import type { Headline, Wire } from "./useNews";
import "./newsControls.css";

type Outlet = { id: string; name: string; desk: string; ok: boolean; count: number };
type Props = { outlets: Outlet[]; selected: string[]; onChange: (ids: string[]) => void; items: Headline[]; scopedCount: number; wire: Wire | null; social: Wire | null };

export function NewsControls({ outlets, selected, onChange, items, scopedCount, wire, social }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      const escape = event instanceof KeyboardEvent && event.key === "Escape";
      if (!escape && (event instanceof KeyboardEvent || root.current?.contains(event.target as Node))) return;
      const opened = root.current?.querySelectorAll<HTMLDetailsElement>("details[open]");
      if (escape && opened?.length) { event.preventDefault(); event.stopPropagation(); }
      opened?.forEach(detail => {
        detail.open = false;
        if (escape) detail.querySelector<HTMLElement>("summary")?.focus();
      });
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close, true); };
  }, []);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const visible = useMemo(() => outlets.filter(o => `${o.name} ${o.desk}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => sort === "count" ? b.count - a.count || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)), [outlets, search, sort]);
  const reporting = new Set(items.map(h => h.feed)).size;
  const counts = { world: 0, markets: 0, x: 0 };
  for (const h of items) counts[h.desk]++;
  return <div className="news-controls" ref={root}>
    <div className="news-overview" aria-label="Filtered story statistics" aria-live="polite">
      <strong>{items.length}<span>stories</span></strong>
      <span>{reporting} outlets</span><span>World <b>{counts.world}</b></span><span>Markets <b>{counts.markets}</b></span><span>Social <b>{counts.x}</b></span>
    </div>
    <div className="news-filter-row">
      <details className="outlet-picker" name="news-options">
        <summary>Outlets <span>{selected.length ? `${selected.length} selected` : "All outlets"}</span></summary>
        <div className="outlet-panel">
          <div className="outlet-tools">
            <input aria-label="Search outlets" placeholder="Search outlets or desks…" value={search} onChange={e => setSearch(e.target.value)} />
            <select aria-label="Sort outlets" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name A–Z</option><option value="count">Most stories</option></select>
          </div>
          <div className="outlet-help"><span>Choose outlets to include. Counts follow your desk, region and search.</span><button onClick={() => onChange([])} disabled={!selected.length}>All outlets</button></div>
          <div className="outlet-list">
            {visible.map(o => <label key={o.id} className="outlet-option"><input type="checkbox" checked={selected.includes(o.id)} onChange={() => onChange(selected.includes(o.id) ? selected.filter(id => id !== o.id) : [...selected, o.id])} /><span>{o.name}<small>{o.desk === "x" ? "Social" : o.desk}</small></span><b>{o.count}</b></label>)}
            {!visible.length && <p>No outlets found. Try another name.</p>}
          </div>
        </div>
      </details>
      {selected.length > 0 && <button className="news-clear" onClick={() => onChange([])}>Clear outlet filter</button>}
      <span className="news-scope">{selected.length ? `${items.length} of ${scopedCount}` : "Loaded stories"} · current filters</span>
      <details className="news-health" name="news-options"><summary>Source details{wire ? ` · ${outlets.filter(o => !o.ok).length} unavailable` : " · loading"}</summary>
        <div className="news-health-panel">
          <p>Source health is from the last fetch; story counts above reflect your filters. Feeds refresh every five minutes.</p>
          <div className="news-health-list">{(wire?.feeds || []).map(f => <p key={f.id}><span>{f.name}</span><span>{f.ok ? `${f.count} fetched · ${f.ms} ms` : "Unavailable"}</span></p>)}</div>
          <p>Social: {social?.ok ? social.source || "Connected" : social?.missing ? `Set ${social.missing} in .env.local. ${social.detail || ""}` : "Not available yet."}</p>
          {(wire?.errors?.length || social?.error) ? <details><summary>Fetch diagnostics</summary><pre>{[...(wire?.errors || []), social?.error].filter(Boolean).join("\n")}</pre></details> : null}
        </div>
      </details>
    </div>
  </div>;
}
