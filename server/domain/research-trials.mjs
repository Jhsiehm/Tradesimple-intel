/** Durable attempt inventory. Counts describe local activity, never independent statistical trials. */
import { researchStore, hashOf, newId } from './research-store.mjs';

const ready = new WeakSet();
function store(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS research.trial_attempts (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research.trial_outcomes (
      trial_id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, body TEXT NOT NULL
    );
  `);
  for (const table of ['trial_attempts', 'trial_outcomes']) {
    for (const op of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS research.${table}_${op.toLowerCase()}
      BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT, 'Research trial history is immutable'); END;`);
  }
  ready.add(db);
}
function checked(row) {
  if (hashOf(row.body) !== row.body_hash) throw Error('Research trial checksum mismatch.');
  return JSON.parse(row.body);
}
export function trialScope(spec = {}) {
  const f = spec.filters || spec;
  const symbols = Array.isArray(spec.universe) ? spec.universe : Array.isArray(f.tickers) ? f.tickers : [];
  return { from: f.from || null, to: f.to || null, symbols: [...new Set(symbols)].sort() };
}
function overlaps(a, b) {
  return (!a.from || !b.to || a.from <= b.to) && (!b.from || !a.to || b.from <= a.to)
    && (!a.symbols.length || !b.symbols.length || a.symbols.some(s => b.symbols.includes(s)));
}
export function listResearchTrials(db) {
  store(db);
  return db.prepare('SELECT body, body_hash FROM research.trial_attempts ORDER BY rowid').all().map(checked);
}
export function beginResearchTrial(db, { kind, spec, parentId = null }) {
  store(db);
  const scope = trialScope(spec);
  const previous = listResearchTrials(db).filter(t => overlaps(t.scope, scope));
  const trial = {
    version: 1, sequence: db.prepare('SELECT COALESCE(MAX(rowid), 0) + 1 AS n FROM research.trial_attempts').get().n, id: newId('trial'), createdAt: new Date().toISOString(), kind, parentId,
    spec, specHash: hashOf(spec), scope,
    priorOverlappingAttempts: previous.filter(t => !t.parentId).length,
    priorOverlappingVariants: previous.filter(t => t.parentId).length,
    interpretation: 'Exploratory. This inventory covers backtest, signal-search and Convergence attempts recorded since tracking began, including failures. Other research workflows are not comprehensively tracked here. It does not establish an untouched holdout or the number of independent tests; earlier and external inspection are unknown.'
  };
  const body = JSON.stringify(trial);
  db.prepare('INSERT INTO research.trial_attempts VALUES (?,?,?,?)').run(trial.id, trial.createdAt, hashOf(body), body);
  return trial;
}
export function finishResearchTrial(db, trial, { status, runId = null, detail = null }) {
  store(db);
  if (!['completed', 'partial', 'failed', 'untested', 'interrupted'].includes(status)) throw Error('Invalid research trial outcome.');
  const original = db.prepare('SELECT body, body_hash FROM research.trial_attempts WHERE id=?').get(trial.id);
  if (!original || checked(original).specHash !== trial.specHash) throw Error('Research trial does not match its registered specification.');
  const outcome = { trialId: trial.id, finishedAt: new Date().toISOString(), status, runId, detail };
  const body = JSON.stringify(outcome);
  db.prepare('INSERT INTO research.trial_outcomes VALUES (?,?,?)').run(trial.id, hashOf(body), body);
  return outcome;
}
export function researchTrialReceipt(trial) {
  return { id: trial.id, kind: trial.kind, registeredAt: trial.createdAt, priorOverlappingAttempts: trial.priorOverlappingAttempts,
    priorOverlappingVariants: trial.priorOverlappingVariants, interpretation: trial.interpretation };
}
export function exportResearchTrials(db, id) {
  const trials = listResearchTrials(db);
  const root = trials.find(t => t.id === id);
  if (!root) throw Error('Research trial not found.');
  // Include prior overlapping activity to make the receipt inspectable, plus this search's variant family.
  const selected = trials.filter(t => t.id === id || t.parentId === id || (t.sequence < root.sequence && overlaps(t.scope, root.scope)));
  return { version: 1, rootId: id, scope: 'Local attempt inventory; not an independent-trial count or a complete history of researcher access.', attempts: selected.map(trial => {
    const row = db.prepare('SELECT body, body_hash FROM research.trial_outcomes WHERE trial_id=?').get(trial.id);
    return { trial, outcome: row ? checked(row) : { status: 'unfinished', detail: 'No outcome recorded; may be running or interrupted.' } };
  }) };
}
