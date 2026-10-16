import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {saveNotebook} from '../server/domain/notebooks.mjs';
import {approveMemory,createMemorySnapshot,getMemorySnapshot} from '../server/domain/research-context.mjs';
import {prepareAskMemory} from '../server/ai/researchContext.mjs';
import {startAnalysis} from '../server/domain/research-analysis.mjs';
import {createPairProtocol,getPairProtocol,listPairProtocols} from '../server/domain/research-pairs.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');
 const n=saveNotebook(db,{title:'Memory fixture',hypothesis:'Test',conclusion:'Rejected',decision:'Missing evidence',status:'rejected',tags:[],evidence:[],followups:[]});
 const approval=approveMemory(db,{notebookId:n.id,revision:1,action:'approve',reason:'Review'});
 const context=createMemorySnapshot(db,{mode:'context-aware',knownAt:new Date().toISOString(),approvalIds:[approval.id]});
 const memory=prepareAskMemory(db,{mode:'isolated'}),analysis=startAnalysis(db,{request:{question:'Evidence fixture'},memory,provider:'openai',model:'fixture'});
 analysis.append('tool_output',{name:'market_snapshot',args:{},result:{ok:true,source:'Synthetic fixture',rows:[{symbol:'FIXTURE',value:5}]}});
 analysis.append('tool_output',{name:'web_search',args:{query:'fixture'},result:{ok:false,error:'Unavailable'}});
 analysis.finish('completed');
 const body={question:'Explain the evidence limitations',hypothesis:'Approved findings add limitations',evaluation:'Count evidence-backed limitations and unsupported claims',provider:'openai',model:'fixture',style:'professional',snapshotId:context.id,evidenceAnalysisId:analysis.id,evidenceSequences:[1]};
 return {db,n,context,body};
}
test('paired protocol locks common conditions, exact evidence and empty isolated context',()=>{
 const {db,body,context}=fixture();try{
  const p=createPairProtocol(db,body);
  assert.deepEqual(getPairProtocol(db,p.id),p);
  assert.equal(p.conditions.contextHash,context.contentHash);
  const isolated=getMemorySnapshot(db,p.isolatedSnapshotId);
  assert.equal(isolated.knownAt,context.knownAt);assert.deepEqual(isolated.records,[]);
  assert.equal(p.conditions.externalAccess,'frozen-only');assert.equal(p.conditions.evidence.length,1);
  assert.equal(p.conditions.evidence[0].result.rows[0].value,5);
  assert.equal(listPairProtocols(db)[0].id,p.id);
  body.question='Changed';assert.notEqual(getPairProtocol(db,p.id).conditions.question,body.question);
  assert.throws(()=>db.exec('DELETE FROM research.pair_protocols'),/immutable/);
  assert.throws(()=>db.prepare('UPDATE research.pair_protocols SET body=?').run('{}'),/immutable/);
 }finally{db.close();}
});
test('paired registration rejects invalid or future evidence and revoked memory',()=>{
 const {db,n,body,context}=fixture();try{
  for(const patch of [{question:''},{hypothesis:''},{evaluation:''},{model:'auto'},{provider:'bogus'},{style:'bogus'},{evidenceSequences:[]},{evidenceSequences:[1,1]},{evidenceSequences:[0]},{evidenceSequences:[2]},{evidenceSequences:[99]}]) assert.throws(()=>createPairProtocol(db,{...body,...patch}));
  assert.throws(()=>createPairProtocol(db,body,{now:'2000-01-01T00:00:00Z'}),/before/);
  const memory={mode:context.mode,snapshotId:context.id,contentHash:context.contentHash,knownAt:context.knownAt};
  const aware=startAnalysis(db,{request:{question:'Memory-informed'},memory,provider:'openai',model:'fixture'});aware.append('tool_output',{name:'research_memory',args:{},result:{ok:true}});aware.finish('completed');
  assert.throws(()=>createPairProtocol(db,{...body,evidenceAnalysisId:aware.id}),/isolated/);
  approveMemory(db,{notebookId:n.id,revision:1,action:'revoke',reason:'Review again'});
  assert.throws(()=>createPairProtocol(db,body),/revoked/);
 }finally{db.close();}
});
