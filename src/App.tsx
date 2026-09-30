import { useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { Drawer } from "./shell/Drawer";
import { WidgetLayer } from "./shell/Widgets";
import { MapFrame } from "./shell/MapFrame";
import { RecordList } from "./shell/RecordList";
import { TimeBar } from "./shell/TimeBar";
import { PanelsMenu } from "./shell/PanelsMenu";
import { SearchBox, type SearchHit } from "./shell/SearchBox";
import { CongressBar, EarthBar, MarketsBar, NewsBar, StraitBar, type StraitFeed } from "./shell/MapBar";
import { MODE_BLURB, SECTIONS, utcNow, type MarketView } from "./shell/sections";
import { useRail } from "./shell/useRail";
import { useCards } from "./shell/useCards";
import { useMapClock } from "./shell/useMapClock";
import { mapView } from "./shell/mapView";
import { route } from "./shell/follow";
import { useCongress } from "./congress/useCongress";
import { STATE_NAME_TO_POSTAL } from "./congress/states";
import { FloorMap } from "./congress/FloorMap";
import { meetingModel } from "./congress/meeting";
import type { ChartSpan } from "./markets/CandleChart";
import { CalendarBoard, type CalendarTab, type Meeting } from "./markets/CalendarBoard";
import { MarketStage } from "./markets/MarketStage";
import { loadDossier, loadPositions, useMarkets } from "./markets/useMarkets";
import { useNews } from "./news/useNews";
import { NewsBoard } from "./news/NewsBoard";
import { REGIONS, regionOutlets } from "./news/newsGlobe";
import { useDistricts } from "./districts/useDistricts";
import { useStrait } from "./strait/useStrait";
import { useEarth } from "./lib/useEarth";
import type { Chamber, ChartMark, CongressMode, DrawerModel, MarketLayer, NewsDesk, PartyFilter, Section } from "./types";
import "maplibre-gl/dist/maplibre-gl.css";

export function App() {
  const [section, setSection] = useState<Section>("congress");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chamber, setChamber] = useState<Chamber>("house");
  const [mode, setMode] = useState<CongressMode>("votes");
  const [party, setParty] = useState<PartyFilter>("all");
  const [voteView, setVoteView] = useState<"map" | "floor">("floor");
  const [layer, setLayer] = useState<MarketLayer>("politicians");
  const [marketView, setMarketView] = useState<MarketView>("board");
  const [chartSymbol, setChartSymbol] = useState("AAPL");
  const [chartSpan, setChartSpan] = useState<ChartSpan>("5m");
  const [chartMarks, setChartMarks] = useState<ChartMark[]>([]);
  const [chartFrom, setChartFrom] = useState<MarketView>("board");
  const [supplySymbol, setSupplySymbol] = useState("AAPL");
  const [newsDesk, setNewsDesk] = useState<NewsDesk>("all");
  const [newsView, setNewsView] = useState<"board" | "globe">("board");
  const [newsRegion, setNewsRegion] = useState("all");
  const [mapTime, setMapTime] = useState<number | null>(null);
  const [theaterId, setTheaterId] = useState("taiwan-strait");
  const [straitFeed, setStraitFeed] = useState<StraitFeed>("ships");
  const [airMil, setAirMil] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [calendarTab, setCalendarTab] = useState<CalendarTab | null>(null);
  const [calendar, setCalendar] = useState<Meeting[]>([]);
  const [calendarNote, setCalendarNote] = useState("");
  const [dossier, setDossier] = useState<DrawerModel | null>(null);
  const [clock, setClock] = useState(utcNow);

  const rail = useRail();
  const cards = useCards();
  const { earth, settings: earthSettings, update: updateEarth, credit: earthCredit } = useEarth();

  const congress = useCongress(chamber, mode, query, section === "congress" ? selectedId : null, party);
  const markets = useMarkets(layer, query, section === "markets" ? selectedId : null, party);
  const news = useNews(newsDesk, query, section === "news" ? selectedId : null, section === "news", newsRegion);
  const districts = useDistricts(query, section === "districts" ? selectedId : null);
  const strait = useStrait(theaterId, section === "strait" ? selectedId : null, section === "strait" ? straitFeed : "ships", airMil);

  const straitView = {
    ...strait,
    items: straitFeed === "air" ? strait.airItems : straitFeed === "news" ? strait.newsItems : strait.items,
    empty: straitFeed === "air" ? strait.airEmpty : straitFeed === "news" ? (strait.newsItems.length ? "" : "No recent strait headlines.") : strait.empty
  };
  const view = { congress, markets, news, districts, strait: straitView }[section];
  const items = view.items;
  const drawer = dossier || view.drawer;
  const ids = useMemo(() => items.map((item) => item.id), [items]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(utcNow()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const focus = markets.chartFocus;
    if (!focus) return;
    setChartSymbol(focus.symbol);
    setChartSpan("6mo");
    setMarketView("chart");
    setChartMarks(focus.marks);
  }, [markets.chartFocus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        document.getElementById("search")?.focus();
      }
      if (typing) return;
      if (event.key === "\\") {
        rail.toggle();
        return;
      }
      const index = Number(event.key) - 1;
      if (SECTIONS[index]) pick(SECTIONS[index].id);
      if (event.key === "Escape") {
        closeDossier();
        setCalendarTab(null);
        setPanelsOpen(false);
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const at = ids.indexOf(selectedId || "");
        const next = event.key === "ArrowDown" ? Math.min(ids.length - 1, at + 1) : Math.max(0, at - 1);
        if (ids[next]) setSelectedId(ids[next]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, selectedId, dossier]);

  function closeDossier() {
    if (dossier) setDossier(null);
    else setSelectedId(null);
  }

  function openMember(bioguide: string, side?: Chamber) {
    if (!/^[A-Z]\d{6}$/.test(bioguide)) return;
    const known = congress.roster.find((m) => m.bioguide === bioguide);
    cards.openMember(bioguide, side || known?.chamber || chamber, known?.name);
  }

  function showChart(symbol: string, span: ChartSpan, marks: ChartMark[] = []) {
    if (marketView !== "chart") setChartFrom(section === "markets" ? marketView : "board");
    setCalendarTab(null);
    setSection("markets");
    setChartSymbol(symbol);
    setChartSpan(span);
    setChartMarks(marks);
    setMarketView("chart");
  }

  function openSupply(symbol: string) {
    setCalendarTab(null);
    setSection("markets");
    setSupplySymbol(symbol);
    setMarketView("supply");
  }

  function goCongress(next: CongressMode, id: string, side?: Chamber) {
    setSection("congress");
    if (side) setChamber(side);
    setMode(next);
    setSelectedId(id);
    setDossier(null);
  }

  const follow = (action: string) => route(action, {
    bill: (id) => goCongress("bills", id),
    vote: (id) => goCongress("votes", id, id.startsWith("senate") ? "senate" : "house"),
    member: (id) => openMember(id),
    news: (id) => { setDossier(null); setSelectedId(id); },
    committee: (id) => goCongress("committees", id, id.startsWith("HS") ? "house" : id.startsWith("SS") ? "senate" : undefined),
    meeting: (id) => { const meeting = calendar.find((m) => m.id === id); if (meeting) setDossier(meetingModel(meeting)); },
    ticker: (symbol) => { showChart(symbol, "5m"); setSelectedId(null); setDossier(null); },
    inst: (symbol) => showChart(symbol, "6mo"),
    chart: (symbol) => {
      showChart(symbol, "6mo", chartSymbol === symbol ? chartMarks : []);
      loadPositions(symbol).then((res) => { if (res?.marks.length) setChartMarks(res.marks); }).catch(() => null);
    },
    pos: (symbol) => void cards.openPositions(symbol),
    supply: openSupply
  });

  function openSeat(placeId: string) {
    const place = (state: string) => STATE_NAME_TO_POSTAL[state || ""] || state || "";
    const matches = congress.positions.filter((member) => (chamber === "house" ? member.geoid === placeId : place(member.state) === placeId));
    if (!matches.length) return;
    if (matches.length === 1 && matches[0].bioguide) {
      openMember(matches[0].bioguide, chamber);
      return;
    }
    setDossier({
      title: `${matches.length} senators`,
      meta: congress.voteCaption || "This roll call",
      rows: [],
      links: matches.filter((member) => member.bioguide).map((member) => ({ label: member.vote, value: `${member.name} · ${member.party || "—"}`, action: `member:${member.bioguide}` }))
    });
  }

  function pick(next: Section) {
    setCalendarTab(null);
    setSection(next);
    setSelectedId(null);
    setDossier(null);
    cards.dropUnpinned();
  }

  async function openCalendar() {
    setCalendarTab((open) => (open ? null : "earnings"));
    if (calendar.length) return;
    const res = await api<{ ok: boolean; missing?: string; items: Meeting[] }>("/api/congress/calendar");
    if (res.missing) setCalendarNote(`Set ${res.missing} to load the session calendar.`);
    setCalendar(res.items || []);
  }

  function selectRow(id: string) {
    setDossier(null);
    setSelectedId(id);
    if (section === "congress" && mode === "members") openMember(id, chamber);
  }

  async function chooseHit(hit: SearchHit) {
    if (hit.kind === "ticker") {
      showChart(hit.id, "5m");
      setDossier(await loadDossier(hit.id));
      setSelectedId(null);
    } else if (hit.kind === "site") {
      setSection("districts");
      setSelectedId(hit.id);
    } else if (/^[A-Za-z]\d{6}$/.test(hit.id)) {
      openMember(hit.id);
    }
  }

  const newsGlobe = section === "news" && newsView === "globe";
  const showMap = section === "strait" || section === "districts" || newsGlobe || (section === "congress" && voteView === "map");
  const time = useMapClock({ mapOn: showMap && !calendarTab, base: earthSettings.base, newsGlobe, headlines: news.all, clock, mapTime });
  const outlets = regionOutlets(news.wire?.feeds, newsRegion);
  const seatRoster = useMemo(
    () => congress.roster.filter((m) => m.chamber === chamber).map((m) => ({ name: m.name, state: m.state, district: m.district, party: m.party, bioguide: m.bioguide, vote: "Seat", geoid: null })),
    [congress.roster, chamber]
  );
  const map = mapView({
    section,
    chamber,
    strait: { theater: strait.theater, markers: strait.markers, airMarkers: strait.airMarkers, air: straitFeed === "air" },
    news: { globe: newsGlobe, region: newsRegion, markers: time.globe.markers },
    districts: { geojson: districts.geojson, markers: districts.markers, selected: districts.selected },
    congress: { geojson: congress.geojson, voted: congress.positions.length > 0 }
  });
  const active = SECTIONS.find((item) => item.id === section)!;
  const barFor: Section | null = calendarTab ? null : section;
  const focusSymbol = section === "markets" && (marketView === "chart" || marketView === "supply")
    ? (marketView === "supply" ? supplySymbol : chartSymbol)
    : drawer?.watch || "";
  const reset = () => { setSelectedId(null); setDossier(null); };

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
          <button className="ghost" aria-pressed={calendarTab != null} aria-current={calendarTab ? "page" : undefined} onClick={openCalendar}>Calendar</button>
        </nav>
        <div className="tools">
          {section === "strait" ? (
            <label className="theater">
              <select value={theaterId} onChange={(e) => { setTheaterId(e.target.value); setSelectedId(null); }} aria-label="Theater">
                {strait.theaters.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          ) : null}
          <SearchBox query={query} onQuery={setQuery} onHit={chooseHit} resetOn={section} />
          <PanelsMenu
            open={panelsOpen}
            onOpen={setPanelsOpen}
            section={section}
            focusSymbol={focusSymbol}
            fallbackSymbol={chartSymbol}
            cardCount={cards.cards.length}
            rail={rail.rail}
            onToggleRail={rail.toggle}
            onResetRail={rail.reset}
            onCollapseAll={cards.collapseAll}
            onCloseAll={cards.closeAll}
            openPanel={cards.openPanel}
            openPositions={(s) => void cards.openPositions(s)}
            pinSymbol={(s) => void cards.pinSymbol(s)}
            showChart={(s) => showChart(s, "6mo")}
          />
          <time className="clock" dateTime={clock}>{clock.slice(11, 19)} UTC</time>
        </div>
      </header>
      <main className="stage" style={{ gridTemplateColumns: rail.columns }}>
        <div className="map-wrap">
          <div className="map-bar toggle">
            {calendarTab ? <span className="bar-note">Calendar · Earnings, macro, lobbying, and PAC events · rows open in the dossier · <kbd>esc</kbd> closes</span> : null}
            {barFor === "congress" ? (
              <CongressBar
                chamber={chamber}
                onChamber={(c) => { setChamber(c); reset(); }}
                mode={mode}
                onMode={(m) => { setMode(m); reset(); }}
                voteView={voteView}
                onVoteView={setVoteView}
                party={party}
                onParty={setParty}
                caption={congress.voteCaption}
              />
            ) : null}
            {barFor === "markets" ? (
              <MarketsBar
                view={marketView}
                onView={(v) => { if (v === "supply") setSupplySymbol(chartSymbol); setMarketView(v); }}
                layer={layer}
                onLayer={(l) => { setLayer(l); reset(); }}
                party={party}
                onParty={setParty}
              />
            ) : null}
            {barFor === "news" ? (
              <NewsBar
                view={newsView}
                onView={(v) => { setNewsView(v); if (v === "globe") setMapTime(null); }}
                desk={newsDesk}
                onDesk={(d) => { setNewsDesk(d); setSelectedId(null); }}
                region={newsRegion}
                onRegion={(r) => { setNewsRegion(r); reset(); }}
              />
            ) : null}
            {barFor === "strait" ? <StraitBar feed={straitFeed} onFeed={(f) => { setStraitFeed(f); setSelectedId(null); }} mil={airMil} onMil={setAirMil} /> : null}
            {showMap && !calendarTab ? <EarthBar settings={earthSettings} update={updateEarth} onBase={() => setMapTime(null)} /> : null}
          </div>
          <div className="map-body">
            {calendarTab ? (
              <CalendarBoard
                tab={calendarTab}
                onTab={setCalendarTab}
                meetings={calendar}
                meetingNote={calendarNote}
                onMeeting={(item) => setDossier(meetingModel(item))}
                onDossier={setDossier}
                onClose={() => setCalendarTab(null)}
              />
            ) : section === "markets" ? (
              <MarketStage
                view={marketView}
                chart={{ symbol: chartSymbol, span: chartSpan, marks: chartMarks, onSpan: setChartSpan, onBack: () => setMarketView(chartFrom) }}
                supplySymbol={supplySymbol}
                onSupplySymbol={setSupplySymbol}
                showChart={(s, span) => showChart(s, span)}
                openPositions={(s) => void cards.openPositions(s)}
                openMember={(id) => openMember(id)}
                pinSymbol={(s) => void cards.pinSymbol(s)}
                onDossier={setDossier}
                onFollow={follow}
              />
            ) : section === "news" && !newsGlobe ? (
              <NewsBoard
                wire={news.wire}
                x={news.x}
                items={news.all}
                selectedId={selectedId}
                onSelect={(id) => { setDossier(null); setSelectedId(id); }}
                onTicker={(symbol) => void cards.openPositions(symbol)}
              />
            ) : section === "congress" && voteView === "floor" ? (
              <FloorMap
                chamber={chamber}
                members={congress.positions.length ? congress.positions : seatRoster}
                party={party}
                caption={congress.positions.length ? congress.voteCaption : "No roll call loaded · seats from the current roster"}
                highlight={mode === "committees" ? congress.committeeFocus : null}
                onSelect={(seat) => {
                  if (/^[A-Z]\d{6}$/.test(seat.bioguide)) openMember(seat.bioguide, chamber);
                  else setDossier({
                    title: seat.name,
                    meta: congress.voteCaption || seat.vote,
                    rows: [
                      { label: "Vote", value: seat.vote },
                      { label: "Party", value: seat.party || "—" },
                      { label: "State", value: seat.state || "—" },
                      { label: "District", value: seat.district || (chamber === "senate" ? "Statewide" : "—") }
                    ]
                  });
                }}
              />
            ) : (
              <>
                <MapFrame
                  geojson={map.geojson}
                  colorProp={map.colorProp}
                  markers={map.markers}
                  earth={earth}
                  settings={earthSettings}
                  center={map.center}
                  zoom={map.zoom}
                  selectedId={section === "congress" ? null : selectedId}
                  live={time.liveLayers}
                  dailyTiles={time.dailyLayer?.tiles}
                  flash={newsGlobe ? time.globe.flash : null}
                  onSelect={(id) => {
                    if (section === "congress") openSeat(id);
                    else if (id.startsWith("place:")) setDossier(time.globe.placeModel(id));
                    else setSelectedId(id);
                  }}
                />
                <div className="map-frame" />
                {earthCredit ? <p className="map-cred" title={earthCredit}><em>IMAGERY</em>{earthCredit}</p> : null}
                {newsGlobe ? (
                  <p className="map-outlets">
                    <em>{REGIONS.find((r) => r.id === newsRegion)?.label.toUpperCase()}</em>
                    {newsRegion === "all" ? (
                      <span>{outlets.filter((f) => f.ok).length} regional outlets live across {REGIONS.length - 1} regions · pick a region to list them</span>
                    ) : outlets.length ? outlets.map((f) => (
                      <span key={f.id} className={f.ok ? undefined : "stale"} title={`${f.count} items · fetched in ${f.ms} ms`}>{f.name} <b>{f.count}</b></span>
                    )) : <span>No regional outlet for this view yet</span>}
                  </p>
                ) : null}
                {time.domain ? <TimeBar domain={time.domain} value={mapTime} onChange={setMapTime} notes={time.notes} title={time.title} /> : null}
              </>
            )}
            {barFor === "congress" ? (
              <div className="legend" aria-hidden="true">
                <span><i className="swatch yea" />Yea</span>
                <span><i className="swatch nay" />Nay</span>
                {voteView === "map" ? <span><i className="swatch split" />Split</span> : <span><i className="swatch present" />Present</span>}
                {voteView === "floor" ? <span><i className="ring dem" />D ring</span> : null}
                {voteView === "floor" ? <span><i className="ring rep" />R ring</span> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div
          className={rail.rail.open ? "splitter" : "splitter closed"}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize list panel"
          title="Drag to resize · double-click to hide or show · \ key toggles"
          onPointerDown={rail.drag}
          onDoubleClick={rail.toggle}
        >
          <button className="splitter-tab" aria-label={rail.rail.open ? "Hide list panel" : "Show list panel"} onClick={rail.toggle}>{rail.rail.open ? "▸" : "◂"}</button>
        </div>
        <section className={rail.rail.open ? "rail" : "rail hidden"} aria-label="Records" aria-hidden={!rail.rail.open}>
          <header className="rail-head">
            <div>
              <h1>{active.label}{section === "congress" ? ` · ${mode}` : ""}</h1>
              <p>{section === "congress" ? MODE_BLURB[mode] : active.blurb}</p>
            </div>
            <span className="count">{String(items.length).padStart(2, "0")}</span>
          </header>
          <div className="rail-body">
            {drawer ? (
              <Drawer
                model={drawer}
                onFollow={follow}
                onPin={() => cards.openCard({ title: drawer.title, model: { ...drawer, source: drawer.source || view.status.source } })}
                onClose={closeDossier}
                source={view.status.source}
              />
            ) : null}
            <RecordList items={items} selectedId={selectedId} onSelect={selectRow} empty={view.empty || "Nothing in this list."} />
          </div>
        </section>
      </main>
      <footer className="status">
        <span><em>SOURCE</em><strong>{view.status.source}</strong></span>
        <span><em>AS OF</em>{view.status.asOf || "—"}</span>
        <span title={view.status.latency}><em>NOTE</em>{view.status.latency || "—"}</span>
        <span className="keys"><kbd>1</kbd>–<kbd>5</kbd> sections · <kbd>/</kbd> search · <kbd>esc</kbd> close</span>
      </footer>
      <WidgetLayer cards={cards.cards} onFollow={follow} onClose={cards.close} onChange={cards.change} />
      <div className="scan" aria-hidden="true" />
    </div>
  );
}
