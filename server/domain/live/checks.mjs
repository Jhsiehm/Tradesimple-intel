import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tickerBySymbol, writeCache } from "../../lib/db.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { HOUR, MINUTE } from "../../lib/time.mjs";
import { secSubmissionsJson } from "../../feeds/sec.mjs";
import { yahooHeadlines } from "../../feeds/yahoo.mjs";
import { parseRss } from "../../news.mjs";
import { slimSubmissions } from "../positions/submissions.mjs";
import { form4, form4Rows } from "../positions/insiders.mjs";
import { whaleHoldings } from "../positions/whales.mjs";
import { congressTrades, refreshCongress } from "../positions/congress.mjs";
import { contractFeed } from "../../contracts.mjs";
import { lobbyingFor } from "../corporate/lobbying.mjs";
import { congressEvent, contractEvent, filingEvent, insiderEvents, lobbyingEvent, namesTicker, newsEvent, stakeEvent, whaleEvent } from "../../../shared/watchlist.mjs";
import { dedupeHeadlines, textHash } from "../../../shared/live.mjs";
import { nyDaysAgo } from "../../../shared/dates.mjs";
import { hasSeen, expireCache } from "./store.mjs";
import { makeSecFast, withSecFast } from "./secFast.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Form 4s parsed per issuer per pass; older unseen ones wait for the next pass. */
export const FORM4_PER_PASS = 10;
/** How far back a pass looks, by filed / posted / published date. Backfill uses the same window. */
const DAYS = { sec: 90, congress: 120, contracts: 90, lobbying: 365, news: 7 };
const STAKE_FORM = /^(SC |SCHEDULE )13[DG](\/A)?$/;

const defaults = {
  tickerOf: (db, symbol) => tickerBySymbol(db, symbol),
  submissions: (cik) => secSubmissionsJson(cik),
  readForm4: (db, cik, pick) => form4(db, cik, pick),
  storeSubs: (db, cik, body) => writeCache(db, KEY.secSubs(cik), slimSubmissions(body), 2 * HOUR),
  funds: () => JSON.parse(fs.readFileSync(path.join(root, "data", "whales.json"), "utf8")),
  whaleHoldings: (db) => whaleHoldings(db),
  expireWhales: (db) => expireCache(db, KEY.posWhales),
  congressTrades: (db) => congressTrades(db),
  refreshCongress: (db) => refreshCongress(db),
  contractFeed: (db, params) => contractFeed(db, params),
  lobbyingFor: (db, ticker, years, opts) => lobbyingFor(db, ticker, years, opts),
  headlines: async (symbol) => parseRss(await yahooHeadlines(symbol)),
  seen: (db, id, symbol) => hasSeen(db, id, symbol),
  env: process.env
};

