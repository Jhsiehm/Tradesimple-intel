import { fetchJson } from "../lib/http.mjs";
import { readCache, writeCache } from "../lib/db.mjs";
import { KEY } from "../lib/cacheKeys.mjs";

const BASE = "https://api.congress.gov/v3";

export const TTL = 15 * 60 * 1000;

function key() {
  return process.env.CONGRESS_API_KEY || "";
}

function missing() {
  return { ok: false, missing: "CONGRESS_API_KEY", items: [] };
}

export async function congressGet(db, path, ttl = TTL) {
  const apiKey = key();
  if (!apiKey) return missing();
  const cacheKey = KEY.congress(path);
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  const body = await fetchJson(url);
  const wrapped = { ok: true, body };
  writeCache(db, cacheKey, wrapped, ttl);
  return wrapped;
}
