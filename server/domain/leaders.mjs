import { roster } from "../roster.mjs";
import { leaders } from "../returns.mjs";

/** Trader leaderboards with member names and seats from the roster (empty roster if it fails). */
export async function leadersBoard(db) {
  const people = await roster(db).catch(() => ({ items: [] }));
  return leaders(db, new Map((people.items || []).map((p) => [p.bioguide, p])));
}
