export function asOfText(asOf: string, now?: number): string;

export type ConfidenceStep = { tool: string; state: string; asOf?: string };
export type ConfidenceDone = {
  greeting?: boolean;
  clarify?: boolean;
  noTools?: boolean;
  uncited?: boolean;
  unknown?: string[];
  model?: string;
  grounding?: { checked?: number; unmatched?: string[]; miscited?: unknown[]; mislabeled?: unknown[]; scope?: unknown[]; uncitedRows?: string[] };
  backtests?: { ok: boolean; counts?: Record<string, number> | null }[];
  revision?: { status: string; model: string } | null;
};
export type Confidence = { parts: string[]; tone: "neutral" | "amber"; text: string };
export function confidenceLine(opts: { steps?: ConfidenceStep[]; done: ConfidenceDone | null | undefined; model?: string; now?: number }): Confidence | null;
