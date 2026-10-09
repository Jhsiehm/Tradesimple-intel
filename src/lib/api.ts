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

export function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value));
}

export function recent(value: string | number | null | undefined) {
  const text = String(value || "");
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const time = us ? Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])) : Date.parse(text);
  return Number.isNaN(time) ? 0 : time;
}

export function when(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toISOString().slice(0, 16).replace("T", " ");
}
