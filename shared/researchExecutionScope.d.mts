import type { ResearchIntent } from "./researchIntent.mjs";
export function studyDesignRequested(question: unknown): boolean;
export function designOnlyRequested(question: unknown): boolean;
export function executionRequested(question: unknown): boolean;
export function inspectionOnlyRequested(question: unknown): boolean;
export function resolveDesignOnly(question: unknown, history?: { role: string; content: string }[]): boolean;
export function researchExecutionRefusal(intent: ResearchIntent | null | undefined, tool: string): string;
