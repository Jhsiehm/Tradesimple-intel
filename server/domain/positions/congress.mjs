import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchBytes, fetchResponse, fetchText } from "../../lib/http.mjs";
import { listTickers, readCache, writeCache } from "../../lib/db.mjs";
import { HOUR, MONTH } from "../../lib/time.mjs";
import { pool } from "../../lib/pool.mjs";
import { BROWSER_UA } from "../../lib/ua.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { roster } from "../../roster.mjs";
import { parsePtrPdf } from "../../parsers/ptr.mjs";
import { parseEfd } from "../../parsers/efd.mjs";
import { isoDate, lagDays, usDate } from "../../parsers/dates.mjs";

const execFileAsync = promisify(execFile);

/** Disclosures are backfilled to the start of the 119th Congress. */
const TRADES_FROM = "2025-01-03";

/** Reports parsed before the first response; the rest stream in behind it. */
const HEAD_REPORTS = 110;

const trades = { job: null, head: null, partial: null, last: null };

export function congressTrades(db) {
  const hit = readCache(db, KEY.posCongress);
  if (hit) {
    trades.last = hit;
    return Promise.resolve(hit);
  }
  if (trades.job) {
    const ready = trades.last || trades.partial;
    return ready ? Promise.resolve(ready) : trades.head;
  }
  let release;
  trades.head = new Promise((resolve) => { release = resolve; });
  trades.job = buildTrades(db, (res, head) => {
    trades.partial = res;
    if (head) release(res);
  })
    .then((res) => {
      release(res);
      if (res.items.length) {
        writeCache(db, KEY.posCongress, res, 3 * HOUR);
        trades.last = res;
      }
      console.log(`congress trades: ${res.items.length} rows from ${res.progress.house.parsed} House + ${res.progress.senate.parsed} Senate reports`);
      return res;
    })
    .catch((err) => {
      const res = { ok: false, source: "House Clerk PTR PDFs · Senate eFD PTRs", asOf: new Date().toISOString(), errors: [err.message], items: [] };
      release(res);
      return res;
    })
    .finally(() => {
      trades.job = null;
      trades.partial = null;
    });
  return trades.last ? Promise.resolve(trades.last) : trades.head;
}

async function buildTrades(db, publish) {
  const tickers = new Set(listTickers(db).map((t) => t.symbol));
  const people = await roster(db).catch(() => ({ items: [] }));
  const errors = [];
  const progress = {
    house: { parsed: 0, total: 0, paper: 0, failed: 0, done: false },
    senate: { parsed: 0, total: 0, paper: 0, failed: 0, done: false }
  };
  const house = [];
  const senate = [];
  let headSent = false;
  let lastPublish = 0;
  const compose = (building) => {
    const items = [...house, ...senate]
      .map((row) => ({ ...row, inJoin: tickers.has(row.symbol) }))
      .sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || String(b.traded).localeCompare(String(a.traded)));
    const h = progress.house;
    const s = progress.senate;
    const notes = [...errors];
    if (h.paper || s.paper) notes.push(`${h.paper} House and ${s.paper || 0} Senate reports since ${TRADES_FROM} are scanned paper filings and are not parsed.`);
    if (h.failed || s.failed) notes.push(`${h.failed} House and ${s.failed} Senate reports could not be read this run.`);
    return {
      ok: items.length > 0,
      source: "House Clerk PTR PDFs · Senate eFD PTRs",
      asOf: new Date().toISOString(),
      building,
      from: TRADES_FROM,
      progress: structuredClone(progress),
      latency: `STOCK Act allows up to 45 days from trade to filing. ${building ? "Backfilling: " : ""}Parsed ${h.parsed} of ${h.total} electronic House and ${s.parsed} of ${s.total} Senate reports filed since ${TRADES_FROM}. Lag is filed date minus trade date. Senate amendments keep the original report date and list the amendment date separately.`,
      errors: notes,
      items
    };
  };
  const tick = () => {
    const h = progress.house;
    const s = progress.senate;
    const headReady = (h.done || h.parsed + h.failed >= Math.min(HEAD_REPORTS, h.total)) && (s.done || s.parsed + s.failed >= Math.min(HEAD_REPORTS / 2, s.total));
    if (!headSent && headReady && (h.total || h.done) && (s.total || s.done)) {
      headSent = true;
      publish(compose(true), true);
      lastPublish = Date.now();
    } else if (headSent && Date.now() - lastPublish > 5000) {
      publish(compose(true), false);
      lastPublish = Date.now();
    }
  };
  await Promise.all([
    houseTrades(db, people.items, progress.house, house, tick).catch((err) => { errors.push(`House Clerk: ${err.message}`); }).finally(() => { progress.house.done = true; tick(); }),
    senateTrades(db, people.items, progress.senate, senate, tick).catch((err) => { errors.push(`Senate eFD: ${err.message}`); }).finally(() => { progress.senate.done = true; tick(); })
  ]);
  return compose(false);
}

