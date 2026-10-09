import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import { CongressBar, ContractsBar, DistrictsBar, EarthBar, ImageryToggle, MarketsBar, NewsBar, StraitBar, StraitPicture, type StraitFeed } from "./shell/MapBar";
import { RelationsMap, useRelations } from "./relations/RelationsMap";
import { FilingOverlay } from "./congress/FilingOverlay";
import { VoteLegend } from "./congress/VoteLegend";
import { placeFilings, useWeekFilings } from "./congress/filingMap";
import { MODE_BLURB, SECTIONS, utcNow, type MarketView } from "./shell/sections";
import { Icon, IconLabel } from "./ui/icons/Icon";
import { useRail } from "./shell/useRail";
import { usePhone } from "./shell/usePhone";
import { useCards } from "./shell/useCards";
import { useMapClock } from "./shell/useMapClock";
import { mapView } from "./shell/mapView";
import { route } from "./shell/follow";
import { trailLabel as labelFor, mapLook, viewFor, viewOnly, type View, type ViewPatch } from "./shell/viewFor";
import { useDossierScope, useView } from "./shell/useView";
import { useCongress } from "./congress/useCongress";
import { STATE_NAME_TO_POSTAL } from "./congress/states";
import { meetingModel } from "./congress/meeting";
import type { ChartSpan } from "./markets/CandleChart";
import type { CalendarTab, Meeting } from "./markets/CalendarBoard";
import { loadDossier, loadLobby, loadPositions, tickerShell, useMarkets, withLobby } from "./markets/useMarkets";
import { useNews } from "./news/useNews";
import { REGIONS, regionOutlets } from "./news/newsGlobe";
import { districtCode, useDistricts } from "./districts/useDistricts";
import { HqLegend } from "./districts/HqLegend";
import { useStrait } from "./strait/useStrait";
import { scopeLabel, useContracts, type ContractScope, type ContractSort } from "./contracts/useContracts";
import { useEarth } from "./lib/useEarth";
import { ALL_SCOPE, scopeOf, useIntelScope, type IntelScope } from "./intel/useIntel";
import { arcView } from "./intel/arcs";
import { Scrubber } from "./intel/Scrubber";
import { presetWindow, type DayWindow } from "./intel/lanes";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import type { ArcKind } from "../shared/intel.mjs";
import type { Chamber, ChartMark, DrawerModel, NewsDesk, PartyFilter, Section, StageList, StatusLine } from "./types";

const MapFrame = lazy(() => import("./shell/MapFrame").then((m) => ({ default: m.MapFrame })));
const FloorMap = lazy(() => import("./congress/FloorMap").then((m) => ({ default: m.FloorMap })));
const CalendarBoard = lazy(() => import("./markets/CalendarBoard").then((m) => ({ default: m.CalendarBoard })));
const MarketStage = lazy(() => import("./markets/MarketStage").then((m) => ({ default: m.MarketStage })));
const MemberTimeline = lazy(() => import("./congress/MemberTimeline").then((m) => ({ default: m.MemberTimeline })));
const NewsBoard = lazy(() => import("./news/NewsBoard").then((m) => ({ default: m.NewsBoard })));
const TodayBoard = lazy(() => import("./congress/TodayBoard").then((m) => ({ default: m.TodayBoard })));
const ContractsBoard = lazy(() => import("./contracts/ContractsBoard").then((m) => ({ default: m.ContractsBoard })));
/** The demo snapshot has no intraday bars. */
const OPEN_SPAN: ChartSpan = DEMO ? "1y" : "5m";

const TRAIL_KEY = "intel:trail:v1";
const TODAY_SEEN = "intel:today:seen";
const TODAY_STATUS: StatusLine = { source: "House Clerk · Senate eFD", asOf: "", latency: "Filed up to 45 days after the trade." };
const TIMELINE_STATUS: StatusLine = { source: "House Clerk PTR PDFs / Senate eFD", asOf: "", latency: "Trade date as disclosed; filed up to 45 days later by law." };
type TodayTab = "week" | "leaders";

