import { auditSignals, INTEGRITY_VERSION } from '../server/domain/research-integrity.mjs';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb, writeCache } from '../server/lib/db.mjs';
import { KEY } from '../server/lib/cacheKeys.mjs';
import { router } from '../server/routes/index.mjs';
import { dayOf } from '../shared/backtest.mjs';
let db, server, base, datasetId, experiment;
const body = { name: 'HTTP fixture', source: 'Synthetic test', content: 'id,symbol,eventAt,availableAt,side\nr1,AAPL,2025-01-02,2025-01-06,buy', format: 'csv' };
before(async () => {
  const prior = process.env.INTEL_CACHE; process.env.INTEL_CACHE = ':memory:';
  db = openDb(decodeURIComponent(new URL('..', import.meta.url).pathname));
  if (prior === undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE = prior;
  const routes = router(); server = http.createServer((req, res) => routes.handle(req, res, { db }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
async function call(method, path, payload, origin = 'http://127.0.0.1:5173') {
  const res = await fetch(base + path, { method, headers: { origin, 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  return { status: res.status, body: await res.json() };
}
test('research routes enforce methods, same-origin writes, and atomic validation', async () => {
  assert.equal((await call('POST', '/api/research/datasets', body, 'https://evil.example')).status, 403);
  assert.equal((await call('GET', '/api/research/preview')).status, 405);
  assert.equal((await call('DELETE', '/api/research/experiments')).status, 405);
  assert.equal((await call('POST', '/api/research/datasets', { ...body, content: body.content.replace('2025-01-06', '') })).status, 422);
  assert.equal((await call('GET', '/api/research/datasets')).body.items.length, 0);
  const preview = await call('POST', '/api/research/preview', body);
  assert.equal(preview.body.ok, true); assert.equal(preview.body.coverage.valid, 1);
  assert.equal((await call('GET', '/api/research/datasets')).body.items.length, 0, 'preview is not a commit');
  const imported = await call('POST', '/api/research/datasets', body);
  assert.equal(imported.status, 200); datasetId = imported.body.dataset.id;
  assert.equal(imported.body.dataset.rawContent, undefined, 'raw import is not repeated in list/detail response');
  assert.equal((await call('GET', `/api/research/datasets/${datasetId}`)).body.dataset.coverage.received, 1);
});
test('imported dataset runs through the existing engine, saves, replays and exports over HTTP', async () => {
  const bars = Array.from({ length: 90 }, (_, i) => [dayOf('2025-01-01') + i, 100 + i, 101 + i]);
  writeCache(db, KEY.bars('AAPL'), bars, 100000); writeCache(db, KEY.bars('SPY'), bars.map(b => [b[0], 100, 100]), 100000);
  const out = await call('POST', '/api/research/run', { title: 'Synthetic HTTP experiment', hypothesis: 'Fixture only', datasetId, rules: { holdDays: 10 } });
  assert.equal(out.status, 200); experiment = out.body.experiment;
  assert.equal(experiment.run.result.spec.source, 'dataset'); assert.equal(experiment.run.result.spec.datasetId, datasetId);
  assert.equal(experiment.run.result.ok, true); assert.equal(experiment.run.result.trades[0].signal, '2025-01-06');
  assert.equal(experiment.run.provenance.dataset.id, datasetId); assert.equal(experiment.run.inputs, undefined);
  assert.equal((await call('POST', `/api/research/runs/${experiment.runId}/replay`, {})).body.matches, true);
  assert.equal((await call('GET', '/api/research/experiments')).body.items.length, 1);
  const zip = await fetch(`${base}/api/research/runs/${experiment.runId}/export`);
  assert.equal(zip.status, 200); assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), 'PK');
});
test('fresh-data reruns link to a parent and preserve failure details', async () => {
  db.prepare('DELETE FROM cache').run();
  // A missing dataset never executes or creates an experiment.
  assert.equal((await call('POST', '/api/research/run', { title: 'No dataset', datasetId: 'ds_0000' })).status, 404);
  assert.equal((await call('POST', '/api/research/experiments', { title: 'Not found', runId: 'run_0000' })).status, 400);
  assert.equal((await call('POST', `/api/research/runs/${experiment.runId}/replay`, {})).body.matches, true);
  assert.equal((await call('GET', `/api/research/experiments/${experiment.id}`)).body.experiment.hypothesis, 'Fixture only');
});
test('convergence HTTP lifecycle locks development, evaluates once, replays and enforces origin', async () => {
  const { putRun, saveExperiment } = await import('../server/domain/research-store.mjs');
  const { ENGINE } = await import('../server/domain/research-replay.mjs');
  const bars = Array.from({ length: 181 }, (_, i) => [dayOf('2025-01-01') + i, 100 + i, 101 + i]);
  const experimentIds = ['congress', 'form4'].map((source, i) => {
    const signals = ['2025-01-06', '2025-04-06'].map((d, n) => ({ id: `${i}-${n}`, symbol: 'AAPL', signalDate: d, tradeDate: d, side: 'buy' }));
    return saveExperiment(db, { title: `HTTP ${source}`, runId: putRun(db, { engine: ENGINE, inputs: { signals, bars: { AAPL: bars }, benchBars: { SPY: bars } }, result: { ok: true, integrityVersion: INTEGRITY_VERSION, spec: { source, filters: {} } }, provenance: { matchedSignals: signals, integrity: auditSignals(signals, { source }).report } }) }).id;
  });
  const request = { title: 'HTTP convergence', experimentIds, spec: { from: '2025-01-01', split: '2025-04-01', to: '2025-06-30', universe: 'AAPL', rules: { holdDays: 10 } } };
  assert.equal((await call('POST', '/api/research/convergence', request, 'https://evil.example')).status, 403);
  const saved = await call('POST', '/api/research/convergence', request); assert.equal(saved.status, 200);
  const p = saved.body.plan; assert.equal(p.report.periods.holdout, undefined); assert.equal(p.inputs, undefined);
  assert.equal((await call('GET', `/api/research/convergence/${p.id}`)).body.plan.runId, p.runId);
  const evaluated = await call('POST', `/api/research/convergence/${p.id}/evaluate`, {});
  assert.ok(evaluated.body.plan.report.periods.holdout);
  assert.equal((await call('POST', `/api/research/convergence/${p.id}/evaluate`, {})).body.plan.runId, evaluated.body.plan.runId);
  assert.equal((await call('POST', `/api/research/runs/${evaluated.body.plan.runId}/replay`, {})).body.matches, true);
});
test('notebook HTTP API enforces origins, methods, revision checks and search', async () => {
  const draft = { title: 'HTTP notebook', hypothesis: 'Fixture', status: 'draft', tags: ['AAPL'], evidence: [], followups: [] };
  assert.equal((await call('POST', '/api/research/notebooks', draft, 'https://evil.example')).status, 403);
  assert.equal((await call('DELETE', '/api/research/notebooks')).status, 405);
  const a = await call('POST', '/api/research/notebooks', draft); assert.equal(a.status, 200);
  const n = a.body.notebook;
  assert.equal((await call('GET', `/api/research/notebooks/${n.id}`)).body.history.length, 1);
  assert.equal((await call('POST', `/api/research/notebooks/${n.id}`, { ...n, baseRevision: 0 })).status, 400);
  const b = await call('POST', `/api/research/notebooks/${n.id}`, { ...n, baseRevision: 1, conclusion: 'No evidence', decision: 'Need data', status: 'needs-data' }); assert.equal(b.body.notebook.revision, 2);
  assert.equal((await call('GET', '/api/research/notebooks?q=AAPL&status=needs-data')).body.items.length, 1);
  assert.equal((await call('GET', '/api/research/notebooks?q=unmatched')).body.items.length, 0);
});
test('research home exposes the real tool catalog and memory obeys sourcing boundaries', async () => {
  const { runTool, toolDefs } = await import('../server/ai/tools.mjs');
  const catalog = await call('GET', '/api/research/context');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.tools.some(t => t.name === 'research_memory'));
  assert.ok(catalog.body.tools.some(t => t.name === 'weather_hazards'));
  assert.match(catalog.body.coverage, /no live feeds are prefetched/);
  assert.equal((await runTool(db, 'research_memory', {}, undefined, null, 'web')).ok, false);
  const memory = await runTool(db, 'research_memory', {}, undefined, null, 'platform');
  assert.equal(memory.ok, true); assert.ok(memory.experiments.length);
  const detail = await runTool(db, 'research_memory', { kind: 'experiment', id: experiment.id });
  assert.equal(detail.record.runId, experiment.runId); assert.equal(detail.record.inputs, undefined);
  assert.ok(toolDefs('platform').some(t => t.name === 'research_memory'));
});
test('relationship snapshot API imports, resolves historical knowledge and enforces write origin',async()=>{
 const row={id:'assertion1',relationshipId:'owns1',subject:'company:example',predicate:'owns',object:'facility:one',effectiveFrom:'2020-01-01',availableAt:'2020-01-03',sourceUrl:'https://example.org/filing'};
 const body={name:'HTTP relationship fixture',rows:[row]};
 assert.equal((await call('POST','/api/research/relationships',body,'https://evil.example')).status,403);
 const saved=await call('POST','/api/research/relationships',body);
 assert.equal(saved.status,200);const id=saved.body.snapshot.id;
 assert.equal((await call('GET',`/api/research/relationships/${id}`)).body.snapshot.rows.length,1);
 assert.ok((await call('GET','/api/research/relationships')).body.items.some(x=>x.id===id));
 const query=await call('POST',`/api/research/relationships/${id}/query`,{effectiveAt:'2020-01-05',knownAt:'2020-01-02'});
 assert.equal(query.status,200);assert.equal(query.body.result.items.length,0);
 assert.equal((await call('POST',`/api/research/relationships/${id}/query`,{effectiveAt:'2020-01-05',knownAt:'2020-01-04'})).body.result.items.length,1);
});
test('memory context HTTP boundary requires explicit revision approval and rejects cross-site writes',async()=>{
 const notebook=(await call('POST','/api/research/notebooks',{title:'HTTP memory fixture',hypothesis:'test',conclusion:'Rejected',decision:'Insufficient evidence',status:'rejected',tags:[],evidence:[],followups:[]})).body.notebook;
 const request={notebookId:notebook.id,revision:1,action:'approve',reason:'Owner review'};
 assert.equal((await call('POST','/api/research/memory/approvals',request,'https://evil.example')).status,403);
 const approved=await call('POST','/api/research/memory/approvals',request);assert.equal(approved.status,200);
 const snapshot=await call('POST','/api/research/memory/snapshots',{mode:'context-aware',knownAt:new Date().toISOString(),approvalIds:[approved.body.approval.id]});
 assert.equal(snapshot.status,200);assert.equal(snapshot.body.snapshot.records[0].notebook.id,notebook.id);
 assert.equal((await call('GET',`/api/research/memory/snapshots/${snapshot.body.snapshot.id}`)).body.snapshot.contentHash,snapshot.body.snapshot.contentHash);
 assert.equal((await call('POST','/api/research/memory/snapshots',{mode:'isolated',knownAt:new Date().toISOString(),approvalIds:[approved.body.approval.id]})).status,400);
});
test('saved analysis HTTP views retain execution evidence and reject mutations',async()=>{
 const {prepareAskMemory}=await import('../server/ai/researchContext.mjs');
 const {startAnalysis}=await import('../server/domain/research-analysis.mjs');
 const memory=prepareAskMemory(db,{mode:'isolated'});
 const journal=startAnalysis(db,{request:{question:'HTTP execution fixture'},memory,provider:'fixture',model:'fixture'});
 journal.append('model_input',{messages:[{role:'user',content:'HTTP execution fixture'}]});journal.finish('completed');
 const detail=await call('GET',`/api/research/analyses/${journal.id}`);
 assert.equal(detail.status,200);assert.equal(detail.body.analysis.status,'completed');assert.equal(detail.body.analysis.events.length,3);
 assert.ok((await call('GET','/api/research/analyses')).body.items.some(x=>x.id===journal.id));
 assert.equal((await call('POST',`/api/research/analyses/${journal.id}`,{})).status,405);
});
test('paired protocol API registers immutable conditions without executing a provider',async()=>{
 const {prepareAskMemory}=await import('../server/ai/researchContext.mjs');
 const {startAnalysis}=await import('../server/domain/research-analysis.mjs');
 const n=(await call('POST','/api/research/notebooks',{title:'Paired HTTP fixture',hypothesis:'test',conclusion:'Rejected',decision:'Need evidence',status:'rejected',tags:[],evidence:[],followups:[]})).body.notebook;
 const approval=(await call('POST','/api/research/memory/approvals',{notebookId:n.id,revision:1,action:'approve',reason:'Reviewed'})).body.approval;
 const context=(await call('POST','/api/research/memory/snapshots',{mode:'context-aware',knownAt:new Date().toISOString(),approvalIds:[approval.id]})).body.snapshot;
 const memory=prepareAskMemory(db,{mode:'isolated'});
 const a=startAnalysis(db,{request:{question:'Fixture evidence'},memory,provider:'openai',model:'fixture'});
 a.append('tool_output',{name:'market_snapshot',args:{},result:{ok:true,source:'Fixture',rows:[]}});a.finish('completed');
 const body={question:'Compare the research caveats',hypothesis:'Memory supplies caveats',evaluation:'Grounded caveat count',provider:'openai',model:'fixture',style:'professional',snapshotId:context.id,evidenceAnalysisId:a.id,evidenceSequences:[1]};
 assert.equal((await call('POST','/api/research/pairs',body,'https://evil.example')).status,403);
 const saved=await call('POST','/api/research/pairs',body);assert.equal(saved.status,200);
 const p=saved.body.protocol;
 assert.equal((await call('GET',`/api/research/pairs/${p.id}`)).body.protocol.conditionsHash,p.conditionsHash);
 assert.ok((await call('GET','/api/research/pairs')).body.items.some(x=>x.id===p.id));
 assert.equal((await call('POST',`/api/research/pairs/${p.id}`,body)).status,405);
 assert.equal((await call('GET',`/api/research/pairs/${p.id}/run`)).body.execution,null);
 assert.equal((await call('POST',`/api/research/pairs/${p.id}/run`,{},'https://evil.example')).status,403);
 const {executePair}=await import('../server/ai/pairedResearch.mjs');
 await executePair(db,p.id,{env:{ASK_PROVIDER:'openai',OPENAI_API_KEY:'fixture',ASK_MODEL:'fixture',ASK_STRONG_MODEL:'fixture',ASK_MONTHLY_BUDGET_USD:'0'},makeProvider:cfg=>({name:'openai',model:cfg.model,async *chat(){yield {type:'text',delta:'Fixture evidence [E1].'};}})});
 const assessment={criteriaAssessment:'Names the evidence reference',strengths:'Uses a source reference',limitations:'Synthetic test only'};
 const review={baseRevision:0,verdict:'tie',rationale:'Same answers',reviewReason:'HTTP test',assessments:{isolated:assessment,'context-aware':assessment},excerpts:[]};
 const evaluationPath=`/api/research/pairs/${p.id}/evaluations`;
 assert.equal((await call('POST',evaluationPath,review,'https://evil.example')).status,403);
 const evaluated=await call('POST',evaluationPath,review);assert.equal(evaluated.status,200);assert.equal(evaluated.body.evaluation.revision,1);
 assert.equal((await call('POST',evaluationPath,review)).status,400);
 assert.equal((await call('GET',evaluationPath)).body.items[0].id,evaluated.body.evaluation.id);
 assert.equal((await call('DELETE',evaluationPath)).status,405);
 const archive=await fetch(base+`/api/research/pairs/${p.id}/export`);assert.equal(archive.status,200);assert.match(archive.headers.get('content-type'),/zip/);assert.equal(Buffer.from(await archive.arrayBuffer()).readUInt32LE(0),0x04034b50);

});
test('observation API previews, versions and derives numeric observations into experiment datasets',async()=>{
 const request={name:'HTTP observation',source:'Synthetic fixture',ownership:'Local researcher',license:'Test only',format:'json',content:JSON.stringify([{id:'cold',entityId:'facility:one',metric:'temperature',unit:'C',value:-3,eventAt:'2025-01-01',availableAt:'2025-01-02',sourceUrl:'https://example.org/cold'}])};
 assert.equal((await call('POST','/api/research/observations',request,'https://evil.example')).status,403);
 assert.equal((await call('POST','/api/research/observations/preview',request)).body.ok,true);
 const imported=await call('POST','/api/research/observations',request);assert.equal(imported.status,200);
 const id=imported.body.snapshot.id;
 assert.equal((await call('GET',`/api/research/observations/${id}`)).body.snapshot.events[0].value,-3);
 assert.ok((await call('GET','/api/research/observations')).body.items.some(s=>s.id===id));
 const resolved=await call('POST',`/api/research/observations/${id}/resolve`,{knownAt:'2025-01-02'});assert.equal(resolved.body.result.items[0].value,-3);
 assert.equal((await call('GET',`/api/research/observations/${id}/resolve`)).status,405);
 const derived=await call('POST',`/api/research/observations/${id}/derive`,{name:'HTTP cold signals',metric:'temperature',unit:'C',operator:'lt',threshold:0,side:'buy',bindings:{'facility:one':['AAPL']}});
 assert.equal(derived.status,200);assert.equal(derived.body.transformation.selected,1);assert.equal(derived.body.dataset.preview[0].availableAt,'2025-01-02');
 const revision=await call('POST','/api/research/observations',{...request,content:JSON.stringify([{...JSON.parse(request.content)[0],id:'correction',observationId:'cold',value:12,availableAt:'2025-01-05'}])});
 const merged=await call('POST','/api/research/observations/merge',{name:'HTTP merged history',reason:'Join source deliveries',identityNamespace:'HTTP fixture IDs',snapshotIds:[id,revision.body.snapshot.id]});assert.equal(merged.status,200);assert.equal(merged.body.snapshot.composition.unique,2);
 assert.equal((await call('DELETE',`/api/research/observations/${id}`)).status,405);
});


test('stress API registers frozen assumptions, evaluates once and replays the saved report',async()=>{
 const body={title:'HTTP sensitivity plan',hypothesis:'Additional fees reduce fixture returns',experimentId:experiment.id,scenarios:[{id:'fees',label:'Higher fees',extraCostBps:20}]};
 assert.equal((await call('POST','/api/research/stress',body,'https://evil.example')).status,403);
 const created=await call('POST','/api/research/stress',body);assert.equal(created.status,200);assert.equal(created.body.plan.run,null);
 const id=created.body.plan.id;
 const evaluated=await call('POST',`/api/research/stress/${id}/evaluate`,{});assert.equal(evaluated.status,200);const run=evaluated.body.plan.run;
 assert.equal(run.inputs.kind,'stress');assert.equal(run.result.stress.scenarios.length,1);
 assert.equal((await call('POST',`/api/research/stress/${id}/evaluate`,{})).body.plan.run.id,run.id);
 assert.equal((await call('POST',`/api/research/runs/${run.id}/replay`,{})).body.matches,true);
 assert.equal((await call('GET',`/api/research/stress/${id}`)).body.plan.run.id,run.id);
});

test('event studies HTTP lifecycle locks conditions and preserves replay/export',async()=>{
 const body={title:'HTTP event study',hypothesis:'Descriptive synthetic disclosure window',experimentId:experiment.id,spec:{from:'2025-01-01',to:'2025-03-01',before:1,after:2,sides:'both'}};
 assert.equal((await call('POST','/api/research/event-studies',body,'https://evil.example')).status,403);
 const registered=await call('POST','/api/research/event-studies',body);assert.equal(registered.status,200);const p=registered.body.plan;assert.equal(p.run,null);
 assert.equal((await call('GET',`/api/research/event-studies/${p.id}`)).body.plan.sourceRunId,experiment.runId);
 const evaluated=await call('POST',`/api/research/event-studies/${p.id}/evaluate`,{});assert.equal(evaluated.status,200);const run=evaluated.body.plan.run;assert.equal(run.inputs.kind,'event-study');
 assert.ok(run.result.eventStudy.counts.completeEvents>0);
 assert.equal((await call('POST',`/api/research/event-studies/${p.id}/evaluate`,{})).body.plan.run.id,run.id);
 assert.equal((await call('POST',`/api/research/runs/${run.id}/replay`,{})).body.matches,true);
 assert.ok((await call('GET','/api/research/event-studies')).body.items.some(item=>item.id===p.id&&item.evaluated));
 const exported=await fetch(`${base}/api/research/runs/${run.id}/export`);assert.equal(exported.status,200);assert.equal(exported.headers.get('content-type'),'application/zip');
});

test('notebooks pin evaluated study and stress results through revisions and approved memory',async()=>{
 const study=(await call('POST','/api/research/event-studies',{title:'Notebook event evidence',hypothesis:'Descriptive test',experimentId:experiment.id,spec:{from:'2025-01-01',to:'2025-03-01',before:1,after:2,sides:'both'}})).body.plan;
 const stress=(await call('POST','/api/research/stress',{title:'Notebook stress evidence',hypothesis:'Higher cost test',experimentId:experiment.id,scenarios:[{id:'fees',label:'Higher fees',extraCostBps:10}]})).body.plan;
 const body={title:'Study-supported finding',hypothesis:'Synthetic evidence only',conclusion:'No investment conclusion',decision:'Retain limitations for later research',status:'inconclusive',tags:[],followups:[],evidence:[{kind:'event-study',id:study.id,runId:'forged'},{kind:'stress',id:stress.id,runId:'forged'}]};
 assert.equal((await call('POST','/api/research/notebooks',body)).status,400);
 const studyRun=(await call('POST',`/api/research/event-studies/${study.id}/evaluate`,{})).body.plan.run;
 assert.equal((await call('POST','/api/research/notebooks',body)).status,400);
 const stressRun=(await call('POST',`/api/research/stress/${stress.id}/evaluate`,{})).body.plan.run;
 const saved=await call('POST','/api/research/notebooks',body);assert.equal(saved.status,200);const note=saved.body.notebook;
 assert.deepEqual(note.evidence.map(e=>e.runId),[studyRun.id,stressRun.id]);assert.deepEqual(note.evidence.map(e=>e.inputHash),[studyRun.inputHash,stressRun.inputHash]);
 const revised=(await call('POST',`/api/research/notebooks/${note.id}`,{...note,baseRevision:1,conclusion:'Revised interpretation',evidence:note.evidence.map(e=>({...e,runId:experiment.runId,inputHash:'forged'}))})).body.notebook;
 assert.deepEqual(revised.evidence,note.evidence);
 const approval=(await call('POST','/api/research/memory/approvals',{notebookId:note.id,revision:2,action:'approve',reason:'Synthetic reviewed evidence'})).body.approval;
 const frozen=await call('POST','/api/research/memory/snapshots',{mode:'context-aware',knownAt:new Date().toISOString(),approvalIds:[approval.id]});assert.equal(frozen.status,200);assert.deepEqual(frozen.body.snapshot.records[0].notebook.evidence,note.evidence);
 const history=(await call('GET',`/api/research/notebooks/${note.id}`)).body.history;assert.equal(history.length,2);assert.equal(history[1].conclusion,body.conclusion);
 for(const run of [studyRun,stressRun])assert.equal((await call('POST',`/api/research/runs/${run.id}/replay`,{})).body.matches,true);
});
