import { fetchJson, fetchText } from "./http.mjs";
import { listTickers, readCache, tickerBySymbol, writeCache } from "./db.mjs";
import { roster } from "./roster.mjs";
import { contractsFor } from "./corporate.mjs";
import { norm } from "../scripts/joins-match.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const USA = "https://api.usaspending.gov/api/v2";
const CONTRACT_TYPES = ["A", "B", "C", "D"];
const LATENCY = "USAspending prime contract actions by action date. Civilian agencies report within days; DoD actions are published about 90 days after award. Negative amounts are de-obligations.";
const FIELDS = ["Award ID", "Recipient Name", "Recipient UEI", "Action Date", "Transaction Amount", "Transaction Description", "Awarding Agency", "Awarding Sub Agency", "Mod", "generated_internal_id", "Primary Place of Performance", "NAICS"];

/** Exact normalized parent name → symbol, from data/tickers.json contractParents only. */
function parentIndex(db) {
  const map = new Map();
  for (const t of listTickers(db)) for (const p of t.contractParents || []) map.set(norm(p.name), t.symbol);
  return map;
}

/** "TX-12" → USAspending place-of-performance filter. At-large seats use the whole state. */
function placeFilter(code) {
  const m = /^([A-Z]{2})(?:-(\d{1,2}|AL))?$/.exec(String(code || "").toUpperCase());
  if (!m) return null;
  const loc = { country: "USA", state: m[1] };
  if (m[2] && m[2] !== "AL" && m[2] !== "00") loc.district_current = m[2].padStart(2, "0");
  return loc;
}

/**
 * Contract actions filtered by ticker (parent UEIs), place of performance (district or state), or member
 * (their district, or their state for senators). Every row links to its USAspending award page.
 */
export async function contractFeed(db, params) {
  const sort = params.sort === "largest" ? "largest" : "recent";
  const days = Math.min(365, Math.max(7, Number(params.days) || 90));
  const filters = { award_type_codes: CONTRACT_TYPES };
  const scope = {};
  if (params.member) {
    const id = String(params.member).toUpperCase();
    if (!/^[A-Z]\d{6}$/.test(id)) return { ok: false, error: "Unknown member id", items: [] };
    const people = await roster(db).catch(() => ({ items: [] }));
    const m = people.items.find((p) => p.bioguide === id);
    if (!m) return { ok: false, error: "Member is not in the current roster", items: [] };
    const code = m.chamber === "senate" || !m.district || m.district === "0" ? m.state : `${m.state}-${String(m.district).padStart(2, "0")}`;
    scope.member = { bioguide: id, name: m.name, chamber: m.chamber, party: m.party };
    params = { ...params, place: code };
  }
  if (params.symbol) {
    const t = tickerBySymbol(db, String(params.symbol));
    if (!t) return { ok: false, error: "Ticker is not in data/tickers.json", items: [] };
    const ueis = [...new Set((t.contractParents || []).map((p) => p.uei).filter(Boolean))];
    scope.symbol = t.symbol;
    scope.parents = [...new Set((t.contractParents || []).map((p) => p.name))];
    if (!ueis.length) return { ok: true, source: "USAspending.gov", asOf: new Date().toISOString(), latency: LATENCY, scope, note: `${t.symbol} has no USAspending parent recipient in data/tickers.json.`, items: [] };
    filters.recipient_search_text = ueis;
  }
  if (params.place) {
    const loc = placeFilter(params.place);
    if (!loc) return { ok: false, error: "Place must look like TX or TX-12", items: [] };
    filters.place_of_performance_locations = [loc];
    scope.place = loc.district_current ? `${loc.state}-${loc.district_current}` : loc.state;
  }
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY);
  filters.time_period = [{ start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) }];
  const key = `usa:feed:v1:${JSON.stringify([filters.recipient_search_text, filters.place_of_performance_locations, days, sort])}`;
  const hit = readCache(db, key);
  if (hit) return { ...hit, scope };
  const t0 = Date.now();
  const body = await fetchJson(`${USA}/search/spending_by_transaction/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters, fields: FIELDS, limit: 100, page: 1, sort: sort === "largest" ? "Transaction Amount" : "Action Date", order: "desc" })
  }, 60000);
  if (body?.detail) return { ok: false, error: String(body.detail).slice(0, 200), items: [] };
  const parents = parentIndex(db);
  const items = (body.results || []).map((r) => {
    const pop = r["Primary Place of Performance"] || {};
    const district = pop.state_code && pop.congressional_code ? `${pop.state_code}-${pop.congressional_code}` : pop.state_code || "";
    return {
      id: `award:${r.generated_internal_id || r["Award ID"]}:${r.internal_id || ""}`,
      award: r["Award ID"],
      recipient: r["Recipient Name"] || "",
      uei: r["Recipient UEI"] || "",
      symbol: scope.symbol || parents.get(norm(r["Recipient Name"])) || null,
      date: r["Action Date"] || "",
      amount: Number(r["Transaction Amount"]) || 0,
      mod: r.Mod || "",
      description: String(r["Transaction Description"] || "").slice(0, 240),
      agency: r["Awarding Agency"] || "",
      subAgency: r["Awarding Sub Agency"] || "",
      naics: r.NAICS?.description || "",
      place: [pop.city_name, district].filter(Boolean).join(" · "),
      district,
      link: r.generated_internal_id ? `https://www.usaspending.gov/award/${r.generated_internal_id}` : ""
    };
  });
  const result = {
    ok: true,
    source: "USAspending.gov prime contract transactions",
    asOf: new Date().toISOString(),
    latency: `${LATENCY} Fetched in ${((Date.now() - t0) / 1000).toFixed(1)} s.`,
    window: { days, from: filters.time_period[0].start_date, to: filters.time_period[0].end_date },
    sort,
    note: items.length === 100 ? "Showing the first 100 actions; narrow the window or switch sort to see others." : "",
    items
  };
  writeCache(db, key, result, 3 * HOUR);
  return { ...result, scope };
}

