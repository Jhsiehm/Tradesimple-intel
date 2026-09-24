import { useEffect, useMemo, useState } from "react";
import { api, when } from "./lib/api";
import { Drawer } from "./shell/Drawer";
import { MapFrame } from "./shell/MapFrame";
import { RecordList } from "./shell/RecordList";
import { useCongress } from "./congress/useCongress";
import { loadDossier, useMarkets } from "./markets/useMarkets";
import { useDistricts } from "./districts/useDistricts";
import { useStrait } from "./strait/useStrait";
import type { Chamber, DrawerModel, MarketLayer, Section } from "./types";
import "maplibre-gl/dist/maplibre-gl.css";

const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "congress", label: "Congress", blurb: "Chamber votes and bill stages" },
  { id: "markets", label: "Markets", blurb: "Filings, shorts, and holdings" },
  { id: "districts", label: "Districts", blurb: "Plants and headquarters on the map" },
  { id: "strait", label: "Strait", blurb: "Ships, news, and open imagery" }
];

export function App() {
  const [section, setSection] = useState<Section>("congress");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chamber, setChamber] = useState<Chamber>("house");
  const [mode, setMode] = useState<"bills" | "votes">("votes");
  const [layer, setLayer] = useState<MarketLayer>("politicians");
  const [shortSymbol, setShortSymbol] = useState("AAPL");
  const [theaterId, setTheaterId] = useState("taiwan-strait");
  const [straitFeed, setStraitFeed] = useState<"ships" | "news">("ships");
  const [imagery, setImagery] = useState<"map" | "satellite" | "both">("both");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendar, setCalendar] = useState<{ id: string; date: string; chamber: string; title: string }[]>([]);
  const [calendarNote, setCalendarNote] = useState("");
  const [dossier, setDossier] = useState<DrawerModel | null>(null);
  const [hits, setHits] = useState<{ kind: string; id: string; label: string }[]>([]);
  const [clock, setClock] = useState(() => utcNow());

  const congress = useCongress(chamber, mode, query, section === "congress" ? selectedId : null);
  const markets = useMarkets(layer, query, section === "markets" ? selectedId : null, shortSymbol);
  const districts = useDistricts(query, section === "districts" ? selectedId : null);
  const strait = useStrait(theaterId, section === "strait" ? selectedId : null);

  const straitView = {
    ...strait,
    items: straitFeed === "news" ? strait.newsItems : strait.items,
    empty: straitFeed === "news"
      ? (strait.newsItems.length ? "" : "No recent strait headlines.")
      : strait.empty
  };
  const view = section === "congress" ? congress : section === "markets" ? markets : section === "districts" ? districts : straitView;
  const items = view.items;
  const drawer = dossier || (section === "congress" ? congress.drawer : section === "markets" ? markets.drawer : section === "districts" ? districts.drawer : strait.drawer);

  const ids = useMemo(() => items.map((item) => item.id), [items]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(utcNow()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        document.getElementById("search")?.focus();
      }
      if (typing) return;
      if (event.key === "1") pick("congress");
      if (event.key === "2") pick("markets");
      if (event.key === "3") pick("districts");
      if (event.key === "4") pick("strait");
      if (event.key === "Escape") {
        setSelectedId(null);
        setDossier(null);
        setCalendarOpen(false);
        setHits([]);
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = ids.indexOf(selectedId || "");
        const next = event.key === "ArrowDown" ? Math.min(ids.length - 1, index + 1) : Math.max(0, index - 1);
        if (ids[next]) setSelectedId(ids[next]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, selectedId]);

  function pick(next: Section) {
    setSection(next);
    setSelectedId(null);
    setDossier(null);
    setHits([]);
  }

  async function openCalendar() {
    setCalendarOpen((open) => !open);
    if (calendar.length) return;
    const res = await api<{ ok: boolean; missing?: string; items: { id: string; date: string; chamber: string; title: string }[] }>(
      "/api/congress/calendar"
    );
    if (res.missing) setCalendarNote(`Set ${res.missing} to load the session calendar.`);
    setCalendar(res.items || []);
  }

  async function onSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    const res = await api<{
      tickers: { symbol: string; name: string }[];
      sites: { id: string; name: string; district: string }[];
      members: { id: string; name: string; state: string; district: string; geoid: string | null }[];
    }>(`/api/search?q=${encodeURIComponent(value)}`);
    setHits([
      ...res.tickers.map((t) => ({ kind: "ticker", id: t.symbol, label: `${t.symbol} ${t.name}` })),
      ...res.sites.map((s) => ({ kind: "site", id: s.id, label: `${s.district} ${s.name}` })),
      ...res.members.map((m) => ({ kind: "member", id: m.geoid || m.id, label: `${m.name} ${m.state}-${m.district || "Sen"}` }))
    ].slice(0, 8));
  }

  async function chooseHit(hit: { kind: string; id: string }) {
    setHits([]);
    if (hit.kind === "ticker") {
      setSection("markets");
      setShortSymbol(hit.id);
      setDossier(await loadDossier(hit.id));
      setSelectedId(hit.id);
    } else if (hit.kind === "site") {
      setSection("districts");
      setSelectedId(hit.id);
    } else {
      setSection("congress");
      setChamber("house");
      setSelectedId(hit.id);
    }
  }

  const map = mapProps();
  const active = SECTIONS.find((item) => item.id === section)!;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>TRADESIMPLE</strong>
          <span>INTEL</span>
        </div>
        <nav className="nav">
          {SECTIONS.map((item, index) => (
            <button key={item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => pick(item.id)}>
              <kbd>{index + 1}</kbd>
              {item.label}
            </button>
          ))}
          <button className="ghost" onClick={openCalendar}>Calendar</button>
        </nav>
        <div className="tools">
          {section === "strait" ? (
            <label className="theater">
              <select value={theaterId} onChange={(e) => { setTheaterId(e.target.value); setSelectedId(null); }} aria-label="Theater">
                {strait.theaters.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <input
            id="search"
            className="search"
            placeholder="Ticker, bill, member, district"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search"
          />
          <time className="clock" dateTime={clock}>{clock.slice(11, 19)} UTC</time>
          {hits.length ? (
            <div className="hits" role="listbox">
              {hits.map((hit) => (
                <button key={`${hit.kind}-${hit.id}`} onClick={() => chooseHit(hit)}>
                  <span className="kind">{hit.kind}</span>
                  <span>{hit.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          {calendarOpen ? (
            <div className="popover" role="dialog" aria-label="Session calendar">
              <header>
                <span>SESSIONS</span>
                <button className="ghost" onClick={() => setCalendarOpen(false)}>Close</button>
              </header>
              {calendarNote ? <p className="note">{calendarNote}</p> : null}
              {calendar.map((item) => (
                <p className="cal-row" key={item.id}>
                  <small>{when(item.date)}</small>
                  <small>{item.chamber}</small>
                  <span>{item.title}</span>
                </p>
              ))}
              {!calendar.length && !calendarNote ? <p className="note">No meetings returned.</p> : null}
            </div>
          ) : null}
        </div>
      </header>
      <main className="stage">
        <div className="map-wrap">
          <MapFrame
            geojson={map.geojson}
            colorProp={map.colorProp}
            markers={map.markers}
            rasterTiles={map.rasterTiles}
            mapTiles={map.mapTiles}
            imagery={section === "strait" ? imagery : "map"}
            center={map.center}
            zoom={map.zoom}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <div className="map-frame" />
          <div className="map-toggle toggle">
            {section === "congress" ? (
              <>
                <button aria-pressed={chamber === "house"} onClick={() => setChamber("house")}>House</button>
                <button aria-pressed={chamber === "senate"} onClick={() => setChamber("senate")}>Senate</button>
                <button aria-pressed={mode === "votes"} onClick={() => { setMode("votes"); setSelectedId(null); }}>Votes</button>
                <button aria-pressed={mode === "bills"} onClick={() => { setMode("bills"); setSelectedId(null); }}>Bills</button>
              </>
            ) : null}
            {section === "markets" ? (
              <>
                {(["politicians", "insiders", "whales", "shorts"] as MarketLayer[]).map((item) => (
                  <button key={item} aria-pressed={layer === item} onClick={() => { setLayer(item); setSelectedId(null); setDossier(null); }}>
                    {item}
                  </button>
                ))}
              </>
            ) : null}
            {section === "strait" ? (
              <>
                <button aria-pressed={straitFeed === "ships"} onClick={() => { setStraitFeed("ships"); setSelectedId(null); }}>Ships</button>
                <button aria-pressed={straitFeed === "news"} onClick={() => { setStraitFeed("news"); setSelectedId(null); }}>News</button>
                <button aria-pressed={imagery === "map"} onClick={() => setImagery("map")}>Map</button>
                <button aria-pressed={imagery === "satellite"} onClick={() => setImagery("satellite")}>Satellite</button>
                <button aria-pressed={imagery === "both"} onClick={() => setImagery("both")}>Both</button>
              </>
            ) : null}
          </div>
          {section === "congress" && mode === "votes" ? (
            <div className="legend" aria-hidden="true">
              <span><i className="swatch yea" />Yea</span>
              <span><i className="swatch nay" />Nay</span>
              <span><i className="swatch split" />Split</span>
            </div>
          ) : null}
          {section === "markets" ? (
            <p className="map-note">Filings are not mapped. The list is the record. Search a ticker to open its dossier.</p>
          ) : null}
        </div>
        <section className="rail" aria-label="Records">
          <header className="rail-head">
            <div>
              <h1>{active.label}</h1>
              <p>{active.blurb}</p>
            </div>
            <span className="count">{String(items.length).padStart(2, "0")}</span>
          </header>
          <div className="rail-body">
            {drawer ? <Drawer model={drawer} onClose={() => { setSelectedId(null); setDossier(null); }} /> : null}
            <RecordList
              items={items}
              selectedId={selectedId}
              onSelect={(id) => { setDossier(null); setSelectedId(id); }}
              empty={view.empty || "Nothing in this list."}
            />
          </div>
        </section>
      </main>
      <footer className="status">
        <span><em>SOURCE</em><strong>{view.status.source}</strong></span>
        <span><em>AS OF</em>{view.status.asOf || "—"}</span>
        <span><em>NOTE</em>{view.status.latency || "—"}</span>
        <span className="keys"><kbd>1</kbd>–<kbd>4</kbd> sections · <kbd>/</kbd> search · <kbd>esc</kbd> close</span>
      </footer>
      <div className="scan" aria-hidden="true" />
    </div>
  );

  function utcNow() {
  return new Date().toISOString();
}

function mapProps() {
    if (section === "strait" && strait.theater) {
      return {
        geojson: undefined,
        colorProp: undefined,
        markers: strait.markers,
        rasterTiles: strait.tiles,
        mapTiles: strait.mapTiles,
        center: [strait.theater.lon, strait.theater.lat] as [number, number],
        zoom: strait.theater.zoom
      };
    }
    if (section === "districts") {
      const site = districts.selected;
      return {
        geojson: districts.geojson,
        colorProp: "vote",
        markers: districts.markers,
        rasterTiles: undefined,
        mapTiles: undefined,
        center: (site ? [site.lon, site.lat] : [-96, 38]) as [number, number],
        zoom: site ? 5 : 3.2
      };
    }
    if (section === "markets") {
      return {
        geojson: undefined,
        colorProp: undefined,
        markers: [],
        rasterTiles: undefined,
        mapTiles: undefined,
        center: [-96, 38] as [number, number],
        zoom: 3.1
      };
    }
    return {
      geojson: congress.geojson,
      colorProp: mode === "votes" ? "vote" : undefined,
      markers: [],
      rasterTiles: undefined,
      mapTiles: undefined,
      center: [-96, 38] as [number, number],
      zoom: chamber === "house" ? 3.3 : 3.1
    };
  }
}
