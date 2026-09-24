import { fetchJson, fetchText } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";

const BBOX = { minLon: 117, maxLon: 122.5, minLat: 22, maxLat: 26.8 };
const ships = new Map();
let aisStarted = false;

export async function straitNews(db) {
  const hit = readCache(db, "gdelt-strait");
  if (hit) return hit;
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", "\"Taiwan Strait\" sourcelang:eng");
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "8");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  let body;
  try {
    body = await fetchJson(url);
  } catch (err) {
    if (err.status !== 429) throw err;
    return rssNews(db);
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.articles)) return rssNews(db);
  const items = (body.articles || []).map((a) => ({
    id: a.url,
    title: a.title,
    source: a.domain || a.sourcecountry || "",
    seen: a.seendate || "",
    url: a.url
  }));
  items.sort((a, b) => String(b.seen).localeCompare(String(a.seen)));
  const result = {
    ok: true,
    source: "GDELT",
    asOf: new Date().toISOString(),
    items
  };
  writeCache(db, "gdelt-strait", result, 15 * 60 * 1000);
  return result;
}

async function rssNews(db) {
  const xml = await fetchText(
    "https://news.google.com/rss/search?q=Taiwan+Strait&hl=en-US&gl=US&ceid=US:en",
    { headers: { "User-Agent": "TradeSimpleIntel/0.1" } }
  );
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((match) => {
    const block = match[1];
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() || "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || title;
    const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || "";
    return { id: link, title, source: "Google News RSS", seen: date, url: link };
  });
  items.sort((a, b) => Date.parse(b.seen) - Date.parse(a.seen));
  const result = { ok: true, source: "Google News RSS", asOf: new Date().toISOString(), items };
  writeCache(db, "gdelt-strait", result, 15 * 60 * 1000);
  return result;
}

export function satelliteStill() {
  const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    ok: true,
    source: "NASA GIBS VIIRS true color",
    asOf: date,
    note: "Open scene, not a tasked satellite.",
    tiles: [
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
    ],
    map: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
    ]
  };
}

export function aisSnapshot() {
  const apiKey = process.env.AISSTREAM_API_KEY || "";
  if (!apiKey) {
    return {
      ok: false,
      missing: "AISSTREAM_API_KEY",
      source: "AISStream",
      items: []
    };
  }
  ensureAis(apiKey);
  const items = [...ships.values()]
    .sort((a, b) => String(b.seen).localeCompare(String(a.seen)))
    .slice(0, 40);
  return {
    ok: true,
    source: "AISStream",
    asOf: new Date().toISOString(),
    latency: "Positions update while the server holds the websocket.",
    items
  };
}

function ensureAis(apiKey) {
  if (aisStarted) return;
  aisStarted = true;
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [[[BBOX.minLat, BBOX.minLon], [BBOX.maxLat, BBOX.maxLon]]],
      FilterMessageTypes: ["PositionReport"]
    }));
  });
  ws.addEventListener("message", async (ev) => {
    try {
      const raw = typeof ev.data === "string" ? ev.data : await ev.data.text();
      const msg = JSON.parse(raw);
      const meta = msg.MetaData || {};
      const lat = meta.latitude;
      const lon = meta.longitude;
      if (lat == null || lon == null) return;
      if (lon < BBOX.minLon || lon > BBOX.maxLon || lat < BBOX.minLat || lat > BBOX.maxLat) return;
      const id = String(meta.MMSI || meta.ShipName || Math.random());
      ships.set(id, {
        id,
        name: meta.ShipName || id,
        mmsi: meta.MMSI || "",
        lat,
        lon,
        seen: meta.time_utc || new Date().toISOString()
      });
      if (ships.size > 80) {
        const first = ships.keys().next().value;
        ships.delete(first);
      }
    } catch {
      /* ignore malformed frames */
    }
  });
  ws.addEventListener("close", () => {
    aisStarted = false;
  });
}

export const THEATERS = [
  { id: "taiwan-strait", name: "Taiwan Strait", lon: 119.6, lat: 24.4, zoom: 5.4, live: true },
  { id: "china", name: "China", lon: 104, lat: 35, zoom: 3.2, live: false },
  { id: "europe", name: "Europe", lon: 10, lat: 50, zoom: 3.4, live: false },
  { id: "middle-east", name: "Middle East", lon: 44, lat: 28, zoom: 3.6, live: false },
  { id: "eastern-europe", name: "Eastern Europe", lon: 31, lat: 49, zoom: 3.6, live: false },
  { id: "south-asia", name: "South Asia", lon: 78, lat: 22, zoom: 3.6, live: false },
  { id: "southeast-asia", name: "Southeast Asia", lon: 112, lat: 8, zoom: 3.4, live: false }
];
