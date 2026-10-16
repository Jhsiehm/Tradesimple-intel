import {researchStore,getExperiment,getRun,putRun,newId,hashOf} from './research-store.mjs';
import {getPlan} from './convergence.mjs';
import {requireAuditedSource,INTEGRITY_VERSION} from './research-integrity.mjs';
import {ENGINE,CONVERGENCE_ENGINE,STRESS_ENGINE} from './research-replay.mjs';
import {cleanStressScenarios,runStress,stressPriceSeries} from '../../shared/researchStress.mjs';
const ready=new WeakSet();
function ensure(db){researchStore(db);if(ready.has(db))return;db.exec(`CREATE TABLE IF NOT EXISTS research.stress_plans (id TEXT PRIMARY KEY,created_at TEXT NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research.stress_evaluations (plan_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,created_at TEXT NOT NULL);`);
 for(const t of ['stress_plans','stress_evaluations'])for(const op of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS research.${t}_${op.toLowerCase()} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'Stress records are immutable'); END;`);ready.add(db);}
function stored(db,id){ensure(db);const row=db.prepare('SELECT body,body_hash FROM research.stress_plans WHERE id=?').get(id);if(!row)throw Error('Stress plan not found.');if(hashOf(row.body)!==row.body_hash)throw Error('Stress plan checksum mismatch.');return JSON.parse(row.body);}
export function getStressPlan(db,id){const plan=stored(db,id),evaluation=db.prepare('SELECT run_id FROM research.stress_evaluations WHERE plan_id=?').get(id);return {...plan,run:evaluation?getRun(db,evaluation.run_id):null};}
export function listStressPlans(db){ensure(db);return db.prepare('SELECT id FROM research.stress_plans ORDER BY created_at DESC,id DESC LIMIT 200').all().map(({id})=>{const p=stored(db,id);return {id,title:p.title,createdAt:p.createdAt,experimentId:p.experimentId,scenarios:p.scenarios.length,evaluated:Boolean(db.prepare('SELECT 1 FROM research.stress_evaluations WHERE plan_id=?').get(id))};});}
function validateSource(db,source){
 if(source?.inputs?.kind==='convergence'){
  if(source.inputs.phase!=='evaluation'||source.engineId!==CONVERGENCE_ENGINE.id||source.provenance.integrityVersion!==INTEGRITY_VERSION)throw Error('Choose an already evaluated Convergence plan with current integrity checks and engine.');
  return {kind:'convergence',audits:source.provenance.sourceRuns.map(ref=>{const run=getRun(db,ref.runId);if(!run||run.inputHash!==ref.inputHash)throw Error('Convergence source reference mismatch.');return requireAuditedSource(run);})};
 }
 if(!source?.inputs||source.inputs.kind||!source.result.ok||source.result.building||source.engineId!==ENGINE.id)throw Error('Choose a completed single-source experiment with the current engine.');
 return requireAuditedSource(source);
}
export function createStressPlan(db,body){
 ensure(db);for(const [key,max] of [['title',200],['hypothesis',4000]])if(typeof body?.[key]!=='string'||!body[key].trim()||body[key].length>max)throw Error(`Provide ${key} up to ${max} characters.`);
 if(Boolean(body.experimentId)===Boolean(body.convergencePlanId))throw Error('Choose exactly one source experiment or evaluated Convergence plan.');
 const comparison=body.convergencePlanId?getPlan(db,body.convergencePlanId):null;
 if(comparison&&!comparison.evaluated)throw Error('Evaluate the Convergence holdout before registering stress tests; stress cannot reveal an unopened holdout.');
 const experiment=body.experimentId?getExperiment(db,body.experimentId):null,source=comparison?getRun(db,comparison.runId):experiment?.run;
 const sourceAudit=validateSource(db,source),scenarios=cleanStressScenarios(body.scenarios,source.inputs.spec?.rules||source.inputs.rules,{sourceIds:source.inputs.sources?.map(s=>s.id)||[],priceSeries:stressPriceSeries(source.inputs)});
 if(comparison&&(scenarios.length>6||source.inputs.sources.some(s=>s.signals.length>5000)))throw Error('Convergence stress supports up to six scenarios and 5,000 signals per source.');
 const priorPlans=db.prepare('SELECT COUNT(*) AS n FROM research.stress_plans WHERE json_extract(body,\'$.sourceRunId\')=?').get(source.id).n;
 const plan={version:2,id:newId('stress'),title:body.title.trim(),hypothesis:body.hypothesis.trim(),createdAt:new Date().toISOString(),experimentId:experiment?.id||null,convergencePlanId:comparison?.id||null,sourceKind:comparison?'convergence':'single-source',sourceRunId:source.id,sourceInputHash:source.inputHash,sourceEngineId:source.engineId,engineId:STRESS_ENGINE.id,sourceAudit,scenarios,priorPlans};
 const encoded=JSON.stringify(plan);db.prepare('INSERT INTO research.stress_plans VALUES (?,?,?,?)').run(plan.id,plan.createdAt,hashOf(encoded),encoded);return getStressPlan(db,plan.id);
}
export function evaluateStressPlan(db,id){
 const plan=stored(db,id);if(db.prepare('SELECT 1 FROM research.stress_evaluations WHERE plan_id=?').get(id))return getStressPlan(db,id);
 if(plan.engineId!==STRESS_ENGINE.id)throw Error('Stress engine changed after registration. Create a new plan.');
 const source=getRun(db,plan.sourceRunId);if(!source||source.inputHash!==plan.sourceInputHash||source.engineId!==plan.sourceEngineId)throw Error('Stress source does not match the registered experiment.');
 validateSource(db,source);
 const inputs={kind:'stress',version:1,base:source.inputs,scenarios:plan.scenarios};
 const report=runStress(inputs);
 const provenance={plan,sourceRuns:[{runId:source.id,inputHash:source.inputHash}],sourceAudit:plan.sourceAudit,priorPlans:plan.priorPlans,coverage:source.provenance.coverage};
 db.exec('SAVEPOINT stress_evaluate');try{
  const runId=putRun(db,{inputs,result:{ok:true,stress:report},provenance,engine:STRESS_ENGINE});
  db.prepare('INSERT INTO research.stress_evaluations VALUES (?,?,?)').run(id,runId,new Date().toISOString());db.exec('RELEASE stress_evaluate');return getStressPlan(db,id);
 }catch(error){db.exec('ROLLBACK TO stress_evaluate; RELEASE stress_evaluate');throw error;}
}
