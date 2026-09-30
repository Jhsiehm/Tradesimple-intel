import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, when } from "./lib/api";
import { Drawer } from "./shell/Drawer";
import { WidgetLayer, clampCard, type WidgetCard } from "./shell/Widgets";
import { MapFrame } from "./shell/MapFrame";
import { RecordList } from "./shell/RecordList";
import { useCongress } from "./congress/useCongress";
import { STATE_NAME_TO_POSTAL } from "./congress/states";
import { FloorMap } from "./congress/FloorMap";
import { CandleChart, type ChartSpan } from "./markets/CandleChart";
import { QuoteBoard } from "./markets/QuoteBoard";
import { PositionsBoard } from "./markets/PositionsBoard";
import { FxBoard } from "./markets/FxBoard";
import { CryptoBoard } from "./markets/CryptoBoard";
import { CalendarBoard, econModel, type CalendarTab, type Meeting } from "./markets/CalendarBoard";
import { loadDossier, loadPositions, useMarkets } from "./markets/useMarkets";
import { useNews } from "./news/useNews";
import { NewsBoard } from "./news/NewsBoard";
import { useDistricts } from "./districts/useDistricts";
import { useStrait } from "./strait/useStrait";
import type { Chamber, ChartMark, CongressMode, DrawerModel, EarthBase, EarthView, MarketLayer, NewsDesk, PartyFilter, Section } from "./types";
import { useEarth } from "./lib/useEarth";
import { dailyDomain, dailyTiles, liveDomain, liveTiles, useLive } from "./lib/useLive";
import { TimeBar, span, stamp, type Domain, type TimeNote } from "./shell/TimeBar";
import { NEWS_WINDOW, REGIONS, regionOutlets, useNewsGlobe } from "./news/newsGlobe";
import { GlobalBoard } from "./markets/GlobalBoard";
import { SupplyBoard } from "./markets/SupplyBoard";
import { PANEL_TITLE, type PanelKind } from "./shell/Panels";
import { toggleSymbol, useWatch } from "./lib/useWatch";
import "maplibre-gl/dist/maplibre-gl.css";

const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "congress", label: "Congress", blurb: "Votes, bills, members, committees" },
  { id: "markets", label: "Markets", blurb: "Trades, filings, shorts, holdings" },
  { id: "news", label: "News", blurb: "Global wires and X" },
  { id: "districts", label: "Districts", blurb: "Plants and headquarters on the map" },
  { id: "strait", label: "Strait", blurb: "Ships, news, and open imagery" }
];

const MODE_BLURB: Record<CongressMode, string> = {
  votes: "Roll calls · close votes first",
  bills: "Bills by latest action",
  members: "Every seat · click for the member card",
  committees: "Committees · members, bills, meetings"
};

type MarketView = "board" | "globals" | "fx" | "crypto" | "positions" | "supply" | "chart";

const PANEL_SIZE: Record<PanelKind, { w: number; h: number }> = {
  watch: { w: 420, h: 420 },
  x: { w: 380, h: 560 },
  lastbuy: { w: 560, h: 520 },
  wire: { w: 420, h: 560 },
  globals: { w: 620, h: 560 },
  supply: { w: 720, h: 640 }
};

type Rail = { w: number; open: boolean };

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function storedCards(): WidgetCard[] {
  try {
    const raw = JSON.parse(localStorage.getItem("intel:cards:v1") || "[]");
    return Array.isArray(raw) ? raw.filter((c) => c && c.pinned && !String(c.id).startsWith("split:")) : [];
  } catch {
    return [];
  }
}

