/**
 * Insider history backfill and incremental update. Quarters from the SEC Insider Transactions Data Sets first (each
 * zip downloaded to the temp dir, streamed into sqlite, deleted), then every EDGAR daily index after the newest
 * quarter. Done quarters and days are recorded with the join-table fingerprint, so a rerun only fetches what is new
 * (or what a changed join needs). SEC traffic goes through the shared 8 req/s gate; daily Form 4 reads are held
 * to about 4 per second here so a backfill next to a running API stays under SEC's limit.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { datasetPage, dailyFormIdx, dailyIndexNames, secDownload } from "../feeds/secBulk.mjs";
import { parseDatasetLinks, nextQuarter, quarterBounds, quarterOf } from "../parsers/form345.mjs";
import { makeGate } from "../lib/http.mjs";
import { HOUR } from "../lib/time.mjs";
import { form4 } from "../domain/positions/insiders.mjs";
import { ingestDailyIdx, ingestDatasetZip } from "../domain/positions/insiderIngest.mjs";
import { STORE_START, doneOf, dropLease, getMeta, joinsByCik, markDone, setMeta, storeStatus, takeLease } from "../domain/positions/insiderStore.mjs";

const STORE_QUARTER_START = quarterOf(STORE_START);

const LEASE_MS = 2 * HOUR;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const rss = () => mb(process.memoryUsage().rss);
const isoToday = () => new Date().toISOString().slice(0, 10);

/** SEC reads, swappable in tests. */
const SEC_IO = { page: datasetPage, download: secDownload, dailyNames: dailyIndexNames, dailyIdx: dailyFormIdx, read: form4 };

/** Quarters done, in order, from `since` with no gap: the span the data sets cover completely. */
function contiguous(done, since, joins) {
  const out = [];
  for (let q = since; done.get(q)?.joins === joins; q = nextQuarter(q)) out.push(q);
  return out;
}

/**
 * Runs one pass. `quarters: false` skips the data sets, `daily: false` the daily index. Returns a summary;
 * `skipped` names why nothing ran (another writer holds the lease).
 */
export async function updateInsiderHistory(db, { since = STORE_QUARTER_START, quarters = true, daily = true, log = () => {}, dir = os.tmpdir(), owner = `pid:${process.pid}`, io = SEC_IO, today = isoToday() } = {}) {
  if (!takeLease(db, owner, LEASE_MS)) return { skipped: "another insider-history update is running" };
  const t0 = Date.now();
  const summary = { quarters: [], days: [], errors: [] };
  try {
    const { byCik, joins } = joinsByCik(db);
    if (quarters) {
      const links = parseDatasetLinks(await io.page()).filter((l) => l.quarter >= since);
      const done = doneOf(db, "quarter");
      const todo = links.filter((l) => done.get(l.quarter)?.joins !== joins);
      log(`insiders: ${links.length} quarterly data sets from ${since} listed; ${links.length - todo.length} already stored, ${todo.length} to read (${byCik.size} join-table CIKs)`);
      for (const [i, link] of todo.entries()) {
        const file = path.join(dir, `tradesimple-${link.quarter}_form345.zip`);
        const t1 = Date.now();
        try {
          const bytes = await io.download(link.url, file);
          const t2 = Date.now();
          const got = await ingestDatasetZip(db, file, { byCik });
          markDone(db, "quarter", link.quarter, { joins, forms: got.forms, rows: got.rows, url: link.url });
          summary.quarters.push({ quarter: link.quarter, ...got });
          log(`insiders: [${i + 1}/${todo.length}] ${link.quarter}: ${mb(bytes)} in ${((t2 - t1) / 1000).toFixed(1)} s; ${got.forms} forms (${got.amendments} 4/A), ${got.rows} rows in ${secs(t2)}; rss ${rss()}`);
        } catch (err) {
          summary.errors.push(`${link.quarter}: ${err.message}`);
          log(`insiders: ${link.quarter} failed: ${err.message}`);
        } finally {
          fs.rmSync(file, { force: true });
        }
      }
    }
    const qDone = contiguous(doneOf(db, "quarter"), since, joins);
    if (!qDone.length) {
      setMeta(db, "coverage", null);
      return { ...summary, ms: Date.now() - t0 };
    }
    const datasetThrough = quarterBounds(qDone.at(-1)).to;
    let through = datasetThrough;
    if (daily) {
      const daysDone = doneOf(db, "day");
      const read = makeGate(1, 250);
      const reader = (d, cik, pick) => read(() => io.read(d, cik, pick));
      let gap = false;
      for (let q = nextQuarter(qDone.at(-1)); q <= quarterOf(today); q = nextQuarter(q)) {
        const [year, n] = [q.slice(0, 4), q.slice(5)];
        let names = [];
        try { names = (await io.dailyNames(year, n)).sort(); } catch (err) {
          if (err.status !== 404) { summary.errors.push(`daily ${q}: ${err.message}`); gap = true; }
          continue;
        }
        for (const name of names) {
          const day = name.slice(5, 13);
          const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
          if (iso <= datasetThrough) continue;
          if (daysDone.has(day)) { if (!gap) through = iso; continue; }
          const t1 = Date.now();
          try {
            const got = await ingestDailyIdx(db, await io.dailyIdx(year, n, name), { byCik, read: reader });
            summary.days.push({ day, ...got });
            log(`insiders: daily ${iso}: ${got.listed} Form 4/4A listed for join-table CIKs, ${got.known} already stored, ${got.read} read, ${got.failed} failed, ${got.rows} rows in ${secs(t1)}`);
            if (got.failed) { gap = true; summary.errors.push(`daily ${iso}: ${got.failed} forms could not be read; the day is retried next run`); continue; }
            markDone(db, "day", day, { joins, forms: got.forms, rows: got.rows, url: name });
            if (!gap) through = iso;
          } catch (err) {
            gap = true;
            summary.errors.push(`daily ${iso}: ${err.message}`);
            log(`insiders: daily ${iso} failed: ${err.message}`);
          }
        }
      }
    }
    setMeta(db, "coverage", { from: quarterBounds(qDone[0]).from, through, datasetThrough });
    return { ...summary, coveredFrom: quarterBounds(qDone[0]).from, coveredThrough: through, ms: Date.now() - t0 };
  } catch (err) {
    summary.errors.push(err.message);
    return { ...summary, ms: Date.now() - t0 };
  } finally {
    setMeta(db, "lastUpdate", new Date().toISOString());
    setMeta(db, "lastError", summary.errors[0] || null);
    dropLease(db, owner);
  }
}

/** The API's scheduled refresh: new quarters and days only, and only once a backfill has stored a first quarter. */
export async function refreshInsiderHistory(db) {
  if (!getMeta(db, "coverage")) return null;
  const out = await updateInsiderHistory(db, { log: (s) => console.log(s) }).catch((err) => ({ errors: [err.message] }));
  if (out?.errors?.length) console.error("insider history:", out.errors[0]);
  return storeStatus(db);
}