async function houseTrades(db, people, progress, rows, tick) {
  const index = [];
  const year = new Date().getUTCFullYear();
  for (let y = year; y >= Number(TRADES_FROM.slice(0, 4)); y -= 1) {
    const text = await clerkIndex(db, y).catch(() => "");
    for (const line of text.split(/\r?\n/).slice(1)) {
      const cols = line.split("\t");
      if (cols.length < 9 || cols[4] !== "P") continue;
      const docId = cols[8].trim();
      if (isoDate(cols[7]) < TRADES_FROM) continue;
      index.push({ last: cols[1], first: cols[2], district: String(cols[5] || ""), filed: cols[7], docId, year: y });
    }
  }
  index.sort((a, b) => usDate(b.filed) - usDate(a.filed));
  const electronic = index.filter((row) => row.docId.startsWith("2"));
  progress.paper = index.length - electronic.length;
  progress.total = electronic.length;
  tick();
  const house = people.filter((p) => p.chamber === "house");
  await pool(electronic, 4, async (filing) => {
    const lines = await ptrLines(db, filing).catch(() => null);
    if (!lines) {
      progress.failed += 1;
      tick();
      return;
    }
    progress.parsed += 1;
    const state = filing.district.slice(0, 2);
    const num = String(Number(filing.district.slice(2)) || 0);
    const member = house.find((p) => p.state === state && String(Number(p.district) || 0) === num)
      || house.find((p) => p.last.toLowerCase() === filing.last.toLowerCase() && p.state === state);
    const filed = isoDate(filing.filed);
    const link = `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${filing.year}/${filing.docId}.pdf`;
    lines.forEach((line, i) => {
      rows.push({
        id: `h-${filing.docId}-${i}`,
        chamber: "house",
        person: member?.name || `${filing.first} ${filing.last}`.trim(),
        bioguide: member?.bioguide || "",
        party: member?.party || "",
        state,
        district: num === "0" ? state : `${state}-${num}`,
        symbol: line.symbol,
        asset: line.asset,
        assetType: line.assetType,
        owner: line.owner,
        side: line.side,
        type: line.type,
        amount: line.amount,
        amountLow: line.amountLow,
        traded: line.traded,
        filed,
        lag: lagDays(line.traded, filed),
        link
      });
    });
    tick();
  });
}

async function clerkIndex(db, year) {
  const key = KEY.clerkIndex(year);
  const hit = readCache(db, key);
  if (hit) return hit.text;
  const bytes = await fetchBytes(`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.ZIP`, { headers: { "User-Agent": BROWSER_UA } }, 120000);
  const zip = path.join(os.tmpdir(), `${year}FD.ZIP`);
  fs.writeFileSync(zip, bytes);
  const { stdout } = await execFileAsync("unzip", ["-p", zip, `${year}FD.txt`], { maxBuffer: 64 * 1024 * 1024 });
  writeCache(db, key, { text: stdout }, 6 * HOUR);
  return stdout;
}

async function ptrLines(db, filing) {
  const key = KEY.ptrDoc(filing.docId);
  const hit = readCache(db, key);
  if (hit) return hit.lines;
  const url = `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${filing.year}/${filing.docId}.pdf`;
  const lines = await parsePtrPdf(await fetchBytes(url, { headers: { "User-Agent": BROWSER_UA } }, 60000));
  writeCache(db, key, { lines }, 6 * MONTH);
  return lines;
}

