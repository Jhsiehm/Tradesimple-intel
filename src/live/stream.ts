import { useSyncExternalStore } from "react";
import type { LiveAlertRow, LiveStatus } from "../../shared/live.mjs";
import { DEMO } from "../lib/api";

export type LivePush = LiveAlertRow & { replay?: boolean };
export type Fresh = Record<string, Record<string, number>>;
export type LiveState = {
  link: "off" | "connecting" | "open" | "retrying";
  poller: "on" | "off" | "";
  symbols: string[];
  checks: LiveStatus[];
  fresh: Fresh;
  retryAt: number;
};
type Overview = { ok: boolean; poller?: "on" | "off"; symbols?: string[]; checks?: LiveStatus[]; fresh?: Fresh; invalid?: string[] };

const STREAM = "/api/live/stream";
const MAX_RETRY_MS = 30_000;
/** The server pings every 15 s; silence this long means the dev proxy is holding a stream whose API is gone. */
const SILENT_MS = 45_000;

let state: LiveState = { link: DEMO ? "off" : "connecting", poller: "", symbols: [], checks: [], fresh: {}, retryAt: 0 };
const watchers = new Set<() => void>();
const pushListeners = new Set<(row: LivePush) => void>();
let source: EventSource | null = null;
let lastSeq = 0;
let failures = 0;
let timer = 0;
let watchdog = 0;
let users = 0;

function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  watchers.forEach((w) => w());
}

function apply(o: Overview) {
  if (!o?.ok) return;
  set({ poller: o.poller || state.poller, symbols: o.symbols || state.symbols, checks: o.checks || state.checks, fresh: o.fresh || state.fresh });
}

async function send(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<Overview> {
  const res = await fetch(path, body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return res ? res.json().catch(() => ({ ok: false })) : { ok: false };
}

export const refreshLive = () => (DEMO ? Promise.resolve() : send("GET", "/api/live").then(apply, () => undefined));

/** Mirror the browser's watchlist to the poller. Returns tickers the server rejected (not in data/tickers.json). */
export async function putSymbols(symbols: string[]): Promise<string[]> {
  if (DEMO) return [];
  const o = await send("PUT", "/api/live", { symbols });
  apply(o);
  return o.invalid || [];
}

/** The user looked at this ticker (or one of its sources): its new-since-seen count resets. */
export async function markLiveSeen(symbol: string, src = "") {
  if (DEMO) return;
  const o = await send("POST", "/api/live/seen", src ? { symbol, source: src } : { symbol });
  if (o.ok && o.fresh) set({ fresh: { ...state.fresh, ...o.fresh } });
}

function drop() {
  window.clearTimeout(watchdog);
  source?.close();
  source = null;
}

function retryLater() {
  drop();
  failures++;
  const wait = Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(failures - 1, 5));
  set({ link: "retrying", retryAt: Date.now() + wait });
  timer = window.setTimeout(connect, wait);
}

function heard() {
  window.clearTimeout(watchdog);
  watchdog = window.setTimeout(retryLater, SILENT_MS);
}

function connect() {
  if (DEMO || source || !users) return;
  window.clearTimeout(timer);
  set({ link: failures ? "retrying" : "connecting" });
  const es = new EventSource(lastSeq ? `${STREAM}?after=${lastSeq}` : STREAM);
  source = es;
  heard();
  es.addEventListener("ping", heard);
  es.addEventListener("hello", (e) => {
    heard();
    failures = 0;
    const h = JSON.parse((e as MessageEvent).data);
    set({ link: "open", retryAt: 0, poller: h.poller, symbols: h.symbols || [], checks: h.checks || [] });
    void refreshLive();
  });
  es.addEventListener("alert", (e) => {
    heard();
    const row = JSON.parse((e as MessageEvent).data) as LivePush;
    lastSeq = Math.max(lastSeq, row.live?.seq || 0);
    pushListeners.forEach((l) => l(row));
    void refreshLive();
  });
  es.addEventListener("status", (e) => set({ checks: JSON.parse((e as MessageEvent).data).checks || [] }));
  es.addEventListener("list", (e) => set({ symbols: JSON.parse((e as MessageEvent).data).symbols || state.symbols }));
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) { set({ link: "retrying" }); return; }
    // The browser gives up after a non-stream answer (the dev proxy's 502 while `node --watch` restarts); retry ourselves.
    retryLater();
  };
}

function retain() {
  users++;
  connect();
  return () => {
    users--;
    if (users) return;
    window.clearTimeout(timer);
    drop();
  };
}

/** Live poller state: stream link, per-check status, new-since-seen counts. One EventSource is shared by every caller. */
export function useLive(): LiveState {
  return useSyncExternalStore(
    (w) => { watchers.add(w); const release = retain(); return () => { watchers.delete(w); release(); }; },
    () => state
  );
}

/** Called for every pushed detection (replays after a reconnect carry `replay: true`). */
export function onLivePush(listener: (row: LivePush) => void): () => void {
  pushListeners.add(listener);
  const release = retain();
  return () => { pushListeners.delete(listener); release(); };
}
