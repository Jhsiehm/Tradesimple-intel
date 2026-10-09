import type { BacktestSpec } from "../../shared/backtestSpec.mjs";
import type { Clarify } from "../../shared/backtestAsk.mjs";
import type { Miscited } from "../../shared/citations.mjs";
import type { Revision } from "../../shared/revise.mjs";
import type { Theory } from "../../shared/relations.mjs";

/** What the server streams from POST /api/ask, and what a chat keeps. */
export type Phase = "planning" | "fetching" | "computing" | "writing";

export type Step = {
  id: string;
  tool: string;
  label: string;
  args: unknown;
  phase: Phase;
  at: string;
  state: "running" | "ok" | "error";
  ms: number;
  rows?: number;
  source?: string;
  asOf?: string;
  latency?: string;
  note?: string;
  open?: string;
  requests: string[];
  preview?: string;
  using?: string;
  diff?: string[];
};

export type FallbackTable = { columns: string[]; rows: string[][]; total: number; ref: string; label: string; source: string; asOf: string };

export type BacktestRef = {
  id: string;
  spec: BacktestSpec;
  from: Record<string, string>;
  diff: string[];
  prior: BacktestSpec | null;
  using: string;
  note: string;
  ok: boolean;
  open: string;
  description: string;
  counts?: Record<string, number> | null;
};

export type Done = {
  answer: string;
  cited: string[];
  unknown: string[];
  grounding: { checked: number; unmatched: string[]; mislabeled?: { raw: string; value: number; unit: string; foundAs: string[] }[]; miscited?: Miscited[]; uncitedRows?: string[]; scope?: { kind: "window" | "benchmark"; raw: string; refs: string[]; note: string }[] };
  uncited: boolean;
  noTools: boolean;
  greeting: boolean;
  caveats: string[];
  usage: { tokens: number; toolCalls: number };
  ms: number;
  stopped: string;
  model: string;
  theory: Theory | null;
  table: FallbackTable | null;
  retried: boolean;
  backtests: BacktestRef[];
  clarify: boolean;
  prefs: { set?: Record<string, unknown>; clear?: boolean } | null;
  revision?: Revision | null;
};

export type ClarifyAsk = { questions: Clarify[]; spec: BacktestSpec; from: Record<string, string>; sentence: string; sources: string[]; note: string };

/** One exchange: the question and everything the answer streamed. */
export type Turn = {
  id: string;
  question: string;
  at: string;
  text: string;
  steps: Step[];
  phase: Phase | "done" | "error";
  notes: string[];
  done: Done | null;
  clarify: ClarifyAsk | null;
  error: string;
  model: string;
  context: string;
  /** Set while the revision pass checks the answer's figures ("Checking figures… 3 flagged"). */
  revising?: string;
};

export type SavedChat = { id: string; title: string; turns: Turn[]; updated: string };

export type AskStatus = {
  ok: boolean;
  configured: boolean;
  provider: string;
  model: string;
  small?: boolean;
  strong?: string;
  models?: { id: string; small: boolean }[];
  missing: string[];
  notice: string;
  tools: string[];
};
