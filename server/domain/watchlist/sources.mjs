import { readCache, writeCache } from "../../lib/db.mjs";
import { readStale } from "../../lib/cache.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { MINUTE, DAY, MONTH } from "../../lib/time.mjs";
import { secJson, secText } from "../../feeds/sec.mjs";
import { sessionQuote, yahooHeadlines } from "../../feeds/yahoo.mjs";
import { parseSchedule13 } from "../../parsers/schedule13.mjs";
import { parseRss } from "../../news.mjs";
import { contractFeed } from "../../contracts.mjs";
import { congressTrades } from "../positions/congress.mjs";
import { insiderHistory } from "../positions/insiders.mjs";
import { whaleHoldings } from "../positions/whales.mjs";
import { secSubmissions, slimSubmissions } from "../positions/submissions.mjs";
import { lobbyingFor } from "../corporate/lobbying.mjs";
import { congressEvent, contractEvent, filingEvent, FEED_DAYS, insiderEvents, lobbyingEvent, newsEvent, stakeEvent, whaleEvent } from "../../../shared/watchlist.mjs";

/** Per-source windows by public date: quarterly feeds reach further back so the latest filing is never cut off. */
const WINDOW = { congress: FEED_DAYS, insiders: FEED_DAYS, whales: 200, stakes: 400, contracts: 90, lobbying: 400, filings: FEED_DAYS, news: 30 };
const STAKE_FORMS = /^(SC 13[DG]|SCHEDULE 13[DG])(\/A)?$/;
const MAX_STAKE_DOCS = 6;

const isoDaysAgo = (days, now = Date.now()) => new Date(now - days * DAY).toISOString().slice(0, 10);
const after = (days) => {
  const from = isoDaysAgo(days);
  return (e) => String(e.publishedAt || e.eventAt || "").slice(0, 10) >= from;
};

/** A board feed's answer within `ms`, else its last stored copy (any age) while the rebuild keeps going. */
async function boardOrStale(db, load, key, ms = 6000) {
  const job = load(db);
  job.catch(() => {});
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); timer.unref?.(); });
  const res = await Promise.race([job, late]).finally(() => clearTimeout(timer));
  if (res) return res;
  const stale = readStale(db, key);
  return stale ? { ...stale.value, staleNote: `Showing the copy stored ${new Date(stale.storedAt).toISOString().slice(0, 16).replace("T", " ")} UTC while the scan rebuilds.` } : { ok: false, items: [], building: true };
}

const status = (events, extra = {}) => ({ status: events.length ? "ok" : "empty", events, ...extra });

export async function congressSection(db, ticker) {
  const board = await boardOrStale(db, congressTrades, KEY.posCongress);
  if (board.building && !board.items?.length) return { status: "loading", source: "House Clerk PTRs · Senate eFD", latency: "", note: "The disclosure scan is still building after a restart.", events: [] };
  const events = (board.items || []).filter((r) => r.symbol === ticker.symbol).map(congressEvent).filter(after(WINDOW.congress));
  return status(events, {
    source: board.source || "House Clerk PTRs · Senate eFD",
    asOf: board.asOf,
    latency: `Periodic transaction reports are due within 45 days of the trade; lag = filed − traded, over 45 days is late. Last ${WINDOW.congress} days by filed date.`,
    note: board.staleNote || ""
  });
}

export async function insiderSection(db, ticker, deadlineMs) {
  if (!ticker.cik) return { status: "not-covered", source: "SEC EDGAR Form 4", latency: "", note: `${ticker.symbol} has no CIK in data/tickers.json.`, events: [] };
  const res = await insiderHistory(db, { tickers: [ticker], from: isoDaysAgo(WINDOW.insiders), perIssuer: 25, deadline: Date.now() + deadlineMs });
  const events = insiderEvents(res.items || []);
  const capped = res.coverage?.capped?.length ? " More Form 4s were filed in the window than the 25 read." : "";
  return status(events, {
    source: res.source,
    asOf: res.asOf,
    latency: `Form 4 is due two business days after the transaction; lag = filed − earliest transaction date. One event per filing. Last ${WINDOW.insiders} days.${capped}`,
    note: res.building ? `${res.filings?.pending || 0} filings still being read; they appear on the next refresh.` : (res.errors || []).join("; "),
    ...(res.building ? { building: true } : {})
  });
}

