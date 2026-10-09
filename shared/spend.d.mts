export declare const PRICES: [RegExp, number, number][];
export declare const FALLBACK_PRICE: [number, number];
export declare const BUDGET_DEFAULT_USD: number;
export declare const WARN_AT: number;
export declare const CHEAP_MODEL: Record<string, string>;

export type BudgetLevel = "ok" | "warn" | "over" | "stop";
/** This month's Ask spend as GET /api/ask and the `spend` event report it. */
export type Spend = {
  month: string;
  spent: number;
  budget: number;
  pct: number;
  level: BudgetLevel;
  calls: number;
  tasks: number;
  estimated: number;
  cheap: string;
  hardStop: boolean;
  note: string;
};

export declare function priceOf(model: string): { input: number; output: number; known: boolean };
export declare function callCost(call: { model?: string; input?: number; output?: number; cost?: number | null }): { usd: number; priced: "reported" | "table" | "fallback" };
export declare function monthKey(ms: number): string;
export declare function resetDay(month: string): string;
export declare function budgetSettings(env?: Record<string, string | undefined>, provider?: string): { budget: number; hardStop: boolean; cheap: string };
export declare function budgetLevel(s: { spent?: number; budget?: number; hardStop?: boolean }): { level: BudgetLevel; pct: number };
export declare function budgetNote(s: { level: BudgetLevel; spent: number; budget: number; cheap?: string; month: string }): string;
export declare function spendLine(spend: Spend | null | undefined): string;
