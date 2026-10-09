/**
 * Live watchlist state in the server's cache database (data/cache.sqlite or INTEL_CACHE, never committed):
 *   live_list    the symbols the poller watches (mirrored from the browser watchlist), in the user's order
 *   live_seen    every event id ever detected per symbol, with when it was first seen; rowid is the push sequence
 *   live_primed  (symbol, check) pairs that finished a first pass; events from an unprimed pair are backfill
 *   live_marks   when the user last looked at a symbol's source, for "new since last seen" counts
 *   live_status  per-check last/next run and failures, so a restart keeps backoff and the status strip
 */
const ready = new WeakSet();

function ensure(db) {
  if (ready.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_list (symbol TEXT PRIMARY KEY, pos INTEGER NOT NULL, added_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS live_seen (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      source TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      backfill INTEGER NOT NULL,
      body TEXT NOT NULL,
      UNIQUE (id, symbol)
    );
    CREATE INDEX IF NOT EXISTS live_seen_symbol ON live_seen (symbol, detected_at);
    CREATE TABLE IF NOT EXISTS live_primed (symbol TEXT NOT NULL, check_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (symbol, check_id));
    CREATE TABLE IF NOT EXISTS live_marks (symbol TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (symbol, source));
    CREATE TABLE IF NOT EXISTS live_status (check_id TEXT PRIMARY KEY, body TEXT NOT NULL);
  `);
  ready.add(db);
}

export function listSymbols(db) {
  ensure(db);
  return db.prepare("SELECT symbol FROM live_list ORDER BY pos, symbol").all().map((r) => r.symbol);
}

/** Replaces the list with `symbols` (already validated), keeping first-added times. Returns { added, removed }. */
export function setSymbols(db, symbols, now = Date.now()) {
  ensure(db);
  const before = listSymbols(db);
  const added = symbols.filter((s) => !before.includes(s));
  const removed = before.filter((s) => !symbols.includes(s));
  db.exec("BEGIN");
  try {
    for (const s of removed) {
      db.prepare("DELETE FROM live_list WHERE symbol = ?").run(s);
      db.prepare("DELETE FROM live_primed WHERE symbol = ?").run(s);
    }
    symbols.forEach((s, i) => {
      db.prepare("INSERT INTO live_list (symbol, pos, added_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET pos = excluded.pos").run(s, i, now);
    });
    for (const s of added) db.prepare("DELETE FROM live_marks WHERE symbol = ?").run(s);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { added, removed };
}

/** Records an event the first time it is seen. True when it was new (the caller pushes it unless it is backfill). */
export function remember(db, ev, { detectedAt, backfill }) {
  ensure(db);
  const out = db.prepare("INSERT OR IGNORE INTO live_seen (id, symbol, source, detected_at, backfill, body) VALUES (?, ?, ?, ?, ?, ?)")
    .run(ev.id, ev.symbol, ev.source, detectedAt, backfill ? 1 : 0, JSON.stringify(ev));
  return out.changes > 0 ? Number(out.lastInsertRowid) : 0;
}

export function hasSeen(db, id, symbol) {
  ensure(db);
  return Boolean(db.prepare("SELECT 1 FROM live_seen WHERE id = ? AND symbol = ?").get(id, symbol));
}

const hydrate = (r) => ({ seq: r.seq, ev: JSON.parse(r.body), detectedAt: r.detected_at, backfill: Boolean(r.backfill) });

/**
 * Stored detections, newest first. `symbols` limits to those symbols, `after` to push sequence numbers above it,
 * `since` (ms) to detections at or after it, `live` to pushed (non-backfill) rows, `ids` to those event ids.
 */
export function seenRows(db, { symbols = null, after = 0, since = 0, live = false, ids = null, limit = 200 } = {}) {
  ensure(db);
  const where = ["seq > ?", "detected_at >= ?"];
  const args = [after, since];
  if (live) where.push("backfill = 0");
  if (symbols) {
    if (!symbols.length) return [];
    where.push(`symbol IN (${symbols.map(() => "?").join(",")})`);
    args.push(...symbols);
  }
  if (ids) {
    if (!ids.length) return [];
    where.push(`id IN (${ids.map(() => "?").join(",")})`);
    args.push(...ids);
  }
  return db.prepare(`SELECT * FROM live_seen WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ?`).all(...args, limit).map(hydrate);
}

/** `id → { detectedAt, backfill }` for the given ids, for feeds that show detection lag next to their own rows. */
export function detectedFor(db, ids) {
  const out = new Map();
  for (const r of seenRows(db, { ids: [...new Set(ids)].slice(0, 500), limit: 500 })) out.set(r.ev.id, { detectedAt: r.detectedAt, backfill: r.backfill });
  return out;
}

/** symbol → when its first pass for this check finished (ms). */
export function primedAt(db, checkId) {
  ensure(db);
  return new Map(db.prepare("SELECT symbol, at FROM live_primed WHERE check_id = ?").all(checkId).map((r) => [r.symbol, r.at]));
}

export function prime(db, checkId, symbols, now = Date.now()) {
  ensure(db);
  for (const s of symbols) db.prepare("INSERT OR IGNORE INTO live_primed (symbol, check_id, at) VALUES (?, ?, ?)").run(s, checkId, now);
}

/** Marks a symbol's sources (all when `source` is empty) as looked at now. */
export function markSeen(db, symbol, source = "", now = Date.now()) {
  ensure(db);
  const sources = source ? [source] : db.prepare("SELECT DISTINCT source FROM live_seen WHERE symbol = ?").all(symbol).map((r) => r.source);
  for (const s of sources) db.prepare("INSERT INTO live_marks (symbol, source, at) VALUES (?, ?, ?) ON CONFLICT(symbol, source) DO UPDATE SET at = excluded.at").run(symbol, s, now);
}

/** `{ SYMBOL: { source: n } }`: pushed detections since the user last looked at that symbol's source (or since it was added). */
export function freshCounts(db, symbols) {
  ensure(db);
  const out = {};
  for (const symbol of symbols) {
    const added = db.prepare("SELECT added_at FROM live_list WHERE symbol = ?").get(symbol)?.added_at || 0;
    const marks = new Map(db.prepare("SELECT source, at FROM live_marks WHERE symbol = ?").all(symbol).map((r) => [r.source, r.at]));
    const rows = db.prepare("SELECT source, detected_at FROM live_seen WHERE symbol = ? AND backfill = 0 AND detected_at >= ?").all(symbol, added);
    const counts = {};
    for (const r of rows) if (r.detected_at > (marks.get(r.source) || 0)) counts[r.source] = (counts[r.source] || 0) + 1;
    out[symbol] = counts;
  }
  return out;
}

export function loadStatus(db) {
  ensure(db);
  return new Map(db.prepare("SELECT check_id, body FROM live_status").all().map((r) => [r.check_id, JSON.parse(r.body)]));
}

export function saveStatus(db, checkId, body) {
  ensure(db);
  db.prepare("INSERT INTO live_status (check_id, body) VALUES (?, ?) ON CONFLICT(check_id) DO UPDATE SET body = excluded.body").run(checkId, JSON.stringify(body));
}

/** Expires a cache row so the next read refetches (the row stays as the stale copy lib/cache.mjs can fall back to). */
export function expireCache(db, key) {
  db.prepare("UPDATE cache SET ttl_ms = -1 WHERE key = ?").run(key);
}
