import { coreKey, listCore, readCache, writeCache } from "../../lib/db.mjs";
import { secText } from "../../feeds/sec.mjs";
import { once } from "../../lib/once.mjs";
import { pool } from "../../lib/pool.mjs";
import { HOUR, MINUTE, MONTH } from "../../lib/time.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { parseForm4 } from "../../parsers/form4.mjs";
import { lagDays } from "../../parsers/dates.mjs";
import { secSubmissions } from "./submissions.mjs";
import { STORE_SOURCE, storeReady, storeRows } from "./insiderStore.mjs";

const FORM4_CODES = {
  P: "buy",
  S: "sell",
  A: "award",
  M: "exercise",
  F: "tax",
  G: "gift",
  D: "disposed",
  C: "conversion",
  X: "exercise"
};

/** Form 4s read per issuer for a backtest window, newest first. The board keeps its latest eight. */
export const HISTORY_PER_ISSUER = 60;

const sameCik = (a, b) => Number(a) > 0 && Number(a) === Number(b);

/**
 * One filing's lines as rows of `ticker`, or `other: true` when the form's issuer is another company: a join-table
 * company that files as the owner of someone else's shares (Berkshire buying Lennar) is not trading its own stock.
 * The other company's trades are read from its own submissions when it is in data/tickers.json; no symbol is guessed.
 */
export function form4Rows(ticker, pick, parsed) {
  if (parsed.issuerCik && !sameCik(parsed.issuerCik, ticker.cik)) return { rows: [], other: true };
  const rows = parsed.lines.map((line, i) => ({
    id: `f4-${ticker.symbol}-${pick.accession}-${i}`,
    accession: pick.accession,
    symbol: ticker.symbol,
    person: parsed.owner,
    title: parsed.title,
    code: line.code,
    side: FORM4_CODES[line.code] || line.code,
    shares: line.shares,
    price: line.price,
    value: line.shares && line.price ? Math.round(line.shares * line.price) : null,
    owned: line.owned,
    plan: Boolean(line.plan),
    traded: line.date,
    filed: pick.filed,
    lag: lagDays(line.date, pick.filed),
    link: `https://www.sec.gov/Archives/edgar/data/${Number(ticker.cik)}/${pick.accession.replace(/-/g, "")}/${pick.accession}-index.htm`
  }));
  return { rows, other: false };
}

/** Form 4 filings in a submissions list, newest first, filed within [from, to] when given. */
export function form4Picks(subs, { from = "", to = "", max = 8 } = {}) {
  const recent = subs?.filings?.recent || {};
  const picks = [];
  let listed = 0;
  for (let i = 0; i < (recent.form || []).length; i += 1) {
    if (recent.form[i] !== "4") continue;
    const filed = recent.filingDate[i];
    if (to && filed > to) continue;
    if (from && filed < from) continue;
    listed += 1;
    if (picks.length < max) picks.push({ accession: recent.accessionNumber[i], filed, doc: recent.primaryDocument[i] });
  }
  return { picks, listed, listStarts: subs?.complete === false ? subs.listStarts || "" : "" };
}

export function insiderTrades(db) {
  return once("insider-trades", async () => {
    const key = KEY.posInsiders(coreKey(db));
    const hit = readCache(db, key);
    if (hit) return hit;
    const tickers = listCore(db).filter((t) => t.cik);
    const rows = [];
    const errors = [];
    const scanned = [];
    let otherIssuer = 0;
    await pool(tickers, 2, async (ticker) => {
      try {
        const subs = await secSubmissions(db, ticker.cik);
        for (const pick of form4Picks(subs).picks) {
          const parsed = await form4(db, ticker.cik, pick).catch(() => null);
          if (!parsed) continue;
          const out = form4Rows(ticker, pick, parsed);
          if (out.other) otherIssuer += 1;
          rows.push(...out.rows);
        }
        scanned.push(ticker.symbol);
      } catch (err) {
        errors.push(`${ticker.symbol}: ${err.message}`);
      }
    });
    rows.sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || String(b.traded).localeCompare(String(a.traded)));
    const result = {
      ok: rows.length > 0,
      source: "SEC EDGAR Form 4 (issuer submissions)",
      asOf: new Date().toISOString(),
      latency: `Form 4 is due two business days after the trade. Rows are the latest eight Form 4s per join-table issuer. Code P is an open-market buy, S a sale, A a grant, F tax withholding.${otherIssuer ? ` ${otherIssuer} forms a join-table company filed as the owner of another company's shares are left out of its rows.` : ""}${errors.length ? ` ${errors.length} of ${tickers.length} issuers could not be read this pass.` : ""}`,
      errors,
      scanned: scanned.sort(),
      items: rows
    };
    // A pass with failed issuers is kept briefly so the next ask retries them instead of serving half a board for hours.
    if (rows.length) writeCache(db, key, result, errors.length ? 10 * MINUTE : 2 * HOUR);
    return result;
  });
}

