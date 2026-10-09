export interface Region { label: string; symbols: [string, string][]; words: string[] }
export const REGIONS: Record<string, Region>;
export const REGION_IDS: string[];
export function regionsIn(question: string): string[];
export function worldRegions(question: string): string[];
export function wantsWorldMarkets(question: string): boolean;
export function worldSymbols(opts?: { regions?: string[]; symbols?: string[] }): string[];
export function indexName(symbol: string): string;
export function localStamp(iso: string, tz: string): string;
export function sessionOf(opts: { asOf?: string; tz?: string; period?: { start?: number; end?: number } | null; now?: number }): { open: boolean; session: "open" | "closed"; sessionNote: string };
export function worldDisclaimer(opts?: { asOf?: string; web?: boolean }): string;
export function worldTail(answer: string, body: unknown, opts?: { web?: boolean }): string;
export const WORLD_NOTE: string;
