import { fetchJson, fetchResponse, makeGate } from "./lib/http.mjs";
import { throughCache, readStale } from "./lib/cache.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const HEADERS = {
  headers: {
    "User-Agent": "TradeSimple-Intel/0.1 (https://github.com/Jhsiehm/Tradesimple-intel)",
    Accept: "application/json",
  },
};
const pending = new WeakMap();
const forecastGate = makeGate(2, 150);
async function cached(db, key, ttlMs, load) {
  let jobs = pending.get(db);
  if (!jobs) pending.set(db, (jobs = new Map()));
  if (!jobs.has(key))
    jobs.set(
      key,
      throughCache(db, key, { ttlMs, downMs: 60_000, timeoutMs: 15000, load }).finally(() => jobs.delete(key)),
    );
  return jobs.get(key);
}
const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v) => {
  if (v == null || v === "") return null;
  const d = new Date(typeof v === "string" && !/(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? `${v}Z` : v);
  return Number.isFinite(+d) ? d.toISOString() : null;
};
const safeUrl = (url, host) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === host ? u.href : "";
  } catch {
    return "";
  }
};
const coordinates = (f) =>
  f?.geometry?.type === "Point" &&
  f.geometry.coordinates?.length >= 2 &&
  f.geometry.coordinates.slice(0, 2).every((x) => number(x) !== null) &&
  Math.abs(f.geometry.coordinates[0]) <= 180 &&
  Math.abs(f.geometry.coordinates[1]) <= 90;
export function normalizeQuakes(body) {
  if (!Array.isArray(body?.features) || body?.metadata?.status !== 200)
    throw new Error("USGS returned an invalid feed");
  return body.features
    .filter(
      (f) =>
        coordinates(f) &&
        f.properties?.type === "earthquake" &&
        number(f.properties?.mag) !== null &&
        iso(f.properties?.time),
    )
    .map((f) => ({
      id: `usgs:${f.id}`,
      kind: "earthquake",
      title: String(f.properties.title || f.properties.place || "Earthquake"),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      occurred: iso(f.properties.time),
      updated: iso(f.properties.updated),
      level: ["red", "orange", "yellow", "green"].includes(f.properties.alert) ? f.properties.alert : "unrated",
      detail: `Magnitude ${f.properties.mag} · depth ${number(f.geometry.coordinates[2]) ?? "unknown"} km · ${f.properties.status || "unreviewed"}`,
      url: safeUrl(f.properties.url, "earthquake.usgs.gov"),
      source: "USGS",
      magnitude: f.properties.mag,
    }));
}
const KINDS = { TC: "cyclone", FL: "flood", DR: "drought", WF: "wildfire", VO: "volcano" };
export function normalizeDisasters(body) {
  if (!Array.isArray(body?.features)) throw new Error("GDACS returned an invalid feed");
  const unique = new Map();
  for (const f of body.features) {
    const p = f.properties;
    if (!coordinates(f) || !KINDS[p?.eventtype] || String(p.iscurrent).toLowerCase() !== "true") continue;
    const id = `gdacs:${p.eventtype}:${p.eventid}`;
    const item = {
      id,
      kind: KINDS[p.eventtype],
      title: String(
        p.eventtype === "DR" && p.eventname
          ? `Drought · ${p.eventname}`
          : p.name || p.description || KINDS[p.eventtype],
      ),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      occurred: iso(p.fromdate),
      updated: iso(p.datemodified),
      ends: iso(p.todate),
      level: ["green", "orange", "red"].includes(String(p.alertlevel).toLowerCase())
        ? String(p.alertlevel).toLowerCase()
        : "unrated",
      detail: String(p.severitydata?.severitytext || p.description || ""),
      country: String(p.country || ""),
      url: safeUrl(p.url?.report, "www.gdacs.org"),
      source: "GDACS",
    };
    if (!unique.has(id) || String(item.updated) > String(unique.get(id).updated)) unique.set(id, item);
  }
  return [...unique.values()];
}

