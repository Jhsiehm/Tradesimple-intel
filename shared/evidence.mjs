/** Pure evidence normalization. Missing data is never replaced with a zero. */
export function isoDate(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function months(from, to) {
  if (!isoDate(from) || !isoDate(to) || from > to)
    throw new Error("Use valid action dates with start on or before end.");
  const out = [];
  let start = from;
  while (start <= to) {
    const d = new Date(start);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const end = new Date(+next - 86400000).toISOString().slice(0, 10);
    out.push({ from: start, to: end < to ? end : to });
    start = next.toISOString().slice(0, 10);
  }
  return out;
}
export function normalizeContract(raw, mapping, observedAt) {
  const str = (...keys) => {
    for (const k of keys) if (raw[k] != null && raw[k] !== "") return String(raw[k]);
    return "";
  };
  const award = str("generated_internal_id", "contract_award_unique_key");
  const mod = str("Mod", "modification_number");
  const date = str("Action Date", "action_date").slice(0, 10);
  const uei = str("Recipient UEI", "recipient_uei").toUpperCase();
  const amountValue = raw["Transaction Amount"] ?? raw.federal_action_obligation;
  const amount =
    amountValue == null || String(amountValue).trim() === "" || !Number.isFinite(Number(amountValue))
      ? null
      : Number(amountValue);
  const unique = str("contract_transaction_unique_key");
  const identityBasis = unique
    ? "source-transaction-key"
    : award && mod && isoDate(date)
      ? "award-modification-action-date; collision review required"
      : "unresolved";
  const recordKey = unique || (identityBasis !== "unresolved" ? `${award}|${mod}|${date}` : null);
  const matches = mapping.filter((m) => m.uei === uei);
  const symbols = [...new Set(matches.map((m) => m.symbol))];
  const pop = raw["Primary Place of Performance"] || {};
  return {
    recordKey,
    identityBasis,
    award,
    awardNumber: str("Award ID", "award_id_piid"),
    mod,
    actionDate: isoDate(date) ? date : null,
    recipient: str("Recipient Name", "recipient_name"),
    uei,
    symbol: symbols.length === 1 ? symbols[0] : null,
    identityStatus:
      symbols.length === 1
        ? "current-recipient-match; historical ownership unverified"
        : symbols.length > 1
          ? "ambiguous-recipient"
          : "unmapped-recipient",
    amount,
    agency: str("Awarding Agency", "awarding_agency_name"),
    subAgency: str("Awarding Sub Agency", "awarding_sub_agency_name"),
    description: str("Transaction Description", "transaction_description"),
    naics: raw.NAICS ?? raw.naics_code ?? null,
    psc: raw.PSC ?? raw.product_or_service_code ?? null,
    place: Object.keys(pop).length
      ? pop
      : {
          state: raw.primary_place_of_performance_state_code || null,
          district: raw.primary_place_of_performance_congressional_district || null,
        },
    sourceUpdatedAt: str("last_modified_date") || null,
    firstObservedAt: observedAt,
    verifiedPublishedAt: null,
    sourceUrl: award ? `https://www.usaspending.gov/award/${encodeURIComponent(award)}` : null,
  };
}
export function availableDate(record, policy) {
  if (policy.mode === "verified") {
    if (!record.verifiedPublishedAt) return null;
    return record.verifiedPublishedAt.slice(0, 10);
  }
  if (policy.mode === "observed") return record.firstObservedAt.slice(0, 10);
  if (policy.mode !== "assumed" || !record.actionDate) throw new Error("Unknown timing policy.");
  const agency = String(record.agency || "").trim();
  if (!agency) return null;
  const lag =
    /department of defense|department of war|\bdod\b|department of the army|department of the navy|department of the air force|space force|marine corps/i.test(
      agency,
    )
      ? policy.defenseDays
      : policy.civilianDays;
  if (!Number.isInteger(lag) || lag < 1 || lag > 365) throw new Error("Assumed delays must be 1–365 days.");
  return new Date(Date.parse(record.actionDate) + lag * 86400000).toISOString().slice(0, 10);
}
export function obligationFeatures(records) {
  const byAgency = new Map(),
    byMonth = new Map();
  let positive = 0,
    negative = 0,
    missing = 0;
  for (const r of records) {
    if (r.amount == null) {
      missing++;
      continue;
    }
    if (r.amount >= 0) positive += r.amount;
    else negative += r.amount;
    for (const [map, key] of [
      [byAgency, r.agency || "Unknown"],
      [byMonth, r.actionDate?.slice(0, 7) || "Unknown"],
    ]) {
      const item = map.get(key) || { key, net: 0, positive: 0, negative: 0, transactions: 0 };
      item.net += r.amount;
      item.positive += Math.max(0, r.amount);
      item.negative += Math.min(0, r.amount);
      item.transactions++;
      map.set(key, item);
    }
  }
  return {
    formula:
      "Net = sum of signed transaction obligations; positive and negative sums reported separately. Not revenue, backlog, outlays or award ceilings.",
    positive,
    negative,
    net: positive + negative,
    missing,
    byAgency: [...byAgency.values()].sort((a, b) => b.positive - a.positive),
    byMonth: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}
