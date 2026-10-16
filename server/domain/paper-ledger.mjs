import { accountRules, cleanAction, apply, verifyPaperLedger } from "./paper-engine.mjs";
export { verifyPaperLedger } from "./paper-engine.mjs";
/** Manual paper simulation only. No broker, quote fetch or live execution capability. */
import { researchStore, getExperiment, hashOf, newId } from "./research-store.mjs";
import { requireAuditedSource } from "./research-integrity.mjs";
const ready = new WeakSet();
const integer = (n, min, max, label) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`${label} must be an integer from ${min} to ${max}.`);
  return n;
};
const text = (s, max, label) => {
  if (typeof s !== "string" || !s.trim() || s.length > max) throw Error(`Provide ${label} up to ${max} characters.`);
  return s.trim();
};
function ensure(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.paper_accounts(id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research.paper_events(account_id TEXT NOT NULL,sequence INTEGER NOT NULL,request_id TEXT NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(account_id,sequence),UNIQUE(account_id,request_id));`);
  for (const t of ["paper_accounts", "paper_events"])
    for (const op of ["UPDATE", "DELETE"])
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS research.${t}_${op.toLowerCase()} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'Paper records are immutable'); END;`,
      );
  ready.add(db);
}
function decode(row) {
  if (!row || hashOf(row.body) !== row.body_hash) throw Error("Paper record missing or checksum mismatch.");
  return JSON.parse(row.body);
}
export function createPaperAccount(db, raw) {
  ensure(db);
  const experiment = getExperiment(db, raw.experimentId);
  if (!experiment?.run?.result.ok || experiment.run.result.building || experiment.run.inputs?.kind)
    throw Error("Choose a completed single-source experiment.");
  requireAuditedSource(experiment.run);
  const account = {
    version: 1,
    id: newId("paper"),
    createdAt: new Date().toISOString(),
    title: text(raw.title, 200, "account title"),
    experimentId: experiment.id,
    sourceRunId: experiment.runId,
    sourceInputHash: experiment.run.inputHash,
    initialCashCents: raw.initialCashCents,
    maxOrderCents: raw.maxOrderCents,
    maxPositionShares: raw.maxPositionShares,
  };
  accountRules(account);
  const body = JSON.stringify(account);
  db.prepare("INSERT INTO research.paper_accounts VALUES (?,?,?)").run(account.id, hashOf(body), body);
  return getPaperAccount(db, account.id);
}
export function getPaperAccount(db, id) {
  ensure(db);
  const account = decode(db.prepare("SELECT * FROM research.paper_accounts WHERE id=?").get(id));
  if (account.id !== id) throw Error("Paper account identity mismatch.");
  const rows = db.prepare("SELECT * FROM research.paper_events WHERE account_id=? ORDER BY sequence").all(id),
    events = rows.map((row) => {
      const event = decode(row);
      if (event.sequence !== row.sequence || event.requestId !== row.request_id)
        throw Error("Paper event index mismatch.");
      return event;
    });
  return { account, state: verifyPaperLedger(account, events), events };
}
export function listPaperAccounts(db) {
  ensure(db);
  return db.prepare("SELECT * FROM research.paper_accounts ORDER BY rowid DESC LIMIT 100").all().map(decode);
}
export function recordPaperAction(db, id, raw) {
  ensure(db);
  const requestId = text(raw.requestId, 100, "unique request ID"),
    expectedSequence = integer(raw.expectedSequence, 0, 10000, "Expected sequence"),
    action = cleanAction(raw);
  db.exec("SAVEPOINT paper_action");
  try {
    const prior = db
      .prepare("SELECT * FROM research.paper_events WHERE account_id=? AND request_id=?")
      .get(id, requestId);
    if (prior) {
      const event = decode(prior);
      if (hashOf(event.action) !== hashOf(action))
        throw Error("Paper request ID was already used with different instructions.");
      const out = getPaperAccount(db, id);
      db.exec("RELEASE paper_action");
      return out;
    }
    const { account, state } = getPaperAccount(db, id);
    if (state.sequence !== expectedSequence)
      throw Error("Paper account changed. Refresh and review the current balances.");
    if (state.sequence >= 10000) throw Error("Paper account reached its 10,000-event limit.");
    apply(state, account, action);
    const event = {
        accountId: id,
        sequence: state.sequence + 1,
        requestId,
        previousHash: state.head,
        recordedAt: new Date().toISOString(),
        action,
      },
      body = JSON.stringify(event);
    db.prepare("INSERT INTO research.paper_events VALUES (?,?,?,?,?)").run(
      id,
      event.sequence,
      requestId,
      hashOf(body),
      body,
    );
    const out = getPaperAccount(db, id);
    db.exec("RELEASE paper_action");
    return out;
  } catch (error) {
    db.exec("ROLLBACK TO paper_action; RELEASE paper_action");
    throw error;
  }
}
