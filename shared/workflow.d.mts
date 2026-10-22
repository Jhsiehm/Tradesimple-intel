export type WorkflowFamily = "descriptive" | "predictive" | "causal" | "strategy" | "document";
export type WorkflowScalar = string | number | boolean | null;
export type WorkflowMode = "first-publication" | "latest-known";
export type WorkflowNode =
  | { id: string; op: "source"; snapshotId: string; mode: WorkflowMode }
  | {
      id: string;
      op: "filter";
      input: string;
      field: string;
      operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
      value: WorkflowScalar;
    }
  | {
      id: string;
      op: "join";
      left: string;
      right: string;
      keys: { left: string; right: string }[];
      how: "inner" | "left";
    }
  | { id: string; op: "difference"; input: string; left: string; right: string; output: string }
  | { id: string; op: "summarize"; input: string; value: string; groupBy: string[] };
export interface WorkflowProtocol {
  title: string;
  question: string;
  hypothesis: string;
  family: WorkflowFamily;
  population: string;
  unitOfAnalysis: string;
  outcome: string;
  comparison: string;
  from: string | null;
  to: string | null;
  knownAt: string | null;
  assumptions: string[];
  unresolved: string[];
  nodes: WorkflowNode[];
  outputs: string[];
}
export interface WorkflowSource {
  snapshotId: string;
  mode: WorkflowMode;
  rows: Record<string, WorkflowScalar>[];
  provenance: Record<string, unknown>;
  coverage: Record<string, unknown>;
  decisions: unknown[];
}
export interface WorkflowResult {
  version: 1;
  status: "completed" | "empty" | "blocked";
  executed: boolean;
  claimScope: "descriptive";
  gaps: string[];
  outputs: Record<string, { rows: Record<string, unknown>[]; count: number }>;
  steps: {
    id: string;
    op: WorkflowNode["op"];
    status: "completed" | "empty";
    ledger: Record<string, unknown>;
    source?: Record<string, unknown>;
  }[];
  limitations: string[];
}
export const WORKFLOW_VERSION: 1;
export const WORKFLOW_LIMITS: Readonly<{
  nodes: number;
  sources: number;
  rows: number;
  outputs: number;
  aggregateRows: number;
  fields: number;
  inputBytes: number;
  outputBytes: number;
  aggregateBytes: number;
}>;
export function cleanWorkflowProtocol(input: unknown): WorkflowProtocol;
export function evaluateWorkflow(protocol: unknown, sources: unknown): WorkflowResult;
