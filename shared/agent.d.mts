import type { Theory } from "./relations.mjs";

export const OPENROUTER_MENU: string[];
export function smallModel(id: string): boolean;
export type ModelCfg = { provider: string; model: string };
export function modelOptions(cfg: ModelCfg): string[];
export function resolveModel(requested: unknown, cfg: ModelCfg): string;

export type AskContext = { node: string; label: string; theory: Theory | null };
export function cleanContext(raw: unknown): AskContext | null;
export function contextNote(ctx: AskContext | null): string;
export type AttachedChat = { title: string; turns: { role: "user" | "assistant"; content: string }[] };
export function cleanAttached(raw: unknown): AttachedChat | null;
export function attachedNote(att: AttachedChat | null): string;

export const EXAMPLES: string[];
export function isGreeting(question: string): boolean;
export function greetingText(): string;

export function rowCount(body: unknown): number;
export function figureCount(answer: string): number;
export function wantsBacktest(question: string): boolean;
export function retryReason(question: string, answer: string, evidence: { id: string; tool: string; ok: boolean; rows: number }[]): string;
export type FallbackTable = { columns: string[]; rows: string[][]; total: number };
export function fallbackTable(body: unknown, maxRows?: number): FallbackTable | null;
