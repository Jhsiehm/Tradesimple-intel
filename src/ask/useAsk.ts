import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEMO } from "../lib/api";
import type { AgentContext } from "../agent/context";
import {
  addPrefs, attachedBody, blankTurn, chatTitle, dropPref, historyOf, lastBacktest, loadChats, loadModelChoice, loadPrefs,
  newChatId, removeChat, saveChats, saveModelChoice, savePrefs, upsertChat
} from "./chats";
import { readEvents } from "./stream";
import type { AskStatus, ClarifyAsk, Done, SavedChat, Step, Turn } from "./types";

export type AskApi = ReturnType<typeof useAsk>;
type RunOpts = { answers?: Record<string, unknown>; acceptDefaults?: boolean; turnId?: string };

const OFF: AskStatus = { ok: false, configured: false, provider: "", model: "", missing: [], notice: "The API did not answer.", tools: [] };

/** `#ask=<question>` is a share link: it opens the sheet and asks. */
const hashQuestion = () => {
  if (!location.hash.startsWith("#ask=")) return "";
  try { return decodeURIComponent(location.hash.slice(5)); } catch { return ""; }
};

/** Screen context goes along only when something is selected or a theory is open. */
export const hasContext = (ctx: AgentContext) => Boolean(ctx.node || ctx.theory);

