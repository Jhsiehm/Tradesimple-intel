/**
 * Web search and page fetch for Ask, behind one small adapter so the provider can be swapped. Keys are read from env
 * on the server and never returned. Provider, in order:
 *
 *   WEB_SEARCH_PROVIDER     explicit: openrouter | tavily | brave | off
 *   openrouter              OPENROUTER_API_KEY — OpenRouter's `web` plugin; results are its url_citation annotations
 *   tavily                  TAVILY_API_KEY
 *   brave                   BRAVE_API_KEY
 *
 * WEB_SEARCH_MODEL picks the cheap OpenRouter model that carries the plugin (default openai/gpt-4o-mini); its own
 * text is discarded, only the cited pages (url, title, page text excerpt) are kept.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { fetchJson, fetchResponse } from "../lib/http.mjs";
import { BROWSER_UA } from "../lib/ua.mjs";
import { WEB_CAPS, htmlToText, titleOf } from "../../shared/webAsk.mjs";

const clean = (v) => String(v ?? "").trim();
const KEYS = { openrouter: "OPENROUTER_API_KEY", tavily: "TAVILY_API_KEY", brave: "BRAVE_API_KEY" };
const VIA = { openrouter: "OpenRouter web search", tavily: "Tavily search API", brave: "Brave Search API" };

/** `{ provider, keyName, via, error }`; provider "" when nothing is configured. Never holds the key. */
export function webConfig(env = process.env) {
  const asked = clean(env.WEB_SEARCH_PROVIDER).toLowerCase();
  if (asked === "off" || asked === "none") return { provider: "", keyName: "", via: "", error: "Web search is turned off (WEB_SEARCH_PROVIDER=off)." };
  if (asked && !KEYS[asked]) return { provider: "", keyName: "", via: "", error: `WEB_SEARCH_PROVIDER must be one of ${Object.keys(KEYS).join(", ")}, or off.` };
  const order = asked ? [asked] : ["openrouter", "tavily", "brave"];
  const provider = order.find((p) => clean(env[KEYS[p]])) || "";
  if (!provider) {
    return { provider: "", keyName: "", via: "", error: asked ? `Web search is not configured: WEB_SEARCH_PROVIDER=${asked} needs ${KEYS[asked]} in .env.local.` : "Web search is not configured: add OPENROUTER_API_KEY (uses OpenRouter's web plugin), TAVILY_API_KEY, or BRAVE_API_KEY to .env.local." };
  }
  return { provider, keyName: KEYS[provider], via: VIA[provider], error: "" };
}

const snip = (s) => clean(s).replace(/\s+/g, " ").slice(0, WEB_CAPS.snippetChars);

/** OpenRouter chat body → results. Pure. */
export function openrouterResults(body) {
  const notes = body?.choices?.[0]?.message?.annotations || [];
  const out = [];
  for (const a of notes) {
    const c = a?.type === "url_citation" ? a.url_citation : null;
    if (!c?.url || out.some((r) => r.url === c.url)) continue;
    out.push({ url: c.url, title: clean(c.title).slice(0, 200), snippet: snip(c.content) });
  }
  return out;
}
export const tavilyResults = (body) => (body?.results || []).map((r) => ({ url: r.url, title: clean(r.title).slice(0, 200), snippet: snip(r.content), ...(r.published_date ? { published: r.published_date } : {}) }));
export const braveResults = (body) => (body?.web?.results || []).map((r) => ({ url: r.url, title: htmlToText(r.title, 200), snippet: snip(htmlToText([r.description, ...(r.extra_snippets || [])].join(" "))), ...(r.page_age ? { published: r.page_age } : {}) }));

async function search(cfg, key, query, max, timeoutMs, fetcher, env) {
  if (cfg.provider === "openrouter") {
    const body = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "X-Title": "TradeSimple Intel" },
      body: JSON.stringify({ model: clean(env.WEB_SEARCH_MODEL) || "openai/gpt-4o-mini", max_tokens: 60, plugins: [{ id: "web", max_results: max }], messages: [{ role: "user", content: `Search the web for: ${query}` }] })
    }, timeoutMs);
    return openrouterResults(body);
  }
  if (cfg.provider === "tavily") {
    const body = await fetcher("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ query, max_results: max, search_depth: "basic" }) }, timeoutMs);
    return tavilyResults(body);
  }
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(max));
  return braveResults(await fetcher(url, { headers: { Accept: "application/json", "X-Subscription-Token": key } }, timeoutMs));
}