const failure = (symbol, err) => ({ symbol, message: String(err?.message || err || "failed").slice(0, 200), status: err?.status || 0, retryAfterMs: err?.retryAfterMs || 0 });
const secLink = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${acc}-index.htm`;

/**
 * Check runners by id (shared/live.mjs LIVE_CHECKS). Each takes `{ db, symbols, fresh, state }` and resolves with
 * `{ events, ok, errors, note?, off?, state? }`: events in the shared/watchlist.mjs shape, `ok` the symbols that were
 * fully read. `fresh: false` (backfill of one new ticker) reads caches instead of forcing a refetch where that is costly.
 * Every dependency is injectable for tests.
 */
export function makeChecks(overrides = {}) {
  const d = { ...defaults, ...overrides };

  async function sec({ db, symbols }) {
    const from = nyDaysAgo(DAYS.sec);
    const events = [];
    const ok = [];
    const errors = [];
    const noCik = [];
    for (const symbol of symbols) {
      const t = d.tickerOf(db, symbol);
      if (!t?.cik) { noCik.push(symbol); ok.push(symbol); continue; }
      try {
        const body = await d.submissions(t.cik);
        d.storeSubs(db, t.cik, body);
        const r = body?.filings?.recent || {};
        let parsed = 0;
        for (let i = 0; i < (r.form || []).length; i += 1) {
          const filed = r.filingDate?.[i] || "";
          if (filed < from) break;
          const form = r.form[i];
          const accession = r.accessionNumber[i];
          const accepted = r.acceptanceDateTime?.[i] || "";
          const link = secLink(t.cik, accession);
          if (form === "4" || form === "4/A") {
            const id = `f4:${symbol}:${accession}`;
            if (d.seen(db, id, symbol) || parsed >= FORM4_PER_PASS) continue;
            parsed += 1;
            const pick = { accession, filed, doc: r.primaryDocument?.[i] || "" };
            const doc = await d.readForm4(db, t.cik, pick).catch(() => null);
            if (!doc) continue;
            const out = form4Rows(t, pick, doc);
            if (out.other || !out.rows.length) continue;
            for (const ev of insiderEvents(out.rows)) events.push({ ...ev, publishedAt: accepted || ev.publishedAt });
          } else if (/^8-K/.test(form)) {
            events.push(filingEvent({ symbol, accession, form, items: r.items?.[i] || "", reportDate: r.reportDate?.[i] || "", accepted, filed, link }));
          } else if (STAKE_FORM.test(form)) {
            events.push(stakeEvent({ symbol, accession, form, accepted, filed, link }));
          }
        }
        ok.push(symbol);
      } catch (err) {
        errors.push(failure(symbol, err));
      }
    }
    return { events, ok, errors, note: noCik.length ? `${noCik.join(", ")}: no SEC CIK in data/tickers.json` : "" };
  }

  async function whales({ db, symbols, fresh, state = {} }) {
    const known = { ...(state.known || {}) };
    const accepted = { ...(state.accepted || {}) };
    const errors = [];
    let changed = false;
    if (fresh) {
      for (const fund of d.funds()) {
        try {
          const body = await d.submissions(fund.cik);
          d.storeSubs(db, fund.cik, body);
          const r = body?.filings?.recent || {};
          const i = (r.form || []).findIndex((f) => f === "13F-HR" || f === "13F-HR/A");
          if (i < 0) continue;
          const acc = r.accessionNumber[i];
          if (r.acceptanceDateTime?.[i]) accepted[acc] = r.acceptanceDateTime[i];
          if (known[fund.cik] !== acc) { changed = true; known[fund.cik] = acc; }
        } catch (err) {
          errors.push(failure(fund.name, err));
        }
      }
      if (changed && state.known) d.expireWhales(db);
    }
    const res = await d.whaleHoldings(db);
    const want = new Set(symbols);
    const events = (res?.items || [])
      .filter((r) => want.has(r.symbol) && r.action !== "hold" && r.action !== "held")
      .map((r) => {
        const ev = whaleEvent(r);
        const acc = String(r.id).slice(4, -(r.symbol.length + 1));
        return { ...ev, publishedAt: accepted[acc] || ev.publishedAt };
      });
    const funds = d.funds().length;
    return {
      events,
      ok: res?.ok === false && !res?.items?.length ? [] : symbols,
      errors: res?.ok === false && !res?.items?.length ? [failure("13F board", res?.errors?.[0] || "13F holdings not built yet"), ...errors] : errors,
      note: `${funds} funds in data/whales.json; quarter-end holdings filed up to 45 days after quarter end${errors.length ? ` · ${errors.length} filers unreadable this pass` : ""}`,
      state: { known, accepted: Object.fromEntries(Object.entries(accepted).slice(-200)) }
    };
  }

  async function congress({ db, symbols, fresh }) {
    const res = fresh ? await d.refreshCongress(db) : await d.congressTrades(db);
    if (!res?.items?.length) throw new Error(res?.errors?.[0] || "No congressional trades loaded yet");
    const from = nyDaysAgo(DAYS.congress);
    const want = new Set(symbols);
    const events = res.items.filter((t) => want.has(t.symbol) && String(t.filed) >= from).map(congressEvent);
    return { events, ok: symbols, errors: [], note: res.building ? "House/Senate backfill still running" : "" };
  }

  async function contracts({ db, symbols, fresh }) {
    const events = [];
    const ok = [];
    const errors = [];
    const none = [];
    for (const symbol of symbols) {
      const t = d.tickerOf(db, symbol);
      if (!(t?.contractParents || []).length) { none.push(symbol); ok.push(symbol); continue; }
      try {
        const res = await d.contractFeed(db, { symbol, days: DAYS.contracts, sort: "recent", fresh });
        if (!res?.ok) throw new Error(res?.error || "USAspending did not answer");
        events.push(...(res.items || []).map((a) => contractEvent(a, symbol)));
        ok.push(symbol);
      } catch (err) {
        errors.push(failure(symbol, err));
      }
    }
    return { events, ok, errors, note: none.length ? `${none.join(", ")}: no USAspending parent in data/tickers.json` : "" };
  }

  async function lobbying({ db, symbols, fresh }) {
    if (!d.env.LDA_API_KEY) return { events: [], ok: [], errors: [], off: "LDA_API_KEY not set in .env.local" };
    const from = nyDaysAgo(DAYS.lobbying);
    const events = [];
    const ok = [];
    const errors = [];
    const none = [];
    for (const symbol of symbols) {
      const t = d.tickerOf(db, symbol);
      if (!(t?.ldaClients || []).length) { none.push(symbol); ok.push(symbol); continue; }
      try {
        const res = await d.lobbyingFor(db, t, 2, { currentTtlMs: fresh ? 50 * MINUTE : 0 });
        if (!res?.ok) throw new Error(res?.missing ? `${res.missing} not set` : "LDA.gov did not answer");
        if (res.unavailable?.length && !res.filings?.length) throw new Error(res.unavailable[0]);
        events.push(...(res.filings || []).filter((f) => String(f.posted) >= from).map((f) => lobbyingEvent(f, symbol)));
        ok.push(symbol);
      } catch (err) {
        errors.push(failure(symbol, err));
      }
    }
    return { events, ok, errors, note: none.length ? `${none.join(", ")}: no LDA client in data/tickers.json` : "" };
  }

  async function news({ db, symbols }) {
    const from = Date.now() - DAYS.news * 24 * HOUR;
    const events = [];
    const ok = [];
    const errors = [];
    for (const symbol of symbols) {
      try {
        const ticker = d.tickerOf(db, symbol) || { symbol };
        const items = dedupeHeadlines(await d.headlines(symbol)).filter((n) => (!n.published || Date.parse(n.published) >= from) && namesTicker(n, ticker));
        events.push(...items.map((n) => newsEvent({ ...n, id: textHash(n.link || n.title) }, symbol)));
        ok.push(symbol);
      } catch (err) {
        errors.push(failure(symbol, err));
      }
    }
    return { events, ok, errors };
  }

  const fast = makeSecFast({ tickerOf: d.tickerOf, readForm4: d.readForm4, seen: d.seen, ...d.secFast });
  return { sec: withSecFast(sec, fast), secSweep: sec, whales, congress, contracts, lobbying, news };
}