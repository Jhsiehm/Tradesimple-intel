/** SEC bulk files for insider history: the quarterly Insider Transactions Data Sets and the EDGAR daily index. */
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { secGate, secJson, secText } from "./sec.mjs";
import { secUserAgent } from "../lib/ua.mjs";

export const DATASET_PAGE = "https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets";

export const datasetPage = () => secText(DATASET_PAGE, { timeoutMs: 30000 });

/** Streams `url` to `file` through the shared SEC gate (one request). Returns bytes written. */
export function secDownload(url, file, { timeoutMs = 10 * 60_000 } = {}) {
  return secGate(async () => {
    const res = await fetch(url, { headers: { "User-Agent": secUserAgent() }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
    return fs.statSync(file).size;
  });
}

/** Daily-index files listed for one quarter (names like form.20261001.idx). */
export async function dailyIndexNames(year, qtr) {
  const body = await secJson(`https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${qtr}/index.json`, { timeoutMs: 30000 });
  return (body?.directory?.item || []).map((i) => i.name).filter((n) => /^form\.\d{8}\.idx$/.test(n));
}

export const dailyFormIdx = (year, qtr, name) => secText(`https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${qtr}/${name}`, { timeoutMs: 60000 });
