import { aggregateCalendar, calendarBucket } from "./chartWorkspace.mjs";

/** Adapt the captured daily series to the chart workspace without inventing live bars. */
export function demoChartWindow(snapshot, { interval, from, to, adjusted, extended }) {
  if (!snapshot?.ok) return snapshot;
  if (!["1d", "1wk", "1mo"].includes(interval) || adjusted || extended) {
    return {
      ok: false,
      error:
        "This snapshot supports daily, weekly and monthly provider OHLC only. Intraday, dividend adjustment and extended hours require the local server.",
    };
  }
  const zone = snapshot.timezone || "America/New_York";
  const bars = interval === "1d" ? snapshot.bars : aggregateCalendar(snapshot.bars || [], interval, zone);
  const start = interval === "1d" ? from : calendarBucket(from, interval, zone);
  return {
    ...snapshot,
    bars: (bars || []).filter((bar) => bar.t >= start && bar.t <= to),
    interval,
    timezone: zone,
    fetchedAt: snapshot.fetchedAt || snapshot.asOf,
    cacheStatus: "Snapshot",
    status: "Historical snapshot",
    adjustment: "Captured provider OHLC; no additional dividend adjustment applied.",
    latency: `${snapshot.latency || ""} Frozen demo; refresh does not fetch live prices.`,
  };
}
