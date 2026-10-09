import { readCache, writeCache } from "./db.mjs";
import { KEY } from "./cacheKeys.mjs";

export { readCache, writeCache };

/** Last stored value for `key`, ignoring its TTL. */
export function readStale(db, key) {
  const row = db.prepare("SELECT body, stored_at FROM cache WHERE key = ?").get(key);
  return row ? { value: JSON.parse(row.body), storedAt: row.stored_at } : null;
}

/** "timed out after 45 s", "returned HTTP 503", or the error message. */
export function failureText(err, timeoutMs) {
  if (err?.name === "AbortError" || err?.name === "TimeoutError" || /did not answer/.test(err?.message || "")) return `timed out${timeoutMs ? ` after ${Math.round(timeoutMs / 1000)} s` : ""}`;
  if (err?.status) return `returned HTTP ${err.status}`;
  return String(err?.message || "failed");
}

/** "01:23 ET" for an ISO time. */
export function etTime(iso) {
  return `${new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })} ET`;
}

/**
 * Read-through cache for an upstream that can hang. A fresh hit is returned as `{ value }`. On a miss `load()` runs;
 * if it throws, the failure is stored under KEY.down(key) for `downMs` so callers in that window skip the wait, and
 * the last stored value of any age comes back as `{ value, staleAt, down }` (`value` null when nothing was stored).
 * `down` is `{ at, why, retryAt }`.
 */
export async function throughCache(db, key, { ttlMs, downMs, timeoutMs = 0, load }) {
  const hit = readCache(db, key);
  if (hit != null) return { value: hit };
  const downKey = KEY.down(key);
  let down = readCache(db, downKey);
  if (!down) {
    try {
      const value = await load();
      writeCache(db, key, value, typeof ttlMs === "function" ? ttlMs(value) : ttlMs);
      return { value };
    } catch (err) {
      const at = new Date();
      down = { at: at.toISOString(), why: failureText(err, timeoutMs), retryAt: new Date(at.getTime() + downMs).toISOString() };
      writeCache(db, downKey, down, downMs);
    }
  }
  const stale = readStale(db, key);
  return { value: stale?.value ?? null, staleAt: stale ? new Date(stale.storedAt).toISOString() : null, down };
}
