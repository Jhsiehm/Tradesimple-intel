export const SOURCING: readonly ["platform", "both", "web"];
export const STYLES: readonly ["terminal", "professional", "simplified"];
export const SOURCING_LABEL: Record<string, string>;
export const STYLE_LABEL: Record<string, string>;
export const ASK_SESSION_KEY: string;
export const ASK_SESSION_VERSION: number;
export const PLATFORM_TOOLS: Set<string>;
export const WEB_TOOLS: Set<string>;

export type AskSession = { v: number; sourcing: string; style: string; updated: string };
export type AskModes = { sourcing: string; style: string; from: { sourcing: string; style: string }; acceptDefaults: boolean };

export function toolsForSourcing(sourcing: string): Set<string>;
export function filterToolDefs(defs: { name: string }[], sourcing: string): { name: string }[];
export function parseSourcing(q: string): string;
export function parseStyle(q: string): string;
export function isModeStatement(q: string): boolean;
export function isModeClear(q: string): boolean;
export function resolveModes(opts?: { question?: string; session?: unknown; answers?: Record<string, unknown>; acceptDefaults?: boolean }): AskModes;
export function sourcingClarify(opts?: { question?: string; session?: unknown; answers?: Record<string, unknown>; acceptDefaults?: boolean }): Array<{ path: string; prompt: string; chips: { label: string; value: string }[]; fallback: string }>;
export function wantsOutsideWorld(q: string): boolean;
export function cleanSession(raw: unknown): AskSession;
export function mergeSession(prev: unknown, patch: { sourcing?: string; style?: string }, updated?: string): AskSession;
export function stylePrompt(style: string): string;
export function layerPrompts(sourcing: string): string[];
export function sourcingPrompt(sourcing: string): string;
export function modeSystemNote(modes: { sourcing: string; style: string }): string;
export function describeModes(modes: { sourcing: string; style: string }): string;
