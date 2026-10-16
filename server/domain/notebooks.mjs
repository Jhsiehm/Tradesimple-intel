import { researchStore, hashOf, newId, getExperiment, getRun } from './research-store.mjs';
import { getPlan } from './convergence.mjs';
export const FINDING_STATES = ['draft', 'promising', 'inconclusive', 'rejected', 'needs-data'];
function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${name} must be ${required ? 'nonempty and ' : ''}at most ${max} characters.`);
  return value.trim();
}
function decode(row) {
  if (hashOf(row.body) !== row.body_hash) throw new Error('Notebook checksum mismatch.');
  return JSON.parse(row.body);
}
export function notebookHistory(db, id) {
  researchStore(db);
  return db.prepare('SELECT body, body_hash FROM research.notebook_revisions WHERE notebook_id=? ORDER BY revision DESC').all(id).map(decode);
}
export function getNotebook(db, id) {
  researchStore(db);
  const row = db.prepare('SELECT body, body_hash FROM research.notebook_revisions WHERE notebook_id=? ORDER BY revision DESC LIMIT 1').get(id);
  return row ? decode(row) : null;
}
export function listNotebooks(db, query = '', status = '') {
  researchStore(db);
  const rows = db.prepare('SELECT n.body, n.body_hash FROM research.notebook_revisions n JOIN (SELECT notebook_id, MAX(revision) AS r FROM research.notebook_revisions GROUP BY notebook_id) latest ON n.notebook_id=latest.notebook_id AND n.revision=latest.r ORDER BY n.created_at DESC, n.notebook_id').all().map(decode);
  const q = String(query || '').trim().toLowerCase().slice(0, 300);
  return rows.filter(n => (!status || n.status === status) && (!q || [n.title, n.hypothesis, n.conclusion, n.decision, ...n.tags, ...n.evidence.map(e => `${e.title} ${e.source}`), ...n.followups.map(f => f.text)].join(' ').toLowerCase().includes(q)));
}
export function saveNotebook(db, body, id = null) {
  researchStore(db);
  const previous = id ? getNotebook(db, id) : null;
  if (id && !previous) throw new Error('Notebook not found.');
  if (previous && body.baseRevision !== previous.revision) throw new Error('This notebook changed elsewhere. Reload the latest revision before saving. Your draft has not been saved.');
  const title = text(body.title, 'Title', 200, true), hypothesis = text(body.hypothesis ?? '', 'Hypothesis', 4000), conclusion = text(body.conclusion ?? '', 'Conclusion', 12000), decision = text(body.decision ?? '', 'Decision rationale', 4000);
  if (!FINDING_STATES.includes(body.status)) throw new Error('Choose a valid finding status.');
  if (body.status !== 'draft' && (!conclusion || !decision)) throw new Error('Record a conclusion and decision rationale before classifying a finding.');
  if (!Array.isArray(body.tags) || body.tags.length > 20) throw new Error('Use at most 20 ticker/topic tags.');
  const tags = [...new Set(body.tags.map(t => text(t, 'Tag', 60, true)))];
  if (!Array.isArray(body.followups) || body.followups.length > 30) throw new Error('Use at most 30 follow-ups.');
  const followups = body.followups.map(f => {
    const due = f.due || '';
    if (typeof due !== 'string' || (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due))) throw new Error('Follow-up due date must be a valid date.');
    if (typeof f.done !== 'boolean') throw new Error('Follow-up completion must be true or false.');
    return { text: text(f.text, 'Follow-up', 1000, true), due, done: f.done };
  });
  if (!Array.isArray(body.evidence) || body.evidence.length > 30) throw new Error('Attach at most 30 evidence records.');
  const seen = new Set();
  const evidence = body.evidence.map(e => {
    if (!['experiment', 'convergence'].includes(e.kind) || typeof e.id !== 'string') throw new Error('Choose an existing experiment or Convergence plan.');
    const key = `${e.kind}:${e.id}`;
    if (seen.has(key)) throw new Error('Evidence is already attached.'); seen.add(key);
    // Existing references retain the exact run that supported the earlier conclusion.
    const retained = previous?.evidence.find(old => old.kind === e.kind && old.id === e.id);
    if (retained) { if (!getRun(db, retained.runId)) throw new Error('Evidence run is missing.'); return retained; }
    if (e.kind === 'experiment') {
      const exp = getExperiment(db, e.id);
      if (!exp) throw new Error('Evidence experiment not found.');
      return { kind: e.kind, id: exp.id, title: exp.title, runId: exp.runId, inputHash: exp.run.inputHash, source: exp.run.provenance.dataset?.name || exp.run.provenance.source || exp.run.result.spec?.source || '', phase: 'experiment' };
    }
    const plan = getPlan(db, e.id);
    return { kind: e.kind, id: plan.id, title: plan.title, runId: plan.runId, inputHash: plan.inputHash, source: plan.sources.map(s => s.label).join(' + '), phase: plan.evaluated ? 'holdout evaluated' : 'development only' };
  });
  const notebook = { id: id || newId('nb'), revision: (previous?.revision || 0) + 1, createdAt: new Date().toISOString(), title, hypothesis, conclusion, decision, status: body.status, tags, evidence, followups };
  const encoded = JSON.stringify(notebook);
  db.prepare('INSERT INTO research.notebook_revisions VALUES (?,?,?,?,?)').run(notebook.id, notebook.revision, notebook.createdAt, hashOf(encoded), encoded);
  return notebook;
}
