import { roster } from "../roster.mjs";
import { leaders } from "../returns.mjs";

/** Trader leaderboards with member names and seats from the roster (empty roster if it fails). `opts` as in leaders(). */
export async function leadersBoard(db, opts = {}) {
  const people = await roster(db).catch(() => ({ items: [] }));
  return leaders(db, new Map((people.items || []).map((p) => [p.bioguide, p])), opts);
}
