export const WEB_CAPS: { web_search: number; web_fetch: number; results: number; pageChars: number; snippetChars: number };
export const WEB_LABEL: string;
export function etClock(iso: string): string;
export function domainOf(url: string): string;
export function wantsWeb(question: string): boolean;
export function webQuery(question: string, today?: string): string;
export function htmlToText(html: string, max?: number): string;
export function titleOf(html: string): string;
export interface WebStep { label: string; source: string; asOf: string; latency: string }
export function webStep(opts: { url: string; title?: string; retrievedAt: string; via?: string }): WebStep;
export interface WebResult { url: string; title?: string; snippet?: string; published?: string }
export function splitWebResults(raw: unknown, nextId: () => string): { children: { id: string; body: Record<string, unknown>; step: WebStep }[]; parent: unknown };
export function webCallLabel(name: string, args?: Record<string, unknown>): string;
export const WEB_NOTE: string;
export const WEB_CAVEAT: string;
export function webTail(answer: string): string;
export const COVERAGE_NOTE: string;
export function scaledFigures(text: string): number[];
