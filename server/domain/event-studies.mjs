import {researchStore,getExperiment,getRun,putRun,newId,hashOf} from './research-store.mjs';
import {requireAuditedSource} from './research-integrity.mjs';
import {ENGINE,EVENT_STUDY_ENGINE} from './research-replay.mjs';
import {cleanEventStudy,runEventStudy} from '../../shared/eventStudy.mjs';
const ready=new WeakSet();
function ensure(db){researchStore(db);if(ready.has(db))return;db.exec(`CREATE TABLE IF NOT EXISTS research.event_study_plans (id TEXT PRIMARY KEY,created_at TEXT NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research.event_study_evaluations (plan_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,created_at TEXT NOT NULL);`);
 for(const table of ['event_study_plans','event_study_evaluations'])for(const op of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS research.${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Event study records are immutable'); END;`);ready.add(db);}
function stored(db,id){ensure(db);const row=db.prepare('SELECT body,body_hash FROM research.event_study_plans WHERE id=?').get(id);if(!row)throw Error('Event study not found.');if(hashOf(row.body)!==row.body_hash)throw Error('Event study checksum mismatch.');return JSON.parse(row.body);}
export function getEventStudy(db,id){const plan=stored(db,id),evaluation=db.prepare('SELECT run_id FROM research.event_study_evaluations WHERE plan_id=?').get(id);return {...plan,run:evaluation?getRun(db,evaluation.run_id):null};}
export function listEventStudies(db){ensure(db);return db.prepare('SELECT id FROM research.event_study_plans ORDER BY created_at DESC,id DESC LIMIT 200').all().map(({id})=>{const p=stored(db,id);return {id,title:p.title,createdAt:p.createdAt,evaluated:Boolean(db.prepare('SELECT 1 FROM research.event_study_evaluations WHERE plan_id=?').get(id))};});}
function validateSource(source){
 if(!source?.inputs||source.inputs.kind||!source.result.ok||source.result.building||source.engineId!==ENGINE.id)throw Error('Choose a completed single-source experiment with the current engine.');
 if(source.inputs.rules.benchmark!=='SPY'||!source.inputs.benchBars.SPY?.length)throw Error('Run the source experiment with SPY as benchmark first.');
 return requireAuditedSource(source);
}
export function createEventStudy(db,body){
 ensure(db);for(const [key,max] of [['title',200],['hypothesis',4000]])if(typeof body?.[key]!=='string'||!body[key].trim()||body[key].length>max)throw Error(`Provide ${key} up to ${max} characters.`);
 const experiment=getExperiment(db,body.experimentId),source=experiment?.run,sourceAudit=validateSource(source),spec=cleanEventStudy(body.spec);
 const priorPlans=db.prepare("SELECT COUNT(*) AS n FROM research.event_study_plans WHERE json_extract(body,'$.sourceRunId')=?").get(source.id).n;
 const plan={version:1,id:newId('evt'),title:body.title.trim(),hypothesis:body.hypothesis.trim(),createdAt:new Date().toISOString(),experimentId:experiment.id,sourceRunId:source.id,sourceInputHash:source.inputHash,sourceEngineId:source.engineId,engineId:EVENT_STUDY_ENGINE.id,sourceAudit,spec,priorPlans};
 const encoded=JSON.stringify(plan);db.prepare('INSERT INTO research.event_study_plans VALUES (?,?,?,?)').run(plan.id,plan.createdAt,hashOf(encoded),encoded);return getEventStudy(db,plan.id);
}
export function evaluateEventStudy(db,id){
 const plan=stored(db,id);if(db.prepare('SELECT 1 FROM research.event_study_evaluations WHERE plan_id=?').get(id))return getEventStudy(db,id);
 if(plan.engineId!==EVENT_STUDY_ENGINE.id)throw Error('Event study engine changed after registration. Create a new plan.');
 const source=getRun(db,plan.sourceRunId);if(!source||source.inputHash!==plan.sourceInputHash||source.engineId!==plan.sourceEngineId)throw Error('Event study source does not match the registered experiment.');validateSource(source);
 const inputs={kind:'event-study',base:source.inputs,spec:plan.spec},report=runEventStudy(inputs);
 const provenance={plan,sourceRuns:[{runId:source.id,inputHash:source.inputHash}],sourceAudit:plan.sourceAudit,priorPlans:plan.priorPlans};
 db.exec('SAVEPOINT event_study_evaluate');try{const runId=putRun(db,{inputs,result:{ok:true,eventStudy:report},provenance,engine:EVENT_STUDY_ENGINE});db.prepare('INSERT INTO research.event_study_evaluations VALUES (?,?,?)').run(id,runId,new Date().toISOString());db.exec('RELEASE event_study_evaluate');return getEventStudy(db,id);}catch(error){db.exec('ROLLBACK TO event_study_evaluate; RELEASE event_study_evaluate');throw error;}
}
