import { useEffect, useState } from "react";
import { api, recent, when } from "../lib/api";
import type { DrawerModel, ListItem, Marker, StatusLine } from "../types";

export type Theater = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  zoom: number;
  live: boolean;
};

type Ship = { id: string; name: string; mmsi: string; lat: number; lon: number; seen: string };
type Article = { id: string; title: string; source: string; seen: string; url: string };
export type Aircraft = { id: string; hex: string; callsign: string; reg: string; type: string; desc: string; owner: string; lat: number; lon: number; alt: number; ground: boolean; gs: number | null; track: number | null; squawk: string; emergency: string; mil: boolean; seen: string };
type AirFeed = { ok: boolean; source: string; asOf: string; latency: string; milWorld: number; items: Aircraft[] };
type Route = { ok: boolean; source: string; airline?: string; flight?: string; origin?: { iata: string; name: string; city: string; country: string }; destination?: { iata: string; name: string; city: string; country: string }; note?: string; error?: string };

export function useStrait(theaterId: string, selectedId: string | null, feed: "ships" | "news" | "air" = "ships", milOnly = false) {
  const [air, setAir] = useState<AirFeed | null>(null);
  const [airError, setAirError] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [news, setNews] = useState<Article[]>([]);
  const [empty, setEmpty] = useState("Loading theater…");
  const [aisNote, setAisNote] = useState("");

  const theater = theaters.find((t) => t.id === theaterId) || theaters[0];

  useEffect(() => {
    api<{ items: Theater[] }>("/api/strait/theaters").then((res) => setTheaters(res.items)).catch(() => null);
  }, []);

  useEffect(() => {
    if (!theater?.live) {
      setShips([]);
      setNews([]);
      setEmpty(`${theater?.name || "This theater"} is listed and not populated in this slice.`);
      return;
    }
    api<{ items: Article[]; source: string }>("/api/strait/news")
      .then((res) => setNews(res.items || []))
      .catch(() => setNews([]));
    const pull = () => {
      api<{ ok: boolean; missing?: string; items: Ship[] }>("/api/strait/ais")
        .then((res) => {
          if (res.missing) {
            setAisNote(`Set ${res.missing} for live ship positions.`);
            setShips([]);
            setEmpty(`Set ${res.missing} for live ship positions. News is on the status line.`);
          } else {
            setShips(res.items || []);
            setEmpty(res.items?.length ? "" : "No AIS positions in the strait yet.");
            setAisNote("");
          }
        })
        .catch((err: Error) => setEmpty(err.message));
    };
    pull();
    const timer = window.setInterval(pull, 15000);
    return () => window.clearInterval(timer);
  }, [theater?.id, theater?.live, theater?.name]);

  useEffect(() => {
    if (feed !== "air" || !theater) return;
    let cancel = false;
    const pull = () => api<AirFeed>(`/api/air?theater=${theater.id}`)
      .then((res) => { if (!cancel) { setAir(res); setAirError(""); } })
      .catch((err: Error) => { if (!cancel) setAirError(err.message); });
    void pull();
    const timer = window.setInterval(pull, 30000);
    return () => { cancel = true; window.clearInterval(timer); };
  }, [feed, theater?.id]);

  const planes = (air?.items || []).filter((a) => !milOnly || a.mil);
  const plane = planes.find((a) => a.id === selectedId);
  const planeCall = plane?.callsign || "";
  useEffect(() => {
    setRoute(null);
    if (!planeCall) return;
    let cancel = false;
    api<Route>(`/api/air/route/${encodeURIComponent(planeCall)}`)
      .then((r) => { if (!cancel) setRoute(r); })
      .catch(() => null);
    return () => { cancel = true; };
  }, [planeCall]);

  const airItems: ListItem[] = planes.map((a) => ({
    id: a.id,
    title: `${a.mil ? "MIL · " : ""}${a.callsign || a.reg || a.hex}${a.type ? ` · ${a.type}` : ""}${a.emergency ? ` · ${a.emergency.toUpperCase()}` : ""}`,
    meta: `${a.ground ? "on ground" : `${Math.round(a.alt).toLocaleString("en-US")} ft`}${a.gs != null ? ` · ${Math.round(a.gs)} kt` : ""}${a.owner ? ` · ${a.owner}` : ""} · ${when(a.seen).slice(11)} UTC`
  }));
  const airMarkers: Marker[] = planes.map((a) => ({
    id: a.id,
    lon: a.lon,
    lat: a.lat,
    label: a.callsign || a.reg || a.hex,
    color: a.emergency ? "#e8a33d" : a.mil ? "#e0574f" : "#6fb6c8",
    size: a.mil || a.emergency ? 5 : 3,
    hot: Boolean(a.emergency) || (a.mil && planes.length < 400)
  }));

  const orderedShips = [...ships].sort((a, b) => recent(b.seen) - recent(a.seen));
  const orderedNews = [...news].sort((a, b) => recent(b.seen) - recent(a.seen));
  const items: ListItem[] = orderedShips.map((s) => ({
    id: s.id,
    title: s.name || s.mmsi,
    meta: `${s.lat.toFixed(2)}, ${s.lon.toFixed(2)} · ${when(s.seen)}`
  }));
  const newsItems: ListItem[] = orderedNews.map((article) => ({
    id: article.id,
    title: article.title,
    meta: `${article.source} · ${when(article.seen)}`
  }));

  const markers: Marker[] = orderedShips.map((s) => ({ id: s.id, lon: s.lon, lat: s.lat, label: s.name }));
  const selected = ships.find((s) => s.id === selectedId);
  const article = news.find((n) => n.id === selectedId);
  const planeDrawer: DrawerModel | null = plane ? {
    title: `${plane.mil ? "Military · " : ""}${plane.callsign || plane.reg || plane.hex}`,
    meta: [plane.desc || plane.type, plane.owner].filter(Boolean).join(" · ") || "Aircraft",
    rows: [
      { label: "Callsign", value: plane.callsign || "—" },
      { label: "Registration", value: plane.reg || "—" },
      { label: "Type", value: plane.type || "—" },
      { label: "ICAO hex", value: plane.hex },
      { label: "Altitude", value: plane.ground ? "On ground" : `${Math.round(plane.alt).toLocaleString("en-US")} ft` },
      { label: "Speed", value: plane.gs == null ? "—" : `${Math.round(plane.gs)} kt` },
      { label: "Heading", value: plane.track == null ? "—" : `${Math.round(plane.track)}°` },
      { label: "Squawk", value: `${plane.squawk || "—"}${plane.emergency ? ` · ${plane.emergency}` : ""}` },
      { label: "Position", value: `${plane.lat.toFixed(3)}, ${plane.lon.toFixed(3)}` },
      { label: "Seen", value: `${when(plane.seen)} UTC` },
      { label: "Route", value: route ? (route.ok ? `${route.origin?.iata} ${route.origin?.city} → ${route.destination?.iata} ${route.destination?.city}` : route.error || "—") : planeCall ? "Looking up…" : "No callsign" },
      ...(route?.ok ? [{ label: "Airline", value: `${route.airline || "—"}${route.flight ? ` · ${route.flight}` : ""}` }] : [])
    ],
    blocks: route?.ok && route.note ? [{ title: "Route note", lines: [route.note] }] : undefined,
    links: [
      { label: "Track", value: "adsb.lol globe", href: `https://adsb.lol/?icao=${plane.hex}` },
      ...(plane.callsign ? [{ label: "Flight", value: "FlightAware", href: `https://www.flightaware.com/live/flight/${plane.callsign}` }] : [])
    ],
    source: `${air?.source || "adsb.lol"}${route ? ` · ${route.source}` : ""}`
  } : null;

  const drawer: DrawerModel | null = feed === "air" ? planeDrawer : selected
    ? {
        title: selected.name || "Vessel",
        rows: [
          { label: "MMSI", value: selected.mmsi || "—" },
          { label: "Seen", value: when(selected.seen) },
          { label: "Position", value: `${selected.lat.toFixed(3)}, ${selected.lon.toFixed(3)}` }
        ]
      }
    : article
      ? {
          title: article.title,
          meta: article.source,
          rows: [{ label: "Seen", value: when(article.seen) }],
          links: article.url ? [{ label: "Source", value: article.source, href: article.url }] : undefined
        }
      : null;

  const milCount = planes.filter((a) => a.mil).length;
  const status: StatusLine = feed === "air"
    ? {
        source: air?.source || "adsb.lol",
        asOf: air ? `${when(air.asOf)} UTC` : "",
        latency: airError || (air ? `${planes.length} aircraft${milOnly ? " (military filter)" : ""} · ${milCount} military here · ${air.milWorld} military worldwide · ${air.latency}` : "Loading aircraft…")
      }
    : theater?.live
    ? {
        source: news.length ? "GDELT" : "Taiwan Strait",
        asOf: orderedNews[0] ? when(orderedNews[0].seen) : "",
        latency: [aisNote, ...orderedNews.slice(0, 3).map((n) => n.title)].filter(Boolean).join("  ·  ")
      }
    : {
        source: theater?.name || "Theater",
        asOf: "",
        latency: "Not populated in this slice."
      };

  return {
    theaters,
    items,
    newsItems,
    airItems,
    airMarkers,
    airEmpty: airError || (air ? (planes.length ? "" : milOnly ? "No military transponders visible in this box right now." : "No aircraft in range.") : "Loading aircraft…"),
    empty,
    drawer,
    status,
    markers,
    theater
  };
}
