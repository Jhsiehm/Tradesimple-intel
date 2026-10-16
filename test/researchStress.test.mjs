import {createPlan,evaluatePlan} from '../server/domain/convergence.mjs';
import {cleanConvergence,runConvergence} from '../shared/convergence.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {openDb} from '../server/lib/db.mjs';
import {dayOf,runBacktest} from '../shared/backtest.mjs';
import {DEFAULT_RULES} from '../shared/backtestSpec.mjs';
import {cleanStressScenarios,stressInputs,runStress,shockPrices,stressPriceSeries} from '../shared/researchStress.mjs';
import {importDataset,datasetSource} from '../server/domain/research-events.mjs';
import {runSpec} from '../server/domain/backtest/index.mjs';
import {saveExperiment} from '../server/domain/research-store.mjs';
import {createStressPlan,evaluateStressPlan,getStressPlan,listStressPlans} from '../server/domain/research-stress.mjs';
import {replayRun,exportRun} from '../server/domain/research-replay.mjs';
import {createResearchBackup,verifyResearchBackup} from '../server/domain/research-backup.mjs';
const bars=Array.from({length:80},(_,i)=>[dayOf('2025-01-01')+i,100+i,101+i]);
const base={signals:Array.from({length:10},(_,i)=>({id:`signal-${i}`,symbol:'AAPL',side:'buy',signalDate:'2025-01-03',tradeDate:'2025-01-01'})),bars:{AAPL:bars},benchBars:{SPY:bars.map(b=>[b[0],100,100])},rules:{...DEFAULT_RULES,holdDays:10}};
const scenarios=[{id:'late',label:'Seven-day reporting delay',delayDays:7},{id:'costly',label:'Higher fees',extraCostBps:20},{id:'missing',label:'Thirty percent missing',missingPct:30,seed:42},{id:'outage',label:'All signals unavailable',missingPct:100,seed:42}];
test('stress assumptions are strict and deterministic; delays never backdate publication',()=>{
 const spec=cleanStressScenarios(scenarios,base.rules),before=JSON.stringify(base),late=stressInputs(base,spec[0]);
 assert.equal(late.inputs.signals[0].signalDate,'2025-01-10');assert.equal(JSON.stringify(base),before);
 const missing=stressInputs(base,spec[2]),reordered=stressInputs({...base,signals:[...base.signals].reverse()},spec[2]);
 assert.equal(missing.removed,3);assert.deepEqual(missing.inputs.signals.map(s=>s.id).sort(),reordered.inputs.signals.map(s=>s.id).sort());
 for(const patch of [{delayDays:-1},{missingPct:101},{delayDays:1.5},{extraCostBps:301},{seed:-1},{unsupported:true}])assert.throws(()=>cleanStressScenarios([{id:'bad',label:'Invalid',...patch}],base.rules));
 assert.throws(()=>cleanStressScenarios([{id:'empty',label:'Unchanged'}],base.rules),/baseline/);
 assert.throws(()=>cleanStressScenarios([scenarios[0],scenarios[0]],base.rules),/distinct/);
});
test('stress reports preserve baseline, costs, missing results and per-signal decisions',()=>{
 const report=runStress({base,scenarios});assert.deepEqual(report.baseline,runBacktest(base));
 assert.deepEqual(runStress({base,scenarios}),report);
 assert.ok(report.scenarios[1].result.stats.total<report.baseline.stats.total);
 assert.equal(report.scenarios[2].decisions.filter(d=>d.reason==='missing-signal').length,3);
 assert.equal(report.scenarios[3].result.stats,null);assert.equal(report.scenarios[3].delta,null);
 const beyond=runStress({base,scenarios:[{id:'beyond',label:'Beyond price coverage',delayDays:90}]});assert.equal(beyond.scenarios[0].result.stats,null);assert.equal(beyond.scenarios[0].result.counts.skipped,10);
});
test('registered stress plans evaluate once, preserve source evidence, back up and replay outside the app',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-stress-'));const prior=process.env.INTEL_CACHE;process.env.INTEL_CACHE=path.join(dir,'cache.sqlite');let db;
 try{
  db=openDb(decodeURIComponent(new URL('..',import.meta.url).pathname));
  const dataset=importDataset(db,{name:'Stress fixture',source:'Synthetic',format:'json',content:JSON.stringify(base.signals.map(s=>({id:s.id,symbol:s.symbol,side:s.side,eventAt:s.tradeDate,availableAt:s.signalDate})))}).dataset;
  const run=await runSpec(db,{source:'dataset',datasetId:dataset.id,rules:base.rules},{sourceFn:async()=>datasetSource(dataset),loadBarsFn:async()=>({bars:{AAPL:bars,SPY:base.benchBars.SPY},pending:[],stale:[],cached:2,fetched:0,missing:[],oldestStoredAt:Date.now()})});
  const experiment=saveExperiment(db,{runId:run.runId,title:'Synthetic baseline'});
  const plan=createStressPlan(db,{title:'Registered sensitivity',hypothesis:'Higher costs reduce returns; delays change exposure.',experimentId:experiment.id,scenarios:[...scenarios,{id:'price-drop',label:'Synthetic price drop',priceShock:{date:'2025-01-10',changePct:-20,symbols:['AAPL']}}]});assert.equal(plan.run,null);assert.equal(plan.priorPlans,0);
  const done=evaluateStressPlan(db,plan.id);assert.equal(done.run.inputs.kind,'stress');assert.equal(replayRun(done.run).matches,true);assert.equal(evaluateStressPlan(db,plan.id).run.id,done.run.id);
  assert.equal(listStressPlans(db)[0].evaluated,true);assert.equal(getStressPlan(db,plan.id).scenarios.length,5);
  assert.throws(()=>saveExperiment(db,{runId:done.run.id,title:'Wrong category'}),/locked plan/);
  assert.throws(()=>db.exec('DELETE FROM research.stress_plans'),/immutable/);
  const next=createStressPlan(db,{title:'Another sensitivity plan',hypothesis:'Document repeated analysis',experimentId:experiment.id,scenarios:[scenarios[0]]});assert.equal(next.priorPlans,1);
  const backup=createResearchBackup(path.join(dir,'research.sqlite'),path.join(dir,'backup'));assert.equal(backup.counts.stress_plans,2);assert.equal(verifyResearchBackup(path.join(dir,'backup')).counts.stress_evaluations,1);
  fs.writeFileSync(path.join(dir,'run.zip'),exportRun(db,done.run));db.close();db=null;
  const unpack=spawnSync('unzip',['-q','run.zip'],{cwd:dir,encoding:'utf8'});assert.equal(unpack.status,0,unpack.stderr);
  const replay=spawnSync(process.execPath,['replay.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).matches,true);
  const evidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence.json'),'utf8'));assert.ok(evidence.runs[experiment.runId]);assert.equal(evidence.datasets[dataset.id].rawContent,dataset.rawContent);
 }finally{db?.close();if(prior===undefined)delete process.env.INTEL_CACHE;else process.env.INTEL_CACHE=prior;fs.rmSync(dir,{recursive:true,force:true});}
});

const multiBase=()=>({kind:'convergence',phase:'evaluation',spec:cleanConvergence({from:'2025-01-01',split:'2025-04-01',to:'2025-06-30',universe:'AAPL',windowDays:7,embargoDays:7,rules:{holdDays:10}}),sources:['a','b'].map((id,i)=>({id,label:id.toUpperCase(),signals:['2025-01-06','2025-03-22','2025-04-06'].map((date,n)=>({id:`${id}-${n}`,symbol:'AAPL',side:'buy',signalDate:date,tradeDate:date}))})),bars:{AAPL:Array.from({length:181},(_,i)=>[dayOf('2025-01-01')+i,100+i,101+i])},benchBars:{SPY:Array.from({length:181},(_,i)=>[dayOf('2025-01-01')+i,100,100])}});
test('multi-source stress rebuilds confirmation and keeps other source baselines intact',()=>{
 const base=multiBase(),report=runStress({base,scenarios:[{id:'lost-a',label:'Source A unavailable',missingPct:100,sourceIds:['a']}]});
 assert.equal(report.kind,'convergence-stress');assert.deepEqual(report.baseline,runConvergence(base));
 const stressed=report.scenarios[0].result;
 for(const period of ['development','holdout']){
  assert.equal(stressed.periods[period].variants.find(v=>v.id==='combined').counts.decisions,0);
  assert.deepEqual(stressed.periods[period].variants.find(v=>v.id==='single:1'),report.baseline.periods[period].variants.find(v=>v.id==='single:1'));
 }
 assert.equal(report.scenarios[0].decisions.filter(d=>d.reason==='missing-signal').length,3);
 assert.throws(()=>runStress({base:{...base,phase:'development'},scenarios:[scenarios[0]]}),/already evaluated/);
 assert.throws(()=>runStress({base,scenarios:[{...scenarios[0],sourceIds:['unknown']}]}),/source IDs/);
});
test('multi-source delay cannot move original development publications into holdout',()=>{
 const base=multiBase(),report=runStress({base,scenarios:[{id:'late-a',label:'Delayed source A',delayDays:30,sourceIds:['a']}]});
 const decisions=report.scenarios[0].decisions;
 assert.equal(decisions.find(d=>d.sourceId==='a'&&d.signalId==='a-1').reason,'delay-crosses-period');
 assert.equal(decisions.find(d=>d.sourceId==='b'&&d.signalId==='b-1').reason,'retained');
 for(const variant of report.scenarios[0].result.periods.holdout.variants)assert.ok(variant.evidence.every(e=>e.records.every(r=>r.recordId!=='a-1')));
});
test('Convergence stress refuses unopened holdouts and exports all original source evidence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsi-multi-stress-')),prior=process.env.INTEL_CACHE;process.env.INTEL_CACHE=path.join(dir,'cache.sqlite');let db;
 try{
  db=openDb(decodeURIComponent(new URL('..',import.meta.url).pathname));const base=multiBase(),ids=[];
  for(const source of base.sources){const d=importDataset(db,{name:`Multi ${source.id}`,source:'Synthetic',format:'json',content:JSON.stringify(source.signals.map(s=>({id:s.id,symbol:s.symbol,side:s.side,eventAt:s.tradeDate,availableAt:s.signalDate})))}).dataset;
   const run=await runSpec(db,{source:'dataset',datasetId:d.id,rules:base.spec.rules},{sourceFn:async()=>datasetSource(d),loadBarsFn:async()=>({bars:{AAPL:base.bars.AAPL,SPY:base.benchBars.SPY},pending:[],stale:[],cached:2,fetched:0,missing:[],oldestStoredAt:Date.now()})});ids.push(saveExperiment(db,{runId:run.runId,title:source.label}).id);
  }
  const comparison=createPlan(db,{title:'Frozen comparison',experimentIds:ids,spec:base.spec});
  const request={title:'Source outage',hypothesis:'Removing A eliminates confirmation',convergencePlanId:comparison.id,scenarios:[{id:'outage-a',label:'Source A unavailable',missingPct:100,sourceIds:[ids[0]]}]};
  assert.throws(()=>createStressPlan(db,request),/unopened holdout/);
  evaluatePlan(db,comparison.id);const plan=createStressPlan(db,request),done=evaluateStressPlan(db,plan.id);
  assert.equal(done.sourceKind,'convergence');assert.equal(replayRun(done.run).matches,true);
  createResearchBackup(path.join(dir,'research.sqlite'),path.join(dir,'backup'));assert.equal(verifyResearchBackup(path.join(dir,'backup')).counts.stress_evaluations,1);
  fs.writeFileSync(path.join(dir,'run.zip'),exportRun(db,done.run));db.close();db=null;
  assert.equal(spawnSync('unzip',['-q','run.zip'],{cwd:dir}).status,0);
  const replay=spawnSync(process.execPath,['replay.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).matches,true);
  const evidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence.json'),'utf8'));assert.equal(Object.keys(evidence.datasets).length,2);assert.equal(Object.keys(evidence.runs).length,4);
 }finally{db?.close();if(prior===undefined)delete process.env.INTEL_CACHE;else process.env.INTEL_CACHE=prior;fs.rmSync(dir,{recursive:true,force:true});}
});