export async function whaleSection(db, ticker) {
  const board = await boardOrStale(db, whaleHoldings, KEY.posWhales);
  const rows = (board.items || []).filter((r) => r.symbol === ticker.symbol);
  const holders = rows.filter((r) => r.shares > 0).length;
  const events = rows.filter((r) => ["new", "add", "trim", "exit"].includes(r.action)).map(whaleEvent).filter(after(WINDOW.whales));
  return status(events, {
    source: board.source || "SEC EDGAR 13F-HR information tables",
    asOf: board.asOf,
    latency: "13F-HR is quarterly: quarter-end holdings filed up to 45 days after the quarter. Only the funds named in data/whales.json; change = this 13F vs the one before.",
    note: `${holders} tracked fund${holders === 1 ? "" : "s"} report a position.${board.staleNote ? ` ${board.staleNote}` : ""}`
  });
}

/** The issuer's EDGAR submissions; `maxAgeMs` forces a refetch of an older copy (the watch job keeps watched names fresh). */
export async function issuerFilings(db, cik, maxAgeMs = 0) {
  if (maxAgeMs) {
    const stale = readStale(db, KEY.secSubs(cik));
    if (!stale || Date.now() - stale.storedAt > maxAgeMs) {
      const slim = slimSubmissions(await secJson(`https://data.sec.gov/submissions/CIK${cik}.json`));
      writeCache(db, KEY.secSubs(cik), slim, 2 * 60 * MINUTE);
      return { subs: slim, storedAt: Date.now() };
    }
  }
  const subs = await secSubmissions(db, cik);
  return { subs, storedAt: readStale(db, KEY.secSubs(cik))?.storedAt || Date.now() };
}

/** Filings of `forms` from slim submissions, filed on or after `from`. */
export function pickFilings(subs, forms, from) {
  const r = subs?.filings?.recent || {};
  const out = [];
  for (let i = 0; i < (r.form || []).length; i += 1) {
    if (!forms.test(r.form[i]) || r.filingDate[i] < from) continue;
    out.push({ form: r.form[i], accession: r.accessionNumber[i], filed: r.filingDate[i], accepted: r.acceptanceDateTime?.[i] || "", reportDate: r.reportDate?.[i] || "", items: r.items?.[i] || "", doc: r.primaryDocument?.[i] || "" });
  }
  return out;
}

const indexLink = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${acc}-index.htm`;

async function coverPage(db, cik, f) {
  const key = KEY.sec13dg(f.accession);
  const hit = readCache(db, key);
  if (hit) return hit;
  const doc = f.doc.replace(/^xsl[^/]+\//, "");
  if (!/\.xml$/i.test(doc)) return null;
  const parsed = parseSchedule13(await secText(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession.replace(/-/g, "")}/${doc}`));
  writeCache(db, key, parsed, 6 * MONTH);
  return parsed;
}

const SEC_NOTE = (storedAt) => `EDGAR submissions list fetched ${new Date(storedAt).toISOString().slice(0, 16).replace("T", " ")} UTC (rechecked every 20 min for watched names, else 2 h).`;

export async function stakeSection(db, ticker, filings) {
  if (!ticker.cik) return { status: "not-covered", source: "SEC EDGAR", latency: "", note: `${ticker.symbol} has no CIK in data/tickers.json.`, events: [] };
  const { subs, storedAt } = await filings;
  const picks = pickFilings(subs, STAKE_FORMS, isoDaysAgo(WINDOW.stakes));
  const events = await Promise.all(picks.map(async (f, i) => {
    const cover = i < MAX_STAKE_DOCS ? await coverPage(db, ticker.cik, f).catch(() => null) : null;
    return stakeEvent({ ...f, symbol: ticker.symbol, person: cover?.person || "", eventDate: cover?.eventDate || "", percent: cover?.percent ?? null, shares: cover?.shares ?? null, link: indexLink(ticker.cik, f.accession) });
  }));
  return status(events, {
    source: "SEC EDGAR Schedule 13D / 13G (issuer submissions)",
    asOf: new Date(storedAt).toISOString(),
    latency: `13D is due 5 business days after crossing 5% (active); 13G within 45 days of quarter end for passive holders (5 business days for some). Lag = accepted − event date on the cover page. Last ${WINDOW.stakes} days. ${SEC_NOTE(storedAt)}`,
    note: picks.length > MAX_STAKE_DOCS ? `Names read for the newest ${MAX_STAKE_DOCS}; older rows show the form only.` : ""
  });
}

