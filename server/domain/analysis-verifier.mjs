/** Standalone structural/checksum verification. Never executes model output or contacts a provider. */
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const check=(condition,message)=>{if(!condition)throw Error(message);};
function context(s){
 check(s&&Array.isArray(s.records),'Missing memory snapshot.');
 const {mode,scope,knownAt,records}=s;
 check(hash({mode,scope,knownAt,records})===s.contentHash,'Memory content checksum mismatch.');
 if(mode==='isolated')check(!records.length,'Isolated context contains memory.');
 for(const r of records){
  check(r.approval.notebookHash===hash(r.notebook),'Approved notebook checksum mismatch.');
  check(r.approval.action==='approve'&&r.approval.notebookId===r.notebook.id&&r.approval.revision===r.notebook.revision,'Approval revision mismatch.');
  check(Date.parse(r.approval.createdAt)<=Date.parse(knownAt)&&Date.parse(r.notebook.createdAt)<=Date.parse(knownAt),'Memory exceeds its cutoff.');
 }
}
function analysis(a){
 check(a&&Array.isArray(a.events)&&a.events.length,'Missing analysis journal.');
 let previous=null;
 for(const [i,e] of a.events.entries()){
  check(e.analysisId===a.id&&e.sequence===i&&e.previousHash===previous,'Analysis chain mismatch.');
  check(e.kind!=='finished'||i===a.events.length-1,'Events follow analysis completion.');previous=hash(e);
 }
 check(a.headHash===previous&&a.events[0].kind==='started','Analysis head checksum mismatch.');
 const start=a.events[0].data;context(start.snapshot);
 check(start.memory.snapshotId===start.snapshot.id&&start.memory.contentHash===start.snapshot.contentHash&&start.memory.mode===start.snapshot.mode,'Analysis memory reference mismatch.');
 check(['isolated','context-aware'].includes(start.snapshot.mode),'Invalid memory mode.');
 check(a.schemaVersion===1&&a.createdAt===a.events[0].at,'Analysis metadata mismatch.');
 check(['completed','failed','aborted','clarification','incomplete'].includes(a.status),'Invalid analysis status.');
 const end=a.events.at(-1);check(a.status===(end.kind==='finished'?end.data.status:'incomplete'),'Analysis status mismatch.');
}
export function verifyAnalysisArchive(bundle){
 check(bundle?.schemaVersion===1&&bundle.payload&&bundle.payloadHash===hash(bundle.payload),'Archive checksum mismatch.');
 analysis(bundle.payload);
 return {ok:true,analysisId:bundle.payload.id,status:bundle.payload.status,events:bundle.payload.events.length,scope:'Recorded inputs, outputs, hash chain and memory references. Not model regeneration or claim verification.'};
}
export function verifyAnalysisDirectory(directory){
 const root=path.resolve(directory),read=name=>readFileSync(path.join(root,name),'utf8');
 const manifest=JSON.parse(read('checksums.json'));
 check(manifest&&typeof manifest==='object'&&!Array.isArray(manifest),'Invalid analysis checksum manifest.');
 for(const name of ['analysis.json','verify.mjs','README.txt'])check(manifest[name],`Missing manifest entry: ${name}`);
 const allowed=/^(analysis\.json|verify\.mjs|README\.txt|notebooks\/nb_[a-f0-9]+-r[1-9][0-9]*\/(notebook\.json|verify\.mjs|README\.txt|checksums\.json|runs\/run_[a-f0-9]+\/(run\.json|evidence\.json|checksums\.json|replay\.mjs|README\.txt|engine\/[A-Za-z0-9_-]+\.mjs)))$/;
 for(const [name,digest] of Object.entries(manifest)){
  check(allowed.test(name),'Unsafe analysis archive path.');
  check(hash(read(name))===digest,`Checksum mismatch: ${name}`);
 }
 const bundle=JSON.parse(read('analysis.json')),proof=verifyAnalysisArchive(bundle),notebooks=new Map();
 for(const {notebook} of bundle.payload.events[0].data.snapshot.records){
  check(/^nb_[a-f0-9]+$/.test(notebook.id)&&Number.isSafeInteger(notebook.revision)&&notebook.revision>0,'Invalid analysis notebook identity.');
  const key=`${notebook.id}-r${notebook.revision}`,folder=`notebooks/${key}`;
  for(const name of ['notebook.json','checksums.json','verify.mjs'])check(manifest[`${folder}/${name}`],'Missing analysis notebook evidence files.');
  const saved=JSON.parse(read(`${folder}/notebook.json`));
  check(saved.notebookHash===hash(notebook)&&hash(saved.notebook)===hash(notebook),'Analysis notebook differs from frozen memory.');
  notebooks.set(key,notebook);
 }
 const results=[];
 for(const [key,note] of notebooks){
  const verification=spawnSync(process.execPath,['verify.mjs'],{cwd:path.join(root,'notebooks',key),encoding:'utf8',timeout:300000,maxBuffer:2*1024*1024});
  check(!verification.error&&verification.status===0,`Notebook evidence verification failed: ${key}: ${verification.error?.message||verification.stderr||verification.stdout}`);
  let result;try{result=JSON.parse(verification.stdout);}catch{throw Error(`Invalid notebook verification output: ${key}`);}
  check(result.verified===true&&result.notebookId===note.id&&result.revision===note.revision,'Notebook verification identity mismatch.');
  results.push(result);
 }
 return {...proof,notebooks:results,scope:'Recorded execution, exact approved notebook revisions and replayable pinned calculations. Not a signature, claim-truth check or model regeneration.'};
}
if(process.argv[1]&&realpathSync(path.resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url))){
 try{const file=process.argv[2]?path.resolve(process.argv[2]):fileURLToPath(new URL('analysis.json',import.meta.url));console.log(JSON.stringify(verifyAnalysisDirectory(path.dirname(file)),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
