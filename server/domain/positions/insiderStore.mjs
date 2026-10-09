/**
 * Form 4 history in the cache db: one row per transaction line per join-table ticker (GOOG and GOOGL share a CIK, so a
 * form lists under both, as on the live path). Written by jobs/insidersBackfill.mjs from the SEC Insider Transactions
 * Data Sets and the EDGAR daily index; read by insiderHistory. Ingest bookkeeping (quarters and days done, with the
 * join-table fingerprint they were read with) makes the backfill resumable and incremental.
 */
import { listTickers } from "../../lib/db.mjs";

export const STORE_SOURCE = "SEC Insider Transactions Data Sets (quarterly) + EDGAR daily index";
export const STORE_START = "2020-01-01";

const ready = new WeakSet();

export function ensureInsiderStore(db) {
  if (ready.has(db)) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS insider_tx (
      ticker TEXT NOT NULL,
      accession TEXT NOT NULL,
      line INTEGER NOT NULL,
      issuer_cik INTEGER NOT NULL,
      form TEXT NOT NULL,
      person TEXT,
      title TEXT,
      code TEXT,
      side TEXT,
      shares REAL,
      price REAL,
      value REAL,
      owned REAL,
      plan INTEGER NOT NULL DEFAULT 0,
      traded TEXT,
      filed TEXT NOT NULL,
      lag INTEGER,
      source TEXT NOT NULL,
      PRIMARY KEY (ticker, accession, line)
    );
    CREATE INDEX IF NOT EXISTS insider_tx_cik ON insider_tx (issuer_cik, filed);
    CREATE INDEX IF NOT EXISTS insider_tx_ticker ON insider_tx (ticker, filed);
    CREATE INDEX IF NOT EXISTS insider_tx_traded ON insider_tx (traded);
    CREATE INDEX IF NOT EXISTS insider_tx_filed ON insider_tx (filed);
    CREATE INDEX IF NOT EXISTS insider_tx_accession ON insider_tx (accession);
    CREATE TABLE IF NOT EXISTS insider_ingest (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      joins TEXT NOT NULL,
      forms INTEGER NOT NULL,
      rows INTEGER NOT NULL,
      url TEXT,
      done_at INTEGER NOT NULL,
      PRIMARY KEY (kind, key)
    );
    CREATE TABLE IF NOT EXISTS insider_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  ready.add(db);
  return db;
}

