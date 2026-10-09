import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractText, getDocumentProxy } from "unpdf";
import { fetchJson, fetchText } from "./lib/http.mjs";
import { coreKey, listCore, listTickers, readCache, writeCache } from "./lib/db.mjs";
import { roster } from "./roster.mjs";
import { shortInterest } from "./markets.mjs";
import { pacData } from "./corporate.mjs";
import { HOUR, DAY, MONTH, sleep } from "./lib/time.mjs";
import { pool } from "./lib/pool.mjs";
import { SEC_UA, BROWSER_UA } from "./lib/ua.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const execFileAsync = promisify(execFile);
const inflight = new Map();

function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const job = fn().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

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
  const res = await fetch(`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.ZIP`, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const zip = path.join(os.tmpdir(), `${year}FD.ZIP`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const { stdout } = await execFileAsync("unzip", ["-p", zip, `${year}FD.txt`], { maxBuffer: 64 * 1024 * 1024 });
  writeCache(db, key, { text: stdout }, 6 * HOUR);
  return stdout;
}

async function ptrLines(db, filing) {
  const key = KEY.ptrDoc(filing.docId);
  const hit = readCache(db, key);
  if (hit) return hit.lines;
  const url = `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${filing.year}/${filing.docId}.pdf`;
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lines = await parsePtrPdf(new Uint8Array(await res.arrayBuffer()));
  writeCache(db, key, { lines }, 6 * MONTH);
  return lines;
}

/** Transaction lines from an electronic House PTR PDF. */
export async function parsePtrPdf(bytes) {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return parsePtr(text);
}

const PTR_NOISE = /:|^(ID Owner|Owner Asset|Type$|Date$|Date Notification|Notification|Amount|Gains|\$200\?|Filing ID|\* For the complete|Yes No|I CERTIFY|Digitally Signed|Clerk of the House|P\s+T\s+R|F\s+I|T\s*$)/;

export function parsePtr(raw) {
  const text = String(raw || "").replace(/[^\x20-\x7E\n]/g, " ");
  const re = /\(([A-Z][A-Z0-9.\-]{0,7})\)\s*\[([A-Z]{2})\]\s+(P|S\s*\(partial\)|S|E)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\$[\d,]+\s*-\s*\$[\d,]+|Over \$[\d,]+|\$[\d,]+)/g;
  const lines = [];
  let prev = 0;
  let m;
  while ((m = re.exec(text))) {
    const rows = text.slice(prev, m.index).split("\n").map((line) => line.replace(/\s+/g, " ").trim());
    const tail = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (!rows[i]) {
        if (tail.length) break;
        continue;
      }
      if (PTR_NOISE.test(rows[i])) break;
      tail.unshift(rows[i]);
    }
    let asset = tail.join(" ").trim();
    const ownerHit = /^(SP|JT|DC)\s+/.exec(asset);
    if (ownerHit) asset = asset.slice(ownerHit[0].length);
    const type = m[3].replace(/\s+/g, " ");
    const amount = m[6].replace(/\s+/g, " ");
    lines.push({
      symbol: m[1].replace(/\.$/, ""),
      assetType: m[2],
      asset: asset.replace(/\s*-\s*$/, "").slice(0, 90),
      owner: ownerHit ? ownerName(ownerHit[1]) : "Self",
      type: type === "P" ? "Purchase" : type === "E" ? "Exchange" : type === "S (partial)" ? "Sale (partial)" : "Sale",
      side: type === "P" ? "buy" : type === "E" ? "exchange" : "sell",
      traded: isoDate(m[4]),
      notified: isoDate(m[5]),
      amount,
      amountLow: Number((amount.match(/\$([\d,]+)/)?.[1] || "0").replace(/,/g, "")) || 0
    });
    prev = m.index + m[0].length;
  }
  return lines;
}

function ownerName(code) {
  return code === "SP" ? "Spouse" : code === "JT" ? "Joint" : code === "DC" ? "Dependent" : "Self";
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
    const res = await fetch("https://efdsearch.senate.gov/search/report/data/", {
      method: "POST",
      headers: {
        "User-Agent": BROWSER_UA,
        Referer: "https://efdsearch.senate.gov/search/",
        "X-CSRFToken": session.csrf,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: session.cookie
      },
      body
    });
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
  const home = await fetch("https://efdsearch.senate.gov/search/home/", { headers: { "User-Agent": BROWSER_UA } });
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
  const agree = await fetch("https://efdsearch.senate.gov/search/home/", {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: "https://efdsearch.senate.gov/search/home/",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie()
    },
    body: new URLSearchParams({ prohibition_agreement: "1", csrfmiddlewaretoken: token })
  });
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

