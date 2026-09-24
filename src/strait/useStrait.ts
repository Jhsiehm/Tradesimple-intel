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

export function useStrait(theaterId: string, selectedId: string | null) {
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [news, setNews] = useState<Article[]>([]);
  const [tiles, setTiles] = useState<string[]>([]);
  const [mapTiles, setMapTiles] = useState<string[]>([]);
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
      setTiles([]);
      setMapTiles([]);
      setEmpty(`${theater?.name || "This theater"} is listed and not populated in this slice.`);
      return;
    }
    api<{ items: Article[]; source: string }>("/api/strait/news")
      .then((res) => setNews(res.items || []))
      .catch(() => setNews([]));
    api<{ tiles: string[]; map?: string[] }>("/api/strait/satellite")
      .then((res) => {
        setTiles(res.tiles || []);
        setMapTiles(res.map || []);
      })
      .catch(() => {
        setTiles([]);
        setMapTiles([]);
      });
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
  const drawer: DrawerModel | null = selected
    ? {
        title: selected.name || "Vessel",
        rows: [
          { label: "MMSI", value: selected.mmsi || "—" },
          { label: "Seen", value: when(selected.seen) },
          { label: "Position", value: `${selected.lat.toFixed(3)}, ${selected.lon.toFixed(3)}` }
        ]
      }
    : null;

  const status: StatusLine = theater?.live
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
    empty,
    drawer,
    status,
    markers,
    tiles: theater?.live ? tiles : [],
    mapTiles: theater?.live ? mapTiles : [],
    theater
  };
}
