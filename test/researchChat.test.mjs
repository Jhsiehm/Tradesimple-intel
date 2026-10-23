import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanResearchStudies, studyReceipt, mergeResearchStudies, latestStudyId} from '../shared/researchChat.mjs';
import {cleanAsk} from '../shared/ask.mjs';
import {answerIdentity} from '../shared/answerCache.mjs';
import {blankTurn, normalizeChats, saveChats, loadChats} from '../src/ask/chats.ts';
const id = 'inv_' + 'a'.repeat(32);
const receipt = () => studyReceipt({ok:true, investigation:{id,revision:1,status:'draft',protocol:{title:'A study',question:'Original question',unresolved:['Prices missing']},sourceRefs:[],notice:'Descriptive only'}});
test('blocked causal cards retain the requested family without claiming descriptive execution', () => {
 const card=studyReceipt({ok:true,investigation:{id,revision:1,status:'blocked',protocol:{family:'causal',title:'Causal plan'}}});
 assert.equal(card.executed,false);
 assert.match(card.claim,/Requested causal design/);
 assert.match(card.claim,/cannot establish/);
});
test('study receipts retain missing evidence, bound contents, and never accept injected links or IDs', () => {
 const card=receipt(); assert.equal(card.id,id); assert.deepEqual(card.gaps,['Prices missing']); assert.equal(card.executed,false);
 assert.equal(studyReceipt({ok:false,investigation:{id,revision:1}}),null);
 assert.deepEqual(cleanResearchStudies([{...card,id:'../../evil'}]),[]);
 const clean=cleanResearchStudies([{...card,downloads:{json:'javascript:alert(1)'},evidence:{bars:[1],text:'x'.repeat(4000)}}])[0];
 assert.equal(clean.downloads,undefined); assert.equal(clean.evidence.bars,undefined); assert.equal(clean.evidence.text.length,2000);
});
test('new receipts replace the same study and retain amendment lineage', () => {
 const child={...receipt(),id:'inv_'+'b'.repeat(32),parentId:id};
 const cards=mergeResearchStudies([receipt()],[{...receipt(),revision:2,status:'completed'},child]);
 assert.equal(cards.length,2); assert.equal(cards[0].revision,2); assert.equal(cards[1].parentId,id);
 assert.equal(latestStudyId([{studies:cards},{text:'An unrelated answer'}]),child.id);
});
test('study identity survives browser saving without relying on answer text', () => {
 const cache = new Map(); globalThis.localStorage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)};
 try {
  const turn=blankTurn('Question',{studies:[receipt()],phase:'done',text:'No identifier in this prose'});
  assert.equal(saveChats([{id:'chat',title:'Question',turns:[turn],updated:'2026-10-23'}]),true);
  assert.equal(latestStudyId(loadChats()[0].turns),id);
  assert.equal(normalizeChats([{id:'old',turns:[blankTurn('Legacy')]}])[0].turns[0].studies.length,0);
 } finally {delete globalThis.localStorage;}
});
test('request context validates IDs, isolates memory, and partitions answer caches', () => {
 assert.equal(cleanAsk({question:'Explain this',studyId:id}).studyId,id);
 assert.equal(cleanAsk({question:'Explain this',studyId:'bad'}).studyId,null);
 assert.equal(cleanAsk({question:'Explain',studyId:id,memory:{mode:'isolated'}}).ok,false);
 assert.notEqual(answerIdentity({question:'Explain',studyId:id}),answerIdentity({question:'Explain'}));
});

test('reopened interrupted conversations keep study controls and explain recovery', () => {
 const chats=normalizeChats([{id:'interrupted',turns:[blankTurn('Run',{phase:'computing',studies:[receipt()]})]}]);
 assert.equal(chats[0].turns[0].phase,'error');
 assert.match(chats[0].turns[0].error,/Inspect.*before retrying/);
 assert.equal(latestStudyId(chats[0].turns),id);
});

test('stateful tool batches execute in order while independent reads can overlap', async () => {
 const {runToolJobs}=await import('../server/ai/researchChat.mjs');
 const order=[];
 await runToolJobs([{call:{name:'research_create_investigation'}},{call:{name:'research_run_investigation'}}],async job=>{
  order.push(job.call.name+':start'); await new Promise(r=>setTimeout(r,5)); order.push(job.call.name+':end');
 });
 assert.deepEqual(order,['research_create_investigation:start','research_create_investigation:end','research_run_investigation:start','research_run_investigation:end']);
});

test('a later backtest owns its follow-up rather than an older attached investigation', () => {
 assert.equal(latestStudyId([{studies:[receipt()]},{studies:[receipt()],done:{backtests:[{ok:true}]}}]),null);
});

