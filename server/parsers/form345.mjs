/**
 * SEC Insider Transactions Data Sets (quarterly Form 3/4/5 tables, tab-separated) and EDGAR form.idx listings.
 * Pure: rows in, the same per-form shape parseForm4 returns out, so the store and the live path share form4Rows.
 */
import { titleCase } from "./form4.mjs";

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "28-SEP-2026" (the data sets' format), "20260928" (daily index) or ISO → "2026-09-28"; anything else → "". */
export function secDay(value) {
  const s = String(value || "").trim();
  let m = /^(\d{2})-([A-Z]{3})-(\d{4})$/i.exec(s);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1]}`;
  m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** "2026q3" for a day; quarter bounds; the quarters from one key to another inclusive. */
export const quarterOf = (day) => `${day.slice(0, 4)}q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
export function quarterBounds(key) {
  const y = Number(key.slice(0, 4));
  const q = Number(key.slice(5));
  const end = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
  return { from: `${y}-${String(q * 3 - 2).padStart(2, "0")}-01`, to: end };
}
export function nextQuarter(key) {
  const y = Number(key.slice(0, 4));
  const q = Number(key.slice(5));
  return q === 4 ? `${y + 1}q1` : `${y}q${q + 1}`;
}

/** Quarterly zip links on the data set page, oldest first. The path prefix has changed over time, so links are read, not built. */
export function parseDatasetLinks(html, base = "https://www.sec.gov") {
  const seen = new Map();
  for (const m of String(html).matchAll(/href="([^"]*?\/(\d{4}q[1-4])_form345\.zip)"/gi)) {
    const quarter = m[2].toLowerCase();
    if (!seen.has(quarter)) seen.set(quarter, new URL(m[1], base).href);
  }
  return [...seen].map(([quarter, url]) => ({ quarter, url })).sort((a, b) => a.quarter.localeCompare(b.quarter));
}

/** A header-keyed reader for one TSV table: `row(line)` → { COLUMN: value }. */
export function tsvReader(headerLine) {
  const cols = String(headerLine).replace(/^\uFEFF/, "").split("\t").map((c) => c.trim());
  return (line) => {
    const cells = line.split("\t");
    const row = {};
    for (let i = 0; i < cols.length; i += 1) row[cols[i]] = cells[i] ?? "";
    return row;
  };
}

const truthy = (v) => v === "1" || /^true$/i.test(String(v || "").trim());

/** SUBMISSION.tsv row → the form's identity. AFF10B5ONE (the Rule 10b5-1 checkbox) exists from April 2023. */
export function submissionOf(row) {
  return {
    accession: String(row.ACCESSION_NUMBER || "").trim(),
    filed: secDay(row.FILING_DATE),
    form: String(row.DOCUMENT_TYPE || "").trim().toUpperCase(),
    issuerCik: Number(row.ISSUERCIK) || 0,
    issuerSymbol: String(row.ISSUERTRADINGSYMBOL || "").trim().toUpperCase(),
    checked: truthy(row.AFF10B5ONE)
  };
}

/** REPORTINGOWNER.tsv row → name and role as parseForm4 reads them (officer title, else Director, else 10% owner). */
export function ownerOf(row) {
  const rel = String(row.RPTOWNER_RELATIONSHIP || "");
  const title = String(row.RPTOWNER_TITLE || "").trim() || (/Director/i.test(rel) ? "Director" : "") || (/TenPercentOwner/i.test(rel) ? "10% owner" : "");
  return { owner: titleCase(String(row.RPTOWNERNAME || "").trim()), title };
}

/** A footnote that names a Rule 10b5-1 plan (the same test parseForm4 applies to the XML footnotes). */
export const plansNote = (text) => /10b5-1/i.test(String(text || ""));

/** Footnote ids a transaction row cites, from every *_FN column ("F1,F3"). */
export function footnoteIds(row) {
  const ids = [];
  for (const [k, v] of Object.entries(row)) if (k.endsWith("_FN") && v) for (const id of String(v).split(/[,\s]+/)) if (id) ids.push(id);
  return ids;
}

/** NONDERIV_TRANS.tsv row → one transaction line, with the surrogate key kept for document order. */
export function transLineOf(row) {
  return {
    sk: Number(row.NONDERIV_TRANS_SK) || 0,
    date: secDay(row.TRANS_DATE),
    code: String(row.TRANS_CODE || "").trim().toUpperCase(),
    shares: Number(row.TRANS_SHARES) || 0,
    price: Number(row.TRANS_PRICEPERSHARE) || null,
    ad: String(row.TRANS_ACQUIRED_DISP_CD || "").trim(),
    owned: Number(row.SHRS_OWND_FOLWNG_TRANS) || null,
    notes: footnoteIds(row)
  };
}

/**
 * One form in parseForm4's shape. A line's `plan` is true when a footnote it cites names a 10b5-1 plan; when no
 * footnote in the form does, it follows the checkbox.
 */
export function parsedOf(sub, owner, lines, planIds = new Set()) {
  return {
    owner: owner?.owner || "",
    title: owner?.title || "",
    plan10b5: sub.checked || planIds.size > 0,
    issuerCik: String(sub.issuerCik || ""),
    issuerSymbol: sub.issuerSymbol,
    lines: [...lines].sort((a, b) => a.sk - b.sk).map(({ sk: _sk, notes, ...line }) => ({ ...line, plan: planIds.size ? notes.some((id) => planIds.has(id)) : sub.checked }))
  };
}

/**
 * EDGAR form.idx (full-index or daily-index): Form 4 and 4/A rows as { form, company, cik, filed, file, accession }.
 * Columns are split from the right because form types and company names contain spaces.
 */
export function parseFormIdx(text, forms = new Set(["4", "4/A"])) {
  const out = [];
  let body = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (!body) { if (/^-{10,}/.test(line)) body = true; continue; }
    const m = /^(.+?)\s{2,}(.*?)\s+(\d{1,10})\s+(\d{8}|\d{4}-\d{2}-\d{2})\s+(edgar\/\S+)\s*$/.exec(line);
    if (!m || !forms.has(m[1].trim())) continue;
    const file = m[5];
    out.push({ form: m[1].trim(), company: m[2].trim(), cik: Number(m[3]), filed: secDay(m[4]), file, accession: file.split("/").pop().replace(/\.txt$/, "") });
  }
  return out;
}
