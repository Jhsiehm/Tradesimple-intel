import { DAY } from "../lib/time.mjs";

/** "MM/DD/YYYY" → UTC ms, 0 when unparseable. */
export function usDate(value) {
  const [month, day, year] = String(value || "").split("/").map(Number);
  if (!year) return 0;
  return Date.UTC(year, (month || 1) - 1, day || 1);
}

/** US, ISO, or MM-DD-YYYY date text → "YYYY-MM-DD", or "" when unrecognized. */
export function isoDate(value) {
  const text = String(value || "").trim();
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const mdy = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  return "";
}

/** Whole days from trade to filing, or null. */
export function lagDays(traded, filed) {
  if (!traded || !filed) return null;
  const a = Date.parse(traded);
  const b = Date.parse(filed);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}
