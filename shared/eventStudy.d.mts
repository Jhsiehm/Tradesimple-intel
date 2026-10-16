import type { BacktestSignal, Bar } from "./backtest.mjs";
export const EVENT_STUDY_VERSION: number;
export type EventStudySpec = {
  from: string;
  to: string;
  before: number;
  after: number;
  sides: "buy" | "sell" | "both";
  model?: "market-adjusted" | "market-model";
  estimationSessions?: number;
  estimationGap?: number;
};
export type EventStudyBase = {
  signals: BacktestSignal[];
  bars: Record<string, Bar[]>;
  benchBars: Record<string, Bar[]>;
};
export type EventStudyUncertainty = {
  method: string;
  n: number;
  groups: number;
  largestGroup: number;
  meanCar: number | null;
  standardError: number | null;
  status: string;
  blocks: { id: string; eventIds: string[]; symbols: string[]; from: string; to: string }[];
};
export function eventStudyUncertainty(
  events: { id: string; symbol: string; from: string; to: string; car: number }[],
): EventStudyUncertainty;
export type EventStudyReport = {
  version: number;
  uncertainty?: EventStudyUncertainty;
  spec: EventStudySpec;
  benchmark: string;
  counts: {
    publications: number;
    eligiblePublications: number;
    candidateEvents: number;
    completeEvents: number;
    excludedEvents: number;
    includedPublications: number;
    overlappingEvents: number;
  };
  exclusions: Record<string, number>;
  decisions: {
    signalId: string;
    symbol: string;
    publicDate: string;
    side: string;
    anchorDate: string | null;
    eventId: string | null;
    reason: string;
  }[];
  events: {
    estimation: null | {
      alpha: number;
      beta: number;
      rSquared: number | null;
      residualStdDev: number;
      n: number;
      from: string;
      to: string;
      precedingClose: string;
      gap: number;
      samples: { date: string; securityReturn: number; benchmarkReturn: number }[];
    };
    marketAdjustedCar?: number;
    id: string;
    symbol: string;
    anchorDate: string;
    from: string;
    to: string;
    signalIds: string[];
    sides: string[];
    path: {
      offset: number;
      date: string;
      securityReturn: number;
      benchmarkReturn: number;
      expectedReturn?: number;
      marketAdjustedReturn?: number;
      marketAdjustedCar?: number;
      abnormalReturn: number;
      cumulativeAbnormalReturn: number;
    }[];
    car: number;
    buyHoldAbnormalReturn: number;
    overlappingEventIds: string[];
  }[];
  curve: {
    offset: number;
    n: number;
    meanSecurityReturn: number;
    meanBenchmarkReturn: number;
    meanExpectedReturn?: number;
    marketAdjustedAar?: number;
    marketAdjustedCaar?: number;
    aar: number;
    caar: number;
  }[];
  summary: { marketAdjustedMeanCar?: number; meanCar: number; meanBuyHoldAbnormalReturn: number } | null;
  caveats: string[];
};
export function cleanEventStudy(raw: unknown): EventStudySpec;
export function runEventStudy(input: { base: EventStudyBase; spec: EventStudySpec }): EventStudyReport;
