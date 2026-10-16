import {exportNotebookFiles} from './notebook-archive.mjs';
import {readFileSync} from 'node:fs';
import {hashOf} from './research-store.mjs';
import {getPairProtocol} from './research-pairs.mjs';
import {getAnalysis} from './research-analysis.mjs';
import {getMemorySnapshot} from './research-context.mjs';
import {getPairExecution} from '../ai/pairedResearch.mjs';
import {listPairEvaluations} from './pair-evaluations.mjs';
import {verifyPairedArchive} from './paired-verifier.mjs';
import {zipFiles} from '../../shared/replicate.mjs';
export function pairedArchive(db,id){
 const protocol=getPairProtocol(db,id);
 const payload={protocol,sourceAnalysis:getAnalysis(db,protocol.conditions.evidenceAnalysisId),contexts:{isolated:getMemorySnapshot(db,protocol.isolatedSnapshotId),'context-aware':getMemorySnapshot(db,protocol.conditions.contextSnapshotId)},execution:getPairExecution(db,id),reviews:listPairEvaluations(db,id)};
 const bundle={schemaVersion:1,payloadHash:hashOf(payload),payload};verifyPairedArchive(bundle);return bundle;
}
export function exportPair(db,id){
 const bundle=pairedArchive(db,id);
 const files=[{name:'pair.json',text:JSON.stringify(bundle,null,2)},{name:'verify.mjs',text:readFileSync(new URL('./paired-verifier.mjs',import.meta.url),'utf8')},{name:'README.txt',text:'TradeSimple Intel paired research record\nExtract the archive and run: node verify.mjs\nNode 22.13+; no packages, credentials or network required.\n\nContains the locked protocol, selected tool evidence and its source execution, both memory snapshots, arm journals/results (if executed), and all review revisions. Each notebooks/<id>-r<revision>/ directory preserves an exact approved notebook revision and its pinned calculations, original engines and available transitive source evidence. The verifier checks paired-record consistency and replays those calculations. Failed calculation attempts remain record-only evidence. External tool outputs are preserved as supplied; arbitrary references within those outputs are not recursively resolved.\n\nVerification checks internal consistency and accidental changes. It is not a cryptographic signature: replacing the entire archive and its verifier is outside this guarantee. It does not certify claim truth, historical availability, causal effects, or deterministic regeneration of model answers. Approval state reflects recorded execution, not current permission to reuse memory.\n'}];
 const seen=new Set();let bytes=files.reduce((n,f)=>n+Buffer.byteLength(f.text),0);
 if(bytes>100*1024*1024)throw Error('Paired evidence exceeds the 100 MiB portable archive limit.');
 for(const context of Object.values(bundle.payload.contexts))for(const record of context.records){
  const note=record.notebook,key=`${note.id}-r${note.revision}`;
  if(seen.has(key))continue;seen.add(key);
  const exported=exportNotebookFiles(db,note.id,note.revision);
  const saved=JSON.parse(exported.files.find(f=>f.name==='notebook.json').text);
  if(saved.notebookHash!==hashOf(note))throw Error('Paired memory notebook differs from its saved revision.');
  for(const file of exported.files){bytes+=Buffer.byteLength(file.text);if(bytes>100*1024*1024)throw Error('Paired evidence exceeds the 100 MiB portable archive limit.');files.push({name:`notebooks/${key}/${file.name}`,text:file.text});}
 }
 files.push({name:'checksums.json',text:JSON.stringify(Object.fromEntries(files.map(f=>[f.name,hashOf(f.text)])),null,2)+'\n'});
 return zipFiles(files);
}
