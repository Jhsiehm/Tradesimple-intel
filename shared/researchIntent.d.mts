export type ResearchIntent = {
  version: number;
  question: string;
  contextQuestion: string | null;
  family: 'causal' | 'predictive' | 'strategy' | 'descriptive';
  domains: string[];
  outcome: string;
  route: 'assessment' | 'legacy' | 'conversation';
  reason: string;
  allowedSources: string[];
  windows: string[];
  benchmark: string | null;
};
export const RESEARCH_ROUTING_VERSION: number;
export function researchWords(question: unknown): string;
export function policyDomains(question: string): string[];
export function explicitSignalSources(question: string): string[];
export function interpretResearch(question: string, options?: {
  prior?: {source: string} | null;
  priors?: {source: string}[];
  history?: {role: string; content: string}[];
  context?: {chart?: unknown} | null;
}): ResearchIntent;
