import type { NavRegion } from "../../shared/navRegions.mjs";
export const HAZARDS = {
  earthquake: "Earthquakes",
  cyclone: "Cyclones",
  flood: "Floods",
  drought: "Droughts",
  wildfire: "Wildfires",
  volcano: "Volcanoes",
} as const;
export type Kind = keyof typeof HAZARDS;
export type Hazard = {
  id: string;
  kind: Kind;
  title: string;
  lat: number;
  lon: number;
  occurred: string | null;
  updated: string | null;
  ends?: string | null;
  level: string;
  detail: string;
  country?: string;
  url: string;
  source: string;
  magnitude?: number;
};
export type Feed = {
  id: string;
  name: string;
  coverage: string;
  state: "ok" | "stale" | "unavailable";
  error?: string;
  items: Hazard[];
  fetchedAt?: string;
  generatedAt?: string;
};
export type Forecast = {
  lat: number;
  lon: number;
  updatedAt: string;
  fetchedAt: string;
  current: {
    time: string;
    temperature: number;
    wind: number | null;
    humidity: number | null;
    rain: number | null;
    periodHours: number;
    condition: string;
  };
  change24h: number | null;
  days: { date: string; low: number; high: number; wind: number | null; rain: number; rainHours: number }[];
};
export type Point = { lat: number; lon: number; label: string; context?: string };
export const LEVEL_COLOR: Record<string, string> = {
  red: "#ef8076",
  orange: "#f1b35d",
  yellow: "#e5d270",
  green: "#70b998",
  unrated: "#96abc1",
};
export const CONTEXT: Record<Kind, string> = {
  earthquake:
    "Check verified damage to ports, mines, pipelines and transport links. Magnitude alone does not establish disruption or a commodity-price effect.",
  cyclone:
    "Check the storm track against offshore production, terminals and shipping routes. A storm report alone does not confirm shutdowns.",
  flood:
    "Flooding can interrupt crop harvests, mines and transport. Check the affected footprint and local operating reports before inferring supply losses.",
  drought:
    "Persistent dryness can affect yields, irrigation, hydropower and river freight. Check crop season, soil moisture, water reserves and local reports; a dry forecast alone is not a drought diagnosis.",
  wildfire:
    "Check proximity to farms, forests, power and transport infrastructure. The reported event center is not a burn perimeter.",
  volcano:
    "Ash and local disruption may affect aviation, roads and nearby operations. Confirm plume forecasts and operating notices.",
};
export const PLACES: Point[] = [
  {
    label: "Houston · energy & ports",
    lat: 29.76,
    lon: -95.37,
    context:
      "Watch Gulf Coast refinery, terminal and port operating notices alongside storms. This point forecast does not represent offshore conditions.",
  },
  {
    label: "Rotterdam · energy & freight",
    lat: 51.95,
    lon: 4.14,
    context:
      "Compare wind and rain with port and terminal notices. Weather at one point does not establish a shipping delay.",
  },
  {
    label: "Mato Grosso · grains",
    lat: -12.54,
    lon: -55.72,
    context:
      "Compare rain and heat with planting dates, soil moisture and crop reports. A single location is not representative of the entire producing region.",
  },
  {
    label: "Rosario · grain exports",
    lat: -32.95,
    lon: -60.65,
    context:
      "Check Paraná river levels, harvest conditions and port reports. Local precipitation alone cannot estimate basin water levels.",
  },
  {
    label: "Odesa · grain exports",
    lat: 46.48,
    lon: 30.73,
    context:
      "Weather is one input to port exposure; access restrictions, security and operating notices require separate verification.",
  },
  {
    label: "Pilbara · iron ore",
    lat: -20.31,
    lon: 118.58,
    context:
      "Check cyclone forecasts against mine, rail and port operating notices before inferring an export interruption.",
  },
  {
    label: "Abidjan · cocoa exports",
    lat: 5.35,
    lon: -4.03,
    context:
      "Pair regional crop and rainfall reports with port operations. Coastal weather is not a measure of conditions across cocoa-growing areas.",
  },
  {
    label: "Singapore · shipping",
    lat: 1.29,
    lon: 103.85,
    context:
      "Check port advisories and route conditions; this land-point forecast does not provide marine wave heights.",
  },
];
export function inRegion(p: { lon: number; lat: number }, r: NavRegion) {
  if (r.id === "world") return true;
  const half = Math.min(180, (180 / 2 ** r.zoom) * 1.6);
  const [w, s, e, n] = r.bounds || [r.lon - half, r.lat - half * 0.62, r.lon + half, r.lat + half * 0.62];
  return p.lat >= s && p.lat <= n && (w > e ? p.lon >= w || p.lon <= e : p.lon >= w && p.lon <= e);
}
export function sortHazards(a: Hazard, b: Hazard) {
  const rank: Record<string, number> = { red: 4, orange: 3, yellow: 2, green: 1, unrated: 0 };
  return (rank[b.level] ?? 0) - (rank[a.level] ?? 0) || String(b.updated).localeCompare(String(a.updated));
}
export const stamp = (s?: string | null) => (s ? `${s.slice(0, 16).replace("T", " ")} UTC` : "Not provided");
export const value = (n: number | null | undefined, unit: string) =>
  n == null ? "Unavailable" : `${Math.round(n * 10) / 10}${unit}`;

/** Overlapping providers can return the same event; retain its newest report and provenance. */
export function latestHazards(feeds: Feed[]) {
  const latest = new Map<string, { hazard: Hazard; feed: Feed }>();
  for (const feed of feeds)
    for (const hazard of feed.items) {
      const old = latest.get(hazard.id);
      const time = Date.parse(hazard.updated || hazard.occurred || "") || 0;
      const oldTime = old ? Date.parse(old.hazard.updated || old.hazard.occurred || "") || 0 : -1;
      if (!old || time > oldTime || (time === oldTime && feed.state === "ok" && old.feed.state !== "ok"))
        latest.set(hazard.id, { hazard, feed });
    }
  return [...latest.values()];
}