/** Rows of a Senate eFD periodic transaction report page. Throws if the page has no transaction table. */
export function parseEfd(html) {
  if (!/<tbody>/.test(html)) throw new Error("Report page had no table");
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] || "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    const text = (value) => String(value || "").replace(/<div[\s\S]*?<\/div>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const ticker = text(cells[3]);
    const type = text(cells[6]);
    const amount = text(cells[7]);
    return {
      traded: isoDate(text(cells[1])),
      owner: text(cells[2]) || "Self",
      symbol: /^[A-Z][A-Z0-9.\-]{0,7}$/.test(ticker) ? ticker : "",
      asset: text(cells[4]),
      assetType: text(cells[5]),
      type,
      side: /purchase/i.test(type) ? "buy" : /sale/i.test(type) ? "sell" : "exchange",
      amount,
      amountLow: Number((amount.match(/\$([\d,]+)/)?.[1] || "0").replace(/,/g, "")) || 0
    };
  });
}

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
              symbol: ticker.symbol,
              person: parsed.owner,
              title: parsed.title,
              code: line.code,
              side: FORM4_CODES[line.code] || line.code,
              shares: line.shares,
              price: line.price,
              value: line.shares && line.price ? Math.round(line.shares * line.price) : null,
              owned: line.owned,
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

async function secSubmissions(db, cik) {
  const key = KEY.secSubs(cik);
  const hit = readCache(db, key);
  if (hit) return hit;
  const body = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": SEC_UA } });
  const slim = {
    name: body.name,
    filings: {
      recent: {
        form: (body.filings?.recent?.form || []).slice(0, 200),
        accessionNumber: (body.filings?.recent?.accessionNumber || []).slice(0, 200),
        filingDate: (body.filings?.recent?.filingDate || []).slice(0, 200),
        primaryDocument: (body.filings?.recent?.primaryDocument || []).slice(0, 200)
      }
    }
  };
  writeCache(db, key, slim, 2 * HOUR);
  return slim;
}

async function form4(db, cik, pick) {
  const key = KEY.secForm4(pick.accession);
  const hit = readCache(db, key);
  if (hit) return hit;
  const raw = String(pick.doc || "").replace(/^xslF345X\d+\//, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${pick.accession.replace(/-/g, "")}/${raw}`;
  await sleep(120);
  const xml = await fetchText(url, { headers: { "User-Agent": SEC_UA } });
  const parsed = parseForm4(xml);
  writeCache(db, key, parsed, 6 * MONTH);
  return parsed;
}

/** Owner, role, and non-derivative transactions from a Form 4 XML document. */
export function parseForm4(xml) {
  const owner = xmlVal(xml, "rptOwnerName");
  const title = xmlVal(xml, "officerTitle") || (xmlVal(xml, "isDirector") === "1" || xmlVal(xml, "isDirector") === "true" ? "Director" : "") || (xmlVal(xml, "isTenPercentOwner") === "1" ? "10% owner" : "");
  const lines = (xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) || []).map((block) => ({
    date: xmlVal(block, "transactionDate"),
    code: xmlVal(block, "transactionCode"),
    shares: Number(xmlVal(block, "transactionShares")) || 0,
    price: Number(xmlVal(block, "transactionPricePerShare")) || null,
    ad: xmlVal(block, "transactionAcquiredDisposedCode"),
    owned: Number(xmlVal(block, "sharesOwnedFollowingTransaction")) || null
  }));
  return { owner: titleCase(owner), title, lines };
}

