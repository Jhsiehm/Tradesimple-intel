export function researchReadiness(
  run: unknown,
  universe?: string[],
): {
  status: string;
  label: string;
  next: string;
  priceGaps: number;
  sourceWarnings: string[];
  tickers: { symbol: string; trades: number; first: string | null; last: string | null; status: string }[];
};
