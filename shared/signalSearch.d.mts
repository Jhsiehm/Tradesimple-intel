import type { Bar, BacktestSignal } from "./backtest.mjs";
import type { BacktestSpec } from "./backtestSpec.mjs";
import type { Interval, RealityLevel } from "./backtestStats.mjs";

export type SearchVariant = { id: string; dim: string; label: string; spec: BacktestSpec; signals: BacktestSignal[] };
export type SearchRow = {
  id: string; dim: string; label: string; spec: BacktestSpec; signals: number; n: number;
  stats: { avgExcess: number | null; avgTrade: number | null; excessTotal: number | null; total: number | null; benchmarkTotal: number | null; hitRate: number | null; beatRate: number | null; from: string; to: string } | null;
  ci?: Interval | null; members?: number; nEff?: number | null; t?: number | null; p?: number | null; pBasis?: "member" | "week";
};
export type SearchFinding = SearchRow & {
  q: number | null; passes: boolean;
  placebo?: { pct: number | null; p: number | null; iters: number } | null;
  verdict?: { level: RealityLevel; text: string };
};
export type SearchRanking = {
  built: number; tested: number; passing: number; findings: SearchFinding[];
  untested: { id: string; dim: string; label: string; n: number; signals: number }[];
};
export type SearchOutcome = SearchRanking & { minTrades: number; fdr: number; seed: number; warning: string };

export const SEARCH: { minTrades: number; fdr: number; top: number; minMembersForMemberCluster: number };
export function bhQValues(ps: number[]): number[];
export function evaluateVariant(input: { variant: SearchVariant; bars: Record<string, Bar[]>; benchBars: Record<string, Bar[]>; seed?: number }): SearchRow;
export function rankFindings(rows: SearchRow[], opts?: { minTrades?: number; fdr?: number }): SearchRanking;
export function searchWarning(r: { built: number; tested: number; passing: number }, opts?: { minTrades?: number; fdr?: number }): string;
export function evaluateVariants(input: {
  variants: SearchVariant[]; bars: Record<string, Bar[]>; benchBars: Record<string, Bar[]>;
  minTrades?: number; fdr?: number; top?: number; seed?: number; onProgress?: (done: number, total: number) => void;
}): SearchOutcome;
