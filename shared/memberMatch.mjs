/**
 * Member name search over the local roster. Pure: shared by /api/search (server) and the ⌘K command line (browser).
 * Every query word must hit a name word (exact, prefix, or inside a hyphenated last name), the state code,
 * or the bioguide id. A lone two-letter postal code lists that state; "NJ-10" finds the seat; "aoc" style
 * initials match only when nothing else does.
 */

const POSTAL = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "AS", "GU", "MP", "PR", "VI"
]);

export function normName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'"’]/g, "");
}

function words(value) {
  return normName(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function nameWords(m) {
  const set = new Set([...words(m.name), ...words(m.first), ...words(m.last), ...words(m.nickname)]);
  const joined = normName(m.last).replace(/[^a-z0-9]/g, "");
  if (joined) set.add(joined);
  return [...set];
}

function initials(m) {
  const lastParts = words(m.last);
  return [m.first, m.nickname]
    .map((given) => words(given)[0])
    .filter(Boolean)
    .map((given) => given[0] + lastParts.map((part) => part[0]).join(""));
}

function wordScore(q, m, names) {
  if (m.bioguide && q === m.bioguide.toLowerCase()) return 10;
  let best = 0;
  for (const w of names) {
    if (w === q) return 3;
    if (q.length >= 2 && w.startsWith(q)) best = Math.max(best, 2);
  }
  if (!best && q.length === 2 && q === String(m.state || "").toLowerCase()) best = 1;
  return best;
}

function scoreMember(qWords, phrase, m) {
  const names = nameWords(m);
  let total = 0;
  for (const q of qWords) {
    const s = wordScore(q, m, names);
    if (!s) return 0;
    total += s;
  }
  const last = words(m.last);
  if (qWords.some((q) => last.includes(q))) total += 2;
  const full = [m.name, `${m.first} ${m.last}`, m.nickname ? `${m.nickname} ${m.last}` : ""].map((v) => words(v).join(" "));
  if (full.includes(phrase)) total += 5;
  return total;
}

const order = (a, b) =>
  b.score - a.score ||
  (a.m.chamber === "senate" ? 0 : 1) - (b.m.chamber === "senate" ? 0 : 1) ||
  String(a.m.last).localeCompare(String(b.m.last));

/** Roster rows ({ bioguide, name, first, last, nickname?, state, district, chamber }) ranked best first. */
export function matchMembers(roster, query, limit = 8) {
  const raw = String(query || "").trim();
  if (!raw) return [];
  const upper = raw.toUpperCase();

  const seat = /^([A-Z]{2})-?(\d{1,2}|AL)$/.exec(upper);
  if (seat && POSTAL.has(seat[1])) {
    const district = seat[2] === "AL" ? 0 : Number(seat[2]);
    return roster
      .filter((m) => m.chamber === "house" && m.state === seat[1] && (Number(m.district) || 0) === district)
      .slice(0, limit);
  }
  if (POSTAL.has(upper)) {
    return roster
      .filter((m) => m.state === upper)
      .map((m) => ({ m, score: 0 }))
      .sort(order)
      .slice(0, limit)
      .map((r) => r.m);
  }

  const qWords = words(raw);
  if (!qWords.length) return [];
  const phrase = qWords.join(" ");
  let ranked = roster.map((m) => ({ m, score: scoreMember(qWords, phrase, m) })).filter((r) => r.score > 0);
  if (!ranked.length && qWords.length === 1 && qWords[0].length >= 2) {
    ranked = roster.filter((m) => initials(m).includes(qWords[0])).map((m) => ({ m, score: 1 }));
  }
  return ranked.sort(order).slice(0, limit).map((r) => r.m);
}
