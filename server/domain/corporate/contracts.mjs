import { usaspendingSearch } from "../../feeds/usaspending.mjs";
import { secJson } from "../../feeds/sec.mjs";
import { readCache, writeCache } from "../../lib/db.mjs";
import { HOUR, DAY } from "../../lib/time.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";

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
  const usa = (pathname, body) => usaspendingSearch(pathname, body, { timeoutMs: 45000, retries: 2 }).catch((err) => { failures.push(err.message); return null; });
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
    const body = await secJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${pad}/us-gaap/${concept}.json`, { timeoutMs: 20000 }).catch(() => null);
    const annual = (body?.units?.USD || []).filter((u) => u.form === "10-K" && u.fp === "FY" && u.frame && /^CY\d{4}$/.test(u.frame));
    const last = annual.sort((a, b) => a.frame.localeCompare(b.frame)).at(-1);
    if (last && (!best || last.frame > best.frame)) best = { value: last.val, fy: Number(last.frame.slice(2)), frame: last.frame, concept };
  }
  writeCache(db, key, best, 7 * DAY);
  return best;
}