const board = { job: null, partial: null };

/**
 * Joined S&P 500 contractors ranked by last full fiscal-year obligations, with obligations as a share of
 * revenue where SEC XBRL revenue exists. Built in the background; partial results stream in.
 */
export function contractorBoard(db) {
  const hit = readCache(db, "usa:board:v2");
  if (hit) return Promise.resolve(hit);
  if (!board.job) {
    board.job = buildBoard(db)
      .then((res) => {
        if (res.items.length) writeCache(db, "usa:board:v2", res, 12 * HOUR);
        console.log(`contractor board: ${res.items.length} joined contractors`);
        return res;
      })
      .catch((err) => console.error("contractor board", err.message))
      .finally(() => { board.job = null; board.partial = null; });
  }
  return Promise.resolve(board.partial || { ok: true, building: true, source: "USAspending.gov · SEC XBRL", asOf: new Date().toISOString(), items: [], progress: { done: 0, total: 0 } });
}

async function buildBoard(db) {
  const all = listTickers(db);
  const constituents = all.filter((t) => t.index?.includes("SP500")).length;
  const tickers = all.filter((t) => (t.contractParents || []).length);
  const rows = [];
  let done = 0;
  const compose = (building) => {
    const items = [...rows].sort((a, b) => b.obligations - a.obligations);
    const fy = items.find((r) => r.fy)?.fy || null;
    const total = items.reduce((s, r) => s + (r.obligations > 0 ? r.obligations : 0), 0);
    const bySector = new Map();
    for (const r of items) {
      const cur = bySector.get(r.sector || "Other") || { sector: r.sector || "Other", obligations: 0, names: 0 };
      cur.obligations += Math.max(0, r.obligations);
      cur.names += 1;
      bySector.set(cur.sector, cur);
    }
    return {
      ok: true,
      building,
      source: "USAspending.gov prime contract obligations · SEC XBRL revenue",
      asOf: new Date().toISOString(),
      latency: "Obligations by federal fiscal year (Oct–Sep), last complete year; DoD actions post about 90 days late, so the newest year runs low for defense names. Revenue is the latest annual 10-K figure. Share = obligations ÷ revenue; fiscal years may differ by a few months. Only S&P 500 names with a USAspending parent in data/tickers.json are covered.",
      progress: { done, total: tickers.length },
      index: { name: "S&P 500", joined: tickers.length, constituents, fy, obligations: total },
      sectors: [...bySector.values()].sort((a, b) => b.obligations - a.obligations),
      items
    };
  };
  const queue = [...tickers];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const res = await contractsFor(db, t).catch(() => null);
      done += 1;
      if (res?.byYear) {
        const dep = res.dependence;
        const last = dep ? { fy: dep.fy, amount: dep.obligations } : res.byYear.filter((y) => y.fy < currentFy()).at(-1);
        rows.push({
          symbol: t.symbol,
          name: t.name,
          sector: t.sector,
          industry: t.industry,
          fy: last?.fy || null,
          obligations: last?.amount || 0,
          revenue: dep?.revenue || null,
          revenueFy: dep?.revenueFy || null,
          share: dep?.share ?? null,
          byYear: res.byYear,
          parents: (t.contractParents || []).length
        });
      }
      if (done % 10 === 0) board.partial = compose(true);
    }
  }));
  return compose(false);
}

function currentFy() {
  const d = new Date();
  return d.getUTCFullYear() + (d.getUTCMonth() >= 9 ? 1 : 0);
}

/** Department of War daily announcements of contracts ≥ $7.5M. Article text is blocked to automated clients, so this lists the days. */
export async function dodAnnouncements(db) {
  const hit = readCache(db, "dod:contracts:v1");
  if (hit) return hit;
  const t0 = Date.now();
  const xml = await fetchText("https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=20", { headers: { "User-Agent": "Mozilla/5.0" } }, 20000);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const tag = (name) => (new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(m[1])?.[1] || "").trim();
    const published = new Date(tag("pubDate"));
    return { id: tag("link"), title: tag("title"), link: tag("link"), published: Number.isNaN(published.getTime()) ? "" : published.toISOString() };
  }).filter((r) => r.link);
  const result = {
    ok: items.length > 0,
    source: "War.gov (Department of Defense) daily contract announcements",
    asOf: new Date().toISOString(),
    latency: `Posted around 5 p.m. ET each business day for awards of $7.5 million or more, months before the same actions reach USAspending. Fetched in ${((Date.now() - t0) / 1000).toFixed(1)} s.`,
    items
  };
  if (items.length) writeCache(db, "dod:contracts:v1", result, HOUR);
  return result;
}