function xmlVal(xml, name) {
  const m = new RegExp(`<${name}>\\s*(?:<value>)?\\s*([^<]*?)\\s*(?:</value>)?\\s*(?:<footnoteId[^>]*/>\\s*)*</${name}>`).exec(xml);
  return m ? decodeXml(m[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function whaleHoldings(db) {
  return once("whale-holdings", async () => {
    const hit = readCache(db, KEY.posWhales);
    if (hit) return hit;
    const tickers = listTickers(db);
    const names = tickers.map((t) => ({ symbol: t.symbol, keys: [t.name, ...(t.recipients || [])].map(normIssuer) }));
    const keySet = new Set(names.flatMap((n) => n.keys));
    const funds = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "data", "whales.json"), "utf8"));
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
  await sleep(120);
  const index = await fetchJson(`${base}/index.json`, { headers: { "User-Agent": SEC_UA } });
  const files = (index.directory?.item || []).map((f) => f.name);
  const tableFile = files.find((f) => /\.xml$/i.test(f) && !/primary_doc/i.test(f));
  const primary = files.find((f) => /primary_doc\.xml$/i.test(f));
  let period = "";
  if (primary) {
    await sleep(120);
    const doc = await fetchText(`${base}/${primary}`, { headers: { "User-Agent": SEC_UA } }).catch(() => "");
    const raw = /<periodOfReport>([^<]+)<\/periodOfReport>/.exec(doc)?.[1] || "";
    period = isoDate(raw);
  }
  let holdings = [];
  if (tableFile) {
    await sleep(120);
    const xml = await fetchText(`${base}/${tableFile}`, { headers: { "User-Agent": SEC_UA } }, 120000);
    holdings = (xml.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/g) || []).map((block) => ({
      issuer: nsVal(block, "nameOfIssuer"),
      cls: nsVal(block, "titleOfClass"),
      cusip: nsVal(block, "cusip"),
      value: Number(nsVal(block, "value")) || 0,
      shares: Number(nsVal(block, "sshPrnamt")) || 0,
      putCall: nsVal(block, "putCall")
    }));
  }
  const keep = { period, total: holdings.length, holdings: holdings.filter((h) => h.issuer && h.value > 0 && keys.has(normIssuer(h.issuer))) };
  writeCache(db, key, keep, 6 * MONTH);
  return keep;
}

function nsVal(block, name) {
  const m = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(block);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").trim() : "";
}

function normIssuer(value) {
  let v = String(value || "").toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const tail = /\s+(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|NEW|COM|GROUP|INTL|INTERNATIONAL|MFG|HLDGS|HOLDINGS|&|THE|CL A|CL C|CLASS A|CLASS C|SPONSORED ADR|ADR)$/;
  for (let i = 0; i < 6; i += 1) v = v.replace(tail, "").trim();
  return v;
}

export function shortBoard(db) {
  return once("short-board", async () => {
    const key = KEY.posShorts(coreKey(db));
    const hit = readCache(db, key);
    if (hit) return hit;
    const tickers = listCore(db);
    const rows = [];
    const scanned = [];
    await pool(tickers, 3, async (ticker) => {
      const res = await shortInterest(db, ticker.symbol).catch(() => null);
      if (res) scanned.push(ticker.symbol);
      const items = res?.items || [];
      items.forEach((row, i) => {
        const prev = items[i + 1];
        rows.push({
          id: `si-${ticker.symbol}-${row.date}`,
          symbol: ticker.symbol,
          person: "FINRA consolidated",
          shares: row.shares,
          change: row.change,
          prior: prev?.shares ?? null,
          traded: row.date,
          filed: row.date,
          lag: null,
          latest: i === 0,
          link: "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data"
        });
      });
    });
    rows.sort((a, b) => String(b.traded).localeCompare(String(a.traded)) || a.symbol.localeCompare(b.symbol));
    const result = {
      ok: rows.length > 0,
      source: "FINRA consolidated short interest",
      asOf: new Date().toISOString(),
      latency: "Settlement-date snapshots published twice a month, about a week after settlement.",
      scanned: scanned.sort(),
      items: rows
    };
    if (rows.length) writeCache(db, key, result, 6 * HOUR);
    return result;
  });
}

export async function positionsBoard(db) {
  const [congress, insiders, whales, shorts] = await Promise.all([
    congressTrades(db).catch((err) => ({ items: [], errors: [err.message] })),
    insiderTrades(db).catch((err) => ({ items: [], errors: [err.message] })),
    whaleHoldings(db).catch((err) => ({ items: [], errors: [err.message] })),
    shortBoard(db).catch((err) => ({ items: [], errors: [err.message] }))
  ]);
  const tickers = listTickers(db);
  const join = new Map(tickers.map((t) => [t.symbol, t]));
  const symbols = new Set([...join.keys(), ...(congress.items || []).filter((r) => r.symbol).map((r) => r.symbol)]);
  const now = Date.now();
  const age = (iso) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / DAY)) : null);
  const rows = [...symbols].map((symbol) => {
    const c = (congress.items || []).filter((r) => r.symbol === symbol);
    const buys = c.filter((r) => r.side === "buy");
    const sells = c.filter((r) => r.side === "sell");
    const ins = (insiders.items || []).filter((r) => r.symbol === symbol);
    const whAll = (whales.items || []).filter((r) => r.symbol === symbol);
    const wh = whAll.filter((r) => r.shares > 0);
    const si = (shorts.items || []).filter((r) => r.symbol === symbol);
    const lastFiled = maxOf(c.map((r) => r.filed));
    const lags = c.map((r) => r.lag).filter((v) => v != null);
    return {
      symbol,
      name: join.get(symbol)?.name || c[0]?.asset || "",
      inJoin: join.has(symbol),
      congress: {
        trades: c.length,
        buys: buys.length,
        sells: sells.length,
        buyers: new Set(buys.map((r) => r.bioguide || r.person)).size,
        sellers: new Set(sells.map((r) => r.bioguide || r.person)).size,
        members: new Set(c.map((r) => r.bioguide || r.person)).size,
        dem: new Set(c.filter((r) => r.party === "D").map((r) => r.bioguide || r.person)).size,
        rep: new Set(c.filter((r) => r.party === "R").map((r) => r.bioguide || r.person)).size,
        lastFiled,
        filedAgo: age(lastFiled),
        lastTraded: maxOf(c.map((r) => r.traded)),
        avgLag: avg(lags),
        lastBuy: maxOf(buys.map((r) => r.traded)),
        lastSell: maxOf(sells.map((r) => r.traded)),
        buyTrades: buys.length,
        sellTrades: sells.length,
        buyLow: buys.reduce((sum, r) => sum + (r.amountLow || 0), 0),
        lastBuyer: whoLast(buys),
        lastSeller: whoLast(sells),
        recentBuyers: recentOf(buys, 6)
      },
      insiders: {
        filings: new Set(ins.map((r) => r.link)).size,
        buys: ins.filter((r) => r.code === "P").length,
        sells: ins.filter((r) => r.code === "S").length,
        other: ins.filter((r) => r.code !== "P" && r.code !== "S").length,
        people: new Set(ins.map((r) => r.person)).size,
        netShares: ins.reduce((sum, r) => sum + (r.code === "P" ? r.shares : r.code === "S" ? -r.shares : 0), 0),
        lastFiled: maxOf(ins.map((r) => r.filed)),
        filedAgo: age(maxOf(ins.map((r) => r.filed))),
        lastBuy: maxOf(ins.filter((r) => r.code === "P").map((r) => r.traded)),
        lastSell: maxOf(ins.filter((r) => r.code === "S").map((r) => r.traded)),
        avgLag: avg(ins.map((r) => r.lag).filter((v) => v != null)),
        lastBuyer: whoLast(ins.filter((r) => r.code === "P")),
        lastSeller: whoLast(ins.filter((r) => r.code === "S")),
        recentBuyers: recentOf(ins.filter((r) => r.code === "P"), 6)
      },
      whales: {
        lastBuyer: whoLast(whAll.filter((r) => r.side === "buy"), "filed"),
        holders: new Set(wh.map((r) => r.person)).size,
        buyers: whAll.filter((r) => r.side === "buy").length,
        sellers: whAll.filter((r) => r.side === "sell").length,
        shares: wh.reduce((sum, r) => sum + (r.shares || 0), 0),
        value: wh.reduce((sum, r) => sum + (r.value || 0), 0),
        lastFiled: maxOf(wh.map((r) => r.filed)),
        filedAgo: age(maxOf(wh.map((r) => r.filed))),
        avgLag: avg(whAll.map((r) => r.lag).filter((v) => v != null))
      },
      short: si[0] ? { shares: si[0].shares, change: si[0].change, prior: si[0].prior, date: si[0].traded } : null
    };
  });
  rows.sort((a, b) =>
    Number(b.inJoin) - Number(a.inJoin)
    || b.congress.members - a.congress.members
    || b.congress.trades - a.congress.trades
    || a.symbol.localeCompare(b.symbol)
  );
  return {
    ok: true,
    source: "House Clerk · Senate eFD · SEC Form 4 · SEC 13F · FINRA",
    asOf: new Date().toISOString(),
    latency: "Each column keeps its own filing lag: Congress up to 45 days, Form 4 two business days, 13F up to 45 days after quarter end, short interest twice monthly.",
    feeds: {
      congress: { source: congress.source, asOf: congress.asOf, latency: congress.latency, count: (congress.items || []).length, errors: congress.errors || [] },
      insiders: { source: insiders.source, asOf: insiders.asOf, latency: insiders.latency, count: (insiders.items || []).length, errors: insiders.errors || [] },
      whales: { source: whales.source, asOf: whales.asOf, latency: whales.latency, count: (whales.items || []).length, errors: whales.errors || [] },
      shorts: { source: shorts.source, asOf: shorts.asOf, latency: shorts.latency, count: (shorts.items || []).length, errors: shorts.errors || [] }
    },
    items: rows
  };
}

