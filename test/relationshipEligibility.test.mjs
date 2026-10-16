import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {openDb} from '../server/lib/db.mjs';
import {importRelationships,relationshipEligibility} from '../server/domain/relationship-history.mjs';
import {cleanSpec,encodeSpec,decodeSpec,specHash} from '../shared/backtestSpec.mjs';
import {runSpec} from '../server/domain/backtest/index.mjs';
import {getRun} from '../server/domain/research-store.mjs';
import {replayRun,exportRun} from '../server/domain/research-replay.mjs';
import {preserveSourceDocument} from '../server/domain/source-documents.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {archiveEvidence} from '../server/domain/research-archive.mjs';
import {requireAuditedSource} from '../server/domain/research-integrity.mjs';
import {dayOf} from '../shared/backtest.mjs';
function setup() {
 const prior=process.env.INTEL_CACHE; process.env.INTEL_CACHE=':memory:';
 const db=openDb(fileURLToPath(new URL('..',import.meta.url)));
 if(prior===undefined) delete process.env.INTEL_CACHE; else process.env.INTEL_CACHE=prior;
 const base={relationshipId:'owns',subject:'company:test',predicate:'owns',object:'facility:one',effectiveFrom:'2024-01-01',sourceUrl:'https://example.org/fixture'};
 const snapshot=importRelationships(db,{name:'Eligibility fixture',rows:[{...base,id:'original',availableAt:'2024-01-10'},{...base,id:'correction',availableAt:'2024-02-01',object:'facility:two'}]});
 const policy={snapshotId:snapshot.id,predicate:'owns',object:'facility:one',subjects:{AAPL:'company:test'}};
 const signal=(id,date,symbol='AAPL')=>({id,symbol,tradeDate:'2024-01-01',signalDate:date,side:'buy',sector:'Information Technology'});
 const signals=[signal('before','2024-01-09'),signal('eligible','2024-01-15'),signal('corrected','2024-02-01'),signal('unmapped','2024-01-15','MSFT')];
 return {db,snapshot,policy,signals};
}
test('relationship eligibility respects publication, revisions and explicit identities',()=>{
 const {db,policy,signals}=setup(); try {
 const out=relationshipEligibility(db,signals,policy);
 assert.deepEqual(out.signals.map(s=>s.id),['eligible']);
 assert.deepEqual(out.report.decisions.map(d=>d.reason),['no-known-effective-match','eligible','no-known-effective-match','unmapped-symbol']);
 assert.equal(out.report.snapshot.rows.length,2);
 const raw={source:'congress',relationship:policy}; const cleaned=cleanSpec(raw);
 assert.equal(cleaned.ok,true); assert.deepEqual(decodeSpec(encodeSpec(raw)),cleaned.spec);
 assert.notEqual(specHash(cleaned.spec),specHash(cleanSpec({source:'congress'}).spec));
 assert.equal(cleanSpec({...raw,relationship:{...policy,subjects:{aapl:'company:test'}}}).ok,false);
 assert.equal(cleanSpec({...raw,relationship:{...policy,object:'untyped'}}).ok,false);
 } finally {db.close();}
});
test('experiment freezes relationship decisions, replays, exports and prevents excluded comparison signals',async()=>{
 const {db,policy,signals}=setup(); try {
 const bars=Array.from({length:90},(_,i)=>[dayOf('2024-01-01')+i,100+i,100+i]);
 const out=await runSpec(db,{source:'congress',relationship:policy,rules:{holdDays:10}},{
 sourceFn:async()=>({signals,records:[],context:{notes:[]},feeds:[]}),
 loadBarsFn:async()=>({bars:{AAPL:bars,SPY:bars},pending:[],missing:[],stale:[],cached:2,fetched:0}),
 now:Date.parse('2024-05-01T00:00:00Z')});
 assert.equal(out.ok,true);
 const run=getRun(db,out.runId);
 assert.deepEqual(run.inputs.signals.map(s=>s.id),['eligible']);
 assert.deepEqual(run.provenance.matchedSignals.map(s=>s.id),['eligible']);
 assert.equal(run.provenance.coverage.signals.relationshipExcluded,3);
 assert.equal(run.provenance.relationship.snapshot.id,policy.snapshotId);
 assert.equal(replayRun(run).matches,true);
 assert.equal(archiveEvidence(db,run).runs[run.id].provenance.relationship.snapshot.rows.length,2);
 assert.equal(requireAuditedSource(run).relationshipAudit.eligible,1);
 const tampered=structuredClone(run);tampered.provenance.matchedSignals=[signals[2]];
 assert.throws(()=>requireAuditedSource(tampered),/relationship-ineligible/);
 const absent=await runSpec(db,{source:'congress',relationship:{...policy,snapshotId:'rel_'+'0'.repeat(32)}},{sourceFn:async()=>({signals,records:[],context:{notes:[]},feeds:[]})});
 assert.equal(absent.ok,false);assert.match(absent.error,/not found/);
 } finally {db.close();}
});
test('ambiguous revisions conservatively exclude eligibility even if one object matches',()=>{
 const {db,policy,signals,snapshot}=setup(); try {
 const original=snapshot.rows.find(row=>row.id==='original');
 const conflict=importRelationships(db,{name:'Ambiguous eligibility fixture',rows:[original,{...original,id:'conflict',object:'facility:other'}]});
 const out=relationshipEligibility(db,[signals[1]],{...policy,snapshotId:conflict.id});
 assert.equal(out.signals.length,0);
 assert.equal(out.report.decisions[0].reason,'ambiguous-relationship');
 assert.equal(out.report.decisions[0].ambiguous[0].assertionIds.length,2);
 }finally{db.close();}
});

