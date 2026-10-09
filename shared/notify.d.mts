import type { AlertLevel } from "./intel.mjs";
import type { TradeAge } from "./tradeAge.mjs";

export type Quiet = { start: number; end: number };

export type NotifySettings = {
  topic: string;
  server: string;
  token: boolean;
  minSeverity: AlertLevel;
  kinds: string[];
  quiet: Quiet | null;
  quietHigh: boolean;
  maxPerHour: number;
  clickUrl: string;
  enabled?: boolean;
};

/** What GET /api/notify returns: never the full topic or the token. */
export type PublicNotifySettings = {
  configured: boolean;
  enabled: boolean;
  topic: string;
  server: string;
  token: boolean;
  minSeverity: AlertLevel;
  kinds: string[];
  quiet: string;
  quietHigh: boolean;
  maxPerHour: number;
  clickUrl: boolean;
};

export type SavedNotifySettings = { enabled?: boolean; minSeverity?: string; kinds?: string[]; quiet?: string; quietHigh?: boolean };

export type NotifyRow = {
  id: string;
  kind: string;
  date?: string;
  title: string;
  severity?: string;
  source?: string;
  link?: string;
  eventAt?: string;
  filedAt?: string;
  age?: TradeAge;
  pins?: { kind: string; id: string; label?: string }[];
  live?: { symbol?: string; eventAt?: string; publishedAt?: string; detection?: string; backfill?: boolean };
};

export type NtfyMessage = {
  title: string;
  message: string;
  priority: number;
  tags: string[];
  click: string;
  actions: { action: "view"; label: string; url: string; clear: boolean }[];
};

export const NOTIFY_LEVELS: AlertLevel[];
export const NOTIFY_KINDS: { key: string; label: string; kinds: string[]; on: boolean }[];
export const PRIORITY: Record<AlertLevel, number>;
export const DEFAULT_SERVER: string;
export const DEFAULT_MAX_PER_HOUR: number;

export function kindGroup(kind: string): string;
export function parseQuiet(raw: string | null | undefined): Quiet | null;
export function quietLabel(q: Quiet | null): string;
export function nyMinutes(now: number): number;
export function inQuiet(now: number, quiet: Quiet | null): boolean;
export function envSettings(env?: Record<string, string | undefined>): NotifySettings;
export function mergeSettings(base: NotifySettings, saved?: SavedNotifySettings | null): NotifySettings & { enabled: boolean };
export function publicSettings(s: NotifySettings): PublicNotifySettings;
export function maskTopic(topic: string): string;
export function topicFrom(bytes: ArrayLike<number>): string;
export function shouldNotify(row: NotifyRow, settings: NotifySettings | null | undefined, now?: number): { send: boolean; why: string };
export function buildMessage(row: NotifyRow, opts?: { clickUrl?: string; now?: number; suppressed?: number }): NtfyMessage;
export function underLimit(sentTimes: number[], maxPerHour: number, now?: number): { ok: boolean; recent: number[] };