export async function positionsFor(db, symbol) {
  const sym = String(symbol || "").toUpperCase();
  const [congress, insiders, whales, shorts] = await Promise.all([
    congressTrades(db).catch(() => ({ items: [] })),
    insiderTrades(db).catch(() => ({ items: [] })),
    whaleHoldings(db).catch(() => ({ items: [] })),
    shortBoard(db).catch(() => ({ items: [] }))
  ]);
  const join = listTickers(db).find((t) => t.symbol === sym);
  const trades = (congress.items || []).filter((r) => r.symbol === sym);
  const traders = new Set(trades.map((r) => r.bioguide).filter(Boolean));
  const pac = await pacData(db).catch(() => ({ rows: [] }));
  const since = new Date(Date.now() - 2 * 365 * DAY).toISOString().slice(0, 10);
  const pacs = (pac.rows || [])
    .filter((r) => r.bioguide && traders.has(r.bioguide) && r.date >= since)
    .slice(0, 200)
    .map((r) => ({ ...r, own: r.symbol === sym }));
  return {
    ok: true,
    symbol: sym,
    name: join?.name || "",
    inJoin: Boolean(join),
    asOf: new Date().toISOString(),
    congress: trades,
    pacs,
    pacNote: "Corporate PAC gifts (FEC) from the last two years to members who traded this symbol. Only PACs joined in data/tickers.json are tracked.",
    insiders: (insiders.items || []).filter((r) => r.symbol === sym),
    whales: (whales.items || []).filter((r) => r.symbol === sym),
    shorts: (shorts.items || []).filter((r) => r.symbol === sym),
    coverage: {
      insiders: coverage(insiders, sym, join, "Form 4 scan"),
      shorts: coverage(shorts, sym, join, "FINRA short-interest scan")
    }
  };
}

