import type { WorkflowMode, WorkflowNode, WorkflowProtocol } from "./workflow.mjs";

export interface WorkflowLineage {
  nodeId: string;
  snapshotId: string;
  rowId: string;
}
export interface WorkflowRow extends Record<string, unknown> {
  id: string;
  lineage: WorkflowLineage[];
}
export interface WorkflowExclusion {
  rowId: string;
  reason: string;
  fields?: string[];
}
export interface WorkflowLedger extends Record<string, unknown> {
  received: number;
  retained: number;
  excluded: number;
  excludedRows: WorkflowExclusion[];
}
export interface WorkflowTable {
  rows: WorkflowRow[];
  ledger: WorkflowLedger;
  source?: {
    snapshotId: string;
    mode: WorkflowMode;
    provenance: Record<string, unknown>;
    coverage: Record<string, unknown>;
    decisions: unknown[];
  };
}
export function own(row: Record<string, unknown>, field: string): unknown;
export function rowIds(rows: { id: string }[]): string[];
export function ledger(
  received: number,
  rows: unknown[],
  excluded?: WorkflowExclusion[],
  extra?: Record<string, unknown>,
): WorkflowLedger;
export function boundedJson(value: unknown, bytes: number, label: string): number;
export function sourceRows(
  node: Extract<WorkflowNode, { op: "source" }>,
  source: unknown,
  protocol: WorkflowProtocol,
): WorkflowTable;
export function numericDescriptor(
  row: Record<string, unknown>,
  field: string,
): { unit: string; metric: string; semantics: string };
export function combinedLineage(
  left: { lineage: WorkflowLineage[] },
  right?: { lineage: WorkflowLineage[] } | null,
): WorkflowLineage[];
export function availabilityBound(...rows: (Record<string, unknown> | null | undefined)[]): string;
export function exactKey(row: Record<string, unknown>, fields: string[]): string | null;
