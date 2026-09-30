import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

let extras = new Map();

export function openDb(root) {
  extras = new Map(JSON.parse(fs.readFileSync(path.join(root, "data", "tickers.json"), "utf8")).map((row) => [row.symbol, row]));
  const file = process.env.INTEL_CACHE || path.join(root, "data", "cache.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      stored_at INTEGER NOT NULL,
      ttl_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickers (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cik TEXT,
      lda_clients TEXT NOT NULL,
      recipients TEXT NOT NULL,
      districts TEXT NOT NULL,
      state TEXT,
      lat REAL,
      lon REAL
    );
  `);
  {
    const rows = JSON.parse(fs.readFileSync(path.join(root, "data", "tickers.json"), "utf8"));
    db.exec("DELETE FROM tickers");
    const insert = db.prepare(`
      INSERT INTO tickers (symbol, name, cik, lda_clients, recipients, districts, state, lat, lon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        row.symbol,
        row.name,
        row.cik,
        JSON.stringify(row.ldaClients),
        JSON.stringify(row.recipients),
        JSON.stringify(row.districts),
        row.state,
        row.lat,
        row.lon
      );
    }
  }
  return db;
}

export function readCache(db, key) {
  const row = db.prepare("SELECT body, stored_at, ttl_ms FROM cache WHERE key = ?").get(key);
  if (!row) return null;
  if (Date.now() - row.stored_at > row.ttl_ms) return null;
  return JSON.parse(row.body);
}

export function writeCache(db, key, value, ttlMs) {
  db.prepare(`
    INSERT INTO cache (key, body, stored_at, ttl_ms)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET body = excluded.body, stored_at = excluded.stored_at, ttl_ms = excluded.ttl_ms
  `).run(key, JSON.stringify(value), Date.now(), ttlMs);
}

export function listTickers(db) {
  return db.prepare("SELECT * FROM tickers ORDER BY symbol").all().map(hydrate);
}

export function tickerBySymbol(db, symbol) {
  const row = db.prepare("SELECT * FROM tickers WHERE symbol = ?").get(symbol.toUpperCase());
  return row ? hydrate(row) : null;
}

function hydrate(row) {
  return {
    symbol: row.symbol,
    name: row.name,
    cik: row.cik,
    ldaClients: JSON.parse(row.lda_clients),
    recipients: JSON.parse(row.recipients),
    districts: JSON.parse(row.districts),
    state: row.state,
    lat: row.lat,
    lon: row.lon,
    pacs: extras.get(row.symbol)?.pacs || [],
    core: extras.get(row.symbol)?.core !== false,
    index: extras.get(row.symbol)?.index || [],
    sector: extras.get(row.symbol)?.sector || "",
    industry: extras.get(row.symbol)?.industry || "",
    joinBasis: extras.get(row.symbol)?.joinBasis || null
  };
}

export function listCore(db) {
  return listTickers(db).filter((t) => t.core);
}

/** Short fingerprint of the full-join set; scan caches keyed on it rebuild when joins are added. */
export function coreKey(db) {
  let h = 0;
  for (const t of listCore(db)) for (const ch of `${t.symbol}:${t.cik}|`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
