import { readFileSync } from "node:fs";
import { fetchJson, fetchText } from "./lib/http.mjs";
import { listTickers, readCache, writeCache } from "./lib/db.mjs";
import { BROWSER_UA } from "./lib/ua.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const FEEDS = [
  { id: "bbc", name: "BBC World", desk: "world", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { id: "guardian", name: "Guardian World", desk: "world", url: "https://www.theguardian.com/world/rss" },
  { id: "nyt", name: "NYT World", desk: "world", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { id: "wsj", name: "WSJ World", desk: "world", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml" },
  { id: "ft", name: "FT World", desk: "world", url: "https://www.ft.com/world?format=rss" },
  { id: "npr", name: "NPR World", desk: "world", url: "https://feeds.npr.org/1004/rss.xml" },
  { id: "aljazeera", name: "Al Jazeera", desk: "world", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { id: "dw", name: "DW", desk: "world", url: "https://rss.dw.com/rdf/rss-en-all" },
  { id: "france24", name: "France 24", desk: "world", url: "https://www.france24.com/en/rss" },
  { id: "sky", name: "Sky World", desk: "world", url: "https://feeds.skynews.com/feeds/rss/world.xml" },
  { id: "scmp", name: "SCMP", desk: "world", url: "https://www.scmp.com/rss/91/feed" },
  { id: "toi", name: "Times of India", desk: "world", url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms" },
  { id: "abc", name: "ABC Australia", desk: "world", url: "https://www.abc.net.au/news/feed/51120/rss.xml" },
  { id: "cnbc", name: "CNBC Top", desk: "markets", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { id: "cnbc-world", name: "CNBC World", desk: "markets", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html" },
  { id: "marketwatch", name: "MarketWatch", desk: "markets", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { id: "bbc-us", name: "BBC US & Canada", desk: "world", region: "americas", url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml" },
  { id: "bbc-latam", name: "BBC Latin America", desk: "world", region: "americas", url: "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml" },
  { id: "globe-mail", name: "Globe and Mail", desk: "world", region: "americas", url: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/world/" },
  { id: "batimes", name: "Buenos Aires Times", desk: "world", region: "americas", home: "Argentina", url: "https://www.batimes.com.ar/feed" },
  { id: "mercopress", name: "MercoPress", desk: "world", region: "americas", url: "https://en.mercopress.com/rss/" },
  { id: "bbc-europe", name: "BBC Europe", desk: "world", region: "europe", url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml" },
  { id: "politico-eu", name: "Politico Europe", desk: "world", region: "europe", home: "European Union", url: "https://www.politico.eu/feed/" },
  { id: "euronews", name: "Euronews", desk: "world", region: "europe", url: "https://www.euronews.com/rss" },
  { id: "kyiv", name: "Kyiv Independent", desk: "world", region: "easteurope", home: "Ukraine", url: "https://kyivindependent.com/news-archive/rss/" },
  { id: "moscowtimes", name: "Moscow Times", desk: "world", region: "easteurope", home: "Russia", url: "https://www.themoscowtimes.com/rss/news" },
  { id: "tass", name: "TASS (state media)", desk: "world", region: "easteurope", home: "Russia", url: "https://tass.com/rss/v2.xml" },
  { id: "bbc-me", name: "BBC Middle East", desk: "world", region: "mideast", url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml" },
  { id: "toi-israel", name: "Times of Israel", desk: "world", region: "mideast", home: "Israel", url: "https://www.timesofisrael.com/feed/" },
  { id: "arabnews", name: "Arab News", desk: "world", region: "mideast", home: "Saudi Arabia", url: "https://www.arabnews.com/rss.xml" },
  { id: "bbc-africa", name: "BBC Africa", desk: "world", region: "africa", url: "https://feeds.bbci.co.uk/news/world/africa/rss.xml" },
  { id: "allafrica", name: "AllAfrica", desk: "world", region: "africa", url: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf" },
  { id: "premium-times", name: "Premium Times", desk: "world", region: "africa", home: "Nigeria", url: "https://www.premiumtimesng.com/feed" },
  { id: "hindu", name: "The Hindu", desk: "world", region: "southasia", url: "https://www.thehindu.com/news/international/feeder/default.rss" },
  { id: "dawn", name: "Dawn", desk: "world", region: "southasia", home: "Pakistan", url: "https://www.dawn.com/feeds/home" },
  { id: "bbc-asia", name: "BBC Asia", desk: "world", region: "eastasia", url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml" },
  { id: "scmp-china", name: "SCMP China", desk: "world", region: "eastasia", home: "China", url: "https://www.scmp.com/rss/4/feed" },
  { id: "nikkei", name: "Nikkei Asia", desk: "world", region: "eastasia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { id: "japantimes", name: "Japan Times", desk: "world", region: "eastasia", home: "Japan", url: "https://www.japantimes.co.jp/feed/" },
  { id: "yonhap", name: "Yonhap", desk: "world", region: "eastasia", home: "South Korea", url: "https://en.yna.co.kr/RSS/news.xml" },
  { id: "taipeitimes", name: "Taipei Times", desk: "world", region: "eastasia", home: "Taiwan", url: "https://www.taipeitimes.com/xml/index.rss" },
  { id: "straitstimes", name: "Straits Times", desk: "world", region: "seasia", url: "https://www.straitstimes.com/news/asia/rss.xml" },
  { id: "cna", name: "CNA", desk: "world", region: "seasia", home: "Singapore", url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml" },
  { id: "bangkokpost", name: "Bangkok Post", desk: "world", region: "seasia", home: "Thailand", url: "https://www.bangkokpost.com/rss/data/topstories.xml" },
  { id: "guardian-au", name: "Guardian Australia", desk: "world", region: "oceania", home: "Australia", url: "https://www.theguardian.com/australia-news/rss" }
];

const PLACES = JSON.parse(readFileSync(new URL("../data/places.json", import.meta.url), "utf8")).map((place) => {
  const loose = [place.name, ...place.aliases].filter((a) => !(place.strict || []).includes(a));
  return {
    ...place,
    patterns: [
      ...loose.map((alias) => ({ alias, re: new RegExp(`(^|[^\\p{L}])${escape(alias)}(?=$|[^\\p{L}])`, "iu") })),
      ...(place.strict || []).map((alias) => ({ alias, re: new RegExp(`(^|[^\\p{L}])${escape(alias)}(?=$|[^\\p{L}])`, "u") }))
    ]
  };
});
const PLACE_BY_NAME = new Map(PLACES.map((p) => [p.name, p]));

const X_ACCOUNTS = ["Reuters", "AP", "business", "WSJ", "FT", "BBCBreaking", "AJEnglish", "CNBC", "markets", "ReutersBiz"];
const TTL = 5 * 60 * 1000;

export async function newsWire(db) {
  const hit = readCache(db, KEY.newsWire);
  if (hit) return hit;
  const tickers = listTickers(db);
  const errors = [];
  const items = [];
  const status = [];
  await Promise.all(FEEDS.map(async (feed) => {
    const started = Date.now();
    try {
      const xml = await fetchText(feed.url, { headers: { "User-Agent": BROWSER_UA, Accept: "application/rss+xml, application/xml" } }, 12000);
      const rows = parseRss(xml).slice(0, 25);
      for (const row of rows) {
        items.push({
          id: `${feed.id}:${hash(row.link || row.title)}`,
          source: feed.name,
          feed: feed.id,
          desk: feed.desk,
          title: row.title,
          link: row.link,
          published: row.published,
          stamped: row.stamped,
          summary: row.summary,
          region: feed.region || "",
          geo: locate(row.title, row.summary, feed),
          symbols: mentions(`${row.title} ${row.summary}`, tickers)
        });
      }
      status.push({ id: feed.id, name: feed.name, desk: feed.desk, region: feed.region || "global", count: rows.length, ms: Date.now() - started, ok: true });
    } catch (err) {
      errors.push(`${feed.name}: ${err.message}`);
      status.push({ id: feed.id, name: feed.name, desk: feed.desk, region: feed.region || "global", count: 0, ms: Date.now() - started, ok: false });
    }
  }));
  items.sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const result = {
    ok: items.length > 0,
    source: `${status.filter((s) => s.ok).length} RSS wires`,
    asOf: new Date().toISOString(),
    latency: "Publisher RSS, polled every five minutes. Headline time is the publisher's stamp.",
    errors,
    feeds: status.sort((a, b) => a.name.localeCompare(b.name)),
    items: dedupe(items).slice(0, 700)
  };
  if (items.length) writeCache(db, KEY.newsWire, result, TTL);
  return result;
}

export async function xWire(db) {
  const token = process.env.X_BEARER_TOKEN || "";
  if (!token) return socialWire(db);
  const hit = readCache(db, KEY.newsX);
  if (hit) return hit;
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", `(${X_ACCOUNTS.map((a) => `from:${a}`).join(" OR ")}) -is:retweet -is:reply`);
  url.searchParams.set("max_results", "60");
  url.searchParams.set("tweet.fields", "created_at,author_id,entities");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");
  const tickers = listTickers(db);
  try {
    const body = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } }, 15000);
    const users = new Map((body.includes?.users || []).map((u) => [u.id, u]));
    const items = (body.data || []).map((post) => {
      const user = users.get(post.author_id) || {};
      const link = post.entities?.urls?.[0]?.expanded_url || "";
      return {
        id: `x:${post.id}`,
        source: user.username ? `@${user.username}` : "X",
        feed: "x",
        desk: "x",
        title: String(post.text || "").replace(/https:\/\/t\.co\/\S+/g, "").trim(),
        link: link || `https://x.com/${user.username || "i"}/status/${post.id}`,
        post: `https://x.com/${user.username || "i"}/status/${post.id}`,
        published: post.created_at || "",
        summary: user.name || "",
        symbols: mentions(post.text || "", tickers)
      };
    });
    const result = {
      ok: true,
      source: "X API v2 recent search",
      asOf: new Date().toISOString(),
      latency: "Recent search, cached five minutes to stay inside the rate limit.",
      items
    };
    writeCache(db, KEY.newsX, result, TTL);
    return result;
  } catch (err) {
    return { ok: false, error: `X API ${err.message}`, source: "X API v2 recent search", items: [] };
  }
}

const X_GROUPS = JSON.parse(readFileSync(new URL("../data/xaccounts.json", import.meta.url), "utf8"));

async function trendsFor(path) {
  const html = await fetchText(`https://trends24.in/${path}`, { headers: { "User-Agent": BROWSER_UA } }, 15000);
  const cards = [...html.matchAll(/<h3 class=title data-timestamp=([\d.]+)>[^<]*<\/h3><ol class=trend-card__list>([\s\S]*?)<\/ol>/g)].slice(0, 3);
  const list = (block) => [...block.matchAll(/<a href="([^"]+)" class=trend-link>([^<]+)<\/a>/g)].map((m) => ({ name: decode(m[2]), url: m[1].replace("twitter.com", "x.com") }));
  const [now, prev] = cards;
  if (!now) return { asOf: null, items: [] };
  const before = new Set((prev ? list(prev[2]) : []).map((t) => t.name.toLowerCase()));
  return {
    asOf: new Date(Number(now[1]) * 1000).toISOString(),
    items: list(now[2]).slice(0, 30).map((t, i) => ({ ...t, rank: i + 1, fresh: prev ? !before.has(t.name.toLowerCase()) : false }))
  };
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function xTrends(db) {
  const hit = readCache(db, KEY.newsXTrends);
  if (hit) return hit;
  const started = Date.now();
  const tickers = listTickers(db);
  const byName = new Map(tickers.map((t) => [t.name.toLowerCase(), t.symbol]));
  const tag = (t) => {
    const cash = /^\$([A-Z.]{1,6})$/.exec(t.name)?.[1];
    const symbol = cash && tickers.some((x) => x.symbol === cash) ? cash : byName.get(t.name.toLowerCase().replace(/^#/, "")) || "";
    return { ...t, symbol };
  };
  const [us, world] = await Promise.all([
    trendsFor("united-states/").catch(() => ({ asOf: null, items: [], error: true })),
    trendsFor("").catch(() => ({ asOf: null, items: [], error: true }))
  ]);
  const out = {
    ok: us.items.length > 0 || world.items.length > 0,
    asOf: us.asOf || world.asOf || null,
    ms: Date.now() - started,
    us: { ...us, items: us.items.map(tag) },
    world: { ...world, items: world.items.map(tag) }
  };
  if (out.ok) writeCache(db, KEY.newsXTrends, out, 10 * 60 * 1000);
  return out;
}

export async function xPulse(db) {
  const [trends, posts] = await Promise.all([xTrends(db), xWire(db)]);
  return {
    ok: trends.ok,
    source: "trends24.in (hourly snapshots of X trending topics) · curated account list",
    asOf: trends.asOf || new Date().toISOString(),
    latency: `Trending lists are hourly snapshots published by trends24, typically up to an hour behind X · cached 10 min · fetched in ${trends.ms} ms. "New" means it was not on the previous hour's list. Symbols are joined only by exact company name or cashtag from data/tickers.json.`,
    trends: { us: trends.us, world: trends.world },
    accounts: X_GROUPS,
    posts
  };
}

const BSKY = [
  ["reuters.com", "Reuters"], ["apnews.com", "AP"], ["bloomberg.com", "business"], ["wsj.com", "WSJ"], ["cnbc.com", "CNBC"],
  ["marketwatch.com", "MarketWatch"], ["unusualwhales.bsky.social", "unusual_whales"], ["federalreserve.gov", "federalreserve"],
  ["nicktimiraos.bsky.social", "NickTimiraos"], ["nytimes.com", "nytimes"], ["washingtonpost.com", "washingtonpost"],
  ["economist.com", "TheEconomist"], ["aljazeera.com", "AJEnglish"], ["politico.com", "politico"], ["axios.com", "axios"],
  ["semafor.com", "semafor"], ["theguardian.com", "guardian"], ["npr.org", "NPR"]
];

async function bskyFeed(actor, xHandle, tickers) {
  const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${actor}&limit=15&filter=posts_no_replies`;
  const body = await fetchJson(url, { headers: { Accept: "application/json" } }, 10000);
  return (body?.feed || [])
    .filter((f) => !f.reason && f.post?.author?.handle === actor)
    .map(({ post }) => {
      const rkey = post.uri.split("/").pop();
      const ext = post.embed?.external || post.embed?.media?.external;
      const text = String(post.record?.text || "").trim();
      const title = text || ext?.title || "";
      return {
        id: `bsky:${rkey}`,
        source: `@${xHandle}`,
        via: "Bluesky",
        feed: "bsky",
        desk: "x",
        title: title.length > 280 ? `${title.slice(0, 277)}…` : title,
        link: ext?.uri || `https://bsky.app/profile/${actor}/post/${rkey}`,
        post: `https://bsky.app/profile/${actor}/post/${rkey}`,
        profile: `https://x.com/${xHandle}`,
        published: post.record?.createdAt ? new Date(post.record.createdAt).toISOString() : post.indexedAt,
        summary: `${post.author.displayName || actor} on Bluesky (${actor}) · same outlet as @${xHandle} on X${ext?.title && ext.title !== title ? ` · ${ext.title}` : ""}`,
        symbols: mentions(`${text} ${ext?.title || ""}`, tickers)
      };
    })
    .filter((i) => i.title);
}

async function truthFeed(tickers) {
  const xml = await fetchText("https://www.trumpstruth.org/feed", { headers: { "User-Agent": BROWSER_UA } }, 12000);
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const strip = (v) => decode(String(v || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  return blocks.slice(0, 30).map((b) => {
    const text = strip(/<description>([\s\S]*?)<\/description>/.exec(b)?.[1]) || strip(/<title>([\s\S]*?)<\/title>/.exec(b)?.[1]);
    const original = /<truth:originalUrl>([^<]+)</.exec(b)?.[1] || "";
    const link = /<link>([^<]+)</.exec(b)?.[1] || original;
    const t = Date.parse(/<pubDate>([^<]+)</.exec(b)?.[1] || "");
    return {
      id: `truth:${hash(link)}`,
      source: "@realDonaldTrump",
      via: "Truth Social",
      feed: "truth",
      desk: "x",
      title: text.length > 280 ? `${text.slice(0, 277)}…` : text,
      link: original || link,
      post: original || link,
      profile: "https://x.com/realDonaldTrump",
      published: Number.isFinite(t) ? new Date(t).toISOString() : "",
      summary: text.length > 280 ? text : "Donald Trump on Truth Social (archived by trumpstruth.org)",
      symbols: mentions(text, tickers)
    };
  }).filter((i) => i.title && !/^RT[: ]/.test(i.title));
}

async function socialWire(db) {
  const hit = readCache(db, KEY.newsSocial);
  if (hit) return hit;
  const started = Date.now();
  const tickers = listTickers(db);
  const feeds = [];
  const settle = async (name, via, fn) => {
    const t0 = Date.now();
    try {
      const items = await fn();
      feeds.push({ id: name, name, via, ok: true, count: items.length, ms: Date.now() - t0 });
      return items;
    } catch (err) {
      feeds.push({ id: name, name, via, ok: false, count: 0, ms: Date.now() - t0, error: err.message });
      return [];
    }
  };
  const [trends, truth, ...bsky] = await Promise.all([
    xTrends(db).catch(() => null),
    settle("@realDonaldTrump", "Truth Social", () => truthFeed(tickers)),
    ...BSKY.map(([actor, x]) => settle(`@${x}`, "Bluesky", () => bskyFeed(actor, x, tickers)))
  ]);
  const items = [...truth, ...bsky.flat()].sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0)).slice(0, 300);
  const newest = items[0]?.published;
  const result = {
    ok: items.length > 0,
    mode: "social",
    tokenMissing: "X_BEARER_TOKEN",
    source: "Bluesky public AppView (same outlets as their X accounts) · Truth Social via trumpstruth.org · X trending via trends24.in",
    asOf: new Date().toISOString(),
    latency: `No X API token, so X posts themselves are not readable (public X mirrors are bot-walled). These are the same accounts posting on Bluesky, usually within minutes of X, plus Trump's Truth Social posts from an unofficial archive (about 5–30 min behind). Cached 3 min · ${feeds.filter((f) => f.ok).length}/${feeds.length} accounts answered in ${Date.now() - started} ms${newest ? ` · newest post ${newest.slice(11, 16)} UTC` : ""}. Add X_BEARER_TOKEN to switch to X itself.`,
    feeds,
    trends: trends?.us?.items?.slice(0, 20) || [],
    trendsAsOf: trends?.us?.asOf || null,
    items
  };
  if (items.length) writeCache(db, KEY.newsSocial, result, 3 * 60 * 1000);
  return result;
}

export function parseRss(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/g) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) || [];
  return blocks.map((block) => {
    const link = tag(block, "link") || /<link[^>]*href="([^"]+)"/.exec(block)?.[1] || tag(block, "guid");
    const published = tag(block, "pubDate") || tag(block, "dc:date") || tag(block, "updated") || tag(block, "published");
    const t = Date.parse(published);
    return {
      title: clean(tag(block, "title")),
      link: clean(link),
      published: Number.isFinite(t) ? new Date(Math.min(t, Date.now())).toISOString() : "",
      stamped: Number.isFinite(t) && t > Date.now() + 10 * 60 * 1000 ? new Date(t).toISOString() : undefined,
      summary: clean(tag(block, "description") || tag(block, "summary")).slice(0, 360)
    };
  }).filter((row) => row.title);
}

function tag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? m[1] : "";
}

function clean(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function locate(title, summary, feed) {
  const find = (text) => {
    let best = null;
    for (const place of PLACES) {
      for (const { alias, re } of place.patterns) {
        const m = re.exec(text);
        if (!m) continue;
        const at = m.index + m[1].length;
        if (!best || at < best.at || (at === best.at && alias.length > best.alias.length)) best = { place, alias, at };
      }
    }
    return best;
  };
  const hit = find(title) || find(summary);
  if (hit) return { place: hit.place.name, lon: hit.place.lon, lat: hit.place.lat, region: hit.place.region, basis: `mentions "${hit.alias}"` };
  const home = feed.home && PLACE_BY_NAME.get(feed.home);
  if (home) return { place: home.name, lon: home.lon, lat: home.lat, region: home.region, basis: `${feed.name} home desk` };
  return null;
}

function mentions(text, tickers) {
  const hits = [];
  for (const ticker of tickers) {
    const names = ticker.core ? [ticker.name, ...(ticker.recipients || [])].filter((n) => n && n.length > 3) : [];
    const byName = names.some((name) => new RegExp(`\\b${escape(name)}\\b`, "i").test(text));
    const bySymbol = new RegExp(`(\\$${ticker.symbol}\\b|\\(${ticker.symbol}\\))`).test(text);
    if (byName || bySymbol) hits.push(ticker.symbol);
  }
  return hits;
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hash(value) {
  let h = 0;
  for (const char of String(value)) h = (h * 31 + char.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