/** CIK → join-table tickers (data/tickers.json, core or not), and a fingerprint that changes when a join changes. */
export function joinsByCik(db) {
  const byCik = new Map();
  for (const t of listTickers(db)) {
    const cik = Number(t.cik);
    if (!cik) continue;
    if (!byCik.has(cik)) byCik.set(cik, []);
    byCik.get(cik).push(t);
  }
  let h = 0;
  for (const s of [...byCik].flatMap(([cik, ts]) => ts.map((t) => `${t.symbol}:${cik}`)).sort()) for (const ch of `${s}|`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return { byCik, joins: (h >>> 0).toString(36) };
}

const INSERT = `INSERT OR REPLACE INTO insider_tx (ticker, accession, line, issuer_cik, form, person, title, code, side, shares, price, value, owned, plan, traded, filed, lag, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Writes forms ({ accession, issuerCik, form, rows: form4Rows output }) in one transaction. The data set replaces
 * whatever a form had (a daily-index read of the same accession); the daily index never overwrites a stored form.
 */
export function writeForms(db, forms, source) {
  ensureInsiderStore(db);
  const del = db.prepare("DELETE FROM insider_tx WHERE accession = ?");
  const has = db.prepare("SELECT 1 FROM insider_tx WHERE accession = ? LIMIT 1");
  const ins = db.prepare(INSERT);
  let rows = 0;
  let skipped = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const f of forms) {
      if (source === "dataset") del.run(f.accession);
      else if (has.get(f.accession)) { skipped += 1; continue; }
      for (const r of f.rows) {
        const line = Number(String(r.id).split("-").pop());
        ins.run(r.symbol, f.accession, line, Number(f.issuerCik), f.form, r.person, r.title, r.code, r.side, r.shares, r.price, r.value, r.owned, r.plan ? 1 : 0, r.traded || null, r.filed, r.lag ?? null, source);
        rows += 1;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  status.at = 0;
  return { rows, skipped };
}

/** Accessions already stored, of those given. */
export function storedAccessions(db, accessions) {
  ensureInsiderStore(db);
  const has = db.prepare("SELECT 1 FROM insider_tx WHERE accession = ? LIMIT 1");
  return new Set(accessions.filter((a) => has.get(a)));
}

export function markDone(db, kind, key, { joins, forms = 0, rows = 0, url = "" }) {
  ensureInsiderStore(db);
  db.prepare("INSERT OR REPLACE INTO insider_ingest (kind, key, joins, forms, rows, url, done_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(kind, key, joins, forms, rows, url, Date.now());
  status.at = 0;
}

/** kind → Map key → { joins, forms, rows, doneAt }. */
export function doneOf(db, kind) {
  ensureInsiderStore(db);
  return new Map(db.prepare("SELECT key, joins, forms, rows, done_at FROM insider_ingest WHERE kind = ?").all(kind).map((r) => [r.key, { joins: r.joins, forms: r.forms, rows: r.rows, doneAt: r.done_at }]));
}

export function getMeta(db, key) {
  ensureInsiderStore(db);
  const row = db.prepare("SELECT value FROM insider_meta WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setMeta(db, key, value) {
  ensureInsiderStore(db);
  db.prepare("INSERT OR REPLACE INTO insider_meta (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
  status.at = 0;
}

/** A `pid:N` owner on this machine whose process has exited (a crashed or killed backfill) holds nothing. */
function ownerGone(owner) {
  const m = /^pid:(\d+)$/.exec(String(owner || ""));
  if (!m) return false;
  try { process.kill(Number(m[1]), 0); return false; } catch (err) { return err.code === "ESRCH"; }
}

/** One writer at a time across processes (the CLI backfill and the server's incremental job). */
export function takeLease(db, owner, ms, now = Date.now()) {
  ensureInsiderStore(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const cur = getMeta(db, "lease");
    if (cur && cur.owner !== owner && cur.until > now && !ownerGone(cur.owner)) { db.exec("ROLLBACK"); return false; }
    db.prepare("INSERT OR REPLACE INTO insider_meta (key, value) VALUES ('lease', ?)").run(JSON.stringify({ owner, until: now + ms }));
    db.exec("COMMIT");
    return true;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function dropLease(db, owner) {
  const cur = getMeta(db, "lease");
  if (cur?.owner === owner) db.prepare("DELETE FROM insider_meta WHERE key = 'lease'").run();
}

const status = { at: 0, body: null };

/**
 * What the store holds: rows, forms, date spans, quarters and days ingested, the span it covers completely
 * (`coveredFrom`..`coveredThrough`, null until the first quarter is in), last update. Cached for a minute.
 */
export function storeStatus(db, now = Date.now()) {
  if (!db) return null;
  if (status.body && status.db === db && now - status.at < 60_000) return status.body;
  ensureInsiderStore(db);
  const agg = db.prepare("SELECT COUNT(*) AS rows, COUNT(DISTINCT accession) AS forms, COUNT(DISTINCT ticker) AS tickers, MIN(filed) AS minFiled, MAX(filed) AS maxFiled, MIN(traded) AS minTraded, MAX(traded) AS maxTraded FROM insider_tx").get();
  const bySource = Object.fromEntries(db.prepare("SELECT source, COUNT(*) AS n FROM insider_tx GROUP BY source").all().map((r) => [r.source, r.n]));
  const quarters = [...doneOf(db, "quarter").keys()].sort();
  const days = [...doneOf(db, "day").keys()].sort();
  const cover = getMeta(db, "coverage");
  const body = {
    source: STORE_SOURCE,
    rows: agg.rows,
    forms: agg.forms,
    tickers: agg.tickers,
    bySource,
    filed: { from: agg.minFiled || "", to: agg.maxFiled || "" },
    traded: { from: agg.minTraded || "", to: agg.maxTraded || "" },
    quarters: { count: quarters.length, first: quarters[0] || "", last: quarters.at(-1) || "" },
    days: { count: days.length, last: days.at(-1) || "" },
    coveredFrom: cover?.from || null,
    coveredThrough: cover?.through || null,
    datasetThrough: cover?.datasetThrough || null,
    lastUpdate: getMeta(db, "lastUpdate") || null,
    lastError: getMeta(db, "lastError") || null,
    running: (getMeta(db, "lease")?.until || 0) > now
  };
  Object.assign(status, { at: now, db, body });
  return body;
}

/** The store is used once it holds rows and a covered span. */
export function storeReady(db) {
  const s = storeStatus(db);
  return s && s.rows > 0 && s.coveredFrom && s.coveredThrough ? s : null;
}

const linkOf = (cik, accession) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${accession}-index.htm`;

/**
 * Form 4 lines filed in [from, to] for `symbols`, newest filed first, in form4Rows' shape (plus `form`, `source`).
 * 4/A amendments are left out unless asked for (they restate a form already counted); `amended` counts them.
 */
export function storeRows(db, { from = "", to = "", symbols = [], amendments = false } = {}) {
  ensureInsiderStore(db);
  const where = ["1 = 1"];
  const args = [];
  if (from) { where.push("filed >= ?"); args.push(from); }
  if (to) { where.push("filed <= ?"); args.push(to); }
  if (symbols.length) { where.push(`ticker IN (${symbols.map(() => "?").join(",")})`); args.push(...symbols); }
  const amended = db.prepare(`SELECT COUNT(*) AS n FROM insider_tx WHERE ${where.join(" AND ")} AND form <> '4'`).get(...args).n;
  if (!amendments) where.push("form = '4'");
  const rows = db.prepare(`SELECT * FROM insider_tx WHERE ${where.join(" AND ")} ORDER BY filed DESC, traded DESC, accession, line`).all(...args);
  return {
    amended,
    items: rows.map((r) => ({
      id: `f4-${r.ticker}-${r.accession}-${r.line}`,
      accession: r.accession,
      symbol: r.ticker,
      person: r.person,
      title: r.title,
      code: r.code,
      side: r.side,
      shares: r.shares,
      price: r.price,
      value: r.value,
      owned: r.owned,
      plan: Boolean(r.plan),
      traded: r.traded || "",
      filed: r.filed,
      lag: r.lag,
      link: linkOf(r.issuer_cik, r.accession),
      form: r.form,
      source: r.source
    }))
  };
}
