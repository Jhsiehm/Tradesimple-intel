import { readCache, writeCache } from "../../lib/db.mjs";
import { secJson } from "../../feeds/sec.mjs";
import { HOUR } from "../../lib/time.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";

export async function secSubmissions(db, cik) {
  const key = KEY.secSubs(cik);
  const hit = readCache(db, key);
  if (hit) return hit;
  const body = await secJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const slim = {
    name: body.name,
    filings: {
      recent: {
        form: (body.filings?.recent?.form || []).slice(0, 200),
        accessionNumber: (body.filings?.recent?.accessionNumber || []).slice(0, 200),
        filingDate: (body.filings?.recent?.filingDate || []).slice(0, 200),
        primaryDocument: (body.filings?.recent?.primaryDocument || []).slice(0, 200)
      }
    }
  };
  writeCache(db, key, slim, 2 * HOUR);
  return slim;
}
