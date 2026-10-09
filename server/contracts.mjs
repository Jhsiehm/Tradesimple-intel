import { fetchText } from "./lib/http.mjs";
import { usaspendingSearch } from "./feeds/usaspending.mjs";
import { listTickers, readCache, tickerBySymbol, writeCache } from "./lib/db.mjs";
import { roster } from "./roster.mjs";
import { contractsFor } from "./corporate.mjs";
import { norm } from "../shared/names.mjs";
import { STATES, memberPlace, parseDistrict } from "../shared/districts.mjs";
import { HOUR, DAY } from "./lib/time.mjs";
import { BROWSER_UA } from "./lib/ua.mjs";
import { KEY } from "./lib/cacheKeys.mjs";
import { readStale } from "./lib/cache.mjs";

const CONTRACT_TYPES = ["A", "B", "C", "D"];
const LATENCY = "USAspending prime contract actions by action date. Civilian agencies report within days; DoD actions are published about 90 days after award. Negative amounts are de-obligations.";
const FIELDS = ["Award ID", "Recipient Name", "Recipient UEI", "Action Date", "Transaction Amount", "Transaction Description", "Awarding Agency", "Awarding Sub Agency", "Mod", "generated_internal_id", "Primary Place of Performance", "NAICS"];

/** Exact normalized parent name → symbol, from data/tickers.json contractParents only. */
function parentIndex(db) {
  const map = new Map();
  for (const t of listTickers(db)) for (const p of t.contractParents || []) map.set(norm(p.name), t.symbol);
  return map;
}

/** Unique list keys. One award has many modifications in a window, so the award id alone repeats. */
export function keyed(items) {
  const seen = new Map();
  return items.map((a) => {
    const base = `award:${(a.link || "").split("/award/")[1] || a.award}:${a.mod || ""}:${a.date || ""}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...a, id: n === 1 ? base : `${base}:${n}` };
  });
}

/** "TX-12" or "TX" → USAspending place-of-performance filter. At-large seats use the whole state. */
function placeFilter(code) {
  const raw = String(code || "").toUpperCase();
  if (STATES[raw]) return { country: "USA", state: raw };
  const seat = parseDistrict(raw);
  if (!seat) return null;
  const [state, num] = seat.split("-");
  return num === "AL" ? { country: "USA", state } : { country: "USA", state, district_current: num };
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
    const code = memberPlace(m);
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
  const key = KEY.usaFeed([filters.recipient_search_text, filters.place_of_performance_locations, days, sort]);
  const hit = readCache(db, key);
  if (hit) return { ...hit, items: keyed(hit.items || []), scope };
  const t0 = Date.now();
  let body;
  try {
    body = await usaspendingSearch("spending_by_transaction", { filters, fields: FIELDS, limit: 100, page: 1, sort: sort === "largest" ? "Transaction Amount" : "Action Date", order: "desc" }, { timeoutMs: 45000, retries: 1, priority: true });
  } catch (err) {
    const stale = readStale(db, key);
    if (stale) return { ...stale.value, items: keyed(stale.value.items || []), scope, note: `USAspending is not answering (${err.message}); showing actions fetched ${new Date(stale.storedAt).toISOString().slice(0, 16).replace("T", " ")} UTC.` };
    return { ok: false, source: "USAspending.gov prime contract transactions", asOf: new Date().toISOString(), latency: LATENCY, error: `Contract feed: ${err.message}. Try again, or narrow the window.`, scope, items: [] };
  }
  if (body?.detail) return { ok: false, error: String(body.detail).slice(0, 200), items: [] };
  const parents = parentIndex(db);
  const items = keyed((body.results || []).map((r) => {
    const pop = r["Primary Place of Performance"] || {};
    const district = pop.state_code && pop.congressional_code ? `${pop.state_code}-${pop.congressional_code}` : pop.state_code || "";
    return {
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
  }));
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

const BOARD_KEY = KEY.usaBoard;
const BOARD_LATENCY = "Obligations by federal fiscal year (Oct–Sep), last complete year; DoD actions post about 90 days late, so the newest year runs low for defense names. Revenue is the latest annual 10-K figure. Share = obligations ÷ revenue; fiscal years may differ by a few months. Only S&P 500 names with a USAspending parent in data/tickers.json are covered.";
const BOARD_COOLDOWN = 2 * 60 * 1000;
const OUTAGE_STREAK = 8;
const board = { job: null, partial: null, error: null, failedAt: 0 };

/**
 * Joined S&P 500 contractors ranked by last full fiscal-year obligations, with obligations as a share of
 * revenue where SEC XBRL revenue exists. Never waits on USAspending: a fresh cache returns as is; otherwise a
 * background build starts and the response is the last good board (or what has loaded so far) with
 * `building` and `progress`, so the client polls.
 */
export function contractorBoard(db) {
  const hit = readCache(db, BOARD_KEY);
  if (hit) return Promise.resolve(hit);
  const stale = readStale(db, BOARD_KEY)?.value || null;
  const cooling = board.error && Date.now() - board.failedAt < BOARD_COOLDOWN;
  if (!board.job && !cooling) {
    board.error = null;
    const t0 = Date.now();
    board.job = buildBoard(db, stale, (res) => { board.partial = res; })
      .then((res) => {
        if (res.items.length) writeCache(db, BOARD_KEY, res, res.progress.failed ? 2 * HOUR : DAY);
        else throw new Error(res.progress.failed ? `USAspending failed for all ${res.progress.failed} contractors. ${res.note}` : "USAspending returned no contractor obligations.");
        console.log(`contractor board: ${res.items.length} contractors, ${res.progress.failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      })
      .catch((err) => {
        board.error = err.message;
        board.failedAt = Date.now();
        console.error("contractor board", err.message);
      })
      .finally(() => { board.job = null; board.partial = null; });
  }
  if (board.partial) return Promise.resolve(board.partial);
  const total = listTickers(db).filter((t) => (t.contractParents || []).length).length;
  const base = stale
    ? { ...stale, building: true, progress: { done: 0, total, failed: 0 }, note: `Refreshing; showing the board from ${stale.asOf?.slice(0, 16).replace("T", " ")} UTC.` }
    : { ok: true, building: true, source: "USAspending.gov prime contract obligations · SEC XBRL revenue", asOf: new Date().toISOString(), latency: BOARD_LATENCY, items: [], progress: { done: 0, total, failed: 0 } };
  if (!board.job && board.error) {
    const retryIn = Math.max(0, Math.ceil((BOARD_COOLDOWN - (Date.now() - board.failedAt)) / 1000));
    return Promise.resolve({ ...base, ok: !!stale, building: false, error: `${board.error} Retrying in ${retryIn} s.` });
  }
  return Promise.resolve(base);
}

