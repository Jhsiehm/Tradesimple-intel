import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CommandBar, type TrailEntry } from "./shell/CommandBar";
import { api, DEMO } from "./lib/api";
import { DemoChip } from "./shell/DemoChip";
import { AlertsMenu } from "./shell/AlertsMenu";
import { Drawer } from "./shell/Drawer";
import { WidgetLayer } from "./shell/Widgets";
import { RecordList } from "./shell/RecordList";
import { TimeBar } from "./shell/TimeBar";
import { PanelsMenu } from "./shell/PanelsMenu";
import { SearchBox, type SearchHit } from "./shell/SearchBox";
import { CongressBar, ContractsBar, EarthBar, MarketsBar, NewsBar, StraitBar, type StraitFeed } from "./shell/MapBar";
import { MODE_BLURB, SECTIONS, utcNow, type MarketView } from "./shell/sections";
import { useRail } from "./shell/useRail";
import { usePhone } from "./shell/usePhone";
import { useCards } from "./shell/useCards";
import { useMapClock } from "./shell/useMapClock";
import { mapView } from "./shell/mapView";
import { route } from "./shell/follow";
import { useCongress } from "./congress/useCongress";
import { STATE_NAME_TO_POSTAL } from "./congress/states";
import { meetingModel } from "./congress/meeting";
import type { ChartSpan } from "./markets/CandleChart";
import type { CalendarTab, Meeting } from "./markets/CalendarBoard";
import { loadDossier, loadPositions, useMarkets } from "./markets/useMarkets";
import { useNews } from "./news/useNews";
import { REGIONS, regionOutlets } from "./news/newsGlobe";
import { useDistricts } from "./districts/useDistricts";
import { useStrait } from "./strait/useStrait";
import { scopeLabel, useContracts, type ContractScope, type ContractSort } from "./contracts/useContracts";
import { useEarth } from "./lib/useEarth";
import type { Chamber, ChartMark, CongressMode, DrawerModel, MarketLayer, NewsDesk, PartyFilter, Section } from "./types";

const MapFrame = lazy(() => import("./shell/MapFrame").then((m) => ({ default: m.MapFrame })));
const FloorMap = lazy(() => import("./congress/FloorMap").then((m) => ({ default: m.FloorMap })));
const CalendarBoard = lazy(() => import("./markets/CalendarBoard").then((m) => ({ default: m.CalendarBoard })));
const MarketStage = lazy(() => import("./markets/MarketStage").then((m) => ({ default: m.MarketStage })));
const MemberTimeline = lazy(() => import("./congress/MemberTimeline").then((m) => ({ default: m.MemberTimeline })));
const NewsBoard = lazy(() => import("./news/NewsBoard").then((m) => ({ default: m.NewsBoard })));
const ContractsBoard = lazy(() => import("./contracts/ContractsBoard").then((m) => ({ default: m.ContractsBoard })));

