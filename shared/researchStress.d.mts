import type { BacktestRules } from "./backtestSpec.mjs";
import type { BacktestResult, BacktestSignal, Bar } from "./backtest.mjs";
export const STRESS_VERSION: number;
export type PriceShock = { date: string; changePct: number; symbols: string[] };
export type PriceChange = {
  symbol: string;
  series: string;
  factor: number;
  affectedBars: number;
  firstAffectedDate: string | null;
};
export type StressScenario = {
  priceShock?: PriceShock;
  sourceIds?: string[];
  id: string;
  label: string;
  delayDays: number;
  missingPct: number;
  seed: number;
  extraCostBps: number;
  extraSlippageBps: number;
};
export type StressBase = {
  signals: BacktestSignal[];
  bars: Record<string, Bar[]>;
  benchBars: Record<string, Bar[]>;
  rules: BacktestRules;
  context?: Record<string, unknown>;
  calendar?: Bar[] | null;
};
export type StressDecision = {
  signalId: string;
  symbol: string;
  originalPublicDate: string;
  scenarioPublicDate: string;
  reason: "missing-signal" | "retained";
};
export type StressReport = {
  kind: "single-source-stress";
  version: number;
  baseline: BacktestResult;
  scenarios: {
    scenario: StressScenario;
    priceChanges?: PriceChange[];
    removed: number;
    retained: number;
    decisions: StressDecision[];
    result: BacktestResult;
    delta: Record<"total" | "benchmarkTotal" | "excessTotal" | "maxDrawdown", number> | null;
  }[];
  caveats: string[];
};
export function cleanStressScenarios(
  input: unknown,
  rules: BacktestRules,
  options?: { sourceIds?: string[]; priceSeries?: Record<string, Bar[]> },
): StressScenario[];
export function stressInputs(
  base: StressBase,
  scenario: StressScenario,
  maxSignals?: number,
): { inputs: StressBase; decisions: StressDecision[]; removed: number };
export function runStress(input: { base: StressBase; scenarios: unknown }): StressReport;
export type MultiStressReport = {
  version: number;
  kind: "convergence-stress";
  baseline: import("./convergence.mjs").ConvergenceReport;
  scenarios: {
    scenario: StressScenario;
    priceChanges?: PriceChange[];
    removed: number;
    retained: number;
    decisions: (Omit<StressDecision, "reason"> & {
      reason: string;
      sourceId: string;
      sourceLabel: string;
      targeted: boolean;
      originalPeriod: string | null;
    })[];
    result: import("./convergence.mjs").ConvergenceReport;
  }[];
  caveats: string[];
};
export function runStress(input: {
  base: import("./convergence.mjs").ConvergenceInput;
  scenarios: unknown;
}): MultiStressReport;

export function stressPriceSeries(base: {
  bars?: Record<string, Bar[]>;
  benchBars?: Record<string, Bar[]>;
}): Record<string, Bar[]>;
export function shockPrices<T extends { bars?: Record<string, Bar[]>; benchBars?: Record<string, Bar[]> }>(
  base: T,
  shock?: PriceShock,
): { inputs: T; priceChanges: PriceChange[] };
