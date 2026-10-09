import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { WatchBadge, WatchEvent, WatchSourceKey } from "../../shared/watchlist.mjs";

export type WatchSection = {
  key: WatchSourceKey; label: string; status: "ok" | "empty" | "loading" | "error" | "not-configured" | "not-covered";
  source: string; asOf?: string; latency: string; note?: string; count: number; building?: boolean; ms?: number;
};
export type WatchQuote = { ok: boolean; last?: number | null; change?: number | null; changePct?: number | null; asOf?: string; fetchedAt?: string; source: string; latency?: string; error?: string };
export type WatchRow = {
  ok: boolean; symbol: string; name?: string; asOf?: string; days?: number; error?: string; building?: boolean;
  quote?: WatchQuote; sections?: WatchSection[]; badges?: Partial<Record<WatchSourceKey, WatchBadge>>; newest?: WatchEvent | null;
};
export type WatchSummary = { ok: boolean; asOf?: string; days?: number; max?: number; items: WatchRow[]; invalid?: string[]; latency?: string; error?: string };
export type TickerActivity = WatchRow & { events: WatchEvent[] };

const POLL_MS = 3 * 60 * 1000;
const BUILD_MS = 15 * 1000;

/** Badges and quotes for the watched symbols; re-polls sooner while a source is still loading. */
export function useWatchSummary(symbols: string[], days: number) {
  const [res, setRes] = useState<WatchSummary | null>(null);
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) { setRes({ ok: true, items: [] }); return; }
    let cancel = false;
    let timer = 0;
    const load = () => api<WatchSummary>(`/api/watchlist/activity?tickers=${encodeURIComponent(key)}&days=${days}`)
      .then((body) => {
        if (cancel) return;
        setRes(body);
        timer = window.setTimeout(load, body.items?.some((r) => r.building) ? BUILD_MS : POLL_MS);
      })
      .catch((err: Error) => { if (!cancel) { setRes((prev) => ({ ...(prev || { items: [] }), ok: false, error: err.message })); timer = window.setTimeout(load, POLL_MS); } });
    void load();
    return () => { cancel = true; window.clearTimeout(timer); };
  }, [key, days]);
  return res;
}

/** Full event feed for one ticker, loaded when its row is expanded. */
export function useTickerActivity(symbol: string | null, days: number) {
  const [res, setRes] = useState<TickerActivity | null>(null);
  useEffect(() => {
    setRes(null);
    if (!symbol) return;
    let cancel = false;
    let timer = 0;
    const load = () => api<TickerActivity>(`/api/watchlist/activity/${encodeURIComponent(symbol)}?days=${days}`)
      .then((body) => { if (cancel) return; setRes(body); if (body.building) timer = window.setTimeout(load, BUILD_MS); })
      .catch((err: Error) => { if (!cancel) setRes({ ok: false, symbol, error: err.message, events: [] }); });
    void load();
    return () => { cancel = true; window.clearTimeout(timer); };
  }, [symbol, days]);
  return res;
}
