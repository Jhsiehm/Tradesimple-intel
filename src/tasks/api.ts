import type { TaskDraft, TaskSchedule, TaskThresholds, TaskWindow } from "../../shared/taskSchedule.mjs";
import type { BacktestSpec } from "../../shared/backtestSpec.mjs";
import type { Turn } from "../ask/types";
import { api, DEMO, post } from "../lib/api";

/** What GET /api/tasks lists per task. */
export type TaskView = {
  id: string;
  kind: "backtest" | "prompt";
  title: string;
  prompt: string;
  specs: BacktestSpec[];
  window: TaskWindow | null;
  schedule: TaskSchedule;
  every: string;
  enabled: boolean;
  thresholds: TaskThresholds;
  watch: { symbols: string[] } | null;
  createdAt: string;
  lastRun: string | null;
  nextRun: string | null;
  running: boolean;
  last: { id: string; status: "ok" | "error" | "skipped"; severity: string; title: string; summary: string; at: string; source: string; asOf: string } | null;
};

export type TasksRes = { ok: boolean; asOf?: string; scheduler?: "on" | "off"; budget?: { perDay: number; usedToday: number }; items: TaskView[]; source?: string; latency?: string; error?: string };
type Out = { ok: boolean; error?: string; task?: TaskView };

/** Fired after any change so every Scheduled list refreshes. */
export const TASKS_EVENT = "intel:tasks";
const changed = () => window.dispatchEvent(new Event(TASKS_EVENT));

async function send(method: "PATCH" | "DELETE", path: string, body?: unknown): Promise<Out> {
  if (DEMO) return { ok: false, error: "This needs the local server." };
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
}

export const listTasks = () => (DEMO ? Promise.resolve<TasksRes>({ ok: false, items: [], error: "Scheduled tasks need the local server." }) : api<TasksRes>("/api/tasks"));

export async function createTask(draft: TaskDraft, watchSymbols: string[]): Promise<Out> {
  const out = await post<Out>("/api/tasks", { ...draft, watch: { symbols: watchSymbols } });
  if (out.ok) changed();
  return out;
}

export async function setEnabled(id: string, enabled: boolean) {
  const out = await send("PATCH", `/api/tasks/${id}`, { enabled });
  if (out.ok) changed();
  return out;
}

export async function removeTask(id: string) {
  const out = await send("DELETE", `/api/tasks/${id}`);
  if (out.ok) changed();
  return out;
}

export async function runNow(id: string) {
  const out = await post<Out>(`/api/tasks/${id}/run`, {});
  changed();
  return out;
}

/** The stored result of one run, as an Ask turn (opens without running again). */
export async function loadResult(runId: string): Promise<Turn | null> {
  const res = await api<{ ok: boolean; run?: { result: Turn | null; title: string; summary: string; startedAt: string; status: string } }>(`/api/tasks/runs/${encodeURIComponent(runId)}`);
  const run = res.run;
  if (!run) return null;
  if (run.result) return { ...run.result, notes: [...(run.result.notes || [])] };
  return { id: runId, question: run.title, at: run.startedAt, text: run.summary, steps: [], phase: "error", notes: [], done: null, clarify: null, error: run.summary, model: "", context: "" };
}
