export type OpenState = Record<string, boolean>;
export const CASE_OPEN_KEY: string;
export function sectionId(kind: string | undefined, title: string): string;
export function parseOpen(raw: string | null | undefined): OpenState;
export function isOpen(state: OpenState, id: string, fallback?: boolean): boolean;
export function withOpen(state: OpenState, id: string, open: boolean): OpenState;
