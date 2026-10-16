import { listExperiments, listDatasets, getExperiment, getDataset } from './research-store.mjs';
import { listPlans, getPlan } from './convergence.mjs';
import { listNotebooks, getNotebook } from './notebooks.mjs';
export function researchMemory(db, { kind = '', id = '' } = {}) {
  const base = { ok: true, source: 'Local frozen research registry', asOf: new Date().toISOString(), latency: 'Saved snapshots; original source dates are retained. Notes are researcher-authored, not verified findings.' };
  if (!id) return { ...base, experiments: listExperiments(db).slice(0, 20), plans: listPlans(db).slice(0, 20), datasets: listDatasets(db).slice(0, 20), notebooks: listNotebooks(db).slice(0, 20).map(n => ({ id: n.id, title: n.title, status: n.status, tags: n.tags, revision: n.revision })), note: 'Latest 20 per category. Fetch a record by kind and id to inspect evidence. Saved browser chats are attached separately by the user.' };
  let record;
  if (kind === 'experiment') { const e = getExperiment(db, String(id)); if (e) record = { id: e.id, title: e.title, hypothesis: e.hypothesis, runId: e.runId, inputHash: e.run.inputHash, spec: e.run.result.spec, stats: e.run.result.stats, caveats: e.run.result.caveats, feeds: e.run.provenance.feeds, ok: e.run.result.ok, error: e.run.result.error }; }
  else if (kind === 'convergence') { const p = getPlan(db, String(id)); record = { id: p.id, title: p.title, spec: p.spec, runId: p.runId, evaluated: p.evaluated, priorEvaluations: p.priorEvaluations, caveats: p.report.caveats, periods: Object.fromEntries(Object.entries(p.report.periods).map(([k,v]) => [k,{ from:v.from,to:v.to,ablations:v.ablations,variants:v.variants.map(x=>({label:x.label,counts:x.counts,windowStats:x.windowStats,stats:x.result.stats,bootstrap:x.bootstrap})) }])) }; }
  else if (kind === 'notebook') record = getNotebook(db, String(id));
  else if (kind === 'dataset') { const d = getDataset(db, String(id)); if (d) record = { id:d.id,name:d.name,version:d.version,coverage:d.coverage,caveats:d.caveats,source:d.source }; }
  else return { ...base, ok:false,error:'Choose experiment, convergence, notebook, or dataset.' };
  return record ? { ...base,record } : { ...base,ok:false,error:'Saved record not found.' };
}
