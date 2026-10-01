// Pure matching rules for scripts/joins.mjs. Kept separate so tests can import them without network calls.

const SUFFIX = new Set(["INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "COMPANIES", "LLC", "LTD", "LIMITED", "PLC", "NV", "SA", "AG", "HOLDINGS", "HOLDING", "GROUP", "THE", "AND", "DE", "USA", "US"]);

/** Company name reduced to its comparable core: "PROCTER & GAMBLE Co" and "Procter and Gamble" both become "PROCTER AND GAMBLE". */
export function norm(value) {
  const words = String(value || "")
    .toUpperCase()
    .replace(/\s*\/\s*[A-Z]{2,3}\s*\/?\s*$/g, "")
    .replace(/\(?\bCLASS [A-C]\b\)?/g, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words[0] === "THE") words.shift();
  while (words.length > 1 && SUFFIX.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** LDA client names whose normalized form equals one of the targets, collapsed so the lobbying lookup's substring match covers variants. */
export function ldaMatches(names, targets) {
  const hits = [...new Set(names.map((n) => String(n).trim()).filter((n) => targets.includes(norm(n))))].sort((a, b) => a.length - b.length);
  const strip = (s) => s.toUpperCase().replace(/[.,]/g, "");
  const keep = [];
  for (const name of hits) if (!keep.some((k) => strip(name).includes(strip(k)))) keep.push(name);
  return keep;
}

/** Census 119th-CD record to the join table's "ST-NN" code; null for at-large and delegate seats. */
export function districtCode(state, cd) {
  const base = String(cd?.BASENAME || "");
  return /^[A-Z]{2}$/.test(state || "") && /^\d+$/.test(base) ? `${state}-${base.padStart(2, "0")}` : null;
}

const DIVISION = new Set(["SYSTEMS", "DEFENSE", "AEROSPACE", "SPACE", "AERONAUTICS", "SERVICES", "SOLUTIONS", "TECHNOLOGIES", "TECHNOLOGY", "GOVERNMENT", "FEDERAL", "PUBLIC", "SECTOR", "MISSION", "INTERNATIONAL", "GLOBAL", "ELECTRONIC", "ELECTRONICS"]);

/**
 * Whether a USAspending parent recipient name belongs to a join token. Exact after norm() always counts.
 * Multi-word tokens may add division words ("LOCKHEED MARTIN SPACE"); single-word tokens may not,
 * so "APPLE" never reaches "APPLE TEN ALABAMA SERVICES" or "APPLETON MARINE".
 */
export function contractParentMatch(token, parent) {
  const t = norm(token);
  const p = norm(parent);
  if (!t || !p) return false;
  if (p === t) return true;
  if (!t.includes(" ") || !p.startsWith(`${t} `)) return false;
  return p.slice(t.length + 1).split(" ").every((w) => DIVISION.has(w));
}

/** FEC committee-master lines (pipe-delimited) to a map of normalized connected organization → corporate PAC ids. */
export function pacsByOrg(lines) {
  const byOrg = new Map();
  for (const line of lines) {
    const c = line.split("|");
    if (!c[0] || !["C", "W"].includes(c[12]) || !["Q", "N"].includes(c[9])) continue;
    const key = norm(c[13]);
    if (key.length < 4) continue;
    const set = byOrg.get(key) || new Set();
    set.add(c[0]);
    byOrg.set(key, set);
  }
  return byOrg;
}
