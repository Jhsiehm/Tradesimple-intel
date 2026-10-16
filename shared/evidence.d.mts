export type AvailabilityPolicy = { mode: 'observed' | 'verified' } | { mode: 'assumed'; defenseDays: number; civilianDays: number };
export type ContractMapping = { uei: string; symbol: string };
export type ObligationRecord = { amount: number | null; agency?: string; actionDate?: string | null };
export type ContractRecord = ObligationRecord & {
  recordKey: string | null; identityBasis: string; award: string; awardNumber: string; mod: string;
  recipient: string; uei: string; symbol: string | null; identityStatus: string; subAgency: string;
  description: string; naics: unknown; psc: unknown; place: unknown;
  sourceUpdatedAt: string | null; firstObservedAt: string; verifiedPublishedAt: string | null; sourceUrl: string | null;
};
export type ObligationGroup = { key: string; net: number; positive: number; negative: number; transactions: number };
export function isoDate(value: unknown): boolean;
export function months(from: string, to: string): { from: string; to: string }[];
export function normalizeContract(raw: Record<string, unknown>, mapping: ContractMapping[], observedAt: string): ContractRecord;
export function availableDate(record: Pick<ContractRecord, 'actionDate' | 'agency' | 'firstObservedAt' | 'verifiedPublishedAt'>, policy: AvailabilityPolicy): string | null;
export function obligationFeatures(records: ObligationRecord[]): { formula: string; positive: number; negative: number; net: number; missing: number; byAgency: ObligationGroup[]; byMonth: ObligationGroup[] };
