import type { BacktestRules } from "./backtestSpec.mjs";
export type ExecutionAssessment = {
  version: 1;
  classification: "exploratory_signal_return_simulation";
  executablePortfolio: false;
  liveTradingValidated: false;
  curveBasis: string;
  tradeBasis: string;
  shortTrades: number;
  markedOpenTrades: number;
  gates: { id: string; status: "unverified" | "unmodeled" | "assumed" | "not_applicable"; detail: string }[];
  costSensitivity: {
    scope: "mean_trade_return_only";
    currentOneWayBps: number;
    includesRebalancing: false;
    includesBorrowOrImpact: false;
    scenarios: { oneWayBps: number; meanTradeReturn: number | null }[];
  };
};
export function assessExecution(input: {
  rules: BacktestRules;
  trades?: { side: string; open: boolean; ret: number }[];
  calendar?: unknown[] | null;
}): ExecutionAssessment;
