export declare const MISSING: string;
export declare const SLOT_FORMATS: string[];
export declare const SLOT_NOTE: string;

export type SlotMissing = { slot: string; reason: string; ref: string };
export type SlotSources = {
  evidence: { id: string; ok: boolean }[];
  bodies?: Map<string, unknown>;
  raws?: Map<string, unknown>;
};
export type SlotResult = { ok: boolean; text: string; reason?: string; ref?: string; table?: boolean };

export declare function parsePath(raw: string): { ref: string; keys: (string | number)[] } | null;
export declare function lookup(root: unknown, keys: (string | number)[]): { found: boolean; value: unknown };
export declare function autoFormat(key: string, value: unknown): string;
export declare function formatValue(value: unknown, fmt?: string, key?: string): { ok: boolean; text: string; reason?: string };
export declare function columnLabel(col: string): string;
export declare function renderSlot(slot: string, src: SlotSources, used?: Map<string, number[]>): SlotResult;
export declare function renderSlots(text: string, src: SlotSources): { text: string; count: number; missing: SlotMissing[]; used: Map<string, number[]> };
export declare function slotStream(fill: (slot: string) => string): { push(delta: string): string; flush(): string };
export declare function slotEvidence<T extends { id: string; json?: string }>(evidence: T[], used: Map<string, number[]> | null | undefined): T[];
export declare function missingNote(missing: SlotMissing[] | null | undefined): string;
