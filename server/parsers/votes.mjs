export function normalizeVote(value) {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("yea") || v.startsWith("aye") || v === "yes") return "Yea";
  if (v.startsWith("nay") || v === "no") return "Nay";
  if (v.includes("present")) return "Present";
  return "Not voting";
}

export function normalizeParty(value) {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("d") || v.includes("democrat")) return "D";
  if (v.startsWith("r") || v.includes("republican")) return "R";
  if (v.startsWith("i") || v.includes("independent")) return "I";
  return v ? "I" : "";
}

export function countVotes(positions) {
  const totals = { Yea: 0, Nay: 0, Present: 0, "Not voting": 0 };
  for (const p of positions) totals[p.vote] = (totals[p.vote] || 0) + 1;
  return totals;
}
