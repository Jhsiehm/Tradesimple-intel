export type DisclosureRow = {
  id: string;
  chamber?: string;
  bioguide?: string;
  person?: string;
  symbol?: string | null;
  asset?: string;
  assetType?: string;
  owner?: string;
  side?: string;
  type?: string;
  amount?: string;
  amountLow?: number | null;
  traded?: string;
  filed?: string;
  amended?: string | null;
  amendment?: number | null;
  lag?: number | null;
  link?: string;
  [key: string]: unknown;
};

export type DedupedRow<T extends DisclosureRow = DisclosureRow> = T & {
  /** Earliest date any report listing this transaction was public. */
  public: string;
  /** Fields the latest amendment changed relative to the earliest report. */
  revised?: string[];
  /** Ids of the duplicate rows folded into this one. */
  alsoIn?: string[];
};

export type DedupeStats = {
  rows: number;
  transactions: number;
  merged: number;
  revised: number;
  byChamber: Record<string, number>;
};

export const REVISABLE: string[];
export function publicDateOf(row: Pick<DisclosureRow, "filed" | "amended">): string;
export function transactionKey(row: DisclosureRow): string;
export function dedupeDisclosures<T extends DisclosureRow>(rows: T[], options?: { windowDays?: number }): { items: DedupedRow<T>[]; stats: DedupeStats };
