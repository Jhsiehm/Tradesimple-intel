import { demoFile } from "../../shared/demoPath.mjs";
import { isRestart, retryDelays } from "./retry";

/** Zero-key demo: `npm run demo` / `npm run build:demo` read frozen responses from demo/snapshot instead of the API. */
export const DEMO = import.meta.env.VITE_DEMO === "1";

const downListeners = new Set<(down: boolean) => void>();
let waiting: Promise<boolean> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Called with true while a request waits for a restarting API, false once it answers or the wait gives up. */
export function onApiDown(listener: (down: boolean) => void): () => void {
  downListeners.add(listener);
  return () => { downListeners.delete(listener); };
}

/**
 * Poll /api/health with backoff (1 s, 2 s, 4 s … ~30 s in all) until the API answers. Every caller shares one wait.
 * Resolves false when it never came back or `signal` aborted.
 */
export function waitForApi(signal?: AbortSignal): Promise<boolean> {
  if (!waiting) {
    waiting = (async () => {
      downListeners.forEach((l) => l(true));
      try {
        for (const ms of retryDelays()) {
          await sleep(ms);
          const up = await fetch("/api/health", { cache: "no-store" }).then((r) => r.ok, () => false);
          if (up) return true;
        }
        return false;
      } finally {
        waiting = null;
        downListeners.forEach((l) => l(false));
      }
    })();
  }
  if (!signal) return waiting;
  if (signal.aborted) return Promise.resolve(false);
  return Promise.race([waiting, new Promise<boolean>((r) => signal.addEventListener("abort", () => r(false), { once: true }))]);
}

/** GET JSON. While the API restarts, waits for it (see `waitForApi`) and tries once more. */
export async function api<T>(path: string): Promise<T> {
  if (DEMO) {
    const res = await fetch(`${import.meta.env.BASE_URL}snapshot/${demoFile(path)}`);
    if (!res.ok || !res.headers.get("content-type")?.match(/json|geo/)) {
      return { ok: false, error: "Not in the demo snapshot. Run locally with your own keys for live data.", items: [] } as T;
    }
    return (await res.json()) as T;
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(path);
    } catch (error) {
      if (attempt === 0 && isRestart({ error }) && (await waitForApi())) continue;
      throw error;
    }
    const text = await res.text();
    if (attempt === 0 && isRestart({ status: res.status, body: text }) && (await waitForApi())) continue;
    let body: { error?: string } | null = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    if (body == null) throw new Error("The API answered with something that is not JSON.");
    return body as T;
  }
}

/** POST JSON. A `{ ok: false }` body is returned as-is so the caller can read `missing`. */
export async function post<T>(path: string, body: unknown): Promise<T> {
  if (DEMO) return { ok: false, error: "This needs the local server." } as T;
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (data && typeof data === "object") return data as T;
  if (res.ok) throw new Error("Empty response.");
  const hint = text.replace(/\s+/g, " ").trim().slice(0, 180);
  if (hint) throw new Error(hint);
  if (res.status === 502) throw new Error("The API proxy returned an empty 502 before the server answered.");
  throw new Error(`HTTP ${res.status}`);
}

export { money, recent, when } from "./format";
