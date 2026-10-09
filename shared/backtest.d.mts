import type { BacktestRules } from "./backtestSpec.mjs";

export type Bar = [day: number, open: number | null, close: number];
export type BacktestSignal = {
  id: string;
  symbol: string;
  signalDate: string;
  side: "buy" | "sell";
  sizeHint?: number | null;
  sizeIsRange?: boolean;
  tradeDate?: string;
  actor?: string;
  actorLabel?: string;
  sector?: string;
};
export type BacktestTrade = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  actor: string;
  actorLabel: string;
  signal: string;
  traded: string;
  entry: string;
  exit: string;
  entryPrice: number | null;
  exitPrice: number | null;
  ret: number | null;
  bench: number | null;
  excess: number | null;
  days: number;
  why: string;
  open: boolean;
  benchmark: string;
};
export type BacktestBreakdown = {
  key: string; label: string; n: number; avg: number | null; median: number | null; hitRate: number | null; avgExcess: number | null; beatRate: number | null;
};
export type BacktestStats = {
  trades: number; total: number | null; annualized: number | null; benchmarkTotal: number | null; benchmarkAnnualized: number | null;
  excessTotal: number | null; excessAnnualized: number | null; hitRate: number | null; beatRate: number | null; avgTrade: number | null;
  medianTrade: number | null; avgExcess: number | null; medianExcess: number | null; excessT: number | null; best: number | null; worst: number | null;
  avgHoldDays: number | null; maxDrawdown: number | null; drawdownFrom: string; drawdownTo: string; benchmarkMaxDrawdown: number | null;
  volatility: number | null; sharpeish: number | null; infoRatioish: number | null; maxConcurrent: number; avgConcurrent: number | null;
  activeShare: number | null; from: string; to: string; spanDays: number; sharpeNote: string; weighting: string;
};
export type BacktestCaveats = {
  items: { level: "info" | "warn"; id: string; text: string }[];
  lag?: { n: number; median: number | null; mean: number | null; p90: number | null; max: number; over45: number } | null;
  exclusions?: Record<string, number>;
  excludedSymbols?: Record<string, string[]>;
};
export type BacktestResult = {
  ok: true;
  rules: BacktestRules;
  counts: { signals: number; used: number; skipped: number };
  trades: BacktestTrade[];
  byMember: { total: number; rows: BacktestBreakdown[] };
  byTicker: { total: number; rows: BacktestBreakdown[] };
  curve: { d: string; s: number | null; b: number | null }[];
  stats: BacktestStats | null;
  caveats: BacktestCaveats;
};

export const ENTRY_SLACK_DAYS: number;
export const SIZE_CAP: number;
export const MIN_TRADES: number;
export function dayOf(iso: string): number | null;
export function isoOf(day: number): string;
export function firstAfter(bars: Bar[], day: number): number;
export function lastOnOrBefore(bars: Bar[], day: number): number;
export function median(xs: number[]): number | null;
export function amountMid(text: string, low?: number): number;
export function maxDrawdown(values: number[], labels?: string[]): { depth: number; from: string | number; to: string | number };
export function simulateTrade(signal: unknown, bars: Bar[], bench: Bar[], rules: BacktestRules, signalDay: number, sign: 1 | -1): { skip?: string; trade?: Record<string, unknown> };
export function runBacktest(input: {
  signals?: BacktestSignal[];
  bars?: Record<string, Bar[]>;
  benchBars?: Record<string, Bar[]>;
  rules?: unknown;
  context?: { notes?: { level?: "info" | "warn"; id?: string; text: string }[]; paperFilings?: number; unparsed?: number; rangeAmounts?: boolean; unpriced?: string[] };
  calendar?: Bar[] | null;
}): BacktestResult;