const reading = new Map();

/** One parsed Form 4, cached for six months. Concurrent asks for the same accession share one fetch. */
export function form4(db, cik, pick) {
  const key = KEY.secForm4(pick.accession);
  const hit = readCache(db, key);
  if (hit) return Promise.resolve(hit);
  if (reading.has(key)) return reading.get(key);
  const job = (async () => {
    const raw = String(pick.doc || "").replace(/^xslF345X\d+\//, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${pick.accession.replace(/-/g, "")}/${raw}`;
    const parsed = parseForm4(await secText(url));
    writeCache(db, key, parsed, 6 * MONTH);
    return parsed;
  })().finally(() => reading.delete(key));
  reading.set(key, job);
  return job;
}

/** Most rows one window answer carries; `totals` count the whole window. */
export const WINDOW_ROWS = 2000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every Form 4 line filed in [from, to] from the insider store (plus live reads after its coverage), newest first,
 * for Ask's dated questions. Without a backfilled store it is the board (latest eight Form 4s per issuer).
 */
export async function insiderWindow(db, { from = "", to = "" } = {}) {
  const lo = ISO_DAY.test(from) ? from : "";
  const hi = ISO_DAY.test(to) ? to : "";
  if (!storeReady(db) || (!lo && !hi)) return insiderTrades(db);
  const res = await insiderHistory(db, { from: lo, to: hi, deadline: Date.now() + 15_000 });
  const distinct = (k) => new Set(res.items.map((r) => r[k]).filter(Boolean)).size;
  const { coverageNote, store, ...rest } = res;
  return {
    ...rest,
    ok: true,
    latency: `${res.latency} ${coverageNote}`,
    items: res.items.slice(0, WINDOW_ROWS),
    totals: { transactionLines: res.items.length, forms: distinct("accession"), issuers: distinct("symbol"), insiders: distinct("person") },
    truncated: res.items.length > WINDOW_ROWS,
    history: store
  };
}

const dayAfter = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Form 4 rows filed in [from, to] for join-table issuers (`symbols` narrows them), newest first. Once the insider
 * store is backfilled it answers for every filing through its `coveredThrough` day, with no per-issuer cap; only
 * filings after that are read live from issuer submissions. With no store it is the submissions path alone.
 */
export async function insiderHistory(db, opts = {}) {
  const symbols = new Set(opts.symbols || []);
  const list = (opts.tickers || listCore(db)).filter((t) => t.cik && (!symbols.size || symbols.has(t.symbol)));
  const store = opts.store === false || !db ? null : storeReady(db);
  if (!store) return submissionsHistory(db, { ...opts, tickers: list });
  const { from = "", to = "" } = opts;
  const stored = storeRows(db, { from, to: to && to < store.coveredThrough ? to : store.coveredThrough, symbols: list.map((t) => t.symbol) });
  const liveFrom = from > store.coveredThrough ? from : dayAfter(store.coveredThrough);
  const tail = to && to < liveFrom ? null : await submissionsHistory(db, { ...opts, from: liveFrom, tickers: list });
  const known = new Set(stored.items.map((r) => r.accession));
  const fresh = (tail?.items || []).filter((r) => !known.has(r.accession));
  const items = [...stored.items, ...fresh].sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || String(b.traded).localeCompare(String(a.traded)));
  const forms = known.size;
  const early = from && from < store.coveredFrom;
  const live = tail ? ` Form 4s filed after ${store.coveredThrough} are read live from issuer submissions (up to ${opts.perIssuer || HISTORY_PER_ISSUER} per issuer): ${tail.filings.read} read.` : "";
  return {
    ok: items.length > 0,
    source: `${STORE_SOURCE}${tail ? " + SEC EDGAR Form 4 (issuer submissions)" : ""}`,
    asOf: store.lastUpdate || new Date().toISOString(),
    latency: `Form 4 is due two business days after the trade. Quarterly data sets cover filings through ${store.datasetThrough}, the EDGAR daily index through ${store.coveredThrough}; the store is updated every 6 h.${live} Every Form 4 in the window is read, with no per-issuer cap. Data-set prices and share counts are rounded to cents and hundredths.`,
    items,
    errors: tail?.errors || [],
    issuers: list.length,
    filings: { wanted: forms + (tail?.filings.wanted || 0), read: forms + (tail?.filings.read || 0), failed: tail?.filings.failed || 0, pending: tail?.filings.pending || 0, listingIncomplete: Boolean(tail?.filings.listingIncomplete) },
    coverage: { shortList: [], capped: tail?.coverage.capped || [] },
    otherIssuer: tail?.otherIssuer || 0,
    building: Boolean(tail?.building),
    store: { ...store, amended: stored.amended, forms, liveForms: tail?.filings.read || 0 },
    coverageNote: `Form 4 history: every Form 4 filed ${from || store.coveredFrom} to ${to || "today"} for ${list.length} join-table issuers — ${forms} forms from the ${STORE_SOURCE} (complete ${store.coveredFrom} to ${store.coveredThrough}, updated ${store.lastUpdate || "—"})${tail ? ` and ${tail.filings.read} filed since, read live` : ""}. No per-issuer cap; ${stored.amended} lines on 4/A amendments are left out (they restate a form already counted).${early ? ` The store starts ${store.coveredFrom}; Form 4s filed before that are not here.` : ""}`
  };
}

