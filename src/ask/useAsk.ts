import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEMO } from "../lib/api";
import { clearHistory, loadHistory, saveHistory } from "./history";
import { readEvents } from "./stream";
import type { AskStatus, Done, Evidence, Saved, Turn } from "./types";

const EMPTY: Turn = { question: "", text: "", evidence: [], running: [], phase: "thinking", done: null, error: "", notConfigured: false, missing: "" };
const NOT_CONFIGURED = "Ask is not configured — add a key to .env.local";

export type AskApi = ReturnType<typeof useAsk>;

/** `#ask=<question>` is a share link: it opens the panel and asks. */
const hashQuestion = () => {
  if (!location.hash.startsWith("#ask=")) return "";
  try { return decodeURIComponent(location.hash.slice(5)); } catch { return ""; }
};

export function useAsk() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [status, setStatus] = useState<AskStatus | null>(null);
  const [saved, setSaved] = useState<Saved[]>(() => loadHistory());
  const ctl = useRef<AbortController | null>(null);
  const session = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const statusRef = useRef<AskStatus | null>(null);

  const loadStatus = useCallback(async () => {
    if (statusRef.current) return statusRef.current;
    const res: AskStatus = DEMO
      ? { ok: true, configured: false, provider: "", model: "", missing: [], notice: "Ask needs the local server.", tools: [] }
      : await api<AskStatus>("/api/ask").catch(() => ({ ok: false, configured: false, provider: "", model: "", missing: [], notice: "The API did not answer.", tools: [] }));
    statusRef.current = res;
    setStatus(res);
    return res;
  }, []);

  const finish = useCallback((question: string, done: Done, evidence: Evidence[], model: string) => {
    const { answer, ...meta } = done;
    setSaved((h) => saveHistory(h, { at: new Date().toISOString(), question, answer, evidence, done: meta, model }));
    session.current = [...session.current, { role: "user" as const, content: question }, { role: "assistant" as const, content: answer.slice(0, 1200) }].slice(-6);
  }, []);

  const run = useCallback(async (raw: string) => {
    const question = raw.trim().slice(0, 800);
    if (!question) return;
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setOpen(true);
    setCollapsed(false);
    setTurn({ ...EMPTY, question });
    const cfg = await loadStatus();
    if (!cfg.configured) {
      setTurn({ ...EMPTY, question, phase: "error", notConfigured: true, error: cfg.notice || NOT_CONFIGURED, missing: cfg.missing.join(", ") });
      return;
    }
    const patch = (f: (t: Turn) => Turn) => setTurn((t) => (t && t.question === question && ctl.current === mine ? f(t) : t));
    const evidence: Evidence[] = [];
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history: session.current }),
        signal: mine.signal
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        patch((t) => ({ ...t, phase: "error", notConfigured: Boolean(body.notConfigured), error: String(body.error || `HTTP ${res.status}`), missing: String(body.missing || "") }));
        return;
      }
      await readEvents(res.body, (e) => {
        if (e.type === "status") patch((t) => ({ ...t, phase: e.phase === "answering" ? "answering" : "thinking" }));
        else if (e.type === "text") patch((t) => ({ ...t, text: t.text + String(e.delta || "") }));
        else if (e.type === "tool") patch((t) => ({ ...t, running: [...t.running, { id: String(e.id), label: String(e.label || e.tool) }] }));
        else if (e.type === "evidence") {
          const ev = e as unknown as Evidence;
          evidence.push(ev);
          patch((t) => ({ ...t, evidence: [...t.evidence, ev], running: t.running.filter((r) => r.id !== ev.id) }));
        } else if (e.type === "done") {
          const done = e as unknown as Done;
          patch((t) => ({ ...t, phase: "done", text: done.answer, done, running: [] }));
          finish(question, done, evidence, cfg.model);
        } else if (e.type === "error") patch((t) => ({ ...t, phase: "error", error: String(e.error || "Ask failed."), running: [] }));
      });
      patch((t) => (t.phase === "done" || t.phase === "error" ? t : { ...t, phase: "error", error: "The answer stopped before it finished.", running: [] }));
    } catch (err) {
      if (mine.signal.aborted) return;
      patch((t) => ({ ...t, phase: "error", error: err instanceof Error ? err.message : "Ask failed.", running: [] }));
    }
  }, [finish, loadStatus]);

  /** Show a saved answer without asking again. */
  const reopen = useCallback((item: Saved) => {
    ctl.current?.abort();
    setOpen(true);
    setCollapsed(false);
    setTurn({ ...EMPTY, question: item.question, text: item.answer, evidence: item.evidence, phase: "done", done: item.done ? { ...item.done, answer: item.answer } : null });
  }, []);

  const show = useCallback(() => { setOpen(true); setCollapsed(false); void loadStatus(); }, [loadStatus]);
  const close = useCallback(() => { ctl.current?.abort(); setOpen(false); setCollapsed(false); }, []);
  const forget = useCallback(() => setSaved(clearHistory()), []);
  const newChat = useCallback(() => { ctl.current?.abort(); session.current = []; setTurn(null); }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { open, collapsed, setCollapsed, turn, status, saved, run, reopen, show, close, forget, newChat, full: open && !collapsed };
}
