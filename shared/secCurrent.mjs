/**
 * Pure rules for EDGAR's "latest filings" Atom feed (browse-edgar?action=getcurrent): the feeds polled, entry
 * parsing, grouping the per-party entries of one accession, matching issuers to watched tickers by CIK, how many
 * pages a poll needs, and detection-latency stats (detected − EDGAR acceptance).
 */

/**
 * One poll per feed. `type` is a prefix match on EDGAR's side (type=4 also returns 424B2, 40-F…), so `forms` is the
 * exact filter. `role` is the party entry that names the company the filing is about.
 */
export const CURRENT_FEEDS = [
  { id: "form4", type: "4", forms: ["4", "4/A"], role: "Issuer", label: "Form 4" },
  { id: "8k", type: "8-K", forms: ["8-K", "8-K/A"], role: "Filer", label: "8-K" },
  { id: "13d", type: "SCHEDULE 13D", forms: ["SCHEDULE 13D", "SCHEDULE 13D/A", "SC 13D", "SC 13D/A"], role: "Subject", label: "13D" },
  { id: "13g", type: "SCHEDULE 13G", forms: ["SCHEDULE 13G", "SCHEDULE 13G/A", "SC 13G", "SC 13G/A"], role: "Subject", label: "13G" }
];

export const CURRENT_PAGE = 100;
/** Pages read per feed per poll when the newest page does not reach back to the last poll. */
export const CURRENT_MAX_PAGES = 3;

export function currentUrl(type, { start = 0, count = CURRENT_PAGE } = {}) {
  const q = new URLSearchParams({ action: "getcurrent", type, company: "", dateb: "", owner: "include", start: String(start), count: String(count), output: "atom" });
  return `https://www.sec.gov/cgi-bin/browse-edgar?${q}`;
}

const decode = (s) => String(s || "")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, "&");

const tag = (xml, name) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : "";
};

const isoOf = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
};

/**
 * Entries of one Atom page: `{ form, name, cik, role, accession, acceptedAt, filed, link, items }`. `acceptedAt` is
 * the entry's `<updated>` (EDGAR acceptance, to the second, as UTC ISO); `items` are 8-K item numbers from the summary.
 * Entries without an accession are skipped and counted in `skipped`.
 */
export function parseCurrentAtom(xml) {
  const text = String(xml || "");
  const head = text.slice(0, text.indexOf("<entry>") >= 0 ? text.indexOf("<entry>") : text.length);
  const entries = [];
  let skipped = 0;
  for (const m of text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const title = decode(tag(e, "title"));
    const t = /^(.+?) - (.*) \((\d{10})\) \(([^)]+)\)\s*$/.exec(title);
    const accession = /accession-number=(\d{10}-\d{2}-\d{6})/.exec(e)?.[1] || "";
    if (!t || !accession) { skipped += 1; continue; }
    const summary = decode(tag(e, "summary"));
    const term = /<category\b[^>]*\bterm="([^"]+)"/.exec(e)?.[1];
    entries.push({
      form: decode(term || t[1]).trim(),
      name: t[2].trim(),
      cik: t[3],
      role: t[4].trim(),
      accession,
      acceptedAt: isoOf(tag(e, "updated")),
      filed: /Filed:<\/b>\s*(\d{4}-\d{2}-\d{2})/.exec(summary)?.[1] || "",
      link: /<link\b[^>]*\bhref="([^"]+)"/.exec(e)?.[1] || "",
      items: [...summary.matchAll(/Item (\d+\.\d+)/g)].map((x) => x[1])
    });
  }
  return { updated: isoOf(tag(head, "updated")), entries, skipped };
}

