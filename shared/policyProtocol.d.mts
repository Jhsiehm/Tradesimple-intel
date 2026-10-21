export type PolicyEventType = "vote" | "markup" | "introduced" | "passed" | "enacted";
export type PolicyProtocol = {
  schemaVersion: 1;
  title: string;
  question: string;
  billIds: string[];
  from: string;
  to: string;
  universe: string[];
  eventTypes: PolicyEventType[];
  benchmark: "SPY";
  sectorBenchmark: string | null;
  latencySeconds: number;
  holdingMinutes: number;
  costBps: number;
  holdoutFrom: string;
  newsArchive: string;
  newsTimeBasis: "publication" | "archive-first-seen";
  registeredAt: string;
};
export const POLICY_PROTOCOL_VERSION: number;
export function policyDate(value: unknown): boolean;
export function policyInstant(value: unknown): number | null;
export function cleanPolicyProtocol(
  input: unknown,
  options?: { now?: Date | string | number; registeredAt?: string },
): { ok: true; protocol: PolicyProtocol } | { ok: false; error: string };
