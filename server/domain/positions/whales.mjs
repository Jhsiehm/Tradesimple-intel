import fs from "node:fs";
import path from "node:path";
import { listTickers, readCache, writeCache } from "../../lib/db.mjs";
import { secJson, secText } from "../../feeds/sec.mjs";
import { once } from "../../lib/once.mjs";
import { pool } from "../../lib/pool.mjs";
import { HOUR, MONTH } from "../../lib/time.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { normIssuer, parse13fPeriod, parse13fTable } from "../../parsers/thirteenF.mjs";
import { lagDays } from "../../parsers/dates.mjs";
import { secSubmissions } from "./submissions.mjs";

export function whaleHoldings(db) {
  return once("whale-holdings", async () => {
    const hit = readCache(db, KEY.posWhales);
    if (hit) return hit;
    const tickers = listTickers(db);
    const names = tickers.map((t) => ({ symbol: t.symbol, keys: [t.name, ...(t.recipients || [])].map(normIssuer) }));
    const keySet = new Set(names.flatMap((n) => n.keys));
    const funds = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "data", "whales.json"), "utf8"));
    const rows = [];
    const errors = [];
    let scanned = 0;
    await pool(funds, 2, async (fund) => {
      try {
        const subs = await secSubmissions(db, fund.cik);
        const recent = subs.filings?.recent || {};
        const filings = [];
        for (let i = 0; i < (recent.form || []).length && filings.length < 2; i += 1) {
          if (recent.form[i] !== "13F-HR") continue;
          const acc = recent.accessionNumber[i];
          filings.push({
            cik: fund.cik,
            acc,
            filed: recent.filingDate[i],
            link: `https://www.sec.gov/Archives/edgar/data/${Number(fund.cik)}/${acc.replace(/-/g, "")}/${acc}-index.htm`
          });
        }
        if (!filings.length) return;
        const [current, prior] = await Promise.all(filings.map((f) => infoTable(db, f, keySet)));
        scanned += 1;
        const tally = (table) => {
          const out = new Map();
          for (const h of table?.holdings || []) {
            if (h.putCall) continue;
            const hit = names.find((n) => n.keys.includes(normIssuer(h.issuer)));
            if (!hit) continue;
            const cur = out.get(hit.symbol) || { shares: 0, value: 0, issuer: h.issuer };
            cur.shares += h.shares;
            cur.value += h.value;
            out.set(hit.symbol, cur);
          }
          return out;
        };
        const now = tally(current);
        const before = prior ? tally(prior) : new Map();
        const symbols = new Set([...now.keys(), ...before.keys()]);
        for (const symbol of symbols) {
          const a = now.get(symbol);
          const b = before.get(symbol);
          const shares = a?.shares || 0;
          const was = b?.shares || 0;
          const delta = prior ? shares - was : null;
          const action = !prior ? "held" : !was && shares ? "new" : was && !shares ? "exit" : delta > 0 ? "add" : delta < 0 ? "trim" : "hold";
          rows.push({
            id: `13f-${filings[0].acc}-${symbol}`,
            symbol,
            person: fund.name,
            issuer: a?.issuer || b?.issuer || "",
            shares,
            value: a?.value || 0,
            prior: prior ? was : null,
            delta,
            action,
            side: action === "new" || action === "add" ? "buy" : action === "exit" || action === "trim" ? "sell" : "hold",
            period: current.period,
            priorPeriod: prior?.period || "",
            traded: current.period,
            filed: filings[0].filed,
            lag: lagDays(current.period, filings[0].filed),
            link: filings[0].link
          });
        }
      } catch (err) {
        errors.push(`${fund.name}: ${err.message}`);
      }
    });
    rows.sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || (b.value || 0) - (a.value || 0));
    const result = {
      ok: rows.length > 0,
      source: "SEC EDGAR 13F-HR information tables",
      asOf: new Date().toISOString(),
      latency: `Quarter-end holdings filed up to 45 days after quarter end. ${scanned} of ${funds.length} named funds in data/whales.json; change is this 13F against the one before. Issuers matched by name to the join table. Options excluded.`,
      errors,
      items: rows
    };
    if (rows.length) writeCache(db, KEY.posWhales, result, 6 * HOUR);
    return result;
  });
}

async function infoTable(db, filing, keys) {
  const key = KEY.sec13f(filing.acc, hash([...keys].sort().join("|")));
  const hit = readCache(db, key);
  if (hit) return hit;
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(filing.cik)}/${filing.acc.replace(/-/g, "")}`;
  const index = await secJson(`${base}/index.json`);
  const files = (index.directory?.item || []).map((f) => f.name);
  const tableFile = files.find((f) => /\.xml$/i.test(f) && !/primary_doc/i.test(f));
  const primary = files.find((f) => /primary_doc\.xml$/i.test(f));
  let period = "";
  if (primary) {
    period = parse13fPeriod(await secText(`${base}/${primary}`).catch(() => ""));
  }
  let holdings = [];
  if (tableFile) holdings = parse13fTable(await secText(`${base}/${tableFile}`, { timeoutMs: 120000 }));
  const keep = { period, total: holdings.length, holdings: holdings.filter((h) => h.issuer && h.value > 0 && keys.has(normIssuer(h.issuer))) };
  writeCache(db, key, keep, 6 * MONTH);
  return keep;
}

function hash(value) {
  let h = 0;
  for (const char of String(value)) h = (h * 31 + char.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
