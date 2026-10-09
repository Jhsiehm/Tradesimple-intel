import { DAY } from "../lib/time.mjs";
import { pacData } from "../corporate.mjs";

/** PAC calendar: the last 120 days of receipts, capped at 500 rows. */
export async function pacCalendar(db) {
  const data = await pacData(db);
  const since = new Date(Date.now() - 120 * DAY).toISOString().slice(0, 10);
  return { ...data, rows: data.rows.filter((r) => r.date >= since).slice(0, 500) };
}