/**
 * `{ ok, query, results: [{ url, title, snippet, published? }], via, retrievedAt, source, asOf, latency }`, or
 * `{ ok: false, error }`. `fetcher(url, options, timeoutMs)` is injectable for tests.
 */
export async function webSearch(query, { env = process.env, max = WEB_CAPS.results, timeoutMs = 20_000, fetcher = fetchJson, now = () => Date.now() } = {}) {
  const q = clean(query).slice(0, 200);
  if (!q) return { ok: false, error: "web_search needs a query." };
  const cfg = webConfig(env);
  if (!cfg.provider) return { ok: false, notConfigured: true, error: cfg.error, source: "web search (not configured)", asOf: "", latency: "" };
  const started = now();
  try {
    const results = (await search(cfg, clean(env[cfg.keyName]), q, Math.min(max, WEB_CAPS.results), timeoutMs, fetcher, env)).filter((r) => /^https?:\/\//.test(r.url)).slice(0, WEB_CAPS.results);
    const retrievedAt = new Date(now()).toISOString();
    if (!results.length) return { ok: false, error: `The web search for "${q}" returned no pages.`, source: `${cfg.via} (web, not a TradeSimple feed)`, asOf: retrievedAt, latency: `${now() - started} ms` };
    return { ok: true, query: q, results, via: cfg.via, retrievedAt, source: `${cfg.via} (web, not a TradeSimple feed)`, asOf: retrievedAt, latency: `Searched in ${now() - started} ms; result pages are as published, not verified by the app.` };
  } catch (err) {
    return { ok: false, error: `Web search failed (${cfg.via}): ${err?.status ? `HTTP ${err.status}` : err?.message || "error"}.`, source: `${cfg.via} (web, not a TradeSimple feed)`, asOf: "", latency: "" };
  }
}

/** Loopback, private, link-local, CGNAT, multicast and reserved addresses: never fetched. */
export function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
  }
  const s = ip.toLowerCase();
  if (s.startsWith("::ffff:")) return privateAddress(s.slice(7));
  return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
}

async function publicUrl(raw, lookup) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return { error: "Not a URL." }; }
  if (!/^https?:$/.test(u.protocol)) return { error: "Only http and https pages can be read." };
  if (u.username || u.password) return { error: "URLs with credentials are not read." };
  if (u.port && !["80", "443"].includes(u.port)) return { error: "Only the standard web ports are read." };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return { error: "Local hosts are not read." };
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) return { error: `Could not resolve ${host}.` };
  if (addrs.some((a) => privateAddress(a.address))) return { error: "Private and loopback addresses are not read." };
  return { url: u };
}

/**
 * One public page as text (scripts, styles and tags stripped; at most WEB_CAPS.pageChars). Redirects are followed by
 * hand, each hop re-checked, at most 3. `fetcher(url, options, timeoutMs)` returns a Response; injectable for tests.
 */
export async function webPage(rawUrl, { fetcher = fetchResponse, lookup = dns.lookup, now = () => Date.now(), timeoutMs = 12_000 } = {}) {
  const started = now();
  let target = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    const checked = await publicUrl(target, lookup);
    if (checked.error) return { ok: false, error: checked.error, url: String(target).slice(0, 300) };
    let res;
    try {
      res = await fetcher(checked.url, { redirect: "manual", headers: { "User-Agent": BROWSER_UA, Accept: "text/html,text/plain;q=0.9" } }, timeoutMs);
    } catch (err) {
      return { ok: false, error: `Page fetch failed: ${err?.name === "TimeoutError" ? "timed out" : err?.message || "error"}.`, url: checked.url.href };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      target = new URL(res.headers.get("location"), checked.url).href;
      continue;
    }
    if (!res.ok) return { ok: false, error: `Page fetch failed: HTTP ${res.status}.`, url: checked.url.href };
    const type = res.headers.get("content-type") || "";
    if (!/text\/(html|plain)|application\/xhtml/.test(type)) return { ok: false, error: `Not a text page (${type || "unknown type"}).`, url: checked.url.href };
    const html = (await res.text()).slice(0, 2_000_000);
    const retrievedAt = new Date(now()).toISOString();
    return { ok: true, url: checked.url.href, title: titleOf(html), text: /html/.test(type) ? htmlToText(html) : htmlToText(html.replace(/</g, "&lt;")), retrievedAt, fetchMs: now() - started };
  }
  return { ok: false, error: "Too many redirects.", url: String(rawUrl).slice(0, 300) };
}