/** Start or refresh the board in the background. Safe to call repeatedly; a fresh cache is a no-op. */
export function warmContracts(db) {
  contractorBoard(db);
  dodAnnouncements(db).catch((err) => console.error("dod warm", err.message));
}

/** One board row from a contractsFor result, or null when USAspending had no fiscal-year data. */
export function boardRow(t, res, fyNow = currentFy()) {
  if (!res?.byYear) return null;
  const dep = res.dependence;
  const last = dep ? { fy: dep.fy, amount: dep.obligations } : res.byYear.filter((y) => y.fy < fyNow).at(-1);
  return {
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
  };
}

/** Fetch order: largest prior obligations first, so the top of the board fills in first. Unknown names last. */
export function boardOrder(tickers, prior) {
  const rank = new Map((prior?.items || []).map((r) => [r.symbol, r.obligations || 0]));
  return [...tickers].sort((a, b) => (rank.get(b.symbol) ?? -1) - (rank.get(a.symbol) ?? -1) || a.symbol.localeCompare(b.symbol));
}

/** Board payload from the rows loaded so far. Pure apart from the timestamp. */
export function composeBoard({ rows, building, done, total, failed = [], constituents, note = "" }) {
  const items = [...rows].sort((a, b) => b.obligations - a.obligations);
  const fy = items.find((r) => r.fy)?.fy || null;
  const obligations = items.reduce((s, r) => s + (r.obligations > 0 ? r.obligations : 0), 0);
  const bySector = new Map();
  for (const r of items) {
    const cur = bySector.get(r.sector || "Other") || { sector: r.sector || "Other", obligations: 0, names: 0 };
    cur.obligations += Math.max(0, r.obligations);
    cur.names += 1;
    bySector.set(cur.sector, cur);
  }
  const failedNote = failed.length ? `${failed.length} contractor${failed.length > 1 ? "s" : ""} failed to load from USAspending (${failed.slice(0, 6).join(", ")}${failed.length > 6 ? ", …" : ""}); retrying within two hours.` : "";
  return {
    ok: true,
    building,
    source: "USAspending.gov prime contract obligations · SEC XBRL revenue",
    asOf: new Date().toISOString(),
    latency: BOARD_LATENCY,
    note: [note, failedNote].filter(Boolean).join(" "),
    progress: { done, total, failed: failed.length },
    index: { name: "S&P 500", joined: total, constituents, fy, obligations },
    sectors: [...bySector.values()].sort((a, b) => b.obligations - a.obligations),
    items
  };
}

