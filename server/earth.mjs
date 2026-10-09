import { readFileSync } from "node:fs";
import { fetchText } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";

const HOUR = 60 * 60 * 1000;
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const LANES_URL = "https://raw.githubusercontent.com/newzealandpaul/Shipping-Lanes/main/data/Shipping_Lanes_v1.geojson";
const CHOKEPOINTS = JSON.parse(readFileSync(new URL("../data/chokepoints.json", import.meta.url), "utf8"));

export async function imagery(db) {
  const hit = readCache(db, "earth:imagery:v2");
  if (hit) return hit;
  const daily = await latestGibsDay();
  const result = {
    ok: true,
    asOf: new Date().toISOString(),
    layers: {
      dark: {
        tiles: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
        maxzoom: 16,
        source: "Esri World Dark Gray",
        asOf: "Vector basemap, updated by Esri",
        attribution: "© Esri, HERE, Garmin, OpenStreetMap contributors"
      },
      sat: {
        tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
        maxzoom: 19,
        source: "Esri World Imagery",
        asOf: "Mosaic of mixed capture dates (Maxar, Airbus, USGS, NASA)",
        attribution: "© Esri, Maxar, Earthstar Geographics"
      },
      daily: {
        tiles: [`${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${daily}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`],
        maxzoom: 9,
        source: "NASA GIBS · VIIRS NOAA-20 true color",
        asOf: daily,
        attribution: "NASA EOSDIS GIBS"
      },
      night: {
        tiles: [`${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`],
        maxzoom: 8,
        source: "NASA Black Marble · VIIRS night lights",
        asOf: "2016 annual composite",
        attribution: "NASA Earth Observatory"
      },
      labels: {
        tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
        maxzoom: 19,
        attribution: "© Esri"
      },
      darkLabels: {
        tiles: [`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
        maxzoom: 16,
        attribution: "© Esri"
      },
      roads: {
        tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`],
        maxzoom: 19,
        attribution: "© Esri"
      },
      terrain: {
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        maxzoom: 15,
        encoding: "terrarium",
        source: "AWS Terrain Tiles (SRTM, GMTED, ETOPO1)",
        attribution: "Mapzen, AWS Open Data"
      },
      buildings: {
        tiles: [],
        tilejson: "https://tiles.openfreemap.org/planet",
        maxzoom: 14,
        source: "OpenFreeMap · OpenStreetMap buildings",
        asOf: "OpenStreetMap, continuously updated",
        attribution: "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors"
      }
    }
  };
  writeCache(db, "earth:imagery:v2", result, 3 * HOUR);
  return result;
}

const LIVE = [
  { id: "GOES-East_ABI_GeoColor", key: "goesEast", name: "GOES-East GeoColor", covers: "Americas, Atlantic", lon: -75.2 },
  { id: "GOES-West_ABI_GeoColor", key: "goesWest", name: "GOES-West GeoColor", covers: "Eastern Pacific, western Americas", lon: -137.2 },
  { id: "Himawari_AHI_Band13_Clean_Infrared", key: "himawari", name: "Himawari-9 clean IR", covers: "East Asia, Southeast Asia, Oceania", lon: 140.7 }
];
const DAILY_ID = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";

export async function liveImagery(db) {
  const hit = readCache(db, "earth:live:v1");
  if (hit) return hit;
  const started = Date.now();
  const xml = await fetchText(`${GIBS}/1.0.0/WMTSCapabilities.xml`, {}, 60000);
  const block = (id) => {
    const at = xml.indexOf(`<ows:Identifier>${id}</ows:Identifier>`);
    if (at < 0) return "";
    return xml.slice(xml.lastIndexOf("<Layer>", at), xml.indexOf("</Layer>", at));
  };
  const since = Date.now() - 30 * HOUR;
  const layers = LIVE.map((layer) => {
    const text = block(layer.id);
    const set = (text.match(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/) || [])[1] || "GoogleMapsCompatible_Level6";
    const ranges = [...text.matchAll(/<Value>([^/<]+)\/([^/<]+)\/PT(\d+)M<\/Value>/g)]
      .map((m) => ({ start: Date.parse(m[1]), end: Date.parse(m[2]), step: Number(m[3]) * 60000 }))
      .filter((r) => r.end >= since)
      .map((r) => ({ ...r, start: Math.max(r.start, since - (since % r.step)) }));
    return {
      ...layer,
      maxzoom: Number(set.match(/Level(\d+)/)?.[1] || 6),
      template: `${GIBS}/${layer.id}/default/{time}/${set}/{z}/{y}/{x}.png`,
      ranges
    };
  }).filter((layer) => layer.ranges.length);
  const dailyRanges = [...block(DAILY_ID).matchAll(/<Value>([^/<]+)\/([^/<]+)\/P1D<\/Value>/g)];
  const dailyEnd = dailyRanges.length ? dailyRanges[dailyRanges.length - 1][2] : new Date().toISOString().slice(0, 10);
  const complete = await latestGibsDay();
  const result = {
    ok: true,
    asOf: new Date().toISOString(),
    source: "NASA GIBS WMTS capabilities",
    latency: `Geostationary frames every 10 min; GIBS posts each about an hour after capture, so frame age is shown per satellite · capabilities read in ${Math.round((Date.now() - started) / 100) / 10}s`,
    gap: "No Meteosat layer on GIBS: Europe, Africa, the Middle East and India fall back to the daily VIIRS pass.",
    layers,
    daily: {
      id: DAILY_ID,
      name: "VIIRS NOAA-20 true color",
      template: `${GIBS}/${DAILY_ID}/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      maxzoom: 9,
      end: dailyEnd,
      complete
    }
  };
  writeCache(db, "earth:live:v1", result, 5 * 60 * 1000);
  return result;
}

export async function shippingLanes(db) {
  const hit = readCache(db, "earth:lanes:v1");
  if (hit) return hit;
  const raw = JSON.parse(await fetchText(LANES_URL, {}, 60000));
  const lanes = {
    type: "FeatureCollection",
    features: raw.features.map((f) => ({
      type: "Feature",
      properties: { type: f.properties.Type },
      geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }
    }))
  };
  const result = {
    ok: true,
    source: "CIA Map of the World's Oceans (2012), georeferenced by newzealandpaul/Shipping-Lanes",
    asOf: "2012 chart · reference routes, not live traffic",
    license: "CC BY 4.0",
    lanes,
    chokepoints: {
      type: "FeatureCollection",
      features: CHOKEPOINTS.map((c) => ({
        type: "Feature",
        properties: { id: `choke:${c.id}`, name: c.name },
        geometry: { type: "Point", coordinates: [c.lon, c.lat] }
      }))
    }
  };
  writeCache(db, "earth:lanes:v1", result, 7 * 24 * HOUR);
  return result;
}

async function latestGibsDay() {
  for (const back of [1, 2, 3]) {
    const day = new Date(Date.now() - back * 24 * HOUR).toISOString().slice(0, 10);
    try {
      const res = await fetch(`${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${day}/GoogleMapsCompatible_Level9/3/3/2.jpg`, { signal: AbortSignal.timeout(8000) });
      const size = Number(res.headers.get("content-length") || (await res.arrayBuffer()).byteLength);
      if (res.ok && size > 8000) return day;
    } catch {
      /* try the day before */
    }
  }
  return new Date(Date.now() - 3 * 24 * HOUR).toISOString().slice(0, 10);
}

function round(coords) {
  return Array.isArray(coords[0])
    ? coords.map(round)
    : [Math.round(coords[0] * 1000) / 1000, Math.round(coords[1] * 1000) / 1000];
}
