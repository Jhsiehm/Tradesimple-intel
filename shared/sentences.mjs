/**
 * Plain-words phrasing for disclosed trades, shared by the landing feed, the bot, and share text.
 * Factual only: who, what, the disclosed range, when it was traded and filed, and the filing lag.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "$50,001 - $100,000" → "$50k–$100k"; "Over $50,000,000" → "over $50M"; "$2,722" stays exact. */
export function amountShort(text) {
  const raw = String(text || "").trim();
  const nums = [...raw.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!nums.length) return raw || "an undisclosed amount";
  const fmt = (n, low) => {
    const v = low && n % 1000 === 1 ? n - 1 : n;
    if (v >= 1e6) return `$${+(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M`;
    if (v >= 1e3 && v % 1000 === 0) return `$${v / 1e3}k`;
    return `$${v.toLocaleString("en-US")}`;
  };
  if (/^over/i.test(raw)) return `over ${fmt(nums[0], false)}`;
  if (nums.length === 1) return fmt(nums[0], false);
  return `${fmt(nums[0], true)}–${fmt(nums[1], false)}`;
}

export function verbOf(t) {
  if (t.side === "buy") return "bought";
  if (t.side === "sell") return /partial/i.test(t.type || "") ? "sold part of" : "sold";
  if (t.side === "exchange") return "exchanged";
  return "traded";
}

export function honorific(t) {
  return t.chamber === "senate" ? "Sen." : "Rep.";
}

/** "2026-09-03" → "Sep 3" in the reference year, "Sep 3, 2025" otherwise. */
export function dayLabel(iso, refYear) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "—";
  const label = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return refYear && Number(m[1]) === Number(refYear) ? label : `${label}, ${m[1]}`;
}

export function partyTag(t) {
  const seat = t.chamber === "house" && t.district ? String(t.district) : t.state || "";
  return [t.party, seat].filter(Boolean).join("-");
}

/** "Sen. Jane Doe (D-NY) sold $50k–$100k NVDA · traded Sep 3, filed Sep 25 (22d)" */
export function tradeSentence(t, { refYear, party = true } = {}) {
  const who = `${honorific(t)} ${t.person}${party && partyTag(t) ? ` (${partyTag(t)})` : ""}`;
  const what = t.symbol || t.asset || "an asset";
  const lag = t.lag != null ? ` (${t.lag}d)` : "";
  return `${who} ${verbOf(t)} ${amountShort(t.amount)} ${what} · traded ${dayLabel(t.traded, refYear)}, filed ${dayLabel(t.filed, refYear)}${lag}`;
}
