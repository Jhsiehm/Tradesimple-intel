import { fetchJsonRetry, makeGate } from "../lib/http.mjs";

export const USASPENDING = "https://api.usaspending.gov/api/v2";

/** USAspending blocks a client's IP for a while after bursts of a few dozen requests per second. */
export const usaspendingGate = makeGate(2, 300);

/** POST a search body to `/api/v2/search/<pathname>/` through the shared gate, with retries. */
export function usaspendingSearch(pathname, body, { timeoutMs = 45000, retries = 2, priority = false } = {}) {
  return fetchJsonRetry(`${USASPENDING}/search/${pathname}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, { timeoutMs, retries, gate: usaspendingGate, priority });
}
