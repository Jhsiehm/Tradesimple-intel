import type { PolicyProtocol, PolicyEventType } from "./policyProtocol.mjs";
export type PolicyEvent = {
  id: string;
  billId: string;
  sourceEventDate?: string;
  type: PolicyEventType;
  eventTypes?: PolicyEventType[];
  title: string;
  eventAt: string;
  eventPrecision: "day" | "instant";
  publicAt: string | null;
  publicPrecision: "day" | "instant" | null;
  availabilityBasis: "unknown" | "collector-first-seen" | "verified-publication" | "importer-asserted";
  firstSeenAt: string;
  sourceUrl: string;
  sourceRecordId: string;
  sourceHash: string;
};
export type PolicyNews = {
  id: string;
  eventId?: string;
  billId: string;
  publishedAt: string | null;
  firstSeenAt: string | null;
  sourceUrl: string;
  title: string;
  archive: string;
  timingBasis: string;
  sourceHash: string;
  reviewed?: boolean;
  coverageFrom?: string;
  coverageTo?: string;
  coverageComplete?: boolean;
};
export type PolicyExposure = {
  id: string;
  eventId?: string;
  billId?: string;
  symbol: string;
  side: "long" | "short";
  knownAt: string;
  validFrom: string;
  validTo?: string | null;
  sourceUrl: string;
  rationale: string;
  reviewed: boolean;
};
export type PolicyBar = { symbol: string; at: string; open: number; close: number; intervalMinutes: 1 };
export type PolicyEvidence = {
  events: PolicyEvent[];
  news: PolicyNews[];
  exposures: PolicyExposure[];
  bars: PolicyBar[];
  newsCoverage?: {
    archive: string;
    billId?: string;
    eventId?: string;
    scope?: "archive-global";
    from: string;
    to: string;
    complete: boolean;
    basis?: string;
  }[];
};
export const MINUTE: number;
export function policyDay(value: unknown): string | null;
export function cited(record: unknown): boolean;
export function policyAvailability(
  event: PolicyEvent,
  protocol: PolicyProtocol,
):
  | { at: number; basis: string; asserted: boolean; error?: never }
  | { error: string; at?: never; basis?: never; asserted?: never };
export function policyNewsCoverage(
  protocol: PolicyProtocol,
  evidence: PolicyEvidence,
  from: number,
  to: number,
  event?: PolicyEvent,
): boolean;
export function earliestPolicyNews(
  event: PolicyEvent,
  protocol: PolicyProtocol,
  evidence: PolicyEvidence,
): { news: PolicyNews; at: number; error?: never } | { error: string; news?: never; at?: never };
export function policyExposure(
  event: PolicyEvent,
  symbol: string,
  at: number,
  evidence: PolicyEvidence,
): { exposure: PolicyExposure; error?: never } | { error: string; exposure?: never };
export function policySessionMinute(at: number): boolean;
export function policyBarIndex(bars: PolicyBar[]): { index: Map<string, PolicyBar>; conflicts: Set<string> };
export function policyPriceWindow(
  index: Map<string, PolicyBar>,
  symbol: string,
  entry: number,
  minutes: number,
): { entry: number; exit: number } | null;
