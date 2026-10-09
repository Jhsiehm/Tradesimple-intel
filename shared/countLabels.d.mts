export type CountClaim = { raw: string; value: number; unit: string; family: string };
export type Mislabel = { raw: string; value: number; unit: string; foundAs: string[] };
export function countClaims(answer: string): CountClaim[];
export function labelsFor(body: unknown, value: number): string[];
export function mislabeledCounts(answer: string, bodies: unknown[]): Mislabel[];
export function mislabelNote(m: Mislabel): string;
