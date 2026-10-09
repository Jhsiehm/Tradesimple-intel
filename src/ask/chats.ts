import { cleanPrefs, mergePrefs, PREFS_KEY, type Prefs } from "../../shared/backtestAsk.mjs";
import { stripRefs } from "../../shared/citations.mjs";
import { ASK_SESSION_KEY, cleanSession, mergeSession } from "../../shared/askModes.mjs";
import type { SavedChat, Step, Turn } from "./types";

/** Chats kept in this browser. v2 holds the step trace; v1 sheet chats and the old answer history migrate in once. */
export const CHATS_KEY = "intel:ask:chats:v2";
export const MODEL_KEY = "intel:agent:model:v1";
const OLD_SHEET = "intel:agent:chats:v1";
const OLD_HISTORY = "intel:ask:history:v1";
const CAP = 30;
const TEXT_CAP = 6_000;

const read = (key: string): unknown => {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
};
const str = (v: unknown, n = 400) => (typeof v === "string" ? v.slice(0, n) : "");
const id = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function blankTurn(question: string, extra: Partial<Turn> = {}): Turn {
  return { id: id(), question, at: new Date().toISOString(), text: "", steps: [], phase: "planning", notes: [], done: null, clarify: null, error: "", model: "", context: "", ...extra };
}

/** Steps keep their trace but not the response preview, so a kept chat stays small. */
const slimStep = (s: Step): Step => ({ ...s, preview: s.preview ? s.preview.slice(0, 400) : undefined, requests: s.requests.slice(0, 4) });
const slimTurn = (t: Turn): Turn => ({ ...t, text: t.text.slice(0, TEXT_CAP), steps: t.steps.map(slimStep), done: t.done ? { ...t.done, answer: t.done.answer.slice(0, TEXT_CAP) } : null });

function asTurn(raw: unknown): Turn | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<Turn>;
  if (typeof t.question !== "string") return null;
  return { ...blankTurn(t.question), ...t, steps: Array.isArray(t.steps) ? t.steps : [], notes: Array.isArray(t.notes) ? t.notes : [], phase: t.phase === "error" ? "error" : "done" } as Turn;
}

/** v1 sheet chats were user/assistant pairs; v1 history was one answer per question. */
function migrate(): SavedChat[] {
  const out: SavedChat[] = [];
  const sheet = read(OLD_SHEET);
  if (Array.isArray(sheet)) {
    for (const c of sheet) {
      if (!c || typeof c !== "object" || !Array.isArray(c.turns)) continue;
      const turns: Turn[] = [];
      for (let i = 0; i < c.turns.length; i++) {
        const u = c.turns[i];
        const a = c.turns[i + 1];
        if (u?.role !== "user") continue;
        const answer = a?.role === "assistant" ? str(a.content, TEXT_CAP) : "";
        turns.push(blankTurn(str(u.content, 800), { phase: "done", text: answer, notes: ["Kept before live steps existed; tool trace not recorded."] }));
        if (a?.role === "assistant") i += 1;
      }
      if (turns.length) out.push({ id: str(c.id, 40) || id(), title: chatTitle(turns), turns, updated: str(c.updated, 40) });
    }
  }
  const hist = read(OLD_HISTORY);
  if (Array.isArray(hist)) {
    for (const h of hist) {
      if (!h || typeof h.question !== "string" || typeof h.answer !== "string") continue;
      const turn = blankTurn(h.question.slice(0, 800), { phase: "done", text: h.answer.slice(0, TEXT_CAP), at: str(h.at, 40), model: str(h.model, 120), notes: ["Saved answer from the earlier Ask panel."] });
      out.push({ id: id(), title: chatTitle([turn]), turns: [turn], updated: str(h.at, 40) });
    }
  }
  return out;
}

/**
 * Stored v2 chats as they load. Chats kept before short titles had the first question cut at 80 characters:
 * unless the user renamed one (`named`), its title is recomputed, so old chats migrate on read without a new key.
 */
