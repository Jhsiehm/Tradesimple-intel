import type { BacktestResult } from "../../shared/backtest.mjs";
import type { BacktestSpec } from "../../shared/backtestSpec.mjs";
import type { Reality } from "../../shared/backtestStats.mjs";

export type BtFeed = { label: string; source: string; asOf: string; latency: string };

/** What POST /api/backtest returns on success, plus the run's own labels. */
export type BtRun = BacktestResult & {
  spec: BacktestSpec;
  description: string;
  source: string;
  asOf: string;
  latency: string;
  feeds: BtFeed[];
  timing: { totalMs: number; signalsMs: number; pricesMs: number; engineMs: number };
  counts: BacktestResult["counts"] & { matched?: number; tickers?: number; priced?: number };
  building: boolean;
  pending: string[];
  cache: "hit" | "miss";
  ranAt: string;
  reality?: Reality | null;
};

export type BtFailure = { ok: false; error: string; missing?: string; building?: boolean; description?: string };

export type BtOptions = {
  ok: true;
  sources: { id: string; label: string }[];
  benchmarks: { id: string; label: string }[];
  sectors: string[];
  committees: { id: string; name: string; chamber: string; size: number }[];
};
