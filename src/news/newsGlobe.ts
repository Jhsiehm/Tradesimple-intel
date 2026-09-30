import { useMemo } from "react";
import { age, type FeedHealth, type Headline } from "./useNews";
import type { DrawerModel, MapFlash, Marker } from "../types";

export const REGIONS: { id: string; label: string; center: [number, number]; zoom: number }[] = [
  { id: "all", label: "All regions", center: [20, 22], zoom: 1.3 },
  { id: "americas", label: "Americas", center: [-78, 15], zoom: 1.9 },
  { id: "europe", label: "Europe", center: [8, 50], zoom: 3.2 },
  { id: "easteurope", label: "Eastern Europe", center: [34, 51], zoom: 3.4 },
  { id: "mideast", label: "Middle East", center: [44, 28], zoom: 3.4 },
  { id: "africa", label: "Africa", center: [18, 3], zoom: 2.4 },
  { id: "southasia", label: "South Asia", center: [76, 23], zoom: 3.4 },
  { id: "eastasia", label: "East Asia", center: [122, 33], zoom: 3 },
  { id: "seasia", label: "Southeast Asia", center: [110, 8], zoom: 3.3 },
  { id: "oceania", label: "Oceania", center: [150, -28], zoom: 3 }
];

export const NEWS_WINDOW = 12 * 60 * 60 * 1000;
const HOT = 60 * 60 * 1000;

export function useNewsGlobe(items: Headline[], cursor: number) {
  const inWindow = useMemo(
    () => items.filter((h) => {
      const t = Date.parse(h.published);
      return h.geo && t <= cursor && t > cursor - NEWS_WINDOW;
    }),
    [items, cursor]
  );

  const places = useMemo(() => {
    const map = new Map<string, Headline[]>();
    for (const h of inWindow) {
      const key = h.geo!.place;
      map.set(key, [...(map.get(key) || []), h]);
    }
    return map;
  }, [inWindow]);

  const markers: Marker[] = useMemo(() => [...places.entries()].map(([place, rows]) => {
    const newest = rows[0];
    const lag = cursor - Date.parse(newest.published);
    return {
      id: `place:${place}`,
      lon: newest.geo!.lon,
      lat: newest.geo!.lat,
      label: lag < HOT ? clip(newest.title, 54) : place,
      size: 4 + Math.min(12, Math.sqrt(rows.length) * 2.4),
      color: lag < HOT ? "#e8955a" : lag < 6 * HOT ? "#e2b657" : "#6f7a68",
      hot: lag < HOT
    };
  }), [places, cursor]);

  const newest = inWindow[0];
  const flash: MapFlash | null = useMemo(() => newest ? {
    id: `place:${newest.geo!.place}`,
    lon: newest.geo!.lon,
    lat: newest.geo!.lat,
    title: newest.title,
    meta: `${newest.source} · ${newest.geo!.place} · ${newest.stamped ? `${newest.stamped.slice(5, 10)} edition` : age(newest.published)}`
  } : null, [newest]);

  const placeModel = (id: string): DrawerModel | null => {
    const name = id.replace(/^place:/, "");
    const rows = places.get(name);
    if (!rows?.length) return null;
    const outlets = [...new Set(rows.map((h) => h.source))];
    return {
      title: name,
      meta: `${rows.length} headline${rows.length === 1 ? "" : "s"} in the 12h window · ${outlets.length} outlet${outlets.length === 1 ? "" : "s"}`,
      rows: [
        { label: "Region", value: REGIONS.find((r) => r.id === rows[0].geo!.region)?.label || rows[0].geo!.region },
        { label: "Newest", value: age(rows[0].published) },
        { label: "Outlets", value: outlets.join(", ") }
      ],
      links: rows.slice(0, 20).map((h) => ({
        label: `${h.source} · ${age(h.published)}`,
        value: h.title,
        action: `news:${h.id}`
      }))
    };
  };

  return { markers, flash, count: inWindow.length, places: places.size, placeModel };
}

export function regionOutlets(feeds: FeedHealth[] | undefined, region: string) {
  return (feeds || []).filter((f) => f.desk === "world" && (region === "all" ? f.region && f.region !== "global" : f.region === region));
}

function clip(text: string, n: number) {
  return text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;
}
