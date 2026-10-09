import type { AskContext, AttachedChat } from "./agent.mjs";
import type { Prefs } from "./backtestAsk.mjs";
import type { BacktestSpec } from "./backtestSpec.mjs";

export type AskLimits = {
  question: number; history: number; toolCalls: number; rounds: number; totalMs: number; roundMs: number;
  tokenBudget: number; maxOutputTokens: number; resultChars: number; resultItems: number;
  perIp: number; perIpWindowMs: number; concurrent: number;
};
export const ASK_LIMITS: AskLimits;
export const NOT_CONFIGURED: string;

export type AskTurn = { role: "user" | "assistant"; content: string };
export function cleanAsk(raw: unknown, limits?: AskLimits):
  | { ok: true; question: string; history: AskTurn[]; model: string; context: AskContext | null; attached: AttachedChat | null;
      prefs: Prefs | null; prior: BacktestSpec | null; priors: BacktestSpec[]; answers: Record<string, string | number | boolean>; acceptDefaults: boolean }
  | { ok: false; error: string };
export function systemPrompt(today: string): string;
export function trimForModel(value: unknown, limits?: AskLimits): unknown;

export type Evidence = {
  id: string; tool: string; args: Record<string, unknown>; ok: boolean; label: string;
  source: string; asOf: string; latency: string; ms: number; rows: number; note: string; caveats: string[]; open: string;
  requests: string[]; preview: string; json: string;
};
export function evidenceOf(id: string, tool: string, args: unknown, body: unknown, opts?: { ms?: number; label?: string; raw?: unknown; requests?: string[] }): Evidence;
export function toolMessage(evidence: Evidence, body: unknown): string;
export function openAction(tool: string, args?: unknown, body?: unknown): string;
export function citationRefs(answer: string, evidence: Pick<Evidence, "id">[]): { cited: string[]; unknown: string[] };

export type NumberToken = { raw: string; value: number; decimals: number; pct: boolean; bps: boolean; scale: number };
export function numbersIn(s: string): NumberToken[];
export function evidenceNumbers(json: string): number[];
export function grounded(n: NumberToken, pool: number[]): boolean;
export function groundingCheck(answer: string, evidence: Evidence[]): { checked: number; unmatched: string[]; mislabeled: import("./countLabels.mjs").Mislabel[] };
export function caveatsFor(evidence: Evidence[]): string[];
export function makeLimiter(opts: { max: number; windowMs: number }): { take(key: string, now: number): { ok: boolean; retryMs: number }; refund(key: string): void };
export function toolProblems(tool: { name?: string; description?: string; parameters?: any }): string[];
