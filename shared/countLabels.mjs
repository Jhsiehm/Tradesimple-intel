/**
 * Counts and what they count, pure. A number the answer pins to a unit ("117 tickers") must appear in a tool result
 * under a key or beside words about the same thing; finding 117 only as `unparsedPaperFilings` is a mislabel the
 * plain number check cannot see. No network, no clock.
 */

/** Unit words in an answer → the family of things they count. */
const UNITS = [
  ["tickers", /^(tickers?|symbols?|stocks?|compan(?:y|ies)|issuers?|equities)$/],
  ["trades", /^(trades?|transactions?|purchases?|sales?|buys?|sells?|positions?)$/],
  ["signals", /^signals?$/],
  ["filings", /^(filings?|reports?|disclosures?|forms?|ptrs?|documents?)$/],
  ["members", /^(members?|senators?|representatives?|politicians?|lawmakers?)$/],
  ["insiders", /^(insiders?|executives?|officers?|directors?)$/],
  ["contracts", /^(contracts?|awards?)$/],
  ["hearings", /^(hearings?|meetings?)$/],
  ["votes", /^(votes?|roll ?calls?)$/]
];

/** Words in a tool result's key path or text that say a count is of that family. */
const FAMILY = {
  tickers: /ticker|symbol|stock|compan|issuer|equit/,
  trades: /trade|transaction|used|position|purchase|sale|buy|sell/,
  signals: /signal|matched|offered/,
  filings: /filing|report|form|disclosure|ptr|document|paper/,
  members: /member|senator|representative|politician|lawmaker|bioguide|person|people|actor/,
  insiders: /insider|owner|officer|director|executive|person|people/,
  contracts: /contract|award|action|obligation/,
  hearings: /hearing|meeting/,
  votes: /vote|roll/
};

/** Keys that say nothing about what they count; a match there gets the benefit of the doubt. */
const GENERIC = /^(n|count|total|rows|items|size|length|value|result|\d+)$/;

const unitFamily = (word) => UNITS.find(([, re]) => re.test(String(word).toLowerCase()))?.[0] || "";
const words = (s) => String(s).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const ADJ = "(?:[a-z][\\w-]*\\s+){0,2}?";
const UNIT_WORDS = "tickers?|symbols?|stocks?|compan(?:y|ies)|issuers?|equities|trades?|transactions?|purchases?|sales?|buys?|sells?|positions?|signals?|filings?|reports?|disclosures?|forms?|ptrs?|documents?|members?|senators?|representatives?|politicians?|lawmakers?|insiders?|executives?|officers?|directors?|contracts?|awards?|hearings?|meetings?|votes?|roll ?calls?";

/**
 * Whole-number counts the answer ties to a unit: "117 tickers", "117 distinct tickers", "Tickers: 117",
 * "| Tickers | 117 |". `{ raw, value, unit, family }`. Percentages, money, and decimals are not counts.
 */
export function countClaims(answer) {
  const s = String(answer || "").replace(/\[t\d+(?:\s*,\s*t\d+)*\]/g, " ");
  const out = [];
  const after = new RegExp(`(?<![\\w.$%])(\\d[\\d,]*)(?![\\d.,]*\\s?(?:%|bps|[kKmMbB]\\b))\\s+${ADJ}(${UNIT_WORDS})\\b`, "gi");
  for (const m of s.matchAll(after)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (Number.isInteger(value)) out.push({ raw: m[0].replace(/\s+/g, " ").trim(), value, unit: m[2].toLowerCase(), family: unitFamily(m[2]) });
  }
  const before = new RegExp(`\\b(${UNIT_WORDS})\\s*(?::|=|\\|)\\s*(\\d[\\d,]*)(?![\\d.,]*\\s?(?:%|bps|[kKmMbB]\\b))(?![\\w.])`, "gi");
  for (const m of s.matchAll(before)) {
    const value = Number(m[2].replace(/,/g, ""));
    if (Number.isInteger(value) && !out.some((c) => c.value === value && c.family === unitFamily(m[1]))) out.push({ raw: m[0].replace(/\s+/g, " ").trim(), value, unit: m[1].toLowerCase(), family: unitFamily(m[1]) });
  }
  return out.filter((c) => c.family);
}

/**
 * Every place `value` appears in a tool result: a numeric field's key path ("counts.unparsedPaperFilings"), or the
 * words right after it in a text field ("scanned paper filings in the"), plus "Label: 117" text before it.
 */
export function labelsFor(body, value) {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === "number") { if (v === value) out.push(`${GENERIC.test(path.at(-1) || "") ? "?" : ""}${path.slice(-2).join(".")}`); return; }
    if (typeof v === "string") {
      for (const m of v.matchAll(/(?<![\w.])(\d[\d,]*)(?![\d.,]*\d)/g)) {
        if (Number(m[1].replace(/,/g, "")) !== value) continue;
        const next = v.slice(m.index + m[0].length).trim().split(/\s+/).slice(0, 4).join(" ");
        const prev = /([A-Za-z][\w ]{0,40}):\s*$/.exec(v.slice(Math.max(0, m.index - 42), m.index))?.[1] || "";
        out.push([path.at(-1) || "", prev, next].filter(Boolean).join(" "));
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, path)); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  walk(body, []);
  return out;
}

/**
 * Count claims whose number the tools state only as something else: `[{ raw, value, unit, foundAs }]`. A claim
 * whose number appears nowhere is the plain grounding check's business; numbers up to 10 are too common to judge.
 */
export function mislabeledCounts(answer, bodies) {
  const out = [];
  for (const c of countClaims(answer)) {
    if (c.value <= 10 || out.some((x) => x.raw === c.raw)) continue;
    const labels = bodies.flatMap((b) => labelsFor(b, c.value));
    if (!labels.length) continue;
    if (labels.some((l) => FAMILY[c.family].test(words(l)))) continue;
    // A generic total gets the benefit of the doubt unless the same number is also a named count of something else.
    if (labels.some((l) => l.startsWith("?")) && !labels.some((l) => /^counts\./.test(l))) continue;
    out.push({ raw: c.raw, value: c.value, unit: c.unit, foundAs: [...new Set(labels)].slice(0, 3) });
  }
  return out.slice(0, 6);
}

/** The caveat a mislabeled count gets in the answer. */
export function mislabelNote(m) {
  return `The answer says “${m.raw}”, but ${m.value} in the tool results is ${m.foundAs.map((l) => `“${l.replace(/^\?/, "")}”`).join(" / ")}, not a count of ${m.unit}. Treat that figure as mislabeled.`;
}