/** The one Ask: sheet state, this chat's turns with their live steps, kept chats, model choice, and preferences. */
export function useAsk() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const [chats, setChats] = useState<SavedChat[]>(() => loadChats());
  const [status, setStatus] = useState<AskStatus | null>(null);
  const [choice, setChoice] = useState(loadModelChoice);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [attachId, setAttachId] = useState("");
  const [detached, setDetached] = useState(false);
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const ctxRef = useRef<AgentContext>({ section: "", node: null, theory: null });
  const state = useRef({ turns, chatId, kept, detached, prefs, attachId, chats, choice });
  state.current = { turns, chatId, kept, detached, prefs, attachId, chats, choice };
  const statusRef = useRef<AskStatus | null>(null);
  /** App hands over what is on screen each render; it is read only when a question is sent. */
  const bindContext = useCallback((ctx: AgentContext) => { ctxRef.current = ctx; }, []);

  const loadStatus = useCallback(async () => {
    if (statusRef.current) return statusRef.current;
    const res = DEMO ? { ...OFF, notice: "Ask needs the local server." } : await api<AskStatus>("/api/ask").catch(() => OFF);
    statusRef.current = res;
    setStatus(res);
    return res;
  }, []);

  const models = status?.models || [];
  const model = models.some((m) => m.id === choice) ? choice : status?.model || "";
  const small = models.find((m) => m.id === model)?.small ?? Boolean(status?.small);
  const chooseModel = useCallback((next: string) => { setChoice(next); saveModelChoice(next); }, []);

  const persist = useCallback((next: Turn[]) => {
    const s = state.current;
    if (!s.kept || !s.chatId) return;
    const chat = { id: s.chatId, title: chatTitle(next), turns: next, updated: new Date().toISOString() };
    const list = upsertChat(loadChats(), chat);
    if (saveChats(list)) setChats(list);
  }, []);

  const run = useCallback(async (raw: string, opts: RunOpts = {}) => {
    const question = raw.trim().slice(0, 800);
    if (!question) return;
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setOpen(true);
    setDraft("");
    const s = state.current;
    const ctx = hasContext(ctxRef.current) && !s.detached ? ctxRef.current : null;
    const ctxLabel = ctx ? (ctx.theory ? `theory ${ctx.theory.a.label} ↔ ${ctx.theory.b.label}` : ctx.node || "") : "";
    const prior = opts.turnId ? s.turns.filter((t) => t.id !== opts.turnId) : s.turns;
    const turn = blankTurn(question, opts.turnId ? { id: opts.turnId, context: ctxLabel } : { context: ctxLabel });
    const tid = turn.id;
    setTurns(opts.turnId ? s.turns.map((t) => (t.id === tid ? turn : t)) : [...s.turns, turn]);
    setBusy(true);
    const patch = (f: (t: Turn) => Turn) => setTurns((all) => (ctl.current === mine ? all.map((t) => (t.id === tid ? f(t) : t)) : all));
    const step = (sid: string, f: (x: Step) => Step) => patch((t) => ({ ...t, steps: t.steps.map((x) => (x.id === sid ? f(x) : x)) }));
    const finish = () => {
      setBusy(false);
      setTurns((all) => { persist(all); return all; });
    };
    const cfg = await loadStatus();
    if (!cfg.configured) {
      patch((t) => ({ ...t, phase: "error", error: cfg.notice || "Ask is not configured — add a key to .env.local" }));
      finish();
      return;
    }
    const used = s.choice && (cfg.models || []).some((m) => m.id === s.choice) ? s.choice : cfg.model;
    patch((t) => ({ ...t, model: used }));
    const attached = s.attachId ? s.chats.find((c) => c.id === s.attachId && c.id !== s.chatId) || null : null;
    const bt = lastBacktest(prior);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          history: historyOf(prior),
          model: used,
          context: ctx ? { node: ctx.node, theory: ctx.theory } : null,
          attached: attachedBody(attached),
          prefs: s.prefs,
          prior: bt?.spec || null,
          answers: opts.answers || {},
          acceptDefaults: Boolean(opts.acceptDefaults)
        }),
        signal: mine.signal
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        patch((t) => ({ ...t, phase: "error", error: String(body.error || `HTTP ${res.status}`) }));
        return;
      }
      await readEvents(res.body, (e) => {
        switch (e.type) {
          case "step_progress":
            if (typeof e.id === "string") {
              const sid = e.id;
              if (typeof e.ms === "number") step(sid, (x) => (x.state === "running" ? { ...x, ms: e.ms as number } : x));
              if (typeof e.request === "string") step(sid, (x) => ({ ...x, requests: [...x.requests, e.request as string] }));
              if (typeof e.note === "string") step(sid, (x) => ({ ...x, using: e.note as string }));
            } else if (e.reset) patch((t) => ({ ...t, text: "", phase: "writing", notes: [...t.notes, String(e.note || "Rewriting the answer.")] }));
            else if (typeof e.phase === "string") patch((t) => (t.phase === "done" || t.phase === "error" ? t : { ...t, phase: e.phase as Turn["phase"] }));
            break;
          case "step_start":
            patch((t) => ({ ...t, steps: [...t.steps, { id: String(e.id), tool: String(e.tool), label: String(e.label || e.tool), args: e.args, phase: (e.phase as Step["phase"]) || "fetching", at: String(e.at || ""), state: "running", ms: 0, requests: [], diff: Array.isArray(e.diff) ? (e.diff as string[]) : undefined }] }));
            break;
          case "step_end":
            step(String(e.id), (x) => ({ ...x, state: e.ok ? "ok" : "error", ms: Number(e.ms) || x.ms, rows: Number(e.rows) || 0, source: String(e.source || ""), asOf: String(e.asOf || ""), latency: String(e.latency || ""), note: String(e.note || ""), open: String(e.open || ""), requests: Array.isArray(e.requests) && e.requests.length ? (e.requests as string[]) : x.requests, preview: String(e.preview || "") }));
            break;
          case "token":
            patch((t) => ({ ...t, text: t.text + String(e.delta || "") }));
            break;
          case "clarify":
            patch((t) => ({ ...t, clarify: e as unknown as ClarifyAsk }));
            break;
          case "done": {
            const done = e as unknown as Done;
            patch((t) => ({ ...t, phase: "done", text: done.answer || t.text, done }));
            if (done.prefs?.clear) setPrefs(savePrefs({ v: 1, values: {}, updated: "" }));
            else if (done.prefs?.set) setPrefs((p) => addPrefs(p, done.prefs!.set!));
            break;
          }
          case "error":
            patch((t) => ({ ...t, phase: "error", error: String(e.error || "Ask failed.") }));
            break;
        }
      });
      patch((t) => (t.phase === "done" || t.phase === "error" ? t : { ...t, phase: "error", error: "The answer stopped before it finished." }));
    } catch (err) {
      if (!mine.signal.aborted) patch((t) => ({ ...t, phase: "error", error: err instanceof Error ? err.message : "Ask failed." }));
    } finally {
      if (ctl.current === mine) finish();
    }
  }, [loadStatus, persist]);

  const show = useCallback((prefill = "") => { setOpen(true); setShown((n) => n + 1); if (prefill) setDraft(prefill); void loadStatus(); }, [loadStatus]);
  const close = useCallback(() => setOpen(false), []);
  const stop = useCallback(() => { ctl.current?.abort(); ctl.current = null; setBusy(false); }, []);
  const newChat = useCallback(() => { stop(); setTurns([]); setChatId(null); setKept(false); setAttachId(""); setDraft(""); }, [stop]);

  const keep = useCallback(() => {
    const s = state.current;
    if (!s.turns.length) return false;
    const cid = s.chatId || newChatId();
    const list = upsertChat(loadChats(), { id: cid, title: chatTitle(s.turns), turns: s.turns, updated: new Date().toISOString() });
    if (!saveChats(list)) return false;
    setChats(list);
    setChatId(cid);
    setKept(true);
    return true;
  }, []);

  const openSaved = useCallback((cid: string) => {
    const chat = state.current.chats.find((c) => c.id === cid);
    if (!chat) return;
    stop();
    setTurns(chat.turns);
    setChatId(chat.id);
    setKept(true);
    setAttachId("");
  }, [stop]);

  const forget = useCallback((cid: string) => {
    const list = removeChat(loadChats(), cid);
    saveChats(list);
    setChats(list);
    if (state.current.chatId === cid) { setChatId(null); setKept(false); }
  }, []);

  const removePref = useCallback((path: string) => setPrefs((p) => dropPref(p, path)), []);
  const clearPrefs = useCallback(() => setPrefs(savePrefs({ v: 1, values: {}, updated: "" })), []);

  useEffect(() => {
    const take = () => {
      const q = hashQuestion();
      if (!q) return;
      window.history.replaceState(null, "", location.pathname + location.search);
      void run(q);
    };
    take();
    window.addEventListener("hashchange", take);
    return () => window.removeEventListener("hashchange", take);
  }, [run]);

  useEffect(() => { if (open) void loadStatus(); }, [open, loadStatus]);

  return {
    open, shown, show, close, draft, setDraft, turns, busy, run, stop, newChat,
    chats, chatId, kept, keep, openSaved, forget, attachId, setAttachId,
    status, model, models, small, chooseModel,
    prefs, removePref, clearPrefs,
    detached, setDetached, bindContext
  };
}