export async function filingSection(db, ticker, filings) {
  if (!ticker.cik) return { status: "not-covered", source: "SEC EDGAR 8-K", latency: "", note: `${ticker.symbol} has no CIK in data/tickers.json.`, events: [] };
  const { subs, storedAt } = await filings;
  const events = pickFilings(subs, /^8-K(\/A)?$/, isoDaysAgo(WINDOW.filings)).map((f) => filingEvent({ ...f, symbol: ticker.symbol, link: indexLink(ticker.cik, f.accession) }));
  return status(events, {
    source: "SEC EDGAR 8-K (issuer submissions)",
    asOf: new Date(storedAt).toISOString(),
    latency: `8-K is due 4 business days after the event; lag = EDGAR acceptance − report date. Last ${WINDOW.filings} days. ${SEC_NOTE(storedAt)}`
  });
}

export async function contractSection(db, ticker) {
  if (!(ticker.contractParents || []).some((p) => p.uei)) {
    return { status: "not-covered", source: "USAspending.gov", latency: "", note: `${ticker.symbol} has no USAspending parent recipient in data/tickers.json${ticker.joinBasis?.contracts ? ` (${ticker.joinBasis.contracts})` : ""}.`, events: [] };
  }
  const res = await contractFeed(db, { symbol: ticker.symbol, sort: "recent", days: WINDOW.contracts });
  if (!res.ok) return { status: "error", source: res.source || "USAspending.gov", asOf: res.asOf, latency: res.latency || "", note: res.error || "USAspending failed", events: [] };
  const events = (res.items || []).map((a) => contractEvent(a, ticker.symbol));
  return status(events, {
    source: res.source,
    asOf: res.asOf,
    latency: `${res.latency} USAspending has no publish date per action, so no disclosure lag is shown. Recipients: ${(res.scope?.parents || []).join(", ")}.`,
    note: [res.note].filter(Boolean).join(" ")
  });
}

export async function lobbyingSection(db, ticker) {
  if (!process.env.LDA_API_KEY) return { status: "not-configured", source: "LDA.gov", latency: "", note: "Lobbying feed not configured: LDA_API_KEY is not set in .env.local.", events: [] };
  if (!(ticker.ldaClients || []).length) return { status: "not-covered", source: "LDA.gov", latency: "", note: `${ticker.symbol} has no LDA client name in data/tickers.json.`, events: [] };
  const res = await lobbyingFor(db, ticker, 2);
  if (!res.ok) return { status: "not-configured", source: "LDA.gov", latency: "", note: "Lobbying feed not configured.", events: [] };
  const events = (res.filings || []).map((l) => lobbyingEvent(l, ticker.symbol)).filter(after(WINDOW.lobbying));
  return status(events, {
    source: res.source,
    asOf: res.asOf,
    latency: `${res.latency} Last ${WINDOW.lobbying} days by posted date.`,
    note: (res.unavailable || []).join("; ")
  });
}

const hash = (s) => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
};

export async function newsSection(db, ticker) {
  const key = KEY.watchNews(ticker.symbol);
  let cached = readCache(db, key);
  if (!cached) {
    const xml = await yahooHeadlines(ticker.symbol);
    cached = { fetchedAt: new Date().toISOString(), items: parseRss(xml).slice(0, 25).map((r) => ({ id: hash(r.link || r.title), title: r.title, link: r.link, published: r.published, summary: r.summary })) };
    writeCache(db, key, cached, 15 * MINUTE);
  }
  const events = cached.items.map((n) => newsEvent(n, ticker.symbol)).filter(after(WINDOW.news));
  return status(events, {
    source: `Yahoo Finance headline RSS for ${ticker.symbol}`,
    asOf: cached.fetchedAt,
    latency: "Publisher time stamps; Yahoo's symbol feed holds about the newest 20 headlines and can include market-wide stories that mention the ticker. Refetched every 15 min. Material company events are in the 8-K section."
  });
}

/** Delayed last price and day change (Yahoo chart API), cached two minutes. */
export async function watchQuote(db, ticker) {
  const key = KEY.watchQuote(ticker.symbol);
  const hit = readCache(db, key);
  if (hit) return hit;
  const q = await sessionQuote(ticker);
  const out = q
    ? { ok: true, last: q.last, change: q.change, changePct: q.changePct, asOf: q.asOf, fetchedAt: new Date().toISOString(), source: "Yahoo Finance chart API", latency: "Delayed: US exchange quotes on Yahoo lag up to 15 min; as-of is Yahoo's last trade time." }
    : { ok: false, source: "Yahoo Finance chart API", error: "No quote" };
  writeCache(db, key, out, 2 * MINUTE);
  return out;
}
