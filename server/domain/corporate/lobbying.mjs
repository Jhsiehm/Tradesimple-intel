import { fetchJson } from "../../lib/http.mjs";
import { listTickers, readCache, writeCache } from "../../lib/db.mjs";
import { HOUR, DAY } from "../../lib/time.mjs";
import { pool } from "../../lib/pool.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";

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
