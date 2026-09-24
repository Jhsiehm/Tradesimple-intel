import { fetchJson } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";

const TTL = 30 * 60 * 1000;

export async function awardsForRecipient(db, recipient) {
  const cacheKey = `usa:${recipient.toLowerCase()}`;
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const body = await fetchJson("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: {
        recipient_search_text: [recipient],
        award_type_codes: ["A", "B", "C", "D"]
      },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Start Date", "Awarding Agency"],
      limit: 8,
      page: 1,
      sort: "Start Date",
      order: "desc"
    })
  });
  const awards = (body.results || []).map((a) => ({
    id: a["Award ID"] || a.generated_internal_id,
    recipient: a["Recipient Name"],
    amount: a["Award Amount"],
    description: a.Description || "",
    start: a["Start Date"] || "",
    agency: a["Awarding Agency"] || ""
  }));
  const result = {
    ok: true,
    source: "USASpending",
    asOf: new Date().toISOString(),
    awards
  };
  writeCache(db, cacheKey, result, TTL);
  return result;
}
