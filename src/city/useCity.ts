import { useEffect, useMemo, useState } from "react";
import { api, when } from "../lib/api";
import type { DrawerModel, ListItem, Marker, StatusLine } from "../types";

export type CityPick = { id: string; label: string; lon: number; lat: number; zoom: number };

/** Camera bookmarks. Geography only, not a feed. */
export const CITIES: CityPick[] = [
  { id: "washington", label: "Washington", lon: -77.032, lat: 38.904, zoom: 13.5 },
  { id: "new-york", label: "New York", lon: -73.985, lat: 40.748, zoom: 13.3 },
  { id: "chicago", label: "Chicago", lon: -87.629, lat: 41.878, zoom: 13.3 },
  { id: "los-angeles", label: "Los Angeles", lon: -118.244, lat: 34.052, zoom: 13.2 },
  { id: "houston", label: "Houston", lon: -95.37, lat: 29.76, zoom: 13.2 },
  { id: "san-francisco", label: "San Francisco", lon: -122.419, lat: 37.775, zoom: 13.4 }
];

const NEAR = 28_000;
const DRIFT_S = 45;

type Site = { id: string; name: string; symbol: string; kind: string; district: string; state: string; lat: number; lon: number; note: string };
type Aircraft = {
  id: string; hex: string; callsign: string; reg: string; type: string; desc: string; owner: string;
  lat: number; lon: number; alt: number; ground: boolean; gs: number | null; track: number | null;
  squawk: string; emergency: string; mil: boolean; seen: string;
};
type AirFeed = { ok: boolean; error?: string; source: string; asOf: string; latency: string; nm?: number; items: Aircraft[] };
type Route = { ok: boolean; source: string; airline?: string; flight?: string; origin?: { iata: string; city: string }; destination?: { iata: string; city: string }; note?: string; error?: string };

function meters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/** Move a fix along its reported track and ground speed. This is the last broadcast vector, not a new path. */
function drift(lat: number, lon: number, track: number | null, gs: number | null, seconds: number) {
  if (track == null || gs == null || gs <= 0 || seconds <= 0) return { lat, lon };
  const nm = gs * (Math.min(DRIFT_S, seconds) / 3600);
  const rad = (track * Math.PI) / 180;
  const dLat = (nm * Math.cos(rad)) / 60;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLon = cos > 0.01 ? (nm * Math.sin(rad)) / (60 * cos) : 0;
  return { lat: lat + dLat, lon: lon + dLon };
}

const IDLE: { items: ListItem[]; empty: string; drawer: DrawerModel | null; status: StatusLine; markers: Marker[]; focus: { lon: number; lat: number; zoom: number } | null } = {
  items: [],
  empty: "Open 3D, then a city. Aircraft over that downtown list here.",
  drawer: null,
  status: {
    source: "Map",
    asOf: "",
    latency: "2D, globe, and 3D are the views. A city under 3D locks the block skyline and polls live aircraft."
  },
  markers: [],
  focus: null
};

/**
 * Block skyline for one downtown, plus aircraft from adsb.lol.
 * `live` is true only while that city is the active 3D view, so the poll stays off on other tabs.
 * `nowIso` is the terminal clock; positions advance along the last heading between fixes.
 */
