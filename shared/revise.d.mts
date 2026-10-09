export const REVISE: { minMs: number; excerptChars: number; excerpts: number; totalChars: number; outputTokens: number };

export type FlagKind = "unmatched" | "miscited" | "mislabeled" | "scope" | "uncitedRow" | "unknownRef" | "uncited";
export type FlagItem = { kind: FlagKind; raw: string; refs: string[]; note: string; key: string };
export type AnswerCheck = { grounding: Record<string, unknown>; unknown?: string[]; uncited?: boolean; cited?: string[] };
export function flaggedItems(check: AnswerCheck): FlagItem[];
export function revisionBudget(opts: { spent?: number; tokenBudget?: number; msLeft?: number; need?: number }): { ok: boolean; reason: string };
export function excerptRefs(items: FlagItem[], cited?: string[], evidence?: { id: string; ok: boolean }[]): string[];
export function revisionMessages(opts: { question: string; answer: string; items: FlagItem[]; excerpts: { id: string; label?: string; text: string }[] }): { role: "system" | "user"; content: string }[];
export function cleanRevision(text: string): string;
export function acceptRevision(before: FlagItem[], after: FlagItem[], text: string, original?: string): boolean;

export type RevisionChange = { kind: FlagKind; raw: string; status: "corrected" | "removed" | "still flagged"; note: string };
export type Revision = {
  status: "applied" | "kept" | "skipped" | "failed";
  reason?: string;
  items: number;
  model: string;
  fixed: number;
  remaining?: number;
  changes: RevisionChange[];
  removed: string[];
  added: string[];
};
export function revisionChanges(before: string, after: string, beforeItems: FlagItem[], afterItems: FlagItem[]): Pick<Revision, "fixed" | "remaining" | "changes" | "removed" | "added">;
export function revisionSummary(rev: Revision | null | undefined): string;
