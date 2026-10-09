import type { Theory } from "./relations.mjs";

export type Note = { id: string; type: "note"; label: string; note: string; kind: "person" | "event" | "company" | "other"; created: string };
export type TheoryDoc = { v: number; theories: Theory[]; notes: Note[] };

export const THEORY_KEY: string;
export const THEORY_VERSION: number;
export const MAX_THEORIES: number;
export const MAX_NOTES: number;
export const SHARE_MAX: number;

export function cleanTheory(raw: unknown): Theory | null;
export function cleanNote(raw: unknown): Note | null;
export function cleanDoc(raw: unknown): TheoryDoc;
export function migrate(raw: unknown): TheoryDoc;
export function parseDoc(json: string | null | undefined): TheoryDoc;
export function serialize(doc: TheoryDoc): string;
export function mergeDocs(current: TheoryDoc, incoming: TheoryDoc): TheoryDoc;
export function encodeShare(doc: TheoryDoc): string;
export function decodeShare(token: string): TheoryDoc | null;