/**
 * Form 4 rows filed in [from, to] from issuer submissions: up to `perIssuer` filings each, newest first. Reads
 * still running at `deadline` keep going and fill the cache for the next run; they are counted in `filings.pending`.
 * `coverage` says what the SEC list could not reach: issuers whose recent-filings list starts after `from`, and
 * issuers with more filings in the window than `perIssuer`.
 */
async function submissionsHistory(db, { from = "", to = "", deadline = 0, perIssuer = HISTORY_PER_ISSUER, read = form4, subsOf = secSubmissions, tickers = null } = {}) {
  const list = (tickers || listCore(db)).filter((t) => t.cik);
  const rows = [];
  const errors = [];
  const filings = { wanted: 0, read: 0, failed: 0 };
  const coverage = { shortList: [], capped: [] };
  let otherIssuer = 0;
  let listedIssuers = 0;
  const work = pool(list, 4, async (ticker) => {
    let subs;
    try { subs = await subsOf(db, ticker.cik); } catch (err) { errors.push(`${ticker.symbol}: ${err.message}`); return; }
    listedIssuers += 1;
    const { picks, listed, listStarts } = form4Picks(subs, { from, to, max: perIssuer });
    if (from && listStarts && listStarts > from) coverage.shortList.push(ticker.symbol);
    if (listed > picks.length) coverage.capped.push(ticker.symbol);
    filings.wanted += picks.length;
    await Promise.all(picks.map(async (pick) => {
      const parsed = await read(db, ticker.cik, pick).catch(() => null);
      if (!parsed) { filings.failed += 1; return; }
      filings.read += 1;
      const out = form4Rows(ticker, pick, parsed);
      if (out.other) otherIssuer += 1;
      rows.push(...out.rows);
    }));
  });
  let finished = false;
  work.then(() => { finished = true; }, () => { finished = true; });
  const wait = deadline ? Math.max(0, deadline - Date.now()) : 0;
  if (deadline) await Promise.race([work, new Promise((r) => { const t = setTimeout(r, wait); t.unref?.(); })]);
  else await work;
  const items = [...rows].sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || String(b.traded).localeCompare(String(a.traded)));
  const pending = finished ? 0 : Math.max(0, filings.wanted - filings.read - filings.failed);
  return {
    ok: items.length > 0,
    source: "SEC EDGAR Form 4 (issuer submissions)",
    asOf: new Date().toISOString(),
    latency: `Form 4 is due two business days after the trade. Up to ${perIssuer} Form 4s per join-table issuer filed ${from || "any time"} to ${to || "today"}, newest first; each form is cached for six months once read.`,
    items,
    errors: [...errors].sort(),
    issuers: list.length,
    filings: { ...filings, pending, listingIncomplete: listedIssuers + errors.length < list.length },
    coverage: { shortList: [...coverage.shortList].sort(), capped: [...coverage.capped].sort() },
    otherIssuer,
    building: !finished
  };
}
