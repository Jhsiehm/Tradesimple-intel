export type CurrentFeed = { id: "form4" | "8k" | "13d" | "13g"; type: string; forms: string[]; role: string; label: string };

export type CurrentEntry = {
  form: string;
  name: string;
  cik: string;
  role: string;
  accession: string;
  acceptedAt: string;
  filed: string;
  link: string;
  items: string[];
};

export type CurrentFiling = {
  accession: string;
  form: string;
  acceptedAt: string;
  filed: string;
  link: string;
  items: string[];
  parties: { cik: string; name: string; role: string }[];
};

export type CurrentMatch = { symbol: string; cik: string; issuer: string; filing: CurrentFiling; filer: { cik: string; name: string; role: string } | null };

export type LatencyStats = { n: number; medianMs: number | null; p90Ms: number | null; maxMs: number | null };

export const CURRENT_FEEDS: CurrentFeed[];
export const CURRENT_PAGE: number;
export const CURRENT_MAX_PAGES: number;

export function currentUrl(type: string, opts?: { start?: number; count?: number }): string;
export function parseCurrentAtom(xml: string): { updated: string; entries: CurrentEntry[]; skipped: number };
export function groupFilings(entries: CurrentEntry[], forms: string[]): CurrentFiling[];
export function cikIndex(tickers: { symbol: string; cik?: string | null }[]): Map<number, string[]>;
export function matchFilings(filings: CurrentFiling[], feed: CurrentFeed, index: Map<number, string[]>): CurrentMatch[];
export function newestAccepted(entries: CurrentEntry[]): number;
export function needsNextPage(entries: CurrentEntry[], sinceMs: number, pageSize?: number): boolean;
export function newSince(entries: CurrentEntry[], sinceMs: number): CurrentEntry[];
export function latencyStats(samples: number[]): LatencyStats;
export function latencyNote(stats: LatencyStats | null | undefined): string;
export function headerPeriod(html: string): string;
