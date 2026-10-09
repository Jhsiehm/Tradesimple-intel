import { createHash } from "node:crypto";
import { ANSWER_CACHE_DEFAULT_MIN, dataText } from "../../shared/answerCache.mjs";

/**
 * Finished answers kept for reuse (`ask_answers` in the cache database). An entry holds the turn's events and, for
 * every tool call it made, a hash of the data that call returned. Reuse re-runs those calls (they read the same
 * caches) and only replays the answer when every hash matches, so a reused answer never hides newer data.
 */
const ready = new WeakSet();
const usable = (db) => typeof db?.prepare === "function";
const KEEP_MS = 24 * 3_600_000;

function ensure(db) {
  if (ready.has(db)) return;
  db.exec("CREATE TABLE IF NOT EXISTS ask_answers (key TEXT PRIMARY KEY, at INTEGER NOT NULL, model TEXT NOT NULL, body TEXT NOT NULL)");
  ready.add(db);
}

export const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
export const dataHash = (raw) => sha(dataText(raw));

/** Minutes an answer stays reusable: ASK_ANSWER_CACHE_MIN (default 15); 0 turns reuse off. */
export function cacheTtlMs(env = process.env) {
  const raw = String(env.ASK_ANSWER_CACHE_MIN ?? "").trim();
  const n = raw === "" ? ANSWER_CACHE_DEFAULT_MIN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 60_000 : 0;
}

/** The entry for `key` written within `ttlMs`, or null. */
export function findAnswer(db, key, now, ttlMs) {
  if (!usable(db) || !ttlMs) return null;
  ensure(db);
  const row = db.prepare("SELECT at, model, body FROM ask_answers WHERE key = ?").get(key);
  if (!row || now - row.at > ttlMs) return null;
  try { return { at: row.at, model: row.model, ...JSON.parse(row.body) }; } catch { return null; }
}

/** Stores `{ events, calls: [{ tool, args, hash }] }` and drops entries older than a day. */
export function keepAnswer(db, key, { at, model, events, calls }) {
  if (!usable(db)) return;
  ensure(db);
  db.prepare("INSERT INTO ask_answers (key, at, model, body) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, model = excluded.model, body = excluded.body")
    .run(key, at, String(model || ""), JSON.stringify({ events, calls }));
  db.prepare("DELETE FROM ask_answers WHERE at < ?").run(at - KEEP_MS);
}

/** Re-runs each recorded call; true only when every one returns the same data. Any failure means "changed". */
export async function sameData(calls, execute) {
  if (!calls?.length) return false;
  try {
    const now = await Promise.all(calls.map((c) => execute(c.tool, structuredClone(c.args ?? {}), {})));
    return now.every((raw, i) => dataHash(raw) === calls[i].hash);
  } catch {
    return false;
  }
}

/** An executor that also records `{ tool, args, hash }` for every call it runs. */
export function recordingExecutor(execute) {
  const calls = [];
  const run = async (tool, args, hooks) => {
    const before = structuredClone(args ?? {});
    const raw = await execute(tool, args, hooks);
    calls.push({ tool, args: before, hash: dataHash(raw) });
    return raw;
  };
  return { run, calls };
}
