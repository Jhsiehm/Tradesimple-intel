/**
 * web_search and web_fetch for Ask: read-only, through the adapter in server/feeds/web.mjs. A search result is split
 * into one cited step per page by the runner (shared/webAsk.mjs splitWebResults); a fetched page is one step.
 */
import { webPage, webSearch } from "../feeds/web.mjs";
import { WEB_LABEL, webStep } from "../../shared/webAsk.mjs";

export const runWebSearch = (args = {}, opts = {}) => webSearch(args.query || args.q, opts);

/** One page as text with its step fields; failures keep the URL so the step says what was tried. */
export async function runWebFetch(args = {}, opts = {}) {
  const page = await webPage(args.url, opts);
  if (!page.ok) return { ok: false, error: page.error, url: page.url, source: `${page.url || "page"} (${WEB_LABEL})`, asOf: "", latency: "" };
  const step = webStep({ url: page.url, title: page.title, retrievedAt: page.retrievedAt, via: "a direct page fetch" });
  return { ok: true, url: page.url, title: page.title, text: page.text, source: step.source, asOf: step.asOf, latency: `${step.latency} Fetched in ${page.fetchMs} ms.`, stepLabel: step.label };
}
