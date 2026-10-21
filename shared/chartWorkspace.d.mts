export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number | null };
export const DAY: number;
export const INTERVALS: string[];
export const RANGES: string[];
export function retentionDays(interval: string): number;
export function windowStart(range: string, now?: number): number;
export function intervalReason(interval: string, range: string, now?: number): string;
export function defaultInterval(range: string): string;
export function mergeBars(...sets: Bar[][]): Bar[];
export function sma(values: number[], n: number): (number | null)[];
export function ema(values: number[], n: number): (number | null)[];
export function rsi(values: number[], n?: number): (number | null)[];
export function indicators(
  bars: Bar[],
  zone?: string,
): Record<"sma" | "sma50" | "ema" | "rsi" | "macd" | "signal" | "vwap", (number | null)[]>;
export type Layout = { version: number; mode: string; active: number; panels: { symbol: string; group: string }[] };
export function cleanLayout(raw: unknown): Layout;
export function requestGuard(): { next(): number; current(id: number): boolean };
export type ChartContext = {
  symbol: string;
  interval: string;
  from: string;
  to: string;
  events: Record<string, string | null>[];
};
export function cleanChartContext(raw: unknown): ChartContext | null;
export function calendarBucket(t: number, interval: string, zone?: string): number;
export function aggregateCalendar(bars: Bar[], interval: string, zone?: string): Bar[];
export function mergeTrailingQuote(bars: Bar[], interval: string): Bar[];
