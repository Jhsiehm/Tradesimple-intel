import {importObservations,mergeObservationSnapshots} from '../server/domain/research-observations.mjs';
import {savePairEvaluation} from '../server/domain/pair-evaluations.mjs';
import {executePair} from '../server/ai/pairedResearch.mjs';
import {createPairProtocol} from '../server/domain/research-pairs.mjs';
import {startAnalysis} from '../server/domain/research-analysis.mjs';
import { saveNotebook } from '../server/domain/notebooks.mjs';
import { approveMemory, createMemorySnapshot } from '../server/domain/research-context.mjs';
import { importRelationships } from '../server/domain/relationship-history.mjs';
import { preserveSourceDocument } from '../server/domain/source-documents.mjs';
import { putBlob } from '../server/domain/evidence/store.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { researchStore, putRun, saveExperiment, hashOf } from '../server/domain/research-store.mjs';
import { ENGINE, replayRun } from '../server/domain/research-replay.mjs';
import { runBacktest, dayOf } from '../shared/backtest.mjs';
import { realityCheck, REALITY } from '../shared/backtestStats.mjs';
import { createResearchBackup, verifyResearchBackup, restoreResearchBackup } from '../server/domain/research-backup.mjs';

test('online backup includes committed WAL research and restores a replayable run without overwrites', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsi-backup-'));
  const db = new DatabaseSync(path.join(dir, 'cache.sqlite'));
  try {
    researchStore(db);
    const inputs = { signals: [{ id:'one', symbol:'AAPL', signalDate:'2025-01-02', tradeDate:'2025-01-01', side:'buy' }], bars: { AAPL: Array.from({length:50}, (_,i) => [dayOf('2025-01-01')+i,100+i,101+i]) }, benchBars: { SPY: Array.from({length:50}, (_,i) => [dayOf('2025-01-01')+i,100,100]) }, rules: { holdDays:10 } };
    const engineResult = runBacktest(inputs);
    const reality = realityCheck({ trades: engineResult.trades, bars: inputs.bars, benchBars: inputs.benchBars, rules: engineResult.rules });
    const runId = putRun(db, { inputs, result: { ...engineResult, engineResult, reality }, provenance: { statistics: REALITY }, engine: ENGINE });
    saveExperiment(db, { runId, title: 'Recoverable evidence' });
    const mapping = { mapping: [], proofs: [] };
    const mappingHash = putBlob(db, { ...mapping, observedAt: '2025-01-01T00:00:00Z' });
    db.prepare('INSERT INTO research.evidence_mappings VALUES (?, ?)').run(mappingHash, JSON.stringify(mapping));
    const original = preserveSourceDocument(db, { url: 'https://example.org/original.xml', content: '<filing>original</filing>', mediaType: 'application/xml' });
    const relations = importRelationships(db, { name: 'Recovery relationship', rows: [{ id: 'a', relationshipId: 'r', subject: 'company:one', predicate: 'owns', object: 'facility:one', effectiveFrom: '2020-01-01', availableAt: '2020-01-02', sourceUrl: 'https://example.org/filing' }] });
    const notebook=saveNotebook(db,{title:'Approved negative result',hypothesis:'Test',conclusion:'Rejected',decision:'Insufficient evidence',status:'rejected',tags:[],evidence:[],followups:[]});
    const approval=approveMemory(db,{notebookId:notebook.id,revision:1,action:'approve',reason:'Reviewed'});
    const memory=createMemorySnapshot(db,{mode:'context-aware',knownAt:new Date().toISOString(),approvalIds:[approval.id]});
    const analysis=startAnalysis(db,{request:{question:'Recovery fixture'},memory:{mode:memory.mode,snapshotId:memory.id,contentHash:memory.contentHash,knownAt:memory.knownAt},provider:'fixture',model:'fixture'});
    analysis.finish('completed');
    const isolated=createMemorySnapshot(db,{mode:'isolated',knownAt:memory.knownAt,approvalIds:[]});
    const external=startAnalysis(db,{request:{question:'Frozen external evidence'},memory:{mode:'isolated',snapshotId:isolated.id,contentHash:isolated.contentHash,knownAt:isolated.knownAt},provider:'openai',model:'fixture'});
    external.append('tool_output',{name:'market_snapshot',args:{},result:{ok:true,source:'Fixture',rows:[]}});external.finish('completed');
    const pair=createPairProtocol(db,{question:'Compare evidence',hypothesis:'Memory adds caveats',evaluation:'Count grounded caveats',provider:'openai',model:'fixture',style:'professional',snapshotId:memory.id,evidenceAnalysisId:external.id,evidenceSequences:[1]});
    const pairRun=await executePair(db,pair.id,{env:{ASK_PROVIDER:'openai',OPENAI_API_KEY:'fixture',ASK_MODEL:'fixture',ASK_STRONG_MODEL:'fixture',ASK_MONTHLY_BUDGET_USD:'0'},makeProvider:cfg=>({name:'openai',model:cfg.model,async *chat(){yield {type:'text',delta:'Fixture evidence [E1].'};}})});
    const assessment={criteriaAssessment:'Same supplied fixture evidence',strengths:'Cites the evidence',limitations:'Synthetic only'};
    const evaluation=savePairEvaluation(db,pair.id,{baseRevision:0,verdict:'tie',rationale:'Same fixture answers',reviewReason:'Synthetic review',assessments:{isolated:assessment,'context-aware':assessment},excerpts:[{arm:'isolated',quote:'Fixture evidence [E1].',comment:'Matches supplied evidence reference'}]});
    const observation=importObservations(db,{name:'Backup observation',source:'Fixture',ownership:'Researcher',license:'Test only',format:'json',content:JSON.stringify([{id:'one',entityId:'facility:test',metric:'temperature',unit:'C',value:0,eventAt:'2025-01-01',availableAt:'2025-01-02',sourceUrl:'https://example.org/fixture'}])}).snapshot;
    const revision=importObservations(db,{name:'Backup observation',source:'Fixture',ownership:'Researcher',license:'Test only',format:'json',content:JSON.stringify([{id:'two',observationId:'one',entityId:'facility:test',metric:'temperature',unit:'C',value:2,eventAt:'2025-01-01',availableAt:'2025-01-05',sourceUrl:'https://example.org/revision'}])}).snapshot;
    const merged=mergeObservationSnapshots(db,{name:'Backup merged history',reason:'Test merged history restoration',identityNamespace:'Fixture observations',snapshotIds:[observation.id,revision.id]}).snapshot;
    const backupDir = path.join(dir, 'snapshot');
    const manifest = createResearchBackup(path.join(dir, 'research.sqlite'), backupDir);
    assert.equal(manifest.counts.runs, 1);
    assert.equal(manifest.counts.analysis_events,15);
    assert.equal(manifest.counts.pair_executions,1);
    assert.equal(manifest.counts.pair_results,1);
    assert.equal(manifest.counts.observation_snapshots,3);
    assert.equal(manifest.counts.pair_evaluations,1);
    assert.equal(manifest.counts.pair_protocols,1);
    assert.equal(manifest.counts.memory_approvals,1);
    assert.equal(manifest.counts.memory_snapshots,3);
    assert.equal(manifest.counts.evidence_mappings, 1);
    assert.equal(manifest.counts.source_documents, 1);
    assert.equal(manifest.counts.relationship_snapshots, 1);
    assert.equal(manifest.counts.experiments, 1);
    assert.deepEqual(verifyResearchBackup(backupDir), manifest);
    assert.throws(() => createResearchBackup(path.join(dir, 'research.sqlite'), backupDir), /exist/i);
    const destination = path.join(dir, 'restored.sqlite');
    assert.equal(restoreResearchBackup(backupDir, destination).verified, true);
    const restored = new DatabaseSync(destination, {readOnly:true});
    try {
      assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM analysis_events WHERE analysis_id=?').get(analysis.id).n,2);
      assert.deepEqual(JSON.parse(restored.prepare('SELECT body FROM pair_evaluations WHERE protocol_id=?').get(pair.id).body),evaluation);
      assert.deepEqual(JSON.parse(restored.prepare('SELECT body FROM pair_results WHERE protocol_id=?').get(pair.id).body),pairRun.result);
      assert.deepEqual(JSON.parse(restored.prepare('SELECT body FROM pair_protocols WHERE id=?').get(pair.id).body),pair);
      assert.deepEqual(JSON.parse(restored.prepare('SELECT body FROM observation_snapshots WHERE id=?').get(observation.id).body),observation);
      assert.deepEqual(JSON.parse(restored.prepare('SELECT body FROM observation_snapshots WHERE id=?').get(merged.id).body),merged);
      const run = JSON.parse(restored.prepare('SELECT body FROM runs WHERE id=?').get(runId).body);
      assert.equal(replayRun(run).matches, true);
      assert.deepEqual(JSON.parse(restored.prepare('SELECT body FROM memory_snapshots WHERE id=?').get(memory.id).body),memory);
      const document = JSON.parse(restored.prepare('SELECT body FROM source_documents WHERE id=?').get(original.hash).body);
      assert.equal(document.content, '<filing>original</filing>');
      assert.equal(JSON.parse(restored.prepare('SELECT body FROM relationship_snapshots WHERE id=?').get(relations.id).body).contentHash, relations.contentHash);
      assert.equal(restored.prepare('SELECT title FROM experiments').get().title, 'Recoverable evidence');
    } finally { restored.close(); }
    assert.throws(() => restoreResearchBackup(backupDir, destination), /already exist/);
    fs.writeFileSync(path.join(dir, 'busy.sqlite-wal'), 'sidecar');
    assert.throws(() => restoreResearchBackup(backupDir, path.join(dir, 'busy.sqlite')), /sidecars/);
    fs.appendFileSync(path.join(backupDir, 'research.sqlite'), 'corruption');
    assert.throws(() => verifyResearchBackup(backupDir), /checksum mismatch/);
    assert.throws(() => restoreResearchBackup(backupDir, path.join(dir, 'invalid.sqlite')), /checksum mismatch/);
    assert.equal(fs.existsSync(path.join(dir, 'invalid.sqlite')), false);
  } finally { db.close(); fs.rmSync(dir, {recursive:true,force:true}); }
});


