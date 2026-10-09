import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchJson, fetchJsonRetry, usaspendingGate } from "./lib/http.mjs";
import { listTickers, readCache, tickerBySymbol, writeCache } from "./lib/db.mjs";
import { roster } from "./roster.mjs";
import { HOUR, DAY } from "./lib/time.mjs";
import { pool } from "./lib/pool.mjs";
import { SEC_UA, BROWSER_UA } from "./lib/ua.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const execFileAsync = promisify(execFile);
const NASDAQ_HEADERS = { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } };
const MAJOR_CAP = 50e9;

/* ---------- Earnings ---------- */

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
  const body = await fetchJson(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, NASDAQ_HEADERS, 20000);
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
  const body = await fetchJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } }, 30000);
  const slim = { name: body.name, filings: { recent: pick(body.filings?.recent || {}, ["form", "items", "accessionNumber", "filingDate", "reportDate"]) } };
  writeCache(db, key, slim, 12 * HOUR);
  return slim;
}

/* ---------- Lobbying (LDA) ---------- */

export async function lobbyingFor(db, ticker, years = 5) {
  const apiKey = process.env.LDA_API_KEY || "";
  if (!apiKey) return { ok: false, missing: "LDA_API_KEY", filings: [] };
  const now = new Date().getUTCFullYear();
  const filings = [];
  for (const client of ticker.ldaClients || []) {
    for (let y = now; y > now - years; y -= 1) {
      const rows = await ldaClientYear(db, client, y).catch(() => []);
      filings.push(...rows.map((row) => withLag({ ...row, symbol: ticker.symbol })));
    }
  }
  const seen = new Set();
  const unique = filings.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  unique.sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
  const byYear = {};
  for (const f of unique) byYear[f.year] = (byYear[f.year] || 0) + (f.amount || 0);
  return {
    ok: true,
    source: "LDA.gov (Senate / House Lobbying Disclosure Act filings)",
    asOf: new Date().toISOString(),
    latency: "Quarterly LD-2 reports are due 20 days after quarter end; lag shows posted date minus period end. Amount is fee income for outside firms or expenses for in-house filers.",
    byYear,
    filings: unique
  };
}

const PERIOD_END = [[/1st Quarter|first_quarter/i, "03-31"], [/2nd Quarter|second_quarter|Mid-Year/i, "06-30"], [/3rd Quarter|third_quarter/i, "09-30"], [/4th Quarter|fourth_quarter|Year-End/i, "12-31"]];

function withLag(row) {
  const end = PERIOD_END.find(([re]) => re.test(`${row.period} ${row.typeLabel}`))?.[1];
  if (!end || !row.posted) return { ...row, periodEnd: "", lag: null };
  const periodEnd = `${row.year}-${end}`;
  return { ...row, periodEnd, lag: Math.round((Date.parse(row.posted) - Date.parse(periodEnd)) / DAY) };
}

