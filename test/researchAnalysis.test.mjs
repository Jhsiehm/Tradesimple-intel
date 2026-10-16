import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {prepareAskMemory} from '../server/ai/researchContext.mjs';
import {startAnalysis,getAnalysis,verifyAnalysisRows} from '../server/domain/research-analysis.mjs';
import {hashOf} from '../server/domain/research-store.mjs';
test('controlled execution journal preserves incomplete runs, refuses mutation and verifies event order',()=>{
 const db=new DatabaseSync(':memory:');try {
  const memory=prepareAskMemory(db,{mode:'isolated'});
  const a=startAnalysis(db,{memory,request:{question:'Fixture'},provider:'fixture',model:'fixture'});
  a.append('model_input',{messages:[{role:'user',content:'Fixture'}]});
  assert.equal(getAnalysis(db,a.id).status,'incomplete');
  a.append('event',{type:'error',error:'Provider unavailable'});a.finish('failed');
  assert.equal(getAnalysis(db,a.id).status,'failed');
  assert.throws(()=>a.append('event',{}),/finished/);
  assert.throws(()=>db.prepare('UPDATE research.analysis_events SET body=?').run('{}'),/immutable/);
  assert.throws(()=>db.exec('DELETE FROM research.analysis_events'),/immutable/);
  const rows=db.prepare('SELECT body,body_hash FROM research.analysis_events WHERE analysis_id=? ORDER BY sequence').all(a.id);
  assert.throws(()=>verifyAnalysisRows(rows.slice(1)),/chain/);
  const changed=JSON.parse(rows[1].body);changed.previousHash='incorrect';const body=JSON.stringify(changed);
  assert.throws(()=>verifyAnalysisRows([rows[0],{body,body_hash:hashOf(body)},...rows.slice(2)]),/chain/);
  assert.throws(()=>verifyAnalysisRows([{...rows[0],body:'{}'},...rows.slice(1)]),/checksum/);
 }finally{db.close();}
});
