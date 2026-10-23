import type { BacktestBreakdown, BacktestStats } from "./backtest.mjs";
import type { BacktestRules } from "./backtestSpec.mjs";

export function r4(value: number | null | undefined): number | null;
export function r2(value: number | null | undefined): number | null;
export function mean(values: number[]): number | null;
export function median(values: number[]): number | null;
export function pctile(values: number[], percentile: number): number | null;
export function maxDrawdown(
  values: number[],
  labels?: string[],
): { depth: number; from: string | number; to: string | number; peak: number; trough: number };
export function breakdown<T extends { ret: number; excess: number }>(
  trades: T[],
  keyOf: (trade: T) => string,
  labelOf: (trade: T) => string,
  limit?: number,
): { total: number; rows: BacktestBreakdown[] };
export function backtestMetrics(
  trades: { ret: number; excess: number; days: number }[],
  curve: {
    days: number[];
    s: number[];
    b: number[];
    R: number[];
    B: number[];
    labels: string[];
    maxOpen: number;
    avgOpen: number;
    activeDays: number;
  },
  rules: BacktestRules,
  sizeCap: number,
): { curve: { d: string; s: number | null; b: number | null }[]; stats: BacktestStats };