export function normalizeChats(raw: unknown): SavedChat[] {
  if (!Array.isArray(raw)) return [];
  const out = raw.flatMap((c) => {
    if (!c || typeof c.id !== "string" || !Array.isArray(c.turns)) return [];
    const turns = c.turns.map(asTurn).filter(Boolean) as Turn[];
    if (!turns.length) return [];
    const named = c.named === true && Boolean(cleanName(c.title));
    const chat: SavedChat = { id: c.id, title: named ? cleanName(c.title) : chatTitle(turns), turns, updated: str(c.updated, 40) };
    if (named) chat.named = true;
    if (c.pinned === true) chat.pinned = true;
    return [chat];
  });
  return capChats(out);
}

export function loadChats(): SavedChat[] {
  const raw = read(CHATS_KEY);
  if (Array.isArray(raw)) return normalizeChats(raw);
  const moved = migrate().sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, CAP);
  if (moved.length) saveChats(moved);
  return moved;
}

export function saveChats(chats: SavedChat[]): boolean {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(capChats(chats).map((c) => ({ ...c, turns: c.turns.map(slimTurn) }))));
    return true;
  } catch {
    return false;
  }
}

/** Over the cap, the oldest unpinned chats go first; pinned chats are never dropped to make room. */
export function capChats(chats: SavedChat[]): SavedChat[] {
  if (chats.length <= CAP) return chats;
  const out = [...chats];
  for (let i = out.length - 1; i >= 0 && out.length > CAP; i--) if (!out[i].pinned) out.splice(i, 1);
  return out;
}

/** Most recent first; the chat keeps its pin and a name the user gave it. */
export function upsertChat(chats: SavedChat[], chat: SavedChat): SavedChat[] {
  const was = chats.find((c) => c.id === chat.id);
  const next: SavedChat = { ...chat };
  if (was?.named && !chat.named) { next.named = true; next.title = was.title; }
  if (was?.pinned && chat.pinned === undefined) next.pinned = true;
  return capChats([next, ...chats.filter((c) => c.id !== chat.id)]);
}
export const removeChat = (chats: SavedChat[], chatId: string) => chats.filter((c) => c.id !== chatId);
/** Put a deleted chat back where it was (Undo). */
export function restoreChat(chats: SavedChat[], chat: SavedChat, index: number): SavedChat[] {
  const rest = chats.filter((c) => c.id !== chat.id);
  return capChats([...rest.slice(0, index), chat, ...rest.slice(index)]);
}
/** An empty name goes back to the automatic title. */
export function renameChat(chats: SavedChat[], chatId: string, name: string): SavedChat[] {
  const title = cleanName(name);
  return chats.map((c) => {
    if (c.id !== chatId) return c;
    const next: SavedChat = { ...c, title: title || chatTitle(c.turns) };
    if (title) next.named = true; else delete next.named;
    return next;
  });
}
export function pinChat(chats: SavedChat[], chatId: string, pinned: boolean): SavedChat[] {
  return chats.map((c) => {
    if (c.id !== chatId) return c;
    const next: SavedChat = { ...c };
    if (pinned) next.pinned = true; else delete next.pinned;
    return next;
  });
}
/** Display order: pinned first, each group keeping its most-recent-first order. */
export const orderChats = (chats: SavedChat[]) => [...chats.filter((c) => c.pinned), ...chats.filter((c) => !c.pinned)];
/** Case-insensitive match on the title and every question in the chat. */
export function filterChats(chats: SavedChat[], query: string): SavedChat[] {
  const q = query.trim().toLowerCase();
  if (!q) return chats;
  return chats.filter((c) => c.title.toLowerCase().includes(q) || c.turns.some((t) => t.question.toLowerCase().includes(q)));
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 80) : "");

