import { fetchJson } from "../lib/http.mjs";
import { BROWSER_UA } from "../lib/ua.mjs";

/** api.nasdaq.com refuses requests without a browser agent. */
export const NASDAQ_HEADERS = { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } };

export function nasdaqJson(pathAndQuery, timeoutMs = 20000) {
  return fetchJson(`https://api.nasdaq.com/api/${pathAndQuery}`, NASDAQ_HEADERS, timeoutMs);
}
