import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, makeGate } from "./lib/http.mjs";
import { listTickers, readCache, tickerBySymbol, writeCache } from "./lib/db.mjs";
import { FIPS_TO_POSTAL } from "./geo.mjs";
import { DAY } from "./lib/time.mjs";
import { APP_UA, SEC_UA } from "./lib/ua.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(root, "data", "hq.json");
export const HQ_SOURCE = "SEC EDGAR submissions (business address) · US Census Geocoder, OpenStreetMap Nominatim fallback · Census 119th Congressional Districts";
export const HQ_LATENCY = "Address as last filed with the SEC; refreshed every 30 days. A registered office can differ from where most staff work.";

/** SEC asks for at most 10 requests/s; Nominatim for 1/s. */
const secGate = makeGate(2, 150);
const censusGate = makeGate(2, 200);
const osmGate = makeGate(1, 1100);
const US_POSTAL = new Set(Object.values(FIPS_TO_POSTAL));

const WORDS = { ONE: "1", TWO: "2", THREE: "3", FOUR: "4", FIVE: "5", SIX: "6", SEVEN: "7", EIGHT: "8", NINE: "9", TEN: "10", ELEVEN: "11", TWELVE: "12", FIFTEEN: "15", TWENTY: "20", FIFTY: "50", HUNDRED: "100" };

const NUMBER_WORD = new RegExp(`^(${Object.keys(WORDS).join("|")})\\b`);

/**
 * Street lines worth geocoding, best first: numbered lines (number words spelled out as digits), then
 * named buildings. Suite, floor, drop codes and PO boxes are stripped; a filing's address lines are often
 * split across commas as well as street1/street2.
 */
export function geocodeStreets(street1, street2) {
  const parts = [street1, street2]
    .flatMap((s) => String(s || "").toUpperCase().split(","))
    .map((s) => s
      .replace(/\./g, "")
      .replace(/\b\d+(ST|ND|RD|TH) (FLOOR|FL)\b.*$/, "")
      .replace(/\b(SUITE|STE|FLOOR|FL|UNIT|BLDG|ROOM|RM|MAIL STOP|MS|DROP CODE)\b.*$/, "")
      .replace(/#\s*\w+$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(NUMBER_WORD, (w) => WORDS[w]))
    .filter((s) => s && !/^(P ?O BOX|POST OFFICE BOX)\b/.test(s) && !/^(N ?W|N ?E|S ?W|S ?E)$/.test(s));
  const numbered = parts.filter((s) => /^\d+\s+\D/.test(s));
  return [...new Set([...numbered, ...parts.filter((s) => !numbered.includes(s))])];
}

let shapes = null;
function districtShapes() {
  if (shapes) return shapes;
  const geo = JSON.parse(fs.readFileSync(path.join(root, "data", "geo", "cd119.geojson"), "utf8"));
  shapes = geo.features.filter((f) => f.properties?.CD119 !== "ZZ").map((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let minX = 180, minY = 90, maxX = -360, maxY = -90;
    for (const ring of polys.map((p) => p[0])) for (const [x, y] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { geoid: String(f.properties.GEOID), polys, box: [minX, minY, maxX, maxY] };
  });
  return shapes;
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 119th Congress district GEOID containing a point, or null (offshore, or a gap in the generalized lines). */
export function districtAt(lon, lat, list = districtShapes()) {
  for (const s of list) {
    const [a, b, c, d] = s.box;
    if (lon < a || lon > c || lat < b || lat > d) continue;
    for (const poly of s.polys) {
      if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole))) return s.geoid;
    }
  }
  return null;
}

/**
 * District lines are generalized, so a waterfront address can land just offshore. Probe within ~1 km and
 * accept only when every probe that hits a district hits the same one.
 */
export function districtNear(lon, lat, list = districtShapes()) {
  const exact = districtAt(lon, lat, list);
  if (exact) return { geoid: exact, nudged: false };
  for (const r of [0.004, 0.01]) {
    const hits = new Set();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const g = districtAt(lon + r * Math.cos(a), lat + r * Math.sin(a), list);
      if (g) hits.add(g);
    }
    if (hits.size === 1) return { geoid: [...hits][0], nudged: true };
    if (hits.size > 1) return { geoid: null, nudged: false };
  }
  return { geoid: null, nudged: false };
}

/** "0617" → "CA-17"; at-large and delegate seats → "AK-AL". */
export function districtCode(geoid) {
  const postal = FIPS_TO_POSTAL[String(geoid).slice(0, 2)];
  const num = String(geoid).slice(2);
  if (!postal || !/^\d\d$/.test(num)) return null;
  return `${postal}-${num === "00" || num === "98" ? "AL" : num}`;
}

/** The ACS2025 vintage carries 119th Congress lines (layer 54); "Current" has already moved to the 120th. */
const CENSUS = { benchmark: "Public_AR_Current", vintage: "ACS2025_Current", layers: "54", format: "json" };
const cd119 = (geographies) => String(geographies?.["119th Congressional Districts"]?.[0]?.GEOID || "") || null;

async function censusPoint(street, city, state, zip) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/address");
  url.search = new URLSearchParams({ street, city, state, zip: zip.slice(0, 5), ...CENSUS }).toString();
  const body = await censusGate(() => fetchJson(url, {}, 20000));
  const hit = body?.result?.addressMatches?.[0];
  return hit ? { lon: hit.coordinates.x, lat: hit.coordinates.y, matched: hit.matchedAddress, geocoder: "US Census Geocoder", geoid: cd119(hit.geographies) } : null;
}

