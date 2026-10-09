export { readCache, writeCache } from "./db.mjs";

/** Last stored value for `key`, ignoring its TTL. */
export function readStale(db, key) {
  const row = db.prepare("SELECT body, stored_at FROM cache WHERE key = ?").get(key);
  return row ? { value: JSON.parse(row.body), storedAt: row.stored_at } : null;
}