async function buildBoard(db, stale, publish) {
  const all = listTickers(db);
  const constituents = all.filter((t) => t.index?.includes("SP500")).length;
  const tickers = all.filter((t) => (t.contractParents || []).length);
  const staleRows = new Map((stale?.items || []).map((r) => [r.symbol, r]));
  const fresh = new Map();
  const failed = new Map();
  const pending = [];
  for (const t of tickers) {
    const res = await contractsFor(db, t, { cachedOnly: true });
    const row = boardRow(t, res);
    if (row) fresh.set(t.symbol, row);
    else if (!res) pending.push(t);
  }
  const compose = (building) => {
    const rows = tickers.map((t) => fresh.get(t.symbol) || (building || failed.has(t.symbol) ? staleRows.get(t.symbol) : null)).filter(Boolean);
    const done = tickers.length - pending.length;
    const note = building && staleRows.size ? "Refreshing; names not yet reloaded show the previous build." : "";
    return composeBoard({ rows, building, done, total: tickers.length, failed: [...failed.keys()], constituents, note });
  };
  let lastPublish = 0;
  const tick = (force) => {
    if (!force && Date.now() - lastPublish < 1000) return;
    lastPublish = Date.now();
    publish(compose(true));
  };
  tick(true);
  let streak = 0;
  let outage = "";
  const run = async (list, workers) => {
    const queue = boardOrder(list, stale);
    await Promise.all(Array.from({ length: workers }, async () => {
      while (queue.length && !outage) {
        const t = queue.shift();
        try {
          const row = boardRow(t, await contractsFor(db, t));
          if (row) fresh.set(t.symbol, row);
          failed.delete(t.symbol);
          streak = 0;
        } catch (err) {
          failed.set(t.symbol, err.message);
          if (++streak >= OUTAGE_STREAK) outage = err.message;
        }
        if (pending.includes(t)) pending.splice(pending.indexOf(t), 1);
        tick(false);
      }
    }));
  };
  await run(pending.slice(), 2);
  const retry = tickers.filter((t) => failed.has(t.symbol));
  if (retry.length && !outage) await run(retry, 2);
  if (outage) throw new Error(`USAspending stopped answering after ${fresh.size} of ${tickers.length} contractors loaded (${OUTAGE_STREAK} failures in a row). Last error: ${outage}.`);
  if (failed.size) console.error(`contractor board: ${failed.size} failed, e.g. ${[...failed.values()][0]}`);
  return compose(false);
}

function currentFy() {
  const d = new Date();
  return d.getUTCFullYear() + (d.getUTCMonth() >= 9 ? 1 : 0);
}

/** Department of War daily announcements of contracts ≥ $7.5M. Article text is blocked to automated clients, so this lists the days. */
export async function dodAnnouncements(db) {
  const hit = readCache(db, KEY.dodContracts);
  if (hit) return hit;
  const t0 = Date.now();
  const SOURCE = "War.gov (Department of Defense) daily contract announcements";
  let xml;
  try {
    xml = await fetchText("https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=20", { headers: { "User-Agent": BROWSER_UA } }, 20000);
  } catch (err) {
    const why = err.name === "AbortError" ? "did not answer within 20 s" : err.message;
    const stale = readStale(db, KEY.dodContracts);
    if (stale) return { ...stale.value, note: `War.gov RSS ${why}; showing the list fetched ${new Date(stale.storedAt).toISOString().slice(0, 16).replace("T", " ")} UTC.` };
    return { ok: false, source: SOURCE, asOf: new Date().toISOString(), latency: "Posted around 5 p.m. ET each business day for awards of $7.5 million or more.", error: `War.gov RSS ${why}.`, items: [] };
  }
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const tag = (name) => (new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(m[1])?.[1] || "").trim();
    const published = new Date(tag("pubDate"));
    return { id: tag("link"), title: tag("title"), link: tag("link"), published: Number.isNaN(published.getTime()) ? "" : published.toISOString() };
  }).filter((r) => r.link);
  const result = {
    ok: items.length > 0,
    ...(items.length ? {} : { error: "War.gov RSS returned no announcements." }),
    source: SOURCE,
    asOf: new Date().toISOString(),
    latency: `Posted around 5 p.m. ET each business day for awards of $7.5 million or more, months before the same actions reach USAspending. Fetched in ${((Date.now() - t0) / 1000).toFixed(1)} s.`,
    items
  };
  if (items.length) writeCache(db, KEY.dodContracts, result, HOUR);
  return result;
}
