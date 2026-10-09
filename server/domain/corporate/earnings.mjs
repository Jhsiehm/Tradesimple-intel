import { nasdaqJson } from "../../feeds/nasdaq.mjs";
import { secJson } from "../../feeds/sec.mjs";
import { listTickers, readCache, writeCache } from "../../lib/db.mjs";
import { HOUR, DAY } from "../../lib/time.mjs";
import { pool } from "../../lib/pool.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";

const MAJOR_CAP = 50e9;

export async function earningsCalendar(db, back = 7, ahead = 60) {
  const joined = new Set(listTickers(db).map((t) => t.symbol));
  const days = [];
  for (let i = -back; i <= ahead; i += 1) {
    const d = new Date(Date.now() + i * DAY);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    days.push(d.toISOString().slice(0, 10));
  }
  const items = [];
  const failed = [];
  await pool(days, 4, async (date) => {
    try {
      const rows = await earningsDay(db, date);
      for (const row of rows) {
        const inJoin = joined.has(row.symbol);
        if (!inJoin && (row.marketCap || 0) < MAJOR_CAP) continue;
        items.push({ ...row, inJoin });
      }
    } catch {
      failed.push(date);
    }
  });
  items.sort((a, b) => a.date.localeCompare(b.date) || (b.marketCap || 0) - (a.marketCap || 0));
  return {
    ok: true,
    source: "Nasdaq earnings calendar",
    asOf: new Date().toISOString(),
    latency: `Scheduled report dates and consensus EPS as published by Nasdaq. Shows join-table names plus companies above $50B market cap.${failed.length ? ` ${failed.length} days did not load.` : ""}`,
    items
  };
}

async function earningsDay(db, date) {
  const key = KEY.earningsDay(date);
  const hit = readCache(db, key);
  if (hit) return hit;
  const body = await nasdaqJson(`calendar/earnings?date=${date}`, 20000);
  const rows = (body?.data?.rows || []).map((r) => ({
    id: `earn:${date}:${r.symbol}`,
    date,
    symbol: String(r.symbol || "").toUpperCase(),
    name: r.name,
    time: r.time === "time-pre-market" ? "pre" : r.time === "time-after-hours" ? "post" : "tbd",
    marketCap: money(r.marketCap),
    quarter: r.fiscalQuarterEnding || "",
    epsForecast: r.epsForecast || "",
    estimates: Number(r.noOfEsts) || null,
    lastYearDate: r.lastYearRptDt || "",
    lastYearEps: r.lastYearEPS || ""
  }));
  const today = new Date().toISOString().slice(0, 10);
  writeCache(db, key, rows, date < today ? 30 * DAY : 12 * HOUR);
  return rows;
}

export async function earningsHistory(db, ticker) {
  if (!ticker?.cik) return [];
  const subs = await secSubmissions(db, ticker.cik);
  const recent = subs?.filings?.recent;
  if (!recent) return [];
  const out = [];
  for (let i = 0; i < recent.form.length; i += 1) {
    if (recent.form[i] !== "8-K") continue;
    if (!String(recent.items?.[i] || "").split(",").includes("2.02")) continue;
    const acc = recent.accessionNumber[i];
    out.push({
      date: recent.filingDate[i],
      report: recent.reportDate?.[i] || "",
      link: `https://www.sec.gov/Archives/edgar/data/${Number(ticker.cik)}/${acc.replace(/-/g, "")}/${acc}-index.htm`
    });
  }
  return out;
}

async function secSubmissions(db, cik) {
  const key = KEY.secSubsV1(cik);
  const hit = readCache(db, key);
  if (hit) return hit;
  const body = await secJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { timeoutMs: 30000 });
  const slim = { name: body.name, filings: { recent: pick(body.filings?.recent || {}, ["form", "items", "accessionNumber", "filingDate", "reportDate"]) } };
  writeCache(db, key, slim, 12 * HOUR);
  return slim;
}

function money(value) {
  const n = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k] || []]));
}
