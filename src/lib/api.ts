import { demoFile } from "../../shared/demoPath.mjs";

/** Zero-key demo: `npm run demo` / `npm run build:demo` read frozen responses from demo/snapshot instead of the API. */
export const DEMO = import.meta.env.VITE_DEMO === "1";

export async function api<T>(path: string): Promise<T> {
  if (DEMO) {
    const res = await fetch(`${import.meta.env.BASE_URL}snapshot/${demoFile(path)}`);
    if (!res.ok || !res.headers.get("content-type")?.match(/json|geo/)) {
      return { ok: false, error: "Not in the demo snapshot. Run locally with your own keys for live data.", items: [] } as T;
    }
    return (await res.json()) as T;
  }
  const res = await fetch(path);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
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