test('source outages preserve any-source and fixed-quorum agreement rules',()=>{
 for(const policy of [{confirmation:'any'},{confirmation:'at-least',minSources:2}]){
  const base=multiBase();base.spec={...base.spec,...policy};
  const report=runStress({base,scenarios:[{id:'lost-a',label:'A unavailable',missingPct:100,sourceIds:['a']}]});
  for(const period of ['development','holdout']){
   const variants=report.scenarios[0].result.periods[period].variants,combined=variants.find(v=>v.id==='combined'),single=variants.find(v=>v.id==='single:1');
   assert.equal(combined.counts.decisions,policy.confirmation==='any'?single.counts.decisions:0);
   assert.ok(single.counts.decisions>0);
   if(policy.confirmation==='at-least')assert.ok(variants.filter(v=>v.id.startsWith('without:')).every(v=>v.counts.decisions===0));
  }
 }
});

test('dated shocks preserve originals, pre-shock prices and subsequent percentage returns',()=>{
 const source={...base,bars:{AAPL:bars,SPY:bars},benchBars:{SPY:bars,OTHER:bars}},original=JSON.stringify(source);
 const {inputs,priceChanges}=shockPrices(source,{date:'2025-01-10',changePct:-20,symbols:['AAPL','SPY']});
 assert.equal(JSON.stringify(source),original);
 assert.deepEqual(inputs.bars.AAPL.slice(0,9),bars.slice(0,9));
 assert.deepEqual(inputs.bars.AAPL[9],[bars[9][0],bars[9][1]*.8,bars[9][2]*.8]);
 assert.deepEqual(inputs.bars.SPY,inputs.benchBars.SPY);assert.deepEqual(inputs.benchBars.OTHER,bars);
 assert.ok(Math.abs(inputs.bars.AAPL[11][2]/inputs.bars.AAPL[10][2]-bars[11][2]/bars[10][2])<1e-14);
 assert.equal(priceChanges.length,3);assert.ok(priceChanges.every(c=>c.affectedBars===71&&c.firstAffectedDate==='2025-01-10'&&c.factor===.8));
 const missingOpen={...base,bars:{AAPL:bars.map(b=>[b[0],null,b[2]])}};
 assert.equal(shockPrices(missingOpen,{date:'2025-01-10',changePct:20,symbols:['AAPL']}).inputs.bars.AAPL[10][1],null);
});