/** One filing per accession with every party entry, for the forms `forms` (exact match). Feed order is kept. */
export function groupFilings(entries, forms) {
  const want = new Set(forms);
  const out = new Map();
  for (const e of entries) {
    if (!want.has(e.form)) continue;
    let f = out.get(e.accession);
    if (!f) out.set(e.accession, (f = { accession: e.accession, form: e.form, acceptedAt: e.acceptedAt, filed: e.filed, link: e.link, items: e.items, parties: [] }));
    f.parties.push({ cik: e.cik, name: e.name, role: e.role });
    if (!f.items.length && e.items.length) f.items = e.items;
  }
  return [...out.values()];
}

/** CIK (as a number) → join-table symbols, for the tickers given (data/tickers.json rows). */
export function cikIndex(tickers) {
  const out = new Map();
  for (const t of tickers || []) {
    const n = Number(t?.cik);
    if (!(n > 0)) continue;
    if (!out.has(n)) out.set(n, []);
    if (!out.get(n).includes(t.symbol)) out.get(n).push(t.symbol);
  }
  return out;
}

/**
 * `{ symbol, cik, filing, filer }` for each filing whose `role` party is a watched issuer. `filer` is the first other
 * party (the reporting owner of a Form 4, the holder filing a 13D/G). A company that is only the filer of someone
 * else's 13D/G or the owner on someone else's Form 4 does not match.
 */
export function matchFilings(filings, feed, index) {
  const out = [];
  for (const f of filings) {
    const issuer = f.parties.find((p) => p.role === feed.role);
    if (!issuer) continue;
    const symbols = index.get(Number(issuer.cik)) || [];
    const filer = f.parties.find((p) => p !== issuer) || null;
    for (const symbol of symbols) out.push({ symbol, cik: issuer.cik, issuer: issuer.name, filing: f, filer });
  }
  return out;
}

/** Newest acceptance time on a page (ms), 0 when none. */
export function newestAccepted(entries) {
  return entries.reduce((m, e) => Math.max(m, Date.parse(e.acceptedAt) || 0), 0);
}

/**
 * Whether another page is needed: the page is full and its oldest entry is still newer than the last poll's newest
 * (`sinceMs`). Never on the first poll (no `sinceMs`): one page is the starting point.
 */
export function needsNextPage(entries, sinceMs, pageSize = CURRENT_PAGE) {
  if (!sinceMs || entries.length < pageSize) return false;
  const oldest = entries.reduce((m, e) => Math.min(m, Date.parse(e.acceptedAt) || Infinity), Infinity);
  return oldest > sinceMs;
}

/** Entries accepted after `sinceMs` (all entries when there is no previous poll). */
export function newSince(entries, sinceMs) {
  return sinceMs ? entries.filter((e) => (Date.parse(e.acceptedAt) || 0) > sinceMs) : entries;
}

/** `{ n, medianMs, p90Ms, maxMs }` of detection latencies; nulls when there are none. */
export function latencyStats(samples) {
  const xs = (samples || []).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!xs.length) return { n: 0, medianMs: null, p90Ms: null, maxMs: null };
  const at = (q) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];
  return { n: xs.length, medianMs: at(0.5), p90Ms: at(0.9), maxMs: xs[xs.length - 1] };
}

const sec = (ms) => (ms == null ? "?" : ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** "detected a median 41 s after EDGAR acceptance (p90 68 s, 212 filings)", or "" with no samples. */
export function latencyNote(stats) {
  if (!stats?.n) return "";
  return `detected a median ${sec(stats.medianMs)} after EDGAR acceptance (p90 ${sec(stats.p90Ms)}, ${stats.n} filing${stats.n === 1 ? "" : "s"})`;
}

/** `<PERIOD>` (YYYYMMDD) from an EDGAR -index-headers.html page, as YYYY-MM-DD; "" when absent. */
export function headerPeriod(html) {
  const m = /<PERIOD>\s*(\d{4})(\d{2})(\d{2})/.exec(String(html || "")) || /CONFORMED PERIOD OF REPORT:\s*(\d{4})(\d{2})(\d{2})/.exec(String(html || ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
