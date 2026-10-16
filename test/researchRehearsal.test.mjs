import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {researchStore,putRun,hashOf} from '../server/domain/research-store.mjs';
import {createResearchBackup} from '../server/domain/research-backup.mjs';
import {rehearseResearchBackup} from '../server/domain/research-rehearsal.mjs';
import {ENGINE,calculate} from '../server/domain/research-replay.mjs';
import {REALITY} from '../shared/backtestStats.mjs';
function fixture(build){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-rehearsal-')),db=new DatabaseSync(path.join(dir,'cache.sqlite'));
 try{researchStore(db);build(db);createResearchBackup(path.join(dir,'research.sqlite'),path.join(dir,'backup'));}finally{db.close();}
 return dir;
}
function addRun(db,{mismatch=false,engine=ENGINE}={}){
 const inputs={signals:[],bars:{},benchBars:{},rules:{holdDays:10}};
 const {result,reality}=calculate(inputs);
 return putRun(db,{inputs,result:{...result,engineResult:mismatch?{...result,changed:true}:result,reality},provenance:{statistics:REALITY},engine});
}
test('recovery rehearsal restores every calculation with its archived engine and records timed evidence',()=>{
 const oldFiles={...ENGINE.files,'backtest.mjs':ENGINE.files['backtest.mjs']+'\n// Archived version fixture\n'};
 const dir=fixture(db=>{addRun(db);addRun(db,{engine:{files:oldFiles,id:hashOf(oldFiles)}});putRun(db,{inputs:null,result:{ok:false,error:'Original provider failure'},provenance:{},engine:ENGINE});});
 try{
  const backup=path.join(dir,'backup'),before=hashOf(fs.readFileSync(path.join(backup,'research.sqlite')).toString('base64'));
  const report=rehearseResearchBackup(backup,path.join(dir,'drill'));
  assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.matched,2);assert.equal(report.failed,0);assert.equal(report.withoutCalculation,1);
  assert.ok(report.restoreMs>=0&&report.replayMs>=0&&report.totalMs>=report.restoreMs);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'drill/rehearsal.json'))),report);
  assert.equal(before,hashOf(fs.readFileSync(path.join(backup,'research.sqlite')).toString('base64')));
  assert.deepEqual(fs.readdirSync(path.join(dir,'drill')).sort(),['rehearsal.json','research.sqlite']);
  assert.throws(()=>rehearseResearchBackup(backup,path.join(dir,'drill')),/exist/);
  const cli=spawnSync(process.execPath,['scripts/research-backup.mjs','rehearse',backup,path.join(dir,'cli')],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).matched,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('recovery rehearsal preserves mismatch evidence and continues checking the other calculations',()=>{
 const dir=fixture(db=>{addRun(db,{mismatch:true});addRun(db);});
 try{
  const report=rehearseResearchBackup(path.join(dir,'backup'),path.join(dir,'drill'));
  assert.equal(report.status,'failed');assert.equal(report.matched,1);assert.equal(report.failed,1);assert.match(report.runs.find(r=>r.status==='failed').reason,/differs/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('empty or corrupt backups cannot be reported as successful replay rehearsals',()=>{
 const dir=fixture(()=>{});
 try{
  const report=rehearseResearchBackup(path.join(dir,'backup'),path.join(dir,'empty'));
  assert.equal(report.status,'no-calculations');assert.equal(report.matched,0);
  fs.appendFileSync(path.join(dir,'backup/research.sqlite'),'corrupt');
  const bad=rehearseResearchBackup(path.join(dir,'backup'),path.join(dir,'bad'));
  assert.equal(bad.status,'failed');assert.match(bad.error,/checksum/);assert.equal(fs.existsSync(path.join(dir,'bad/research.sqlite')),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'bad/rehearsal.json'))).status,'failed');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('archived replay timeouts fail explicitly and remove temporary engine files',()=>{
 const files={...ENGINE.files,'backtest.mjs':ENGINE.files['backtest.mjs']+'\nwhile(true) {}\n'};
 const dir=fixture(db=>addRun(db,{engine:{files,id:hashOf(files)}}));
 try{
  const report=rehearseResearchBackup(path.join(dir,'backup'),path.join(dir,'timeout'),{timeoutMs:100});
  assert.equal(report.status,'failed');assert.match(report.runs[0].reason,/time limit/);
  assert.deepEqual(fs.readdirSync(path.join(dir,'timeout')).sort(),['rehearsal.json','research.sqlite']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
