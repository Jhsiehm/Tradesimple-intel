import { fetchJson, fetchText, makeGate } from "../lib/http.mjs";
import { gateSpacing } from "../lib/env.mjs";
import { secUserAgent } from "../lib/ua.mjs";

/** SEC fair access allows 10 requests per second per client; one gate for every SEC call keeps us at 8. */
export const secGate = makeGate(4, gateSpacing(125));

const headers = (accept) => ({ headers: { "User-Agent": secUserAgent(), ...(accept ? { Accept: accept } : {}) } });

export function secJson(url, { timeoutMs = 20000, priority = false } = {}) {
  return secGate(() => fetchJson(url, headers(), timeoutMs), { priority });
}

export function secText(url, { timeoutMs = 20000, accept = "", priority = false } = {}) {
  return secGate(() => fetchText(url, headers(accept), timeoutMs), { priority });
}

/** Full submissions JSON for a filer (CIK as stored, or padded to ten digits by the caller). */
export function secSubmissionsJson(cik, opts) {
  return secJson(`https://data.sec.gov/submissions/CIK${cik}.json`, opts);
}
