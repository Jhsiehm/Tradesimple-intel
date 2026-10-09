import type { BacktestSpec } from "../../shared/backtestSpec.mjs";
import type { Clarify } from "../../shared/backtestAsk.mjs";
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
};

export type Done = {
  answer: string;
  cited: string[];
  unknown: string[];
  grounding: { checked: number; unmatched: string[] };
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
  session?: { set?: { sourcing?: string; style?: string; v?: number; updated?: string }; clear?: boolean } | null;
  modes?: { sourcing: string; style: string; label: string } | null;
};

export type ClarifyAsk = {
  questions: Array<Clarify | { path: string; prompt: string; chips: { label: string; value: unknown }[]; fallback?: unknown }>;
  spec: BacktestSpec | null;
  from: Record<string, string>;
  sentence: string;
  sources: string[];
  note: string;
};

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
};

export type SavedChat = { id: string; title: string; turns: Turn[]; updated: string };

export type AskStatus = {
  ok: boolean;
  configured: boolean;
  provider: string;
  model: string;
  small?: boolean;
  models?: { id: string; small: boolean }[];
  missing: string[];
  notice: string;
  tools: string[];
  sourcing?: { id: string; label: string }[];
  styles?: { id: string; label: string }[];
  web?: { brave: boolean; note: string };
};
