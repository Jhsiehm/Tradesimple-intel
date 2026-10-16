import {researchStore,hashOf} from '../research-store.mjs';
const ready=new WeakSet();
export function ensureTaskControl(db){
 if(ready.has(db))return;researchStore(db);
 db.exec(`CREATE TABLE IF NOT EXISTS research.task_controls (revision INTEGER PRIMARY KEY,paused INTEGER NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS research.task_controls_update BEFORE UPDATE ON task_controls BEGIN SELECT RAISE(ABORT,'Task controls are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS research.task_controls_delete BEFORE DELETE ON task_controls BEGIN SELECT RAISE(ABORT,'Task controls are immutable'); END;`);
 ready.add(db);
}
function decode(row){
 if(!row)return null;
 const value=JSON.parse(row.body);
 if(hashOf(row.body)!==row.body_hash||value.revision!==row.revision||typeof value.paused!=='boolean'||Number(value.paused)!==row.paused)throw Error('Task control checksum or identity mismatch.');
 return value;
}
export function verifyTaskControls(rows){
 let previous=null;
 for(const row of rows){const value=decode(row);if(value.revision!==(previous?.revision||0)+1||value.previousHash!==(previous?hashOf(previous):null)||value.actor!=='local-owner'||!value.reason?.trim()||!Number.isFinite(Date.parse(value.createdAt)))throw Error('Task control history mismatch.');previous=value;}
 return previous;
}
export function taskControl(db){
 ensureTaskControl(db);
 return decode(db.prepare('SELECT * FROM research.task_controls ORDER BY revision DESC LIMIT 1').get())||{revision:0,paused:false,reason:'',createdAt:null,actor:null};
}
export function taskControlHistory(db){ensureTaskControl(db);return db.prepare('SELECT * FROM research.task_controls ORDER BY revision DESC LIMIT 100').all().map(decode);}
export function setTaskControl(db,input){
 ensureTaskControl(db);
 if(!input||typeof input.paused!=='boolean'||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0||typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>1000)throw Error('Supply paused, the current baseRevision, and a reason of 1–1000 characters.');
 const current=taskControl(db);
 if(current.revision!==input.baseRevision)throw Object.assign(Error('Task control changed elsewhere. Reload before changing it.'),{status:409});
 const record={revision:current.revision+1,paused:input.paused,reason:input.reason.trim(),actor:'local-owner',createdAt:new Date().toISOString(),previousHash:current.revision?hashOf(current):null};
 const encoded=JSON.stringify(record);
 const result=db.prepare('INSERT INTO research.task_controls SELECT ?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM research.task_controls),0)=?').run(record.revision,Number(record.paused),hashOf(encoded),encoded,input.baseRevision);
 if(result.changes!==1)throw Object.assign(Error('Task control changed elsewhere. Reload before changing it.'),{status:409});
 return record;
}
