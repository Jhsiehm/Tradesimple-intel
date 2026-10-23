import { exportResearchTrials } from '../domain/research-trials.mjs';
import {exportPaperArchive} from '../domain/paper-archive.mjs';
import {createPaperAccount,getPaperAccount,listPaperAccounts,recordPaperAction} from '../domain/paper-ledger.mjs';
import {createRetrieval,listRetrievals,getRetrieval,resumeRetrieval} from '../domain/connector-retrievals.mjs';
import {exportAnalysis} from '../domain/analysis-archive.mjs';
import {exportNotebook} from '../domain/notebook-archive.mjs';
import {createEventStudy,getEventStudy,listEventStudies,evaluateEventStudy} from '../domain/event-studies.mjs';
import {createStressPlan,getStressPlan,listStressPlans,evaluateStressPlan} from '../domain/research-stress.mjs';
import {prepareObservations,importObservations,listObservations,getObservations,deriveObservationSignals,resolveObservations,mergeObservationSnapshots} from '../domain/research-observations.mjs';
import {exportPair} from '../domain/paired-archive.mjs';
import {listPairEvaluations,savePairEvaluation} from '../domain/pair-evaluations.mjs';
import {executePair,getPairExecution} from '../ai/pairedResearch.mjs';
import {createPairProtocol,getPairProtocol,listPairProtocols} from '../domain/research-pairs.mjs';
import {listAnalyses,getAnalysis} from '../domain/research-analysis.mjs';
import { approveMemory, listMemoryApprovals, createMemorySnapshot, getMemorySnapshot, listMemorySnapshots } from '../domain/research-context.mjs';
import { importRelationships, listRelationshipSnapshots, getRelationshipSnapshot, queryRelationships } from '../domain/relationship-history.mjs';
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
import { createContractJob, jobView, listContractJobs, pauseContractJob, startContractJob, freezeContractJob, exportJob, workContractJob } from '../domain/evidence/contracts.mjs';
import { gzipSync } from 'node:zlib';

