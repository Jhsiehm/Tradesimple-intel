import type { AlertLevel } from "./intel.mjs";

export type LiveCheck = {
  id: "sec" | "whales" | "congress" | "contracts" | "lobbying" | "news";
  label: string;
  covers: string[];
  everyMs: number;
  maxMs: number;
  precision: "time" | "day" | "none";
  source: string;
  publishes: string;
  needs?: string;
};

export type LiveStatus = {
  id: string;
  label: string;
  source: string;
  everyMs: number;
  publishes: string;
  lastChecked: string;
  lastOk: string;
  nextAt: string;
  failures: number;
  lastError: string;
  ms: number | null;
  note: string;
  off: string;
  running: boolean;
  symbols: number;
};

/** The event shape shared/watchlist.mjs builds, as far as the live rules read it. */
export type LiveEvent = {
  id: string;
  symbol: string;
  source: string;
  feed?: string;
  title: string;
  detail?: string;
  who?: string;
  chamber?: string;
  side?: string;
  amount?: number | null;
  amountLabel?: string;
  eventAt?: string;
  publishedAt?: string;
  lag?: number | null;
  late?: boolean;
  planned?: boolean;
  buys?: number;
  activist?: boolean;
  change?: string;
  items?: string[];
  link?: string;
  simulated?: boolean;
  kind?: string;
  severity?: AlertLevel;
};

export type LiveInfo = {
  seq: number;
  symbol: string;
  source: string;
  eventAt: string;
  publishedAt: string;
  detectedAt: string;
  filingLagDays: number | null;
  filingLag: string;
  detectionLagMs: number | null;
  detectionLagDays: number | null;
  detection: string;
  precision: "time" | "day" | "none" | "backfill";
  backfill: boolean;
  simulated: boolean;
};

export type LiveAlertRow = {
  id: string;
  kind: string;
  date: string;
  at: string;
  title: string;
  detail: string;
  link: string;
  action: string;
  late: boolean;
  severity: AlertLevel;
  source: string;
  pins: { kind: "symbol"; id: string; label: string }[];
  live: LiveInfo;
};

export const LIVE_CHECKS: LiveCheck[];
export function checkOf(id: string): LiveCheck | null;
export function checkFor(source: string): LiveCheck | null;
export function nextDelay(check: { everyMs: number; maxMs: number }, failures?: number, retryAfterMs?: number): number;
export function durationLabel(ms: number | null | undefined): string;
export function detectionLag(ev: LiveEvent, detectedAt: string | number, backfill?: boolean): { ms: number | null; days: number | null; precision: LiveInfo["precision"]; label: string };
export function filingLagLabel(ev: LiveEvent): string;
export function predatesWatch(ev: LiveEvent, primedAt: string | number, precision: LiveCheck["precision"]): boolean;
export function liveAlertRow(ev: LiveEvent, opts?: { detectedAt?: string | number; backfill?: boolean; seq?: number }): LiveAlertRow;
export function headlineKey(title: string): string;
export function dedupeHeadlines<T extends { title: string; published?: string }>(items: T[]): T[];
export function textHash(value: string): string;
export function checkHealth(status: LiveStatus | null | undefined, now?: number): "off" | "failing" | "late" | "ok" | "waiting";
