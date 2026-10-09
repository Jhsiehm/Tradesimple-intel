export type WindowClaim = { raw: string; days: number; at: number };
export type BenchmarkClaim = { raw: string; target: string; at: number };
export type Coverage = { all: boolean; from: string; to: string; days: number | null; basis: string };
export type ScopeFlag = { kind: "window" | "benchmark"; raw: string; refs: string[]; note: string };
export function windowClaims(text: string): WindowClaim[];
export function benchmarkClaims(text: string): BenchmarkClaim[];
export function windowOf(tool: string, body: unknown): Coverage | null;
export function hasBenchmarkFigures(body: unknown): boolean;
export function scopeCheck(answer: string, evidence: { id: string; tool: string; ok: boolean; json: string }[]): ScopeFlag[];
