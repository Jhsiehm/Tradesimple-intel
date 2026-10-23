import type { WorkflowProtocol, WorkflowScalar } from "./workflow.mjs";

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
export interface WorkflowTime {
  value: string;
  start: number;
  end: number;
  precision: "day" | "instant";
}
export function fieldName(value: unknown): value is string;
export function plainObject(value: unknown, label: string): Record<string, unknown>;
export function plainArray(value: unknown, label: string): unknown[];
export function workflowTime(value: unknown): WorkflowTime | null;
export function scalar(value: unknown): value is WorkflowScalar;
export function cleanWorkflowProtocol(input: unknown): WorkflowProtocol;
