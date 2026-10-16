import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRetrieval,getRetrieval,resumeRetrieval} from '../server/domain/connector-retrievals.mjs';
import {createResearchBackup,verifyResearchBackup,restoreResearchBackup} from '../server/domain/research-backup.mjs';
import {prepareObservations} from '../server/domain/research-observations.mjs';
const pagination={cursorParam:'cursor',nextCursorField:'next',itemsField:'records',maxPages:3};
const env={RESEARCH_API_CONNECTORS:JSON.stringify({fixture:{url:'https://example.org/data',pagination,tokenEnv:'FIXTURE_TOKEN'}}),FIXTURE_TOKEN:'secret-fixture-token'};
const lookup=async()=>[{address:'93.184.216.34',family:4}];
const row=id=>({id,entityId:'facility:test',metric:'temperature',unit:'C',value:1,eventAt:'2025-01-01',availableAt:'2025-01-02',sourceUrl:'https://example.org/evidence'});
test('connector checkpoints survive database restart and resume without refetching prior pages',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-retrieval-')),file=path.join(dir,'cache.sqlite');let db=new DatabaseSync(file);
 try{
  const job=createRetrieval(db,'fixture',{env});let calls=0;
  const firstRaw=JSON.stringify({records:[row('a')],next:'next-cursor'});
  const failed=await resumeRetrieval(db,job.id,{env,lookup,request:async()=>{if(calls++===0)return new Response(firstRaw);throw Error('unavailable');}});
  assert.equal(failed.job.status,'partial');assert.equal(failed.job.pages,1);assert.match(failed.error,/Connector/);assert.equal(failed.job.result,undefined);
  let source=db.prepare('PRAGMA database_list').all().find(r=>r.name==='research').file;
  createResearchBackup(source,path.join(dir,'partial-backup'));verifyResearchBackup(path.join(dir,'partial-backup'));
  const saved=JSON.parse(db.prepare('SELECT body FROM research.connector_pages').get().body);db.close();const recovered=path.join(dir,'restored');fs.mkdirSync(recovered);restoreResearchBackup(path.join(dir,'partial-backup'),path.join(recovered,'research.sqlite'));db=new DatabaseSync(path.join(recovered,'cache.sqlite'));
  calls=0;
  const resumed=await resumeRetrieval(db,job.id,{env,lookup,request:async(url)=>{calls++;assert.equal(url.searchParams.get('cursor'),'next-cursor');return new Response(JSON.stringify({records:[row('b')],next:null}));}});
  assert.equal(resumed.error,undefined);assert.equal(calls,1);assert.equal(resumed.job.status,'complete');assert.equal(resumed.job.rows,2);
  const payload=JSON.parse(resumed.job.result.content);assert.deepEqual(payload.connectorEvidence.pages[0],saved);assert.equal(payload.connectorEvidence.pages[0].rawContent,firstRaw);
  assert.ok(prepareObservations({name:'Resumed',ownership:'Fixture',license:'Fixture',...resumed.job.result}).ok);
  const completed=await resumeRetrieval(db,job.id,{env:{},lookup:()=>assert.fail('completed records require no DNS'),request:()=>assert.fail('no network')});assert.equal(completed.job.status,'complete');
  assert.ok(!JSON.stringify(completed).includes(env.FIXTURE_TOKEN));
  source=db.prepare('PRAGMA database_list').all().find(r=>r.name==='research').file;
  createResearchBackup(source,path.join(dir,'complete-backup'));verifyResearchBackup(path.join(dir,'complete-backup'));
  assert.throws(()=>db.exec('UPDATE research.connector_pages SET page=10'),/immutable/);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('resumption refuses changed configuration, repeated cursors and duplicate active work',async()=>{
 const db=new DatabaseSync(':memory:');try{
  const job=createRetrieval(db,'fixture',{env});let release;
  const pending=resumeRetrieval(db,job.id,{env,lookup,request:()=>new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({records:[],next:'again'})));})});
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(resumeRetrieval(db,job.id,{env,lookup}),/already running/);
  release();
  // Let the second response repeat the first cursor; it must not be checkpointed.
  await new Promise(resolve=>setImmediate(resolve));release();
  const failed=await pending;assert.match(failed.error,/repeated/);assert.equal(failed.job.pages,1);
  const changed={...env,RESEARCH_API_CONNECTORS:JSON.stringify({fixture:{url:'https://example.org/other',pagination,tokenEnv:'FIXTURE_TOKEN'}})};
  await assert.rejects(resumeRetrieval(db,job.id,{env:changed,lookup}),/configuration changed/);
  assert.equal(getRetrieval(db,job.id).status,'partial');
 }finally{db.close();}
});
test('competing connections never overwrite one another’s checkpoints',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-retrieval-race-')),file=path.join(dir,'cache.sqlite');const a=new DatabaseSync(file),b=new DatabaseSync(file);
 try{
  const job=createRetrieval(a,'fixture',{env});getRetrieval(b,job.id);let release;
  const slow=resumeRetrieval(a,job.id,{env,lookup,request:()=>new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({records:[row('loser')],next:null})));})});
  await new Promise(resolve=>setImmediate(resolve));
  const winner=await resumeRetrieval(b,job.id,{env,lookup,request:async()=>new Response(JSON.stringify({records:[row('winner')],next:null}))});
  release();const other=await slow;
  assert.equal(winner.job.status,'complete');assert.match(other.error,/failed/);
  assert.equal(JSON.parse(getRetrieval(a,job.id).result.content).items[0].id,'winner');
  assert.equal(a.prepare('SELECT count(*) AS n FROM research.connector_pages').get().n,1);
 }finally{a.close();b.close();fs.rmSync(dir,{recursive:true,force:true});}
});
