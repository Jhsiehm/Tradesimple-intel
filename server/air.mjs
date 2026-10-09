import { fetchJson } from "./lib/http.mjs";
import { readCache, writeCache } from "./lib/db.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const HEADERS = { headers: { "User-Agent": "Mozilla/5.0 tradesimple-intel", Accept: "application/json" } };

function bboxOf(theater) {
  const halfLon = Math.min(180, (180 / 2 ** theater.zoom) * 1.6);
  const halfLat = Math.min(85, halfLon * 0.62);
  return { w: theater.lon - halfLon, e: theater.lon + halfLon, s: theater.lat - halfLat, n: theater.lat + halfLat, global: theater.zoom < 2 };
}

function inBox(ac, box) {
  if (box.global) return true;
  return ac.lat >= box.s && ac.lat <= box.n && ac.lon >= box.w && ac.lon <= box.e;
}

function shape(ac, mil, now) {
  const alt = ac.alt_baro === "ground" ? 0 : Number(ac.alt_baro ?? ac.alt_geom ?? 0) || 0;
  return {
    id: `ac:${ac.hex}`,
    hex: ac.hex,
    callsign: String(ac.flight || "").trim(),
    reg: ac.r || "",
    type: ac.t || "",
    desc: ac.desc || "",
    owner: ac.ownOp || "",
    lat: ac.lat,
    lon: ac.lon,
    alt,
    ground: ac.alt_baro === "ground",
    gs: ac.gs ?? null,
    track: ac.track ?? null,
    squawk: ac.squawk || "",
    emergency: ac.emergency && ac.emergency !== "none" ? ac.emergency : ["7500", "7600", "7700"].includes(ac.squawk) ? `squawk ${ac.squawk}` : "",
    mil,
    seen: new Date(now - (Number(ac.seen_pos ?? ac.seen ?? 0) * 1000)).toISOString()
  };
}

async function militaryAll(db) {
  const hit = readCache(db, KEY.airMil);
  if (hit) return hit;
  const body = await fetchJson("https://api.adsb.lol/v2/mil", HEADERS, 20000);
  const now = body?.now || Date.now();
  const items = (body?.ac || []).filter((ac) => ac.lat != null && ac.lon != null).map((ac) => shape(ac, true, now));
  const out = { now, items };
  writeCache(db, KEY.airMil, out, 30 * 1000);
  return out;
}

async function civilNear(db, theater) {
  const key = KEY.airTheater(theater.id);
  const hit = readCache(db, key);
  if (hit) return hit;
  const body = await fetchJson(`https://api.adsb.lol/v2/point/${theater.lat}/${theater.lon}/250`, HEADERS, 20000);
  const now = body?.now || Date.now();
  const items = (body?.ac || []).filter((ac) => ac.lat != null && ac.lon != null).map((ac) => shape(ac, Boolean(ac.dbFlags & 1), now));
  const out = { now, items };
  writeCache(db, key, out, 30 * 1000);
  return out;
}

export async function airspace(db, theater) {
  const started = Date.now();
  const box = bboxOf(theater);
  const [mil, civil] = await Promise.all([
    militaryAll(db).catch(() => ({ items: [], error: true })),
    box.global ? Promise.resolve({ items: [] }) : civilNear(db, theater).catch(() => ({ items: [], error: true }))
  ]);
  const byHex = new Map();
  for (const ac of civil.items) byHex.set(ac.hex, ac);
  for (const ac of mil.items.filter((a) => inBox(a, box))) byHex.set(ac.hex, { ...byHex.get(ac.hex), ...ac, mil: true });
  const items = [...byHex.values()].sort((a, b) => Number(b.mil) - Number(a.mil) || b.alt - a.alt);
  const milCount = items.filter((a) => a.mil).length;
  return {
    ok: !(mil.error && civil.error),
    source: "adsb.lol community ADS-B network (v2 /mil + /point)",
    asOf: new Date(mil.now || civil.now || Date.now()).toISOString(),
    latency: `Aircraft positions from volunteer ADS-B/MLAT receivers, usually 1–60 s old · cached 30 s · ${box.global ? "worldwide military only" : "civil within 250 nm of the theater center, military across the theater box"} · ${milCount} military of ${items.length} · fetched in ${Date.now() - started} ms. Military coverage only includes aircraft broadcasting ADS-B or seen by MLAT; many military flights fly dark.`,
    theater: theater.id,
    box,
    milWorld: mil.items.length,
    items: items.slice(0, 1500)
  };
}

export async function flightRoute(db, callsign) {
  const cs = String(callsign || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(cs)) return { ok: false, error: "Bad callsign" };
  const key = KEY.airRoute(cs);
  const hit = readCache(db, key);
  if (hit) return hit;
  const body = await fetchJson(`https://api.adsbdb.com/v0/callsign/${cs}`, HEADERS, 12000).catch(() => null);
  const r = body?.response?.flightroute;
  const airport = (a) => a && { iata: a.iata_code, icao: a.icao_code, name: a.name, city: a.municipality, country: a.country_name, lat: a.latitude, lon: a.longitude };
  const out = r
    ? { ok: true, source: "adsbdb.com callsign route database", callsign: cs, airline: r.airline?.name || "", flight: r.callsign_iata || "", origin: airport(r.origin), destination: airport(r.destination), note: "Scheduled route for this callsign from a community database; the aircraft may be flying a different leg today." }
    : { ok: false, source: "adsbdb.com callsign route database", callsign: cs, error: "No route on file for this callsign (common for military, private, and cargo flights)." };
  writeCache(db, key, out, 24 * 3600 * 1000);
  return out;
}
