import { fetchJson } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";

const TTL = 30 * 60 * 1000;

export async function lobbyingForClient(db, clientName) {
  const apiKey = process.env.LDA_API_KEY || "";
  if (!apiKey) return { ok: false, missing: "LDA_API_KEY", filings: [] };
  const cacheKey = `lda:${clientName.toLowerCase()}`;
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const url = new URL("https://lda.senate.gov/api/v1/filings/");
  url.searchParams.set("client_name", clientName);
  url.searchParams.set("filing_year", "2025");
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
    source: "Senate LDA",
    asOf: new Date().toISOString(),
    filings
  };
  writeCache(db, cacheKey, result, TTL);
  return result;
}

export async function fecForName(db, name) {
  const apiKey = process.env.FEC_API_KEY || "";
  if (!apiKey) return { ok: false, missing: "FEC_API_KEY", committees: [] };
  const cacheKey = `fec:${name.toLowerCase()}`;
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
