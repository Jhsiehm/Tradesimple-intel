import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { DrawerModel, ListItem, Marker, StatusLine } from "../types";
import type { NavRegion } from "../../shared/navRegions.mjs";
import {
  CONTEXT,
  HAZARDS,
  LEVEL_COLOR,
  inRegion,
  latestHazards,
  sortHazards,
  stamp,
  value,
  type Feed,
  type Forecast,
  type Kind,
  type Point,
} from "./model";

export function useWeather(enabled: boolean, region: NavRegion, selectedId: string | null) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [kinds, setKinds] = useState<Kind[]>(Object.keys(HAZARDS) as Kind[]);
  const [point, setPoint] = useState<Point | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastState, setForecastState] = useState("");
  const [forecastError, setForecastError] = useState("");
  const [picking, setPicking] = useState(false);
  const [phoneMap, setPhoneMap] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    let pending = false;
    const load = async () => {
      if (document.hidden || pending) return;
      pending = true;
      setLoading(true);
      try {
        const d = await api<{ feeds: Feed[] }>("/api/weather/hazards");
        if (!gone) {
          setFeeds(d.feeds || []);
          setError("");
        }
      } catch (e) {
        if (!gone) setError(e instanceof Error ? e.message : "Hazard feeds unavailable");
      } finally {
        pending = false;
        if (!gone) setLoading(false);
      }
    };
    void load();
    const t = window.setInterval(load, 300_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      gone = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled, revision]);
  useEffect(() => {
    if (!enabled || !point) return;
    let gone = false;
    let pending = false;
    setForecast(null);
    setForecastState("loading");
    setForecastError("");
    const load = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const d = await api<{ ok: boolean; state: string; error?: string; forecast: Forecast | null }>(
          `/api/weather/forecast?lat=${point.lat}&lon=${point.lon}`,
        );
        if (!gone) {
          setForecast(d.forecast);
          setForecastState(d.state || "unavailable");
          setForecastError(d.error || (!d.ok ? "Forecast unavailable" : ""));
        }
      } catch (e) {
        if (!gone) {
          setForecast(null);
          setForecastState("unavailable");
          setForecastError(e instanceof Error ? e.message : "Forecast unavailable");
        }
      } finally {
        pending = false;
      }
    };
    void load();
    const t = window.setInterval(load, 3600_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      gone = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled, point, revision]);
  const latest = latestHazards(feeds);
  const all = latest.map(({ hazard }) => hazard).filter((h) => inRegion(h, region));
  const events = all.filter((h) => kinds.includes(h.kind)).sort(sortHazards);
  const selected = events.find((h) => h.id === selectedId);
  const pointSelected = selectedId === "weather:point" && point;
  const items: ListItem[] = [
    ...(point
      ? [
          {
            id: "weather:point",
            title: point.label,
            meta: forecast
              ? `${value(forecast.current.temperature, "°C")} · ${forecast.current.condition} · ${forecastState === "stale" ? "STALE · " : ""}forecast valid ${stamp(forecast.current.time)}`
              : forecastState === "loading"
                ? "Loading point forecast…"
                : "Forecast unavailable",
            tag: "FORECAST",
          },
        ]
      : []),
    ...events.map((h) => ({
      id: h.id,
      title: h.title,
      meta: `${h.level.toUpperCase()} · ${h.source} · ${stamp(h.updated || h.occurred)}`,
      tag: `${h.kind.toUpperCase()} · ${h.level.toUpperCase()}`,
      tone: (h.level === "red" ? "down" : "") as ListItem["tone"],
    })),
  ];
  const markers: Marker[] = [
    ...events.map((h) => ({
      id: h.id,
      lon: h.lon,
      lat: h.lat,
      label: h.title,
      size: h.level === "red" ? 8 : h.level === "orange" ? 7 : 5,
      color: LEVEL_COLOR[h.level] || LEVEL_COLOR.unrated,
      hot: h.id === selectedId,
    })),
    ...(point
      ? [
          {
            id: "weather:point",
            lon: point.lon,
            lat: point.lat,
            label: point.label,
            size: 7,
            color: "#3df0ff",
            hot: !!pointSelected,
          },
        ]
      : []),
  ];
  const sourceFeed = selected ? latest.find(({ hazard }) => hazard.id === selected.id)?.feed : null;
  const drawer: DrawerModel | null = selected
    ? {
        title: selected.title,
        meta: `${selected.source} · ${sourceFeed?.state === "stale" || error ? "STALE DATA · " : ""}${HAZARDS[selected.kind]}`,
        rows: [
          { label: "Provider level", value: selected.level.toUpperCase() },
          { label: "Reported", value: stamp(selected.occurred) },
          { label: "Updated", value: stamp(selected.updated) },
          { label: "Position", value: `${selected.lat.toFixed(2)}, ${selected.lon.toFixed(2)} · event center` },
          { label: "Detail", value: selected.detail },
        ],
        blocks: [
          {
            title: "Supply exposure · interpret with care",
            lines: [
              CONTEXT[selected.kind],
              "No facility-level match or confirmed loss is inferred. These signals do not predict prices.",
            ],
          },
          {
            title: "Coverage",
            lines: [
              sourceFeed?.coverage || "",
              "Provider levels describe different impact assessments; they are not a shared risk scale or a local evacuation warning.",
            ],
          },
        ],
        links: selected.url ? [{ label: "Official report", value: selected.source, href: selected.url }] : [],
        source: `${selected.source} · retrieved ${stamp(sourceFeed?.fetchedAt)}`,
      }
    : pointSelected
      ? {
          title: point.label,
          meta: `Point forecast · ${forecastState.toUpperCase()} · MET Norway`,
          rows: forecast
            ? [
                { label: "Valid", value: stamp(forecast.current.time) },
                { label: "Conditions", value: forecast.current.condition },
                { label: "Temperature", value: value(forecast.current.temperature, "°C") },
                { label: "Wind", value: value(forecast.current.wind, " m/s") },
                {
                  label: "Rain",
                  value: `${value(forecast.current.rain, " mm")} / next ${forecast.current.periodHours || "—"} h`,
                },
                { label: "24h temp change", value: value(forecast.change24h, "°C") },
                { label: "Model updated", value: stamp(forecast.updatedAt) },
              ]
            : [
                {
                  label: "Status",
                  value: forecastState === "loading" ? "Loading forecast…" : forecastError || "No forecast available",
                },
              ],
          tables: forecast
            ? [
                {
                  title: "7-day outlook · UTC",
                  cols: ["Day", "Low / high °C", "Rain mm", "Wind m/s"],
                  rows: forecast.days.map((d) => ({
                    cells: [
                      d.date.slice(5),
                      `${Math.round(d.low)} / ${Math.round(d.high)}`,
                      d.rainHours ? `${d.rain.toFixed(1)}${d.rainHours < 24 ? "*" : ""}` : "—",
                      value(d.wind, ""),
                    ],
                  })),
                  note: "Model samples, not observed daily extremes. * Partial-day rain coverage. Wind is the maximum sampled sustained wind, not gusts.",
                },
              ]
            : [],
          blocks: [
            {
              title: "Supply context",
              lines: [
                point.context ||
                  "Use the forecast alongside local operating reports and seasonal baselines. A single point is not representative of an entire producing region.",
                "Forecast changes are model estimates, not official warnings or price predictions.",
                ...(forecastError ? [`Feed notice: ${forecastError}`] : []),
              ],
            },
          ],
          links: [
            { label: "Forecast source", value: "MET Norway · CC BY 4.0", href: "https://api.met.no/" },
            {
              label: "License",
              value: "CC BY 4.0 · forecast summarized by TradeSimple",
              href: "https://creativecommons.org/licenses/by/4.0/",
            },
          ],
          source: `MET Norway · retrieved ${stamp(forecast?.fetchedAt)}`,
        }
      : null;
  const unavailable = feeds.filter((f) => f.state === "unavailable").length;
  const status: StatusLine = {
    source: "MET Norway · USGS · GDACS",
    asOf: stamp(
      feeds
        .map((f) => f.fetchedAt || "")
        .sort()
        .at(-1),
    ),
    latency:
      error ||
      `${events.length} reports in ${region.name} · ${unavailable} feeds unavailable · hazard refresh 5 min; forecasts hourly`,
  };
  return {
    phoneMap,
    setPhoneMap,
    feeds,
    loading,
    error,
    kinds,
    setKinds,
    point,
    setPoint,
    picking,
    setPicking,
    forecastState,
    events,
    all,
    items,
    markers,
    drawer,
    status,
    target: selected || (pointSelected ? point : null),
    refresh: () => setRevision((n) => n + 1),
    empty: loading
      ? "Loading hazard reports…"
      : error ||
        (!feeds.length || unavailable === feeds.length
          ? "Hazard sources are unavailable. This is not an all-clear."
          : !kinds.length
            ? "All hazard layers are off."
            : "No matching reports in this region. Coverage is incomplete; this is not an all-clear."),
  };
}
