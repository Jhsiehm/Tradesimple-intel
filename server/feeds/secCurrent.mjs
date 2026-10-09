import { secText } from "./sec.mjs";
import { currentUrl } from "../../shared/secCurrent.mjs";

/** One page of EDGAR's latest-filings Atom feed, through the shared SEC gate. 403/429 errors keep their status. */
export function secCurrentAtom(type, { start = 0, count, timeoutMs = 15000 } = {}) {
  return secText(currentUrl(type, { start, count }), { timeoutMs, accept: "application/atom+xml" });
}

/** The SGML header page of one filing (period of report, items), through the shared SEC gate. */
export function secIndexHeaders(cik, accession, { timeoutMs = 15000 } = {}) {
  return secText(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${accession}-index-headers.html`, { timeoutMs });
}