test('backup refuses a notebook whose evidence pin disagrees with its run',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-notebook-backup-')),db=new DatabaseSync(path.join(dir,'cache.sqlite'));
 try{
  researchStore(db);const runId=putRun(db,{inputs:null,result:{ok:false},provenance:{},engine:ENGINE});
  const experiment=saveExperiment(db,{runId,title:'Failed attempt retained as evidence'});
  const note=saveNotebook(db,{title:'Pinned attempt',status:'draft',tags:[],followups:[],evidence:[{kind:'experiment',id:experiment.id}]});
  createResearchBackup(path.join(dir,'research.sqlite'),path.join(dir,'valid'));
  const forged={...note,evidence:note.evidence.map(e=>({...e,inputHash:'incorrect'}))},encoded=JSON.stringify(forged);
  db.exec('DROP TRIGGER research.notebook_revisions_update');
  db.prepare('UPDATE research.notebook_revisions SET body=?,body_hash=? WHERE notebook_id=?').run(encoded,hashOf(encoded),note.id);
  assert.throws(()=>createResearchBackup(path.join(dir,'research.sqlite'),path.join(dir,'invalid')),/Notebook evidence run/);
  assert.throws(()=>saveNotebook(db,{...forged,baseRevision:1},note.id),/pinned checksum/);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('memory replacement links survive backup and reject a missing paired revocation',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-memory-replacement-'));
 const db=new DatabaseSync(path.join(dir,'cache.sqlite'));
 try{
  const note=saveNotebook(db,{title:'Original',hypothesis:'Test',conclusion:'Uncertain',decision:'Review',status:'inconclusive',tags:[],evidence:[],followups:[]});
  const first=approveMemory(db,{notebookId:note.id,revision:1,action:'approve',reason:'Review'});
  saveNotebook(db,{...note,baseRevision:1,conclusion:'Revised'},note.id);
  approveMemory(db,{notebookId:note.id,revision:2,action:'approve',reason:'Replace old interpretation',supersedesApprovalId:first.id});
  const source=db.prepare('PRAGMA database_list').all().find(r=>r.name==='research').file;
  const backup=path.join(dir,'valid');createResearchBackup(source,backup);verifyResearchBackup(backup);
  const recovered=path.join(dir,'recovered.sqlite');restoreResearchBackup(backup,recovered);
  const check=new DatabaseSync(recovered,{readOnly:true});
  try{assert.equal(check.prepare('SELECT count(*) AS n FROM memory_approvals').get().n,3);}finally{check.close();}
  // Model semantic corruption with recalculated row checksums, not just byte damage.
  db.exec('DROP TRIGGER research.memory_approvals_update');
  const row=db.prepare('SELECT id,body FROM research.memory_approvals ORDER BY sequence DESC LIMIT 1').get();
  const revoked=JSON.parse(row.body);delete revoked.replacementApprovalId;const body=JSON.stringify(revoked);
  db.prepare('UPDATE research.memory_approvals SET body=?,body_hash=? WHERE id=?').run(body,hashOf(body),row.id);
  assert.throws(()=>createResearchBackup(source,path.join(dir,'invalid')),/replacement reference mismatch/);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
