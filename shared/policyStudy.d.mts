import type { PolicyProtocol } from "./policyProtocol.mjs";
import type { PolicyEvidence } from "./policyEvidence.mjs";
export type PolicyCounts = {
  inputEvents: number;
  uniqueEvents: number;
  scopedEvents?: number;
  candidatePairs: number;
  completedPairs: number;
  duplicateEvents?: number;
  ambiguousRevisions?: number;
  ambiguousVoteEvents?: number;
  ambiguousVoteGroups?: number;
  excludedPairs?: number;
};
export type PolicyExclusion = {
  eventId: string;
  billId: string | null;
  symbol: string | null;
  code: string;
  reason: string;
};
export type PolicyStudyRow = {
  eventId: string;
  billId: string;
  actionDate: string;
  availabilityDateUTC: string;
  symbol: string;
  side: "long" | "short";
  partition: "train" | "holdout";
  availabilityAt: string;
  availabilityBasis: string;
  exposureId: string;
  newsId: string;
  newsAt: string;
  newsCoverageFromAt: string;
  newsArchive: string;
  newsTimeBasis: "publication" | "archive-first-seen";
  policyEntryAt: string;
  policyExitAt: string;
  newsEntryAt: string;
  newsExitAt: string;
  returns: {
    policyGross: number;
    newsGross: number;
    policyNet: number;
    newsNet: number;
    policyBenchmarkNet: number;
    newsBenchmarkNet: number;
    policyExcess: number;
    newsExcess: number;
    pairedDifference: number;
    policySectorExcess?: number;
    newsSectorExcess?: number;
  };
  evidenceStatus: "conditional-on-supplied-evidence";
  citations: string[];
};
export type PolicyGroupSummary = {
  pairs: number;
  events: number;
  meanPolicyNet: number | null;
  meanNewsNet: number | null;
  meanPairedDifference: number | null;
  meanPolicyExcess: number | null;
  meanNewsExcess: number | null;
};
export type PolicyStudyResult = {
  schemaVersion: 1;
  asOf: string | null;
  status: "invalid-input" | "conditional-analysis" | "insufficient-evidence";
  executed: boolean;
  protocol: PolicyProtocol | null;
  claimCeiling: string;
  counts: PolicyCounts;
  gaps: string[];
  exclusions: PolicyExclusion[];
  rows: PolicyStudyRow[];
  summary: PolicyGroupSummary & {
    kind: "paired-event-return-comparison";
    units: "decimal-return";
    train: PolicyGroupSummary;
    holdout: PolicyGroupSummary;
    holdoutStatus: string;
    uncertainty: { available: false; reason: string };
    portfolioMetrics: null;
  };
  limitations: string[];
};
export function assessPolicyReadiness(
  protocol: PolicyProtocol,
  evidence: PolicyEvidence,
  options?: { asOf?: string },
): { asOf: string | null; ready: boolean; gaps: string[]; counts: PolicyCounts; claimCeiling: string };
export function evaluatePolicyStudy(
  protocol: PolicyProtocol,
  evidence: PolicyEvidence,
  options?: { asOf?: string },
): PolicyStudyResult;