/** Whether an empty list means "none filed" or "never looked". Only scanned symbols can report zero. */
export function coverage(scan, sym, join, label) {
  if (!join) return { scanned: false, note: `${sym} is not in data/tickers.json, so the ${label} does not cover it.` };
  if (!join.core) return { scanned: false, note: `${sym} is quotes-only in data/tickers.json; the ${label} covers full-join names only.` };
  if (!Array.isArray(scan?.scanned)) return { scanned: false, note: `The ${label} has not finished or failed; retry shortly.` };
  if (!scan.scanned.includes(sym)) return { scanned: false, note: `The ${label} could not read ${sym} this run.` };
  return { scanned: true, note: "" };
}

export async function memberTrades(db, bioguide) {
  const res = await congressTrades(db).catch(() => ({ items: [] }));
  return (res.items || []).filter((r) => r.bioguide === bioguide);
}

export function warmPositions(db) {
  const run = async () => {
    await congressTrades(db).catch(() => null);
    await insiderTrades(db).catch(() => null);
    await whaleHoldings(db).catch(() => null);
    await shortBoard(db).catch(() => null);
  };
  setTimeout(() => { void run(); }, 1500);
  setInterval(() => { void run(); }, 2 * HOUR).unref();
}



function usDate(value) {
  const [month, day, year] = String(value || "").split("/").map(Number);
  if (!year) return 0;
  return Date.UTC(year, (month || 1) - 1, day || 1);
}

function isoDate(value) {
  const text = String(value || "").trim();
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const mdy = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  return "";
}

function lagDays(traded, filed) {
  if (!traded || !filed) return null;
  const a = Date.parse(traded);
  const b = Date.parse(filed);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

function avg(values) {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

function maxOf(values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

function tagText(block, name) {
  return new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || "";
}

function hash(value) {
  let h = 0;
  for (const char of String(value)) h = (h * 31 + char.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Lp|Inc|Ltd|Plc)\b/g, (s) => s.toUpperCase());
}

function who(r) {
  return {
    person: r.person || "",
    bioguide: r.bioguide || "",
    party: r.party || "",
    role: r.title || r.role || "",
    amount: r.amount || (r.shares ? `${Math.round(r.shares).toLocaleString("en-US")} sh${r.price ? ` @ $${r.price}` : ""}` : ""),
    traded: r.traded || "",
    filed: r.filed || "",
    lag: r.lag ?? null,
    link: r.link || ""
  };
}

function byLatest(rows, key = "traded") {
  return [...rows].sort((a, b) => String(b[key] || "").localeCompare(String(a[key] || "")) || String(b.filed || "").localeCompare(String(a.filed || "")));
}

function whoLast(rows, key = "traded") {
  const r = byLatest(rows, key)[0];
  return r ? who(r) : null;
}

function recentOf(rows, n) {
  return byLatest(rows).slice(0, n).map(who);
}
