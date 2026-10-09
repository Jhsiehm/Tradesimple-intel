export type Formula = { id: string; title: string; tex: string; worked: string; note: string };
export function backtestFormulas(run: unknown): Formula[];
export function leadersFormulas(row?: unknown): Formula[];
export const PERCENT_FORMULA: Formula;