let running = false;
let pairRunning = false;
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
  'research.trial': ctx => handle(ctx, ['GET'], () => ({ ok: true, inventory: exportResearchTrials(ctx.db, ctx.params.id) })),
  'research.paperArchive':ctx=>handle(ctx,['GET'],()=>{const bytes=exportPaperArchive(ctx.db,ctx.params.id);ctx.res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${ctx.params.id}.zip"`,'Cache-Control':'no-store'});ctx.res.end(bytes);}),
  'research.paperAccounts':ctx=>handle(ctx,['GET','POST'],body=>ctx.req.method==='GET'?{ok:true,items:listPaperAccounts(ctx.db)}:{ok:true,ledger:createPaperAccount(ctx.db,body)}),
  'research.paperAccount':ctx=>handle(ctx,['GET'],()=>({ok:true,ledger:getPaperAccount(ctx.db,ctx.params.id)})),
  'research.paperAction':ctx=>handle(ctx,['POST'],body=>({ok:true,ledger:recordPaperAction(ctx.db,ctx.params.id,body)})),
  'research.paperExport':ctx=>handle(ctx,['GET'],()=>{const ledger=getPaperAccount(ctx.db,ctx.params.id);ctx.res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':`attachment; filename="${ctx.params.id}.json"`,'Cache-Control':'no-store'});ctx.res.end(JSON.stringify({format:'tradesimple-manual-paper-v1',...ledger,notice:'Manual simulation at asserted prices. No broker orders, verified market fills or marked-to-market valuations.'},null,2));}),
  'research.eventStudies': ctx=>handle(ctx,['GET','POST'],body=>ctx.req.method==='GET'?{ok:true,items:listEventStudies(ctx.db)}:{ok:true,plan:createEventStudy(ctx.db,body)}),
  'research.eventStudy': ctx=>handle(ctx,['GET'],()=>({ok:true,plan:getEventStudy(ctx.db,ctx.params.id)})),
  'research.eventStudyEvaluate': ctx=>handle(ctx,['POST'],()=>({ok:true,plan:evaluateEventStudy(ctx.db,ctx.params.id)})),
  'research.stressPlans': ctx=>handle(ctx,['GET','POST'],body=>ctx.req.method==='GET'?{ok:true,items:listStressPlans(ctx.db)}:{ok:true,plan:createStressPlan(ctx.db,body)}),
  'research.stressPlan': ctx=>handle(ctx,['GET'],()=>({ok:true,plan:getStressPlan(ctx.db,ctx.params.id)})),
  'research.stressEvaluate': ctx=>handle(ctx,['POST'],()=>({ok:true,plan:evaluateStressPlan(ctx.db,ctx.params.id)})),
  'research.observations': ctx => handle(ctx,['GET','POST'],body=>ctx.req.method==='GET'?{ok:true,items:listObservations(ctx.db),connectors:listConnectors()}:importObservations(ctx.db,body)),
  'research.observationMerge': ctx => handle(ctx,['POST'],body=>mergeObservationSnapshots(ctx.db,body)),
  'research.observationPreview': ctx => handle(ctx,['POST'],async body=>{const imported=body.connector?await readConnector(body.connector):null;const {payload,...preview}=prepareObservations({...body,...(imported||{})});return {...preview,...(imported||{})};}),
  'research.observation': ctx => handle(ctx,['GET'],()=>({ok:true,snapshot:getObservations(ctx.db,ctx.params.id)})),
  'research.observationResolve': ctx => handle(ctx,['POST'],body=>({ok:true,result:resolveObservations(getObservations(ctx.db,ctx.params.id),body)})),
  'research.observationDerive': ctx => handle(ctx,['POST'],body=>{const out=deriveObservationSignals(ctx.db,ctx.params.id,body);return {...out,dataset:datasetBrief(out.dataset),transformation:{policy:out.transformation.policy,received:out.transformation.received,selected:out.transformation.selected,signals:out.transformation.signals}};}),
  'research.pairExport': ctx => handle(ctx,['GET'],()=>{const bytes=exportPair(ctx.db,ctx.params.id);ctx.res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${ctx.params.id}.zip"`,'Cache-Control':'no-store'});ctx.res.end(bytes);}),
  'research.pairEvaluations': ctx => handle(ctx,['GET','POST'],body=>ctx.req.method==='GET'?{ok:true,items:listPairEvaluations(ctx.db,ctx.params.id)}:{ok:true,evaluation:savePairEvaluation(ctx.db,ctx.params.id,body)}),
  'research.pairRun': ctx => handle(ctx,['GET','POST'],async()=>{
    if(ctx.req.method==='GET')return {ok:true,execution:getPairExecution(ctx.db,ctx.params.id)};
    const existing=getPairExecution(ctx.db,ctx.params.id);
    if(existing)return {ok:true,execution:existing};
    if(pairRunning)return fail(429,'Another paired evaluation is running.');
    pairRunning=true;
    const controller=new AbortController();const close=()=>controller.abort();ctx.res.on('close',close);
    try{return {ok:true,execution:await executePair(ctx.db,ctx.params.id,{signal:controller.signal})};}
    finally{pairRunning=false;ctx.res.off('close',close);}
  }),
  'research.pairs': ctx => handle(ctx,['GET','POST'],body=>ctx.req.method==='GET'?{ok:true,items:listPairProtocols(ctx.db)}:{ok:true,protocol:createPairProtocol(ctx.db,body)}),
  'research.pair': ctx => handle(ctx,['GET'],()=>({ok:true,protocol:getPairProtocol(ctx.db,ctx.params.id)})),
  'research.retrievals': ctx=>handle(ctx,['GET','POST'],body=>ctx.req.method==='GET'?{ok:true,items:listRetrievals(ctx.db)}:{ok:true,job:createRetrieval(ctx.db,body.connector)}),
  'research.retrieval': ctx=>handle(ctx,['GET'],()=>({ok:true,job:getRetrieval(ctx.db,ctx.params.id)})),
  'research.retrievalResume': ctx=>handle(ctx,['POST'],async()=>({ok:true,...await resumeRetrieval(ctx.db,ctx.params.id)})),
  'research.analyses': ctx => handle(ctx,['GET'],()=>({ok:true,items:listAnalyses(ctx.db)})),
  'research.analysisExport': ctx => handle(ctx,['GET'],()=>{const bytes=exportAnalysis(ctx.db,ctx.params.id);ctx.res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${ctx.params.id}.zip"`,'Cache-Control':'no-store'});ctx.res.end(bytes);}),
  'research.analysis': ctx => handle(ctx,['GET'],()=>({ok:true,analysis:getAnalysis(ctx.db,ctx.params.id)})),
  'research.memoryApprovals': ctx => handle(ctx, ['GET','POST'], body => ctx.req.method === 'GET' ? {ok:true,items:listMemoryApprovals(ctx.db)} : {ok:true,approval:approveMemory(ctx.db,body)}),
  'research.memorySnapshots': ctx => handle(ctx, ['GET','POST'], body => ctx.req.method === 'GET' ? {ok:true,items:listMemorySnapshots(ctx.db)} : {ok:true,snapshot:createMemorySnapshot(ctx.db,body)}),
  'research.memorySnapshot': ctx => handle(ctx, ['GET'], () => ({ok:true,snapshot:getMemorySnapshot(ctx.db,ctx.params.id)})),
  'research.relationships': ctx => handle(ctx, ['GET', 'POST'], body => ctx.req.method === 'GET' ? { ok: true, items: listRelationshipSnapshots(ctx.db) } : { ok: true, snapshot: importRelationships(ctx.db, body) }),
  'research.relationshipSnapshot': ctx => handle(ctx, ['GET'], () => ({ ok: true, snapshot: getRelationshipSnapshot(ctx.db, ctx.params.id) })),
  'research.relationshipQuery': ctx => handle(ctx, ['POST'], body => ({ ok: true, result: queryRelationships(ctx.db, ctx.params.id, body) })),
  'research.contractJobs': ctx => handle(ctx, ['GET', 'POST'], async body => {
    if (ctx.req.method === 'GET') return { ok: true, items: listContractJobs(ctx.db) };
    const job = createContractJob(ctx.db, body);
    const initial = startContractJob(ctx.db, job.id);
    return { ok: true, job: initial };
  }),
  'research.contractJob': ctx => handle(ctx, ['GET'], () => ({ ok: true, job: jobView(ctx.db, ctx.params.id) })),
  'research.contractJobResume': ctx => handle(ctx, ['POST'], () => {
    const existing = jobView(ctx.db, ctx.params.id);
    if (['running','queued'].includes(existing.status)) return { ok: true, job: existing };
    return { ok: true, job: startContractJob(ctx.db, ctx.params.id) };
  }),
  'research.contractJobPause': ctx => handle(ctx, ['POST'], () => ({ ok: true, job: pauseContractJob(ctx.db, ctx.params.id) })),
  'research.contractJobFreeze': ctx => handle(ctx, ['POST'], body => ({ ok: true, dataset: datasetBrief(freezeContractJob(ctx.db, ctx.params.id, body)) })),
  'research.contractJobExport': ctx => handle(ctx, ['GET'], () => {
    const bytes = gzipSync(JSON.stringify(exportJob(ctx.db, ctx.params.id)));
    ctx.res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${ctx.params.id}-evidence.json.gz"`, 'Cache-Control': 'no-store' });
    ctx.res.end(bytes);
  }),
  'research.context': ctx => handle(ctx, ['GET'], () => ({ ...researchMemory(ctx.db), tools: TOOLS.map(t => ({ name:t.name, label:t.label, description:t.description, parameters:t.parameters })), coverage: 'Tool catalog only. Provider availability, coverage and as-of are checked on retrieval; no live feeds are prefetched here.' })),
  'research.notebooks': ctx => handle(ctx, ['GET', 'POST'], body => ctx.req.method === 'POST' ? { ok: true, notebook: saveNotebook(ctx.db, body) } : { ok: true, items: listNotebooks(ctx.db, new URL(ctx.req.url, 'http://localhost').searchParams.get('q'), new URL(ctx.req.url, 'http://localhost').searchParams.get('status')) }),
  'research.notebookExport': ctx=>handle(ctx,['GET'],()=>{
    const raw=new URL(ctx.req.url,'http://localhost').searchParams.get('revision');
    if(raw!==null&&!/^[1-9][0-9]*$/.test(raw))return fail(400,'Choose a positive notebook revision.');
    const out=exportNotebook(ctx.db,ctx.params.id,raw===null?undefined:Number(raw));
    ctx.res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${out.notebookId}-r${out.revision}.zip"`,'Cache-Control':'no-store'});ctx.res.end(out.bytes);
  }),
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
    const checked = cleanSpec(dataset ? { source: 'dataset', datasetId: dataset.id, rules: body.rules, relationship: body.relationship ?? body.spec?.relationship } : body.spec);
    if (!checked.ok) return fail(400, checked.error);
    running = true;
    try {
      const result = await runSpec(ctx.db, checked.spec, { fresh: true, ...(dataset ? { sourceFn: async () => datasetSource(dataset) } : {}) });
      if (!result.runId) return fail(400, result.error || 'No frozen run was produced.');
      return { ok: true, experiment: brief(saveExperiment(ctx.db, { runId: result.runId, title: body.title, hypothesis: body.hypothesis || '', parentId: body.parentId || null })) };
    } finally { running = false; }
  })
};