const TRAIL_KEY = "intel:trail:v1";

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
  const [contractScope, setContractScope] = useState<ContractScope>({ kind: "all", value: "" });
  const [contractSort, setContractSort] = useState<ContractSort>("largest");
  const [contractDays, setContractDays] = useState(30);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [calendarTab, setCalendarTab] = useState<CalendarTab | null>(null);
  const [calendar, setCalendar] = useState<Meeting[]>([]);
  const [calendarNote, setCalendarNote] = useState("");
  const [dossier, setDossier] = useState<DrawerModel | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(() => location.hash.match(/^#timeline\/([A-Z]\d{6})$/)?.[1] || null);
  const [clock, setClock] = useState(utcNow);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [trail, setTrail] = useState<TrailEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(TRAIL_KEY) || "[]"); } catch { return []; }
  });
  const trailRef = useRef(trail);
  trailRef.current = trail;
  useEffect(() => { localStorage.setItem(TRAIL_KEY, JSON.stringify(trail)); }, [trail]);

  const phone = usePhone();
  const rail = useRail();
  const cards = useCards();
  const { earth, settings: earthSettings, update: updateEarth, credit: earthCredit } = useEarth();

  const congress = useCongress(chamber, mode, query, section === "congress" ? selectedId : null, party);
  const markets = useMarkets(layer, query, section === "markets" ? selectedId : null, party);
  const news = useNews(newsDesk, query, section === "news" ? selectedId : null, section === "news", newsRegion);
  const districts = useDistricts(query, section === "districts" ? selectedId : null);
  const strait = useStrait(theaterId, section === "strait" ? selectedId : null, section === "strait" ? straitFeed : "ships", airMil);

  const contracts = useContracts(contractScope, contractSort, contractDays, query, section === "contracts" ? selectedId : null, section === "contracts", congress.roster);

  const straitView = {
    ...strait,
    items: straitFeed === "air" ? strait.airItems : straitFeed === "news" ? strait.newsItems : strait.items,
    empty: straitFeed === "air" ? strait.airEmpty : straitFeed === "news" ? (strait.newsItems.length ? "" : "No recent strait headlines.") : strait.empty
  };
  const view = { congress, markets, contracts, news, districts, strait: straitView }[section];
  const items = view.items;
  const drawer = dossier || view.drawer;
  const ids = useMemo(() => items.map((item) => item.id), [items]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(utcNow()), 1000);
    const onHash = () => setTimelineId(location.hash.match(/^#timeline\/([A-Z]\d{6})$/)?.[1] || null);
    window.addEventListener("hashchange", onHash);
    return () => { window.clearInterval(timer); window.removeEventListener("hashchange", onHash); };
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }
      if (event.key === ":" && !typing) {
        event.preventDefault();
        setCmdOpen(true);
        return;
      }
      if (event.altKey && event.key === "ArrowLeft" && !typing) {
        event.preventDefault();
        back();
        return;
      }
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
        closeTimeline();
        closeDossier();
        setCalendarTab(null);
        setPanelsOpen(false);
        setAlertsOpen(false);
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
    closeTimeline();
    if (marketView !== "chart") setChartFrom(section === "markets" ? marketView : "board");
    setCalendarTab(null);
    setSection("markets");
    setChartSymbol(symbol);
    setChartSpan(span);
    setChartMarks(marks);
    setMarketView("chart");
  }

  function openSupply(symbol: string) {
    closeTimeline();
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

  function trailLabel(action: string) {
    const [kind, ...rest] = action.split(":");
    const v = rest.join(":");
    const who = (id: string) => congress.roster.find((m) => m.bioguide === id)?.name || id;
    if (kind === "member") return `${who(v)} · card`;
    if (kind === "timeline") return `${who(v)} · timeline`;
    if (kind === "contracts") {
      const [k, val] = v.split(":");
      return k === "member" ? `Contracts · ${who(val)} district` : k === "all" || !val ? "Contracts · all agencies" : `Contracts · ${val}`;
    }
    const label: Record<string, string> = { section: SECTIONS.find((s) => s.id === v)?.label || v, ticker: `${v} dossier`, chart: `${v} chart`, inst: `${v} chart`, pos: `${v} positions`, supply: `${v} supply chain`, bill: `Bill ${v}`, vote: `Roll call ${v}`, committee: `Committee ${v}`, mode: `Congress · ${v}`, view: `Markets · ${v}`, layer: `Markets · ${v}`, calendar: "Calendar", alerts: "Alerts" };
    return label[kind] || action;
  }

  function record(action: string, label?: string) {
    const entry = { action, label: label || trailLabel(action) };
    setTrail((t) => [entry, ...t.filter((e) => e.action !== action)].slice(0, 12));
  }

  /** Command-line and trail actions: the dossier link kinds plus section, mode, view, layer, calendar, alerts. */
  function runAction(action: string) {
    const [kind, ...rest] = action.split(":");
    const v = rest.join(":");
    if (kind === "section") pick(v as Section);
    else if (kind === "mode") { pick("congress"); setMode(v as CongressMode); }
    else if (kind === "view") { pick("markets"); setMarketView(v as MarketView); }
    else if (kind === "layer") { pick("markets"); setLayer(v as MarketLayer); }
    else if (kind === "calendar") { closeTimeline(); setCalendarTab("earnings"); void openCalendarData(); }
    else if (kind === "alerts") { setPanelsOpen(false); setAlertsOpen(true); }
    else routeAction(action);
  }

  function go(action: string, label?: string) {
    record(action, label);
    runAction(action);
  }

  function back() {
    const t = trailRef.current;
    if (t.length < 2) return;
    setTrail(t.slice(1));
    runAction(t[1].action);
  }

  const follow = (action: string) => {
    if (!/^(news|meeting):/.test(action)) record(action);
    routeAction(action);
  };

  const routeAction = (action: string) => route(action, {
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
    supply: openSupply,
    timeline: openTimeline,
    contracts: (value) => {
      const [kind, ...rest] = value.split(":");
      openContracts(["symbol", "place", "member"].includes(kind) ? { kind: kind as ContractScope["kind"], value: rest.join(":").toUpperCase() } : { kind: "all", value: "" });
    }
  });

  function openContracts(scope: ContractScope) {
    closeTimeline();
    setCalendarTab(null);
    setSection("contracts");
    setContractScope(scope);
    if (scope.kind !== "all") setContractSort("recent");
    setSelectedId(null);
    setDossier(null);
  }

  function openTimeline(bioguide: string) {
    if (!/^[A-Z]\d{6}$/.test(bioguide)) return;
    setCalendarTab(null);
    if (phone) cards.closeAll();
    setTimelineId(bioguide);
    history.replaceState(null, "", `#timeline/${bioguide}`);
  }

  function closeTimeline() {
    setTimelineId(null);
    if (location.hash.startsWith("#timeline/")) history.replaceState(null, "", location.pathname + location.search);
  }

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
    closeTimeline();
    setCalendarTab(null);
    setSection(next);
    setSelectedId(null);
    setDossier(null);
    cards.dropUnpinned();
  }

  async function openCalendar() {
    closeTimeline();
    setCalendarTab((open) => (open ? null : "earnings"));
    await openCalendarData();
  }

  async function openCalendarData() {
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
    <div className={`app${phone ? " phone" : ""}${phone && timelineId ? " tl" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <strong>TRADESIMPLE</strong>
          <span>INTEL</span>
          {DEMO ? <DemoChip /> : null}
        </div>
        <nav className="nav">
          {SECTIONS.map((item, index) => (
            <button key={item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => go(`section:${item.id}`)}>
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
          <button className="go-btn panels-btn" onClick={() => setCmdOpen(true)} title="Command line: tickers + functions (LMT CTR), districts (TX-12), members, section codes">GO <kbd>⌘K</kbd></button>
          <SearchBox query={query} onQuery={setQuery} onHit={chooseHit} resetOn={section} />
          <AlertsMenu open={alertsOpen} onOpen={(v) => { setAlertsOpen(v); if (v) setPanelsOpen(false); }} onFollow={follow} />
          <PanelsMenu
            open={panelsOpen}
            onOpen={(v) => { setPanelsOpen(v); if (v) setAlertsOpen(false); }}
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
      <main className="stage" style={phone ? undefined : { gridTemplateColumns: rail.columns }}>
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
            {barFor === "contracts" ? (
              <ContractsBar
                scope={contractScope}
                onScope={(s) => { setContractScope(s); reset(); }}
                sort={contractSort}
                onSort={setContractSort}
                days={contractDays}
                onDays={setContractDays}
              />
            ) : null}
            {barFor === "strait" ? <StraitBar feed={straitFeed} onFeed={(f) => { setStraitFeed(f); setSelectedId(null); }} mil={airMil} onMil={setAirMil} /> : null}
            {showMap && !calendarTab && !phone ? <EarthBar settings={earthSettings} update={updateEarth} onBase={() => setMapTime(null)} /> : null}
          </div>
          <div className="map-body">
            <Suspense fallback={<p className="stage-loading">Loading…</p>}>
            {phone && !timelineId ? null : timelineId ? (
              <MemberTimeline bioguide={timelineId} onClose={closeTimeline} onFollow={follow} />
            ) : calendarTab ? (
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
            ) : section === "contracts" ? (
              <ContractsBoard board={contracts.board} dod={contracts.dod} onSymbol={(s) => openContracts({ kind: "symbol", value: s })} />
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
            </Suspense>
            {barFor === "congress" && !timelineId ? (
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
        <section className={rail.rail.open || phone ? "rail" : "rail hidden"} aria-label="Records" aria-hidden={!rail.rail.open && !phone}>
          <header className="rail-head">
            <div>
              <h1>{active.label}{section === "congress" ? ` · ${mode}` : section === "contracts" ? ` · ${scopeLabel(contractScope, contracts.feed)}` : ""}</h1>
              <p>{section === "congress" ? MODE_BLURB[mode] : section === "contracts" ? `${contractSort === "largest" ? "Largest" : "Latest"} actions · last ${contractDays} days · click a row for the award` : active.blurb}</p>
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
        <span className="keys"><kbd>1</kbd>–<kbd>6</kbd> sections · <kbd>⌘K</kbd> go · <kbd>/</kbd> search · <kbd>esc</kbd> close</span>
      </footer>
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} go={go} roster={congress.roster} trail={trail} />
      <WidgetLayer cards={cards.cards} onFollow={follow} onClose={cards.close} onChange={cards.change} />
      <div className="scan" aria-hidden="true" />
    </div>
  );
}
