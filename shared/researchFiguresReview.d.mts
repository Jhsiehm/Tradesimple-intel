import type { FigureEvidence, ResearchFigureReview } from "./researchFigures.mjs";
export function auditStudyLabels(studies: Record<string, unknown>[]): string[];
export function auditFigureReview(
  entry: FigureEvidence,
  body: Record<string, unknown>,
  studies: Record<string, unknown>[],
  labels: string[],
): ResearchFigureReview | undefined;
export function cleanFigureReview(raw: unknown, sourceRefs: string[]): ResearchFigureReview | undefined;
