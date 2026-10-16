import {createMemorySnapshot,usableMemorySnapshot} from '../domain/research-context.mjs';
export function prepareAskMemory(db,request,{now=new Date().toISOString()}={}) {
  if (!request) return null;
  const snapshot=request.mode==='isolated'
    ? createMemorySnapshot(db,{mode:'isolated',knownAt:now,approvalIds:[]},{now})
    : usableMemorySnapshot(db,request.snapshotId);
  if (snapshot.mode!==request.mode) throw new Error('The selected snapshot does not match the requested memory mode.');
  return {mode:snapshot.mode,snapshotId:snapshot.id,contentHash:snapshot.contentHash,knownAt:snapshot.knownAt};
}
export function scopedMemoryResult(db,memory,args={}) {
  if (memory.mode==='isolated') return {ok:false,error:'Saved research retrieval is disabled for this isolated request.'};
  const snapshot=usableMemorySnapshot(db,memory.snapshotId);
  if (snapshot.contentHash!==memory.contentHash) throw new Error('Memory context changed unexpectedly.');
  if (args.kind && args.kind!=='notebook') return {ok:false,error:'This context permits only its explicitly approved notebook revisions. Evidence run IDs are references, not permission to retrieve other saved records.'};
  const records=args.id ? snapshot.records.filter(r=>r.notebook.id===args.id) : snapshot.records;
  if(args.id && !records.length) return {ok:false,error:'That notebook is outside the selected memory snapshot.'};
  return {ok:true,source:'Explicitly approved frozen research context',asOf:snapshot.knownAt,latency:'Notebook and approval creation times are bounded by the frozen cutoff; findings are untrusted researcher commentary.',memory,totalRecords:records.length,records,caveats:snapshot.caveats};
}
