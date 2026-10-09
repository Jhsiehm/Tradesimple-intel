import { coreKey, listCore, readCache, writeCache } from "../../lib/db.mjs";
import { secText } from "../../feeds/sec.mjs";
import { once } from "../../lib/once.mjs";
import { pool } from "../../lib/pool.mjs";
import { HOUR, MINUTE, MONTH } from "../../lib/time.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { parseForm4 } from "../../parsers/form4.mjs";
import { lagDays } from "../../parsers/dates.mjs";
import { secSubmissions } from "./submissions.mjs";

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
function form4(db, cik, pick) {
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

/**
 * Form 4 rows filed in [from, to] for every join-table issuer: up to `perIssuer` filings each, newest first. Reads
 * still running at `deadline` keep going and fill the cache for the next run; they are counted in `filings.pending`.
 * `coverage` says what the SEC list could not reach: issuers whose recent-filings list starts after `from`, and
 * issuers with more filings in the window than `perIssuer`.
 */
export async function insiderHistory(db, { from = "", to = "", deadline = 0, perIssuer = HISTORY_PER_ISSUER, read = form4, subsOf = secSubmissions, tickers = null } = {}) {
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
