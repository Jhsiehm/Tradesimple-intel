export type UniverseTicker = {
  symbol: string;
  core?: boolean;
  contractParents?: { uei?: string }[];
  [key: string]: unknown;
};
export function listingSymbol(value: unknown): string;
export function defaultWarmTickers<T extends { core?: boolean }>(rows: T[]): T[];
export function expandUniverse(
  current: UniverseTicker[],
  sec: { fields: string[]; data: unknown[][] },
  quotes: { symbol: string; name: string; marketCap: number | string; sector?: string; industry?: string }[],
  target?: number,
  asOf?: string,
): UniverseTicker[];
export function mapContractorRecipients(
  recipients: { name: string; recipient_id?: string; uei?: string; amount: number }[],
  tickers: UniverseTicker[],
): {
  rank: number;
  name: string;
  recipientId?: string;
  uei: string | null;
  obligations: number;
  symbols: string[];
  mapping: string;
}[];