const BASE_TITLE: Record<EarthBase, string> = {
  dark: "Vector basemap",
  sat: "Esri World Imagery · mixed capture dates, not current",
  live: "GOES + Himawari frames every 10 min · scrub back 30h",
  daily: "VIIRS NOAA-20 daily true color · scrub back 30 days",
  night: "Black Marble night lights · 2016 composite"
};

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
  const [newsDesk, setNewsDesk] = useState<NewsDesk>("all");
  const [newsView, setNewsView] = useState<"board" | "globe">("board");
  const [newsRegion, setNewsRegion] = useState("all");
  const [mapTime, setMapTime] = useState<number | null>(null);
  const [theaterId, setTheaterId] = useState("taiwan-strait");
  const [straitFeed, setStraitFeed] = useState<"ships" | "news" | "air">("ships");
  const [airMil, setAirMil] = useState(false);
  const [supplySymbol, setSupplySymbol] = useState("AAPL");
  const [rail, setRail] = useState<Rail>(() => stored("intel:rail:v1", { w: 360, open: true }));
  const [panelsOpen, setPanelsOpen] = useState(false);
  const { watch } = useWatch();
  const { earth, settings: earthSettings, update: updateEarth, credit: earthCredit } = useEarth();
  const [calendarTab, setCalendarTab] = useState<CalendarTab | null>(null);
  const [chartFrom, setChartFrom] = useState<MarketView>("board");
  const [calendar, setCalendar] = useState<Meeting[]>([]);
  const [calendarNote, setCalendarNote] = useState("");
  const [dossier, setDossier] = useState<DrawerModel | null>(null);
  const [cards, setCards] = useState<WidgetCard[]>(storedCards);
  const [hits, setHits] = useState<{ kind: string; id: string; label: string }[]>([]);
  const [clock, setClock] = useState(() => utcNow());

  const congress = useCongress(chamber, mode, query, section === "congress" ? selectedId : null, party);
  const markets = useMarkets(layer, query, section === "markets" ? selectedId : null, party);
  const news = useNews(newsDesk, query, section === "news" ? selectedId : null, section === "news", newsRegion);
  const districts = useDistricts(query, section === "districts" ? selectedId : null);
  const strait = useStrait(theaterId, section === "strait" ? selectedId : null, section === "strait" ? straitFeed : "ships", airMil);

  const straitView = {
    ...strait,
    items: straitFeed === "air" ? strait.airItems : straitFeed === "news" ? strait.newsItems : strait.items,
    empty: straitFeed === "air"
      ? strait.airEmpty
      : straitFeed === "news"
      ? (strait.newsItems.length ? "" : "No recent strait headlines.")
      : strait.empty
  };
  const view = section === "congress" ? congress
    : section === "markets" ? markets
    : section === "news" ? news
    : section === "districts" ? districts
    : straitView;
  const items = view.items;
  const drawer = dossier || (
    section === "congress" ? congress.drawer
    : section === "markets" ? markets.drawer
    : section === "news" ? news.drawer
    : section === "districts" ? districts.drawer
    : strait.drawer
  );

  const ids = useMemo(() => items.map((item) => item.id), [items]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(utcNow()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("intel:rail:v1", JSON.stringify(rail));
  }, [rail]);

  useEffect(() => {
    localStorage.setItem("intel:cards:v1", JSON.stringify(cards.filter((c) => c.pinned && !c.id.startsWith("split:"))));
  }, [cards]);

  useEffect(() => {
    const fit = () => setCards((current) => current.map((card) => ({ ...card, ...clampCard(card) })));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const focus = markets.chartFocus;
    if (!focus) return;
    setChartSymbol(focus.symbol);
    setChartSpan("6mo");
    setMarketView("chart");
    setChartMarks(focus.marks);
  }, [markets.chartFocus]);

  const memberPair = cards.filter((card) => card.memberId).slice(0, 2).map((card) => `${card.memberId}:${card.chamber || "house"}`).join("|");
  useEffect(() => {
    const parts = memberPair.split("|").filter(Boolean);
    if (parts.length < 2) {
      setCards((current) => current.some((card) => card.id.startsWith("split:")) ? current.filter((card) => !card.id.startsWith("split:")) : current);
      return;
    }
    const [left, right] = parts.map((part) => {
      const [id, side] = part.split(":");
      return { id, side };
    });
    let cancel = false;
    const place = (model: DrawerModel) => {
      if (cancel) return;
      const cardId = `split:${left.id}:${right.id}`;
      setCards((current) => {
        const rest = current.filter((card) => !card.id.startsWith("split:"));
        const placed = clampCard({ id: cardId, title: model.title, pinned: true, x: 128, y: 128, w: 440, h: 480, model });
        return [...rest, { id: cardId, title: model.title, pinned: true, model, x: placed.x ?? 128, y: placed.y ?? 128, w: placed.w ?? 440, h: placed.h ?? 480 }];
      });
    };
    if (left.side !== right.side) {
      place({
        title: "Split",
        meta: "Different chambers",
        rows: [{ label: "Roll calls", value: "These two seats are not on the same roll-call list." }]
      });
      return () => { cancel = true; };
    }
    api<{
      ok: boolean;
      latency?: string;
      shared?: number;
      a?: { name: string };
      b?: { name: string };
      splits?: { id: string; question: string; date: string; a: string; b: string }[];
    }>(`/api/congress/compare?a=${left.id}&b=${right.id}&chamber=${left.side}`)
      .then((res) => {
        if (!res.ok || !res.a || !res.b) return;
        const splits = res.splits || [];
        place({
          title: `${res.a.name} / ${res.b.name}`,
          meta: res.latency,
          rows: splits.length
            ? splits.map((row) => ({ label: `${row.a} / ${row.b}`, value: row.question || "Roll call" }))
            : [{ label: "Split", value: res.shared ? "Same vote on every shared roll call in this window." : "No shared roll call in this window." }],
          links: splits.map((row) => ({ label: (row.date || "").slice(0, 10), value: row.question || "Roll call", action: `vote:${row.id}` }))
        });
      })
      .catch(() => null);
    return () => { cancel = true; };
  }, [memberPair]);

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
        setRail((r) => ({ ...r, open: !r.open }));
        return;
      }
      const index = Number(event.key) - 1;
      if (SECTIONS[index]) pick(SECTIONS[index].id);
      if (event.key === "Escape") {
        closeDossier();
        setCalendarTab(null);
        setHits([]);
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

  function memberPlace(state: string) {
    const raw = state || "";
    return STATE_NAME_TO_POSTAL[raw] || raw;
  }

  function placeCard(id: string, model: DrawerModel, size: { w: number; h: number }) {
    setCards((current) => {
      const rest = current.filter((card) => card.id !== id);
      const placed = clampCard({ id, title: model.title, pinned: true, x: 64 + (rest.length % 5) * 28, y: 88 + (rest.length % 5) * 24, ...size, model });
      return [...rest, { id, title: model.title, pinned: true, model, x: placed.x ?? 64, y: placed.y ?? 88, w: placed.w ?? size.w, h: placed.h ?? size.h }];
    });
  }

  async function pinSymbol(symbol: string) {
    const model = await loadDossier(symbol);
    if (model) placeCard(`${symbol}-dossier`, model, { w: 440, h: 560 });
  }

  async function openPositions(symbol: string) {
    const res = await loadPositions(symbol).catch(() => null);
    if (res) placeCard(`${symbol}-positions`, res.model, { w: 640, h: 600 });
  }

  function openCard(partial: Omit<WidgetCard, "id" | "pinned" | "x" | "y" | "w" | "h"> & { title: string }) {
    const id = `${partial.memberId || partial.title}-${Date.now()}`;
    const wide = Boolean(partial.model?.tables?.length);
    const placed = clampCard({
      ...partial,
      id,
      title: partial.title,
      pinned: true,
      x: 72 + (cards.length % 5) * 26,
      y: 92 + (cards.length % 5) * 26,
      w: partial.memberId ? 420 : wide ? 560 : 360,
      h: partial.memberId ? 520 : wide ? 560 : 380
    });
    setCards((current) => [...current, {
      ...partial,
      id,
      pinned: true,
      x: placed.x ?? 72,
      y: placed.y ?? 92,
      w: placed.w ?? 360,
      h: placed.h ?? 380
    }]);
  }

  function openMember(bioguide: string, side?: Chamber) {
    if (!/^[A-Z]\d{6}$/.test(bioguide)) return;
    const known = congress.roster.find((m) => m.bioguide === bioguide);
    const seat: Chamber = side || known?.chamber || chamber;
    setCards((current) => {
      if (current.some((card) => card.memberId === bioguide)) return current;
      const placed = clampCard({
        id: bioguide,
        title: "Member",
        pinned: true,
        x: 88 + (current.length % 4) * 28,
        y: 96 + (current.length % 4) * 24,
        w: 460,
        h: 600,
        memberId: bioguide,
        chamber: seat
      });
      return [...current, { ...placed, id: bioguide, title: known?.name || "Member", pinned: true, memberId: bioguide, chamber: seat, x: placed.x || 88, y: placed.y || 96, w: placed.w || 460, h: placed.h || 600 }];
    });
  }

  function showChart(symbol: string, span: ChartSpan, marks: ChartMark[]) {
    if (marketView !== "chart") setChartFrom(section === "markets" ? marketView : "board");
    setCalendarTab(null);
    setSection("markets");
    setChartSymbol(symbol);
    setChartSpan(span);
    setChartMarks(marks);
    setMarketView("chart");
  }

  function follow(action: string) {
    const [kind, ...rest] = action.split(":");
    const value = rest.join(":");
    if (kind === "bill") {
      setSection("congress");
      setMode("bills");
      setSelectedId(value);
      setDossier(null);
      return;
    }
    if (kind === "vote") {
      setSection("congress");
      setChamber(value.startsWith("senate") ? "senate" : "house");
      setMode("votes");
      setSelectedId(value);
      setDossier(null);
      return;
    }
    if (kind === "member") {
      openMember(value);
      return;
    }
    if (kind === "news") {
      setDossier(null);
      setSelectedId(value);
      return;
    }
    if (kind === "committee") {
      setSection("congress");
      if (value.startsWith("HS")) setChamber("house");
      if (value.startsWith("SS")) setChamber("senate");
      setMode("committees");
      setSelectedId(value);
      setDossier(null);
      return;
    }
    if (kind === "meeting") {
      const meeting = calendar.find((m) => m.id === value);
      if (meeting) setDossier(meetingModel(meeting));
      return;
    }
    if (kind === "ticker") {
      showChart(value, "5m", []);
      setSelectedId(null);
      setDossier(null);
      return;
    }
    if (kind === "inst") {
      showChart(value, "6mo", []);
      return;
    }
    if (kind === "chart") {
      showChart(value, "6mo", chartSymbol === value ? chartMarks : []);
      loadPositions(value).then((res) => { if (res?.marks.length) setChartMarks(res.marks); }).catch(() => null);
      return;
    }
    if (kind === "pos") {
      void openPositions(value);
      return;
    }
    if (kind === "supply") {
      setCalendarTab(null);
      setSection("markets");
      setSupplySymbol(value);
      setMarketView("supply");
    }
  }

  function openPanel(kind: PanelKind, symbol?: string) {
    const id = kind === "supply" ? `panel:supply:${symbol || "AAPL"}` : `panel:${kind}`;
    const title = kind === "supply" ? `Supply chain · ${symbol || "AAPL"}` : PANEL_TITLE[kind];
    setCards((current) => {
      if (current.some((c) => c.id === id)) return current.map((c) => (c.id === id ? { ...c, min: false } : c));
      const size = PANEL_SIZE[kind];
      const n = current.length % 5;
      const base: WidgetCard = { id, title, pinned: true, kind, symbol, x: window.innerWidth - size.w - 32 - n * 28, y: 84 + n * 28, ...size };
      return [...current, { ...base, ...clampCard(base) }];
    });
  }

  function dragRail(event: ReactPointerEvent) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const startX = event.clientX;
    const startW = rail.open ? rail.w : 0;
    document.body.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      const w = Math.min(Math.round(window.innerWidth * 0.7), Math.max(0, startW - (ev.clientX - startX)));
      setRail((r) => (w < 180 ? { ...r, open: false } : { w: Math.round(w), open: true }));
    };
    const up = () => {
      document.body.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function openSeat(placeId: string) {
    const matches = congress.positions.filter((member) =>
      chamber === "house" ? member.geoid === placeId : memberPlace(member.state) === placeId
    );
    if (!matches.length) return;
    if (matches.length === 1 && matches[0].bioguide) {
      openMember(matches[0].bioguide, chamber);
      return;
    }
    setDossier({
      title: `${matches.length} senators`,
      meta: congress.voteCaption || "This roll call",
      rows: [],
      links: matches.filter((member) => member.bioguide).map((member) => ({
        label: member.vote,
        value: `${member.name} · ${member.party || "—"}`,
        action: `member:${member.bioguide}`
      }))
    });
  }

  function pick(next: Section) {
    setCalendarTab(null);
    setSection(next);
    setSelectedId(null);
    setDossier(null);
    setHits([]);
    setCards((current) => current.filter((card) => card.pinned));
  }

  async function loadCalendar() {
    if (calendar.length) return calendar;
    const res = await api<{ ok: boolean; missing?: string; items: Meeting[] }>("/api/congress/calendar");
    if (res.missing) setCalendarNote(`Set ${res.missing} to load the session calendar.`);
    setCalendar(res.items || []);
    return res.items || [];
  }

  function openCalendar() {
    setCalendarTab((open) => (open ? null : "earnings"));
    void loadCalendar();
  }

  function selectRow(id: string) {
    setDossier(null);
    setSelectedId(id);
    if (section === "congress" && mode === "members") openMember(id, chamber);
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
      ...res.members.map((m) => ({ kind: "member", id: m.id, label: `${m.name} ${m.state}-${m.district || "Sen"}` }))
    ].slice(0, 8));
  }

  async function chooseHit(hit: { kind: string; id: string }) {
    setHits([]);
    if (hit.kind === "ticker") {
      showChart(hit.id, "5m", []);
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
  const liveOn = showMap && !calendarTab && (earthSettings.base === "live" || earthSettings.base === "daily");
  const live = useLive(liveOn);
  const minute = Math.floor(Date.parse(clock) / 600000) * 600000;
  const timeDomain: Domain | null = !showMap || calendarTab ? null
    : earthSettings.base === "live" && live ? liveDomain(live)
    : earthSettings.base === "daily" && live ? dailyDomain(live)
    : newsGlobe ? { start: minute - 48 * 3600000, end: minute, step: 600000 }
    : null;
  const cursor = mapTime ?? timeDomain?.end ?? Date.now();
  const liveLayers = live && earthSettings.base === "live" ? liveTiles(live, cursor) : undefined;
  const dailyLayer = live ? dailyTiles(live, earthSettings.base === "daily" ? cursor : Date.now()) : undefined;
  const globe = useNewsGlobe(news.all, mapTime == null ? Date.parse(clock) : earthSettings.base === "daily" ? cursor + 86400000 : cursor);
  const outlets = regionOutlets(news.wire?.feeds, newsRegion);
  const timeTitle = earthSettings.base === "live" ? "LIVE SAT" : earthSettings.base === "daily" ? "DAILY PASS" : "NEWS CLOCK";
  const timeNotes: TimeNote[] = [
    ...(liveLayers || []).map((l) => {
      const old = Date.now() - l.frame;
      return { label: l.name.split(" ")[0], text: `${stamp(l.frame).slice(6)} · ${span(old)} old`, tone: old > 2 * 3600000 ? "stale" as const : "ok" as const };
    }),
    ...(earthSettings.base === "live" && dailyLayer ? [{ label: "VIIRS", text: `${dailyLayer.day} under Europe, Africa, Mideast, India` }] : []),
    ...(earthSettings.base === "daily" && dailyLayer ? [{ label: "VIIRS NOAA-20", text: `${dailyLayer.day} · one polar pass per day` }] : []),
    ...(newsGlobe ? [{ label: "NEWS", text: `${globe.count} tagged headlines at ${globe.places} places · ${NEWS_WINDOW / 3600000}h window` }] : [])
  ];
  const seatRoster = useMemo(
    () => congress.roster.filter((m) => m.chamber === chamber).map((m) => ({ name: m.name, state: m.state, district: m.district, party: m.party, bioguide: m.bioguide, vote: "Seat", geoid: null })),
    [congress.roster, chamber]
  );
  const map = mapProps();
  const active = SECTIONS.find((item) => item.id === section)!;
  const blurb = section === "congress" ? MODE_BLURB[mode] : active.blurb;
  const partyButtons = (
    <span className="seg">
      {(["all", "D", "R", "I"] as PartyFilter[]).map((p) => (
        <button key={p} className={p === "D" ? "p-dem" : p === "R" ? "p-rep" : undefined} aria-pressed={party === p} onClick={() => setParty(p)}>
          {p === "all" ? "All" : p}
        </button>
      ))}
    </span>
  );
  const barFor: Section | null = calendarTab ? null : section;
  const earthButtons = (
    <>
      <span className="seg" title="Projection">
        {(["2d", "globe", "3d"] as EarthView[]).map((v) => (
          <button key={v} aria-pressed={earthSettings.view === v} onClick={() => updateEarth({ view: v })}>
            {v === "2d" ? "2D" : v === "globe" ? "Globe" : "3D"}
          </button>
        ))}
      </span>
      <span className="seg" title="Imagery">
        {([["dark", "Map"], ["sat", "Mosaic"], ["live", "Live"], ["daily", "Daily"], ["night", "Night"]] as [EarthBase, string][]).map(([b, label]) => (
          <button key={b} aria-pressed={earthSettings.base === b} onClick={() => { updateEarth({ base: b }); setMapTime(null); }} title={BASE_TITLE[b]}>{label}</button>
        ))}
      </span>
      <span className="seg">
        <button aria-pressed={earthSettings.labels} onClick={() => updateEarth({ labels: !earthSettings.labels })}>Labels</button>
        <button aria-pressed={earthSettings.lanes} onClick={() => updateEarth({ lanes: !earthSettings.lanes })}>Lanes</button>
      </span>
    </>
  );

  const focusSymbol = section === "markets" && (marketView === "chart" || marketView === "supply")
    ? (marketView === "supply" ? supplySymbol : chartSymbol)
    : drawer?.watch || "";
  const suggestions: { label: string; why: string; run: () => void }[] = [
    ...(focusSymbol ? [
      { label: `Supply chain · ${focusSymbol}`, why: "Suppliers, customers, linked indexes, co-movement", run: () => openPanel("supply", focusSymbol) },
      { label: `Positions · ${focusSymbol}`, why: "Every Congress, insider, and fund filer, with the last buyer", run: () => void openPositions(focusSymbol) },
      { label: `Dossier · ${focusSymbol}`, why: "Quote, lobbying, PACs, contracts, district seats", run: () => void pinSymbol(focusSymbol) },
      { label: `${watch.symbols.includes(focusSymbol) ? "★ Unwatch" : "☆ Watch"} ${focusSymbol}`, why: "Keep it on the watchlist card", run: () => toggleSymbol(focusSymbol) }
    ] : []),
    ...(section === "congress" ? [
      { label: "Last buyers", why: "Who in Congress bought each name most recently", run: () => openPanel("lastbuy") },
      { label: "Watchlist", why: "Latest trade for each watched member", run: () => openPanel("watch") }
    ] : []),
    ...(section === "markets" && !focusSymbol ? [
      { label: "Last buyers", why: "Most recent Congress and insider buys", run: () => openPanel("lastbuy") },
      { label: "Global markets", why: "World indices and ADR premiums while you scan US names", run: () => openPanel("globals") }
    ] : []),
    ...(section === "news" ? [
      { label: "X pulse", why: "Trending topics and market-moving accounts beside the wires", run: () => openPanel("x") },
      { label: "Global markets", why: "See which markets are reacting to the headline", run: () => openPanel("globals") }
    ] : []),
    ...(section === "strait" ? [
      { label: "Global markets", why: "TAIEX, Hang Seng, Nikkei, and the TSMC ADR premium", run: () => openPanel("globals") },
      { label: "Supply chain · TSM", why: "Who depends on Taiwan fabs", run: () => openPanel("supply", "TSM") },
      { label: "X pulse", why: "OSINT accounts and what is trending", run: () => openPanel("x") }
    ] : []),
    ...(section === "districts" ? [
      { label: "Headlines", why: "Wire stories for companies with plants on the map", run: () => openPanel("wire") }
    ] : [])
  ];
  const workspaces: { label: string; why: string; run: () => void }[] = [
    { label: `Ticker research · ${focusSymbol || chartSymbol}`, why: "Chart, dossier, positions, and supply chain together", run: () => { const s = focusSymbol || chartSymbol; showChart(s, "6mo", []); void pinSymbol(s); void openPositions(s); openPanel("supply", s); } },
    { label: "Congress money trail", why: "Watchlist, last buyers, and headlines", run: () => { openPanel("watch"); openPanel("lastbuy"); openPanel("wire"); } },
    { label: "Global macro & arbitrage map", why: "World indices, ADR premiums, and X trending", run: () => { openPanel("globals"); openPanel("x"); } }
  ];
  const stageCols = `minmax(0, 1fr) 8px ${rail.open ? rail.w : 0}px`;

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
          <button className="ghost panels-btn" aria-expanded={panelsOpen} onClick={() => setPanelsOpen((o) => !o)}>Panels{cards.length ? ` · ${cards.length}` : ""}</button>
          <time className="clock" dateTime={clock}>{clock.slice(11, 19)} UTC</time>
          {panelsOpen ? (
            <div className="panels-menu" role="menu">
              <h4>Pin a panel <small>stays open across tabs · drag, resize from any edge, – to collapse</small></h4>
              <div className="panels-grid">
                {(["watch", "x", "lastbuy", "wire", "globals"] as PanelKind[]).map((k) => (
                  <button key={k} onClick={() => { openPanel(k); setPanelsOpen(false); }}>
                    {PANEL_TITLE[k]}
                    {k === "watch" ? <small>{watch.symbols.length} tickers · {watch.members.length} members</small> : null}
                  </button>
                ))}
                <button onClick={() => { openPanel("supply", focusSymbol || chartSymbol); setPanelsOpen(false); }}>Supply chain<small>{focusSymbol || chartSymbol}</small></button>
              </div>
              {suggestions.length ? (
                <>
                  <h4>Suggested for this view</h4>
                  {suggestions.map((sg) => (
                    <button key={sg.label} className="panels-row" onClick={() => { sg.run(); setPanelsOpen(false); }}>
                      <strong>{sg.label}</strong><span>{sg.why}</span>
                    </button>
                  ))}
                </>
              ) : null}
              <h4>Workspaces</h4>
              {workspaces.map((ws) => (
                <button key={ws.label} className="panels-row" onClick={() => { ws.run(); setPanelsOpen(false); }}>
                  <strong>{ws.label}</strong><span>{ws.why}</span>
                </button>
              ))}
              <h4>Layout</h4>
              <div className="panels-grid">
                <button onClick={() => setRail((r) => ({ ...r, open: !r.open }))}>{rail.open ? "Hide list panel" : "Show list panel"}<small>or press {"\\"}</small></button>
                <button onClick={() => setRail({ w: 360, open: true })}>Reset list width<small>{rail.w}px now</small></button>
                <button onClick={() => setCards((c) => c.map((x) => ({ ...x, min: true })))}>Collapse all cards</button>
                <button onClick={() => { setCards([]); setPanelsOpen(false); }}>Close all cards</button>
              </div>
            </div>
          ) : null}
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
        </div>
      </header>
      <main className="stage" style={{ gridTemplateColumns: stageCols }}>
        <div className="map-wrap">
          <div className="map-bar toggle">
            {calendarTab ? (
              <span className="bar-note">Calendar · Earnings, macro, lobbying, and PAC events · rows open in the dossier · <kbd>esc</kbd> closes</span>
            ) : null}
            {barFor === "congress" ? (
              <>
                <span className="seg">
                  <button aria-pressed={chamber === "house"} onClick={() => { setChamber("house"); setSelectedId(null); setDossier(null); }}>House</button>
                  <button aria-pressed={chamber === "senate"} onClick={() => { setChamber("senate"); setSelectedId(null); setDossier(null); }}>Senate</button>
                </span>
                <span className="seg">
                  {(["votes", "bills", "members", "committees"] as CongressMode[]).map((m) => (
                    <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setSelectedId(null); setDossier(null); }}>
                      {m[0].toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </span>
                <span className="seg">
                  <button aria-pressed={voteView === "floor"} onClick={() => setVoteView("floor")}>Floor</button>
                  <button aria-pressed={voteView === "map"} onClick={() => setVoteView("map")}>Map</button>
                </span>
                {partyButtons}
                {voteView === "map" ? <span className="bar-note" title={congress.voteCaption}>{congress.voteCaption}</span> : null}
              </>
            ) : null}
            {barFor === "markets" ? (
              <>
                <span className="seg">
                  <button aria-pressed={marketView === "board"} onClick={() => setMarketView("board")}>Equities</button>
                  <button aria-pressed={marketView === "globals"} onClick={() => setMarketView("globals")}>Global</button>
                  <button aria-pressed={marketView === "fx"} onClick={() => setMarketView("fx")}>FX</button>
                  <button aria-pressed={marketView === "crypto"} onClick={() => setMarketView("crypto")}>Crypto</button>
                  <button aria-pressed={marketView === "positions"} onClick={() => setMarketView("positions")}>Positions</button>
                  <button aria-pressed={marketView === "supply"} onClick={() => { setSupplySymbol(chartSymbol); setMarketView("supply"); }}>Supply</button>
                  <button aria-pressed={marketView === "chart"} onClick={() => setMarketView("chart")}>Chart</button>
                </span>
                <span className="seg" title="Trade list in the right panel">
                  {(["politicians", "insiders", "whales", "shorts"] as MarketLayer[]).map((item) => (
                    <button key={item} aria-pressed={layer === item} onClick={() => { setLayer(item); setSelectedId(null); setDossier(null); }}>
                      {item === "politicians" ? "Congress" : item[0].toUpperCase() + item.slice(1)}
                    </button>
                  ))}
                </span>
                {layer === "politicians" ? partyButtons : null}
              </>
            ) : null}
            {barFor === "news" ? (
              <>
                <span className="seg">
                  <button aria-pressed={newsView === "board"} onClick={() => setNewsView("board")}>Board</button>
                  <button aria-pressed={newsView === "globe"} onClick={() => { setNewsView("globe"); setMapTime(null); }}>Globe</button>
                </span>
                <span className="seg">
                  {(["all", "world", "markets", "x"] as NewsDesk[]).map((desk) => (
                    <button key={desk} aria-pressed={newsDesk === desk} onClick={() => { setNewsDesk(desk); setSelectedId(null); }}>
                      {desk === "x" ? "X" : desk[0].toUpperCase() + desk.slice(1)}
                    </button>
                  ))}
                </span>
                <label className="theater">
                  <select value={newsRegion} onChange={(e) => { setNewsRegion(e.target.value); setSelectedId(null); setDossier(null); }} aria-label="Region">
                    {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </label>
              </>
            ) : null}
            {barFor === "strait" ? (
              <>
                <span className="seg">
                  <button aria-pressed={straitFeed === "ships"} onClick={() => { setStraitFeed("ships"); setSelectedId(null); }}>Ships</button>
                  <button aria-pressed={straitFeed === "news"} onClick={() => { setStraitFeed("news"); setSelectedId(null); }}>News</button>
                  <button aria-pressed={straitFeed === "air"} onClick={() => { setStraitFeed("air"); setSelectedId(null); }}>Air</button>
                </span>
                {straitFeed === "air" ? (
                  <span className="seg" title="Aircraft filter">
                    <button aria-pressed={!airMil} onClick={() => setAirMil(false)}>All traffic</button>
                    <button aria-pressed={airMil} onClick={() => setAirMil(true)}>Military</button>
                  </span>
                ) : null}
              </>
            ) : null}
            {showMap && !calendarTab ? earthButtons : null}
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
              marketView === "chart" ? (
                <CandleChart
                  symbol={chartSymbol}
                  span={chartSpan}
                  onSpan={setChartSpan}
                  onBack={() => setMarketView(chartFrom)}
                  marks={chartMarks}
                />
              ) : marketView === "positions" ? (
                <PositionsBoard onOpen={(symbol) => void openPositions(symbol)} onMember={(id) => openMember(id)} />
              ) : marketView === "globals" ? (
                <GlobalBoard onOpen={(symbol) => showChart(symbol, "6mo", [])} />
              ) : marketView === "supply" ? (
                <SupplyBoard symbol={supplySymbol} onSymbol={setSupplySymbol} onOpen={follow} />
              ) : marketView === "fx" ? (
                <FxBoard onOpen={(symbol) => showChart(symbol, "5m", [])} onEvent={(e) => setDossier(econModel(e))} />
              ) : marketView === "crypto" ? (
                <CryptoBoard onOpen={(symbol) => showChart(symbol, "5m", [])} />
              ) : (
                <QuoteBoard onOpen={(symbol) => {
                  showChart(symbol, "5m", []);
                  void pinSymbol(symbol);
                }} />
              )
            ) : section === "news" && !newsGlobe ? (
              <NewsBoard
                wire={news.wire}
                x={news.x}
                items={news.all}
                selectedId={selectedId}
                onSelect={(id) => { setDossier(null); setSelectedId(id); }}
                onTicker={(symbol) => void openPositions(symbol)}
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
                  live={liveLayers}
                  dailyTiles={dailyLayer?.tiles}
                  flash={newsGlobe ? globe.flash : null}
                  onSelect={(id) => {
                    if (section === "congress") {
                      openSeat(id);
                      return;
                    }
                    if (id.startsWith("place:")) {
                      setDossier(globe.placeModel(id));
                      return;
                    }
                    setSelectedId(id);
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
                {timeDomain ? <TimeBar domain={timeDomain} value={mapTime} onChange={setMapTime} notes={timeNotes} title={timeTitle} /> : null}
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
          className={rail.open ? "splitter" : "splitter closed"}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize list panel"
          title="Drag to resize · double-click to hide or show · \ key toggles"
          onPointerDown={dragRail}
          onDoubleClick={() => setRail((r) => ({ ...r, open: !r.open }))}
        >
          <button className="splitter-tab" aria-label={rail.open ? "Hide list panel" : "Show list panel"} onClick={() => setRail((r) => ({ ...r, open: !r.open }))}>{rail.open ? "▸" : "◂"}</button>
        </div>
        <section className={rail.open ? "rail" : "rail hidden"} aria-label="Records" aria-hidden={!rail.open}>
          <header className="rail-head">
            <div>
              <h1>{active.label}{section === "congress" ? ` · ${mode}` : ""}</h1>
              <p>{blurb}</p>
            </div>
            <span className="count">{String(items.length).padStart(2, "0")}</span>
          </header>
          <div className="rail-body">
            {drawer ? (
              <Drawer
                model={drawer}
                onFollow={follow}
                onPin={() => openCard({ title: drawer.title, model: { ...drawer, source: drawer.source || view.status.source } })}
                onClose={closeDossier}
                source={view.status.source}
              />
            ) : null}
            <RecordList
              items={items}
              selectedId={selectedId}
              onSelect={selectRow}
              empty={view.empty || "Nothing in this list."}
            />
          </div>
        </section>
      </main>
      <footer className="status">
        <span><em>SOURCE</em><strong>{view.status.source}</strong></span>
        <span><em>AS OF</em>{view.status.asOf || "—"}</span>
        <span title={view.status.latency}><em>NOTE</em>{view.status.latency || "—"}</span>
        <span className="keys"><kbd>1</kbd>–<kbd>5</kbd> sections · <kbd>/</kbd> search · <kbd>esc</kbd> close</span>
      </footer>
      <WidgetLayer
        cards={cards}
        onFollow={follow}
        onClose={(id) => setCards((current) => current.filter((card) => card.id !== id))}
        onChange={(id, next) => setCards((current) => current.map((card) => card.id === id ? { ...card, ...next } : card))}
      />
      <div className="scan" aria-hidden="true" />
    </div>
  );

  function mapProps() {
    if (section === "strait" && strait.theater) {
      return {
        geojson: undefined,
        colorProp: undefined,
        markers: straitFeed === "air" ? strait.airMarkers : strait.markers,
        center: [strait.theater.lon, strait.theater.lat] as [number, number],
        zoom: strait.theater.zoom
      };
    }
    if (newsGlobe) {
      const region = REGIONS.find((r) => r.id === newsRegion) || REGIONS[0];
      return { geojson: undefined, colorProp: undefined, markers: globe.markers, center: region.center, zoom: region.zoom };
    }
    if (section === "districts") {
      const site = districts.selected;
      return {
        geojson: districts.geojson,
        colorProp: "vote",
        markers: districts.markers,
        center: (site ? [site.lon, site.lat] : [-96, 38]) as [number, number],
        zoom: site ? 5 : 3.2
      };
    }
    return {
      geojson: congress.geojson,
      colorProp: congress.positions.length ? "vote" : undefined,
      markers: [],
      center: [-96, 38] as [number, number],
      zoom: chamber === "house" ? 3.3 : 3.1
    };
  }
}

function committeeIdFor(system: string) {
  const code = system.toUpperCase();
  return code.endsWith("00") ? code.slice(0, -2) : code;
}

function meetingModel(item: Meeting): DrawerModel {
  return {
    title: item.title,
    meta: [item.status, item.type].filter(Boolean).join(" · ") || "Committee meeting",
    rows: [
      { label: "When", value: `${when(item.date)} UTC` },
      { label: "Chamber", value: item.chamber || "—" },
      { label: "Room", value: item.location || "—" },
      { label: "Nominations", value: item.nominations ? String(item.nominations) : "—" }
    ],
    links: [
      ...(item.committees || []).map((c) => ({ label: "Committee", value: c.name, action: `committee:${committeeIdFor(c.system)}` })),
      ...(item.bills || []).map((b) => ({ label: "Bill", value: b.label, action: `bill:${b.id}` })),
      ...(item.documents || []).map((d) => ({ label: "Document", value: d.name, href: d.url })),
      ...(item.videos || []).map((v) => ({ label: "Video", value: v.name, href: v.url })),
      ...(item.link ? [{ label: "Congress.gov", value: `Event ${item.id}`, href: item.link }] : [])
    ]
  };
}

function utcNow() {
  return new Date().toISOString();
}
