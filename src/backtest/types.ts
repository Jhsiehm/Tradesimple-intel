import type { ResearchDataValidity } from '../../shared/researchDataValidity.mjs';
import type { BacktestResult } from "../../shared/backtest.mjs";
import type { BacktestSpec } from "../../shared/backtestSpec.mjs";
import type { Reality } from "../../shared/backtestStats.mjs";

export type BtFeed = { label: string; source: string; asOf: string; latency: string };

/** What POST /api/backtest returns on success, plus the run's own labels. */
export type BtRun = BacktestResult & {
  dataValidity?: ResearchDataValidity;
  trial?: { id: string; priorOverlappingAttempts: number; priorOverlappingVariants: number; interpretation: string };
  runId?: string;
  engineId?: string;
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

export type BtFailure = { ok: false; runId?: string; error: string; missing?: string; building?: boolean; description?: string };

export type BtOptions = {
  ok: true;
  sources: { id: string; label: string }[];
  benchmarks: { id: string; label: string }[];
  sectors: string[];
  committees: { id: string; name: string; chamber: string; size: number }[];
};