async function censusDistrict(lon, lat) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
  url.search = new URLSearchParams({ x: String(lon), y: String(lat), ...CENSUS }).toString();
  const body = await censusGate(() => fetchJson(url, {}, 20000));
  return cd119(body?.result?.geographies);
}

async function osmPoint(street, city, state, zip, freeform = false) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  const where = freeform ? { q: `${street}, ${city}, ${state} ${zip.slice(0, 5)}` } : { street, city, state, postalcode: zip.slice(0, 5) };
  url.search = new URLSearchParams({ format: "jsonv2", countrycodes: "us", limit: "1", ...where }).toString();
  const body = await osmGate(() => fetchJson(url, { headers: { "User-Agent": APP_UA } }, 20000));
  const hit = body?.[0];
  if (!hit || Number(hit.place_rank) < 26) return null;
  return { lon: Number(hit.lon), lat: Number(hit.lat), matched: hit.display_name, geocoder: "OpenStreetMap Nominatim" };
}

/** One company's SEC business address, geocoded and placed in a 119th district. Cached 30 days. */
export async function lookupHq(db, ticker, { priority = false, force = false } = {}) {
  const key = KEY.hq(ticker.symbol);
  const hit = force ? null : readCache(db, key);
  if (hit) return hit;
  const row = { symbol: ticker.symbol, name: ticker.name, cik: ticker.cik, filer: "", street: "", city: "", state: "", zip: "", foreign: false, lat: null, lon: null, geocoder: null, matched: "", geoid: null, district: null, districtBy: "", fetched: new Date().toISOString(), note: "" };
  try {
    const subs = await secGate(() => fetchJson(`https://data.sec.gov/submissions/CIK${ticker.cik}.json`, { headers: { "User-Agent": SEC_UA } }, 20000), { priority });
    const a = subs?.addresses?.business || {};
    Object.assign(row, {
      filer: subs?.name || "",
      street: [a.street1, a.street2].filter(Boolean).join(", "),
      city: a.city || "",
      state: a.stateOrCountry || "",
      zip: a.zipCode || "",
      foreign: Boolean(a.isForeignLocation) || !US_POSTAL.has(a.stateOrCountry || ""),
      country: a.stateOrCountryDescription || ""
    });
    if (row.foreign) row.note = `Business address outside the US (${row.country || row.state}).`;
    else {
      const streets = geocodeStreets(a.street1, a.street2);
      const tries = [
        ...streets.filter((s) => /^\d/.test(s)).map((s) => () => censusPoint(s, row.city, row.state, row.zip)),
        ...streets.slice(0, 2).map((s) => () => osmPoint(s, row.city, row.state, row.zip)),
        ...streets.slice(0, 2).map((s) => () => osmPoint(s, row.city, row.state, row.zip, true))
      ];
      let point = null;
      for (const attempt of tries) {
        point = await attempt().catch(() => null);
        if (point) break;
      }
      if (point) {
        Object.assign(row, { lat: Math.round(point.lat * 1e5) / 1e5, lon: Math.round(point.lon * 1e5) / 1e5, geocoder: point.geocoder, matched: point.matched });
        const census = point.geoid || (await censusDistrict(point.lon, point.lat).catch(() => null));
        const near = census ? null : districtNear(point.lon, point.lat);
        row.geoid = census || near.geoid;
        row.districtBy = census ? "Census 119th Congressional Districts (ACS2025 vintage)" : row.geoid ? "Point-in-polygon on generalized 119th lines" : "";
        row.district = row.geoid ? districtCode(row.geoid) : null;
        if (near?.nudged) row.note = "Point sits just off the generalized district line; snapped to the only district within ~1 km.";
        if (!row.district) row.note = "Geocoded point is not inside a 119th district.";
      } else row.note = streets.length ? "Neither geocoder matched the street address." : "No street address on file (PO box or blank).";
    }
    writeCache(db, key, row, row.district || row.foreign ? 30 * DAY : 3 * DAY);
  } catch (err) {
    row.note = `SEC EDGAR: ${err.message}`;
    writeCache(db, key, row, DAY);
  }
  return row;
}

let fileMemo = { mtime: -1, body: { asOf: null, items: [] } };

/** data/hq.json, re-read only when its mtime changes (scripts/hq.mjs rewrites it). */
function precomputed() {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (mtime !== fileMemo.mtime) fileMemo = { mtime, body: JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    fileMemo = { mtime: -1, body: { asOf: null, items: [] } };
  }
  return fileMemo.body;
}

/** Every joined ticker's HQ: live cache first, then the precomputed file from scripts/hq.mjs. */
export function hqAll(db) {
  const file = precomputed();
  const bySymbol = new Map(file.items.map((r) => [r.symbol, r]));
  const items = listTickers(db).map((t) => readCache(db, KEY.hq(t.symbol)) || bySymbol.get(t.symbol)).filter(Boolean);
  return { ok: true, source: HQ_SOURCE, asOf: file.asOf, latency: HQ_LATENCY, items };
}

export async function hqFor(db, symbol) {
  const ticker = tickerBySymbol(db, symbol);
  if (!ticker) return { ok: false, error: "Ticker is not in the join table" };
  if (!ticker.cik) return { ok: false, error: "No SEC CIK on the join row" };
  const cached = readCache(db, KEY.hq(ticker.symbol)) || precomputed().items.find((r) => r.symbol === ticker.symbol);
  const item = cached || (await lookupHq(db, ticker, { priority: true }));
  return { ok: true, source: HQ_SOURCE, asOf: item.fetched, latency: HQ_LATENCY, item };
}
