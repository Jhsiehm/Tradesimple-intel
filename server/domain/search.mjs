import { listTickers } from "../lib/db.mjs";
import { searchMembers } from "../congress.mjs";
import { siteRegistry } from "./sites.mjs";

/** Command-bar search: joined tickers, curated sites, and (from two characters) members. */
export async function search(db, q) {
  const query = q.trim();
  const upper = query.toUpperCase();
  const tickers = listTickers(db).filter((t) =>
    t.symbol.includes(upper) || t.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 6);
  const sites = siteRegistry().filter((s) => {
    const blob = `${s.name} ${s.symbol} ${s.district} ${s.state}`.toLowerCase();
    return blob.includes(query.toLowerCase());
  }).slice(0, 6);
  let members = [];
  if (query.length >= 2) {
    try {
      const found = await searchMembers(db, query);
      members = found.items || [];
    } catch {
      members = [];
    }
  }
  return { ok: true, tickers, sites, members };
}
