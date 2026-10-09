import { fetchJson } from "./lib/http.mjs";
import { readCache, writeCache } from "./lib/db.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const TTL = 30 * 60 * 1000;

export async function lobbyingForClient(db, clientName) {
  const apiKey = process.env.LDA_API_KEY || "";
  if (!apiKey) return { ok: false, missing: "LDA_API_KEY", filings: [] };
  const cacheKey = KEY.lda(clientName);
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const url = new URL("https://lda.gov/api/v1/filings/");
  url.searchParams.set("client_name", clientName);
  url.searchParams.set("filing_year", String(new Date().getUTCFullYear()));
  const body = await fetchJson(url, { headers: { Authorization: `Token ${apiKey}` } });
  const filings = (body.results || []).map((f) => ({
    id: f.filing_uuid,
    client: f.client?.name || clientName,
    registrant: f.registrant?.name || "",
    income: f.income,
    expenses: f.expenses,
    type: f.filing_type_display || f.filing_type || "",
    posted: f.dt_posted || "",
    year: f.filing_year
  }));
  filings.sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
  filings.splice(8);
  const result = {
    ok: true,
    source: "LDA.gov",
    asOf: new Date().toISOString(),
    filings
  };
  writeCache(db, cacheKey, result, TTL);
  return result;
}

export async function fecForName(db, name) {
  const apiKey = process.env.FEC_API_KEY || "";
  if (!apiKey) return { ok: false, missing: "FEC_API_KEY", committees: [] };
  const cacheKey = KEY.fec(name);
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const url = new URL("https://api.open.fec.gov/v1/committees/");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", name);
  url.searchParams.set("per_page", "5");
  const body = await fetchJson(url);
  const committees = [];
  for (const c of (body.results || []).slice(0, 3)) {
    let receipts = null;
    try {
      const totalsUrl = new URL(`https://api.open.fec.gov/v1/committee/${c.committee_id}/totals/`);
      totalsUrl.searchParams.set("api_key", apiKey);
      totalsUrl.searchParams.set("cycle", "2024");
      const totals = await fetchJson(totalsUrl);
      receipts = totals.results?.[0]?.receipts ?? null;
    } catch {
      receipts = null;
    }
    committees.push({
      id: c.committee_id,
      name: c.name,
      type: c.committee_type_full || c.committee_type || "",
      receipts
    });
  }
  const result = {
    ok: true,
    source: "FEC",
    asOf: new Date().toISOString(),
    note: "PAC receipts are committee money, separate from LDA lobbying spend.",
    committees
  };
  writeCache(db, cacheKey, result, TTL);
  return result;
}

/** Receipts this cycle for the PAC ids joined in data/tickers.json. No name search, so no guessed committees. */
export async function fecForCommittees(db, ids) {
  const apiKey = process.env.FEC_API_KEY || "";
  if (!apiKey) return { ok: false, missing: "FEC_API_KEY", committees: [] };
  const year = new Date().getUTCFullYear();
  const cycle = year % 2 ? year + 1 : year;
  if (!ids.length) return { ok: true, source: "FEC", cycle, note: "No corporate PAC is joined to this ticker.", committees: [] };
  const cacheKey = KEY.fecCommittees(cycle, ids);
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const committees = [];
  let failed = false;
  for (const id of ids) {
    const totals = new URL(`https://api.open.fec.gov/v1/committee/${id}/totals/`);
    totals.searchParams.set("api_key", apiKey);
    totals.searchParams.set("cycle", String(cycle));
    const info = new URL(`https://api.open.fec.gov/v1/committee/${id}/`);
    info.searchParams.set("api_key", apiKey);
    const slow = (url) => fetchJson(url, {}, 30000).catch(() => fetchJson(url, {}, 30000)).catch(() => null);
    const [body, meta] = await Promise.all([slow(totals), slow(info)]);
    if (!body) failed = true;
    const row = body?.results?.[0];
    committees.push({
      id,
      name: meta?.results?.[0]?.name || id,
      receipts: row?.receipts ?? null,
      disbursements: row?.disbursements ?? null,
      coverageEnd: row?.coverage_end_date ? String(row.coverage_end_date).slice(0, 10) : null
    });
  }
  const result = {
    ok: true,
    source: "FEC (openFEC committee totals)",
    asOf: new Date().toISOString(),
    cycle,
    note: `${cycle - 1}–${cycle} cycle totals through each committee's latest report. Separate from LDA lobbying spend.`,
    committees
  };
  if (!failed) writeCache(db, cacheKey, result, TTL);
  return result;
}
