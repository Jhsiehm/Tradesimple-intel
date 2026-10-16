import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {dayOf} from '../shared/backtest.mjs';
import {DEFAULT_RULES} from '../shared/backtestSpec.mjs';
import {cleanEventStudy,runEventStudy} from '../shared/eventStudy.mjs';
import {openDb} from '../server/lib/db.mjs';
import {importDataset,datasetSource} from '../server/domain/research-events.mjs';
import {runSpec} from '../server/domain/backtest/index.mjs';
import {saveExperiment} from '../server/domain/research-store.mjs';
import {createEventStudy,getEventStudy,listEventStudies,evaluateEventStudy} from '../server/domain/event-studies.mjs';
import {replayRun,exportRun} from '../server/domain/research-replay.mjs';
import {createResearchBackup,verifyResearchBackup} from '../server/domain/research-backup.mjs';
const bars=Array.from({length:80},(_,i)=>[dayOf('2025-01-01')+i,100*1.02**i,100*1.02**i]);
const market=bars.map((b,i)=>[b[0],100*1.01**i,100*1.01**i]);
const base={signals:[{id:'a',symbol:'AAPL',side:'buy',signalDate:'2025-01-10',tradeDate:'2025-01-09'},{id:'b',symbol:'AAPL',side:'sell',signalDate:'2025-01-10',tradeDate:'2025-01-09'},{id:'c',symbol:'AAPL',side:'buy',signalDate:'2025-01-12',tradeDate:'2025-01-11'}],bars:{AAPL:bars},benchBars:{SPY:market},rules:{...DEFAULT_RULES,holdDays:10}};
const spec={from:'2025-01-01',to:'2025-02-01',before:2,after:2,sides:'both'};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('event study uses subsequent sessions, one issuer-day cohort, exact AR/CAR and BHAR',()=>{
 const before=JSON.stringify(base),report=runEventStudy({base,spec});
 assert.equal(JSON.stringify(base),before);assert.equal(report.counts.completeEvents,2);assert.equal(report.counts.includedPublications,3);
 assert.equal(report.events[0].anchorDate,'2025-01-11');assert.deepEqual(report.events[0].signalIds,['a','b']);assert.deepEqual(report.events[0].sides,['buy','sell']);
 assert.equal(report.counts.overlappingEvents,2);assert.deepEqual(report.events[0].overlappingEventIds,[report.events[1].id]);
 assert.equal(report.curve.length,5);for(const point of report.curve){assert.equal(point.n,2);near(point.aar,.01);}near(report.summary.meanCar,.05);near(report.summary.meanBuyHoldAbnormalReturn,1.02**5-1.01**5);
 assert.deepEqual(runEventStudy({base:{...base,signals:[...base.signals].reverse()},spec}),report);
 const sell=runEventStudy({base,spec:{...spec,sides:'sell'}});assert.equal(sell.counts.completeEvents,1);near(sell.summary.meanCar,.05);
});
test('event study excludes whole incomplete windows and never fills missing prices or reports empty zero',()=>{
 const broken={...base,bars:{AAPL:bars.filter(b=>b[0]!==dayOf('2025-01-08'))}};
 const report=runEventStudy({base:broken,spec});assert.equal(report.counts.completeEvents,1);assert.equal(report.counts.excludedEvents,1);assert.equal(report.exclusions['missing-security-close'],2);assert.ok(report.curve.every(p=>p.n===1));
 const empty=runEventStudy({base:{...base,bars:{}},spec});assert.equal(empty.summary,null);assert.deepEqual(empty.curve,[]);assert.equal(empty.counts.completeEvents,0);
 const short=runEventStudy({base,spec:{...spec,before:20}});assert.equal(short.summary,null);assert.equal(short.exclusions['incomplete-calendar-window'],3);
 assert.throws(()=>runEventStudy({base:{...base,benchBars:{}},spec}),/SPY/);
 assert.throws(()=>runEventStudy({base:{...base,bars:{AAPL:[...bars,bars[0]]}},spec}),/duplicate/);
 for(const patch of [{before:21},{after:-1},{after:1.5},{sides:'short'},{from:'2025-02-30'},{to:'2024-01-01'},{unknown:true}])assert.throws(()=>cleanEventStudy({...spec,...patch}));
});
test('registered event study is immutable, evaluated once and portable with source evidence and backups',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-event-study-')),prior=process.env.INTEL_CACHE;process.env.INTEL_CACHE=path.join(dir,'cache.sqlite');let db;
 try{
  db=openDb(decodeURIComponent(new URL('..',import.meta.url).pathname));
  const dataset=importDataset(db,{name:'Event study fixture',source:'Synthetic',format:'json',content:JSON.stringify(base.signals.map(s=>({id:s.id,symbol:s.symbol,side:s.side,eventAt:s.tradeDate,availableAt:s.signalDate})))}).dataset;
  const run=await runSpec(db,{source:'dataset',datasetId:dataset.id,rules:base.rules},{sourceFn:async()=>datasetSource(dataset),loadBarsFn:async()=>({bars:{AAPL:bars,SPY:market},pending:[],stale:[],cached:2,fetched:0,missing:[],oldestStoredAt:Date.now()})});
  const experiment=saveExperiment(db,{runId:run.runId,title:'Synthetic source'});
  const body={title:'Descriptive disclosure study',hypothesis:'Compare daily returns to SPY around disclosure.',experimentId:experiment.id,spec};
  const plan=createEventStudy(db,body);assert.equal(plan.run,null);assert.equal(plan.priorPlans,0);
  const done=evaluateEventStudy(db,plan.id);assert.equal(done.run.inputs.kind,'event-study');assert.equal(replayRun(done.run).matches,true);assert.equal(evaluateEventStudy(db,plan.id).run.id,done.run.id);
  assert.equal(getEventStudy(db,plan.id).run.id,done.run.id);assert.equal(listEventStudies(db)[0].evaluated,true);assert.equal(createEventStudy(db,body).priorPlans,1);
  assert.throws(()=>db.exec('DELETE FROM research.event_study_plans'),/immutable/);
  createResearchBackup(path.join(dir,'research.sqlite'),path.join(dir,'backup'));assert.equal(verifyResearchBackup(path.join(dir,'backup')).counts.event_study_evaluations,1);
  fs.writeFileSync(path.join(dir,'run.zip'),exportRun(db,done.run));db.close();db=null;
  assert.equal(spawnSync('unzip',['-q','run.zip'],{cwd:dir}).status,0);
  const replay=spawnSync(process.execPath,['replay.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).matches,true);
  const evidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence.json'),'utf8'));assert.ok(evidence.runs[experiment.runId]);assert.equal(evidence.datasets[dataset.id].rawContent,dataset.rawContent);
 }finally{db?.close();if(prior===undefined)delete process.env.INTEL_CACHE;else process.env.INTEL_CACHE=prior;fs.rmSync(dir,{recursive:true,force:true});}
});
