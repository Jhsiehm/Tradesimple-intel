#!/usr/bin/env node
/** Copy cached public feed responses into an isolated preview DB. Original payload dates stay intact. */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
const [sourceFile, targetFile] = process.argv.slice(2);
if (!sourceFile || !targetFile || path.resolve(sourceFile) === path.resolve(targetFile)) {
  throw new Error("Usage: node scripts/seed-preview.mjs SOURCE.sqlite SEPARATE-PREVIEW.sqlite");
}
const source = new DatabaseSync(sourceFile, { readOnly: true });
const target = new DatabaseSync(targetFile);
target.exec(
  "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, stored_at INTEGER NOT NULL, ttl_ms INTEGER NOT NULL)",
);
const insert = target.prepare(
  "INSERT INTO cache VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, stored_at=excluded.stored_at, ttl_ms=excluded.ttl_ms",
);
let copied = 0;
target.exec("BEGIN");
try {
  for (const row of source.prepare("SELECT * FROM cache").all()) {
    // Exclude failure records and non-feed caches (e.g. agent/backtest responses).
    if (
      !/^(pos:|roster:|news:|board:|earth:|fred:|clerk:|ptr:|efd:|sec:|earn:|weather:|chart:|quote:|votes:|bills:|committees:|congress:|leaders:|strait:|air:|fx:|crypto:|contracts:|macro:)/.test(
        row.key,
      )
    )
      continue;
    const body = JSON.parse(row.body);
    if (body?.ok === false) continue;
    // Freeze expiration only in this isolated preview; never rewrite observation/filing dates.
    insert.run(row.key, row.body, row.stored_at, Math.max(row.ttl_ms, Date.now() - row.stored_at + 365 * 86400000));
    copied++;
  }
  target.exec("COMMIT");
} catch (error) {
  target.exec("ROLLBACK");
  throw error;
}
source.close();
target.close();
console.log(
  `Copied ${copied} public-feed cache records. Run preview with VITE_HISTORY_PREVIEW=1; keep background jobs disabled.`,
);
