export const DATA_VALIDITY_VERSION: number;
export type PriceEvidence = {
  requested?: string[];
  bars?: Record<string, (number | null)[][]>;
  pending?: string[];
  missing?: string[];
  stale?: string[];
};
export type PriceCoverage = {
  requested: string[];
  loaded: string[];
  absent: string[];
  pending: string[];
  missing: string[];
  stale: string[];
  series: { symbol: string; rows: number; firstDay: number | null; lastDay: number | null; invalidRows: number }[];
  sessionCompleteness: string;
  adjustmentValidation: string;
  delistedCoverage: string;
};
export type ResearchDataValidity = {
  version: number;
  claimScope: "exploratory-only";
  strictHistoricalTradability: { eligible: false; status: "not-established"; blockers: string[] };
  timing: {
    sourceDate: number;
    assumedLag: number;
    assertedOrUnknown: number;
    independentlyVerified: number;
    precision: string;
    verification: string;
  };
  identity: { universe: string; historicalValidity: string };
  sourceCoverage: {
    declared: string;
    certification: string;
    gaps: { code: string; count: number }[];
    selection: Record<string, unknown> | null;
    store: Record<string, unknown> | null;
    auxiliary: Record<string, unknown> | null;
  };
  priceCoverage: PriceCoverage | null;
  limitations: { code: string; text: string }[];
};
export function assessPriceCoverage(input?: PriceEvidence): PriceCoverage;
export function assessResearchDataValidity(input?: {
  source?: string;
  filters?: Record<string, unknown>;
  coverage?: Record<string, unknown>;
  signals?: { availabilityBasis?: string; [key: string]: unknown }[];
  prices?: PriceEvidence | null;
}): ResearchDataValidity;
export function dataValidityNote(report: ResearchDataValidity): { id: string; level: "warn"; text: string };
export function requireStrictHistoricalTradability(report?: ResearchDataValidity): never;