async function ldaClientYear(db, client, year) {
  const key = KEY.ldaYear(client, year);
  const hit = readCache(db, key);
  if (hit) return hit;
  const want = client.toUpperCase().replace(/[.,]/g, "");
  const rows = [];
  let url = `https://lda.gov/api/v1/filings/?client_name=${encodeURIComponent(client)}&filing_year=${year}&page_size=25`;
  for (let page = 0; url && page < 8; page += 1) {
    const body = await fetchJson(url, { headers: { Authorization: `Token ${process.env.LDA_API_KEY}` } }, 30000);
    for (const f of body.results || []) {
      const name = String(f.client?.name || "").toUpperCase().replace(/[.,]/g, "");
      if (!name.startsWith(want) && !name.includes(want)) continue;
      const acts = f.lobbying_activities || [];
      rows.push({
        id: `lda:${f.filing_uuid}`,
        year: f.filing_year,
        period: f.filing_period_display || f.filing_type_display || "",
        type: f.filing_type,
        typeLabel: f.filing_type_display || "",
        posted: String(f.dt_posted || "").slice(0, 10),
        amount: Number(f.income ?? f.expenses ?? 0) || 0,
        inHouse: f.income == null && f.expenses != null,
        registrant: f.registrant?.name || "",
        client: f.client?.name || client,
        issues: [...new Set(acts.map((a) => a.general_issue_code_display).filter(Boolean))],
        detail: acts.map((a) => a.description).filter(Boolean).slice(0, 4).join(" · ").slice(0, 600),
        entities: [...new Set(acts.flatMap((a) => (a.government_entities || []).map((g) => g.name)))].slice(0, 12),
        lobbyists: [...new Set(acts.flatMap((a) => (a.lobbyists || []).map((l) => `${l.lobbyist?.first_name || ""} ${l.lobbyist?.last_name || ""}`.trim())))].slice(0, 20),
        link: f.filing_document_url || ""
      });
    }
    url = body.next;
  }
  const now = new Date().getUTCFullYear();
  writeCache(db, key, rows, year < now - 1 ? 30 * DAY : 12 * HOUR);
  return rows;
}

export async function lobbyingBoard(db) {
  const hit = readCache(db, KEY.ldaBoard);
  if (hit) return hit;
  const tickers = listTickers(db);
  const all = [];
  const totals = [];
  await pool(tickers, 3, async (ticker) => {
    const res = await lobbyingFor(db, ticker, 2).catch(() => null);
    if (!res?.ok) return;
    all.push(...res.filings);
    const now = new Date().getUTCFullYear();
    totals.push({ symbol: ticker.symbol, name: ticker.name, current: res.byYear[now] || 0, prior: res.byYear[now - 1] || 0, filings: res.filings.length, firms: new Set(res.filings.map((f) => f.registrant)).size });
  });
  all.sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
  totals.sort((a, b) => b.current + b.prior - (a.current + a.prior));
  const result = {
    ok: true,
    source: "LDA.gov",
    asOf: new Date().toISOString(),
    latency: "Join-table clients only, this year and last. Rechecked every 2h; lag is posted date minus quarter end (LD-2 due in 20 days).",
    items: all.slice(0, 400),
    totals
  };
  if (all.length) writeCache(db, KEY.ldaBoard, result, 2 * HOUR);
  return result;
}

/* ---------- PACs (FEC bulk) ---------- */

const ORG_TYPES = { C: "Corporation", L: "Labor", M: "Membership", T: "Trade association", V: "Cooperative", W: "Corp. w/o stock" };

let pacMemo = null;
let pacLoading = null;

export async function memberPacs(db, bioguide) {
  const data = await pacData(db);
  return { cycle: data.cycle, asOf: data.asOf, ...(data.members?.[bioguide] || { total: 0, count: 0, pacs: 0, top: [], recent: [] }) };
}

export async function pacData(db) {
  if (pacMemo && Date.now() - pacMemo.at < HOUR) return pacMemo.data;
  const hit = readCache(db, KEY.fecPac);
  if (hit) {
    pacMemo = { at: Date.now(), data: hit };
    return hit;
  }
  if (!pacLoading) pacLoading = buildPacData(db).finally(() => { pacLoading = null; });
  return pacLoading;
}

