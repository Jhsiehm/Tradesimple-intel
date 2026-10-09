import { useCallback, useEffect, useState } from "react";
import { listTasks, TASKS_EVENT, type TasksRes } from "./api";

const IDLE_MS = 30_000;
const BUSY_MS = 3_000;

/** The task list, refreshed on change, every 30 s, and every 3 s while a run is going. */
export function useTasks(active: boolean) {
  const [res, setRes] = useState<TasksRes | null>(null);
  const load = useCallback(() => listTasks().then(setRes).catch((err) => setRes({ ok: false, items: [], error: err instanceof Error ? err.message : "Tasks unavailable." })), []);
  const busy = Boolean(res?.items.some((t) => t.running));

  useEffect(() => {
    if (!active) return;
    void load();
    window.addEventListener(TASKS_EVENT, load);
    return () => window.removeEventListener(TASKS_EVENT, load);
  }, [active, load]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(load, busy ? BUSY_MS : IDLE_MS);
    return () => window.clearInterval(timer);
  }, [active, busy, load]);

  return { res, reload: load };
}
