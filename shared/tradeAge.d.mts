export type Freshness = "fresh" | "recent" | "stale" | "old";

export type TradeAge = {
  kind: string;
  /** "traded", "awarded", "event", "quarter ended", "period ended", or "" when the kind has no event date. */
  word: string;
  eventAt: string;
  filedAt: string;
  eventDays: number | null;
  lagDays: number | null;
  tier: Freshness | null;
  trade: boolean;
};

export const FRESHNESS: { tier: Freshness; maxDays: number; label: string }[];
export const TRADE_KINDS: string[];
export const EVENT_WORDS: Record<string, string>;
export const AGE_RULE: string;

export function calendarDays(from: string | number, to: string | number): number | null;
export function freshness(days: number | null | undefined): Freshness | null;
export function freshnessLabel(tier: Freshness | null | undefined): string;
export function agoLabel(at: string | number | null | undefined, now?: number): string;
export function tradeAge(input?: { kind?: string; eventAt?: string; filedAt?: string }, now?: number): TradeAge;
export function ageSteps(kind: string, tier: Freshness | null): number;
export function ageSeverity<S extends string | undefined>(severity: S, kind: string, tier: Freshness | null): S;
export function ageLine(age: TradeAge | null | undefined, now?: number): string;
export function ageAlert<T extends { kind: string; date?: string; severity?: string; eventAt?: string; filedAt?: string; baseSeverity?: string; live?: { eventAt?: string; publishedAt?: string } }>(row: T, now?: number): T & { age: TradeAge; baseSeverity?: string };
