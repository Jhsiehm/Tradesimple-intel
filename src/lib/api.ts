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

export { money, recent, when } from "./format";
