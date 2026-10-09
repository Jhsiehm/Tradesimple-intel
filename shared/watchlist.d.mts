export type WatchSourceKey = "congress" | "insiders" | "whales" | "stakes" | "contracts" | "lobbying" | "filings" | "news";

export type F4Line = { code: string; side: string; shares: number | null; price: number | null; value: number | null; plan: boolean; traded: string; owned: number | null };

export type WatchEvent = {
  id: string;
  symbol: string;
  source: WatchSourceKey;
  feed: string;
  title: string;
  detail: string;
  who: string;
  side: "buy" | "sell" | "";
  amount: number | null;
  amountLabel: string;
  eventAt: string;
  publishedAt: string;
  lag: number | null;
  late: boolean;
  link: string;
  /** Set by groupRepeats: identical lines in one report shown as one row ("2×"). */
  repeat?: number;
  ids?: string[];
  bioguide?: string;
  chamber?: string;
  party?: string;
  state?: string;
  role?: string;
  planned?: boolean;
  buys?: number;
  lines?: F4Line[];
  change?: string;
  shares?: number | null;
  delta?: number | null;
  quarter?: string;
  form?: string;
  activist?: boolean;
  amend?: boolean;
  percent?: number | null;
  issues?: string[];
  period?: string;
  items?: string[];
};

export type WatchBadge = { count: number; newest: string; age: string };
export type WatchAlertRow = {
  id: string; kind: string; date: string; eventAt: string; filedAt: string; title: string; detail: string; link: string; action: string; late: boolean;
  severity: "high" | "elevated" | "routine"; source: string; pins: { kind: "symbol"; id: string; label: string }[];
};

export const WATCH_MAX: number;
export const BADGE_DAYS: number[];
export const FEED_DAYS: number;
export const LATE_DAYS: number;
export const WATCH_SOURCES: { key: WatchSourceKey; label: string; short: string }[];
export const ITEMS_8K: Record<string, string>;
export const CONTRACT_ALERT_MIN: number;
export const WHALE_ALERT_SHARE: number;

export function normSymbol(s: unknown): string;
export function cleanTickers(list: Iterable<string>, known: Set<string>, max?: number): { valid: string[]; invalid: string[] };
export function addSymbol(list: string[], symbol: string, max?: number): string[];
export function removeSymbol(list: string[], symbol: string): string[];
export function moveSymbol(list: string[], symbol: string, delta: number): string[];
export function matchTickers<T extends { symbol: string; name?: string }>(tickers: T[], query: string, n?: number): T[];
export function lagDays(eventAt: string | null | undefined, publishedAt: string | null | undefined): number | null;
export function ageLabel(iso: string | null | undefined, now?: number): string;
export function shownAt(e: { publishedAt?: string; eventAt?: string }): string;

export function congressEvent(t: Record<string, any>): WatchEvent;
export function insiderEvents(rows: Record<string, any>[]): WatchEvent[];
export function whaleEvent(r: Record<string, any>): WatchEvent;
export function stakeEvent(f: Record<string, any>): WatchEvent;
export function contractEvent(a: Record<string, any>, symbol: string): WatchEvent;
export function lobbyingEvent(l: Record<string, any>, symbol: string): WatchEvent;
export function filingEvent(f: Record<string, any>): WatchEvent;
export function newsEvent(n: Record<string, any>, symbol: string): WatchEvent;

export function mergeEvents(events: WatchEvent[]): WatchEvent[];
export function groupRepeats(events: WatchEvent[]): WatchEvent[];
export function namesTicker(item: { title?: string; summary?: string } | null | undefined, ticker: { symbol?: string; name?: string }): boolean;
export function withinDays(events: WatchEvent[], days: number, now?: number): WatchEvent[];
export function badgesOf(events: WatchEvent[], days: number, now?: number): Partial<Record<WatchSourceKey, WatchBadge>>;
export function watchAlertRows(events: WatchEvent[], since?: string, opts?: { news?: boolean }): WatchAlertRow[];
