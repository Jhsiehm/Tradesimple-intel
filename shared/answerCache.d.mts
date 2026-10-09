export declare const ANSWER_CACHE_DEFAULT_MIN: number;
export declare const NO_REUSE_TOOLS: Set<string>;

export type AskEvent = { type: string; [k: string]: unknown };
/** On a reused answer's `done`: when the original was written and by which model. */
export type Reused = { at: number; model: string };

export declare function normalizeQuestion(q: string): string;
export declare function stableJson(value: unknown, drop?: RegExp | null): string;
export declare function dataText(raw: unknown): string;
export declare function answerIdentity(asked: Record<string, unknown> | null | undefined, opts?: { model?: string; pinned?: boolean }): string;
export declare function noReuseReason(events: AskEvent[], calls: { tool: string }[]): string;
export declare function replayEvents(events: AskEvent[], reused: Reused): AskEvent[];
export declare function reusedLabel(at: number): string;