export function useCity(cityId: string | null, selectedId: string | null, live: boolean, nowIso: string, pitched = false) {
  const [sites, setSites] = useState<Site[]>([]);
  const [air, setAir] = useState<AirFeed | null>(null);
  const [airError, setAirError] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const city = CITIES.find((item) => item.id === cityId) || null;

  useEffect(() => {
    if (!live) return;
    let cancel = false;
    api<{ items: Site[] }>("/api/sites")
      .then((res) => { if (!cancel) setSites(res.items || []); })
      .catch(() => null);
    return () => { cancel = true; };
  }, [live]);

  useEffect(() => {
    if (!live || !city) return;
    let cancel = false;
    const pull = () => api<AirFeed>(`/api/air/near?lat=${city.lat}&lon=${city.lon}`)
      .then((res) => {
        if (cancel) return;
        setAir(res);
        setAirError(res.ok ? "" : res.error || res.latency || "Aircraft feed failed");
      })
      .catch((err: Error) => { if (!cancel) setAirError(err.message); });
    void pull();
    const timer = window.setInterval(pull, 12_000);
    return () => { cancel = true; window.clearInterval(timer); };
  }, [live, city]);

  const now = Date.parse(nowIso);
  const planes = useMemo(() => {
    if (!live || !city) return [];
    return (air?.ok ? air.items : [])
      .map((plane) => {
        const age = Number.isFinite(now) ? Math.max(0, (now - Date.parse(plane.seen)) / 1000) : 0;
        const pos = plane.ground ? { lat: plane.lat, lon: plane.lon } : drift(plane.lat, plane.lon, plane.track, plane.gs, age);
        return { ...plane, ...pos, km: meters(city.lat, city.lon, pos.lat, pos.lon) / 1000 };
      })
      .sort((a, b) => Number(a.ground) - Number(b.ground) || a.km - b.km)
      .slice(0, 80);
  }, [live, city, air, now]);

  const plane = planes.find((item) => item.id === selectedId) || null;
  const planeCall = plane?.callsign || "";
  useEffect(() => {
    setRoute(null);
    if (!planeCall) return;
    let cancel = false;
    api<Route>(`/api/air/route/${encodeURIComponent(planeCall)}`)
      .then((res) => { if (!cancel) setRoute(res); })
      .catch(() => null);
    return () => { cancel = true; };
  }, [planeCall]);

  return useMemo(() => {
    if (!live || !city) {
      return {
        ...IDLE,
        empty: pitched ? "Pick a city. Aircraft over that downtown list here." : IDLE.empty
      };
    }
    const picked = sites.find((site) => site.id === selectedId) || null;
    const near = sites
      .map((site) => ({ site, d: meters(city.lat, city.lon, site.lat, site.lon) }))
      .filter((row) => row.d <= NEAR);

    const items: ListItem[] = planes.map((a) => ({
      id: a.id,
      title: `${a.mil ? "MIL · " : ""}${a.callsign || a.reg || a.hex}${a.type ? ` · ${a.type}` : ""}`,
      meta: `${a.ground ? "on ground" : `${Math.round(a.alt).toLocaleString("en-US")} ft`}${a.gs != null ? ` · ${Math.round(a.gs)} kt` : ""}${a.track != null ? ` · ${Math.round(a.track)}°` : ""} · ${a.km.toFixed(1)} km`
    }));

    const markers: Marker[] = [
      ...near.map(({ site }) => ({
        id: site.id,
        lon: site.lon,
        lat: site.lat,
        label: site.symbol || site.name,
        size: 4,
        color: "#e2b657",
        hot: site.id === selectedId
      })),
      ...planes.map((a) => ({
        id: a.id,
        lon: a.lon,
        lat: a.lat,
        label: a.callsign || a.reg || a.hex,
        color: a.emergency ? "#ffc14a" : a.mil ? "#ff4d6a" : "#3df0ff",
        bearing: a.track ?? undefined,
        hot: a.id === selectedId
      }))
    ];

    const siteDrawer: DrawerModel | null = picked
      ? {
          title: picked.name,
          meta: [picked.symbol, picked.kind, picked.district].filter(Boolean).join(" · "),
          rows: [
            { label: "Kind", value: picked.kind || "—" },
            { label: "District", value: picked.district || "—" },
            { label: "State", value: picked.state || "—" },
            { label: "Note", value: picked.note || "—" }
          ],
          links: picked.symbol ? [{ label: "Chart", value: picked.symbol, action: `chart:${picked.symbol}` }] : [],
          source: "Curated site registry · the blocks around it are OpenStreetMap"
        }
      : null;

    const planeDrawer: DrawerModel | null = plane
      ? {
          title: `${plane.mil ? "Military · " : ""}${plane.callsign || plane.reg || plane.hex}`,
          meta: [plane.desc || plane.type, plane.owner].filter(Boolean).join(" · ") || "Aircraft",
          rows: [
            { label: "Callsign", value: plane.callsign || "—" },
            { label: "Registration", value: plane.reg || "—" },
            { label: "Type", value: plane.type || "—" },
            { label: "Altitude", value: plane.ground ? "On ground" : `${Math.round(plane.alt).toLocaleString("en-US")} ft` },
            { label: "Speed", value: plane.gs == null ? "—" : `${Math.round(plane.gs)} kt` },
            { label: "Heading", value: plane.track == null ? "—" : `${Math.round(plane.track)}°` },
            { label: "Seen", value: `${when(plane.seen)} UTC` },
            { label: "Route", value: route ? (route.ok ? `${route.origin?.iata || "—"} ${route.origin?.city || ""} → ${route.destination?.iata || "—"} ${route.destination?.city || ""}`.trim() : route.error || "—") : planeCall ? "Looking up…" : "No callsign" }
          ],
          blocks: route?.ok && route.note ? [{ title: "Route note", lines: [route.note] }] : undefined,
          links: [
            { label: "Track", value: "adsb.lol", href: `https://adsb.lol/?icao=${plane.hex}` },
            ...(plane.callsign ? [{ label: "Flight", value: "FlightAware", href: `https://www.flightaware.com/live/flight/${plane.callsign}` }] : [])
          ],
          source: `${air?.source || "adsb.lol"}${route ? ` · ${route.source}` : ""}`
        }
      : null;

    const status: StatusLine = {
      source: `${air?.source || "adsb.lol"} · OpenFreeMap buildings`,
      asOf: air?.asOf ? `${when(air.asOf)} UTC` : "",
      latency: airError || air?.latency || "Loading aircraft…"
    };

    return {
      items,
      empty: airError || (air ? (planes.length ? "" : "No aircraft broadcasting within 25 nm right now.") : "Loading aircraft…"),
      drawer: planeDrawer || siteDrawer,
      status,
      markers,
      focus: picked ? { lon: picked.lon, lat: picked.lat, zoom: 15.6 } : { lon: city.lon, lat: city.lat, zoom: city.zoom }
    };
  }, [live, city, pitched, sites, planes, selectedId, plane, route, planeCall, air, airError]);
}
