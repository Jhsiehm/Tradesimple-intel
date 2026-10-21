export type PolicyProtocol = {
  schemaVersion: 1;
  title: string;
  question: string;
  billIds: string[];
  from: string;
  to: string;
  universe: string[];
  eventTypes: string[];
  benchmark: string;
  sectorBenchmark: string | null;
  latencySeconds: number;
  holdingMinutes: number;
  costBps: number;
  holdoutFrom: string;
  newsArchive: string;
  newsTimeBasis: "publication" | "archive-first-seen";
};
export type EvidenceKind = "events" | "news" | "exposures" | "bars" | "newsCoverage";
export type EvidenceRecord = Record<string, unknown>;
export type PolicyResult = {
  status?: string;
  executed?: boolean;
  counts?: Record<string, number>;
  exclusions?: unknown[] | Record<string, unknown>;
  rows?: EvidenceRecord[];
  summary?: Record<string, unknown> | string;
  limitations?: string[];
  claimCeiling?: string;
  [key: string]: unknown;
};
export type PolicyInvestigation = {
  id: string;
  createdAt: string;
  protocol: PolicyProtocol;
  protocolHash: string;
  status: string;
  revision: number;
  lastError?: string | null;
  evidence: Record<EvidenceKind, EvidenceRecord[]> & {
    manifest?: unknown;
    sources?: unknown;
  };
  readiness: { ready: boolean; gaps: string[]; counts?: Record<string, number>; [key: string]: unknown };
  result: PolicyResult | null;
};
export type PolicySummary = Partial<PolicyInvestigation> & { id: string; title?: string };
export const evidenceLabels: Record<EvidenceKind, string> = {
  events: "Legislative events",
  news: "News observations",
  exposures: "Company exposure mappings",
  bars: "Intraday price bars",
  newsCoverage: "News archive coverage",
};
export function readable(value: unknown): string {
  if (value == null) return "Not supplied";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
export function sourceLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export const statusLabel = (value: string) => value.replaceAll("-", " ");
