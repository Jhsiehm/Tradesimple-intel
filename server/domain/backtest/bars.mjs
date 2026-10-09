import { readCache, writeCache } from "../../lib/db.mjs";
import { readStale } from "../../lib/cache.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { HOUR } from "../../lib/time.mjs";
import { pool } from "../../lib/pool.mjs";
import { yahooBars } from "../../feeds/yahoo.mjs";

export const BARS_TTL = 12 * HOUR;

/**
 * Daily bars for `symbols`, cached in sqlite. Cached symbols cost nothing; the rest are fetched through the Yahoo gate
 * until `deadline` (epoch ms). Fetches still running at the deadline keep going and fill the cache for the next run;
 * their symbols come back in `pending`. A 404 means Yahoo has no such symbol (`missing`); other failures fall back to
 * a stale copy, else `pending`.
 */
export async function loadBars(db, symbols, { deadline, concurrency = 6, fetchBars = yahooBars } = {}) {
  const bars = {};
  const pending = new Set();
  const missing = new Set();
  const stale = new Set();
  const storedAt = [];
  let fetched = 0;
  const todo = [];
  const stored = [];
  for (const symbol of [...new Set(symbols)]) {
    const hit = readCache(db, KEY.bars(symbol));
    if (hit) {
      bars[symbol] = hit;
      stored.push(db.prepare("SELECT stored_at FROM cache WHERE key = ?").get(KEY.bars(symbol))?.stored_at);
      continue;
    }
    todo.push(symbol);
  }
  const cachedCount = Object.keys(bars).length;
  const one = async (symbol) => {
    try {
      const series = await fetchBars(symbol);
      if (!series.length) { missing.add(symbol); return; }
      writeCache(db, KEY.bars(symbol), series, BARS_TTL);
      bars[symbol] = series;
      stored.push(Date.now());
      fetched += 1;
      pending.delete(symbol);
    } catch (err) {
      if (err?.status === 404) { missing.add(symbol); pending.delete(symbol); return; }
      const old = readStale(db, KEY.bars(symbol));
      if (old?.value?.length) {
        bars[symbol] = old.value;
        stale.add(symbol);
        storedAt.push(old.storedAt);
        pending.delete(symbol);
      }
    }
  };
  for (const s of todo) pending.add(s);
  const work = pool(todo, concurrency, one);
  const wait = deadline ? Math.max(0, deadline - Date.now()) : 0;
  if (todo.length) {
    if (deadline) {
      await Promise.race([work, new Promise((r) => { const t = setTimeout(r, wait); t.unref?.(); })]);
    } else {
      await work;
    }
  }
  const snapshot = { ...bars };
  return {
    bars: snapshot,
    pending: [...pending].sort(),
    missing: [...missing].sort(),
    stale: [...stale].sort(),
    cached: cachedCount,
    fetched,
    staleStoredAt: storedAt.length ? Math.min(...storedAt) : null,
    oldestStoredAt: stored.filter(Boolean).length ? Math.min(...stored.filter(Boolean)) : null
  };
}

/** Last bar date across a bars map, ISO. */
export function lastBarDay(bars) {
  let last = 0;
  for (const series of Object.values(bars)) if (series.length && series.at(-1)[0] > last) last = series.at(-1)[0];
  return last ? new Date(last * 86_400_000).toISOString().slice(0, 10) : null;
}
