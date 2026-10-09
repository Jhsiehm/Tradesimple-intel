import { cleanPrefs, mergePrefs, PREFS_KEY, type Prefs } from "../../shared/backtestAsk.mjs";
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
      if (turns.length) out.push({ id: str(c.id, 40) || id(), title: str(c.title, 80) || turns[0].question.slice(0, 80), turns, updated: str(c.updated, 40) });
    }
  }
  const hist = read(OLD_HISTORY);
  if (Array.isArray(hist)) {
    for (const h of hist) {
      if (!h || typeof h.question !== "string" || typeof h.answer !== "string") continue;
      out.push({ id: id(), title: h.question.slice(0, 80), turns: [blankTurn(h.question.slice(0, 800), { phase: "done", text: h.answer.slice(0, TEXT_CAP), at: str(h.at, 40), model: str(h.model, 120), notes: ["Saved answer from the earlier Ask panel."] })], updated: str(h.at, 40) });
    }
  }
  return out;
}

export function loadChats(): SavedChat[] {
  const raw = read(CHATS_KEY);
  if (Array.isArray(raw)) {
    return raw.flatMap((c) => {
      if (!c || typeof c.id !== "string" || !Array.isArray(c.turns)) return [];
      const turns = c.turns.map(asTurn).filter(Boolean) as Turn[];
      return turns.length ? [{ id: c.id, title: str(c.title, 80) || turns[0].question.slice(0, 80), turns, updated: str(c.updated, 40) }] : [];
    }).slice(0, CAP);
  }
  const moved = migrate().sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, CAP);
  if (moved.length) saveChats(moved);
  return moved;
}

export function saveChats(chats: SavedChat[]): boolean {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, CAP).map((c) => ({ ...c, turns: c.turns.map(slimTurn) }))));
    return true;
  } catch {
    return false;
  }
}

export const upsertChat = (chats: SavedChat[], chat: SavedChat) => [chat, ...chats.filter((c) => c.id !== chat.id)].slice(0, CAP);
export const removeChat = (chats: SavedChat[], chatId: string) => chats.filter((c) => c.id !== chatId);
export const chatTitle = (turns: Turn[]) => (turns[0]?.question.replace(/\s+/g, " ").trim() || "Untitled").slice(0, 80);
export const newChatId = id;

/** Prior turns as model history: question and answer text only. */
export function historyOf(turns: Turn[]) {
  return turns.filter((t) => t.done && !t.done.clarify).flatMap((t) => [
    { role: "user" as const, content: t.question },
    { role: "assistant" as const, content: (t.done?.answer || t.text).slice(0, 1200) }
  ]).slice(-6);
}

/** The last backtest this chat ran: follow-ups like "hold 30 days instead" change it. */
export function lastBacktest(turns: Turn[]) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const bt = turns[i].done?.backtests?.filter((b) => b.ok);
    if (bt?.length) return bt[bt.length - 1];
  }
  return null;
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
