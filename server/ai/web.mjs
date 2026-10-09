/**
 * Optional open-web tools for Ask. Keys stay on the server. Results always carry source, asOf, latency,
 * and a URL the model can cite. Nothing here writes or places orders.
 */
import { fetchText, fetchResponse } from "../lib/http.mjs";
import { readCache, writeCache } from "../lib/db.mjs";

const BROWSER_UA = "Mozilla/5.0 tradesimple-intel-ask";
const TTL = 10 * 60 * 1000;

const cacheKey = (kind, q) => `ask:web:${kind}:${String(q).slice(0, 160).toLowerCase()}`;

const cleanUrl = (raw) => {
  try {
    const u = new URL(String(raw || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(u.hostname)) return "";
    return u.toString().slice(0, 500);
  } catch {
    return "";
  }
};

const stripHtml = (html) => String(html || "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, " ")
  .trim();

async function braveSearch(q, key) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", q);
  url.searchParams.set("count", "8");
  const body = await fetchResponse(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key, "User-Agent": BROWSER_UA }
  }, 15000).then(async (res) => {
    if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
    return res.json();
  });
  const items = (body.web?.results || []).map((r, i) => ({
    id: `web:${i + 1}`,
    title: String(r.title || "").slice(0, 200),
    url: cleanUrl(r.url),
    snippet: String(r.description || "").slice(0, 400)
  })).filter((r) => r.url);
  return { provider: "Brave Search", items };
}

