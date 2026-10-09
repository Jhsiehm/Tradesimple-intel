import { liveAlertRow } from "../../../shared/live.mjs";
import { seenRows } from "./store.mjs";

export const LIVE_SOURCE = { label: "Live watchlist", source: "Live poller: SEC EDGAR, House Clerk, Senate eFD, USAspending, LDA.gov, Yahoo Finance RSS", latency: "Pushed when first detected; each row says how long after publication it was seen. SEC every 30 s (latest-filings Atom; issuer sweep every 30 min), news every 3 min, 13F filers every 10 min, House/Senate every 15 min, USAspending and LDA hourly." };

/** Pushed (not backfill) detections for watched symbols detected since `since` (YYYY-MM-DD, New York date). */
export function liveAlerts(db, symbols, since = "") {
  if (!symbols.length) return [];
  const from = since ? Date.parse(`${since}T00:00:00-05:00`) : 0;
  try {
    return seenRows(db, { symbols, live: true, since: Number.isFinite(from) ? from : 0, limit: 300 }).map((r) => liveAlertRow(r.ev, { detectedAt: r.detectedAt, backfill: r.backfill, seq: r.seq }));
  } catch {
    return [];
  }
}

/** Rows that also arrived live gain `live` (detected time and lags); live rows no other feed built are appended. */
export function mergeLive(rows, live) {
  const byId = new Map(live.map((r) => [r.id, r]));
  const out = rows.map((a) => (byId.has(a.id) ? { ...a, live: byId.get(a.id).live } : a));
  const ids = new Set(out.map((a) => a.id));
  return { rows: out, extra: live.filter((r) => !ids.has(r.id)) };
}
