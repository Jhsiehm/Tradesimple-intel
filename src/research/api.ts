import type { RelationshipPolicy } from '../../shared/backtestSpec.mjs';
import { api, post } from '../lib/api';
import type { BtRun } from '../backtest/types';
export type EventRow = { id: string; entity: { symbol: string; securityId: string; companyId: string | null }; eventAt: string; availableAt: string; availabilityBasis: string; side: string };
export type ExperimentSummary = { id: string; title: string; hypothesis: string; createdAt: string; runId: string; parentId: string | null; status?: string };
export type Experiment = ExperimentSummary & { run: { id: string; createdAt: string; inputHash: string; engineId: string; inputCounts: { signals: number; priced: number; benchmarks: number } | null; result: BtRun & { error?: string }; provenance: { relationship?: { decisions?: { signalId: string; symbol: string; reason: string; pathWeight?: number | null; assertionIds: string[] }[]; eligible: number; excluded: number; received: number; policy: RelationshipPolicy; snapshot: { name: string; version: number } }; identityVersion: string; identityBasis: string; recordCount: number; matchedSignals: number; events: EventRow[]; dataset: { id: string; name: string; version: number } | null } } };
export type DatasetSummary = { id: string; name: string; version: number; rows: number; createdAt: string; contentHash: string };
export type Dataset = DatasetSummary & { source: string; coverage: Coverage; caveats: string[]; preview: EventRow[]; identityVersion: string };
export type Coverage = { received: number; valid: number; rejected: number; from: string | null; to: string | null; missingSourceUrls: number };
export type Preview = { ok: boolean; headers: string[]; errors: { row: number; field: string; message: string }[]; errorCount: number; preview: EventRow[]; coverage: Coverage; caveats: string[]; content?: string; format?: string; source?: string; retrieval?: { pages: number; rows: number; complete: boolean } };
export async function read<T>(path: string): Promise<T> { return api<T>(`/api/research/${path}`); }
export async function write<T>(path: string, body: unknown): Promise<T> {
  const out = await post<T & { ok: boolean; error?: string }>(`/api/research/${path}`, body);
  if (!out.ok) throw new Error(out.error || 'Validation failed. Preview the import to inspect row errors.');
  return out;
}
export const message = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';
