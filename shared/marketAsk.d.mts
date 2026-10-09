export function wantsMarkets(question: string): boolean;
export const MARKET_NOTE: string;
export function etStamp(iso: string): string;
export function marketDisclaimer(opts?: { asOf?: string; yieldAsOf?: string; stale?: boolean }): string;
export function hasDisclaimer(answer: string): boolean;
export function marketTail(answer: string, body: unknown): string;
