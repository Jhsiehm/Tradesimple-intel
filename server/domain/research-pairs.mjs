/** Locked paired-research protocols. Creating a protocol never invokes a model. */
import {researchStore,hashOf,newId} from './research-store.mjs';
import {getAnalysis} from './research-analysis.mjs';
import {usableMemorySnapshot,createMemorySnapshot} from './research-context.mjs';
import {timestamp} from './research-events.mjs';
const ready=new WeakSet();
function ensure(db) {
 researchStore(db);if(ready.has(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS research.pair_protocols (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS research.pair_protocols_update BEFORE UPDATE ON pair_protocols BEGIN SELECT RAISE(ABORT,'Paired protocols are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS research.pair_protocols_delete BEFORE DELETE ON pair_protocols BEGIN SELECT RAISE(ABORT,'Paired protocols are immutable'); END;`);
 ready.add(db);
}
function required(value,name,max) {
 if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${name} is required (up to ${max} characters).`);
 return value.trim();
}
export function createPairProtocol(db,body,{now=new Date().toISOString()}={}) {
 ensure(db);
 if(timestamp(now)?.precision!=='instant')throw Error('Protocol time must be a UTC instant.');
 const question=required(body?.question,'Research question',800);
 const hypothesis=required(body?.hypothesis,'Expected effect of memory',4000);
 const evaluation=required(body?.evaluation,'Evaluation criteria',4000);
 const model=required(body?.model,'Pinned model',160);
 if(model==='auto')throw Error('Paired protocols require a pinned model.');
 if(!['openai','openrouter','anthropic','compat'].includes(body.provider))throw Error('Choose a supported model provider.');
 if(!['terminal','professional','simplified'].includes(body.style))throw Error('Choose an explicit writing style.');
 const context=usableMemorySnapshot(db,body.snapshotId);
 if(context.mode!=='context-aware')throw Error('Choose approved context for the memory-informed arm.');
 if(Date.parse(context.createdAt)>Date.parse(now))throw Error('Context must exist before protocol registration.');
 const source=getAnalysis(db,body.evidenceAnalysisId);
 if(source.status!=='completed'||source.events[0].data.memory.mode!=='isolated')throw Error('External evidence must come from a completed isolated analysis.');
 if(source.events.some(e=>Date.parse(e.at)>Date.parse(now)))throw Error('Evidence must exist before protocol registration.');
 const selected=body.evidenceSequences;
 if(!Array.isArray(selected)||!selected.length||selected.length>20||selected.some(n=>!Number.isSafeInteger(n)||n<0)||new Set(selected).size!==selected.length)throw Error('Select 1–20 distinct external tool-output event sequences.');
 const evidence=selected.map(sequence=>{
  const event=source.events[sequence];
  if(event?.kind!=='tool_output'||event.data.name==='research_memory'||!event.data.result||event.data.result.ok===false)throw Error('Selected evidence must be a successful external tool output.');
  return {sequence,name:event.data.name,args:event.data.args,result:event.data.result,observedAt:event.at};
 }).sort((a,b)=>a.sequence-b.sequence);
 if(Buffer.byteLength(JSON.stringify(evidence))>1024*1024)throw Error('Selected evidence exceeds 1 MiB. Select a smaller evidence set.');
 const conditions={question,provider:body.provider,model,style:body.style,evidenceAnalysisId:source.id,evidenceAnalysisHash:source.headHash,evidence,evidenceHash:hashOf(evidence),contextSnapshotId:context.id,contextHash:context.contentHash,knownAt:context.knownAt,referenceDay:now.slice(0,10),externalAccess:'frozen-only',autoEscalation:false,execution:{version:1,mode:'fixed-evidence-synthesis',maxTokens:1400,temperature:0.2,maxInputChars:100000,timeoutMs:120000}};
 // Both arms use the same memory cutoff; the isolated arm has no approved records.
 const isolated=createMemorySnapshot(db,{mode:'isolated',knownAt:context.knownAt,approvalIds:[]},{now});
 const protocol={id:newId('pair'),schemaVersion:1,createdAt:now,scope:'local-owner',hypothesis,evaluation,conditions,conditionsHash:hashOf(conditions),isolatedSnapshotId:isolated.id,limitations:['This protocol fixes the external evidence available to both arms; it does not establish historical availability of that evidence.','Model outputs can vary even when inputs and model identifiers are fixed.','A single pair cannot establish that memory generally improves research.','Registration is not execution; results and evaluation must be recorded separately.']};
 const encoded=JSON.stringify(protocol);
 db.prepare('INSERT INTO research.pair_protocols VALUES (?,?,?,?)').run(protocol.id,now,hashOf(encoded),encoded);
 return protocol;
}
export function getPairProtocol(db,id) {
 ensure(db);const row=db.prepare('SELECT body,body_hash FROM research.pair_protocols WHERE id=?').get(id);
 if(!row)throw Error('Paired protocol not found.');
 if(hashOf(row.body)!==row.body_hash)throw Error('Paired protocol checksum mismatch.');
 const protocol=JSON.parse(row.body);
 if(hashOf(protocol.conditions)!==protocol.conditionsHash||hashOf(protocol.conditions.evidence)!==protocol.conditions.evidenceHash)throw Error('Paired conditions checksum mismatch.');
 return protocol;
}
export function listPairProtocols(db) {
 ensure(db);
 return db.prepare('SELECT id FROM research.pair_protocols ORDER BY created_at DESC,id DESC LIMIT 200').all().map(row=>{
  const p=getPairProtocol(db,row.id);return {id:p.id,createdAt:p.createdAt,question:p.conditions.question,hypothesis:p.hypothesis,conditionsHash:p.conditionsHash};
 });
}
