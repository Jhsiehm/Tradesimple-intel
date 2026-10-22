export type ResearchFigurePoint = {
  label: string;
  x: string | number;
  y: number | null;
  ref: string;
  path: string;
  detail?: string;
};
export type ResearchFigureSeries = { id: string; label: string; points: ResearchFigurePoint[] };
export type ResearchFigure = {
  id: string;
  title: string;
  kind: "bar" | "line" | "scatter";
  xLabel: string;
  yLabel: string;
  unit: string;
  xUnit?: string;
  /** Return fractions remain raw: .0138 displays as 1.38% or 1.38 pp. */
  format: "number" | "percent" | "percentage-points";
  series: ResearchFigureSeries[];
  notes: string[];
  sourceRefs: string[];
  /** Full available source row/category count, before preview bounds, when known. */
  totalPoints: number;
};
export type FigureEvidence = { id: string; tool: string; ok: boolean; json?: string };
export function researchFigures(evidence: FigureEvidence[], rawBodies?: Map<string, unknown>): ResearchFigure[];
export function cleanResearchFigures(raw: unknown): ResearchFigure[];
