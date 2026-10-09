/** What the server streams from POST /api/ask, and what the panel keeps. */
export type Evidence = {
  id: string;
  tool: string;
  label: string;
  ok: boolean;
  source: string;
  asOf: string;
  latency: string;
  ms: number;
  note: string;
  open: string;
};

export type Done = {
  answer: string;
  cited: string[];
  unknown: string[];
  grounding: { checked: number; unmatched: string[] };
  uncited: boolean;
  noTools: boolean;
  caveats: string[];
  usage: { tokens: number; toolCalls: number };
  ms: number;
  stopped: string;
};

export type Turn = {
  question: string;
  text: string;
  evidence: Evidence[];
  running: { id: string; label: string }[];
  phase: "thinking" | "answering" | "done" | "error";
  done: Done | null;
  error: string;
  notConfigured: boolean;
  missing: string;
};

export type AskStatus = { ok: boolean; configured: boolean; provider: string; model: string; missing: string[]; notice: string; tools: string[] };

/** One saved answer. The browser keeps the last 20; nothing leaves it. */
export type Saved = { at: string; question: string; answer: string; evidence: Evidence[]; done: Omit<Done, "answer"> | null; model: string };