/** DuckDuckGo HTML (no key). Fragile; labeled as such. */
async function ddgSearch(q) {
  const url = new URL("https://html.duckduckgo.com/html/");
  const res = await fetchResponse(url, {
    method: "POST",
    headers: { "User-Agent": BROWSER_UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q }).toString()
  }, 15000);
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const items = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/gi;
  let m;
  while ((m = re.exec(html)) && items.length < 8) {
    const href = cleanUrl(decodeURIComponent(String(m[1]).replace(/.*uddg=/, "").replace(/&amp;/g, "&").split("&")[0]));
    if (!href) continue;
    items.push({
      id: `web:${items.length + 1}`,
      title: stripHtml(m[2]).slice(0, 200),
      url: href,
      snippet: stripHtml(m[3]).slice(0, 400)
    });
  }
  if (!items.length) {
    for (const hit of html.matchAll(/uddg=([^&"]+)/g)) {
      const href = cleanUrl(decodeURIComponent(hit[1]));
      if (!href || items.some((x) => x.url === href)) continue;
      items.push({ id: `web:${items.length + 1}`, title: href.replace(/^https?:\/\//, "").slice(0, 120), url: href, snippet: "" });
      if (items.length >= 8) break;
    }
  }
  return { provider: "DuckDuckGo HTML (unofficial, may change)", items };
}

/** Search the open web. Prefers Brave when BRAVE_SEARCH_API_KEY is set. */
export async function webSearch(db, q, env = process.env) {
  const query = String(q || "").trim().slice(0, 200);
  if (!query) return { ok: false, error: "q is required", items: [] };
  const key = cacheKey("search", query);
  const hit = readCache(db, key);
  if (hit) return hit;
  const started = Date.now();
  const brave = String(env.BRAVE_SEARCH_API_KEY || "").trim();
  try {
    const { provider, items } = brave ? await braveSearch(query, brave) : await ddgSearch(query);
    const out = {
      ok: items.length > 0,
      source: provider,
      asOf: new Date().toISOString(),
      latency: `Open-web search · cached ${TTL / 60000} min · fetched in ${Date.now() - started} ms. Not a TradeSimple filing.`,
      query,
      items,
      error: items.length ? "" : "No results."
    };
    if (out.ok) writeCache(db, key, out, TTL);
    return out;
  } catch (err) {
    return { ok: false, error: err?.message || "Search failed", source: brave ? "Brave Search" : "DuckDuckGo HTML", asOf: new Date().toISOString(), latency: `${Date.now() - started} ms`, query, items: [] };
  }
}

/** Fetch one public http(s) page and return stripped text for the model to cite. */
export async function webFetch(db, rawUrl) {
  const url = cleanUrl(rawUrl);
  if (!url) return { ok: false, error: "url must be a public http(s) address", items: [] };
  const key = cacheKey("fetch", url);
  const hit = readCache(db, key);
  if (hit) return hit;
  const started = Date.now();
  try {
    const res = await fetchResponse(url, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8" } }, 15000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ctype = String(res.headers.get("content-type") || "");
    const raw = await res.text();
    const text = (ctype.includes("html") ? stripHtml(raw) : String(raw)).slice(0, 6000);
    const title = ctype.includes("html") ? (stripHtml((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "") || url) : url;
    const out = {
      ok: Boolean(text),
      source: url,
      asOf: new Date().toISOString(),
      latency: `Fetched page body · cached ${TTL / 60000} min · ${Date.now() - started} ms. Not a TradeSimple filing.`,
      url,
      title: title.slice(0, 200),
      text,
      items: [{ id: "web:1", title: title.slice(0, 200), url, snippet: text.slice(0, 400) }]
    };
    if (out.ok) writeCache(db, key, out, TTL);
    return out;
  } catch (err) {
    return { ok: false, error: err?.message || "Fetch failed", source: url, asOf: new Date().toISOString(), latency: `${Date.now() - started} ms`, url, items: [] };
  }
}

/** Compact satellite/live-imagery summary for the model (no tile templates). */
export function summarizeSatellite(live, imagery) {
  const layers = (live?.layers || []).map((l) => {
    const last = (l.ranges || []).reduce((a, r) => Math.max(a, r.end || 0), 0);
    return {
      id: l.id || l.key,
      name: l.name,
      covers: l.covers,
      latestFrame: last ? new Date(last).toISOString() : "",
      ageNote: "GIBS posts geostationary frames about an hour after capture"
    };
  });
  return {
    ok: true,
    source: live?.source || imagery?.source || "NASA GIBS",
    asOf: live?.asOf || imagery?.asOf || new Date().toISOString(),
    latency: live?.latency || "Satellite frames are delayed; see ageNote per layer.",
    gap: live?.gap || "",
    live: layers,
    daily: live?.daily ? { name: live.daily.name, complete: live.daily.complete, end: live.daily.end } : null,
    basemaps: imagery?.layers ? Object.entries(imagery.layers).filter(([k]) => ["sat", "daily", "night"].includes(k)).map(([id, L]) => ({ id, source: L.source, asOf: L.asOf })) : []
  };
}

/** News items trimmed for the model. */
export function summarizeNews(wire, { q = "", desk = "", limit = 12 } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  const deskWant = String(desk || "").trim().toLowerCase();
  let items = Array.isArray(wire?.items) ? wire.items : [];
  if (deskWant) items = items.filter((r) => String(r.desk || "").toLowerCase() === deskWant || String(r.region || "").toLowerCase() === deskWant || String(r.feed || "").toLowerCase() === deskWant);
  if (needle) items = items.filter((r) => `${r.title} ${r.summary} ${(r.symbols || []).join(" ")}`.toLowerCase().includes(needle));
  return {
    ok: items.length > 0 || Boolean(wire?.ok),
    source: wire?.source || "RSS wires",
    asOf: wire?.asOf || "",
    latency: wire?.latency || "",
    feeds: (wire?.feeds || []).slice(0, 50).map((f) => ({ id: f.id, name: f.name, desk: f.desk, region: f.region, ok: f.ok, count: f.count })),
    errors: (wire?.errors || []).slice(0, 8),
    totalMatched: items.length,
    items: items.slice(0, limit).map((r) => ({
      title: r.title,
      source: r.source,
      desk: r.desk,
      region: r.region || "",
      published: r.published,
      link: r.link,
      symbols: r.symbols || [],
      summary: String(r.summary || "").slice(0, 240)
    }))
  };
}
