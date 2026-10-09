const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar date (YYYY-MM-DD) in Washington at `at` (ms or Date). Filings, hearings, and roll calls are dated there. */
export function nyDate(at = Date.now()) {
  const parts = Object.fromEntries(NY.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** YYYY-MM-DD shifted by whole calendar days. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Washington calendar date `days` days before `at`. */
export function nyDaysAgo(days, at = Date.now()) {
  return addDays(nyDate(at), -days);
}