test('cancellation stops later queued research mutations', async () => {
 const {runToolJobs}=await import('../server/ai/researchChat.mjs');
 const controller=new AbortController(); let calls=0;
 await assert.rejects(runToolJobs([{call:{name:'research_create_investigation'}},{call:{name:'research_amend_investigation'}}],async()=>{
  calls++; controller.abort();
 },controller.signal),/abort/i);
 assert.equal(calls,1);
});

test('a study plan is not replaced by an unrelated audit fallback', async () => {
 const {guardedStudyReport}=await import('../server/ai/answerChecks.mjs');
 assert.equal(guardedStudyReport('Plan text',[],()=>({grounding:{unmatched:['bad']}}),'Create a descriptive study plan. Plan only.'),null);
});

test('workflow model projection preserves scalar summary results through normal evidence trimming', async () => {
 const {projectWorkflowForModel}=await import('../server/ai/researchChat.mjs');
 const {trimForModel}=await import('../shared/ask.mjs');
 const protocol={title:'Selected obligations',question:'Describe the saved selected sample',family:'descriptive',assumptions:['Selected sample, not all contracts'],unresolved:[],nodes:[{id:'source',op:'source',snapshotId:'obs_'+'b'.repeat(32),mode:'first-publication'},{id:'summary',op:'summarize',input:'source',value:'value',groupBy:[]}],outputs:['summary']};
 const raw={ok:true,source:'Saved research investigation',downloads:{json:'/export'},investigation:{id,revision:3,status:'completed',executed:true,protocol,sourceRefs:[{snapshotId:'obs_'+'b'.repeat(32),contentHash:'sourcehash'}],notice:'Descriptive only',evaluation:{resultHash:'result-hash'},result:{gaps:[],limitations:['Selected sample only'],outputs:{summary:{rowCount:1,preview:[{n:9,sum:24469369.76,mean:2718818.862222222,min:104399.04,max:16504860,lineagePreview:Array.from({length:5},()=>({nested:{noise:'x'.repeat(1000)}}))}]}},steps:Array.from({length:20},()=>({ledger:{decisions:Array.from({length:20},()=>({reason:'Verbose diagnostics '.repeat(20)}))}}))}}};
 const before=JSON.stringify(raw);
 const projected=projectWorkflowForModel(raw);
 assert.deepEqual(projected.protocol,protocol);
 const model=trimForModel(projected);
 assert.equal(model.outputRows[0].n,9);
 assert.equal(model.outputRows[0].sum,24469369.76);
 assert.equal(model.outputs[0].rowCount,1);
 assert.deepEqual(model.protocol,protocol);
 assert.equal(model.evaluation.resultHash,'result-hash');
 assert.equal(model.lineage.sourceRefs[0].contentHash,'sourcehash');
 assert.equal(JSON.stringify(raw),before);
 assert.equal(model.outputRows[0].lineagePreview,undefined);
});

test('workflow model projection retains complete amendment protocol and passes other tool records unchanged', async () => {
 const {projectWorkflowForModel}=await import('../server/ai/researchChat.mjs');
 const other={ok:true,investigation:{id:'policy_'+'a'.repeat(32)}};
 assert.equal(projectWorkflowForModel(other),other);
 const protocol={question:'x'.repeat(700),nodes:Array.from({length:12},(_,i)=>({id:'node'+i,op:'source'}))};
 const raw={ok:true,investigation:{id,protocol,parentId:'inv_'+'b'.repeat(32),parentRevision:3,amendment:'Change threshold',sourceIssues:['Missing source'],result:null}};
 const view=projectWorkflowForModel(raw);
 assert.deepEqual(view.protocol,protocol);
 assert.equal(view.lineage.parentRevision,3);
 assert.deepEqual(view.gaps,['Missing source']);
 assert.deepEqual(view.outputRows,[]);
});

test('workflow model wrapper preserves long assumptions and declines oversized amendment protocols explicitly', async () => {
 const {workflowModelResult}=await import('../server/ai/researchChat.mjs');
 const assumptions=['Historical availability is not established. '.repeat(30)];
 const raw={ok:true,investigation:{id,protocol:{assumptions,nodes:Array.from({length:12},(_,i)=>({id:'node'+i,op:'source'}))},result:{outputs:{summary:{rowCount:1,preview:[{n:9,sum:24469369.76}]}},limitations:[]}}};
 const model=workflowModelResult(raw);
 assert.equal(model.protocolComplete,true);
 assert.deepEqual(model.protocol.assumptions,assumptions);
 assert.equal(model.protocol.nodes.length,12);
 assert.equal(model.outputRows[0].sum,24469369.76);
 const large=workflowModelResult({...raw,investigation:{...raw.investigation,protocol:{assumptions:['x'.repeat(24001)]}}});
 assert.equal(large.protocolComplete,false);
 assert.equal(large.protocol,null);
 assert.match(large.protocolLifecycle,/Do not create an amendment/);
 assert.equal(workflowModelResult({ok:true,items:[]}),null);
});
