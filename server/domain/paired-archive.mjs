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
 return zipFiles([{name:'pair.json',text:JSON.stringify(bundle,null,2)},{name:'verify.mjs',text:readFileSync(new URL('./paired-verifier.mjs',import.meta.url),'utf8')},{name:'README.txt',text:'TradeSimple Intel paired research record\nExtract the archive and run: node verify.mjs\nNode 22.13+; no packages, credentials or network required.\n\nContains the locked protocol, selected tool evidence and its source execution, both memory snapshots, arm journals/results (if executed), and all review revisions. Notebook evidence references are preserved; underlying backtest datasets and documents are not recursively included here.\n\nVerification checks internal consistency and accidental changes. It is not a cryptographic signature: replacing the entire archive and its verifier is outside this guarantee. It does not certify claim truth, historical availability, causal effects, or deterministic regeneration of model answers. Approval state reflects recorded execution, not current permission to reuse memory.\n'}]);
}
