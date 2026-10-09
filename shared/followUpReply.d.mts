export function askedFields(multi: unknown): string[];
export function handOffNote(priors?: { source: string }[], refs?: string[]): string;
export function followUpOutcome(multi: unknown): { understood: boolean; unchanged: boolean; text: string };
