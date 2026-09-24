export async function api<T>(path: string): Promise<T> {
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
