import { readCache, writeCache } from "../../lib/db.mjs";
import { secJson } from "../../feeds/sec.mjs";
import { HOUR } from "../../lib/time.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";

const KEEP_ALL = 200;

/**
 * A filer's recent filings: the newest 200 of every form plus every Form 4 SEC lists as recent (up to about a year
 * or 1,000 filings), so a backtest window can reach past the newest 200. `listStarts` is the oldest date in SEC's
 * recent list and `complete` is false when SEC keeps older filings in separate pages this does not read.
 */
export function slimSubmissions(body) {
  const r = body?.filings?.recent || {};
  const keep = [];
  for (let i = 0; i < (r.form || []).length; i += 1) if (i < KEEP_ALL || r.form[i] === "4") keep.push(i);
  const col = (name) => keep.map((i) => (r[name] || [])[i]);
  const dates = r.filingDate || [];
  return {
    name: body?.name,
    listStarts: dates.length ? dates[dates.length - 1] : "",
    complete: !(body?.filings?.files || []).length,
    filings: { recent: { form: col("form"), accessionNumber: col("accessionNumber"), filingDate: col("filingDate"), primaryDocument: col("primaryDocument") } }
  };
}

export async function secSubmissions(db, cik) {
  const key = KEY.secSubs(cik);
  const hit = readCache(db, key);
  if (hit) return hit;
  const slim = slimSubmissions(await secJson(`https://data.sec.gov/submissions/CIK${cik}.json`));
  writeCache(db, key, slim, 2 * HOUR);
  return slim;
}
