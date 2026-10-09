export function num(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(value: number | null | undefined, digits = 2, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`;
}

export function usd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (v >= 1e12) return `${sign}$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(v)}`;
}

export function big(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = Math.abs(value);
  if (v >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

export function tone(value: number | null | undefined) {
  return value == null || value === 0 ? "" : value > 0 ? "up" : "down";
}

export function priceDigits(price: number | null | undefined) {
  const v = Math.abs(price || 0);
  if (!v) return 2;
  if (v >= 1000) return 2;
  if (v >= 1) return v >= 100 ? 2 : 4;
  return Math.min(8, 2 + Math.ceil(-Math.log10(v)) + 2);
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
