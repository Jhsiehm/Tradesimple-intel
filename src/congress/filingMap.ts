import { useEffect, useState } from "react";
import { api, when } from "../lib/api";
import type { Marker, StatusLine } from "../types";
import { STATE_NAME_TO_POSTAL } from "./states";
import type { FeedRow } from "./TodayBoard";

const BUY = "#3dff9a";
const SELL = "#ff4d6a";
const LATE = "#ffc14a";
const LATE_DAYS = 45;

type FeedRes = {
  ok: boolean;
  source?: string;
  asOf?: string;
  latency?: string;
  latest?: FeedRow[];
};

export function lastName(person: string) {
  const head = person.split(",")[0].trim();
  const parts = head.split(/\s+/);
  return parts[parts.length - 1] || person;
}

function outerRing(geometry: GeoJSON.Geometry | null | undefined): number[][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return (geometry.coordinates[0] || []) as number[][];
  if (geometry.type === "MultiPolygon") {
    let best: number[][] = [];
    for (const poly of geometry.coordinates) {
      const ring = (poly[0] || []) as number[][];
      if (ring.length > best.length) best = ring;
    }
    return best;
  }
  return [];
}

/** Average of the longest outer ring. Enough to drop a dot on a state. */
export function centroid(feature: GeoJSON.Feature): [number, number] | null {
  const ring = outerRing(feature.geometry);
  let lon = 0;
  let lat = 0;
  let n = 0;
  for (const pair of ring) {
    if (pair.length < 2) continue;
    lon += pair[0];
    lat += pair[1];
    n += 1;
  }
  if (!n) return null;
  return [lon / n, lat / n];
}

export type PlacedFilings = {
  geojson: GeoJSON.FeatureCollection;
  markers: Marker[];
  /** Newest filing id in each state that has one. */
  byState: Record<string, string>;
};

/** Flat state polygons, plus one dot per state that filed this week. */
export function placeFilings(states: GeoJSON.FeatureCollection | null, rows: FeedRow[]): PlacedFilings {
  const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  if (!states) return { geojson, markers: [], byState: {} };
  const grouped = new Map<string, FeedRow[]>();
  for (const row of rows) {
    if (!row.state) continue;
    const list = grouped.get(row.state) || [];
    list.push(row);
    grouped.set(row.state, list);
  }
  const markers: Marker[] = [];
  const byState: Record<string, string> = {};
  for (const feature of states.features) {
    const postal = STATE_NAME_TO_POSTAL[String(feature.properties?.name || "")] || "";
    geojson.features.push({ ...feature, properties: { ...feature.properties, id: postal } });
    const group = postal ? grouped.get(postal) : undefined;
    if (!group?.length) continue;
    const point = centroid(feature);
    if (!point) continue;
    const newest = group[0];
    byState[postal] = newest.id;
    const late = group.some((row) => row.lag != null && row.lag > LATE_DAYS);
    const color = late ? LATE : newest.side === "buy" ? BUY : newest.side === "sell" ? SELL : "#e4e7e6";
    markers.push({ id: postal, lon: point[0], lat: point[1], label: postal, size: 5, color });
  }
  return { geojson, markers, byState };
}

/** This week's disclosed trades. Same feed Today uses. */
export function useWeekFilings(on: boolean) {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [status, setStatus] = useState<StatusLine>({ source: "House Clerk · Senate eFD", asOf: "", latency: "" });

  useEffect(() => {
    if (!on) return;
    let cancel = false;
    api<FeedRes>("/api/congress/feed")
      .then((body) => {
        if (cancel) return;
        setRows(body.ok ? body.latest || [] : []);
        setStatus({
          source: body.source || "House Clerk · Senate eFD",
          asOf: body.asOf ? when(body.asOf) : "",
          latency: body.latency || "Filed up to 45 days after the trade."
        });
      })
      .catch(() => { if (!cancel) setRows([]); });
    return () => { cancel = true; };
  }, [on]);

  return { rows, status };
}
