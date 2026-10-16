import { TOOLS } from '../ai/tools.mjs';
import { researchMemory } from '../domain/research-memory.mjs';
import { listNotebooks, getNotebook, notebookHistory, saveNotebook } from '../domain/notebooks.mjs';
import { createPlan, getPlan, listPlans, evaluatePlan } from '../domain/convergence.mjs';
import { reply } from '../router.mjs';
import { readJson } from '../lib/body.mjs';
import { listExperiments, saveExperiment, getExperiment, getRun, listDatasets, getDataset } from '../domain/research-store.mjs';
import { prepareDataset, importDataset, datasetSource, IMPORT_LIMIT } from '../domain/research-events.mjs';
import { listConnectors, readConnector } from '../domain/research-connectors.mjs';
import { replayRun, exportRun } from '../domain/research-replay.mjs';
import { runSpec } from '../domain/backtest/index.mjs';
import { cleanSpec } from '../../shared/backtestSpec.mjs';

let running = false;
const fail = (status, error) => reply(status, { ok: false, error });
const brief = experiment => {
  const { inputs, ...run } = experiment.run;
  const { engineResult, ...result } = run.result;
  const { records, matchedSignals, identity, ...provenance } = run.provenance;
  return { ...experiment, run: { ...run, result, provenance: { ...provenance, identityVersion: identity.version, identityBasis: identity.basis, recordCount: Array.isArray(records) ? records.length : Object.values(records).flat().length, matchedSignals: matchedSignals?.length || 0, events: provenance.events?.slice(0, 20) || [] }, inputCounts: inputs ? { signals: inputs.signals.length, priced: Object.keys(inputs.bars).length, benchmarks: Object.keys(inputs.benchBars).length } : null } };
};
const datasetBrief = ({ rawContent, events, identity, ...rest }) => ({ ...rest, preview: events.slice(0, 10), identityVersion: identity.version });
async function handle(ctx, methods, fn) {
  if (!methods.includes(ctx.req.method)) return fail(405, `Use ${methods.join(' or ')}.`);
  try {
    let body = {};
    if (ctx.req.method === 'POST') {
      const parsed = await readJson(ctx.req, IMPORT_LIMIT * 6 + 128 * 1024);
      if (!parsed.ok) return fail(parsed.status, parsed.error);
      if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return fail(400, 'JSON object required.');
      body = parsed.value;
    }
    return await fn(body);
  } catch (err) { return fail(400, err.message); }
}
export const handlers = {
  'research.context': ctx => handle(ctx, ['GET'], () => ({ ...researchMemory(ctx.db), tools: TOOLS.map(t => ({ name:t.name, label:t.label, description:t.description, parameters:t.parameters })), coverage: 'Tool catalog only. Provider availability, coverage and as-of are checked on retrieval; no live feeds are prefetched here.' })),
  'research.notebooks': ctx => handle(ctx, ['GET', 'POST'], body => ctx.req.method === 'POST' ? { ok: true, notebook: saveNotebook(ctx.db, body) } : { ok: true, items: listNotebooks(ctx.db, new URL(ctx.req.url, 'http://localhost').searchParams.get('q'), new URL(ctx.req.url, 'http://localhost').searchParams.get('status')) }),
  'research.notebook': ctx => handle(ctx, ['GET', 'POST'], body => {
    if (ctx.req.method === 'POST') return { ok: true, notebook: saveNotebook(ctx.db, body, ctx.params.id) };
    const notebook = getNotebook(ctx.db, ctx.params.id);
    return notebook ? { ok: true, notebook, history: notebookHistory(ctx.db, ctx.params.id) } : fail(404, 'Notebook not found.');
  }),
  'research.convergence': ctx => handle(ctx, ['GET', 'POST'], body => ctx.req.method === 'GET' ? { ok: true, items: listPlans(ctx.db) } : { ok: true, plan: createPlan(ctx.db, body) }),
  'research.convergencePlan': ctx => handle(ctx, ['GET'], () => ({ ok: true, plan: getPlan(ctx.db, ctx.params.id) })),
  'research.convergenceEvaluate': ctx => handle(ctx, ['POST'], () => ({ ok: true, plan: evaluatePlan(ctx.db, ctx.params.id) })),
  'research.experiments': ctx => handle(ctx, ['GET', 'POST'], body => ctx.req.method === 'GET' ? { ok: true, items: listExperiments(ctx.db) } : { ok: true, experiment: brief(saveExperiment(ctx.db, body)) }),
  'research.experiment': ctx => handle(ctx, ['GET'], () => { const e = getExperiment(ctx.db, ctx.params.id); return e ? { ok: true, experiment: brief(e) } : fail(404, 'Experiment not found.'); }),
  'research.replay': ctx => handle(ctx, ['POST'], () => { const run = getRun(ctx.db, ctx.params.id); return run ? replayRun(run) : fail(404, 'Run not found.'); }),
  'research.export': ctx => handle(ctx, ['GET'], () => {
    const run = getRun(ctx.db, ctx.params.id);
    if (!run) return fail(404, 'Run not found.');
    const bytes = exportRun(ctx.db, run);
    ctx.res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${run.id}.zip"`, 'Cache-Control': 'no-store' });
    ctx.res.end(bytes);
  }),
  'research.datasets': ctx => handle(ctx, ['GET', 'POST'], body => {
    if (ctx.req.method === 'GET') return { ok: true, items: listDatasets(ctx.db), connectors: listConnectors() };
    const out = importDataset(ctx.db, body);
    return out.ok ? { ok: true, dataset: datasetBrief(out.dataset) } : reply(422, out);
  }),
  'research.dataset': ctx => handle(ctx, ['GET'], () => { const d = getDataset(ctx.db, ctx.params.id); return d ? { ok: true, dataset: datasetBrief(d) } : fail(404, 'Dataset not found.'); }),
  'research.preview': ctx => handle(ctx, ['POST'], async body => {
    const imported = body.connector ? await readConnector(body.connector) : null;
    const p = prepareDataset(ctx.db, { ...body, ...(imported || {}) });
    const { payload, ...preview } = p;
    return { ...preview, ...(imported || {}), caveats: payload.caveats };
  }),
  'research.run': ctx => handle(ctx, ['POST'], async body => {
    if (running) return fail(429, 'A research run is already running.');
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200 || (body.hypothesis != null && (typeof body.hypothesis !== 'string' || body.hypothesis.length > 4000))) return fail(400, 'Provide a title (1–200 characters) and hypothesis (up to 4,000 characters).');
    if (body.parentId && !getExperiment(ctx.db, body.parentId)) return fail(404, 'Parent experiment not found.');
    const dataset = body.datasetId ? getDataset(ctx.db, body.datasetId) : null;
    if (body.datasetId && !dataset) return fail(404, 'Dataset version not found.');
    const checked = cleanSpec(dataset ? { source: 'dataset', datasetId: dataset.id, rules: body.rules } : body.spec);
    if (!checked.ok) return fail(400, checked.error);
    running = true;
    try {
      const result = await runSpec(ctx.db, checked.spec, { fresh: true, ...(dataset ? { sourceFn: async () => datasetSource(dataset) } : {}) });
      if (!result.runId) return fail(400, result.error || 'No frozen run was produced.');
      return { ok: true, experiment: brief(saveExperiment(ctx.db, { runId: result.runId, title: body.title, hypothesis: body.hypothesis || '', parentId: body.parentId || null })) };
    } finally { running = false; }
  })
};