export function App() {
  const nav = useView();
  const { section, chamber, mode, voteView, mapLayer, districtLayer, marketView, layer, newsView, selectedId } = nav.view;
  const { setSection, setChamber, setMode, setVoteView, setMapLayer, setDistrictLayer, setMarketView, setLayer, setNewsView, setSelectedId } = nav;
  const [query, setQuery] = useState("");
  const [party, setParty] = useState<PartyFilter>("all");
  const [filingId, setFilingId] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState("AAPL");
  const [chartSpan, setChartSpan] = useState<ChartSpan>(OPEN_SPAN);
  const [chartMarks, setChartMarks] = useState<ChartMark[]>([]);
  const [chartFrom, setChartFrom] = useState<MarketView>("board");
  const [supplySymbol, setSupplySymbol] = useState("AAPL");
  const [newsDesk, setNewsDesk] = useState<NewsDesk>("all");
  const [newsRegion, setNewsRegion] = useState("all");
  const [mapTime, setMapTime] = useState<number | null>(null);
  const [theaterId, setTheaterId] = useState("taiwan-strait");
  const [straitFeed, setStraitFeed] = useState<StraitFeed>("ships");
  const [airMil, setAirMil] = useState(false);
  const [contractScope, setContractScope] = useState<ContractScope>({ kind: "all", value: "" });
  const [contractSort, setContractSort] = useState<ContractSort>("largest");
  const [contractDays, setContractDays] = useState(30);
  const [intelScope, setIntelScope] = useState<IntelScope>(ALL_SCOPE);
  const [intelWindow, setIntelWindow] = useState<DayWindow | null>(null);
  const [arcKinds, setArcKinds] = useState<Set<ArcKind>>(() => new Set<ArcKind>(["trade", "contract", "pac"]));
  const [scrubMin, setScrubMin] = useState(() => window.matchMedia?.("(max-width: 720px)").matches ?? false);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [calendarTab, setCalendarTab] = useState<CalendarTab | null>(null);
  const [calendar, setCalendar] = useState<Meeting[]>([]);
  const [calendarNote, setCalendarNote] = useState("");
  const [dossier, setDossier] = useState<DrawerModel | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(() => location.hash.match(/^#timeline\/([A-Z]\d{6})$/)?.[1] || null);
  const [stageList, setStageList] = useState<StageList | null>(null);
  const [timelineStatus, setTimelineStatus] = useState<StatusLine | null>(null);
  const reportList = useCallback((list: StageList) => setStageList(list), []);
  const reportTimeline = useCallback((status: StatusLine) => setTimelineStatus(status), []);
  const [today, setToday] = useState<TodayTab | null>(() => {
    const hash = location.hash.match(/^#(week|leaders)$/)?.[1] as TodayTab | undefined;
    if (hash) return hash;
    if (location.hash) return null;
    try { return DEMO || !localStorage.getItem(TODAY_SEEN) ? "week" : null; } catch { return "week"; }
  });
  const [clock, setClock] = useState(utcNow);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [trail, setTrail] = useState<(TrailEntry & { view?: View })[]>(() => {
    try { return JSON.parse(localStorage.getItem(TRAIL_KEY) || "[]"); } catch { return []; }
  });
  const trailRef = useRef(trail);
  trailRef.current = trail;
  useEffect(() => { localStorage.setItem(TRAIL_KEY, JSON.stringify(trail)); }, [trail]);
  useEffect(() => { try { localStorage.setItem(TODAY_SEEN, "1"); } catch { /* private mode */ } }, []);

  const phone = usePhone();
  const rail = useRail();
  const cards = useCards();
  const { earth, settings: earthSettings, update: updateEarth, credit: imageryCredit } = useEarth();

  const congress = useCongress(chamber, mode, query, section === "congress" && !today && !timelineId ? selectedId : null, party);
  const congressMapOn = section === "congress" && voteView === "map" && !today && !timelineId && !calendarTab;
  const filingMapOn = congressMapOn && mapLayer === "filings";
  const weekFilings = useWeekFilings(filingMapOn);
  const placed = useMemo(() => placeFilings(congress.states, weekFilings.rows), [congress.states, weekFilings.rows]);
  const activeFiling = weekFilings.rows.find((row) => row.id === filingId) || null;
  useEffect(() => {
    if (!filingMapOn || !weekFilings.rows.length) return;
    if (filingId && weekFilings.rows.some((row) => row.id === filingId)) return;
    setFilingId(weekFilings.rows[0].id);
  }, [filingMapOn, weekFilings.rows, filingId]);
  const markets = useMarkets(layer, query, section === "markets" ? selectedId : null, party, section === "markets");
  const news = useNews(newsDesk, query, section === "news" ? selectedId : null, section === "news", newsRegion);
  const districts = useDistricts(query, section === "districts" ? selectedId : null, congress.roster, districtLayer);
  const strait = useStrait(theaterId, section === "strait" ? selectedId : null, section === "strait" ? straitFeed : "ships", airMil, section === "strait");
  const boardOn = section === "map" && !today && !timelineId && !calendarTab;
  const recordsOn = !today && !timelineId && !calendarTab && (section === "districts" || (section === "congress" && voteView === "map" && mapLayer !== "filings"));
  const intelOn = recordsOn;
  const intel = useIntelScope(intelScope, intelOn);
  const board = useRelations(intelScope, section === "map" ? selectedId : null, boardOn);

  const contracts = useContracts(contractScope, contractSort, contractDays, query, section === "contracts" ? selectedId : null, section === "contracts", congress.roster);

  const straitView = {
    ...strait,
    items: straitFeed === "air" ? strait.airItems : straitFeed === "news" ? strait.newsItems : strait.items,
    empty: straitFeed === "air" ? strait.airEmpty : straitFeed === "news" ? (strait.newsItems.length ? "" : "No recent strait headlines.") : strait.empty
  };
  const view = { congress, markets, contracts, news, districts, strait: straitView, map: board }[section];
  const items = view.items;
  const onToday = Boolean(today) && !timelineId;
  const listItems = onToday ? (stageList?.items ?? []) : items;
  const drawer = onToday || timelineId ? null : (dossier || view.drawer);
  const ids = useMemo(() => listItems.map((item) => item.id), [listItems]);
  const dossierScope = drawer?.watch ? `symbol:${drawer.watch}` : section === "districts" ? drawer?.links?.find((l) => l.label === "Representative")?.action || "" : "";
  useDossierScope(dossierScope, setIntelScope);
  const recordRef = useRef((action: string) => record(action));
  recordRef.current = (action) => record(action);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(utcNow()), 1000);
    const onHash = () => {
      const id = location.hash.match(/^#timeline\/([A-Z]\d{6})$/)?.[1] || null;
      const board = location.hash.match(/^#(week|leaders)$/)?.[1] as TodayTab | undefined;
      if (id || board) recordRef.current(id ? `timeline:${id}` : `today:${board}`);
      if (id) { setSection("congress"); setCalendarTab(null); }
      if (board) { setCalendarTab(null); setToday(board); }
      setTimelineId(id);
    };
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
      if (SECTIONS[index]) go(`section:${SECTIONS[index].id}`);
      if (event.key === "0") go("today:week");
      if (event.key === "Escape") {
        if (timelineId) closeTimeline();
        else closeToday();
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
  }, [ids, selectedId, dossier, timelineId, today]);

  function closeDossier() {
    if (dossier) setDossier(null);
    else setSelectedId(null);
  }

  function openMember(bioguide: string, side?: Chamber) {
    if (!/^[A-Z]\d{6}$/.test(bioguide)) return;
    const known = congress.roster.find((m) => m.bioguide === bioguide);
    cards.openMember(bioguide, side || known?.chamber || chamber, known?.name);
    setIntelScope({ kind: "member", id: bioguide });
  }

  function showChart(symbol: string, span: ChartSpan, marks: ChartMark[] = []) {
    closeStage();
    if (marketView !== "chart") setChartFrom(section === "markets" ? marketView : "board");
    setCalendarTab(null);
    setSection("markets");
    setChartSymbol(symbol);
    setChartSpan(span);
    setChartMarks(marks);
    setMarketView("chart");
  }

  function openSupply(symbol: string) {
    closeStage();
    setCalendarTab(null);
    setSection("markets");
    setSupplySymbol(symbol);
    setMarketView("supply");
  }

  const trailLabel = (action: string) => labelFor(action, (id) => congress.roster.find((m) => m.bioguide === id)?.name || id);

  /** The leaving entry keeps the view as it was left, so back restores toggles changed after arriving. */
  function record(action: string, label?: string) {
    const entry = { action, label: label || trailLabel(action) };
    const left = viewOnly(nav.current.current);
    setTrail(([head, ...t]) => [entry, ...(head ? [{ ...head, view: left }, ...t] : []).filter((e) => e.action !== action)].slice(0, 12));
  }

  /** Apply a navigation patch from `viewFor`: the view fields plus stage, dossier, scope, contracts, cards, rail. */
  function apply(p: ViewPatch) {
    if (p.stage) { closeStage(); setCalendarTab(null); }
    nav.applyPatch(p);
    if (p.dossier === null) setDossier(null);
    if (p.contracts) { setContractScope(p.contracts); if (p.contracts.kind !== "all") setContractSort("recent"); }
    if (p.scope) { setIntelScope(scopeOf(p.scope)); if (p.scope !== "all") setScrubMin(false); }
    if (p.dropCards) cards.dropUnpinned();
    if (p.rail) rail.show();
    if (phone) cards.collapseAll();
  }

  /** Command-line and trail actions: the dossier link kinds plus section, mode, view, layer, calendar, alerts. */
  function runAction(action: string) {
    const [kind, ...rest] = action.split(":");
    const v = rest.join(":");
    if (kind === "map") apply(viewFor("section:map", { intelOn })!);
    else if (kind === "calendar") { closeStage(); setCalendarTab("earnings"); void openCalendarData(); }
    else if (kind === "today") openToday(v === "leaders" ? "leaders" : "week");
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
    if (t[1].view) nav.applyPatch(t[1].view);
  }

  const follow = (action: string) => {
    if (!/^(news|meeting|roll):/.test(action)) record(action);
    routeAction(action);
  };

  const routeAction = (action: string) => {
    const patch = viewFor(action, { intelOn: intelOn || boardOn });
    if (patch) apply(patch);
    else route(action, {
      roll: (id) => {
        if (section !== "congress" || mode !== "bills") return;
        setChamber(id.startsWith("senate") ? "senate" : "house");
        congress.pickRoll(id);
        setVoteView("map");
        setMapLayer("votes");
        setDossier(null);
      },
      member: (id) => openMember(id),
      news: (id) => { setDossier(null); setSelectedId(id); },
      meeting: (id) => { const meeting = calendar.find((m) => m.id === id); if (meeting) setDossier(meetingModel(meeting)); },
      ticker: (symbol) => { showChart(symbol, OPEN_SPAN); setSelectedId(null); void openTickerDossier(symbol, ""); },
      inst: (symbol) => showChart(symbol, "6mo"),
      chart: (symbol) => {
        showChart(symbol, "6mo", chartSymbol === symbol ? chartMarks : []);
        loadPositions(symbol).then((res) => { if (res?.marks.length) setChartMarks(res.marks); }).catch(() => null);
      },
      pos: (symbol) => void cards.openPositions(symbol),
      supply: openSupply,
      timeline: openTimeline
    });
  };

  function openTimeline(bioguide: string) {
    if (!/^[A-Z]\d{6}$/.test(bioguide)) return;
    setCalendarTab(null);
    if (phone) cards.closeAll();
    setSection("congress");
    setTimelineId(bioguide);
    history.replaceState(null, "", `#timeline/${bioguide}`);
  }

  function closeTimeline() {
    setTimelineId(null);
    if (location.hash.startsWith("#timeline/")) history.replaceState(null, "", today ? `#${today}` : location.pathname + location.search);
  }

  function closeToday() {
    setToday(null);
    setSelectedId(null);
    if (/^#(week|leaders)$/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  }

  /** Timeline and the Today board both own the center stage; navigating elsewhere closes both. */
  function closeStage() {
    setTimelineId(null);
    setToday(null);
    if (/^#(timeline\/|week$|leaders$)/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  }

  function openToday(tab: TodayTab) {
    setTimelineId(null);
    setCalendarTab(null);
    setSelectedId(null);
    setDossier(null);
    setToday(tab);
    history.replaceState(null, "", `#${tab}`);
  }

  function openSeat(placeId: string) {
    const place = (state: string) => STATE_NAME_TO_POSTAL[state || ""] || state || "";
    const matches = congress.positions.filter((member) => (chamber === "house" ? member.geoid === placeId : place(member.state) === placeId));
    if (!matches.length) {
      if (!congress.positions.length) return;
      const code = chamber === "house" ? districtCode(placeId) || placeId : placeId;
      setDossier({
        title: code,
        meta: congress.voteCaption || "This roll call",
        rows: [{ label: "Vote", value: "No member cast this roll call here: vacant seat, or a delegate without a floor vote." }]
      });
      return;
    }
    const code = chamber === "house" ? districtCode(placeId) || placeId : placeId;
    setDossier({
      title: chamber === "house" ? `${code} · ${matches[0].vote}` : `${code} senators`,
      meta: congress.voteCaption || "This roll call",
      rows: matches.map((member) => ({ label: member.vote, value: `${member.name} · ${member.party || "—"}-${place(member.state)}` })),
      links: matches.filter((member) => member.bioguide).map((member) => ({ label: "Member", value: `${member.name} record and recent votes`, action: `member:${member.bioguide}` })),
      source: congress.voteSource ? `${congress.voteSource.source} · ${congress.voteSource.asOf}` : undefined
    });
  }

  async function openCalendar() {
    closeStage();
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
    if (onToday) {
      setSelectedId(id);
      const hit = stageList?.items.find((item) => item.id === id);
      if (hit?.action) follow(hit.action);
      return;
    }
    if (phone) cards.collapseAll();
    setDossier(null);
    setSelectedId(id);
    if (section === "congress" && mode === "members") openMember(id, chamber);
    if (section === "congress" && mode === "bills") setVoteView("map");
    if (section === "congress" && (mode === "bills" || mode === "votes")) setMapLayer("votes");
  }

  /** Header first, then the fast joins, then LDA.gov; each step lands only if this ticker's dossier is still open. */
  async function openTickerDossier(symbol: string, name: string) {
    const key = `ticker:${symbol}`;
    const still = (d: DrawerModel | null) => d?.caseKey === key;
    setDossier(tickerShell(symbol, name));
    const loaded = await loadDossier(symbol).catch(() => null);
    if (!loaded) {
      setDossier((d) => (still(d) ? { ...d!, meta: "Ticker dossier did not load. Retry from search.", blocks: [] } : d));
      return;
    }
    const { lobbyClient, ...model } = loaded;
    setDossier((d) => (still(d) ? model : d));
    if (!lobbyClient) return;
    const lines = await loadLobby(lobbyClient);
    setDossier((d) => (still(d) ? withLobby(d!, lines) : d));
  }

  async function chooseHit(hit: SearchHit) {
    if (hit.kind === "ticker") {
      record(`ticker:${hit.id}`);
      showChart(hit.id, OPEN_SPAN);
      setSelectedId(null);
      await openTickerDossier(hit.id, hit.label.slice(hit.id.length + 1));
    } else if (hit.kind === "district") {
      go(`district:${hit.id}`);
    } else if (hit.kind === "site") {
      go(`site:${hit.id}`);
    } else if (/^[A-Za-z]\d{6}$/.test(hit.id)) {
      record(`member:${hit.id}`);
      openMember(hit.id, hit.chamber);
    }
  }

  const newsGlobe = section === "news" && newsView === "globe";
  const lanesOn = section === "strait";
  const showMap = section === "strait" || section === "districts" || section === "map" || newsGlobe || (section === "congress" && voteView === "map");
  const look = mapLook(nav.view, { onMap: showMap && !calendarTab && !today && !timelineId, scoped: intelScope.kind !== "all", settings: earthSettings });
  const earthCredit = look.imagery ? imageryCredit : "";
  const time = useMapClock({ mapOn: look.imagery, base: section === "strait" && earthSettings.base === "live" ? "live" : look.earth.base, newsGlobe, headlines: news.all, clock, mapTime });
  const outlets = regionOutlets(news.wire?.feeds, newsRegion);
  const lagWindow = useDeferredValue(intelWindow);
  const arcs = useMemo(() => {
    if (!intelOn || phone || !intel.data?.ok) return null;
    return arcView(intel.data, lagWindow || presetWindow(intel.data.len, 90), arcKinds);
  }, [intelOn, phone, intel.data, lagWindow, arcKinds]);
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
    congress: {
      geojson: filingMapOn ? placed.geojson : congress.geojson,
      voted: filingMapOn ? false : congress.positions.length > 0,
      markers: filingMapOn ? placed.markers : []
    },
  });
  const active = SECTIONS.find((item) => item.id === section)!;
  const barFor: Section | null = calendarTab || (today && !timelineId) ? null : section;
  const focusSymbol = section === "markets" && (marketView === "chart" || marketView === "supply")
    ? (marketView === "supply" ? supplySymbol : chartSymbol)
    : drawer?.watch || "";
  const foot = timelineId ? (timelineStatus || TIMELINE_STATUS) : onToday ? (stageList?.status || TODAY_STATUS) : view.status;
  const footLabel = timelineId ? "TIMELINE" : onToday ? "TODAY" : rail.rail.open ? "LIST SOURCE" : "LIST (HIDDEN)";
  const reset = () => { setSelectedId(null); setDossier(null); };

  return (
    <div className={`app${phone ? " phone" : ""}${phone && (timelineId || today) ? " tl" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <strong>TRADESIMPLE</strong>
          <span>INTEL</span>
          {DEMO ? <DemoChip /> : null}
        </div>
        <nav className="nav">
          <button aria-current={today ? "page" : undefined} onClick={() => go(`today:${today === "leaders" ? "leaders" : "week"}`)} title="This week in Congress trading, and leaderboards">
            <kbd>0</kbd><IconLabel icon="today" hide>Today</IconLabel>
          </button>
          {SECTIONS.map((item, index) => (
            <button key={item.id} aria-current={section === item.id && !today && !calendarTab ? "page" : undefined} onClick={() => go(`section:${item.id}`)} title={`${item.label} · ${item.blurb}`}>
              <kbd>{index + 1}</kbd><IconLabel icon={item.id} hide>{item.label}</IconLabel>
            </button>
          ))}
          <button className="ghost" aria-pressed={calendarTab != null} aria-current={calendarTab ? "page" : undefined} onClick={openCalendar} title="Calendar"><IconLabel icon="calendar" hide>Calendar</IconLabel></button>
        </nav>
        <div className="tools">
          <button className="go-btn panels-btn" onClick={() => setCmdOpen(true)} title="Command line: tickers + functions (LMT CTR), districts (TX-12), members, section codes"><Icon name="command" /> GO <kbd>⌘K</kbd></button>
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
      <main className="stage" style={phone ? undefined : { gridTemplateColumns: timelineId ? "minmax(0, 1fr)" : rail.columns }}>
        <div className="map-wrap">
          <div className="map-bar toggle">
            {today && !timelineId ? <span className="bar-note">Today · newest Congress trade disclosures and leaderboards · names open timelines, tickers open charts · <kbd>esc</kbd> closes</span> : null}
            {calendarTab ? <span className="bar-note">Calendar · Earnings, macro, lobbying, and PAC events · rows open in the dossier · <kbd>esc</kbd> closes</span> : null}
            {barFor === "congress" ? (
              <CongressBar
                chamber={chamber}
                onChamber={(c) => { setChamber(c); if (mode === "bills") setDossier(null); else reset(); }}
                mode={mode}
                onMode={(m) => { setMode(m); reset(); }}
                voteView={voteView}
                onVoteView={setVoteView}
                party={party}
                onParty={setParty}
                caption={congress.voteCaption}
                rolls={congress.rolls}
                rollId={congress.rollId}
                onRoll={(id) => follow(`roll:${id}`)}
                mapLayer={mapLayer}
                onMapLayer={setMapLayer}
              />
            ) : null}
            {barFor === "districts" ? <DistrictsBar layer={districtLayer} onLayer={(l) => { setDistrictLayer(l); reset(); }} /> : null}
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
            {barFor === "strait" ? (
              <label className="theater">
                <select value={theaterId} onChange={(e) => { setTheaterId(e.target.value); setSelectedId(null); }} aria-label="Theater">
                  {strait.theaters.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            ) : null}
            {barFor === "strait" ? <StraitBar feed={straitFeed} onFeed={(f) => { setStraitFeed(f); setSelectedId(null); }} mil={airMil} onMil={setAirMil} /> : null}
            {barFor === "strait" ? <StraitPicture live={earthSettings.base === "live"} onLive={(live) => updateEarth({ base: live ? "live" : "dark", view: "2d" })} /> : null}
            {look.data && !phone ? <ImageryToggle on={look.imagery} onChange={nav.setImagery} /> : null}
            {look.data && look.imagery && !phone ? <EarthBar settings={earthSettings} update={updateEarth} onBase={() => setMapTime(null)} lanes={lanesOn} /> : null}
            {barFor === "map" ? <span className="bar-note">Each line is the latest trade and how many days later it was filed. A hearing is within 14 days, calendar only. T draws your own.</span> : null}
          </div>
          <div className="map-body">
            <ErrorBoundary name={timelineId || today || calendarTab || !showMap ? "Board" : "Map"} resetKey={`${section}|${timelineId}|${today}|${calendarTab}|${marketView}|${voteView}|${newsView}`}><Suspense fallback={<p className="stage-loading">Loading…</p>}>
            {phone && !timelineId && !today && section !== "map" ? null : timelineId ? (
              <MemberTimeline bioguide={timelineId} onClose={closeTimeline} onFollow={follow} onStatus={reportTimeline} />
            ) : today ? (
              <TodayBoard tab={today} onTab={(t) => go(`today:${t}`)} onFollow={follow} onClose={closeToday} onList={reportList} />
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
              <ContractsBoard board={contracts.board} dod={contracts.dod} onSymbol={(s) => follow(`contracts:symbol:${s}`)} />
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
            ) : section === "map" ? (
              <RelationsMap rel={board} selectedId={selectedId} onSelect={(id) => { setDossier(null); setSelectedId(id); if (id) rail.show(); }} onFollow={follow} />
            ) : (
              <>
                <MapFrame
                  geojson={map.geojson}
                  colorProp={map.colorProp}
                  fill={look.fill}
                  markers={map.markers}
                  earth={earth}
                  settings={newsGlobe ? { ...earthSettings, view: "globe", lanes: false } : section === "strait" ? { ...earthSettings, view: "2d", base: earthSettings.base === "live" ? "live" : "dark" } : look.earth}
                  center={map.center}
                  zoom={map.zoom}
                  selectedId={filingMapOn ? (activeFiling?.state || null) : section === "congress" ? null : selectedId}
                  live={time.liveLayers}
                  dailyTiles={time.dailyLayer?.tiles}
                  flash={newsGlobe ? time.globe.flash : null}
                  lanes={lanesOn}
                  arcs={look.arcs ? arcs : null}
                  onArc={follow}
                  onSelect={(id) => {
                    if (filingMapOn) {
                      const hit = placed.byState[id];
                      if (hit) setFilingId(hit);
                      return;
                    }
                    rail.show();
                    if (section === "congress") openSeat(id);
                    else if (id.startsWith("place:")) setDossier(time.globe.placeModel(id));
                    else setSelectedId(id);
                  }}
                />
                <div className="map-frame" />
                {earthCredit && (section === "strait" || newsGlobe || look.data) ? <p className="map-cred" title={earthCredit}><em>{section === "strait" ? "STRAIT" : newsGlobe ? "GLOBE" : "IMAGERY"}</em>{earthCredit}</p> : null}
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
            </Suspense></ErrorBoundary>
            {filingMapOn ? (
              <FilingOverlay rows={weekFilings.rows} status={weekFilings.status} selectedId={activeFiling?.id || null} onSelect={setFilingId} onFollow={follow} />
            ) : congressMapOn ? (
              <VoteLegend chamber={chamber} counts={congress.mapCounts} source={congress.positions.length ? congress.voteSource : null} />
            ) : null}
            {barFor === "districts" && districtLayer === "hq" && !phone ? <HqLegend top={districts.top} source={districts.status.source} /> : null}
            {barFor === "congress" && !timelineId && !today && voteView === "floor" ? (
              <div className="legend" aria-hidden="true">
                <span><i className="swatch yea" />Yea</span>
                <span><i className="swatch nay" />Nay</span>
                <span><i className="swatch present" />Present</span>
                <span><i className="ring dem" />D ring</span>
                <span><i className="ring rep" />R ring</span>
              </div>
            ) : null}
          </div>
          {intelOn ? (
            <Scrubber
              scope={intelScope}
              data={intel.data}
              loading={intel.loading}
              window={intelWindow}
              onWindow={setIntelWindow}
              kinds={arcKinds}
              onKinds={setArcKinds}
              arcs={arcs}
              mapArcs={look.arcs}
              onMapArcs={nav.setArcs}
              onClearScope={() => setIntelScope(ALL_SCOPE)}
              collapsed={scrubMin}
              onCollapsed={setScrubMin}
              phone={phone}
              onFollow={follow}
            />
          ) : null}
        </div>
        {timelineId ? null : (
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
        )}
        {timelineId ? null : (
        <section className={rail.rail.open || phone ? "rail" : "rail hidden"} aria-label="Records" aria-hidden={!rail.rail.open && !phone}>
          <header className="rail-head">
            <div>
              <h1>{onToday ? (stageList?.title || (today === "leaders" ? "Leaderboards" : "Today")) : `${active.label}${section === "congress" ? ` · ${mode}` : section === "contracts" ? ` · ${scopeLabel(contractScope, contracts.feed)}` : ""}`}</h1>
              <p>{onToday ? (stageList?.blurb || "Newest disclosed trades in this window.") : section === "congress" ? MODE_BLURB[mode] : section === "contracts" ? `${contractSort === "largest" ? "Largest" : "Latest"} actions · last ${contractDays} days · click a row for the award` : active.blurb}</p>
            </div>
            <span className="count">{String(listItems.length).padStart(2, "0")}</span>
          </header>
          <div className="rail-pane">
            {drawer ? (
              <Drawer
                model={drawer}
                onFollow={follow}
                onPin={() => cards.openCard({ title: drawer.title, model: { ...drawer, source: drawer.source || view.status.source } })}
                onClose={closeDossier}
                source={view.status.source}
              />
            ) : null}
            <div className="rail-body">
              <RecordList items={listItems} selectedId={selectedId} onSelect={selectRow} empty={onToday ? (stageList?.empty || "Loading…") : (view.empty || "Nothing in this list.")} />
            </div>
          </div>
        </section>
        )}
      </main>
      <footer className="status">
        <span title={foot.source}><em>{footLabel}</em><strong>{foot.source}</strong></span>
        <span title={foot.asOf}><em>AS OF</em>{foot.asOf || "—"}</span>
        <span title={foot.latency}><em>NOTE</em>{foot.latency || "—"}</span>
        <span className="keys"><kbd>0</kbd> today · <kbd>1</kbd>–<kbd>{SECTIONS.length}</kbd> sections · <kbd>⌘K</kbd> go · <kbd>/</kbd> search · <kbd>esc</kbd> close</span>
      </footer>
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} go={go} roster={congress.roster} trail={trail} />
      <WidgetLayer cards={cards.cards} onFollow={follow} onClose={cards.close} onChange={cards.change} />
    </div>
  );
}
