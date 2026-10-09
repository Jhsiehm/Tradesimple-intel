export const EXPECTED_KEYS: string[];
export function toCsv(head: string[], rows: unknown[][]): string;
export function expectedOf(stats: unknown): Record<string, number | null>;
export type ReplicateFile = { name: string; mime: string; text: string };
export function replicateFiles(rep: unknown): ReplicateFile[];
export function methodsMd(rep: unknown): string;
export function crc32(bytes: Uint8Array): number;
export function zipFiles(files: { name: string; text: string | Uint8Array }[], stamp?: Date): Uint8Array;
