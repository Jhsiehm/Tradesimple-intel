import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEMO } from "../lib/api";
import { DAY, mergeBars, requestGuard, retentionDays, windowStart, type Bar } from "../../shared/chartWorkspace.mjs";
export type ChartData = {
  ok: boolean;
  error?: string;
  bars: Bar[];
  symbol: string;
  name: string;
  interval: string;
  currency: string;
  timezone: string;
  digits: number;
  source: string;
  asOf: string | null;
  fetchedAt: string;
  cacheStatus: string;
  status: string;
  adjustment: string;
  latency: string;
  aggregation?: string;
  unavailable?: boolean;
};
const cache = new Map<string, { at: number; data: ChartData }>();
const pending = new Map<string, Promise<ChartData>>();
export function windowRequest(
  symbol: string,
  interval: string,
  from: number,
  to: number,
  adjusted: boolean,
  extended: boolean,
  refresh = false,
) {
  const key = new URLSearchParams({
    symbol,
    interval,
    from: String(Math.max(0, Math.floor(from / 60000) * 60000)),
    to: String(Math.floor(to / 60000) * 60000),
    adjusted: String(adjusted),
    extended: String(extended),
  }).toString();
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < 60000) return Promise.resolve({ ...hit.data, cacheStatus: "Cached" });
  const existing = pending.get(key);
  if (existing) return existing;
  const p = api<ChartData>(`/api/markets/chart?${key}`)
    .then((data) => {
      if (!data.ok) throw new Error(data.error || "Unavailable chart");
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { data, at: Date.now() });
      return data;
    })
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
export function useChartData(symbol: string, interval: string, range: string, adjusted: boolean, extended: boolean) {
  const [data, setData] = useState<ChartData | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [older, setOlder] = useState(false),
    [ended, setEnded] = useState(false);
  const guard = useRef(requestGuard()),
    current = useRef<ChartData | null>(null),
    busy = useRef(false),
    refreshBusy = useRef(false),
    epoch = useRef(0),
    edge = useRef(0),
    backfillPaused = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshBusy.current || busy.current) return;
    const id = epoch.current;
    backfillPaused.current = false;
    refreshBusy.current = true;
    setLoading(true);
    setError("");
    try {
      const next = await windowRequest(symbol, interval, windowStart(range), Date.now(), adjusted, extended, true);
      if (!guard.current.current(id)) return;
      setData((previous) => {
        const merged = {
          ...next,
          bars: mergeBars(previous?.bars || [], next.bars),
          status: DEMO ? "Simulated" : next.status,
        };
        current.current = merged;
        return merged;
      });
    } catch (e) {
      if (guard.current.current(id)) setError((e as Error).message);
    } finally {
      if (guard.current.current(id)) {
        setLoading(false);
        refreshBusy.current = false;
      }
    }
  }, [symbol, interval, range, adjusted, extended]);
  useEffect(() => {
    epoch.current = guard.current.next();
    refreshBusy.current = false;
    current.current = null;
    setData(null);
    setEnded(false);
    setOlder(false);
    busy.current = false;
    backfillPaused.current = false;
    edge.current = windowStart(range);
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => {
      guard.current.next();
      clearInterval(timer);
    };
  }, [refresh, range]);
  const loadOlder = useCallback(async () => {
    if (busy.current || refreshBusy.current || backfillPaused.current || ended || !current.current?.bars.length) return;
    const id = epoch.current;
    busy.current = true;
    setOlder(true);
    setError("");
    const to = Math.min(edge.current, current.current.bars[0].t),
      step =
        Math.min(
          retentionDays(interval),
          interval === "1m" ? 3 : ["5m", "15m", "30m"].includes(interval) ? 20 : interval === "1h" ? 180 : 730,
        ) * DAY;
    const from = Math.max(0, Date.now() - retentionDays(interval) * DAY, to - step);
    if (from >= to) {
      setEnded(true);
      setOlder(false);
      busy.current = false;
      return;
    }
    try {
      const next = await windowRequest(symbol, interval, from, to, adjusted, extended);
      if (!guard.current.current(id)) return;
      edge.current = from;
      setData((prev) => {
        if (!prev) return prev;
        const merged = { ...prev, bars: mergeBars(next.bars, prev.bars) };
        current.current = merged;
        return merged;
      });
      if (!next.bars.length || from === 0 || from >= to - 60000) setEnded(true);
    } catch (e) {
      if (guard.current.current(id)) {
        setError((e as Error).message);
        backfillPaused.current = true;
      }
    } finally {
      if (guard.current.current(id)) {
        setOlder(false);
        busy.current = false;
      }
    }
  }, [symbol, interval, adjusted, extended, ended]);
  return { data, error, loading, older, ended, loadOlder, refresh };
}
