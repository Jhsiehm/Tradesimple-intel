import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchText } from "./lib/http.mjs";
import { listTickers, readCache, writeCache } from "./lib/db.mjs";
import { HOUR } from "./lib/time.mjs";
import { SEC_UA, BROWSER_UA } from "./lib/ua.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const execFileAsync = promisify(execFile);
const TTL = 6 * HOUR;

export async function politicianTrades(db) {
  const hit = readCache(db, KEY.ptr);
  if (hit) return hit;
  const items = [];
  const errors = ["Senate eFD has no public bulk file in this slice. House rows are Clerk periodic-report filings, not parsed trade lines."];
  for (const year of [2026, 2025]) {
    try {
      const text = await clerkIndex(year);
      for (const row of parseClerk(text, year)) items.push(row);
    } catch (err) {
      errors.push(`House Clerk ${year} index unavailable (${err.message})`);
    }
  }
  items.sort((a, b) => b.sort - a.sort);
  const result = {
    ok: items.length > 0,
    source: "House Clerk financial disclosure index",
    asOf: new Date().toISOString(),
    latency: "STOCK Act filing window is up to 45 days after the trade. These rows are the filing, not the ticker line inside the PDF.",
    errors,
    items: items.slice(0, 40).map(({ sort, ...row }) => row)
  };
  if (items.length) writeCache(db, KEY.ptr, result, TTL);
  return result;
}

async function clerkIndex(year) {
  const url = `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.ZIP`;
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const zip = path.join(os.tmpdir(), `${year}FD.ZIP`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const { stdout } = await execFileAsync("unzip", ["-p", zip, `${year}FD.txt`]);
  return stdout;
}

function parseClerk(text, year) {
  const lines = text.split(/\r?\n/).slice(1).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 9 || cols[4] !== "P") continue;
    const last = cols[1];
    const first = cols[2];
    const district = String(cols[5] || "");
    const filed = cols[7];
    const docId = cols[8].trim();
    const state = district.slice(0, 2);
    const num = district.slice(2);
    rows.push({
      id: `house-${docId}`,
      source: "House Clerk PTR",
      chamber: "house",
      person: `${first} ${last}`.trim(),
      district: num ? `${state}-${num}` : state,
      symbol: "",
      asset: "Periodic transaction report",
      side: "filing",
      amount: "",
      traded: "",
      disclosure: filed,
      latency: "Up to 45 days",
      link: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf`,
      sort: parseUsDate(filed)
    });
  }
  return rows;
}

function parseUsDate(value) {
  const [month, day, year] = String(value || "").split("/").map(Number);
  if (!year) return 0;
  return Date.UTC(year, (month || 1) - 1, day || 1);
}

export async function insiderFilings(db) {
  return edgarList(db, "4", "SEC EDGAR Form 4", "Corporate insider transactions. Filing lag is days, not minutes.");
}

export async function whaleFilings(db) {
  return edgarList(
    db,
    "13F-HR",
    "SEC EDGAR 13F-HR",
    "Hedge-fund holdings are quarterly and filed about 45 days after quarter end. These rows are filings, not a live blotter."
  );
}

export async function shortInterest(db, symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return { ok: false, error: "symbol required", items: [] };
  const cacheKey = KEY.finra(sym);
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const items = [];
  for (const date of settlementDates()) {
    const res = await fetch("https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        compareFilters: [
          { compareType: "EQUAL", fieldName: "symbolCode", fieldValue: sym },
          { compareType: "EQUAL", fieldName: "settlementDate", fieldValue: date }
        ],
        limit: 1
      })
    });
    const text = await res.text();
    if (!res.ok || text.startsWith("{")) continue;
    const row = parseCsv(text)[0];
    if (!row?.symbolCode) continue;
    items.push({
      id: `${sym}-${row.settlementDate}`,
      symbol: sym,
      date: row.settlementDate,
      shares: Number(row.currentShortPositionQuantity) || null,
      change: row.changePercent || ""
    });
    if (items.length >= 4) break;
  }
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!items.length) {
    return {
      ok: false,
      missing: "FINRA data access",
      source: "FINRA",
      latency: "Short interest is published twice a month.",
      items: []
    };
  }
  const result = {
    ok: true,
    source: "FINRA consolidated short interest",
    asOf: new Date().toISOString(),
    latency: "Short interest is published twice a month, not a live tape.",
    items
  };
  writeCache(db, cacheKey, result, TTL);
  return result;
}

function settlementDates() {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < 5; i += 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    dates.push(last.toISOString().slice(0, 10));
    dates.push(`${last.toISOString().slice(0, 8)}15`);
  }
  return dates;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsv(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsv(line);
    return Object.fromEntries(headers.map((header, index) => [header, cols[index] || ""]));
  });
}

function splitCsv(line) {
  const cols = [];
  let cur = "";
  let quoted = false;
  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cols.push(cur);
      cur = "";
      continue;
    }
    cur += char;
  }
  cols.push(cur);
  return cols;
}

async function edgarList(db, form, source, latency) {
  const cacheKey = KEY.edgarJoined(form);
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(form)}&owner=include&count=20&output=atom`;
  const xml = await fetchText(url, { headers: { "User-Agent": SEC_UA, Accept: "application/atom+xml" } });
  const tickers = listTickers(db);
  const items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m, i) => {
    const block = m[1];
    const title = tag(block, "title");
    const updated = tag(block, "updated");
    const link = /<link[^>]*href="([^"]+)"/.exec(block)?.[1] || "";
    const ciks = [...title.matchAll(/\((\d{7,10})\)/g)].map((hit) => hit[1].padStart(10, "0"));
    const known = tickers.find((ticker) => ciks.includes(ticker.cik));
    return {
      id: `${form}-${i}-${updated}`,
      title,
      updated,
      link,
      form,
      symbol: known?.symbol || "",
      disclosure: updated
    };
  });
  items.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  const result = {
    ok: true,
    source,
    asOf: new Date().toISOString(),
    latency,
    items
  };
  writeCache(db, cacheKey, result, 30 * 60 * 1000);
  return result;
}

function tag(block, name) {
  return new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || "";
}

