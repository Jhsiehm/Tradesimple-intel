import type { BacktestSpec } from "./backtestSpec.mjs";
import type { Prefs } from "./backtestAsk.mjs";

export type TaskSchedule = { kind: "daily"; time: string; weekdays: boolean } | { kind: "hours"; hours: number; weekdays: boolean };
export type TaskWindow = { sinceLast: boolean; days: number };
export type TaskThresholds = { excessPct: number | null; newSignals: number | null };
export type TaskKind = "backtest" | "prompt";

/** What a create body (and an Ask draft) carries before the server stores it. */
export type TaskDraft = {
  kind: TaskKind;
  title: string;
  prompt: string;
  specs: BacktestSpec[];
  window: TaskWindow | null;
  schedule: TaskSchedule;
  enabled: boolean;
  thresholds: TaskThresholds;
  useWatchlist?: boolean;
};

export type CleanTask = Omit<TaskDraft, "useWatchlist"> & { watch: { symbols: string[] } | null };

export const HOUR_MS: number;
export const HOUR_STEPS: number[];
export const TASK_LIMITS: { title: number; prompt: number; specs: number; tickers: number; perUser: number };
export const RESEARCH_RULE: string;

export function etParts(ms: number): { y: number; m: number; d: number; hh: number; mm: number; wd: number; date: string };
export function etToUtc(y: number, m: number, d: number, hh: number, mm: number): number;
export function cleanSchedule(raw: unknown): { ok: true; schedule: TaskSchedule } | { ok: false; error: string };
export function nextRunAfter(schedule: TaskSchedule, after: number): number | null;
export function bootPlan(task: { enabled: boolean; schedule: TaskSchedule; nextRun?: number | null; interrupted?: boolean }, now: number): { catchUp: boolean; nextRun: number | null };
export function describeSchedule(s: TaskSchedule | null | undefined): string;
export function runsToday(startedAt: number[], now: number): number;
export function isScheduleRequest(text: string): boolean;
export function parseSchedule(text: string): { schedule: TaskSchedule | null; rest: string; error?: string } | null;
export function draftFromQuestion(args: { question: string; today: string; prefs?: Prefs | null; priors?: BacktestSpec[]; lastQuestion?: string }): { ok: true; draft: TaskDraft } | { ok: false; error: string } | null;
export function cleanTaskInput(raw: unknown): { ok: true; task: CleanTask } | { ok: false; error: string };
export function cleanTaskPatch(raw: unknown): { ok: true; patch: Partial<Pick<CleanTask, "enabled" | "title" | "schedule" | "thresholds">> } | { ok: false; error: string };
export function specForRun(spec: BacktestSpec, window: TaskWindow | null, at: { today: string; lastRunDay?: string }): BacktestSpec;
export function newSignalCount(ids: string[], prevIds: string[] | null | undefined): number | null;
export function backtestSummary(run: unknown, fresh?: number | null): string;
export function researchSeverity(figures: { excess?: number | null; fresh?: number | null }, thresholds?: Partial<TaskThresholds>): { severity: "elevated" | "routine"; why: string[] };