export async function hazards(db) {
  const from = new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const definitions = [
    {
      id: "usgs",
      name: "USGS",
      key: KEY.weatherQuakes,
      url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
      normalize: normalizeQuakes,
      coverage: "M2.5+ earthquakes in the past 7 days. PAGER impact level when available; unrated is not an all-clear.",
    },
    {
      id: "gdacs-slow",
      name: "GDACS drought / volcano",
      key: KEY.weatherSlow,
      url: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=DR;VO&fromdate=${from}&todate=${to}`,
      normalize: normalizeDisasters,
      coverage:
        "Drought and volcano reports marked current by GDACS, from a 2-year search window (up to 100 reports). Event centers only; not a complete drought severity map.",
    },
    {
      id: "gdacs",
      name: "GDACS",
      key: KEY.weatherDisasters,
      url: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/events4app",
      normalize: normalizeDisasters,
      coverage:
        "Current non-earthquake events in GDACS’s latest 100 reports. Event centers, not affected-area boundaries. Not all local warnings.",
    },
  ];
  const feeds = await Promise.all(
    definitions.map(async (d) => {
      const result = await cached(db, d.key, d.id === "gdacs-slow" ? 60 * 60_000 : 5 * 60_000, async () => {
        const raw = await fetchJson(d.url, HEADERS, 15000);
        return {
          items: d.normalize(raw),
          fetchedAt: new Date().toISOString(),
          generatedAt: d.id === "usgs" ? iso(raw.metadata.generated) : null,
        };
      });
      return {
        id: d.id,
        name: d.name,
        coverage: d.coverage,
        state: result.down ? (result.value ? "stale" : "unavailable") : "ok",
        error: result.down?.why || null,
        ...result.value,
        items: result.value?.items || [],
      };
    }),
  );
  return { ok: feeds.some((f) => f.state !== "unavailable"), feeds };
}

export function normalizeForecast(body, lat, lon, now = Date.now()) {
  const series = body?.properties?.timeseries;
  if (!Array.isArray(series) || !iso(body?.properties?.meta?.updated_at))
    throw new Error("MET Norway returned an invalid forecast");
  const hours = series
    .filter((s) => +new Date(s.time) >= now - 3600_000)
    .map((s) => {
      const d = s.data?.instant?.details || {};
      const period = s.data?.next_1_hours || s.data?.next_6_hours;
      return {
        time: iso(s.time),
        temperature: number(d.air_temperature),
        wind: number(d.wind_speed),
        humidity: number(d.relative_humidity),
        rain: number(period?.details?.precipitation_amount),
        periodHours: s.data?.next_1_hours ? 1 : s.data?.next_6_hours ? 6 : 0,
        condition: String(period?.summary?.symbol_code || "unknown")
          .replace(/_(day|night|polartwilight)$/, "")
          .replaceAll("_", " "),
      };
    })
    .filter((h) => h.time && h.temperature !== null);
  if (!hours.length) throw new Error("No current forecast periods available");
  // Accumulate only non-overlapping forward precipitation intervals, clipping at UTC day boundaries.
  const days = new Map();
  for (const h of hours) {
    const date = h.time.slice(0, 10);
    if (!days.has(date))
      days.set(date, { date, low: h.temperature, high: h.temperature, wind: h.wind, rain: 0, rainHours: 0 });
    const day = days.get(date);
    day.low = Math.min(day.low, h.temperature);
    day.high = Math.max(day.high, h.temperature);
    if (h.wind !== null) day.wind = Math.max(day.wind ?? 0, h.wind);
  }
  let coveredUntil = 0;
  for (const h of hours) {
    const start = +new Date(h.time),
      end = start + h.periodHours * 3600_000;
    if (h.rain === null || !h.periodHours || start < coveredUntil) continue;
    coveredUntil = end;
    for (let t = start; t < end; ) {
      const date = new Date(t).toISOString().slice(0, 10),
        next = Math.min(end, +new Date(`${date}T00:00:00Z`) + 86400_000);
      const day = days.get(date);
      if (day) {
        day.rain += h.rain * ((next - t) / (end - start));
        day.rainHours += (next - t) / 3600_000;
      }
      t = next;
    }
  }
  const next24 = hours.find((h) => +new Date(h.time) >= +new Date(hours[0].time) + 86400_000);
  return {
    lat,
    lon,
    updatedAt: iso(body.properties.meta.updated_at),
    fetchedAt: new Date(now).toISOString(),
    current: hours[0],
    change24h: next24 ? Math.round((next24.temperature - hours[0].temperature) * 10) / 10 : null,
    days: [...days.values()].slice(0, 7),
    source: "MET Norway",
    license: "CC BY 4.0",
    url: "https://api.met.no/",
  };
}
export async function forecast(db, latInput, lonInput) {
  const lat = Number(latInput),
    lon = Number(lonInput);
  if (
    latInput == null ||
    lonInput == null ||
    String(latInput).trim() === "" ||
    String(lonInput).trim() === "" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return { ok: false, error: "Latitude must be −90 to 90 and longitude −180 to 180." };
  }
  const y = Number(lat.toFixed(2)),
    x = Number(lon.toFixed(2));
  const key = KEY.weatherPoint(y, x);
  const r = await cached(
    db,
    key,
    (v) => Math.max(3600_000, Date.parse(v.expires || "") - Date.now() || 0),
    async () =>
      forecastGate(async () => {
        const prior = readStale(db, key)?.value;
        const response = await fetchResponse(
          `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${y}&lon=${x}`,
          { headers: { ...HEADERS.headers, ...(prior?.modified ? { "If-Modified-Since": prior.modified } : {}) } },
          15000,
        );
        if (!response.ok && response.status !== 304) throw new Error(`MET Norway returned HTTP ${response.status}`);
        const raw = response.status === 304 ? prior?.raw : await response.json();
        normalizeForecast(raw, y, x); // Reject malformed or expired forecasts before caching.
        return {
          raw,
          fetchedAt: new Date().toISOString(),
          expires: response.headers.get("expires"),
          modified: response.headers.get("last-modified") || prior?.modified,
        };
      }),
  );
  let data = null;
  try {
    if (r.value) data = { ...normalizeForecast(r.value.raw, y, x), fetchedAt: r.value.fetchedAt };
  } catch {
    /* Expired cached data is not a current forecast. */
  }
  return {
    ok: !!data,
    state: r.down ? (data ? "stale" : "unavailable") : data ? "ok" : "unavailable",
    error: r.down?.why || (!data ? "No current forecast periods available" : null),
    forecast: data,
  };
}