const TITLE_MAX = 48;
const LEAD = /^(?:(?:hey|hi|hello|ok|okay|so|um|uh|well|yo)\b[\s,!.:-]*)+/i;
const ASKING = /^(?:(?:please|pls|kindly)\s+)?(?:(?:can|could|would|will) (?:you|u)(?: please| pls| kindly)?|i want to know|i wonder|i (?:want|need|would like|wanna) (?:you )?to|i'd like (?:you )?to|tell me|show me|give me|help me(?: to)?|let me know|please|pls)\b[\s,:-]*/i;
const TAIL = /(?:[\s,]+(?:please|pls|thanks|thank you|thx|for me))+[\s.!?]*$/i;

/**
 * A short title from the first question, without a model: collapse spacing, drop greetings and
 * "can you / please / tell me" lead-ins and "thanks" tails, tidy punctuation, capitalize, ≤48 characters
 * cut on a word with an ellipsis.
 */
export function shortTitle(question: string): string {
  let s = String(question || "").replace(/[\u201c\u201d]/g, "\"").replace(/\s+/g, " ").trim();
  s = s.replace(/^["'`]+|["'`]+$/g, "").trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(LEAD, "").replace(ASKING, "").trim();
    if (s === before) break;
  }
  s = s.replace(TAIL, "");
  s = s.replace(/\s+([,.;:!?%)])/g, "$1").replace(/([,;:])(?=[^\s\d])/g, "$1 ").replace(/\(\s+/g, "(");
  s = s.replace(/([!?.])\1+/g, "$1").replace(/[\s,;:.!?-]+$/, "").trim();
  if (!s) return "Untitled";
  s = s[0].toUpperCase() + s.slice(1);
  if (s.length <= TITLE_MAX) return s;
  const cut = s.slice(0, TITLE_MAX - 1);
  const space = s[TITLE_MAX - 1] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(space > TITLE_MAX * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
}

export const chatTitle = (turns: Turn[]) => shortTitle(turns[0]?.question || "");
export const newChatId = id;

/** Prior turns as model history: question and answer text only, without refs (each turn numbers its tools from t1). */
export function historyOf(turns: Turn[]) {
  return turns.filter((t) => t.done && !t.done.clarify).flatMap((t) => [
    { role: "user" as const, content: t.question },
    { role: "assistant" as const, content: stripRefs(t.done?.answer || t.text).slice(0, 1200) }
  ]).slice(-6);
}

/**
 * Every backtest the latest backtest turn ran, in order: follow-ups like "hold 30 days instead" change all of them
 * (an "all data sources" turn ran one per source). A source run twice in that turn counts once, its last run.
 */
export function lastBacktests(turns: Turn[]) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const bt = turns[i].done?.backtests?.filter((b) => b.ok);
    if (bt?.length) return bt.filter((b, j) => !bt.slice(j + 1).some((x) => x.spec.source === b.spec.source));
  }
  return [];
}

export function attachedBody(chat: SavedChat | null) {
  if (!chat) return null;
  return { title: chat.title, turns: historyOf(chat.turns) };
}

export function loadModelChoice(): string {
  try { return (localStorage.getItem(MODEL_KEY) || "").trim().slice(0, 160); } catch { return ""; }
}
export function saveModelChoice(model: string) {
  try { if (model) localStorage.setItem(MODEL_KEY, model.slice(0, 160)); else localStorage.removeItem(MODEL_KEY); } catch { /* this run still sends it */ }
}

export function loadPrefs(): Prefs {
  return cleanPrefs(read(PREFS_KEY));
}
export function savePrefs(next: Prefs): Prefs {
  const clean = cleanPrefs(next);
  try {
    if (Object.keys(clean.values).length) localStorage.setItem(PREFS_KEY, JSON.stringify(clean));
    else localStorage.removeItem(PREFS_KEY);
  } catch { /* still applies for this session */ }
  return clean;
}
export const addPrefs = (prefs: Prefs, values: Record<string, unknown>) => savePrefs(mergePrefs(prefs, values, new Date().toISOString()));
export function dropPref(prefs: Prefs, path: string): Prefs {
  const values = { ...prefs.values };
  delete values[path];
  return savePrefs({ ...prefs, values, updated: new Date().toISOString() });
}

export type AskSession = ReturnType<typeof cleanSession>;

export function loadSession(): AskSession {
  return cleanSession(read(ASK_SESSION_KEY));
}

export function saveSession(next: AskSession): AskSession {
  const clean = cleanSession(next);
  try {
    if (clean.sourcing || clean.style) localStorage.setItem(ASK_SESSION_KEY, JSON.stringify(clean));
    else localStorage.removeItem(ASK_SESSION_KEY);
  } catch { /* still applies for this session */ }
  return clean;
}

export const setSessionModes = (prev: AskSession, patch: { sourcing?: string; style?: string }) =>
  saveSession(mergeSession(prev, patch, new Date().toISOString()));

export const clearSession = () => saveSession(cleanSession({ v: 1 }));
