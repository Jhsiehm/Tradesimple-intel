/** Delegate seats (DC, PR, territories) never cast floor roll calls. */
const DELEGATE_FIPS = new Set(["11", "60", "66", "69", "72", "78"]);
const CAST_ORDER = ["Yea", "Nay", "Present", "Not voting"];

/** One district's fill: the member who sat for this roll call, Vacant when nobody did, "" when the party filter hides them. */
export function houseCategory(geoid, here, party = "all") {
  if (DELEGATE_FIPS.has(String(geoid).slice(0, 2))) return "Delegate";
  if (!here.length) return "Vacant";
  const shown = here.filter((p) => party === "all" || (p.party || "I") === party);
  if (!shown.length) return "";
  return [...shown].sort((a, b) => CAST_ORDER.indexOf(a.vote) - CAST_ORDER.indexOf(b.vote))[0].vote;
}

/** A state's fill from its senators' casts. With a party filter, only that party's senators count. */
export function senateCategory(votes, filtered = false) {
  if (!votes.length) return filtered ? "" : "Vacant";
  const yea = votes.filter((v) => v === "Yea").length;
  const nay = votes.filter((v) => v === "Nay").length;
  const rest = votes.every((v) => v === "Present") ? "Present" : "Not voting";
  if (filtered) return yea && nay ? "Split" : yea ? "Yea" : nay ? "Nay" : rest;
  if (yea === 2) return "Yea";
  if (nay === 2) return "Nay";
  if (yea && nay) return "Split";
  if (yea) return "Half yea";
  if (nay) return "Half nay";
  return rest;
}