test('shock dates without a bar start at the next saved bar, and zero or unbounded assumptions are refused',()=>{
 const sparse={...base,bars:{AAPL:[bars[0],bars[4],bars[9]]}},shock={date:'2025-01-03',changePct:25,symbols:['AAPL']};
 assert.equal(shockPrices(sparse,shock).priceChanges[0].firstAffectedDate,'2025-01-05');
 const options={priceSeries:stressPriceSeries(base)};
 for(const patch of [{date:'2025-02-30'},{date:'2024-12-31'},{date:'2026-01-01'},{symbols:[]},{symbols:['AAPL','AAPL']},{symbols:['UNKNOWN']},{changePct:0},{changePct:-100},{changePct:501},{changePct:'-20'},{extra:true}]){
  assert.throws(()=>cleanStressScenarios([{id:'bad',label:'Bad shock',priceShock:{...shock,...patch}}],base.rules,options),/shock|symbols|frozen|bars/i);
 }
 const clean=cleanStressScenarios([{id:'valid',label:'Shock only',priceShock:shock}],base.rules,options)[0];
 assert.equal(clean.delayDays,0);assert.deepEqual(clean.priceShock,shock);
});

test('a price shock changes positions spanning the date, not returns entirely after it',()=>{
 const flat=bars.map(b=>[b[0],100,100]);
 const source={...base,signals:[{...base.signals[0],id:'crossing',signalDate:'2025-01-03'},{...base.signals[0],id:'later',signalDate:'2025-01-20'}],bars:{AAPL:flat},benchBars:{SPY:flat},rules:{...base.rules,costBps:0,slippageBps:0}};
 const report=runStress({base:source,scenarios:[{id:'drop',label:'Drop 20%',priceShock:{date:'2025-01-10',changePct:-20,symbols:['AAPL']}}]});
 assert.equal(report.baseline.trades[0].ret,0);assert.equal(report.scenarios[0].result.trades[0].ret,-.2);assert.equal(report.scenarios[0].result.trades[1].ret,0);
 assert.equal(report.scenarios[0].removed,0);assert.equal(report.scenarios[0].priceChanges[0].affectedBars,71);
 const shorts={...source,signals:source.signals.map(s=>({...s,side:'sell'})),rules:{...source.rules,sides:'sell'}};
 assert.equal(runStress({base:shorts,scenarios:[{id:'drop',label:'Drop',priceShock:{date:'2025-01-10',changePct:-20,symbols:['AAPL']}}]}).scenarios[0].result.trades[0].ret,.2);
});

test('Convergence shocks preserve development before a holdout shock and update targeted benchmarks consistently',()=>{
 const base=multiBase(),before=JSON.stringify(base);
 const report=runStress({base,scenarios:[{id:'holdout-shock',label:'Holdout price shock',sourceIds:['a'],priceShock:{date:'2025-04-10',changePct:-20,symbols:['AAPL','SPY']}}]});
 assert.equal(JSON.stringify(base),before);assert.deepEqual(report.scenarios[0].result.periods.development,report.baseline.periods.development);
 assert.ok(report.scenarios[0].result.periods.holdout.variants.every(v=>Math.abs(v.windowStats.benchmarkReturn+.2)<1e-12));
 assert.equal(report.scenarios[0].priceChanges.length,2);
 assert.deepEqual(report.scenarios[0].result.periods.holdout.variants.map(v=>v.counts),report.baseline.periods.holdout.variants.map(v=>v.counts));
 assert.notDeepEqual(report.scenarios[0].result.periods.holdout.variants.map(v=>v.windowStats),report.baseline.periods.holdout.variants.map(v=>v.windowStats));
});
