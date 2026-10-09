import type { Saved } from "./types";

const KEY = "intel:ask:history:v1";
export const HISTORY_CAP = 20;

export function loadHistory(): Saved[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.question === "string" && typeof x.answer === "string").slice(0, HISTORY_CAP) : [];
  } catch {
    return [];
  }
}

/** Newest first; the same question replaces its older copy. Answers are cut so the store stays small. */
export function saveHistory(list: Saved[], entry: Saved): Saved[] {
  const next = [{ ...entry, answer: entry.answer.slice(0, 4000) }, ...list.filter((x) => x.question.toLowerCase() !== entry.question.toLowerCase())].slice(0, HISTORY_CAP);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode or full: the answer still shows */ }
  return next;
}

export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  return [] as Saved[];
}
