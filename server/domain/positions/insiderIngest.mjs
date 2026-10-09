/**
 * Turns SEC bulk files into insider_tx rows. A quarterly data set zip is streamed table by table (SUBMISSION, then
 * REPORTINGOWNER, FOOTNOTES, NONDERIV_TRANS), keeping only Form 4 / 4/A of join-table issuers in memory. Daily-index
 * Form 4s are read one by one with the live path's parser. Both build rows with form4Rows, so ids and fields match.
 */
import { zipEntryLines } from "../../lib/zip.mjs";
import { ownerOf, parsedOf, parseFormIdx, plansNote, submissionOf, transLineOf, tsvReader } from "../../parsers/form345.mjs";
import { pool } from "../../lib/pool.mjs";
import { form4Rows } from "./insiders.mjs";
import { storedAccessions, writeForms } from "./insiderStore.mjs";

const FORMS = new Set(["4", "4/A"]);
const BATCH = 1500;

async function eachRow(file, table, fn) {
  let read = null;
  for await (const line of zipEntryLines(file, table)) {
    if (!read) { read = tsvReader(line); continue; }
    if (line) fn(read(line));
  }
}

/** Rows of one form for every join-table ticker of its issuer. */
function formOf(sub, parsed, byCik, source) {
  const rows = [];
  for (const ticker of byCik.get(Number(parsed.issuerCik) || sub.issuerCik) || []) rows.push(...form4Rows(ticker, { accession: sub.accession, filed: sub.filed }, parsed).rows);
  return { accession: sub.accession, issuerCik: Number(parsed.issuerCik) || sub.issuerCik, form: sub.form, rows, source };
}

/** One quarterly zip on disk → stored rows. Returns counts for the progress line and the ingest record. */
export async function ingestDatasetZip(db, file, { byCik }) {
  const subs = new Map();
  await eachRow(file, "SUBMISSION.tsv", (row) => {
    const sub = submissionOf(row);
    if (FORMS.has(sub.form) && byCik.has(sub.issuerCik) && sub.accession && sub.filed) subs.set(sub.accession, sub);
  });
  const owners = new Map();
  await eachRow(file, "REPORTINGOWNER.tsv", (row) => {
    const acc = row.ACCESSION_NUMBER;
    if (subs.has(acc) && !owners.has(acc)) owners.set(acc, ownerOf(row));
  });
  const plans = new Map();
  await eachRow(file, "FOOTNOTES.tsv", (row) => {
    const acc = row.ACCESSION_NUMBER;
    if (!subs.has(acc) || !plansNote(row.FOOTNOTE_TXT)) return;
    if (!plans.has(acc)) plans.set(acc, new Set());
    plans.get(acc).add(String(row.FOOTNOTE_ID || "").trim());
  });
  const lines = new Map();
  let lineCount = 0;
  await eachRow(file, "NONDERIV_TRANS.tsv", (row) => {
    const acc = row.ACCESSION_NUMBER;
    if (!subs.has(acc)) return;
    if (!lines.has(acc)) lines.set(acc, []);
    lines.get(acc).push(transLineOf(row));
    lineCount += 1;
  });
  let rows = 0;
  let batch = [];
  const flush = () => { if (batch.length) rows += writeForms(db, batch, "dataset").rows; batch = []; };
  for (const sub of subs.values()) {
    batch.push(formOf(sub, parsedOf(sub, owners.get(sub.accession), lines.get(sub.accession) || [], plans.get(sub.accession)), byCik, "dataset"));
    if (batch.length >= BATCH) flush();
  }
  flush();
  return { forms: subs.size, amendments: [...subs.values()].filter((s) => s.form !== "4").length, lines: lineCount, rows };
}

/**
 * One daily form.idx → stored rows for Form 4 / 4/A listed under a join-table CIK (as issuer or as reporting
 * owner; the form's own issuer CIK decides the ticker). Forms already stored are not read again.
 */
export async function ingestDailyIdx(db, text, { byCik, read, concurrency = 2 }) {
  const seen = new Map();
  for (const e of parseFormIdx(text)) if (byCik.has(e.cik) && !seen.has(e.accession)) seen.set(e.accession, e);
  const have = storedAccessions(db, [...seen.keys()]);
  const todo = [...seen.values()].filter((e) => !have.has(e.accession));
  const forms = [];
  let failed = 0;
  await pool(todo, concurrency, async (e) => {
    const parsed = await read(db, e.cik, { accession: e.accession, filed: e.filed, doc: `${e.accession}.txt` }).catch(() => null);
    if (!parsed) { failed += 1; return; }
    const issuer = Number(parsed.issuerCik) || e.cik;
    if (!byCik.has(issuer)) return;
    forms.push(formOf({ accession: e.accession, filed: e.filed, form: e.form, issuerCik: issuer }, parsed, byCik, "daily"));
  });
  const out = writeForms(db, forms, "daily");
  return { listed: seen.size, known: have.size, read: todo.length - failed, failed, forms: forms.length, rows: out.rows };
}
