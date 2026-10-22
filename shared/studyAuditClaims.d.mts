export type AuditEvidence = { id: string; tool: string; ok: boolean; json: string };
export type SavedAuditResult = {
  id: string;
  body: { ok: boolean; studies: Record<string, unknown>[]; [key: string]: unknown };
};
export type StudyAuditFlag = { kind: "research"; raw: string; refs: string[]; note: string };
export function savedAuditResults(evidence: AuditEvidence[]): SavedAuditResult[];
export function studyAuditClaims(answer: string, evidence: AuditEvidence[], question?: string): StudyAuditFlag[];
