import type { WorkflowNode } from "./workflow.mjs";
import type { WorkflowTable } from "./workflowRows.mjs";

export function filterRows(node: Extract<WorkflowNode, { op: "filter" }>, table: WorkflowTable): WorkflowTable;
export function joinRows(
  node: Extract<WorkflowNode, { op: "join" }>,
  left: WorkflowTable,
  right: WorkflowTable,
): WorkflowTable;
export function differenceRows(node: Extract<WorkflowNode, { op: "difference" }>, table: WorkflowTable): WorkflowTable;
export function summarizeRows(node: Extract<WorkflowNode, { op: "summarize" }>, table: WorkflowTable): WorkflowTable;
