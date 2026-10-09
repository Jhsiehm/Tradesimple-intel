import { nyDate } from "../../../shared/dates.mjs";
import { runsSince } from "./store.mjs";

export const RESEARCH_SOURCE = { label: "Research tasks", source: "Your scheduled research tasks", latency: "Posted when a task runs (checked every 30 s). Each row carries the feeds and as-of time of its own run." };

/**
 * Alert rows (kind "research") for scheduled runs started since `since` (YYYY-MM-DD, New York date). The action opens the
 * stored result in Ask; ids are per run, so read/unread works like every other alert.
 */
export function researchRows(runs) {
  return runs.map((r) => ({
    id: `research:${r.id}`,
    kind: "research",
    date: nyDate(r.startedAt),
    at: new Date(r.startedAt).toISOString(),
    title: r.title,
    detail: r.summary,
    action: r.status === "skipped" ? "ask:open" : `ask:research:${r.id}`,
    late: false,
    severity: r.severity === "high" || r.severity === "elevated" ? r.severity : "routine",
    source: r.source,
    asOf: r.asOf,
    latency: r.latency,
    status: r.status,
    pins: []
  }));
}

export function researchAlerts(db, since = "", cap = 50) {
  const from = since ? Date.parse(`${since}T00:00:00-05:00`) : 0;
  try {
    return researchRows(runsSince(db, Number.isFinite(from) ? from : 0, cap));
  } catch {
    return [];
  }
}
