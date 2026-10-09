import type { Bar, BacktestTrade } from "./backtest.mjs";
import type { BacktestRules } from "./backtestSpec.mjs";

export type Interval = { mean: number | null; lo: number | null; hi: number | null };
export type PlaceboResult = {
  iters: number; seed: number; actual: number | null; placeboMean: number | null; placeboLo: number | null; placeboHi: number | null;
  /** Share of placebo means strictly below the actual mean excess. */
  pct: number | null;
  /** One-sided: (1 + placebo means ≥ actual) / (iters + 1). */
  p: number | null;
  window: { from: number; to: number; tradingDays: number };
  missedDraws: number;
};
export type RealityLevel = "few" | "luck" | "mixed" | "tickers" | "bench" | "worse" | "beat";
export type Reality = {
  n: number;
  seed: number;
  bootstrap: { iters: number; blocks: number; meanTrade: Interval; meanExcess: Interval } | null;
  placebo: PlaceboResult | null;
  cluster: {
    members: number; weeks: number; t: number | null; df: number;
    /** max(clustered, iid): the SE the t uses. */
    se: number | null; seCluster: number | null; seIid: number | null;
    pOne: number | null; pTwo: number | null; nEff: number | null; topShare: number | null;
  } | null;
  verdict: { level: RealityLevel; text: string };
};
export type ClusteredT = { mean: number; se: number | null; seIid: number; t: number | null; df: number; clusters: number; pOne: number | null; pTwo: number | null };

export const REALITY: { version: number; seed: number; bootIters: number; placeboIters: number; alpha: number; draws: number; minTrades: number };
export function mulberry32(seed: number): () => number;
export function weekOf(day: number): number;
export function blockBootstrap(series: number[][], keys: (string | number)[], opts?: { iters?: number; seed?: number; alpha?: number }): { mean: number; lo: number; hi: number }[] | null;
export function lnGamma(z: number): number;
export function betaInc(x: number, a: number, b: number): number;
export function tCdf(t: number, df: number): number;
export function clusteredT(xs: number[], keys: (string | number)[]): ClusteredT | null;
export function conservativeT(c: ClusteredT | null): (ClusteredT & { seCluster?: number | null }) | null;
type TradeRow = Pick<BacktestTrade, "symbol" | "side" | "benchmark" | "signal" | "entry" | "exit" | "ret" | "excess"> & { actor?: string; actorLabel?: string };
export function placeboTest(input: { trades: TradeRow[]; bars: Record<string, Bar[]>; benchBars: Record<string, Bar[]>; rules: BacktestRules; calendar: Bar[] | null; iters?: number; seed?: number; draws?: number }): PlaceboResult | null;
export function realityCheck(input: {
  trades?: TradeRow[]; bars?: Record<string, Bar[]>; benchBars?: Record<string, Bar[]>; rules: BacktestRules; calendar?: Bar[] | null;
  seed?: number; bootIters?: number; placeboIters?: number; placebo?: boolean;
}): Reality;
export function pTxt(p: number | null | undefined): string;
export function realityVerdict(r: Partial<Reality> & { n: number }, benchmark?: string): { level: RealityLevel; text: string };
