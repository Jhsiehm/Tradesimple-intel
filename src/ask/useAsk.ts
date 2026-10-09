import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEMO, waitForApi } from "../lib/api";
import { isRestart, mayResend } from "../lib/retry";
import type { AgentContext } from "../agent/context";
import {
  addPrefs, attachedBody, blankTurn, chatTitle, dropPref, historyOf, lastBacktests, loadChats, loadModelChoice, loadPrefs,
  newChatId, pinChat, removeChat, renameChat, restoreChat, saveChats, saveModelChoice, savePrefs, upsertChat
} from "./chats";
import { readEvents } from "./stream";
import { AUTO } from "../../shared/modelRoute.mjs";
import type { AskStatus, ClarifyAsk, Done, SavedChat, Step, Turn } from "./types";

export type AskApi = ReturnType<typeof useAsk>;
/** `fresh`: skip a reusable stored answer (the "Re-ask" button). */
type RunOpts = { answers?: Record<string, unknown>; acceptDefaults?: boolean; turnId?: string; fresh?: boolean };

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
  /** Size the next `show` asks for ("Ask about this" opens at Half); the sheet reads it when `shown` changes. */
  const [snapTo, setSnapTo] = useState<"half" | null>(null);
  /** The last deleted chat and where it was, for Undo. */
  const [deleted, setDeleted] = useState<{ chat: SavedChat; index: number } | null>(null);
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
  /** "auto" unless the user pinned a model the server offers; a new user starts on Auto. */
  const model: string = choice !== AUTO && models.some((m) => m.id === choice) ? choice : AUTO;
  const small = model !== AUTO && Boolean(models.find((m) => m.id === model)?.small);
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
    const ctxLabel = ctx ? (ctx.theory ? `theory ${ctx.theory.a.label} ↔ ${ctx.theory.b.label}` : ctx.label || ctx.node || "") : "";
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
    const used = s.choice && s.choice !== AUTO && (cfg.models || []).some((m) => m.id === s.choice) ? s.choice : AUTO;
    patch((t) => ({ ...t, model: used === AUTO ? "" : used }));
    const attached = s.attachId ? s.chats.find((c) => c.id === s.attachId && c.id !== s.chatId) || null : null;
    const bts = lastBacktests(prior);
    const bt = bts.at(-1) || null;
    const payload = JSON.stringify({
      question,
      history: historyOf(prior),
      model: used,
      context: ctx ? { node: ctx.node, theory: ctx.theory, label: ctx.label || "" } : null,
      attached: attachedBody(attached),
      prefs: s.prefs,
      prior: bt?.spec || null,
      priors: bts.map((b) => b.spec),
      answers: opts.answers || {},
      acceptDefaults: Boolean(opts.acceptDefaults),
      fresh: Boolean(opts.fresh)
    });
    /** Answer text seen so far: a restart before any token resends the question once; after that it would answer twice. */
    const seen = { tokens: 0, done: false, resent: false };
    const recover = async () => {
      if (!mayResend(seen) || mine.signal.aborted) return false;
      seen.resent = true;
      const back = await waitForApi(mine.signal);
      if (!back || mine.signal.aborted) return false;
      patch((t) => ({ ...t, steps: [], text: "", phase: "planning", notes: [...t.notes, "The API restarted before an answer arrived, so the question was sent again."] }));
      return true;
    };
    try {
      for (;;) {
        let res: Response;
        try {
          res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: mine.signal });
        } catch (error) {
          if (isRestart({ error }) && (await recover())) continue;
          throw error;
        }
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          if (isRestart({ status: res.status, body: text }) && (await recover())) continue;
          let body: Record<string, unknown> = {};
          try { body = JSON.parse(text); } catch { /* not JSON */ }
          patch((t) => ({ ...t, phase: "error", error: String(body.error || `HTTP ${res.status}`) }));
          return;
        }
        let ended = false;
        try {
          ended = await stream(res.body);
        } catch (error) {
          if (!mine.signal.aborted && isRestart({ error }) && (await recover())) continue;
          throw error;
        }
        if (!ended && (await recover())) continue;
        break;
      }
      patch((t) => (t.phase === "done" || t.phase === "error" ? t : { ...t, phase: "error", error: "The answer stopped before it finished." }));
    } catch (err) {
      if (!mine.signal.aborted) patch((t) => ({ ...t, phase: "error", error: err instanceof Error ? err.message : "Ask failed." }));
    } finally {
      if (ctl.current === mine) finish();
    }

    /** Read one event stream; true when it ended with `done` or `error`. */
    async function stream(body: ReadableStream<Uint8Array>) {
      let ended = false;
      await readEvents(body, (e) => {
        if (e.type === "token") seen.tokens += 1;
        if (e.type === "done") { seen.done = true; ended = true; }
        if (e.type === "error") ended = true;
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
          case "plan_note":
            patch((t) => ({ ...t, notes: [...t.notes, String(e.note || "")] }));
            break;
          case "model":
            patch((t) => ({ ...t, model: String(e.model || t.model), notes: e.reason ? [...t.notes, `Auto: ${String(e.reason)} → ${String(e.model)}`] : t.notes }));
            break;
          case "revise":
            patch((t) => ({ ...t, revising: e.state === "start" ? String(e.note || "Checking figures…") : "" }));
            break;
          case "budget":
            patch((t) => ({ ...t, model: typeof e.model === "string" ? e.model : t.model, notes: [...t.notes, String(e.note || "")] }));
            break;
          case "spend": {
            const spend = e.spend as AskStatus["spend"];
            if (statusRef.current) statusRef.current = { ...statusRef.current, spend };
            setStatus((st) => (st ? { ...st, spend } : st));
            break;
          }
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
      return ended;
    }
  }, [loadStatus, persist]);

  const show = useCallback((prefill = "", size: "half" | null = null) => {
    setOpen(true);
    setSnapTo(size);
    setShown((n) => n + 1);
    if (prefill) setDraft(prefill);
    void loadStatus();
  }, [loadStatus]);
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

  /** Shows turns that are not a kept chat, such as a scheduled task's stored result. */
  const openTurns = useCallback((list: Turn[]) => {
    stop();
    setTurns(list);
    setChatId(null);
    setKept(false);
    setAttachId("");
    setOpen(true);
    setShown((n) => n + 1);
  }, [stop]);

  const store = useCallback((list: SavedChat[]) => { if (saveChats(list)) setChats(list); }, []);

  /** Delete now; `undoForget` puts it back where it was. The open chat stays on screen, no longer kept. */
  const forget = useCallback((cid: string) => {
    const all = loadChats();
    const index = all.findIndex((c) => c.id === cid);
    if (index < 0) return;
    setDeleted({ chat: all[index], index });
    store(removeChat(all, cid));
    if (state.current.chatId === cid) setKept(false);
  }, [store]);
  const undoForget = useCallback(() => {
    if (!deleted) return;
    store(restoreChat(loadChats(), deleted.chat, deleted.index));
    if (state.current.chatId === deleted.chat.id) setKept(true);
    setDeleted(null);
  }, [deleted, store]);
  const dropUndo = useCallback(() => setDeleted(null), []);
  const rename = useCallback((cid: string, name: string) => store(renameChat(loadChats(), cid, name)), [store]);
  const pin = useCallback((cid: string, on: boolean) => store(pinChat(loadChats(), cid, on)), [store]);

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
    open, shown, show, snapTo, close, draft, setDraft, turns, busy, run, stop, newChat,
    chats, chatId, kept, keep, openSaved, forget, undoForget, dropUndo, deleted, rename, pin, attachId, setAttachId,
    status, model, models, small, chooseModel,
    prefs, removePref, clearPrefs,
    detached, setDetached, bindContext,
    openTurns
  };
}
