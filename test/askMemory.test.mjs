import {getAnalysis,listAnalyses} from '../server/domain/research-analysis.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {cleanAsk,makeLimiter} from '../shared/ask.mjs';
import {answerIdentity} from '../shared/answerCache.mjs';
import {saveNotebook} from '../server/domain/notebooks.mjs';
import {approveMemory,createMemorySnapshot} from '../server/domain/research-context.mjs';
import {makeAskHandler} from '../server/routes/ask.mjs';
const note=title=>({title,hypothesis:'Fixture',conclusion:title,decision:'Reviewed limitation',status:'rejected',tags:[],evidence:[],followups:[]});
const env={ASK_PROVIDER:'openrouter',OPENROUTER_API_KEY:'test-only',ASK_MONTHLY_BUDGET_USD:'0'};
function request(body){const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.headers={};req.socket={remoteAddress:'local'};return req;}
function response(){return {chunks:[],writableEnded:false,destroyed:false,on(){},writeHead(){},write(x){this.chunks.push(x);return true;},end(){this.writableEnded=true;},events(){return this.chunks.join('').split('\n\n').filter(Boolean).map(x=>JSON.parse(x.replace(/^data: /,'')));}};}
function fixture(){
 const db=new DatabaseSync(':memory:');
 const allowed=saveNotebook(db,note('APPROVED_ONLY')),hidden=saveNotebook(db,note('NEVER_INCLUDE'));
 const approval=approveMemory(db,{notebookId:allowed.id,revision:1,action:'approve',reason:'Reviewed'});
 const snapshot=createMemorySnapshot(db,{mode:'context-aware',knownAt:new Date().toISOString(),approvalIds:[approval.id]});
 return {db,allowed,hidden,approval,snapshot};
}
test('controlled memory validates fresh analysis and isolates answer identity',()=>{
 const memory={mode:'isolated'},base={question:'Summarize findings',memory};
 assert.equal(cleanAsk(base).ok,true);
 for(const extra of [{history:[{role:'assistant',content:'Old findings'}]},{attached:{}},{context:{node:'ticker:AAPL'}},{prior:{}},{priors:[{}]}]) assert.equal(cleanAsk({...base,...extra}).ok,false);
 for(const invalid of [{mode:'unknown'},{mode:'context-aware'},{mode:'isolated',snapshotId:'mem_fake'}]) assert.equal(cleanAsk({...base,memory:invalid}).ok,false);
 assert.notEqual(answerIdentity(base),answerIdentity({...base,memory:null}));
 assert.notEqual(answerIdentity({...base,memory:{mode:'context-aware',snapshotId:'one'}}),answerIdentity({...base,memory:{mode:'context-aware',snapshotId:'two'}}));
});
test('isolated model cannot retrieve saved research even when it invents a memory tool call',async()=>{
 const {db}=fixture();try{
 let executions=0;const seen=[];
 const handler=makeAskHandler({env,limiter:makeLimiter({max:99,windowMs:1000}),log(){},execute:async()=>{executions++;throw Error('Should not execute');},makeProvider:cfg=>{
 let round=0;return {name:'openrouter',model:cfg.model,async *chat(messages,tools){seen.push(JSON.stringify(messages));assert.equal(tools.some(t=>t.name==='research_memory'),false);
 if(round++===0)yield {type:'tool_call',id:'invented',name:'research_memory',args:{}};
 else yield {type:'text',delta:'Saved research is unavailable.'};yield {type:'usage',input:10,output:10};}};
 }});
 const res=response();await handler({req:request({question:'Explain the prior research limitations',memory:{mode:'isolated'}}),res,db});
 assert.equal(executions,0);assert.ok(seen.length);assert.ok(seen.every(s=>!s.includes('APPROVED_ONLY')&&!s.includes('NEVER_INCLUDE')));
 const done=res.events().findLast(e=>e.type==='done');assert.equal(done.memory.mode,'isolated');assert.match(done.memory.snapshotId,/^mem_/);
 const saved=getAnalysis(db,done.analysisId);assert.equal(saved.status,'completed');
 assert.ok(saved.events.some(e=>e.kind==='model_input'));assert.ok(saved.events.some(e=>e.kind==='model_output'));
 assert.ok(!JSON.stringify(saved).includes('NEVER_INCLUDE'));assert.ok(!JSON.stringify(saved).includes('test-only'));
 assert.equal(saved.events[0].data.memory.snapshotId,done.memory.snapshotId);
 assert.equal(listAnalyses(db)[0].id,done.analysisId);
 }finally{db.close();}
});
test('context-aware requests preload only approved revisions, refuse broader retrieval and recheck revocation before reuse',async()=>{
 const {db,hidden,allowed,approval,snapshot}=fixture();try{
 let executions=0,models=0;const seen=[];
 const handler=makeAskHandler({env,limiter:makeLimiter({max:99,windowMs:1000}),log(){},execute:async()=>{executions++;return {ok:true,secret:'NEVER_INCLUDE'};},makeProvider:cfg=>{
 models++;let round=0;return {name:'openrouter',model:cfg.model,async *chat(messages){seen.push(JSON.stringify(messages));
 if(round++===0)yield {type:'tool_call',id:'outside',name:'research_memory',args:{kind:'notebook',id:hidden.id}};
 else yield {type:'text',delta:'The approved finding records a limitation [t1].'};yield {type:'usage',input:10,output:10};}};
 }});
 const body={question:'Explain the prior research limitations',memory:{mode:'context-aware',snapshotId:snapshot.id}};
 const res=response();await handler({req:request(body),res,db});
 assert.equal(executions,0);assert.ok(seen[0].includes('APPROVED_ONLY'));assert.ok(seen.every(s=>!s.includes('NEVER_INCLUDE')));
 assert.ok(seen.some(s=>s.includes('outside the selected memory snapshot')));
 assert.equal(res.events().findLast(e=>e.type==='done').memory.contentHash,snapshot.contentHash);
 const saved=getAnalysis(db,res.events().findLast(e=>e.type==='done').analysisId);
 assert.ok(saved.events.some(e=>e.kind==='tool_output'&&JSON.stringify(e.data).includes('APPROVED_ONLY')));
 assert.ok(saved.events.some(e=>e.kind==='model_input'&&JSON.stringify(e.data).includes('APPROVED_ONLY')));
 assert.ok(!JSON.stringify(saved).includes('NEVER_INCLUDE'));
 const before=models;
 approveMemory(db,{notebookId:allowed.id,revision:approval.revision,action:'revoke',reason:'Review required'});
 const refused=await handler({req:request(body),res:response(),db});assert.equal(refused.status,400);assert.match(refused.body.error,/revoked/);assert.equal(models,before);
 }finally{db.close();}
});
test('controlled requests preserve provider failures and execute anew instead of replaying cached answers',async()=>{
 const {db,snapshot}=fixture();try{
  let calls=0;
  const handler=makeAskHandler({env,limiter:makeLimiter({max:99,windowMs:1000}),log(){},makeProvider:cfg=>({name:'openrouter',model:cfg.model,async *chat(){calls++;yield {type:'text',delta:'Fixture answer'};yield {type:'usage',input:10,output:10};}})});
  const body={question:'Explain the prior research limitations',memory:{mode:'context-aware',snapshotId:snapshot.id}};
  const a=response(),b=response();await handler({req:request(body),res:a,db});const first=calls;
  await handler({req:request(body),res:b,db});assert.ok(calls>first);
  const aid=a.events().findLast(e=>e.type==='done').analysisId,bid=b.events().findLast(e=>e.type==='done').analysisId;
  assert.notEqual(aid,bid);assert.equal(getAnalysis(db,bid).status,'completed');
  const fail=makeAskHandler({env,log(){},makeProvider:cfg=>({name:'openrouter',model:cfg.model,async *chat(){throw Error('Fixture provider failure');}})});
  await fail({req:request(body),res:response(),db});
  const failed=listAnalyses(db)[0];assert.equal(failed.status,'failed');
  assert.ok(getAnalysis(db,failed.id).events.some(e=>e.kind==='model_output'&&e.data.error==='Fixture provider failure'));
 }finally{db.close();}
});