async function buildPacData(db) {
  const tickers = listTickers(db);
  const joined = new Map();
  for (const t of tickers) for (const id of t.pacs || []) joined.set(id, t.symbol);
  const year = new Date().getUTCFullYear();
  const cycle = year % 2 ? year + 1 : year;
  const cycles = [cycle, cycle - 2, cycle - 4];
  const people = await roster(db).catch(() => ({ items: [] }));
  const byFec = new Map();
  for (const p of people.items) for (const id of p.fec || []) byFec.set(id, p);

  const committees = new Map();
  const candidates = new Map();
  const contributions = [];
  const groups = new Map();
  const toMembers = new Map();
  for (const cy of cycles) {
    const yy = String(cy).slice(2);
    const [cm, cn, pas] = await Promise.all([
      fecBulk(`cm${yy}`, cy, "cm.txt"),
      fecBulk(`cn${yy}`, cy, "cn.txt"),
      fecBulk(`pas2${yy}`, cy, "itpas2.txt")
    ]);
    for (const line of cm.split("\n")) {
      const c = line.split("|");
      if (c[0] && !committees.has(c[0])) committees.set(c[0], { id: c[0], name: c[1], type: c[9], orgType: c[12], org: c[13] });
    }
    for (const line of cn.split("\n")) {
      const c = line.split("|");
      if (c[0] && !candidates.has(c[0])) candidates.set(c[0], { id: c[0], name: c[1], party: c[2], state: c[4], office: c[5], district: c[6] });
    }
    for (const line of pas.split("\n")) {
      const c = line.split("|");
      const cmte = c[0];
      if (!cmte || (c[5] !== "24K" && c[5] !== "24E" && c[5] !== "24A")) continue;
      const amount = Number(c[14]) || 0;
      const cand = candidates.get(c[16]);
      const party = partyCode(cand?.party);
      const meta = committees.get(cmte);
      if (meta && ORG_TYPES[meta.orgType] && cy === cycle) {
        const g = groups.get(cmte) || { id: cmte, name: meta.name, org: meta.org, orgType: ORG_TYPES[meta.orgType], total: 0, count: 0, dem: 0, rep: 0, recipients: new Set() };
        g.total += amount;
        g.count += 1;
        if (party === "D") g.dem += amount;
        if (party === "R") g.rep += amount;
        if (c[16]) g.recipients.add(c[16]);
        groups.set(cmte, g);
      }
      const member = byFec.get(c[16]);
      if (member && cy === cycle && c[5] === "24K") {
        const list = toMembers.get(member.bioguide) || [];
        list.push({ pac: cmte, pacName: meta?.name || cmte, orgType: ORG_TYPES[meta?.orgType] || "", org: meta?.org || "", symbol: joined.get(cmte) || "", amount, date: mdy(c[13]), filed: imageDate(c[4]), lag: lagDays(mdy(c[13]), imageDate(c[4])), link: c[4] ? `https://docquery.fec.gov/cgi-bin/fecimg/?${c[4]}` : "" });
        toMembers.set(member.bioguide, list);
      }
      const symbol = joined.get(cmte);
      if (!symbol) continue;
      contributions.push({
        id: `pac:${c[21] || c[17]}`,
        symbol,
        pac: cmte,
        pacName: meta?.name || cmte,
        date: mdy(c[13]),
        amount,
        kind: c[5] === "24K" ? "contribution" : c[5] === "24E" ? "independent exp. for" : "independent exp. against",
        recipient: c[7],
        candidate: cand?.name || "",
        candidateId: c[16] || "",
        party,
        office: cand?.office || "",
        state: cand?.state || c[9] || "",
        district: cand?.district || "",
        bioguide: member?.bioguide || "",
        member: member?.name || "",
        cycle: cy,
        filed: imageDate(c[4]),
        lag: lagDays(mdy(c[13]), imageDate(c[4])),
        link: c[4] ? `https://docquery.fec.gov/cgi-bin/fecimg/?${c[4]}` : ""
      });
    }
  }
  const seen = new Set();
  const rows = contributions.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const topGroups = [...groups.values()]
    .map((g) => ({ ...g, recipients: g.recipients.size, symbol: joined.get(g.id) || "" }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 60);
  const result = {
    ok: true,
    source: "FEC bulk data (committee master, candidate master, committee-to-candidate contributions)",
    asOf: new Date().toISOString(),
    latency: `FEC bulk files refresh weekly and are rechecked daily; lag is the filing image date minus the gift date. Cycles ${cycles.join(", ")}. PACs joined to tickers through data/tickers.json.`,
    cycle,
    rows,
    groups: topGroups,
    members: Object.fromEntries([...toMembers.entries()].map(([bioguide, list]) => {
      list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const byPac = new Map();
      for (const g of list) {
        const cur = byPac.get(g.pac) || { pac: g.pac, pacName: g.pacName, orgType: g.orgType, org: g.org, symbol: g.symbol, total: 0, count: 0, last: "" };
        cur.total += g.amount;
        cur.count += 1;
        if (g.date > cur.last) cur.last = g.date;
        byPac.set(g.pac, cur);
      }
      return [bioguide, {
        total: list.reduce((s, g) => s + g.amount, 0),
        count: list.length,
        pacs: byPac.size,
        top: [...byPac.values()].sort((a, b) => b.total - a.total).slice(0, 12),
        recent: list.slice(0, 25)
      }];
    }))
  };
  writeCache(db, KEY.fecPac, result, DAY);
  pacMemo = { at: Date.now(), data: result };
  return result;
}

function imageDate(image) {
  const m = /^(20\d{2})(\d{2})(\d{2})/.exec(String(image || ""));
  if (!m || Number(m[2]) > 12 || Number(m[3]) > 31) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function lagDays(from, to) {
  if (!from || !to) return null;
  const d = Math.round((Date.parse(to) - Date.parse(from)) / DAY);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

export async function fecBulk(name, cycle, inner) {
  const zip = path.join(os.tmpdir(), `fec-${name}.zip`);
  const fresh = fs.existsSync(zip) && Date.now() - fs.statSync(zip).mtimeMs < (cycle >= new Date().getUTCFullYear() ? DAY : 7 * DAY);
  if (!fresh) {
    const res = await fetch(`https://www.fec.gov/files/bulk-downloads/${cycle}/${name}.zip`, { redirect: "follow", signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`FEC ${name} HTTP ${res.status}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const { stdout } = await execFileAsync("unzip", ["-p", zip, inner], { maxBuffer: 400 * 1024 * 1024, encoding: "latin1" });
  return stdout;
}

export async function pacFor(db, symbol) {
  const data = await pacData(db);
  const rows = data.rows.filter((r) => r.symbol === symbol);
  const cycleRows = rows.filter((r) => r.cycle === data.cycle);
  const sum = (list) => list.reduce((s, r) => s + r.amount, 0);
  return {
    ok: true,
    source: data.source,
    asOf: data.asOf,
    latency: data.latency,
    cycle: data.cycle,
    total: sum(cycleRows),
    dem: sum(cycleRows.filter((r) => r.party === "D")),
    rep: sum(cycleRows.filter((r) => r.party === "R")),
    recipients: new Set(cycleRows.map((r) => r.candidateId || r.recipient)).size,
    rows
  };
}

/* ---------- Federal contracts (USAspending) ---------- */

export async function contractsFor(db, ticker, { cachedOnly = false } = {}) {
  const key = KEY.usaHistory(ticker.symbol);
  const hit = readCache(db, key);
  if (hit || cachedOnly) return hit;
  const ueis = [...new Set((ticker.contractParents || []).map((p) => p.uei).filter(Boolean))];
  if (!ueis.length) {
    return { ok: true, source: "USAspending.gov", asOf: new Date().toISOString(), note: `${ticker.symbol} has no USAspending parent recipient in data/tickers.json.`, awards: [], byYear: [], parents: [] };
  }
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 5 * 365 * DAY).toISOString().slice(0, 10);
  const filters = { recipient_search_text: ueis, award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: start, end_date: end }] };
  const failures = [];
  const usa = (pathname, body) => fetchJsonRetry(`https://api.usaspending.gov/api/v2/search/${pathname}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, { timeoutMs: 45000, retries: 2, gate: usaspendingGate }).catch((err) => { failures.push(err.message); return null; });
  const [top, overTime, revenue] = await Promise.all([
    usa("spending_by_award", { filters, fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Start Date", "Awarding Agency", "Awarding Sub Agency", "generated_internal_id"], limit: 25, page: 1, sort: "Award Amount", order: "desc" }),
    usa("spending_over_time", { group: "fiscal_year", filters }),
    secRevenue(db, ticker.cik).catch(() => null)
  ]);
  if (!overTime) {
    const err = new Error(`USAspending obligations for ${ticker.symbol}: ${failures.join("; ")}`);
    err.status = 503;
    throw err;
  }
  const awards = (top?.results || []).map((a) => ({
    id: `award:${a.generated_internal_id || a["Award ID"]}`,
    award: a["Award ID"],
    recipient: a["Recipient Name"],
    amount: Number(a["Award Amount"]) || 0,
    description: a.Description || "",
    start: a["Start Date"] || "",
    agency: a["Awarding Agency"] || "",
    subAgency: a["Awarding Sub Agency"] || "",
    link: a.generated_internal_id ? `https://www.usaspending.gov/award/${a.generated_internal_id}` : ""
  }));
  const byYear = (overTime.results || []).map((r) => ({ fy: Number(r.time_period?.fiscal_year), amount: Number(r.aggregated_amount) || 0 })).sort((a, b) => a.fy - b.fy);
  const lastFull = byYear.filter((r) => r.fy < new Date().getUTCFullYear() + (new Date().getUTCMonth() >= 9 ? 1 : 0)).at(-1) || null;
  const result = {
    ok: true,
    source: "USAspending.gov prime awards · SEC XBRL revenue",
    asOf: new Date().toISOString(),
    latency: "Obligations by federal fiscal year (Oct–Sep). Largest 25 prime contract awards started in the last five years. DoD actions are published about 90 days after award. Recipients are the USAspending parent UEIs in data/tickers.json.",
    awards,
    byYear,
    parents: ticker.contractParents,
    basis: ticker.joinBasis?.contracts || "",
    revenue,
    dependence: lastFull && revenue?.value ? { fy: lastFull.fy, obligations: lastFull.amount, revenue: revenue.value, revenueFy: revenue.fy, share: lastFull.amount / revenue.value } : null,
    ...(top ? {} : { note: `Largest awards unavailable: ${failures.join("; ")}` })
  };
  writeCache(db, key, result, top ? DAY : HOUR);
  return result;
}

async function secRevenue(db, cik) {
  if (!cik) return null;
  const key = KEY.secRevenue(cik);
  const hit = readCache(db, key);
  if (hit) return hit;
  const pad = String(cik).padStart(10, "0");
  let best = null;
  for (const concept of ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"]) {
    const body = await fetchJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${pad}/us-gaap/${concept}.json`, { headers: { "User-Agent": SEC_UA } }, 20000).catch(() => null);
    const annual = (body?.units?.USD || []).filter((u) => u.form === "10-K" && u.fp === "FY" && u.frame && /^CY\d{4}$/.test(u.frame));
    const last = annual.sort((a, b) => a.frame.localeCompare(b.frame)).at(-1);
    if (last && (!best || last.frame > best.frame)) best = { value: last.val, fy: Number(last.frame.slice(2)), frame: last.frame, concept };
  }
  writeCache(db, key, best, 7 * DAY);
  return best;
}

/* ---------- Chart events ---------- */

export async function equityEvents(db, symbol, kinds) {
  const ticker = tickerBySymbol(db, symbol);
  if (!ticker) return [];
  const marks = [];
  const want = (k) => !kinds || kinds.includes(k);
  const jobs = [];
  if (want("earn")) {
    jobs.push(earningsHistory(db, ticker).then((rows) => {
      for (const r of rows) marks.push({ t: Date.parse(`${r.date}T21:00:00Z`), label: "Earnings 8-K", tone: "earn", detail: `8-K item 2.02 filed ${r.date}`, href: r.link });
    }).catch(() => null));
    jobs.push(earningsCalendar(db, 0, 60).then((res) => {
      const next = res.items.find((r) => r.symbol === symbol);
      if (next) marks.push({ t: Date.parse(`${next.date}T${next.time === "pre" ? "12" : "21"}:00:00Z`), label: `Next EPS ${next.epsForecast || ""}`.trim(), tone: "earn", detail: `Scheduled ${next.date} ${next.time}` });
    }).catch(() => null));
  }
  if (want("lobby")) {
    jobs.push(lobbyingFor(db, ticker, 5).then((res) => {
      const byPost = new Map();
      for (const f of res.filings || []) {
        const cur = byPost.get(f.posted) || { amount: 0, firms: new Set(), issues: new Set() };
        cur.amount += f.amount;
        cur.firms.add(f.registrant);
        f.issues.forEach((i) => cur.issues.add(i));
        byPost.set(f.posted, cur);
      }
      for (const [date, v] of byPost) {
        if (!date) continue;
        marks.push({ t: Date.parse(`${date}T16:00:00Z`), label: `LDA ${compact(v.amount)}`, tone: "lobby", detail: `${v.firms.size} filing firm(s) · ${[...v.issues].slice(0, 3).join(", ")}` });
      }
    }).catch(() => null));
  }
  if (want("pac")) {
    jobs.push(pacFor(db, symbol).then((res) => {
      const byMonth = new Map();
      for (const r of res.rows) {
        if (!r.date) continue;
        const m = r.date.slice(0, 7);
        const cur = byMonth.get(m) || { amount: 0, count: 0, dem: 0, rep: 0 };
        cur.amount += r.amount;
        cur.count += 1;
        if (r.party === "D") cur.dem += r.amount;
        if (r.party === "R") cur.rep += r.amount;
        byMonth.set(m, cur);
      }
      for (const [m, v] of byMonth) {
        marks.push({ t: Date.parse(`${m}-15T16:00:00Z`), label: `PAC ${compact(v.amount)}`, tone: "pac", detail: `${v.count} gifts · D ${compact(v.dem)} / R ${compact(v.rep)}` });
      }
    }).catch(() => null));
  }
  if (want("gov")) {
    jobs.push(contractsFor(db, ticker).then((res) => {
      for (const a of (res.awards || []).slice(0, 12)) {
        if (!a.start) continue;
        marks.push({ t: Date.parse(`${a.start}T16:00:00Z`), label: `${agencyCode(a.agency)} ${compact(a.amount)}`, tone: "gov", detail: `${a.agency} · ${a.description.slice(0, 80)}`, href: a.link });
      }
    }).catch(() => null));
  }
  await Promise.all(jobs);
  return marks.filter((m) => Number.isFinite(m.t)).sort((a, b) => a.t - b.t);
}

export async function warmCorporate(db) {
  await pacData(db).catch((err) => console.error("pac warm", err.message));
  await lobbyingBoard(db).catch((err) => console.error("lda warm", err.message));
}

/* ---------- helpers ---------- */

function agencyCode(agency) {
  const map = { "Department of Defense": "DoD", "National Aeronautics and Space Administration": "NASA", "Department of Health and Human Services": "HHS", "Department of Energy": "DOE", "Department of Homeland Security": "DHS", "Department of Veterans Affairs": "VA", "General Services Administration": "GSA", "Department of State": "State", "Department of Transportation": "DOT", "Department of the Treasury": "Treas" };
  return map[agency] || agency.split(" ").filter((w) => /^[A-Z]/.test(w) && !/^(Department|Of|The|And)$/i.test(w)).map((w) => w[0]).join("").slice(0, 5) || "Fed";
}

function partyCode(party) {
  const p = String(party || "").toUpperCase();
  if (p.startsWith("DEM") || p === "DFL") return "D";
  if (p.startsWith("REP")) return "R";
  if (!p) return "";
  return "I";
}

function mdy(value) {
  const v = String(value || "");
  return v.length === 8 ? `${v.slice(4)}-${v.slice(0, 2)}-${v.slice(2, 4)}` : "";
}

function money(value) {
  const n = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function compact(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k] || []]));
}