async function efdReportList(session) {
  const [y, m, d] = TRADES_FROM.split("-");
  const out = [];
  for (let start = 0; start < 5000; start += 100) {
    const body = new URLSearchParams({
      start: String(start),
      length: "100",
      report_types: "[11]",
      filer_types: "[]",
      submitted_start_date: `${m}/${d}/${y} 00:00:00`,
      submitted_end_date: "",
      candidate_state: "",
      senator_state: "",
      office_id: "",
      first_name: "",
      last_name: "",
      csrfmiddlewaretoken: session.csrf
    });
    const res = await fetchResponse("https://efdsearch.senate.gov/search/report/data/", {
      method: "POST",
      headers: {
        "User-Agent": BROWSER_UA,
        Referer: "https://efdsearch.senate.gov/search/",
        "X-CSRFToken": session.csrf,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: session.cookie
      },
      body
    }, 30000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const page = await res.json();
    out.push(...(page.data || []));
    if (!page.data?.length || out.length >= Number(page.recordsFiltered ?? page.recordsTotal ?? 0)) break;
  }
  return out;
}

async function senateTrades(db, people, progress, rows, tick) {
  const senators = people.filter((p) => p.chamber === "senate");
  const session = await efdSession();
  const list = await efdReportList(session);
  const reports = list.map((row) => {
    const href = /href="([^"]+)"/.exec(row[3])?.[1] || "";
    const title = String(row[3] || "").replace(/<[^>]+>/g, "").trim();
    const amendment = /\(Amendment\s*(\d+)\)/i.exec(title)?.[1] || null;
    const original = amendment ? /for\s+(\d{2}\/\d{2}\/\d{4})/i.exec(title)?.[1] : null;
    return { first: row[0], last: row[1], label: row[2], href, filed: original || row[4], amended: amendment ? row[4] : null, amendment };
  }).filter((row) => row.href.includes("/view/ptr/") && /\(Senator\)/.test(row.label))
    .filter((row, _, all) => !row.amendment || !all.some((other) => other !== row && other.amendment && other.last === row.last && other.filed === row.filed && Number(other.amendment) > Number(row.amendment)));
  progress.total = reports.length;
  progress.paper = list.filter((row) => /\/view\/paper\//.test(row[3] || "") && /\(Senator\)/.test(row[2] || "")).length;
  tick();
  await pool(reports, 3, async (report) => {
    const lines = await efdLines(db, report.href, session).catch(() => null);
    if (!lines) {
      progress.failed += 1;
      tick();
      return;
    }
    progress.parsed += 1;
    const last = report.last.split(",")[0].trim().toLowerCase();
    const member = senators.find((p) => p.last.toLowerCase() === last && p.first[0]?.toLowerCase() === report.first.trim()[0]?.toLowerCase())
      || senators.find((p) => p.last.toLowerCase() === last);
    const filed = isoDate(report.filed);
    lines.forEach((line, i) => {
      if (!line.symbol) return;
      rows.push({
        id: `s-${report.href.split("/").filter(Boolean).pop()}-${i}`,
        chamber: "senate",
        person: member?.name || `${report.first} ${report.last}`.trim(),
        bioguide: member?.bioguide || "",
        party: member?.party || "",
        state: member?.state || "",
        district: member?.state || "",
        symbol: line.symbol,
        asset: line.asset,
        assetType: line.assetType,
        owner: line.owner,
        side: line.side,
        type: line.type,
        amount: line.amount,
        amountLow: line.amountLow,
        traded: line.traded,
        filed,
        amended: report.amended ? isoDate(report.amended) : null,
        amendment: report.amendment ? Number(report.amendment) : null,
        lag: lagDays(line.traded, filed),
        link: `https://efdsearch.senate.gov${report.href}`
      });
    });
    tick();
  });
}

async function efdSession() {
  const home = await fetchResponse("https://efdsearch.senate.gov/search/home/", { headers: { "User-Agent": BROWSER_UA } }, 30000);
  const jar = new Map();
  const take = (res) => {
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(";");
      const [name, ...rest] = pair.split("=");
      jar.set(name.trim(), rest.join("="));
    }
  };
  take(home);
  const html = await home.text();
  const token = /name="csrfmiddlewaretoken" value="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error("No eFD form token");
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const agree = await fetchResponse("https://efdsearch.senate.gov/search/home/", {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: "https://efdsearch.senate.gov/search/home/",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie()
    },
    body: new URLSearchParams({ prohibition_agreement: "1", csrfmiddlewaretoken: token })
  }, 30000);
  take(agree);
  return { cookie: cookie(), csrf: jar.get("csrftoken") || token };
}

async function efdLines(db, href, session) {
  const key = KEY.efdPtr(href);
  const hit = readCache(db, key);
  if (hit) return hit.lines;
  const html = await fetchText(`https://efdsearch.senate.gov${href}`, {
    headers: { "User-Agent": BROWSER_UA, Cookie: session.cookie, Referer: "https://efdsearch.senate.gov/search/" }
  });
  const lines = parseEfd(html);
  writeCache(db, key, { lines }, 6 * MONTH);
  return lines;
}

export async function memberTrades(db, bioguide) {
  const res = await congressTrades(db).catch(() => ({ items: [] }));
  return (res.items || []).filter((r) => r.bioguide === bioguide);
}
