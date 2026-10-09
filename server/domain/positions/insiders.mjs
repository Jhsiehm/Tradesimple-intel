import { coreKey, listCore, readCache, writeCache } from "../../lib/db.mjs";
import { secText } from "../../feeds/sec.mjs";
import { once } from "../../lib/once.mjs";
import { pool } from "../../lib/pool.mjs";
import { HOUR, MONTH } from "../../lib/time.mjs";
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

export function insiderTrades(db) {
  return once("insider-trades", async () => {
    const key = KEY.posInsiders(coreKey(db));
    const hit = readCache(db, key);
    if (hit) return hit;
    const tickers = listCore(db).filter((t) => t.cik);
    const rows = [];
    const errors = [];
    const scanned = [];
    await pool(tickers, 2, async (ticker) => {
      try {
        const subs = await secSubmissions(db, ticker.cik);
        const recent = subs.filings?.recent || {};
        const picks = [];
        for (let i = 0; i < (recent.form || []).length && picks.length < 8; i += 1) {
          if (recent.form[i] !== "4") continue;
          picks.push({ accession: recent.accessionNumber[i], filed: recent.filingDate[i], doc: recent.primaryDocument[i] });
        }
        for (const pick of picks) {
          const parsed = await form4(db, ticker.cik, pick).catch(() => null);
          if (!parsed) continue;
          parsed.lines.forEach((line, i) => {
            rows.push({
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
            });
          });
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
      latency: "Form 4 is due two business days after the trade. Rows are the latest eight Form 4s per join-table issuer. Code P is an open-market buy, S a sale, A a grant, F tax withholding.",
      errors,
      scanned: scanned.sort(),
      items: rows
    };
    if (rows.length) writeCache(db, key, result, 2 * HOUR);
    return result;
  });
}

async function form4(db, cik, pick) {
  const key = KEY.secForm4(pick.accession);
  const hit = readCache(db, key);
  if (hit) return hit;
  const raw = String(pick.doc || "").replace(/^xslF345X\d+\//, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${pick.accession.replace(/-/g, "")}/${raw}`;
  const xml = await secText(url);
  const parsed = parseForm4(xml);
  writeCache(db, key, parsed, 6 * MONTH);
  return parsed;
}

/** Owner, role, and non-derivative transactions from a Form 4 XML document. */