test('portable relationship experiment includes original evidence and replays without its database',async()=>{
 const {db,policy,signals,snapshot}=setup();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-relationship-export-'));
 let closed=false;
 try {
  const bytes=Uint8Array.from([37,80,68,70,45,49,46,55,10,0,255,128]);
  const document=preserveSourceDocument(db,{url:'https://example.org/fixture',content:bytes,mediaType:'application/pdf'});
  const evidenceSnapshot=importRelationships(db,{name:'Documented eligibility',rows:snapshot.rows.map(row=>({...row,documentHash:document.hash}))});
  const bars=Array.from({length:90},(_,i)=>[dayOf('2024-01-01')+i,100+i,100+i]);
  const out=await runSpec(db,{source:'congress',relationship:{...policy,snapshotId:evidenceSnapshot.id},rules:{holdDays:10}},{
   sourceFn:async()=>({signals,records:[],context:{notes:[]},feeds:[]}),
   loadBarsFn:async()=>({bars:{AAPL:bars,SPY:bars},pending:[],missing:[],stale:[],cached:2,fetched:0}),
   now:Date.parse('2024-05-01T00:00:00Z')});
  assert.equal(out.ok,true);
  const run=getRun(db,out.runId);
  const zip=exportRun(db,run);
  fs.writeFileSync(path.join(dir,'run.zip'),zip);
  // Simulate incomplete restoration in this disposable fixture; export must fail closed.
  db.exec('DROP TRIGGER research.source_documents_delete');
  db.prepare('DELETE FROM research.source_documents WHERE id=?').run(document.hash);
  assert.throws(()=>exportRun(db,run),/Original source document is missing/);
  db.close();closed=true;
  const unpack=spawnSync('unzip',['-q','run.zip'],{cwd:dir,encoding:'utf8'});
  assert.equal(unpack.status,0,unpack.stderr);
  const evidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence.json'),'utf8'));
  assert.deepEqual(Buffer.from(evidence.documents[document.hash].content,'base64'),Buffer.from(bytes));
  assert.equal(evidence.runs[run.id].provenance.relationship.snapshot.rows.length,2);
  const replay=spawnSync(process.execPath,['replay.mjs'],{cwd:dir,encoding:'utf8'});
  assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).matches,true);
  fs.appendFileSync(path.join(dir,'evidence.json'),' ');
  const corrupt=spawnSync(process.execPath,['replay.mjs'],{cwd:dir,encoding:'utf8'});
  assert.notEqual(corrupt.status,0);assert.match(corrupt.stderr,/Checksum mismatch: evidence.json/);
 }finally{if(!closed)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('multi-edge exposure uses a common historical cutoff and retains its evidence chain',()=>{
 const {db,snapshot,policy,signals}=setup(); try {
  const location={id:'location',relationshipId:'location',subject:'facility:one',predicate:'located-in',object:'jurisdiction:US-NY',effectiveFrom:'2024-01-01',availableAt:'2024-01-20',sourceUrl:'https://example.org/location'};
  const chain=importRelationships(db,{name:'Exposure chain',rows:[...snapshot.rows,location]});
  const pathPolicy={...policy,snapshotId:chain.id,object:'jurisdiction:US-NY',path:['owns','located-in']};
  const later={...signals[1],id:'later',signalDate:'2024-01-25'};
  const out=relationshipEligibility(db,[signals[1],later,signals[2]],pathPolicy);
  assert.deepEqual(out.signals.map(s=>s.id),['later'],'future location and later ownership correction both exclude');
  assert.deepEqual(out.report.decisions[1].assertionIds,['original','location']);
  assert.deepEqual(out.report.decisions[1].path,['company:test','facility:one','jurisdiction:US-NY']);
  assert.deepEqual(decodeSpec(encodeSpec({source:'congress',relationship:pathPolicy})).relationship,pathPolicy);
  const wrongDirection={...pathPolicy,path:['located-in','owns'],predicate:'located-in'};
  assert.equal(relationshipEligibility(db,[later],wrongDirection).signals.length,0);
  const ended=importRelationships(db,{name:'Disjoint effective intervals',rows:[...snapshot.rows,{...location,effectiveTo:'2024-01-23'}]});
  assert.equal(relationshipEligibility(db,[later],{...pathPolicy,snapshotId:ended.id}).signals.length,0);
  const conflict=importRelationships(db,{name:'Ambiguous middle edge',rows:[...chain.rows,{...location,id:'conflict',object:'jurisdiction:US-CA'}]});
  const ambiguous=relationshipEligibility(db,[later],{...pathPolicy,snapshotId:conflict.id});
  assert.equal(ambiguous.report.decisions[0].reason,'ambiguous-relationship');
  assert.equal(ambiguous.report.decisions[0].ambiguous[0].step,2);
  for(const path of [[],['located-in'],['owns','unknown'],['owns','owns','owns','owns','owns']]) assert.equal(cleanSpec({source:'congress',relationship:{...pathPolicy,path}}).ok,false);
 }finally{db.close();}
});

function weightedFixture(db){
 const edge=(id,subject,predicate,object,weight,availableAt='2024-01-10')=>({id,relationshipId:id,subject,predicate,object,effectiveFrom:'2024-01-01',availableAt,sourceUrl:'https://example.org/weight',...(weight===undefined?{}:{exposureWeight:weight,weightBasis:'Synthetic normalized exposure assumption'})});
 const rows=[edge('a','company:test','owns','facility:one',.3),edge('b','company:test','owns','facility:two',.8),edge('c','facility:one','located-in','jurisdiction:US-NY',.9),edge('d','facility:two','located-in','jurisdiction:US-NY',.5),edge('unknown','company:test','owns','facility:unknown',undefined),edge('unknown-end','facility:unknown','located-in','jurisdiction:US-NY',1)];
 rows.push({...rows[1],id:'b-correction',availableAt:'2024-02-01',exposureWeight:.1});
 const snapshot=importRelationships(db,{name:'Weighted historical paths',rows});
 const policy={snapshotId:snapshot.id,predicate:'owns',path:['owns','located-in'],object:'jurisdiction:US-NY',subjects:{AAPL:'company:test'},minPathWeight:.3};
 return {snapshot,policy,rows};
}
test('weighted paths choose the strongest known product without summing or inventing missing weights',()=>{
 const {db,signals}=setup();try{
  const {snapshot,policy,rows}=weightedFixture(db);assert.equal(snapshot.schemaVersion,2);
  const out=relationshipEligibility(db,signals,policy);
  assert.deepEqual(out.signals.map(s=>s.id),['eligible']);
  assert.deepEqual(out.report.decisions.map(d=>d.reason),['no-known-weighted-match','eligible','insufficient-path-weight','unmapped-symbol']);
  assert.equal(out.report.decisions[1].pathWeight,.4);assert.deepEqual(out.report.decisions[1].assertionIds,['b','d']);
  assert.equal(out.report.decisions[2].pathWeight,.27);assert.deepEqual(out.report.decisions[2].assertionIds,['a','c']);
  const high=relationshipEligibility(db,[signals[1]],{...policy,minPathWeight:.5});assert.equal(high.signals.length,0,'alternative paths are not added, unknown edge is not one');
  const unknown=importRelationships(db,{name:'Unknown weights only',rows:rows.filter(r=>r.id.startsWith('unknown'))});
  assert.equal(relationshipEligibility(db,[signals[1]],{...policy,snapshotId:unknown.id,minPathWeight:0}).signals.length,0);
  const zero=importRelationships(db,{name:'Explicit zero weights',rows:rows.filter(r=>['a','c'].includes(r.id)).map(r=>({...r,exposureWeight:0}))});
  assert.equal(relationshipEligibility(db,[signals[1]],{...policy,snapshotId:zero.id,minPathWeight:0}).report.decisions[0].pathWeight,0);
  for(const exposureWeight of [-1,1.1,NaN,'0.5',null])assert.throws(()=>importRelationships(db,{name:'Invalid weight',rows:[{...rows[0],exposureWeight}]}),/exposureWeight/);
  assert.throws(()=>importRelationships(db,{name:'Unexplained',rows:[{...rows[0],weightBasis:''}]}),/weightBasis/);
  for(const minPathWeight of [-1,1.1,NaN,'0.5',null])assert.equal(cleanSpec({source:'congress',relationship:{...policy,minPathWeight}}).ok,false);
  assert.deepEqual(decodeSpec(encodeSpec({source:'congress',relationship:policy})).relationship,cleanSpec({source:'congress',relationship:policy}).spec.relationship);
 }finally{db.close();}
});
test('weighted experiment freezes its witness, rejects audit tampering and replays its exported calculation',async()=>{
 const {db,signals}=setup(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-weighted-'));let closed=false;
 try{
  const {policy}=weightedFixture(db);
  const bars=Array.from({length:90},(_,i)=>[dayOf('2024-01-01')+i,100+i,100+i]);
  const result=await runSpec(db,{source:'congress',relationship:policy,rules:{holdDays:10}},{sourceFn:async()=>({signals,records:[],context:{notes:[]},feeds:[]}),loadBarsFn:async()=>({bars:{AAPL:bars,SPY:bars},pending:[],missing:[],stale:[],cached:2,fetched:0}),now:Date.parse('2024-05-01T00:00:00Z')});
  const run=getRun(db,result.runId);assert.equal(result.ok,true);
  assert.equal(requireAuditedSource(run).relationshipAudit.eligible,1);
  assert.deepEqual(run.inputs.signals.map(s=>s.id),['eligible']);
  const forged=structuredClone(run);forged.provenance.relationship.decisions.find(d=>d.reason==='eligible').pathWeight=.99;
  assert.throws(()=>requireAuditedSource(forged),/weighted relationship witness/);
  const lowered=structuredClone(run);lowered.provenance.relationship.policy.minPathWeight=0;
  assert.throws(()=>requireAuditedSource(lowered),/weighted relationship policy/);
  const removed=structuredClone(run);delete removed.provenance.relationship.policy.minPathWeight;assert.throws(()=>requireAuditedSource(removed),/weighted relationship policy/);
  fs.writeFileSync(path.join(dir,'run.zip'),exportRun(db,run));db.close();closed=true;
  assert.equal(spawnSync('unzip',['-q','run.zip'],{cwd:dir}).status,0);
  const replay=spawnSync(process.execPath,['replay.mjs'],{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).matches,true);
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'run.json'),'utf8'));assert.equal(saved.provenance.relationship.policy.minPathWeight,.3);assert.equal(saved.provenance.relationship.decisions[1].pathWeight,.4);
 }finally{if(!closed)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
