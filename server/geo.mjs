import { STATES, districtGeoid, parseDistrict } from "../shared/districts.mjs";

/** Postal → state FIPS, from shared/districts.mjs. */
export const POSTAL = Object.fromEntries(Object.entries(STATES).map(([postal, s]) => [postal, s.fips]));

export const FIPS_TO_POSTAL = Object.fromEntries(Object.entries(POSTAL).map(([k, v]) => [v, k]));

/** Full state or territory name (as in states.geojson and Congress.gov) → postal. */
export const STATE_NAME_TO_POSTAL = Object.fromEntries(Object.entries(STATES).map(([postal, s]) => [s.name, postal]));

/**
 * cd119 GEOID for a House member's state (postal or name) and district number; 0 or "AL" is the at-large or
 * delegate seat. Null when the seat does not exist in the 119th Congress.
 */
export function houseGeoid(state, district) {
  const rawState = String(state || "");
  const postal = POSTAL[rawState.toUpperCase()] ? rawState.toUpperCase() : STATE_NAME_TO_POSTAL[rawState];
  if (!postal) return null;
  const raw = String(district ?? "").toUpperCase();
  if (!raw || raw === "NULL" || raw === "UNDEFINED") return null;
  const n = raw === "AL" ? 0 : Number(raw);
  if (!Number.isFinite(n)) return null;
  return districtGeoid(parseDistrict(`${postal}-${n === 0 ? "AL" : n}`)) || null;
}

const STAGES = ["introduced", "committee", "markup", "reported", "floor", "passed chamber", "enrolled", "became law"];

export function stageFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/became public law|became law|signed by president/.test(t)) return "became law";
  if (/enrolled/.test(t)) return "enrolled";
  if (/passed senate|passed house|agreed to in senate|agreed to in house/.test(t)) return "passed chamber";
  if (/placed on senate legislative calendar|placed on house calendar|rule provides|consideration/.test(t)) return "floor";
  if (/reported|ordered to be reported/.test(t)) return "reported";
  if (/markup/.test(t)) return "markup";
  if (/referred to|committee/.test(t)) return "committee";
  if (/introduced|received/.test(t)) return "introduced";
  return null;
}

export function ladderFromActions(actions) {
  let highest = 0;
  const hits = [];
  const seen = new Set();
  for (const action of actions) {
    const text = action.text || action.latestAction?.text || "";
    const stage = stageFromText(text);
    if (!stage) continue;
    const date = action.actionDate || action.date || null;
    const sig = `${date}|${text}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const idx = STAGES.indexOf(stage);
    hits.push({ stage, date, text });
    if (idx > highest) highest = idx;
  }
  return {
    stages: STAGES.map((name, index) => ({
      name,
      reached: index <= highest && hits.length > 0
    })),
    current: hits.length ? STAGES[highest] : "introduced",
    actions: hits.slice(-8).reverse()
  };
}
